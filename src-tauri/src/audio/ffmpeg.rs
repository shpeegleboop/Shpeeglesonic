//! Locating and driving the ffmpeg/ffprobe sidecars.
//!
//! Everything that shells out to ffmpeg lives here so `decoder.rs` stays about
//! symphonia. Resolution is cached for the life of the process — the old
//! `ffmpeg_available()` spawned a process on *every* play.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    fn stem(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
        }
    }
}

/// Policy, separated from I/O so the ordering rule is testable without a
/// filesystem: the first candidate that exists wins.
pub fn pick_first_present(
    candidates: &[PathBuf],
    present: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    candidates.iter().find(|c| present(c)).cloned()
}

fn candidates_for(tool: Tool) -> Vec<PathBuf> {
    let mut out = Vec::new();

    // 1. Bundled sidecar, next to our own executable. Known version, known
    //    capabilities — this is what ships to people who have never heard of
    //    ffmpeg.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join(format!("{}.exe", tool.stem())));
            out.push(dir.join(tool.stem()));
        }
    }

    // 2. PATH. Covers `tauri dev`, where sidecars are not staged next to the
    //    debug binary, and lets a power user substitute their own build.
    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            out.push(dir.join(format!("{}.exe", tool.stem())));
            out.push(dir.join(tool.stem()));
        }
    }

    out
}

/// Resolved once per process. `None` means neither a bundled sidecar nor a PATH
/// install exists; callers degrade gracefully rather than failing outright.
pub fn resolve(tool: Tool) -> Option<&'static Path> {
    static FFMPEG: OnceLock<Option<PathBuf>> = OnceLock::new();
    static FFPROBE: OnceLock<Option<PathBuf>> = OnceLock::new();

    let slot = match tool {
        Tool::Ffmpeg => &FFMPEG,
        Tool::Ffprobe => &FFPROBE,
    };
    slot.get_or_init(|| pick_first_present(&candidates_for(tool), &|p| p.is_file()))
        .as_deref()
}

pub fn is_available() -> bool {
    resolve(Tool::Ffmpeg).is_some()
}

/// The `-f f32le` output format name is ffmpeg's *runtime* name for the raw PCM
/// muxer; at configure time the same muxer is called `pcm_f32le`. See
/// scripts/ffmpeg/build.sh.
fn stream_args(path: &str, sr: u32, ch: u16) -> Vec<String> {
    vec![
        "-i".into(),
        path.into(),
        "-f".into(),
        "f32le".into(),
        "-acodec".into(),
        "pcm_f32le".into(),
        "-ar".into(),
        sr.to_string(),
        "-ac".into(),
        ch.to_string(),
        "-v".into(),
        "quiet".into(),
        "-".into(),
    ]
}

/// Spawn ffmpeg to decode a file to raw f32le PCM at the given rate/channels.
/// ffmpeg performs the rate conversion itself, so this branch never needs the
/// resampler — which is also why DSD's 2.8MHz source rate costs us no extra
/// code.
pub fn open_stream(path: &str, sr: u32, ch: u16) -> Result<Child, String> {
    let bin = resolve(Tool::Ffmpeg).ok_or_else(|| "ffmpeg is not available".to_string())?;
    Command::new(bin)
        .args(stream_args(path, sr, ch))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))
}

/// Same, but starting at a position. `-ss` goes before `-i` for fast seeking.
pub fn open_stream_seeked(path: &str, sr: u32, ch: u16, seek: f64) -> Result<Child, String> {
    let bin = resolve(Tool::Ffmpeg).ok_or_else(|| "ffmpeg is not available".to_string())?;
    let mut args = vec!["-ss".to_string(), format!("{:.3}", seek)];
    args.extend(stream_args(path, sr, ch));
    Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))
}

/// What a probe tells us about a file, from either backend.
#[derive(Debug, Clone, PartialEq)]
pub struct ProbeInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_seconds: f64,
    pub bit_depth: Option<u32>,
    pub bitrate: Option<u32>,
}

/// ffprobe encodes most numeric fields as JSON *strings* ("44100"), but a few
/// as real numbers (channels, bits_per_sample). Read either.
fn num<T: std::str::FromStr>(v: Option<&serde_json::Value>) -> Option<T> {
    match v? {
        serde_json::Value::String(s) => s.parse().ok(),
        serde_json::Value::Number(n) => n.to_string().parse().ok(),
        _ => None,
    }
}

pub fn parse_probe_json(json: &str) -> Result<ProbeInfo, String> {
    let root: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("ffprobe JSON was unreadable: {}", e))?;

    let stream = root
        .get("streams")
        .and_then(|s| s.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "ffprobe reported no audio stream".to_string())?;

    let format = root.get("format");

    let codec = stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    // ffmpeg's DSD decoders decimate by 8 — one byte of 1-bit DSD becomes one
    // PCM sample — so ffprobe reports 352800 for a DSD64 file whose real rate
    // is 2822400. Undo that to report the source rate, which is what an
    // audiophile player is expected to display ("DSD64 / 2.8 MHz"). Playback is
    // unaffected: ffmpeg still emits at the device rate either way.
    let is_dsd = codec.starts_with("dsd_");

    let raw_rate: u32 = num(stream.get("sample_rate"))
        .ok_or_else(|| "ffprobe reported no sample rate".to_string())?;
    let sample_rate = if is_dsd { raw_rate * 8 } else { raw_rate };
    let channels: u16 = num(stream.get("channels")).unwrap_or(2);

    // DSF and some containers carry duration only at the format level.
    let duration_seconds: f64 = num(stream.get("duration"))
        .or_else(|| num(format.and_then(|f| f.get("duration"))))
        .unwrap_or(0.0);

    // DSD is 1-bit by definition; ffprobe's bits_per_sample of 8 describes its
    // byte packing, not the format.
    let bit_depth: Option<u32> = if is_dsd {
        Some(1)
    } else {
        num(stream.get("bits_per_raw_sample"))
            .or_else(|| num(stream.get("bits_per_sample")))
            .filter(|b| *b > 0)
    };

    let bitrate: Option<u32> = num(stream.get("bit_rate"))
        .or_else(|| num(format.and_then(|f| f.get("bit_rate"))))
        .filter(|b| *b > 0);

    Ok(ProbeInfo {
        sample_rate,
        channels,
        duration_seconds,
        bit_depth,
        bitrate,
    })
}

