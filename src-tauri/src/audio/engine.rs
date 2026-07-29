use cpal::traits::StreamTrait;
use cpal::Stream;
use crossbeam_channel::{Receiver, Sender};
use ringbuf::traits::{Producer, Split};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use super::output;

pub const STATE_STOPPED: u8 = 0;
pub const STATE_PLAYING: u8 = 1;
pub const STATE_PAUSED: u8 = 2;

/// The output backend currently in use. cpal covers every platform in shared
/// mode; the exclusive variant is Windows-only and owns the endpoint outright.
pub enum ActiveStream {
    Cpal(Stream),
    #[cfg(windows)]
    Exclusive(super::exclusive::ExclusiveStream),
}

impl ActiveStream {
    fn play(&self) -> Result<(), String> {
        match self {
            ActiveStream::Cpal(s) => s.play().map_err(|e| format!("Failed to resume: {}", e)),
            #[cfg(windows)]
            ActiveStream::Exclusive(s) => s.play(),
        }
    }

    fn pause(&self) -> Result<(), String> {
        match self {
            ActiveStream::Cpal(s) => s.pause().map_err(|e| format!("Failed to pause: {}", e)),
            #[cfg(windows)]
            ActiveStream::Exclusive(s) => s.pause(),
        }
    }
}

/// One opened output, before the decode thread is attached to it.
struct OpenedOutput {
    stream: ActiveStream,
    producer: ringbuf::HeapProd<f32>,
    sample_rate: u32,
    channels: u16,
    exclusive: bool,
    /// Meaningful bits per sample, exclusive mode only — shared mode is
    /// whatever the Windows engine decides downstream of us.
    bits: Option<u16>,
}

/// Commands sent from the main thread to the decode thread.
pub enum DecodeCommand {
    Stop,
    Seek(f64), // seek to seconds
}

/// Info about the currently playing track, sent back after load.
#[derive(Clone, serde::Serialize)]
pub struct TrackInfo {
    pub file_path: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub format: String,
    pub bit_depth: Option<u32>,
    pub bitrate: Option<u32>,
}

pub struct AudioEngine {
    pub playback_state: Arc<AtomicU8>,
    pub volume: Arc<AtomicU8>,
    /// Samples played counter for position tracking
    pub samples_played: Arc<AtomicU64>,
    /// Set to true when a track finishes naturally (not stopped by user)
    pub track_ended_naturally: Arc<AtomicBool>,
    active_stream: Option<ActiveStream>,
    /// Send commands to the decode thread
    cmd_tx: Option<Sender<DecodeCommand>>,
    /// Handle for the decode thread
    decode_handle: Option<std::thread::JoinHandle<()>>,
    /// FFT data sender — audio samples go here for analysis
    pub fft_sender: Option<Sender<Vec<f32>>>,
    /// The rate and channel count actually being fed to the device right now.
    /// In exclusive mode this follows the file, so it changes per track.
    pub device_sample_rate: u32,
    pub device_channels: u16,
    /// cpal's shared-mode defaults — the Windows mix format, and the fallback
    /// whenever exclusive mode is off or the device refuses it.
    default_sample_rate: u32,
    default_channels: u16,
    /// Mirrors of the active rate for the FFT thread, which outlives any one
    /// track and needs its position maths to follow the stream.
    pub active_rate: Arc<AtomicU32>,
    pub active_channels: Arc<AtomicU32>,
    /// Output settings, applied on the next track load.
    pub exclusive_enabled: bool,
    pub output_device_id: Option<String>,
    /// What actually got opened, for the settings readout.
    pub active_exclusive: bool,
    pub active_bits: Option<u16>,
    device: cpal::Device,
    /// Current track info
    pub current_track: Option<TrackInfo>,
    /// App handle for emitting events (e.g. playback errors)
    app_handle: Option<tauri::AppHandle>,
    /// Set to true during seek to tell cpal callback to discard old buffer data
    pub seek_flush: Arc<AtomicBool>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        let (device, device_sample_rate, device_channels) = output::get_device_sample_rate()?;
        println!(
            "Audio device: sample_rate={}, channels={}",
            device_sample_rate, device_channels
        );

