pub mod decoder;
pub mod engine;
/// Exclusive-mode output is a WASAPI concept — there is nothing to build on
/// other platforms, and cpal shared mode remains the only path there.
#[cfg(windows)]
pub mod exclusive;
pub mod fft;
pub mod ffmpeg;
pub mod metadata;
pub mod output;
pub mod resampler;
pub mod waveform;
