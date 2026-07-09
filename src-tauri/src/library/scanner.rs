use std::path::Path;

use crate::audio::metadata;
use crate::library::db;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "aiff", "aif", "ogg", "m4a", "aac", "wma", "opus",
];

/// Scan a directory recursively for audio files and populate the database.
/// Returns the count of tracks added/updated.
pub fn scan_folder(
    conn: &rusqlite::Connection,
    folder_path: &str,
    art_cache_dir: &Path,
) -> Result<u32, String> {
    let path = Path::new(folder_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", folder_path));
    }

    let mut count = 0u32;
    let mut errors = 0u32;

    scan_recursive(path, conn, art_cache_dir, &mut count, &mut errors)?;

    if errors > 0 {
        println!(
            "Scan complete: {} tracks added/updated, {} errors",
            count, errors
        );
    } else {
        println!("Scan complete: {} tracks added/updated", count);
    }

    Ok(count)
}

fn scan_recursive(
    dir: &Path,
    conn: &rusqlite::Connection,
    art_cache_dir: &Path,
    count: &mut u32,
    errors: &mut u32,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        if path.is_dir() {
            // Skip hidden directories
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            let _ = scan_recursive(&path, conn, art_cache_dir, count, errors);
            continue;
        }

        // Check if it's a supported audio file
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        // Skip macOS resource fork files (._)
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with("._") {
                continue;
            }
        }

        let path_str = path.to_string_lossy().to_string();

        // Extract metadata
        match metadata::extract_metadata(&path_str) {
            Ok(meta) => {
                // Try to extract album art
                let art_path = metadata::extract_album_art(&path_str, art_cache_dir)
                    .or_else(|| metadata::find_folder_art(&path_str));

                match db::upsert_track(conn, &meta, art_path.as_deref()) {
                    Ok(_) => *count += 1,
                    Err(e) => {
                        eprintln!("DB error for {}: {}", path_str, e);
                        *errors += 1;
                    }
                }
            }
            Err(e) => {
                eprintln!("Metadata error for {}: {}", path_str, e);
                *errors += 1;
            }
        }
    }

    Ok(())
}
