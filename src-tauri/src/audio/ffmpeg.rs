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
}
