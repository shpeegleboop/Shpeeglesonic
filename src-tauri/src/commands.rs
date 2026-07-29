use std::sync::{Arc, Mutex};
use tauri::{command, State};

use crate::audio::engine::AudioEngine;
use crate::library::db::{self, DbPool, Track};

pub type AudioEngineState = Arc<Mutex<AudioEngine>>;

// ─── Audio Playback Commands ──────────────────────────────────────────

#[command]
pub async fn play_file(
    path: String,
    engine: State<'_, AudioEngineState>,
) -> Result<crate::audio::engine::TrackInfo, String> {
    let engine_clone = engine.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mut eng = engine_clone.lock().map_err(|e| e.to_string())?;
        eng.load_and_play(&path)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Load a track into the engine paused at a saved position, without audible
/// playback — used to restore the previous session on launch.
#[command]
pub async fn load_file_paused(
    path: String,
    position: f64,
    engine: State<'_, AudioEngineState>,
) -> Result<crate::audio::engine::TrackInfo, String> {
    let engine_clone = engine.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mut eng = engine_clone.lock().map_err(|e| e.to_string())?;
        let info = eng.load_and_play(&path)?;
        eng.pause()?;
        if position > 0.0 && position < info.duration_seconds {
            eng.seek(position)?;
        }
        Ok(info)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[command]
pub fn pause(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| e.to_string())?;
    engine.pause()
}

#[command]
pub fn resume(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| e.to_string())?;
    engine.resume()
}

#[command]
pub fn stop(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| e.to_string())?;
    engine.stop();
    Ok(())
}

#[command]
pub fn seek(position: f64, engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| e.to_string())?;
    engine.seek(position)
}

#[command]
pub fn set_volume(volume: u8, engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| e.to_string())?;
    engine.set_volume(volume);
    Ok(())
}

#[command]
pub fn get_playback_state(engine: State<'_, AudioEngineState>) -> Result<String, String> {
    let engine = engine.lock().map_err(|e| e.to_string())?;
    let state = engine
        .playback_state
        .load(std::sync::atomic::Ordering::Relaxed);
    let name = match state {
        0 => "stopped",
        1 => "playing",
        2 => "paused",
        _ => "unknown",
    };
    Ok(name.to_string())
}

// ─── Library Commands ──────────────────────────────────────────────────

