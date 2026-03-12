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

#[command]
pub fn scan_folder(path: String, db: State<'_, DbPool>, app_handle: tauri::AppHandle) -> Result<u32, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Add to library folders
    db::add_library_folder(&conn, &path)?;

    // Art cache lives alongside the DB in Tauri's app data dir
    use tauri::Manager;
    let art_cache_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("art_cache");
    std::fs::create_dir_all(&art_cache_dir)
        .map_err(|e| format!("Failed to create art cache: {}", e))?;

    crate::library::scanner::scan_folder(&conn, &path, &art_cache_dir)
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