        Ok(AudioEngine {
            playback_state: Arc::new(AtomicU8::new(STATE_STOPPED)),
            volume: Arc::new(AtomicU8::new(80)),
            samples_played: Arc::new(AtomicU64::new(0)),
            track_ended_naturally: Arc::new(AtomicBool::new(false)),
            active_stream: None,
            cmd_tx: None,
            decode_handle: None,
            fft_sender: None,
            device_sample_rate,
            device_channels,
            default_sample_rate: device_sample_rate,
            default_channels: device_channels,
            active_rate: Arc::new(AtomicU32::new(device_sample_rate)),
            active_channels: Arc::new(AtomicU32::new(device_channels as u32)),
            exclusive_enabled: false,
            output_device_id: None,
            active_exclusive: false,
            active_bits: None,
            device,
            current_track: None,
            app_handle: None,
            seek_flush: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Ring buffer holding ~100ms of audio, sized for the rate being opened.
    fn make_ring(rate: u32, channels: u16) -> (ringbuf::HeapProd<f32>, ringbuf::HeapCons<f32>) {
        let frames = (rate as usize * channels.max(1) as usize / 10).max(4096);
        ringbuf::HeapRb::<f32>::new(frames).split()
    }

    /// Pick and open the output for one track.
    ///
    /// Exclusive mode is tried at the file's own rate first — that is the whole
    /// point of it, since shared mode forces every file through one mix format.
    /// If the device refuses that rate it is retried at the shared default, and
    /// if exclusive fails outright the track still plays: it falls back to cpal
    /// rather than leaving the user with silence and an error.
    fn open_output(&mut self, file_sr: u32) -> Result<OpenedOutput, String> {
        #[cfg(windows)]
        {
            if self.exclusive_enabled {
                let rates = output_rate_candidates(file_sr, self.default_sample_rate);
                for rate in rates {
                    let fmt = match super::exclusive::probe(
                        self.output_device_id.clone(),
                        rate,
                        self.default_channels,
                    ) {
                        Ok(fmt) => fmt,
                        Err(e) => {
                            println!("Exclusive mode unavailable at {} Hz: {}", rate, e);
                            continue;
                        }
                    };
                    let (producer, consumer) = Self::make_ring(fmt.sample_rate, fmt.channels);
                    match super::exclusive::open(
                        self.output_device_id.clone(),
                        fmt.sample_rate,
                        fmt.channels,
                        consumer,
                        self.volume.clone(),
                        self.samples_played.clone(),
                        self.playback_state.clone(),
                        self.seek_flush.clone(),
                    ) {
                        Ok(stream) => {
                            return Ok(OpenedOutput {
                                stream: ActiveStream::Exclusive(stream),
                                producer,
                                sample_rate: fmt.sample_rate,
                                channels: fmt.channels,
                                exclusive: true,
                                bits: Some(fmt.valid_bits),
                            })
                        }
                        Err(e) => println!("Exclusive open at {} Hz failed: {}", fmt.sample_rate, e),
                    }
                }
                println!("Falling back to shared mode");
            }
        }

        let rate = self.default_sample_rate;
        let channels = self.default_channels;
        let (producer, consumer) = Self::make_ring(rate, channels);
        let stream = output::build_output_stream(
            &self.device,
            rate,
            channels,
            consumer,
            self.volume.clone(),
            self.samples_played.clone(),
            self.playback_state.clone(),
            self.seek_flush.clone(),
        )?;
        Ok(OpenedOutput {
            stream: ActiveStream::Cpal(stream),
            producer,
            sample_rate: rate,
            channels,
            exclusive: false,
            bits: None,
        })
    }

    /// Set the FFT sender channel (called during app setup)
    pub fn set_fft_sender(&mut self, sender: Sender<Vec<f32>>) {
        self.fft_sender = Some(sender);
    }

    /// Set the app handle for emitting events (called during app setup)
    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    /// Load a file and start playback. Returns TrackInfo near-instantly
    /// by probing metadata without decoding, then streaming decode in background.
    pub fn load_and_play(&mut self, path: &str) -> Result<TrackInfo, String> {
        self.track_ended_naturally.store(false, Ordering::Relaxed);
        self.stop_internal();

        // One decision, shared by probe and decode. Reads the file header only.
        let (backend, probe) = super::decoder::choose_backend(path)?;

        let format = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_uppercase();

        let track_info = TrackInfo {
            file_path: path.to_string(),
            duration_seconds: probe.duration_seconds,
            // The file's native rate — 2822400 for DSD64, not the device rate.
            sample_rate: probe.sample_rate,
            channels: probe.channels,
            format,
            bit_depth: probe.bit_depth,
            bitrate: probe.bitrate,
        };
        self.current_track = Some(track_info.clone());

        let file_sr = probe.sample_rate;
        let file_ch = probe.channels;

        // Reset position and seek state before anything starts pulling audio —
        // the exclusive render thread begins the moment it is opened.
        self.samples_played.store(0, Ordering::Relaxed);
        self.seek_flush.store(false, Ordering::Release);

        // The output decides the rate, not the other way around: exclusive mode
        // opens at the file's own rate when the device allows it.
        let opened = self.open_output(file_sr)?;
        self.device_sample_rate = opened.sample_rate;
        self.device_channels = opened.channels;
        self.active_rate.store(opened.sample_rate, Ordering::Relaxed);
        self.active_channels
            .store(opened.channels as u32, Ordering::Relaxed);
        self.active_exclusive = opened.exclusive;
        self.active_bits = opened.bits;

        // ffmpeg emits at the device rate already, so resampling only ever
        // applies to the symphonia branch.
        let needs_resample = backend == super::decoder::Backend::Symphonia
            && file_sr != self.device_sample_rate;

        let producer = opened.producer;
        self.active_stream = Some(opened.stream);

        // Create command channel for decode thread
        let (cmd_tx, cmd_rx) = crossbeam_channel::bounded::<DecodeCommand>(16);
        self.cmd_tx = Some(cmd_tx);

        // Spawn decode thread
        let fft_sender = self.fft_sender.clone();
        let playback_state = self.playback_state.clone();
        let track_ended = self.track_ended_naturally.clone();
        let volume = self.volume.clone();
        let device_channels = self.device_channels;
        let device_sr = self.device_sample_rate;
        let path_owned = path.to_string();
        let app_handle = self.app_handle.clone();
        let seek_flush = self.seek_flush.clone();

        let handle = std::thread::spawn(move || {
            if backend == super::decoder::Backend::Ffmpeg {
                println!("Using ffmpeg fallback for: {}", path_owned);
                decode_thread_ffmpeg(
                    &path_owned,
                    device_sr,
                    device_channels,
                    producer,
                    cmd_rx,
                    fft_sender,
                    playback_state,
                    track_ended,
                    app_handle,
                    seek_flush,
                    volume,
                );
            } else if needs_resample {
                decode_thread_resampling(
                    &path_owned,
                    file_sr,
                    file_ch,
                    device_sr,
                    device_channels,
                    producer,
                    cmd_rx,
                    fft_sender,
                    playback_state,
                    track_ended,
                    app_handle,
                    seek_flush,
                    volume,
                );
            } else {
                decode_thread_streaming(
                    &path_owned,
                    file_ch,
                    device_channels,
                    producer,
                    cmd_rx,
                    fft_sender,
                    playback_state,
                    track_ended,
                    device_sr,
                    app_handle,
                    seek_flush,
                    volume,
                );
            }
        });
        self.decode_handle = Some(handle);

        self.playback_state.store(STATE_PLAYING, Ordering::Relaxed);
        println!(
            "Playback started (duration: {:.1}s)",
            probe.duration_seconds
        );

        Ok(track_info)
    }

    pub fn pause(&mut self) -> Result<(), String> {
        if let Some(ref stream) = self.active_stream {
            stream.pause()?;
            self.playback_state.store(STATE_PAUSED, Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn resume(&mut self) -> Result<(), String> {
        if let Some(ref stream) = self.active_stream {
            stream.play()?;
            self.playback_state.store(STATE_PLAYING, Ordering::Relaxed);
        }
        Ok(())
    }

    /// Output settings. They take effect on the next track load rather than
    /// mid-track: switching share mode means tearing down the endpoint, and
    /// doing that under a playing stream is how you lose the device.
    pub fn set_output_config(&mut self, exclusive: bool, device_id: Option<String>) {
        self.exclusive_enabled = exclusive;
        self.output_device_id = device_id;
    }

    pub fn seek(&mut self, position_seconds: f64) -> Result<(), String> {
        if let Some(ref cmd_tx) = self.cmd_tx {
            // Tell cpal callback to discard old buffered audio
            self.seek_flush.store(true, Ordering::Release);
            cmd_tx
                .send(DecodeCommand::Seek(position_seconds))
                .map_err(|e| format!("Failed to send seek: {}", e))?;
            // Update position counter
            let sample_pos = (position_seconds * self.device_sample_rate as f64) as u64
                * self.device_channels as u64;
            self.samples_played.store(sample_pos, Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn stop(&mut self) {
        self.stop_internal();
    }

    fn stop_internal(&mut self) {
        self.playback_state.store(STATE_STOPPED, Ordering::Relaxed);
        if let Some(cmd_tx) = self.cmd_tx.take() {
            let _ = cmd_tx.send(DecodeCommand::Stop);
            // Drop disconnects channel — thread sees Disconnected and exits
        }
        self.active_stream = None; // Drop stops audio output
        let _ = self.decode_handle.take(); // Take but don't join — thread exits on its own
        self.samples_played.store(0, Ordering::Relaxed);
        self.track_ended_naturally.store(false, Ordering::Relaxed);
        self.current_track = None;
    }

    pub fn set_volume(&self, vol: u8) {
        self.volume.store(vol.min(100), Ordering::Relaxed);
    }

}

/// Streaming decode thread — reads packets one at a time from the file.
/// Near-instant playback start since no full decode is needed.
fn decode_thread_streaming(
    path: &str,
    file_channels: u16,
    device_channels: u16,
    mut producer: ringbuf::HeapProd<f32>,
    cmd_rx: Receiver<DecodeCommand>,
    fft_sender: Option<Sender<Vec<f32>>>,
    playback_state: Arc<AtomicU8>,
    track_ended_naturally: Arc<AtomicBool>,
    _sample_rate: u32,
    app_handle: Option<tauri::AppHandle>,
    seek_flush: Arc<AtomicBool>,
    volume: Arc<AtomicU8>,
) {
    let (mut format_reader, mut decoder, track_id, _info) =
        match super::decoder::open_for_streaming(path) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Failed to open for streaming: {}", e);
                emit_playback_error(&app_handle, &e, path);
                playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                return;
            }
        };

    let is_mono = file_channels == 1 && device_channels >= 2;
    let mut sample_buf: Vec<f32> = Vec::with_capacity(8192);
    let mut stereo_buf: Vec<f32> = Vec::with_capacity(16384);

    loop {
        // Check for commands (non-blocking)
        if let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DecodeCommand::Stop => break,
                DecodeCommand::Seek(seconds) => {
                    // Old buffered audio is discarded by cpal callback via seek_flush flag
                    let time = symphonia::core::units::Time {
                        seconds: seconds as u64,
                        frac: seconds.fract(),
                    };
                    let seek_to = symphonia::core::formats::SeekTo::Time {
                        time,
                        track_id: Some(track_id),
                    };
                    if let Err(e) = format_reader.seek(
                        symphonia::core::formats::SeekMode::Coarse,
                        seek_to,
                    ) {
                        eprintln!("Seek error: {}", e);
                    }
                    decoder.reset();
                    // Signal cpal callback that flush is done, new data incoming
                    seek_flush.store(false, Ordering::Release);
                    continue;
                }
            }
        }

        let state = playback_state.load(Ordering::Relaxed);
        if state == STATE_STOPPED {
            break;
        }
        if state == STATE_PAUSED {
            std::thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }

        // Read next packet
        let packet = match format_reader.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                std::thread::sleep(std::time::Duration::from_millis(100));
                track_ended_naturally.store(true, Ordering::Relaxed);
                playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                break;
            }
            Err(e) => {
                eprintln!("Error reading packet: {}", e);
                break;
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                eprintln!("Decode error (skipping): {}", e);
                continue;
            }
            Err(e) => {
                eprintln!("Fatal decode error: {}", e);
                emit_playback_error(&app_handle, &format!("Decode error: {}", e), path);
                break;
            }
        };

        // Convert to interleaved f32
        sample_buf.clear();
        super::decoder::append_samples(&decoded, &mut sample_buf, file_channels);

        // Handle mono → stereo
        let output: &[f32] = if is_mono {
            stereo_buf.clear();
            stereo_buf.reserve(sample_buf.len() * 2);
            for &s in &sample_buf {
                stereo_buf.push(s);
                stereo_buf.push(s);
            }
            &stereo_buf
        } else {
            &sample_buf
        };

        // Push to ring buffer, waiting if full
        push_to_ringbuf(output, &mut producer, &cmd_rx, &fft_sender, &playback_state, &volume);
    }
}

/// Streaming decode + resample thread — decodes packets one at a time,
/// resamples each chunk, and pushes to ring buffer immediately.
/// Playback starts after the first chunk is ready (near-instant).
fn decode_thread_resampling(
    path: &str,
    file_sr: u32,
    file_ch: u16,
    device_sr: u32,
    device_channels: u16,
    mut producer: ringbuf::HeapProd<f32>,
    cmd_rx: Receiver<DecodeCommand>,
    fft_sender: Option<Sender<Vec<f32>>>,
    playback_state: Arc<AtomicU8>,
    track_ended_naturally: Arc<AtomicBool>,
    app_handle: Option<tauri::AppHandle>,
    seek_flush: Arc<AtomicBool>,
    volume: Arc<AtomicU8>,
) {
    println!("Streaming resample {}Hz → {}Hz", file_sr, device_sr);

    let (mut format_reader, mut decoder, track_id, _info) =
        match super::decoder::open_for_streaming(path) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Failed to open for streaming resample: {}", e);
                emit_playback_error(&app_handle, &e, path);
                playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                return;
            }
        };

