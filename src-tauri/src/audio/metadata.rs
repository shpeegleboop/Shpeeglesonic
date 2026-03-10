use lofty::prelude::*;
use lofty::probe::Probe;
use std::path::Path;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TrackMetadata {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub format: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub bpm: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub channels: Option<u32>,
    pub has_album_art: bool,
}

/// Extract metadata from an audio file using Lofty.
pub fn extract_metadata(path: &str) -> Result<TrackMetadata, String> {
    let file_path = Path::new(path);
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_size = std::fs::metadata(path)
        .map(|m| m.len())
        .unwrap_or(0);

    let format = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase();

    let tagged_file = Probe::open(path)
        .map_err(|e| format!("Failed to open for metadata: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let properties = tagged_file.properties();
    let duration_seconds = Some(properties.duration().as_secs_f64());
    let bitrate = properties.audio_bitrate().map(|b| b as u32);
    let sample_rate = properties.sample_rate();
    let bit_depth = properties.bit_depth().map(|b| b as u32);
    let channels = properties.channels().map(|c| c as u32);

    // Try to get tags (primary tag first, then any tag)
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album_artist, album, genre, year, track_number, disc_number, bpm, has_album_art) =
        if let Some(tag) = tag {
            // Use Accessor trait methods first, then fall back to ItemKey lookups
            let title = tag.title().map(|s| s.to_string())
                .or_else(|| tag.get_string(ItemKey::TrackTitle).map(|s| s.to_string()));

            let artist = tag.artist().map(|s| s.to_string())
                .or_else(|| tag.get_string(ItemKey::TrackArtist).map(|s| s.to_string()));

            let album = tag.album().map(|s| s.to_string())
                .or_else(|| tag.get_string(ItemKey::AlbumTitle).map(|s| s.to_string()));

            let genre = tag.genre().map(|s| s.to_string())
                .or_else(|| tag.get_string(ItemKey::Genre).map(|s| s.to_string()));

            let year = tag
                .get_string(ItemKey::Year)
                .or_else(|| tag.get_string(ItemKey::RecordingDate))
                .and_then(|s| s.chars().take(4).collect::<String>().parse::<i32>().ok());

            let track_number = tag.track().map(|t| t as u32);
            let disc_number = tag.disk().map(|d| d as u32);

            let album_artist = tag
                .get_string(ItemKey::AlbumArtist)
                .map(|s| s.to_string());

            let bpm = tag
                .get_string(ItemKey::Bpm)
                .and_then(|s| s.parse::<f64>().ok());

            let has_album_art = tag.picture_count() > 0;

            (
                title,
                artist,
                album_artist,
                album,
                genre,
                year,
                track_number,
                disc_number,
                bpm,
                has_album_art,
            )
        } else {
            println!("  No tags found for: {}", path);
            (None, None, None, None, None, None, None, None, None, false)
        };

    // Use filename as title fallback
    let title: Option<String> = title.or_else(|| {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    });

    Ok(TrackMetadata {
        file_path: path.to_string(),
        file_name,
        file_size,
        format,
        title,
        artist,
        album_artist,
        album,
        genre,
        year,
        track_number,
        disc_number,
        bpm,
        duration_seconds,
        bitrate,
        sample_rate,
        bit_depth,
        channels,
        has_album_art,
    })
}

/// Extract and save album art from an audio file.
/// Returns the path to the cached art file, or None if no art found.
pub fn extract_album_art(audio_path: &str, cache_dir: &Path) -> Option<String> {
    let tagged_file = Probe::open(audio_path).ok()?.read().ok()?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;

    // Get the first picture
    let pictures = tag.pictures();
    let picture = pictures.first()?;

    // Create cache dir if needed
    std::fs::create_dir_all(cache_dir).ok()?;

    // Generate hash-based filename
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    audio_path.hash(&mut hasher);
    let hash = hasher.finish();

    let ext = match picture.mime_type() {
        Some(lofty::picture::MimeType::Png) => "png",
        _ => "jpg",
    };

    let art_filename = format!("{:016x}.{}", hash, ext);
    let art_path = cache_dir.join(&art_filename);

    // Skip if already cached
    if art_path.exists() {
        return Some(art_path.to_string_lossy().to_string());
    }

    // Write art to cache
    std::fs::write(&art_path, picture.data()).ok()?;

    Some(art_path.to_string_lossy().to_string())
}

/// Look for cover art files in the same directory as the audio file.
pub fn find_folder_art(audio_path: &str) -> Option<String> {
    let dir = Path::new(audio_path).parent()?;
    let art_names = [
        "cover.jpg",
        "cover.png",
        "folder.jpg",
        "folder.png",
        "album.jpg",
        "album.png",
        "front.jpg",
        "front.png",
        "Cover.jpg",
        "Cover.png",
        "Folder.jpg",
    ];

    for name in &art_names {
        let art_path = dir.join(name);
        if art_path.exists() {
            return Some(art_path.to_string_lossy().to_string());
        }
    }

    None
}
