use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use ringbuf::traits::{Consumer, Observer};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use super::engine::STATE_PLAYING;

/// Query the default output device's preferred sample rate and channel count.
pub fn get_device_sample_rate() -> Result<(cpal::Device, u32, u16), String> {
    open_device_by_id(None)
}

/// Resolve an output device by its cpal id, falling back to the default.
///
/// The id is stable across reboots and reconnections, and on Windows it is
/// `IMMDevice::GetId()` — byte-identical to what the WASAPI enumeration
/// reports. That is what lets one picker drive both the shared and exclusive
/// paths with no translation between them. On ALSA it is the pcm id.
///
/// An id that no longer matches anything — the interface was unplugged, or the
/// selection came from another machine — falls back to the default rather than
/// refusing to play.
pub fn open_device_by_id(id: Option<&str>) -> Result<(cpal::Device, u32, u16), String> {
    let host = cpal::default_host();

    let device = id
        .and_then(|want| host.device_by_id(&cpal::DeviceId(host.id(), want.to_string())))
        .or_else(|| host.default_output_device())
        .ok_or_else(|| "No output audio device found".to_string())?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get output config: {}", e))?;

    Ok((device, config.sample_rate(), config.channels()))
}

/// Output devices cpal can see, as (id, name, is_default).
///
/// Windows enumerates through WASAPI instead — same ids, but it also reports
/// endpoint state, so it can leave out unplugged devices. This is dead there.
///
/// On PipeWire and PulseAudio systems the list includes the server's own
/// virtual devices alongside the raw ALSA ones, which is what those users
/// expect to pick from.
#[cfg(not(windows))]
pub fn list_cpal_outputs() -> Vec<(String, String, bool)> {
    let host = cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|d| d.id().ok())
        .map(|d| d.1);

    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|d| {
            let id = d.id().ok()?.1;
            let name = d
                .description()
                .map(|desc| desc.name().to_string())
                .unwrap_or_else(|_| id.clone());
            let is_default = default_id.as_deref() == Some(id.as_str());
            Some((id, name, is_default))
        })
        .collect()
}

/// Build output stream with dynamic volume and position tracking.
pub fn build_output_stream(
    device: &cpal::Device,
    sample_rate: u32,
    channels: u16,
    mut consumer: ringbuf::HeapCons<f32>,
    volume: Arc<AtomicU8>,
    samples_played: Arc<AtomicU64>,
    playback_state: Arc<AtomicU8>,
    seek_flush: Arc<AtomicBool>,
) -> Result<Stream, String> {
    let config = StreamConfig {
        channels,
        sample_rate,
        buffer_size: cpal::BufferSize::Default,
    };

    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let state = playback_state.load(Ordering::Relaxed);
                if state != STATE_PLAYING {
                    for sample in data.iter_mut() {
                        *sample = 0.0;
                    }
                    return;
                }

                // During seek, discard any old buffered data and output silence
                if seek_flush.load(Ordering::Acquire) {
                    // Drain whatever is in the ring buffer (old pre-seek data)
                    consumer.skip(consumer.occupied_len());
                    for sample in data.iter_mut() {
                        *sample = 0.0;
                    }
                    return;
                }

                let read = consumer.pop_slice(data);

                // Volume is applied in the decode thread before pushing to ring buffer.
                // This callback just reads and writes — no processing.
                let _ = volume.load(Ordering::Relaxed); // keep the Arc alive
                for sample in &mut data[read..] {
                    *sample = 0.0;
                }

                samples_played.fetch_add(read as u64, Ordering::Relaxed);
            },
            |err| {
                eprintln!("Audio output error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build output stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start playback: {}", e))?;

    Ok(stream)
}

#[cfg(test)]
mod tests {
    /// The picker stores one id and both output paths resolve it: the WASAPI
    /// enumeration on the exclusive side, cpal on the shared side. That only
    /// works because both report `IMMDevice::GetId()` verbatim. If that ever
    /// stops being true the shared path silently ignores the picker and plays
    /// out of the default device instead, which is close to impossible to spot
    /// by ear. Needs real hardware, so it is not part of the default run.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn wasapi_and_cpal_agree_on_device_ids() {
        let listed = crate::audio::exclusive::list_devices().expect("enumeration failed");
        assert!(!listed.is_empty(), "no render endpoints");

        for d in &listed {
            let resolved = super::open_device_by_id(Some(&d.id));
            assert!(
                resolved.is_ok(),
                "cpal could not resolve the WASAPI id for {}: {:?}",
                d.name,
                resolved.err()
            );
            let (dev, rate, ch) = resolved.unwrap();
            use cpal::traits::DeviceTrait;
            let back = dev.id().expect("device has no id").1;
            assert_eq!(back, d.id, "cpal resolved {} to a different device", d.name);
            println!("{} -> {} Hz / {} ch  id={}", d.name, rate, ch, d.id);
        }
    }
}
