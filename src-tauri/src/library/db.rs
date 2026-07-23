use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::audio::metadata::TrackMetadata;

pub type DbPool = Arc<Mutex<Connection>>;

/// Schema DDL — shared between init_db and the test harness.
const SCHEMA_SQL: &str = "
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
        ";

/// Apply schema + migrations to an open connection.
fn apply_schema(conn: &Connection) -> Result<(), String> {
    // Enable foreign key enforcement — SQLite has this OFF by default.
    // Without this, ON DELETE CASCADE does nothing.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to create tables: {}", e))?;

    // Migrations for older databases — ignore "duplicate column" errors
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN duplicate_of INTEGER", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN dup_reviewed INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN sort_order INTEGER", []);
    // Backfill manual order for pre-migration playlists (creation order)
    let _ = conn.execute("UPDATE playlists SET sort_order = id WHERE sort_order IS NULL", []);

    Ok(())
}

/// Initialize the database, creating tables if they don't exist.
pub fn init_db(db_path: &Path) -> Result<DbPool, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create db dir: {}", e))?;
    }

    let conn =
        Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    apply_schema(&conn)?;

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
    /// True when another visible track shares this title+artist and this
    /// track hasn't had its metadata reviewed yet ("d!?" badge in the UI).
    pub dup_flag: bool,
}

/// SQL fragment computing dup_flag for a `tracks t` row.
const DUP_FLAG_SQL: &str = "CASE WHEN COALESCE(t.dup_reviewed, 0) = 0 AND COALESCE(t.title, '') != '' AND EXISTS(
    SELECT 1 FROM tracks t2 WHERE t2.id != t.id AND t2.duplicate_of IS NULL
      AND lower(COALESCE(t2.title, '')) = lower(COALESCE(t.title, ''))
      AND lower(COALESCE(t2.artist, '')) = lower(COALESCE(t.artist, ''))
  ) THEN 1 ELSE 0 END";

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
                " AND (title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1 OR genre LIKE ?1)".to_string(),
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
                album_art_color, play_count, favorited, {} as dup_flag
         FROM tracks t
         WHERE duplicate_of IS NULL{}
         ORDER BY {} {}",
        DUP_FLAG_SQL, where_clause, order_col, order_dir
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
        dup_flag: row.get::<_, i32>(23).unwrap_or(0) != 0,
    })
}

/// Get a track's file path.
pub fn get_track_path(conn: &Connection, track_id: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT file_path FROM tracks WHERE id = ?1",
        params![track_id],
        |row| row.get(0),
    )
    .map_err(|e| format!("Track not found: {}", e))
}

/// Update editable metadata fields for a track.
pub fn update_track_metadata(
    conn: &Connection,
    track_id: i64,
    update: &crate::audio::metadata::MetadataUpdate,
) -> Result<(), String> {
    let clean = |v: &Option<String>| -> Option<String> {
        v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
    };
    conn.execute(
        "UPDATE tracks SET title=?1, artist=?2, album_artist=?3, album=?4,
                genre=?5, year=?6, track_number=?7, dup_reviewed=1 WHERE id=?8",
        params![
            clean(&update.title),
            clean(&update.artist),
            clean(&update.album_artist),
            clean(&update.album),
            clean(&update.genre),
            update.year.filter(|y| *y > 0),
            update.track_number.filter(|t| *t > 0),
            track_id,
        ],
    )
    .map_err(|e| format!("Failed to update track: {}", e))?;
    Ok(())
}

/// Column name for a UI-editable group field. Whitelist guards against SQL injection.
fn group_column(field: &str) -> Result<&'static str, String> {
    match field {
        "artist" => Ok("artist"),
        "album" => Ok("album"),
        "genre" => Ok("genre"),
        "album_artist" => Ok("album_artist"),
        _ => Err(format!("Invalid field: {}", field)),
    }
}

/// Find all tracks whose `field` equals `value` (None matches untagged tracks).
pub fn get_tracks_by_field(
    conn: &Connection,
    field: &str,
    value: Option<&str>,
) -> Result<Vec<(i64, String)>, String> {
    let col = group_column(field)?;
    let sql = match value {
        Some(_) => format!("SELECT id, file_path FROM tracks WHERE {} = ?1", col),
        None => format!("SELECT id, file_path FROM tracks WHERE {} IS NULL", col),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query error: {}", e))?;

    let map = |row: &rusqlite::Row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?));
    let rows = match value {
        Some(v) => stmt.query_map(params![v], map),
        None => stmt.query_map([], map),
    }
    .map_err(|e| format!("Query error: {}", e))?;

    Ok(rows.flatten().collect())
}

