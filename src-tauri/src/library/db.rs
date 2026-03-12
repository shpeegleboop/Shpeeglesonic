use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::audio::metadata::TrackMetadata;

pub type DbPool = Arc<Mutex<Connection>>;

/// Initialize the database, creating tables if they don't exist.
pub fn init_db(db_path: &Path) -> Result<DbPool, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create db dir: {}", e))?;
    }

    let conn =
        Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    // Enable foreign key enforcement — SQLite has this OFF by default.
    // Without this, ON DELETE CASCADE does nothing.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT UNIQUE NOT NULL,
            file_name TEXT NOT NULL,
            file_size INTEGER,
            format TEXT,
            title TEXT,
            artist TEXT,
            album_artist TEXT,
            album TEXT,
            genre TEXT,
            year INTEGER,
            track_number INTEGER,
            disc_number INTEGER,
            bpm REAL,
            duration_seconds REAL,
            bitrate INTEGER,
            sample_rate INTEGER,
            bit_depth INTEGER,
            channels INTEGER,
            has_album_art INTEGER DEFAULT 0,
            art_path TEXT,
            album_art_color TEXT,
            date_added TEXT DEFAULT (datetime('now')),
            last_played TEXT,
            play_count INTEGER DEFAULT 0,
            favorited INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS library_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lyrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER UNIQUE NOT NULL,
            synced_lyrics TEXT,
            plain_lyrics TEXT,
            source TEXT DEFAULT 'lrclib',
            fetched_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
        CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
        CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);
        CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added);
        CREATE INDEX IF NOT EXISTS idx_tracks_duration ON tracks(duration_seconds);
        CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count);
        CREATE INDEX IF NOT EXISTS idx_tracks_format ON tracks(format);
        CREATE INDEX IF NOT EXISTS idx_tracks_favorited ON tracks(favorited);
        ",
    )
    .map_err(|e| format!("Failed to create tables: {}", e))?;

    Ok(Arc::new(Mutex::new(conn)))
}

/// Insert or update a track in the database.
pub fn upsert_track(conn: &Connection, meta: &TrackMetadata, art_path: Option<&str>) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO tracks (
            file_path, file_name, file_size, format, title, artist, album_artist,
            album, genre, year, track_number, disc_number, bpm, duration_seconds,
            bitrate, sample_rate, bit_depth, channels, has_album_art, art_path
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
        ON CONFLICT(file_path) DO UPDATE SET
            file_name=?2, file_size=?3, format=?4, title=?5, artist=?6, album_artist=?7,
            album=?8, genre=?9, year=?10, track_number=?11, disc_number=?12, bpm=?13,
            duration_seconds=?14, bitrate=?15, sample_rate=?16, bit_depth=?17, channels=?18,
            has_album_art=?19, art_path=?20",
        params![
            meta.file_path,
            meta.file_name,
            meta.file_size as i64,
            meta.format,
            meta.title,
            meta.artist,
            meta.album_artist,
            meta.album,
            meta.genre,
            meta.year,
            meta.track_number,
            meta.disc_number,
            meta.bpm,
            meta.duration_seconds,
            meta.bitrate,
            meta.sample_rate,
            meta.bit_depth,
            meta.channels,
            meta.has_album_art as i32,
            art_path,
        ],
    )
    .map_err(|e| format!("Failed to upsert track: {}", e))?;

    Ok(conn.last_insert_rowid())
}

/// Track struct for sending to frontend.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Track {
    pub id: i64,
    pub file_path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub bpm: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub sample_rate: Option<i32>,
    pub bit_depth: Option<i32>,
    pub channels: Option<i32>,
    pub has_album_art: bool,
    pub art_path: Option<String>,
    pub album_art_color: Option<String>,
    pub play_count: i32,
    pub favorited: bool,
}