    // Determine resampling channel count (after mono→stereo)
    let resample_ch = if file_ch == 1 && device_channels >= 2 { 2u16 } else { file_ch };
    let is_mono = file_ch == 1 && device_channels >= 2;

    let mut resampler = match super::resampler::StreamingResampler::new(file_sr, device_sr, resample_ch) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to create streaming resampler: {}", e);
            emit_playback_error(&app_handle, &e, path);
            playback_state.store(STATE_STOPPED, Ordering::Relaxed);
            return;
        }
    };

    let chunk_frames = resampler.input_chunk_size();
    let ch = resample_ch as usize;
    // Accumulator for decoded samples until we have enough for one resample chunk
    let mut accum: Vec<f32> = Vec::with_capacity(chunk_frames * ch * 2);
    let mut sample_buf: Vec<f32> = Vec::with_capacity(8192);
    let mut stereo_buf: Vec<f32> = Vec::with_capacity(16384);

    loop {
        // Check for commands (non-blocking)
        if let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DecodeCommand::Stop => break,
                DecodeCommand::Seek(seconds) => {
                    // Old buffered audio is discarded by cpal callback via seek_flush flag
                    let time = symphonia::core::units::Time {
                        seconds: seconds as u64,
                        frac: seconds.fract(),
                    };
                    let seek_to = symphonia::core::formats::SeekTo::Time {
                        time,
                        track_id: Some(track_id),
                    };
                    if let Err(e) = format_reader.seek(
                        symphonia::core::formats::SeekMode::Coarse,
                        seek_to,
                    ) {
                        eprintln!("Seek error: {}", e);
                    }
                    decoder.reset();
                    accum.clear();
                    seek_flush.store(false, Ordering::Release);
                    continue;
                }
            }
        }

        let state = playback_state.load(Ordering::Relaxed);
        if state == STATE_STOPPED {
            break;
        }
        if state == STATE_PAUSED {
            std::thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }

        // Read next packet
        let packet = match format_reader.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                // EOF — flush any remaining accumulated samples
                if !accum.is_empty() {
                    // Pad to full chunk size for final resample
                    let needed = chunk_frames * ch;
                    accum.resize(needed, 0.0);
                    if let Ok(resampled) = resampler.process_chunk(&accum) {
                        push_to_ringbuf(&resampled, &mut producer, &cmd_rx, &fft_sender, &playback_state, &volume);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
                track_ended_naturally.store(true, Ordering::Relaxed);
                playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                break;
            }
            Err(e) => {
                eprintln!("Error reading packet: {}", e);
                emit_playback_error(&app_handle, &format!("Read error: {}", e), path);
                break;
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                eprintln!("Decode error (skipping): {}", e);
                continue;
            }
            Err(e) => {
                eprintln!("Fatal decode error: {}", e);
                emit_playback_error(&app_handle, &format!("Decode error: {}", e), path);
                break;
            }
        };

        // Convert to interleaved f32
        sample_buf.clear();
        super::decoder::append_samples(&decoded, &mut sample_buf, file_ch);

        // Handle mono → stereo
        let samples: &[f32] = if is_mono {
            stereo_buf.clear();
            stereo_buf.reserve(sample_buf.len() * 2);
            for &s in &sample_buf {
                stereo_buf.push(s);
                stereo_buf.push(s);
            }
            &stereo_buf
        } else {
            &sample_buf
        };

        // Accumulate samples
        accum.extend_from_slice(samples);

        // Process complete chunks through resampler
        let chunk_samples = chunk_frames * ch;
        while accum.len() >= chunk_samples {
            let chunk: Vec<f32> = accum.drain(..chunk_samples).collect();
            match resampler.process_chunk(&chunk) {
                Ok(resampled) => {
                    push_to_ringbuf(&resampled, &mut producer, &cmd_rx, &fft_sender, &playback_state, &volume);
                    // Check if we should stop after pushing
                    if playback_state.load(Ordering::Relaxed) == STATE_STOPPED {
                        return;
                    }
                }
                Err(e) => {
                    eprintln!("Resample chunk error: {}", e);
                    emit_playback_error(&app_handle, &e, path);
                    playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                    return;
                }
            }
        }
    }
}