/// Set a single group field for one track.
pub fn set_track_field(
    conn: &Connection,
    field: &str,
    track_id: i64,
    value: &str,
) -> Result<(), String> {
    let col = group_column(field)?;
    conn.execute(
        &format!("UPDATE tracks SET {} = ?1, dup_reviewed = 1 WHERE id = ?2", col),
        params![value, track_id],
    )
    .map_err(|e| format!("Failed to update track: {}", e))?;
    Ok(())
}

/// A duplicate-browser row: the track plus whether it's currently hidden
/// (duplicate_of set). Hidden tracks stay listed so they can be unhidden.
#[derive(Clone, serde::Serialize)]
pub struct DuplicateCandidate {
    #[serde(flatten)]
    pub track: Track,
    pub hidden: bool,
}

/// Every track (visible or hidden) that shares a non-empty title + artist
/// with at least one other track — the working set for the duplicates browser.
pub fn get_duplicate_candidates(conn: &Connection) -> Result<Vec<DuplicateCandidate>, String> {
    let sql = format!(
        "SELECT id, file_path, file_name, title, artist, album_artist, album, genre,
                year, track_number, disc_number, bpm, duration_seconds, format,
                bitrate, sample_rate, bit_depth, channels, has_album_art, art_path,
                album_art_color, play_count, favorited, {} as dup_flag,
                (t.duplicate_of IS NOT NULL) as hidden
         FROM tracks t
         WHERE COALESCE(t.title, '') != '' AND EXISTS (
            SELECT 1 FROM tracks t2 WHERE t2.id != t.id
              AND lower(COALESCE(t2.title, '')) = lower(COALESCE(t.title, ''))
              AND lower(COALESCE(t2.artist, '')) = lower(COALESCE(t.artist, ''))
         )
         ORDER BY lower(COALESCE(artist, '')), lower(COALESCE(title, '')), id",
        DUP_FLAG_SQL
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query error: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DuplicateCandidate {
                track: map_track_row(row)?,
                hidden: row.get::<_, i32>(24)? != 0,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    Ok(rows.flatten().collect())
}

/// Hide a track behind a keeper (duplicate_of = keeper id) or unhide it (None).
pub fn set_track_hidden(
    conn: &Connection,
    track_id: i64,
    duplicate_of: Option<i64>,
) -> Result<(), String> {
    if duplicate_of == Some(track_id) {
        return Err("A track cannot be a duplicate of itself".to_string());
    }
    conn.execute(
        "UPDATE tracks SET duplicate_of = ?1 WHERE id = ?2",
        params![duplicate_of, track_id],
    )
    .map_err(|e| format!("Failed to update track: {}", e))?;
    Ok(())
}

/// Collapse byte-identical files into one visible track.
/// Files are grouped by size (cheap), then size-collisions are compared by
/// content. Losers get `duplicate_of` set and disappear from the library;
/// nothing is deleted from disk. Returns how many tracks were hidden.
pub fn collapse_identical_duplicates(conn: &Connection) -> Result<u32, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, file_size FROM tracks
             WHERE duplicate_of IS NULL AND file_size IS NOT NULL AND file_size > 0
             ORDER BY file_size, id",
        )
        .map_err(|e| format!("Query error: {}", e))?;

    let rows: Vec<(i64, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| format!("Query error: {}", e))?
        .flatten()
        .collect();

    // Group by file size
    let mut by_size: std::collections::HashMap<i64, Vec<(i64, String)>> =
        std::collections::HashMap::new();
    for (id, path, size) in rows {
        by_size.entry(size).or_default().push((id, path));
    }

    let mut collapsed = 0u32;

    for (_, group) in by_size.into_iter().filter(|(_, g)| g.len() > 1) {
        // Read contents once per candidate (skip unreadable files)
        let mut contents: Vec<(i64, Vec<u8>)> = Vec::new();
        for (id, path) in &group {
            if let Ok(bytes) = std::fs::read(path) {
                contents.push((*id, bytes));
            }
        }

        // Byte-compare within the size group; keeper = lowest id
        let mut claimed = vec![false; contents.len()];
        for i in 0..contents.len() {
            if claimed[i] {
                continue;
            }
            for j in (i + 1)..contents.len() {
                if claimed[j] || contents[i].1 != contents[j].1 {
                    continue;
                }
                claimed[j] = true;
                conn.execute(
                    "UPDATE tracks SET duplicate_of = ?1 WHERE id = ?2",
                    params![contents[i].0, contents[j].0],
                )
                .map_err(|e| format!("Failed to mark duplicate: {}", e))?;
                collapsed += 1;
            }
        }
    }

    Ok(collapsed)
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
        "INSERT INTO playlists (name, sort_order)
         VALUES (?1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM playlists))",
        params![name],
    )
    .map_err(|e| format!("Failed to create playlist: {}", e))?;
    Ok(conn.last_insert_rowid())
}