/// Get library tracks with optional search and sorting.
pub fn get_tracks(
    conn: &Connection,
    sort_by: &str,
    sort_order: &str,
    search: Option<&str>,
) -> Result<Vec<Track>, String> {
    let order_col = match sort_by {
        "artist" => "COALESCE(artist, 'zzz')",
        "album" => "COALESCE(album, 'zzz')",
        "title" => "COALESCE(title, file_name)",
        "genre" => "COALESCE(genre, 'zzz')",
        "year" => "COALESCE(year, 0)",
        "bpm" => "COALESCE(bpm, 0)",
        "duration" => "COALESCE(duration_seconds, 0)",
        "format" => "COALESCE(format, 'zzz')",
        "date_added" => "date_added",
        "play_count" => "play_count",
        "bitrate" => "COALESCE(bitrate, 0)",
        "sample_rate" => "COALESCE(sample_rate, 0)",
        _ => "COALESCE(artist, 'zzz'), COALESCE(album, 'zzz'), COALESCE(track_number, 999)",
    };
    let order_dir = if sort_order == "desc" { "DESC" } else { "ASC" };

    let (where_clause, search_param) = if let Some(q) = search {
        if q.is_empty() {
            ("".to_string(), None)
        } else {
            let pattern = format!("%{}%", q);
            (
                " WHERE title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1 OR genre LIKE ?1".to_string(),
                Some(pattern),
            )
        }
    } else {
        ("".to_string(), None)
    };

    let sql = format!(
        "SELECT id, file_path, file_name, title, artist, album_artist, album, genre,
                year, track_number, disc_number, bpm, duration_seconds, format,
                bitrate, sample_rate, bit_depth, channels, has_album_art, art_path,
                album_art_color, play_count, favorited
         FROM tracks{}
         ORDER BY {} {}",
        where_clause, order_col, order_dir
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query error: {}", e))?;

    let rows = if let Some(ref param) = search_param {
        stmt.query_map(params![param], map_track_row)
    } else {
        stmt.query_map([], map_track_row)
    }
    .map_err(|e| format!("Query error: {}", e))?;

    let mut tracks = Vec::new();
    for row in rows {
        if let Ok(track) = row {
            tracks.push(track);
        }
    }

    Ok(tracks)
}

fn map_track_row(row: &rusqlite::Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        file_path: row.get(1)?,
        file_name: row.get(2)?,
        title: row.get(3)?,
        artist: row.get(4)?,
        album_artist: row.get(5)?,
        album: row.get(6)?,
        genre: row.get(7)?,
        year: row.get(8)?,
        track_number: row.get(9)?,
        disc_number: row.get(10)?,
        bpm: row.get(11)?,
        duration_seconds: row.get(12)?,
        format: row.get(13)?,
        bitrate: row.get(14)?,
        sample_rate: row.get(15)?,
        bit_depth: row.get(16)?,
        channels: row.get(17)?,
        has_album_art: row.get::<_, i32>(18)? != 0,
        art_path: row.get(19)?,
        album_art_color: row.get(20)?,
        play_count: row.get(21)?,
        favorited: row.get::<_, i32>(22)? != 0,
    })
}

/// Add a library folder.
pub fn add_library_folder(conn: &Connection, path: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO library_folders (path) VALUES (?1)",
        params![path],
    )
    .map_err(|e| format!("Failed to add folder: {}", e))?;
    Ok(())
}

/// Remove a library folder and its tracks.
pub fn remove_library_folder(conn: &Connection, path: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tracks WHERE file_path LIKE ?1",
        params![format!("{}%", path)],
    )
    .map_err(|e| format!("Failed to remove tracks: {}", e))?;

    conn.execute(
        "DELETE FROM library_folders WHERE path = ?1",
        params![path],
    )
    .map_err(|e| format!("Failed to remove folder: {}", e))?;

    Ok(())
}

/// Get all library folders.
pub fn get_library_folders(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT path FROM library_folders")
        .map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Query error: {}", e))?;

    let mut folders = Vec::new();
    for row in rows {
        if let Ok(path) = row {
            folders.push(path);
        }
    }

    Ok(folders)
}