/// ffmpeg-based decode thread — used when Symphonia can't decode the codec (e.g. ALAC).
/// ffmpeg outputs raw f32le PCM at the device sample rate, so no resampling needed.
fn decode_thread_ffmpeg(
    path: &str,
    device_sr: u32,
    device_channels: u16,
    mut producer: ringbuf::HeapProd<f32>,
    cmd_rx: Receiver<DecodeCommand>,
    fft_sender: Option<Sender<Vec<f32>>>,
    playback_state: Arc<AtomicU8>,
    track_ended_naturally: Arc<AtomicBool>,
    app_handle: Option<tauri::AppHandle>,
    seek_flush: Arc<AtomicBool>,
    volume: Arc<AtomicU8>,
) {
    use std::io::Read;

    let mut child = match super::ffmpeg::open_stream(path, device_sr, device_channels) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("ffmpeg fallback failed: {}", e);
            emit_playback_error(&app_handle, &e, path);
            playback_state.store(STATE_STOPPED, Ordering::Relaxed);
            return;
        }
    };

    let mut stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            eprintln!("ffmpeg: no stdout");
            playback_state.store(STATE_STOPPED, Ordering::Relaxed);
            return;
        }
    };

    // Read buffer: 4096 f32 samples = 16384 bytes
    let sample_count = 4096;
    let mut byte_buf = vec![0u8; sample_count * 4];
    let mut sample_buf = Vec::with_capacity(sample_count);
    let path_owned = path.to_string();

    loop {
        // Check for commands (non-blocking)
        if let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DecodeCommand::Stop => {
                    let _ = child.kill();
                    break;
                }
                DecodeCommand::Seek(seconds) => {
                    // Kill current ffmpeg, restart at new position
                    let _ = child.kill();
                    let _ = child.wait();
                    match super::ffmpeg::open_stream_seeked(
                        &path_owned, device_sr, device_channels, seconds,
                    ) {
                        Ok(mut new_child) => {
                            stdout = match new_child.stdout.take() {
                                Some(s) => s,
                                None => {
                                    eprintln!("ffmpeg seek: no stdout");
                                    playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                                    return;
                                }
                            };
                            child = new_child;
                        }
                        Err(e) => {
                            eprintln!("ffmpeg seek failed: {}", e);
                            emit_playback_error(&app_handle, &e, &path_owned);
                            playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                            return;
                        }
                    }
                    seek_flush.store(false, Ordering::Release);
                    continue;
                }
            }
        }

        let state = playback_state.load(Ordering::Relaxed);
        if state == STATE_STOPPED {
            let _ = child.kill();
            break;
        }
        if state == STATE_PAUSED {
            std::thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }

        // Read raw f32le bytes from ffmpeg stdout
        match stdout.read(&mut byte_buf) {
            Ok(0) => {
                // EOF — track finished
                std::thread::sleep(std::time::Duration::from_millis(100));
                track_ended_naturally.store(true, Ordering::Relaxed);
                playback_state.store(STATE_STOPPED, Ordering::Relaxed);
                break;
            }
            Ok(n) => {
                // Convert bytes to f32 samples (little-endian)
                let num_samples = n / 4;
                sample_buf.clear();
                sample_buf.reserve(num_samples);
                for i in 0..num_samples {
                    let offset = i * 4;
                    let sample = f32::from_le_bytes([
                        byte_buf[offset],
                        byte_buf[offset + 1],
                        byte_buf[offset + 2],
                        byte_buf[offset + 3],
                    ]);
                    sample_buf.push(sample);
                }
                push_to_ringbuf(&sample_buf, &mut producer, &cmd_rx, &fft_sender, &playback_state, &volume);
            }
            Err(e) => {
                eprintln!("ffmpeg read error: {}", e);
                break;
            }
        }
    }

    let _ = child.wait();
}