/// Move a playlist from one sidebar position to another (0-based, in
/// sort_order) and rewrite sort_order to stay contiguous.
pub fn reorder_playlists(conn: &Connection, from: usize, to: usize) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id FROM playlists ORDER BY sort_order, id")
        .map_err(|e| format!("Query error: {}", e))?;
    let ids: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Query error: {}", e))?
        .flatten()
        .collect();

    if from >= ids.len() || to >= ids.len() {
        return Err(format!("Reorder index out of range ({} -> {} of {})", from, to, ids.len()));
    }

    let mut order = ids;
    let moved = order.remove(from);
    order.insert(to, moved);

    conn.execute_batch("BEGIN")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    for (pos, id) in order.iter().enumerate() {
        if let Err(e) = conn.execute(
            "UPDATE playlists SET sort_order = ?1 WHERE id = ?2",
            params![(pos + 1) as i64, id],
        ) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("Failed to reorder playlists: {}", e));
        }
    }
    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit reorder: {}", e))?;
    Ok(())
}

pub fn rename_playlist(conn: &Connection, playlist_id: i64, name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Playlist name cannot be empty".to_string());
    }
    conn.execute(
        "UPDATE playlists SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![trimmed, playlist_id],
    )
    .map_err(|e| format!("Failed to rename playlist: {}", e))?;
    Ok(())
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
             ORDER BY p.sort_order, p.id",
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