/// Probe a file with the bundled (or PATH) ffprobe.
pub fn probe(path: &str) -> Result<ProbeInfo, String> {
    let bin = resolve(Tool::Ffprobe).ok_or_else(|| "ffprobe is not available".to_string())?;
    let out = Command::new(bin)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            "-select_streams",
            "a:0",
            path,
        ])
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to spawn ffprobe: {}", e))?;

    if !out.status.success() {
        return Err("ffprobe could not read this file".to_string());
    }
    parse_probe_json(&String::from_utf8_lossy(out.stdout.as_slice()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn prefers_the_bundled_sidecar_over_path() {
        let sidecar = PathBuf::from("/app/ffmpeg.exe");
        let on_path = PathBuf::from("/usr/bin/ffmpeg");
        let both = |_: &Path| true;
        assert_eq!(
            pick_first_present(&[sidecar.clone(), on_path], &both),
            Some(sidecar)
        );
    }

    #[test]
    fn falls_back_to_path_when_sidecar_absent() {
        let sidecar = PathBuf::from("/app/ffmpeg.exe");
        let on_path = PathBuf::from("/usr/bin/ffmpeg");
        let only_path = |p: &Path| p == PathBuf::from("/usr/bin/ffmpeg");
        assert_eq!(
            pick_first_present(&[sidecar, on_path.clone()], &only_path),
            Some(on_path)
        );
    }

    #[test]
    fn returns_none_when_nothing_is_present() {
        let none = |_: &Path| false;
        assert_eq!(
            pick_first_present(&[PathBuf::from("/a"), PathBuf::from("/b")], &none),
            None
        );
    }

    /// Trimmed from real output of our own ffprobe against tests/fixtures/tone.aiff.
    /// Note sample_rate/duration/bit_rate are strings while channels and
    /// bits_per_sample are numbers — the mix is the point.
    const AIFF_JSON: &str = r#"{
      "streams": [{
        "index": 0, "codec_name": "pcm_s16be", "codec_type": "audio",
        "sample_fmt": "s16", "sample_rate": "44100", "channels": 2,
        "bits_per_sample": 16, "duration": "0.500000", "bit_rate": "1411200"
      }],
      "format": { "format_name": "aiff", "duration": "0.500000", "bit_rate": "1412064" }
    }"#;

    /// Real shape from our own ffprobe against a synthesized DSD64 file: the
    /// reported rate is already decimated by 8, bits_per_sample describes byte
    /// packing rather than the 1-bit format, and there is no stream duration.
    const DSF_JSON: &str = r#"{
      "streams": [{
        "codec_name": "dsd_lsbf_planar", "sample_rate": "352800",
        "channels": 2, "bits_per_sample": 8
      }],
      "format": { "duration": "12.000000" }
    }"#;

    #[test]
    fn parses_string_and_numeric_fields_together() {
        let info = parse_probe_json(AIFF_JSON).expect("should parse");
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert!((info.duration_seconds - 0.5).abs() < 1e-6);
        assert_eq!(info.bit_depth, Some(16));
        assert_eq!(info.bitrate, Some(1411200));
    }

    #[test]
    fn falls_back_to_format_duration_when_the_stream_has_none() {
        let info = parse_probe_json(DSF_JSON).expect("should parse");
        assert!((info.duration_seconds - 12.0).abs() < 1e-6);
        assert_eq!(info.bitrate, None);
    }

    #[test]
    fn reports_dsd_at_its_source_rate_and_one_bit() {
        let info = parse_probe_json(DSF_JSON).expect("should parse");
        assert_eq!(
            info.sample_rate, 2822400,
            "352800 x 8 — ffmpeg's DSD decoders decimate by 8, so ffprobe's \
             figure is the decoded PCM rate, not the DSD64 source rate"
        );
        assert_eq!(info.bit_depth, Some(1), "DSD is 1-bit; the reported 8 is byte packing");
    }

    #[test]
    fn leaves_non_dsd_rates_alone() {
        let info = parse_probe_json(AIFF_JSON).expect("should parse");
        assert_eq!(info.sample_rate, 44100, "the x8 rule must not touch PCM");
        assert_eq!(info.bit_depth, Some(16));
    }

    #[test]
    fn rejects_json_with_no_audio_stream() {
        let err = parse_probe_json(r#"{"streams":[],"format":{}}"#).unwrap_err();
        assert!(err.contains("no audio stream"), "got: {}", err);
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_probe_json("not json at all").is_err());
    }

    #[test]
    fn probes_a_real_file_when_ffprobe_is_available() {
        if resolve(Tool::Ffprobe).is_none() {
            eprintln!("skipping: no ffprobe available");
            return;
        }
        let path = format!("{}/tests/fixtures/tone.aiff", env!("CARGO_MANIFEST_DIR"));
        let info = probe(&path).expect("ffprobe should read the AIFF fixture");
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert!((info.duration_seconds - 0.5).abs() < 0.05);
    }
}
