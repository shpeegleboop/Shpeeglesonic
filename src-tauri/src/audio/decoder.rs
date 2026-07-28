use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::audio::ffmpeg::{self, ProbeInfo};

/// Decoded audio data: interleaved f32 samples, sample rate, and channel count.
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Open a file, build its decoder, and report what it contains.
///
/// This is the single symphonia entry point: it opens the file exactly once and
/// derives every field from the one header parse. There used to be a separate
/// `probe_file_info` that opened and parsed the file a second time on every
/// play, purely to read values already sitting in `codec_params` here.
pub fn open_for_streaming(
    path: &str,
) -> Result<
    (
        Box<dyn symphonia::core::formats::FormatReader>,
        Box<dyn symphonia::core::codecs::Decoder>,
        u32, // track_id
        ProbeInfo,
    ),
    String,
> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe format: {}", e))?;

    let format_reader = probed.format;

    let track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let codec_params = track.codec_params.clone();
    let track_id = track.id;

    let sample_rate = codec_params.sample_rate.ok_or("Unknown sample rate")?;
    let channels = codec_params
        .channels
        .map(|c| c.count() as u16)
        .unwrap_or(2);
    let duration_seconds = codec_params
        .n_frames
        .map(|n| n as f64 / sample_rate as f64)
        .unwrap_or(0.0);
    let bit_depth = codec_params.bits_per_sample.map(|b| b as u32);

    let decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    let info = ProbeInfo {
        sample_rate,
        channels,
        duration_seconds,
        bit_depth,
        bitrate: None, // not reliably available from codec params
    };

    Ok((format_reader, decoder, track_id, info))
}

/// Which decoder actually handles a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Symphonia,
    Ffmpeg,
}

/// The backend rule, with I/O hoisted out so every branch is testable.
/// ffmpeg is consulted only when symphonia fails, and its probe stays lazy.
pub(crate) fn decide(
    symphonia: Result<ProbeInfo, String>,
    ffmpeg_probe: impl FnOnce() -> Result<ProbeInfo, String>,
) -> Result<(Backend, ProbeInfo), String> {
    match symphonia {
        Ok(info) => Ok((Backend::Symphonia, info)),
        Err(sym_err) => match ffmpeg_probe() {
            Ok(info) => Ok((Backend::Ffmpeg, info)),
            Err(ff_err) => Err(format!(
                "Cannot play this file. symphonia: {} / ffmpeg: {}",
                sym_err, ff_err
            )),
        },
    }
}

/// One decision, made once, shared by probe and decode.
///
/// The bug this closes: `load_and_play` used to probe with symphonia and return
/// early on failure, so the ffmpeg fallback further down was unreachable for any
/// format symphonia cannot demux at all — every DSD file, and `.wma`. Formats it
/// can demux but not decode (Opus in Ogg) already reached the fallback, which is
/// why `.opus` worked and `.wma` did not.
pub fn choose_backend(path: &str) -> Result<(Backend, ProbeInfo), String> {
    let owned = path.to_string();
    decide(open_for_streaming(path).map(|(_, _, _, info)| info), move || {
        if !ffmpeg::is_available() {
            return Err("this build is missing its extended codec support. \
                        Reinstall the app, or put ffmpeg on your PATH"
                .to_string());
        }
        ffmpeg::probe(&owned)
    })
}