/// Scan a library folder. `incremental` skips files whose size and mtime are
/// unchanged; a full scan re-reads everything.
#[command]
pub async fn scan_folder(
    path: String,
    incremental: bool,
    db: State<'_, DbPool>,
    app_handle: tauri::AppHandle,
) -> Result<crate::library::scanner::ScanSummary, String> {
    use tauri::{Emitter, Manager};

    // Art cache lives alongside the DB in Tauri's app data dir
    let art_cache_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("art_cache");
    std::fs::create_dir_all(&art_cache_dir)
        .map_err(|e| format!("Failed to create art cache: {}", e))?;

    let pool = db.inner().clone();
    let emitter = app_handle.clone();

    // spawn_blocking so a long scan never occupies the async runtime — same
    // pattern as play_file. The old sync command held the DB mutex for the
    // entire scan, which is what froze the window.
    tokio::task::spawn_blocking(move || {
        {
            let conn = pool.lock().map_err(|e| e.to_string())?;
            db::add_library_folder(&conn, &path)?;
        }

        let summary = crate::library::scanner::run_scan(
            &pool,
            &path,
            &art_cache_dir,
            incremental,
            &|done, total, label| {
                let _ = emitter.emit(
                    "scan-progress",
                    serde_json::json!({ "done": done, "total": total, "label": label }),
                );
            },
        )?;

        // Byte-comparing duplicate candidates reads whole files; pointless when
        // the scan changed nothing.
        if summary.added + summary.updated > 0 {
            let conn = pool.lock().map_err(|e| e.to_string())?;
            let _ = db::collapse_identical_duplicates(&conn);
            // Retagging can reveal that a hidden row was never a duplicate (a
            // live take finally naming its album). Without this the correction
            // wouldn't surface until the next launch.
            let _ = db::release_stale_duplicate_links(&conn);
        }

        let _ = emitter.emit("scan-progress", serde_json::Value::Null);
        Ok(summary)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete library rows for the exact paths handed in — the list the user was
/// shown in the scan summary. Never recomputes the set at delete time, so a
/// drive that came back online between the scan and the click can't cause a
/// surprise deletion. Cascades to playlist entries and lyrics.
#[command]
pub fn prune_missing_tracks(paths: Vec<String>, db: State<'_, DbPool>) -> Result<u32, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::delete_tracks_by_path(&conn, &paths)
}

/// Hide byte-identical duplicate files, keeping one visible copy of each.
#[command]
pub fn collapse_duplicates(db: State<'_, DbPool>) -> Result<u32, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::collapse_identical_duplicates(&conn)
}

#[command]
pub fn get_library_tracks(
    sort_by: String,
    sort_order: String,
    search: Option<String>,
    db: State<'_, DbPool>,
) -> Result<Vec<Track>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_tracks(&conn, &sort_by, &sort_order, search.as_deref())
}

#[command]
pub fn get_library_folders(db: State<'_, DbPool>) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_library_folders(&conn)
}

#[command]
pub fn add_library_folder(path: String, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::add_library_folder(&conn, &path)
}

#[command]
pub fn remove_library_folder(path: String, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::remove_library_folder(&conn, &path)
}

#[command]
pub fn toggle_favorite(track_id: i64, db: State<'_, DbPool>) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::toggle_favorite(&conn, track_id)
}

#[command]
pub fn record_play(track_id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::record_play(&conn, track_id)
}

// ─── Metadata Editing Commands ─────────────────────────────────────────

#[command]
pub fn update_track_metadata(
    track_id: i64,
    update: crate::audio::metadata::MetadataUpdate,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let path = db::get_track_path(&conn, track_id)?;

    // Write the file tags first — if that fails, the DB stays untouched
    crate::audio::metadata::write_metadata(&path, &update)?;
    db::update_track_metadata(&conn, track_id, &update)?;

    // Editing metadata is how the user says "this isn't a duplicate" — naming
    // the live album it came from should bring the track straight back rather
    // than leaving it hidden until the next launch.
    let _ = db::release_stale_duplicate_links(&conn);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct RenameGroupResult {
    pub updated: u32,
    pub failed: u32,
    pub first_error: Option<String>,
}

/// Rename an artist/album/genre for every matching track (file tags + DB).
/// `old_value: None` targets tracks where the field is untagged.
#[command]
pub fn rename_group_field(
    field: String,
    old_value: Option<String>,
    new_value: String,
    db: State<'_, DbPool>,
) -> Result<RenameGroupResult, String> {
    let new_value = new_value.trim();
    if new_value.is_empty() {
        return Err("New name cannot be empty".to_string());
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    let targets = db::get_tracks_by_field(&conn, &field, old_value.as_deref())?;

    let mut result = RenameGroupResult {
        updated: 0,
        failed: 0,
        first_error: None,
    };

    for (track_id, path) in targets {
        match crate::audio::metadata::write_single_field(&path, &field, new_value) {
            Ok(()) => {
                db::set_track_field(&conn, &field, track_id, new_value)?;
                result.updated += 1;
            }
            Err(e) => {
                result.failed += 1;
                if result.first_error.is_none() {
                    result.first_error = Some(format!("{}: {}", path, e));
                }
            }
        }
    }

    Ok(result)
}

// ─── Album Art Commands ──────────────────────────────────────────────

#[command]
pub fn get_track_art(track_id: i64, db: State<'_, DbPool>) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT art_path FROM tracks WHERE id = ?1",
        rusqlite::params![track_id],
        |row| row.get::<_, Option<String>>(0),
    );

    match result {
        Ok(path) => Ok(path),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get art: {}", e)),
    }
}

#[command]
pub fn get_art_base64(path: String) -> Result<Option<String>, String> {
    if !std::path::Path::new(&path).exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read art: {}", e))?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let mime = if path.ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
}

// ─── Playlist Commands ─────────────────────────────────────────────────

#[command]
pub fn create_playlist(name: String, db: State<'_, DbPool>) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::create_playlist(&conn, &name)
}

#[command]
pub fn delete_playlist(playlist_id: i64, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::delete_playlist(&conn, playlist_id)
}

#[command]
pub fn get_playlists(db: State<'_, DbPool>) -> Result<Vec<db::Playlist>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_playlists(&conn)
}

#[command]
pub fn reorder_playlists(from: usize, to: usize, db: State<'_, DbPool>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::reorder_playlists(&conn, from, to)
}

#[command]
pub fn rename_playlist(
    playlist_id: i64,
    name: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::rename_playlist(&conn, playlist_id, &name)
}

#[command]
pub fn get_duplicate_candidates(
    db: State<'_, DbPool>,
) -> Result<Vec<db::DuplicateCandidate>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_duplicate_candidates(&conn)
}

#[command]
pub fn set_track_hidden(
    track_id: i64,
    duplicate_of: Option<i64>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_track_hidden(&conn, track_id, duplicate_of)
}

#[command]
pub fn reorder_playlist_track(
    playlist_id: i64,
    from: usize,
    to: usize,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::reorder_playlist_track(&conn, playlist_id, from, to)
}

#[command]
pub fn add_track_to_playlist(
    playlist_id: i64,
    track_id: i64,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::add_track_to_playlist(&conn, playlist_id, track_id)
}

#[command]
pub fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::remove_track_from_playlist(&conn, playlist_id, track_id)
}

#[command]
pub fn get_playlist_tracks(
    playlist_id: i64,
    db: State<'_, DbPool>,
) -> Result<Vec<Track>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_playlist_tracks(&conn, playlist_id)
}

