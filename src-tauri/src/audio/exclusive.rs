//! Windows exclusive-mode output (WASAPI).
//!
//! cpal only ever opens WASAPI in shared mode — `AUDCLNT_SHAREMODE_SHARED` is
//! hardcoded in its backend — so exclusive mode needs its own renderer. This is
//! a drop-in replacement for the cpal output stream: it consumes the same ring
//! buffer of interleaved f32, honours the same playback-state and seek-flush
//! flags, and advances the same sample counter. Everything upstream of it —
//! decode, resample, volume — is untouched.
//!
//! What it buys: the Windows audio engine is bypassed, so there is no mixing
//! and no sample-rate conversion behind our back. The engine asks for the
//! file's own rate, which is where the real win is — in shared mode every rate
//! is forced to the one mix format.
//!
//! All WASAPI work happens on the render thread. The COM objects are apartment
//! bound and not worth moving between threads, so `probe` spawns a short-lived
//! thread of its own rather than sharing a client with the renderer.

use ringbuf::traits::{Consumer, Observer};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use wasapi::{
    calculate_period_100ns, initialize_mta, Device, DeviceEnumerator, Direction, SampleType,
    StreamMode, WaveFormat,
};

use super::engine::STATE_PLAYING;

/// The format exclusive mode actually agreed to, which is not necessarily the
/// one we asked for.
#[derive(Clone, Copy, Debug)]
pub struct ExclusiveFormat {
    pub sample_rate: u32,
    pub channels: u16,
    /// Meaningful bits per sample — 24 for the common 24-in-32 case.
    pub valid_bits: u16,
}

/// One output endpoint, as offered in the settings dropdown.
#[derive(Clone, serde::Serialize)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// Formats to try, best first. Float is first because it is what the ring
/// buffer already holds; the integer forms cost a conversion but many DACs
/// refuse float in exclusive mode.
fn candidates() -> Vec<(usize, usize, SampleType)> {
    vec![
        (32, 32, SampleType::Float),
        (32, 32, SampleType::Int),
        (32, 24, SampleType::Int),
        (24, 24, SampleType::Int),
        (16, 16, SampleType::Int),
    ]
}

fn open_enumerator() -> Result<DeviceEnumerator, String> {
    // Returns S_FALSE if this thread is already initialized, which is fine.
    let _ = initialize_mta().ok();
    DeviceEnumerator::new().map_err(|e| format!("Failed to open device enumerator: {}", e))
}