/// Push samples to the ring buffer with volume applied, waiting if full.
/// Also sends copies to the FFT thread (post-volume, so visualizers match what you hear).
/// Only checks playback_state to bail out — does NOT consume commands from cmd_rx
/// (that's the caller's job, so seek commands aren't silently dropped).
fn push_to_ringbuf(
    samples: &[f32],
    producer: &mut ringbuf::HeapProd<f32>,
    _cmd_rx: &Receiver<DecodeCommand>,
    fft_sender: &Option<Sender<Vec<f32>>>,
    playback_state: &Arc<AtomicU8>,
    volume: &Arc<AtomicU8>,
) {
    // Apply volume once here — the cpal callback just reads from the ring buffer raw.
    let vol = volume.load(Ordering::Relaxed) as f32 / 100.0;
    let scaled: Vec<f32> = samples.iter().map(|&s| s * vol).collect();

    let mut pos = 0;
    while pos < scaled.len() {
        let state = playback_state.load(Ordering::Relaxed);
        if state == STATE_STOPPED {
            return;
        }

        let pushed = producer.push_slice(&scaled[pos..]);
        if pushed == 0 {
            std::thread::sleep(std::time::Duration::from_millis(2));
            continue;
        }

        if let Some(ref fft_tx) = fft_sender {
            let _ = fft_tx.try_send(scaled[pos..pos + pushed].to_vec());
        }

        pos += pushed;
    }
}