/// Toggle favorite status for a track.
pub fn toggle_favorite(conn: &Connection, track_id: i64) -> Result<bool, String> {
    let current: i32 = conn
        .query_row(
            "SELECT favorited FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Track not found: {}", e))?;

    let new_val = if current == 0 { 1 } else { 0 };
    conn.execute(
        "UPDATE tracks SET favorited = ?1 WHERE id = ?2",
        params![new_val, track_id],
    )
    .map_err(|e| format!("Failed to toggle: {}", e))?;

    Ok(new_val == 1)
}

/// Update play count and last_played for a track.
pub fn record_play(conn: &Connection, track_id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE tracks SET play_count = play_count + 1, last_played = datetime('now') WHERE id = ?1",
        params![track_id],
    )
    .map_err(|e| format!("Failed to record play: {}", e))?;
    Ok(())
}

// Playlist operations

pub fn create_playlist(conn: &Connection, name: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO playlists (name) VALUES (?1)",
        params![name],
    )
    .map_err(|e| format!("Failed to create playlist: {}", e))?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_playlist(conn: &Connection, playlist_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM playlists WHERE id = ?1",
        params![playlist_id],
    )
    .map_err(|e| format!("Failed to delete playlist: {}", e))?;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_count: i32,
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<Playlist>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, COUNT(pt.id) as track_count
             FROM playlists p
             LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
             GROUP BY p.id
             ORDER BY p.name",
        )
        .map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                track_count: row.get(2)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut playlists = Vec::new();
    for row in rows {
        if let Ok(p) = row {
            playlists.push(p);
        }
    }
    Ok(playlists)
}

pub fn add_track_to_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    let max_pos: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
        params![playlist_id, track_id, max_pos + 1],
    )
    .map_err(|e| format!("Failed to add track: {}", e))?;
    Ok(())
}

pub fn remove_track_from_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )
    .map_err(|e| format!("Failed to remove track: {}", e))?;
    Ok(())
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: i64) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.file_path, t.file_name, t.title, t.artist, t.album_artist, t.album,
                    t.genre, t.year, t.track_number, t.disc_number, t.bpm, t.duration_seconds,
                    t.format, t.bitrate, t.sample_rate, t.bit_depth, t.channels, t.has_album_art,
                    t.art_path, t.album_art_color, t.play_count, t.favorited
             FROM tracks t
             JOIN playlist_tracks pt ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position",
        )
        .map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map(params![playlist_id], map_track_row)
        .map_err(|e| format!("Query error: {}", e))?;

    let mut tracks = Vec::new();
    for row in rows {
        if let Ok(track) = row {
            tracks.push(track);
        }
    }
    Ok(tracks)
}

/// Store lyrics for a track.
pub fn store_lyrics(
    conn: &Connection,
    track_id: i64,
    synced: Option<&str>,
    plain: Option<&str>,
    source: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO lyrics (track_id, synced_lyrics, plain_lyrics, source)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(track_id) DO UPDATE SET
         synced_lyrics=?2, plain_lyrics=?3, source=?4, fetched_at=datetime('now')",
        params![track_id, synced, plain, source],
    )
    .map_err(|e| format!("Failed to store lyrics: {}", e))?;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
pub struct LyricsData {
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
    pub source: String,
}

pub fn get_lyrics(conn: &Connection, track_id: i64) -> Result<Option<LyricsData>, String> {
    let result = conn.query_row(
        "SELECT synced_lyrics, plain_lyrics, source FROM lyrics WHERE track_id = ?1",
        params![track_id],
        |row| {
            Ok(LyricsData {
                synced_lyrics: row.get(0)?,
                plain_lyrics: row.get(1)?,
                source: row.get(2)?,
            })
        },
    );

    match result {
        Ok(data) => Ok(Some(data)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get lyrics: {}", e)),
    }
}
