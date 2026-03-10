use cpal::traits::StreamTrait;
use cpal::Stream;
use crossbeam_channel::{Receiver, Sender};
use ringbuf::traits::{Producer, Split};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use super::output;

pub const STATE_STOPPED: u8 = 0;
pub const STATE_PLAYING: u8 = 1;
pub const STATE_PAUSED: u8 = 2;

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
    active_stream: Option<Stream>,
    /// Send commands to the decode thread
    cmd_tx: Option<Sender<DecodeCommand>>,
    /// Handle for the decode thread
    decode_handle: Option<std::thread::JoinHandle<()>>,
    /// FFT data sender — audio samples go here for analysis
    pub fft_sender: Option<Sender<Vec<f32>>>,
    /// Device info
    pub device_sample_rate: u32,
    pub device_channels: u16,
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
            device,
            current_track: None,
            app_handle: None,
            seek_flush: Arc::new(AtomicBool::new(false)),
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

        // Instant probe — reads file header only, no decoding
        let (file_sr, file_ch, duration, bit_depth, bitrate) =
            super::decoder::probe_file_info(path)?;

        let format = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_uppercase();

        let track_info = TrackInfo {
            file_path: path.to_string(),
            duration_seconds: duration,
            sample_rate: file_sr,
            channels: file_ch,
            format,
            bit_depth,
            bitrate,
        };
        self.current_track = Some(track_info.clone());

        let needs_resample = file_sr != self.device_sample_rate;

        // Ring buffer: ~1 second of audio
        let ch = self.device_channels as usize;
        let buf_size = (self.device_sample_rate as usize * ch).max(16384);
        let rb = ringbuf::HeapRb::<f32>::new(buf_size);
        let (producer, consumer) = rb.split();

        // Reset position counter
        self.samples_played.store(0, Ordering::Relaxed);

        // Reset seek flush flag
        self.seek_flush.store(false, Ordering::Release);

        // Build output stream
        let stream = output::build_output_stream(
            &self.device,
            self.device_sample_rate,
            self.device_channels,
            consumer,
            self.volume.clone(),
            self.samples_played.clone(),
            self.playback_state.clone(),
            self.seek_flush.clone(),
        )?;
        self.active_stream = Some(stream);

        // Create command channel for decode thread
        let (cmd_tx, cmd_rx) = crossbeam_channel::bounded::<DecodeCommand>(16);
        self.cmd_tx = Some(cmd_tx);

        // Spawn decode thread
        let fft_sender = self.fft_sender.clone();
        let playback_state = self.playback_state.clone();
        let track_ended = self.track_ended_naturally.clone();
        let device_channels = self.device_channels;
        let device_sr = self.device_sample_rate;
        let path_owned = path.to_string();
        let app_handle = self.app_handle.clone();
        let seek_flush = self.seek_flush.clone();

        // Check if Symphonia can handle this codec, otherwise use ffmpeg fallback
        let symphonia_err = super::decoder::open_for_streaming(path).err();
        let use_ffmpeg = if symphonia_err.is_some() {
            if super::decoder::ffmpeg_available() {
                true
            } else {
                return Err(format!(
                    "Unsupported codec (install ffmpeg for ALAC/M4A support): {}",
                    symphonia_err.unwrap()
                ));
            }
        } else {
            false
        };

        let handle = std::thread::spawn(move || {
            if use_ffmpeg {
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
                );
            }
        });
        self.decode_handle = Some(handle);

        self.playback_state.store(STATE_PLAYING, Ordering::Relaxed);
        println!("Playback started (duration: {:.1}s)", duration);

        Ok(track_info)
    }

    pub fn pause(&mut self) -> Result<(), String> {
        if let Some(ref stream) = self.active_stream {
            stream
                .pause()
                .map_err(|e| format!("Failed to pause: {}", e))?;
            self.playback_state.store(STATE_PAUSED, Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn resume(&mut self) -> Result<(), String> {
        if let Some(ref stream) = self.active_stream {
            stream
                .play()
                .map_err(|e| format!("Failed to resume: {}", e))?;
            self.playback_state.store(STATE_PLAYING, Ordering::Relaxed);
        }
        Ok(())
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

    pub fn get_position_seconds(&self) -> f64 {
        let samples = self.samples_played.load(Ordering::Relaxed);
        if self.device_channels == 0 || self.device_sample_rate == 0 {
            return 0.0;
        }
        samples as f64 / (self.device_sample_rate as f64 * self.device_channels as f64)
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
) {
    let (mut format_reader, mut decoder, track_id, _sr, _ch) =
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
        push_to_ringbuf(output, &mut producer, &cmd_rx, &fft_sender, &playback_state);
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
) {
    println!("Streaming resample {}Hz → {}Hz", file_sr, device_sr);

    let (mut format_reader, mut decoder, track_id, _sr, _ch) =
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
                        push_to_ringbuf(&resampled, &mut producer, &cmd_rx, &fft_sender, &playback_state);
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
                    push_to_ringbuf(&resampled, &mut producer, &cmd_rx, &fft_sender, &playback_state);
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
) {
    use std::io::Read;

    let mut child = match super::decoder::open_ffmpeg_stream(path, device_sr, device_channels) {
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
                    match super::decoder::open_ffmpeg_stream_seeked(
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
                push_to_ringbuf(&sample_buf, &mut producer, &cmd_rx, &fft_sender, &playback_state);
            }
            Err(e) => {
                eprintln!("ffmpeg read error: {}", e);
                break;
            }
        }
    }

    let _ = child.wait();
}

/// Push a slice of samples to the ring buffer, waiting if full.
/// Also sends copies to the FFT thread.
/// Push samples to the ring buffer, waiting if full.
/// Only checks playback_state to bail out — does NOT consume commands from cmd_rx
/// (that's the caller's job, so seek commands aren't silently dropped).
fn push_to_ringbuf(
    samples: &[f32],
    producer: &mut ringbuf::HeapProd<f32>,
    _cmd_rx: &Receiver<DecodeCommand>,
    fft_sender: &Option<Sender<Vec<f32>>>,
    playback_state: &Arc<AtomicU8>,
) {
    let mut pos = 0;
    while pos < samples.len() {
        let state = playback_state.load(Ordering::Relaxed);
        if state == STATE_STOPPED {
            return;
        }

        let pushed = producer.push_slice(&samples[pos..]);
        if pushed == 0 {
            std::thread::sleep(std::time::Duration::from_millis(2));
            continue;
        }

        if let Some(ref fft_tx) = fft_sender {
            let _ = fft_tx.try_send(samples[pos..pos + pushed].to_vec());
        }

        pos += pushed;
    }
}

fn mono_to_stereo(mono: &[f32]) -> Vec<f32> {
    let mut stereo = Vec::with_capacity(mono.len() * 2);
    for &sample in mono {
        stereo.push(sample);
        stereo.push(sample);
    }
    stereo
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