fn find_device(enumerator: &DeviceEnumerator, id: Option<&str>) -> Result<Device, String> {
    let Some(id) = id else {
        return enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| format!("No default output device: {}", e));
    };

    let collection = enumerator
        .get_device_collection(&Direction::Render)
        .map_err(|e| format!("Failed to list output devices: {}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| format!("Failed to count output devices: {}", e))?;
    for i in 0..count {
        if let Ok(dev) = collection.get_device_at_index(i) {
            if dev.get_id().map(|d| d == id).unwrap_or(false) {
                return Ok(dev);
            }
        }
    }
    // A device that has been unplugged since it was chosen should not stop
    // playback — fall back rather than fail.
    enumerator
        .get_default_device(&Direction::Render)
        .map_err(|e| format!("Chosen device is gone and there is no default: {}", e))
}

/// Enumerate render endpoints for the settings dropdown.
pub fn list_devices() -> Result<Vec<OutputDevice>, String> {
    // Own thread so COM initialization does not leak into the caller's.
    std::thread::spawn(list_devices_inner)
        .join()
        .map_err(|_| "Device enumeration thread panicked".to_string())?
}

fn list_devices_inner() -> Result<Vec<OutputDevice>, String> {
    let enumerator = open_enumerator()?;
    let default_id = enumerator
        .get_default_device(&Direction::Render)
        .ok()
        .and_then(|d| d.get_id().ok());

    let collection = enumerator
        .get_device_collection(&Direction::Render)
        .map_err(|e| format!("Failed to list output devices: {}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| format!("Failed to count output devices: {}", e))?;

    let mut out = Vec::new();
    for i in 0..count {
        let Ok(dev) = collection.get_device_at_index(i) else {
            continue;
        };
        let (Ok(id), Ok(name)) = (dev.get_id(), dev.get_friendlyname()) else {
            continue;
        };
        let is_default = default_id.as_deref() == Some(id.as_str());
        out.push(OutputDevice {
            id,
            name,
            is_default,
        });
    }
    Ok(out)
}

/// Ask the device what it will accept at this rate, without committing to it.
/// Returns the negotiated format so the caller can size the ring buffer and
/// decide whether it still needs to resample.
pub fn probe(
    device_id: Option<String>,
    sample_rate: u32,
    channels: u16,
) -> Result<ExclusiveFormat, String> {
    std::thread::spawn(move || probe_inner(device_id.as_deref(), sample_rate, channels))
        .join()
        .map_err(|_| "Exclusive probe thread panicked".to_string())?
}

fn probe_inner(
    device_id: Option<&str>,
    sample_rate: u32,
    channels: u16,
) -> Result<ExclusiveFormat, String> {
    let enumerator = open_enumerator()?;
    let device = find_device(&enumerator, device_id)?;
    let client = device
        .get_iaudioclient()
        .map_err(|e| format!("Failed to open audio client: {}", e))?;

    for (store, valid, sample_type) in candidates() {
        let want = WaveFormat::new(
            store,
            valid,
            &sample_type,
            sample_rate as usize,
            channels as usize,
            None,
        );
        if let Ok(fmt) = client.is_supported_exclusive_with_quirks(&want) {
            return Ok(ExclusiveFormat {
                sample_rate: fmt.get_samplespersec(),
                channels: fmt.get_nchannels(),
                valid_bits: valid as u16,
            });
        }
    }
    Err(format!(
        "Device does not accept {} Hz / {} ch in exclusive mode",
        sample_rate, channels
    ))
}

/// A running exclusive stream. Dropping it stops playback and joins the thread.
pub struct ExclusiveStream {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ExclusiveStream {
    /// No-op: the render loop writes silence whenever playback_state is not
    /// PLAYING, so pausing needs no interaction with WASAPI. Starting and
    /// stopping the endpoint on every pause would risk losing it to another
    /// app mid-track.
    pub fn play(&self) -> Result<(), String> {
        Ok(())
    }
    pub fn pause(&self) -> Result<(), String> {
        Ok(())
    }
}

impl Drop for ExclusiveStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn open(
    device_id: Option<String>,
    sample_rate: u32,
    channels: u16,
    consumer: ringbuf::HeapCons<f32>,
    volume: Arc<AtomicU8>,
    samples_played: Arc<AtomicU64>,
    playback_state: Arc<AtomicU8>,
    seek_flush: Arc<AtomicBool>,
) -> Result<ExclusiveStream, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    let handle = std::thread::Builder::new()
        .name("wasapi-exclusive".into())
        .spawn(move || {
            let mut consumer = consumer;
            if let Err(e) = render_loop(
                device_id.as_deref(),
                sample_rate,
                channels,
                &mut consumer,
                &volume,
                &samples_played,
                &playback_state,
                &seek_flush,
                &stop_thread,
                &tx,
            ) {
                // If the open already succeeded the receiver is gone and this
                // is a no-op; the log is the only report left.
                eprintln!("Exclusive output stopped: {}", e);
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| format!("Failed to spawn exclusive render thread: {}", e))?;

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(ExclusiveStream {
            stop,
            handle: Some(handle),
        }),
        Ok(Err(e)) => {
            stop.store(true, Ordering::Release);
            let _ = handle.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Release);
            Err("Timed out opening the exclusive stream".to_string())
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn render_loop(
    device_id: Option<&str>,
    sample_rate: u32,
    channels: u16,
    consumer: &mut ringbuf::HeapCons<f32>,
    volume: &Arc<AtomicU8>,
    samples_played: &Arc<AtomicU64>,
    playback_state: &Arc<AtomicU8>,
    seek_flush: &Arc<AtomicBool>,
    stop: &Arc<AtomicBool>,
    ready: &mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let enumerator = open_enumerator()?;
    let device = find_device(&enumerator, device_id)?;
    let mut client = device
        .get_iaudioclient()
        .map_err(|e| format!("Failed to open audio client: {}", e))?;

    // Re-negotiate rather than carry a format over from probe(): these COM
    // objects belong to this thread.
    let mut chosen: Option<(WaveFormat, SampleType, usize)> = None;
    for (store, valid, sample_type) in candidates() {
        let want = WaveFormat::new(
            store,
            valid,
            &sample_type,
            sample_rate as usize,
            channels as usize,
            None,
        );
        if let Ok(fmt) = client.is_supported_exclusive_with_quirks(&want) {
            chosen = Some((fmt, sample_type, valid));
            break;
        }
    }
    let (format, sample_type, valid_bits) = chosen.ok_or_else(|| {
        format!(
            "Device does not accept {} Hz / {} ch in exclusive mode",
            sample_rate, channels
        )
    })?;

    let blockalign = format.get_blockalign() as usize;
    let store_bits = format.get_bitspersample() as usize;
    let out_channels = format.get_nchannels() as usize;
    let bytes_per_sample = blockalign / out_channels.max(1);

    let (_default_period, min_period) = client
        .get_device_period()
        .map_err(|e| format!("Failed to read device period: {}", e))?;
    // 1.5x the minimum: the smallest period is where exclusive mode is most
    // likely to glitch, and we are playing files, not monitoring live input.
    // 128-byte alignment keeps Intel HDA devices happy.
    let period = client
        .calculate_aligned_period_near(3 * min_period / 2, Some(128), &format)
        .map_err(|e| format!("Failed to align device period: {}", e))?;
    let mode = StreamMode::EventsExclusive { period_hns: period };

    if let Err(first) = client.initialize_client(&format, &Direction::Render, &mode) {
        // The documented recovery: ask what buffer size it actually wants,
        // rebuild the client, and initialize again at that period.
        let frames = client
            .get_buffer_size()
            .map_err(|_| format!("Exclusive init failed: {}", first))?;
        let aligned = calculate_period_100ns(frames as i64, format.get_samplespersec() as i64);
        client = device
            .get_iaudioclient()
            .map_err(|e| format!("Failed to reopen audio client: {}", e))?;
        client
            .initialize_client(
                &format,
                &Direction::Render,
                &StreamMode::EventsExclusive {
                    period_hns: aligned,
                },
            )
            .map_err(|e| format!("Exclusive init failed after realignment: {}", e))?;
    }

    let event = client
        .set_get_eventhandle()
        .map_err(|e| format!("Failed to get event handle: {}", e))?;
    let render_client = client
        .get_audiorenderclient()
        .map_err(|e| format!("Failed to get render client: {}", e))?;
    client
        .start_stream()
        .map_err(|e| format!("Failed to start exclusive stream: {}", e))?;

    println!(
        "Exclusive output: {} Hz, {} ch, {}-bit {} (period {} hns)",
        format.get_samplespersec(),
        out_channels,
        valid_bits,
        if matches!(sample_type, SampleType::Float) {
            "float"
        } else {
            "int"
        },
        period
    );
    let _ = ready.send(Ok(()));

    let mut scratch: Vec<f32> = Vec::new();
    let mut bytes: Vec<u8> = Vec::new();

    while !stop.load(Ordering::Acquire) {
        let frames = client
            .get_available_space_in_frames()
            .map_err(|e| format!("Failed to query buffer space: {}", e))?
            as usize;

        if frames > 0 {
            let samples = frames * out_channels;
            scratch.clear();
            scratch.resize(samples, 0.0);

            let state = playback_state.load(Ordering::Relaxed);
            let read = if state != STATE_PLAYING {
                0
            } else if seek_flush.load(Ordering::Acquire) {
                // Old pre-seek audio is stale — drop it and glide on silence.
                consumer.skip(consumer.occupied_len());
                0
            } else {
                consumer.pop_slice(&mut scratch)
            };
            // Volume is applied in the decode thread, same as the cpal path.
            let _ = volume.load(Ordering::Relaxed);

            bytes.clear();
            bytes.resize(samples * bytes_per_sample, 0);
            encode(
                &scratch,
                &mut bytes,
                bytes_per_sample,
                store_bits,
                valid_bits,
                matches!(sample_type, SampleType::Float),
            );

            render_client
                .write_to_device(frames, &bytes, None)
                .map_err(|e| format!("Failed to write to device: {}", e))?;

            samples_played.fetch_add(read as u64, Ordering::Relaxed);
        }

        // A timeout here means the driver stopped servicing us — bail rather
        // than spin forever holding an exclusive endpoint.
        if event.wait_for_event(2000).is_err() {
            let _ = client.stop_stream();
            return Err("Device stopped responding".to_string());
        }
    }

    let _ = client.stop_stream();
    Ok(())
}

/// Interleaved f32 in -1..1 to whatever the endpoint agreed to take.
fn encode(
    src: &[f32],
    dst: &mut [u8],
    bytes_per_sample: usize,
    store_bits: usize,
    valid_bits: usize,
    float: bool,
) {
    for (i, sample) in src.iter().enumerate() {
        let out = &mut dst[i * bytes_per_sample..(i + 1) * bytes_per_sample];
        let v = sample.clamp(-1.0, 1.0);
        if float {
            out.copy_from_slice(&v.to_le_bytes());
            continue;
        }
        match (store_bits, valid_bits) {
            // 24 meaningful bits left-aligned in a 32-bit container
            (32, 24) => {
                let scaled = (v * 8_388_607.0) as i32;
                out.copy_from_slice(&(scaled << 8).to_le_bytes());
            }
            (32, _) => {
                let scaled = (v as f64 * 2_147_483_647.0) as i32;
                out.copy_from_slice(&scaled.to_le_bytes());
            }
            (24, _) => {
                let scaled = (v * 8_388_607.0) as i32;
                out.copy_from_slice(&scaled.to_le_bytes()[..3]);
            }
            (16, _) => {
                let scaled = (v * 32_767.0) as i16;
                out.copy_from_slice(&scaled.to_le_bytes());
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercises COM init, device enumeration and format negotiation against
    /// the real machine. Neither call opens the endpoint — IsFormatSupported
    /// only asks — so this is safe to run while something else is playing.
    /// Ignored by default because it needs audio hardware to mean anything.
    #[test]
    #[ignore]
    fn enumerates_and_negotiates() {
        let devices = list_devices().expect("device enumeration failed");
        assert!(!devices.is_empty(), "no render endpoints found");
        for d in &devices {
            println!("device: {} {}", d.name, if d.is_default { "(default)" } else { "" });
        }

        for rate in [44100u32, 48000, 88200, 96000, 176400, 192000, 352800] {
            match probe(None, rate, 2) {
                Ok(f) => println!(
                    "  {} Hz -> accepted as {} Hz / {} ch / {}-bit",
                    rate, f.sample_rate, f.channels, f.valid_bits
                ),
                Err(e) => println!("  {} Hz -> {}", rate, e),
            }
        }
    }
}
