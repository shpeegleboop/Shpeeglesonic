use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use ringbuf::traits::{Consumer, Observer};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use super::engine::STATE_PLAYING;

/// Query the default output device's preferred sample rate and channel count.
pub fn get_device_sample_rate() -> Result<(cpal::Device, u32, u16), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No output audio device found".to_string())?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get output config: {}", e))?;

    let sample_rate = config.sample_rate();
    let channels = config.channels();

    Ok((device, sample_rate, channels))
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