// ─── Lyrics Commands ───────────────────────────────────────────────────

#[command]
pub async fn fetch_lyrics(
    track_id: i64,
    artist: String,
    title: String,
    album: Option<String>,
    duration: Option<f64>,
    file_path: String,
    db: State<'_, DbPool>,
) -> Result<Option<db::LyricsData>, String> {
    // Check cache first
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = db::get_lyrics(&conn, track_id)? {
            return Ok(Some(cached));
        }
    }

    // Check for local .lrc file
    if let Some(lrc_content) = crate::lyrics::lrclib::find_local_lrc(&file_path) {
        let conn = db.lock().map_err(|e| e.to_string())?;
        db::store_lyrics(&conn, track_id, Some(&lrc_content), None, "local_lrc")?;
        return Ok(Some(db::LyricsData {
            synced_lyrics: Some(lrc_content),
            plain_lyrics: None,
            source: "local_lrc".to_string(),
        }));
    }

    // Fetch from LRCLIB
    match crate::lyrics::lrclib::fetch_lyrics(
        &artist,
        &title,
        album.as_deref(),
        duration,
    )
    .await
    {
        Ok(Some(response)) => {
            let conn = db.lock().map_err(|e| e.to_string())?;
            db::store_lyrics(
                &conn,
                track_id,
                response.synced_lyrics.as_deref(),
                response.plain_lyrics.as_deref(),
                "lrclib",
            )?;
            Ok(Some(db::LyricsData {
                synced_lyrics: response.synced_lyrics,
                plain_lyrics: response.plain_lyrics,
                source: "lrclib".to_string(),
            }))
        }
        Ok(None) => Ok(None),
        Err(e) => {
            eprintln!("LRCLIB error: {}", e);
            Ok(None)
        }
    }
}


/// Peak envelope for a whole track, for the Stereo Scope overview.
///
/// `async` so Tauri runs it off the main thread: a full decode takes from a
/// fraction of a second to several for a long lossless file, and blocking there
/// would stall every other command behind it.
#[command]
pub async fn get_waveform_overview(
    path: String,
    buckets: usize,
) -> Result<crate::audio::waveform::WaveformOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::audio::waveform::overview(&path, buckets)
    })
    .await
    .map_err(|e| format!("waveform task failed: {}", e))?
}

// ─── Output Device Commands ────────────────────────────────────────────

/// One selectable output endpoint.
#[derive(serde::Serialize)]
pub struct OutputDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// What the output is actually doing right now, for the settings readout.
/// `sample_rate` is the rate being fed to the device, which in exclusive mode
/// follows the file and in shared mode is always the Windows mix format.
#[derive(serde::Serialize)]
pub struct OutputStatus {
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth: Option<u16>,
    pub exclusive: bool,
    /// True when the file's own rate is being converted to reach the device.
    pub resampling: bool,
    pub file_sample_rate: Option<u32>,
    /// Set when exclusive mode is switched on but the device is not running it,
    /// so the UI can say why instead of silently lying.
    pub exclusive_requested: bool,
}

#[command]
pub fn list_output_devices() -> Result<Vec<OutputDeviceInfo>, String> {
    #[cfg(windows)]
    {
        let devices = crate::audio::exclusive::list_devices()?;
        return Ok(devices
            .into_iter()
            .map(|d| OutputDeviceInfo {
                id: d.id,
                name: d.name,
                is_default: d.is_default,
            })
            .collect());
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[command]
pub fn set_output_config(
    exclusive: bool,
    device_id: Option<String>,
    engine: State<'_, AudioEngineState>,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| e.to_string())?;
    engine.set_output_config(exclusive, device_id);
    Ok(())
}

#[command]
pub fn get_output_status(engine: State<'_, AudioEngineState>) -> Result<OutputStatus, String> {
    let engine = engine.lock().map_err(|e| e.to_string())?;
    let file_sample_rate = engine.current_track.as_ref().map(|t| t.sample_rate);
    Ok(OutputStatus {
        sample_rate: engine.device_sample_rate,
        channels: engine.device_channels,
        bit_depth: engine.active_bits,
        exclusive: engine.active_exclusive,
        // DSD is decoded to PCM long before this point, so a DSD file always
        // reads as converted regardless of share mode.
        resampling: file_sample_rate
            .map(|sr| sr != engine.device_sample_rate)
            .unwrap_or(false),
        file_sample_rate,
        exclusive_requested: engine.exclusive_enabled,
    })
}