/// Move a playlist entry from one index to another (0-based, in position
/// order) and rewrite all positions to stay contiguous.
pub fn reorder_playlist_track(
    conn: &Connection,
    playlist_id: i64,
    from: usize,
    to: usize,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
        .map_err(|e| format!("Query error: {}", e))?;
    let ids: Vec<i64> = stmt
        .query_map(params![playlist_id], |row| row.get(0))
        .map_err(|e| format!("Query error: {}", e))?
        .flatten()
        .collect();

    if from >= ids.len() || to >= ids.len() {
        return Err(format!(
            "Reorder index out of range ({} -> {} of {})",
            from,
            to,
            ids.len()
        ));
    }

    let mut order = ids;
    let moved = order.remove(from);
    order.insert(to, moved);

    conn.execute_batch("BEGIN")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    for (pos, id) in order.iter().enumerate() {
        if let Err(e) = conn.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE id = ?2",
            params![(pos + 1) as i64, id],
        ) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("Failed to reorder: {}", e));
        }
    }
    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit reorder: {}", e))?;
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
    let sql = format!(
        "SELECT t.id, t.file_path, t.file_name, t.title, t.artist, t.album_artist, t.album,
                t.genre, t.year, t.track_number, t.disc_number, t.bpm, t.duration_seconds,
                t.format, t.bitrate, t.sample_rate, t.bit_depth, t.channels, t.has_album_art,
                t.art_path, t.album_art_color, t.play_count, t.favorited, {} as dup_flag
         FROM tracks t
         JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ?1
         ORDER BY pt.position",
        DUP_FLAG_SQL
    );
    let mut stmt = conn
        .prepare(&sql)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn playlists_have_stable_manual_order() {
        let conn = test_conn();
        let a = create_playlist(&conn, "Alpha").unwrap();
        let _b = create_playlist(&conn, "Beta").unwrap();
        let _c = create_playlist(&conn, "Gamma").unwrap();

        // Default order = creation order
        let names: Vec<String> = get_playlists(&conn).unwrap().iter().map(|p| p.name.clone()).collect();
        assert_eq!(names, vec!["Alpha", "Beta", "Gamma"]);

        // Move Alpha to the end
        reorder_playlists(&conn, 0, 2).unwrap();
        let names: Vec<String> = get_playlists(&conn).unwrap().iter().map(|p| p.name.clone()).collect();
        assert_eq!(names, vec!["Beta", "Gamma", "Alpha"]);

        // Renaming must not disturb the manual order
        rename_playlist(&conn, a, "Zeta").unwrap();
        let names: Vec<String> = get_playlists(&conn).unwrap().iter().map(|p| p.name.clone()).collect();
        assert_eq!(names, vec!["Beta", "Gamma", "Zeta"]);

        assert!(reorder_playlists(&conn, 0, 9).is_err());
    }

    #[test]
    fn rename_playlist_updates_name() {
        let conn = test_conn();
        let id = create_playlist(&conn, "old name").unwrap();
        rename_playlist(&conn, id, "new name").unwrap();
        let names: Vec<String> = get_playlists(&conn).unwrap().iter().map(|p| p.name.clone()).collect();
        assert_eq!(names, vec!["new name"]);
        // Blank names are rejected
        assert!(rename_playlist(&conn, id, "   ").is_err());
    }

    #[test]
    fn duplicate_candidates_include_hidden_and_hiding_removes_from_library() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tracks (file_path, file_name, title, artist, bitrate) VALUES
             ('C:/a.flac', 'a.flac', 'Same Song', 'Artist', 1411),
             ('C:/b.mp3', 'b.mp3', 'Same Song', 'Artist', 320),
             ('C:/c.flac', 'c.flac', 'Other Song', 'Artist', 1411)",
            [],
        )
        .unwrap();

        // Both same-titled tracks are candidates; the unrelated one is not
        let cands = get_duplicate_candidates(&conn).unwrap();
        assert_eq!(cands.len(), 2);
        assert!(cands.iter().all(|c| !c.hidden));

        // Hide the low-bitrate copy (keeper = track 1)
        set_track_hidden(&conn, 2, Some(1)).unwrap();
        let visible = get_tracks(&conn, "title", "asc", None).unwrap();
        assert!(visible.iter().all(|t| t.file_name != "b.mp3"), "hidden track must leave the library");
        // The kept track's d!? flag clears once its twin is hidden
        assert!(!visible.iter().find(|t| t.file_name == "a.flac").unwrap().dup_flag);

        // Candidates still list the hidden one, marked hidden, so it can be unticked
        let cands = get_duplicate_candidates(&conn).unwrap();
        assert_eq!(cands.len(), 2);
        assert!(cands.iter().find(|c| c.track.file_name == "b.mp3").unwrap().hidden);

        // Unhide restores it
        set_track_hidden(&conn, 2, None).unwrap();
        let visible = get_tracks(&conn, "title", "asc", None).unwrap();
        assert!(visible.iter().any(|t| t.file_name == "b.mp3"));
    }

    #[test]
    fn reorder_playlist_moves_track_and_keeps_positions_contiguous() {
        let conn = test_conn();
        for i in 1..=3 {
            conn.execute(
                "INSERT INTO tracks (file_path, file_name) VALUES (?1, ?2)",
                params![format!("C:/t{i}.flac"), format!("t{i}.flac")],
            )
            .unwrap();
        }
        let pl = create_playlist(&conn, "p").unwrap();
        for i in 1..=3 {
            add_track_to_playlist(&conn, pl, i).unwrap();
        }

        // Move the first entry to the end: [1,2,3] -> [2,3,1]
        reorder_playlist_track(&conn, pl, 0, 2).unwrap();
        let names: Vec<String> = get_playlist_tracks(&conn, pl)
            .unwrap()
            .iter()
            .map(|t| t.file_name.clone())
            .collect();
        assert_eq!(names, vec!["t2.flac", "t3.flac", "t1.flac"]);

        // Move it back to the front: [2,3,1] -> [1,2,3]
        reorder_playlist_track(&conn, pl, 2, 0).unwrap();
        let names: Vec<String> = get_playlist_tracks(&conn, pl)
            .unwrap()
            .iter()
            .map(|t| t.file_name.clone())
            .collect();
        assert_eq!(names, vec!["t1.flac", "t2.flac", "t3.flac"]);

        // Out-of-range indices are rejected
        assert!(reorder_playlist_track(&conn, pl, 0, 5).is_err());
    }
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