/// Decode an audio file at the given path into interleaved f32 PCM samples.
/// Used as fallback when resampling is needed.
pub fn decode_file(path: &str) -> Result<DecodedAudio, String> {
    let (mut format_reader, mut decoder, track_id, info) = open_for_streaming(path)?;
    let (sample_rate, channels) = (info.sample_rate, info.channels);

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format_reader.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(format!("Error reading packet: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                eprintln!("Decode error (skipping packet): {}", e);
                continue;
            }
            Err(e) => return Err(format!("Fatal decode error: {}", e)),
        };

        append_samples(&decoded, &mut all_samples, channels);
    }

    Ok(DecodedAudio {
        samples: all_samples,
        sample_rate,
        channels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
    }

    #[test]
    fn probes_aiff_natively() {
        let (_, _, _, info) =
            open_for_streaming(&fixture("tone.aiff")).expect("AIFF probe should succeed");
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert!(
            (info.duration_seconds - 0.5).abs() < 0.05,
            "expected ~0.5s duration, got {}",
            info.duration_seconds
        );
    }

    #[test]
    fn decodes_aiff_natively() {
        let audio = decode_file(&fixture("tone.aiff")).expect("AIFF decode should succeed");
        assert_eq!(audio.sample_rate, 44100);
        assert_eq!(audio.channels, 2);
        let expected = 44100.0 * 0.5 * 2.0;
        assert!(
            (audio.samples.len() as f64 - expected).abs() < expected * 0.05,
            "expected ~{} samples, got {}",
            expected,
            audio.samples.len()
        );
    }

    #[test]
    fn probes_alac_natively() {
        let (_, _, _, info) =
            open_for_streaming(&fixture("tone-alac.m4a")).expect("ALAC probe should succeed");
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert!(
            (info.duration_seconds - 0.5).abs() < 0.05,
            "expected ~0.5s duration, got {}",
            info.duration_seconds
        );
    }

    fn info(sr: u32) -> ProbeInfo {
        ProbeInfo {
            sample_rate: sr,
            channels: 2,
            duration_seconds: 1.0,
            bit_depth: Some(16),
            bitrate: None,
        }
    }

    #[test]
    fn prefers_symphonia_when_it_can_handle_the_file() {
        let (backend, got) =
            decide(Ok(info(44100)), || panic!("ffmpeg must not be probed")).expect("should succeed");
        assert_eq!(backend, Backend::Symphonia);
        assert_eq!(got.sample_rate, 44100);
    }

    #[test]
    fn falls_through_to_ffmpeg_when_symphonia_cannot_demux() {
        let (backend, got) =
            decide(Err("no ASF demuxer".into()), || Ok(info(2822400))).expect("should succeed");
        assert_eq!(backend, Backend::Ffmpeg);
        assert_eq!(
            got.sample_rate, 2822400,
            "the native rate must survive, not the device rate"
        );
    }

    #[test]
    fn reports_both_reasons_when_neither_backend_works() {
        let err =
            decide(Err("symphonia said no".into()), || Err("ffmpeg said no".into())).unwrap_err();
        assert!(err.contains("symphonia said no"), "got: {}", err);
        assert!(err.contains("ffmpeg said no"), "got: {}", err);
    }

    #[test]
    fn native_formats_do_not_regress_to_ffmpeg() {
        let (backend, _) = choose_backend(&fixture("tone.aiff")).expect("AIFF should still work");
        assert_eq!(backend, Backend::Symphonia, "AIFF must stay on the native path");
    }

    fn ffmpeg_or_skip() -> bool {
        if ffmpeg::is_available() {
            return true;
        }
        eprintln!("skipping: no ffmpeg available");
        false
    }

    const DSD_RATE: u32 = 2822400; // DSD64
    const DSD_BLOCK: u32 = 4096; // bytes per channel per block, fixed by the spec

    /// One-bit sigma-delta modulation of a sine, packed LSB-first.
    ///
    /// A constant byte pattern would not do: 0x69 is a ~1.4MHz square wave that
    /// the decoder's decimation filter removes entirely, so the fixture would
    /// decode to silence and a test asserting "it played" would pass on nothing.
    /// This produces a genuinely audible tone instead.
    fn dsd_modulate_sine(freq: f64, bytes: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(bytes);
        let mut acc = 0.0f64;
        let mut n = 0u64;
        for _ in 0..bytes {
            let mut byte = 0u8;
            for bit in 0..8 {
                let t = n as f64 / f64::from(DSD_RATE);
                let target = 0.5 * (std::f64::consts::TAU * freq * t).sin();
                let high = acc >= 0.0;
                // Feedback: +1 for a set bit, -1 for a clear one.
                acc += target - if high { 1.0 } else { -1.0 };
                if high {
                    byte |= 1 << bit; // LSB-first, matching dsd_lsbf
                }
                n += 1;
            }
            out.push(byte);
        }
        out
    }

    /// Write a valid stereo DSF. ffmpeg *decodes* DSD but has no DSD encoder, so
    /// this fixture has to be authored rather than generated — which also leaves
    /// it free of any external dependency.
    ///
    /// Layout: 28-byte `DSD ` chunk, 52-byte `fmt ` chunk, then `data` holding
    /// per-channel blocks of DSD_BLOCK bytes, interleaved block-by-block.
    fn write_minimal_dsf(path: &std::path::Path, blocks: u32) {
        use std::io::Write;

        const CHANNELS: u32 = 2;
        let per_channel = (DSD_BLOCK * blocks) as usize;

        // Slightly different pitches per channel, so a channel mix-up is audible.
        let left = dsd_modulate_sine(440.0, per_channel);
        let right = dsd_modulate_sine(554.37, per_channel);

        let data_bytes = u64::from(DSD_BLOCK * CHANNELS * blocks);
        let sample_count = u64::from(DSD_BLOCK * blocks) * 8;
        let fmt_len: u64 = 52;
        let data_len: u64 = 12 + data_bytes;
        let total: u64 = 28 + fmt_len + data_len;

        let mut f = std::fs::File::create(path).expect("create dsf");
        f.write_all(b"DSD ").unwrap();
        f.write_all(&28u64.to_le_bytes()).unwrap();
        f.write_all(&total.to_le_bytes()).unwrap();
        f.write_all(&0u64.to_le_bytes()).unwrap(); // no metadata pointer

        f.write_all(b"fmt ").unwrap();
        f.write_all(&fmt_len.to_le_bytes()).unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap(); // version
        f.write_all(&0u32.to_le_bytes()).unwrap(); // format id: DSD raw
        f.write_all(&2u32.to_le_bytes()).unwrap(); // channel type: stereo
        f.write_all(&CHANNELS.to_le_bytes()).unwrap();
        f.write_all(&DSD_RATE.to_le_bytes()).unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap(); // bits per sample
        f.write_all(&sample_count.to_le_bytes()).unwrap();
        f.write_all(&DSD_BLOCK.to_le_bytes()).unwrap();
        f.write_all(&0u32.to_le_bytes()).unwrap(); // reserved

        f.write_all(b"data").unwrap();
        f.write_all(&data_len.to_le_bytes()).unwrap();
        let b = DSD_BLOCK as usize;
        for i in 0..blocks as usize {
            f.write_all(&left[i * b..(i + 1) * b]).unwrap();
            f.write_all(&right[i * b..(i + 1) * b]).unwrap();
        }
    }

    #[test]
    fn dsf_routes_to_ffmpeg_at_its_native_rate() {
        if !ffmpeg_or_skip() {
            return;
        }
        let path = std::env::temp_dir().join("shpeegle-test-tone.dsf");
        write_minimal_dsf(&path, 8);

        let (backend, info) =
            choose_backend(path.to_str().unwrap()).expect("DSF should be playable via ffmpeg");

        assert_eq!(backend, Backend::Ffmpeg, "symphonia cannot demux DSD");
        assert_eq!(info.sample_rate, 2822400, "must report the native DSD rate");
        assert_eq!(info.channels, 2);

        let _ = std::fs::remove_file(&path);
    }

    /// Probing only proves the header was read. This runs the DSF through the
    /// exact pipeline playback uses and checks real audio comes out — the one
    /// test that would catch ffmpeg decoding DSD to silence.
    #[test]
    fn dsf_decodes_to_audible_pcm() {
        if !ffmpeg_or_skip() {
            return;
        }
        use std::io::Read;

        let path = std::env::temp_dir().join("shpeegle-audible-tone.dsf");
        write_minimal_dsf(&path, 64);

        let mut child = ffmpeg::open_stream(path.to_str().unwrap(), 44100, 2)
            .expect("ffmpeg should decode the DSF");
        let mut raw = Vec::new();
        child
            .stdout
            .take()
            .expect("stdout")
            .read_to_end(&mut raw)
            .expect("read pcm");
        let _ = child.wait();

        let samples: Vec<f32> = raw
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        assert!(!samples.is_empty(), "decoded no PCM at all");

        let rms = (samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>()
            / samples.len() as f64)
            .sqrt();
        assert!(
            rms > 0.01,
            "DSF decoded to near-silence (rms {rms:.5}) — the modulation or bit \
             order is wrong, even though the header parsed fine"
        );

        let _ = std::fs::remove_file(&path);
    }

    /// Writes a playable DSF somewhere you can point the app at, for testing in
    /// the real UI. ffmpeg has no DSD encoder, so this is the only way to get
    /// one without a genuine SACD rip.
    ///
    ///   SHPEEGLE_DSF_OUT=D:\path\tone.dsf cargo test --lib write_dsf_fixture -- --ignored
    #[test]
    #[ignore]
    fn write_dsf_fixture() {
        let out = std::env::var("SHPEEGLE_DSF_OUT")
            .expect("set SHPEEGLE_DSF_OUT to the .dsf path to write");
        // ~5 seconds: 352800 bytes per channel per second / 4096 per block.
        write_minimal_dsf(std::path::Path::new(&out), 431);
        println!("wrote {}", out);
    }

    #[test]
    fn wavpack_is_playable() {
        if !ffmpeg_or_skip() {
            return;
        }
        let (_, info) = choose_backend(&fixture("tone.wv")).expect("WavPack should be playable");
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert!((info.duration_seconds - 0.5).abs() < 0.05);
    }

    #[test]
    fn true_audio_is_playable() {
        if !ffmpeg_or_skip() {
            return;
        }
        let (_, info) = choose_backend(&fixture("tone.tta")).expect("TTA should be playable");
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
    }

    #[test]
    fn decodes_alac_natively() {
        let audio = decode_file(&fixture("tone-alac.m4a")).expect("ALAC decode should succeed");
        assert_eq!(audio.sample_rate, 44100);
        assert_eq!(audio.channels, 2);
        let expected = 44100.0 * 0.5 * 2.0;
        assert!(
            (audio.samples.len() as f64 - expected).abs() < expected * 0.05,
            "expected ~{} samples, got {}",
            expected,
            audio.samples.len()
        );
    }
}

/// Convert an AudioBufferRef to interleaved f32 samples and append to output.
pub fn append_samples(buf: &AudioBufferRef, output: &mut Vec<f32>, channels: u16) {
    let ch = channels as usize;
    match buf {
        AudioBufferRef::F32(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    output.push(*b.chan(c).get(frame).unwrap_or(&0.0));
                }
            }
        }
        AudioBufferRef::S32(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    let sample = *b.chan(c).get(frame).unwrap_or(&0);
                    output.push(sample as f32 / 2147483648.0);
                }
            }
        }
        AudioBufferRef::S16(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    let sample = *b.chan(c).get(frame).unwrap_or(&0);
                    output.push(sample as f32 / 32768.0);
                }
            }
        }
        AudioBufferRef::U8(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    let sample = *b.chan(c).get(frame).unwrap_or(&128);
                    output.push((sample as f32 - 128.0) / 128.0);
                }
            }
        }
        _ => {
            eprintln!("Unsupported sample format, skipping buffer");
        }
    }
}