/// Emit a playback-error event to the frontend so the user sees a toast.
fn emit_playback_error(app_handle: &Option<tauri::AppHandle>, error: &str, path: &str) {
    if let Some(ref handle) = app_handle {
        use tauri::Emitter;
        let filename = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path);
        let _ = handle.emit(
            "playback-error",
            serde_json::json!({
                "error": error,
                "file": filename,
            }),
        );
    }
}

/// Output rates to try for a file, best first.
///
/// A normal file just asks for its own rate and falls back to the shared
/// default. DSD is the interesting case: it arrives at 2.8 MHz or more and no
/// DAC accepts that as PCM, so the first probe always fails and something has
/// to be chosen. Halving keeps the decimation an integer ratio and stays in the
/// file's own 44.1 or 48 kHz family, landing DSD64 on 176.4 kHz — what
/// dedicated DSD players target — rather than dropping to the shared default,
/// which on a CD-rate system throws away everything DSD was carrying.
fn output_rate_candidates(file_sr: u32, default_sr: u32) -> Vec<u32> {
    let mut rates = vec![file_sr];
    if file_sr > 192_000 {
        let mut r = file_sr;
        while r > 192_000 {
            r /= 2;
        }
        while r >= 44_100 {
            rates.push(r);
            r /= 2;
        }
    }
    if !rates.contains(&default_sr) {
        rates.push(default_sr);
    }
    rates
}

