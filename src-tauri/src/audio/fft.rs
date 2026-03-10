use crossbeam_channel::Receiver;
use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use tauri::Emitter;

use super::engine::{STATE_PLAYING, STATE_STOPPED};

const FFT_SIZE: usize = 2048;
const OUTPUT_BINS: usize = 1024;

#[derive(Clone, serde::Serialize)]
struct FftPayload {
    bins: Vec<u8>,
    rms: f32,
    time: f64,
}

/// Spawn the FFT analysis thread. Returns the sender for audio data.
pub fn spawn_fft_thread(
    app_handle: tauri::AppHandle,
    samples_played: Arc<AtomicU64>,
    playback_state: Arc<AtomicU8>,
    track_ended_naturally: Arc<std::sync::atomic::AtomicBool>,
    device_sample_rate: u32,
    device_channels: u16,
) -> crossbeam_channel::Sender<Vec<f32>> {
    let (tx, rx) = crossbeam_channel::bounded::<Vec<f32>>(64);

    std::thread::spawn(move || {
        fft_loop(
            rx,
            app_handle,
            samples_played,
            playback_state,
            track_ended_naturally,
            device_sample_rate,
            device_channels,
        );
    });

    tx
}

fn fft_loop(
    rx: Receiver<Vec<f32>>,
    app_handle: tauri::AppHandle,
    samples_played: Arc<AtomicU64>,
    playback_state: Arc<AtomicU8>,
    track_ended_naturally: Arc<std::sync::atomic::AtomicBool>,
    device_sample_rate: u32,
    device_channels: u16,
) {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);

    let mut accumulator: Vec<f32> = Vec::with_capacity(FFT_SIZE * 2);
    let mut smoothed_bins: Vec<f32> = vec![0.0; OUTPUT_BINS];
    let smoothing = 0.3f32;

    // Emit at ~60Hz
    let emit_interval = std::time::Duration::from_millis(16);
    let mut last_emit = std::time::Instant::now();
    let mut prev_state = STATE_STOPPED;

    // Hann window
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| {
            0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos())
        })
        .collect();

    loop {
        // Drain ALL available audio data from channel (don't let it back up)
        let mut got_data = false;
        loop {
            match rx.try_recv() {
                Ok(chunk) => {
                    got_data = true;
                    let ch = device_channels as usize;
                    for frame_start in (0..chunk.len()).step_by(ch) {
                        let mut sum = 0.0f32;
                        for c in 0..ch.min(chunk.len() - frame_start) {
                            sum += chunk[frame_start + c];
                        }
                        accumulator.push(sum / ch as f32);
                    }
                }
                Err(_) => break,
            }
        }
        // If no data available, wait briefly to avoid busy-spinning
        if !got_data {
            match rx.recv_timeout(std::time::Duration::from_millis(4)) {
                Ok(chunk) => {
                    let ch = device_channels as usize;
                    for frame_start in (0..chunk.len()).step_by(ch) {
                        let mut sum = 0.0f32;
                        for c in 0..ch.min(chunk.len() - frame_start) {
                            sum += chunk[frame_start + c];
                        }
                        accumulator.push(sum / ch as f32);
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            }
        }

        let state = playback_state.load(Ordering::Relaxed);

        // Detect natural track end: was playing, now stopped, flag is set
        if prev_state == STATE_PLAYING && state == STATE_STOPPED
            && track_ended_naturally.load(Ordering::Relaxed)
        {
            track_ended_naturally.store(false, Ordering::Relaxed);
            let _ = app_handle.emit("track-ended", ());
        }
        prev_state = state;

        if state == STATE_STOPPED && rx.is_empty() {
            // Send zero bins when stopped
            let payload = FftPayload {
                bins: vec![0u8; OUTPUT_BINS],
                rms: 0.0,
                time: 0.0,
            };
            let _ = app_handle.emit("fft-data", &payload);
            std::thread::sleep(std::time::Duration::from_millis(100));
            accumulator.clear();
            continue;
        }

        // Only emit at ~60Hz
        if last_emit.elapsed() < emit_interval {
            continue;
        }

        if accumulator.len() >= FFT_SIZE {
            // Take the last FFT_SIZE samples
            let start = accumulator.len() - FFT_SIZE;
            let samples = &accumulator[start..start + FFT_SIZE];

            // Compute RMS
            let rms = (samples.iter().map(|s| s * s).sum::<f32>() / FFT_SIZE as f32).sqrt();

            // Apply window and prepare complex buffer
            let mut buffer: Vec<Complex<f32>> = samples
                .iter()
                .zip(window.iter())
                .map(|(&s, &w)| Complex::new(s * w, 0.0))
                .collect();

            fft.process(&mut buffer);

            // Compute magnitudes for first half (Nyquist)
            let raw_bins: Vec<f32> = buffer[..OUTPUT_BINS]
                .iter()
                .map(|c| c.norm() / FFT_SIZE as f32)
                .collect();

            // Apply smoothing
            for i in 0..OUTPUT_BINS {
                smoothed_bins[i] = smoothed_bins[i] * smoothing + raw_bins[i] * (1.0 - smoothing);
            }

            // Normalize to 0-255
            let max_val = smoothed_bins
                .iter()
                .cloned()
                .fold(0.001f32, f32::max);
            let bins: Vec<u8> = smoothed_bins
                .iter()
                .map(|&v| ((v / max_val) * 255.0).min(255.0) as u8)
                .collect();

            // Get current position
            let total_samples = samples_played.load(Ordering::Relaxed);
            let time = if device_channels > 0 && device_sample_rate > 0 {
                total_samples as f64
                    / (device_sample_rate as f64 * device_channels as f64)
            } else {
                0.0
            };

            let payload = FftPayload { bins, rms, time };
            let _ = app_handle.emit("fft-data", &payload);

            // Keep only the last FFT_SIZE samples in accumulator
            accumulator.drain(..start);

            last_emit = std::time::Instant::now();
        }
    }
}
