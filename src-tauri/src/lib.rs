mod audio;
mod commands;
mod library;
mod lyrics;

use std::sync::{Arc, Mutex};

use audio::engine::AudioEngine;
use commands::AudioEngineState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize audio engine
    let mut engine = AudioEngine::new().expect("Failed to initialize audio engine");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            use tauri::Manager;

            // Initialize database
            let mut db_path = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&db_path).ok();
            db_path.push("library.db");

            let db = library::db::init_db(&db_path).expect("Failed to initialize database");
            app.manage(db);

            // Set up FFT thread
            let app_handle = app.handle().clone();
            let fft_sender = audio::fft::spawn_fft_thread(
                app_handle,
                engine.samples_played.clone(),
                engine.playback_state.clone(),
                engine.track_ended_naturally.clone(),
                engine.device_sample_rate,
                engine.device_channels,
            );
            engine.set_fft_sender(fft_sender);
            engine.set_app_handle(app.handle().clone());

            // Manage audio engine state
            let engine_state: AudioEngineState = Arc::new(Mutex::new(engine));
            app.manage(engine_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Audio
            commands::play_file,
            commands::pause,
            commands::resume,
            commands::stop,
            commands::seek,
            commands::set_volume,
            commands::get_playback_state,
            // Library
            commands::scan_folder,
            commands::get_library_tracks,
            commands::get_library_folders,
            commands::add_library_folder,
            commands::remove_library_folder,
            commands::toggle_favorite,
            commands::record_play,
            // Art
            commands::get_track_art,
            commands::get_art_base64,
            // Playlists
            commands::create_playlist,
            commands::delete_playlist,
            commands::get_playlists,
            commands::add_track_to_playlist,
            commands::remove_track_from_playlist,
            commands::get_playlist_tracks,
            // Lyrics
            commands::fetch_lyrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shpeeglesonic");
}