#[cfg(test)]
mod rate_tests {
    use super::output_rate_candidates;

    #[test]
    fn ordinary_files_ask_for_their_own_rate_then_the_default() {
        assert_eq!(output_rate_candidates(44_100, 44_100), vec![44_100]);
        assert_eq!(output_rate_candidates(48_000, 44_100), vec![48_000, 44_100]);
        assert_eq!(output_rate_candidates(192_000, 44_100), vec![192_000, 44_100]);
    }

    // DSD64 is 44100 * 64. 176.4 kHz is a divide by 16 and stays in the 44.1
    // family; falling back to the CD-rate default would be a divide by 64.
    #[test]
    fn dsd64_decimates_to_176_4_not_the_shared_default() {
        let got = output_rate_candidates(2_822_400, 44_100);
        assert_eq!(got, vec![2_822_400, 176_400, 88_200, 44_100]);
        assert!(
            got.iter().position(|r| *r == 176_400) < got.iter().position(|r| *r == 44_100),
            "176.4 kHz must be preferred over the shared default"
        );
    }

    #[test]
    fn dsd128_lands_in_the_same_family() {
        assert_eq!(
            output_rate_candidates(5_644_800, 44_100),
            vec![5_644_800, 176_400, 88_200, 44_100]
        );
    }

    // The rarer 48 kHz-family DSD must not be dragged into the 44.1 family.
    #[test]
    fn dsd_in_the_48k_family_stays_there() {
        let got = output_rate_candidates(3_072_000, 48_000);
        assert_eq!(got, vec![3_072_000, 192_000, 96_000, 48_000]);
    }

    // Every candidate must divide the source exactly — a non-integer ratio
    // means resampling rather than decimation.
    #[test]
    fn every_dsd_candidate_is_an_integer_divisor() {
        for src in [2_822_400u32, 5_644_800, 3_072_000] {
            for r in output_rate_candidates(src, 44_100) {
                if r == src {
                    continue;
                }
                if src % r != 0 {
                    // The trailing shared default need not divide the source.
                    assert_eq!(r, 44_100, "{} does not divide {}", r, src);
                }
            }
        }
    }
}
