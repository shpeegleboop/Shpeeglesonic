use std::io::Read;
use std::process::Stdio;

use super::ffmpeg;

/// Per-channel peak envelope for a whole track, 0-255 per bucket.
#[derive(serde::Serialize)]
pub struct WaveformOverview {
    pub left: Vec<u8>,
    pub right: Vec<u8>,
}

/// Sample rate we decode the overview at. A visual envelope needs nothing like
/// full rate, and dropping to 8kHz cuts both the decode and the pipe by orders
/// of magnitude — a five-minute track streams ~19MB instead of ~250MB.
const OVERVIEW_RATE: u32 = 8000;

/// Peak amplitude per bucket for both channels.
///
/// Always goes through the bundled ffmpeg rather than symphonia, for two
/// reasons: one code path covers every format the player accepts, including the
/// DSD and WMA files symphonia cannot decode; and ffmpeg can resample during
/// the decode, so we never hold a whole song of PCM in memory. Peaks are
/// accumulated as the bytes stream in.
pub fn overview(path: &str, buckets: usize) -> Result<WaveformOverview, String> {
    let buckets = buckets.clamp(16, 8000);

    // Duration first: it tells us how many frames to expect, which is what
    // makes a single streaming pass possible instead of buffering everything
    // to find out how long it was.
    let info = ffmpeg::probe(path)?;
    if !(info.duration_seconds > 0.0) {
        return Err("unknown duration".to_string());
    }

    let bin = ffmpeg::resolve(ffmpeg::Tool::Ffmpeg)
        .ok_or_else(|| "ffmpeg is not available".to_string())?;

    let mut child = std::process::Command::new(bin)
        .args([
            "-i", path,
            "-f", "f32le",
            "-acodec", "pcm_f32le",
            "-ar", &OVERVIEW_RATE.to_string(),
            "-ac", "2",
            "-v", "quiet",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("ffmpeg: no stdout")?;

    let expected_frames = (info.duration_seconds * OVERVIEW_RATE as f64).max(1.0);
    let per_bucket = (expected_frames / buckets as f64).ceil().max(1.0) as usize;

    let mut left = vec![0f32; buckets];
    let mut right = vec![0f32; buckets];

    let mut buf = vec![0u8; 64 * 1024];
    // Frames can straddle a read boundary, so keep the remainder between reads.
    let mut carry: Vec<u8> = Vec::with_capacity(8);
    let mut frame_index: usize = 0;

    loop {
        let n = match stdout.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("ffmpeg read error: {}", e));
            }
        };

        let mut chunk: &[u8] = &buf[..n];
        let mut joined;
        if !carry.is_empty() {
            joined = std::mem::take(&mut carry);
            joined.extend_from_slice(chunk);
            chunk = &joined[..];
        }

        // 8 bytes per stereo frame: two f32le samples.
        let usable = chunk.len() - (chunk.len() % 8);
        for f in chunk[..usable].chunks_exact(8) {
            let l = f32::from_le_bytes([f[0], f[1], f[2], f[3]]).abs();
            let r = f32::from_le_bytes([f[4], f[5], f[6], f[7]]).abs();
            let b = (frame_index / per_bucket).min(buckets - 1);
            if l > left[b] {
                left[b] = l;
            }
            if r > right[b] {
                right[b] = r;
            }
            frame_index += 1;
        }
        carry.extend_from_slice(&chunk[usable..]);
    }

    let _ = child.wait();

    if frame_index == 0 {
        return Err("ffmpeg produced no audio".to_string());
    }

    // If the real track ran shorter than the probe suggested, the tail buckets
    // were never written — trim them rather than drawing phantom silence.
    let filled = ((frame_index + per_bucket - 1) / per_bucket).min(buckets);

    let to_u8 = |v: &[f32]| -> Vec<u8> {
        v[..filled]
            .iter()
            .map(|s| (s.clamp(0.0, 1.0) * 255.0).round() as u8)
            .collect()
    };

    Ok(WaveformOverview {
        left: to_u8(&left),
        right: to_u8(&right),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
    }

    #[test]
    fn builds_an_envelope_for_a_real_file() {
        if ffmpeg::resolve(ffmpeg::Tool::Ffmpeg).is_none() {
            eprintln!("skipping: no ffmpeg available");
            return;
        }
        let ov = overview(&fixture("tone.aiff"), 64).expect("should build an overview");
        assert_eq!(ov.left.len(), ov.right.len());
        assert!(!ov.left.is_empty());
        // tone.aiff is a steady 0.5s sine, so every bucket should carry signal.
        assert!(
            ov.left.iter().all(|&v| v > 20),
            "expected a sustained tone, got {:?}",
            ov.left
        );
    }

    #[test]
    fn reports_an_error_for_a_file_ffmpeg_cannot_read() {
        if ffmpeg::resolve(ffmpeg::Tool::Ffmpeg).is_none() {
            return;
        }
        let path = std::env::temp_dir().join("shpeegle-not-audio.flac");
        std::fs::write(&path, b"definitely not a flac").unwrap();
        assert!(overview(path.to_str().unwrap(), 64).is_err());
        let _ = std::fs::remove_file(&path);
    }
}
