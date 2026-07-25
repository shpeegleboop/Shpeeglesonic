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

        -- dup_flag's EXISTS probe (same_recording_sql) gates on lower()-wrapped
        -- title+artist. Without an index over those exact expressions the
        -- subquery rescans the whole table per row — quadratic, and at 4000
        -- tracks that was 2.85s on every library query.
        CREATE INDEX IF NOT EXISTS idx_tracks_dup_probe
            ON tracks(lower(COALESCE(title,'')), lower(COALESCE(artist,'')));
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
    // Added 2026-07-25 for incremental scanning. NULL on every pre-existing
    // row; scanner::classify trusts a matching file_size and heals it.
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN file_mtime INTEGER", []);
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN sort_order INTEGER", []);
    // Backfill manual order for pre-migration playlists (creation order)
    let _ = conn.execute("UPDATE playlists SET sort_order = id WHERE sort_order IS NULL", []);

    // Repair links written by the old title+artist-only matcher. Self-healing
    // rather than one-shot: it also cleans up after a metadata edit that
    // reveals a hidden row was never a duplicate.
    match release_stale_duplicate_links(conn) {
        Ok(n) if n > 0 => eprintln!("Restored {n} track(s) hidden as duplicates in error"),
        Err(e) => eprintln!("Could not check for stale duplicate links: {e}"),
        _ => {}
    }

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
            bitrate, sample_rate, bit_depth, channels, has_album_art, art_path,
            file_mtime
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
        ON CONFLICT(file_path) DO UPDATE SET
            file_name=?2, file_size=?3, format=?4, title=?5, artist=?6, album_artist=?7,
            album=?8, genre=?9, year=?10, track_number=?11, disc_number=?12, bpm=?13,
            duration_seconds=?14, bitrate=?15, sample_rate=?16, bit_depth=?17, channels=?18,
            has_album_art=?19, art_path=?20, file_mtime=?21",
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
            meta.file_mtime,
        ],
    )
    .map_err(|e| format!("Failed to upsert track: {}", e))?;

    Ok(conn.last_insert_rowid())
}

/// Everything the DB knows about files under `folder`, keyed by path — the
/// `known` side of scanner::classify. One query instead of 4000.
pub fn get_known_files(
    conn: &Connection,
    folder: &str,
) -> Result<std::collections::HashMap<String, crate::library::scanner::KnownRow>, String> {
    let mut stmt = conn
        .prepare("SELECT file_path, file_size, file_mtime FROM tracks WHERE file_path LIKE ?1")
        .map_err(|e| format!("Query error: {}", e))?;

    // LIKE 'folder%' keeps the scan scoped, so a missing-file list can never
    // include tracks from a library folder that wasn't scanned.
    let pattern = format!("{}%", folder);
    let rows = stmt
        .query_map(params![pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                crate::library::scanner::KnownRow { size: row.get(1)?, mtime: row.get(2)? },
            ))
        })
        .map_err(|e| format!("Query error: {}", e))?;

    Ok(rows.flatten().collect())
}

/// Backfills file_mtime for a file the scan verified as unchanged by size.
pub fn set_file_mtime(conn: &Connection, path: &str, mtime: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE tracks SET file_mtime = ?1 WHERE file_path = ?2",
        params![mtime, path],
    )
    .map_err(|e| format!("Failed to set mtime: {}", e))?;
    Ok(())
}

/// Remove tracks by exact file path. Returns how many rows went away.
pub fn delete_tracks_by_path(conn: &Connection, paths: &[String]) -> Result<u32, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut removed = 0u32;
    for path in paths {
        removed += tx
            .execute("DELETE FROM tracks WHERE file_path = ?1", params![path])
            .map_err(|e| format!("Failed to delete track: {}", e))? as u32;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(removed)
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

/// How far two runtimes may drift and still be the same recording.
///
/// Measured over a ~4,000-track library: 90% of title+artist collisions sit
/// within 5s of each other — the same recording ripped twice — while the tail
/// past it is dominated by alternate takes (demos, live cuts, re-recordings)
/// that merely share a name. Loosening this trades wrong groupings for missed
/// suggestions, and wrong groupings are the expensive direction: the duplicates
/// browser bulk-hides a whole group on one click.
const DUP_DURATION_TOLERANCE_SECS: f64 = 5.0;

/// Album-name markers for a release carrying alternate recordings rather than
/// the canonical one. Matched as whole words, so "Alive" doesn't trip "live".
///
/// A studio album that happens to contain one of these in its name (Hole's
/// "Live Through This") only loses dedup *suggestions* for its tracks — it
/// never causes anything to be hidden — so the false-positive direction here
/// is the harmless one.
const ALT_RELEASE_KEYWORDS: &[&str] = &[
    "live", "unplugged", "acoustic", "demo", "demos", "session", "sessions", "remix", "remixes",
];

/// `alias.album` normalized for comparison: lowercased, with the two apostrophe
/// forms folded together. Taggers disagree on ' vs ’ constantly — a single
/// library holds both "(What's The Story)" and "(What’s the Story)" — and a
/// raw comparison would read those as different releases.
fn album_key_expr(alias: &str) -> String {
    format!(
        "replace(lower(COALESCE({}.album, '')), '\u{2019}', '''')",
        alias
    )
}

/// True when `alias`'s album names a release of alternate recordings.
///
/// GLOB rather than LIKE: `[^a-z]` on both sides pins the keyword to a whole
/// word against any punctuation, so "(demo)", "Live: London" and "[Acoustic]"
/// all register while "Alive" and "Sessions" ⊅ "Obsession" do not.
fn is_alt_release_expr(alias: &str) -> String {
    let padded = format!("(' ' || {} || ' ')", album_key_expr(alias));
    let clauses: Vec<String> = ALT_RELEASE_KEYWORDS
        .iter()
        .map(|kw| format!("{} GLOB '*[^a-z]{}[^a-z]*'", padded, kw))
        .collect();
    format!("({})", clauses.join(" OR "))
}

/// The single definition of "these two `tracks` rows are the same recording",
/// shared by the d!? badge and the duplicates browser so the two can never
/// disagree about what counts as a duplicate.
///
/// Title+artist is only the *candidate gate* — the part `idx_tracks_dup_probe`
/// can serve — because it cannot tell a studio cut from its demo, live take or
/// acoustic re-record. Everything after it is a disqualifier:
///
/// 1. Runtime drift past `DUP_DURATION_TOLERANCE_SECS` means a different take.
///    Skipped when either side has no duration, so an unscanned row still
///    matches on title+artist rather than silently dropping out.
/// 2. Different discs of one release hold different versions by construction —
///    album / B-sides / demos box sets tag every disc with the same album name,
///    which is exactly how Oasis' *Be Here Now* deluxe collides with itself.
/// 3. A live/acoustic/demo release's copy is a different performance unless it
///    is literally the same release ripped twice. This also separates two
///    different live albums from each other.
fn same_recording_sql(a: &str, b: &str) -> String {
    let album_a = album_key_expr(a);
    let album_b = album_key_expr(b);
    format!(
        "lower(COALESCE({b}.title, '')) = lower(COALESCE({a}.title, ''))
         AND lower(COALESCE({b}.artist, '')) = lower(COALESCE({a}.artist, ''))
         AND ({a}.duration_seconds IS NULL OR {b}.duration_seconds IS NULL
              OR abs({a}.duration_seconds - {b}.duration_seconds) <= {tol})
         AND NOT ({a}.disc_number IS NOT NULL AND {b}.disc_number IS NOT NULL
                  AND {a}.disc_number <> {b}.disc_number
                  AND {album_a} = {album_b})
         AND (NOT ({alt_a} OR {alt_b}) OR {album_a} = {album_b})",
        a = a,
        b = b,
        tol = DUP_DURATION_TOLERANCE_SECS,
        album_a = album_a,
        album_b = album_b,
        alt_a = is_alt_release_expr(a),
        alt_b = is_alt_release_expr(b),
    )
}

/// SQL fragment computing dup_flag for a `tracks t` row.
fn dup_flag_sql() -> String {
    format!(
        "CASE WHEN COALESCE(t.dup_reviewed, 0) = 0 AND COALESCE(t.title, '') != '' AND EXISTS(
            SELECT 1 FROM tracks t2 WHERE t2.id != t.id AND t2.duplicate_of IS NULL AND {}
          ) THEN 1 ELSE 0 END",
        same_recording_sql("t", "t2")
    )
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
        dup_flag_sql(), where_clause, order_col, order_dir
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

/// A duplicate-browser row: the track, whether it's currently hidden
/// (duplicate_of set), and which set of same-recording rows it belongs to.
/// Hidden tracks stay listed so they can be unhidden.
#[derive(Clone, serde::Serialize)]
pub struct DuplicateCandidate {
    #[serde(flatten)]
    pub track: Track,
    pub hidden: bool,
    /// Rows sharing a group_id are the same recording. The browser groups on
    /// this instead of re-deriving it from title+artist, so what it displays —
    /// and what its bulk-hide button acts on — can't drift from the matcher.
    pub group_id: i64,
}

/// Every pair of track ids the matcher considers the same recording.
/// Sourced from SQL so this and the d!? badge can't drift apart;
/// `b.id > a.id` yields each unordered pair exactly once.
fn matcher_pairs(conn: &Connection) -> Result<Vec<(i64, i64)>, String> {
    let sql = format!(
        "SELECT a.id, b.id FROM tracks a JOIN tracks b ON b.id > a.id
         WHERE COALESCE(a.title, '') != '' AND {}",
        same_recording_sql("a", "b")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query error: {}", e))?;
    let pairs = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Query error: {}", e))?
        .flatten()
        .collect();
    Ok(pairs)
}

fn find_root(parent: &mut std::collections::HashMap<i64, i64>, id: i64) -> i64 {
    let p = *parent.get(&id).unwrap_or(&id);
    if p == id {
        return id;
    }
    let root = find_root(parent, p);
    parent.insert(id, root);
    root
}

/// Merge pairs into connected components, mapping every id to its group's root.
///
/// The predicate is pairwise, but a run of near-identical rips should surface as
/// one row set rather than fragmenting into overlapping pairs, so anything
/// transitively connected merges. The lowest id wins the root, keeping group ids
/// stable between runs.
fn group_by_component(pairs: &[(i64, i64)]) -> std::collections::HashMap<i64, i64> {
    let mut parent: std::collections::HashMap<i64, i64> = Default::default();
    for &(a, b) in pairs {
        parent.entry(a).or_insert(a);
        parent.entry(b).or_insert(b);
        let (ra, rb) = (find_root(&mut parent, a), find_root(&mut parent, b));
        if ra != rb {
            let (root, child) = if ra < rb { (ra, rb) } else { (rb, ra) };
            parent.insert(child, root);
        }
    }
    let ids: Vec<i64> = parent.keys().copied().collect();
    ids.iter()
        .map(|&id| (id, find_root(&mut parent, id)))
        .collect()
}

/// Every track (visible or hidden) that `same_recording_sql` ties to at least
/// one other track, tagged with its group — the duplicates browser's working set.
pub fn get_duplicate_candidates(conn: &Connection) -> Result<Vec<DuplicateCandidate>, String> {
    let mut pairs = matcher_pairs(conn)?;

    // An already-hidden track belongs with whatever it was hidden behind, even
    // if the matcher wouldn't pair them today — an edit to either row's metadata
    // must never strand a hidden track outside every group, because the browser
    // is the only way to unhide one. `release_stale_duplicate_links` clears the
    // links that are wrong rather than merely surprising, so what survives here
    // is a link worth honouring.
    let mut stmt = conn
        .prepare("SELECT duplicate_of, id FROM tracks WHERE duplicate_of IS NOT NULL")
        .map_err(|e| format!("Query error: {}", e))?;
    pairs.extend(
        stmt.query_map([], |row| {
            let (keeper, hidden): (i64, i64) = (row.get(0)?, row.get(1)?);
            Ok((keeper.min(hidden), keeper.max(hidden)))
        })
        .map_err(|e| format!("Query error: {}", e))?
        .flatten()
        .filter(|(a, b)| a != b),
    );

    if pairs.is_empty() {
        return Ok(Vec::new());
    }

    let group_of = group_by_component(&pairs);
    let ids: Vec<i64> = group_of.keys().copied().collect();

    // ids come from the DB, so interpolating them raises no injection concern
    // and keeps us clear of SQLite's bound-parameter ceiling on large libraries.
    let id_list = ids
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id, file_path, file_name, title, artist, album_artist, album, genre,
                year, track_number, disc_number, bpm, duration_seconds, format,
                bitrate, sample_rate, bit_depth, channels, has_album_art, art_path,
                album_art_color, play_count, favorited, {} as dup_flag,
                (t.duplicate_of IS NOT NULL) as hidden
         FROM tracks t
         WHERE t.id IN ({})",
        dup_flag_sql(),
        id_list
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query error: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            let track = map_track_row(row)?;
            let group_id = *group_of.get(&track.id).unwrap_or(&track.id);
            Ok(DuplicateCandidate {
                track,
                hidden: row.get::<_, i32>(24)? != 0,
                group_id,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut out: Vec<DuplicateCandidate> = rows.flatten().collect();
    // Sort here rather than in SQL: two distinct groups can share a title and
    // artist (an album cut and its demo, each present twice), and the browser
    // relies on a group's rows arriving contiguously.
    out.sort_by(|x, y| {
        let key = |c: &DuplicateCandidate| {
            (
                c.track.artist.clone().unwrap_or_default().to_lowercase(),
                c.track.title.clone().unwrap_or_default().to_lowercase(),
                c.group_id,
                c.track.id,
            )
        };
        key(x).cmp(&key(y))
    });
    Ok(out)
}

/// Un-hide tracks whose `duplicate_of` link the current matcher would no longer
/// make, returning how many came back. Older builds paired on title+artist
/// alone, so libraries carry live takes and demos hidden behind the studio cut
/// they merely share a name with — and a hidden row is invisible everywhere
/// except the duplicates browser, so leaving them is not an option.
///
/// A link is stale when the row and its keeper land in different components of
/// the matcher's graph. Comparing components rather than testing the two rows
/// directly matters: hiding picks whichever row in a group is visible, so a row
/// can sit behind a keeper it doesn't pair with one-to-one but reaches through
/// a third copy. Those are sound and must survive.
///
/// Byte-identical files are exempt: `collapse_identical_duplicates` links those
/// on content rather than metadata, and an untitled pair legitimately fails the
/// matcher's title gate. Nothing is deleted either way — this only clears the
/// flag that hides a row from the library.
pub fn release_stale_duplicate_links(conn: &Connection) -> Result<u32, String> {
    let component = group_by_component(&matcher_pairs(conn)?);

    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.duplicate_of FROM tracks a JOIN tracks k ON k.id = a.duplicate_of
             WHERE a.duplicate_of IS NOT NULL
               AND NOT (a.file_size IS NOT NULL AND a.file_size = k.file_size)",
        )
        .map_err(|e| format!("Query error: {}", e))?;
    let links: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Query error: {}", e))?
        .flatten()
        .collect();

    // A row the matcher pairs with nothing is its own component — `unwrap_or(id)`
    // rather than comparing two Nones, which would read "same group" and leave
    // precisely the worst links (a live take behind a studio cut, neither
    // matching anything) in place.
    let stale: Vec<i64> = links
        .into_iter()
        .filter(|(hidden, keeper)| {
            component.get(hidden).copied().unwrap_or(*hidden)
                != component.get(keeper).copied().unwrap_or(*keeper)
        })
        .map(|(hidden, _)| hidden)
        .collect();
    if stale.is_empty() {
        return Ok(0);
    }

    // ids come from the DB, so interpolating them raises no injection concern
    let id_list = stale
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let released = conn
        .execute(
            &format!("UPDATE tracks SET duplicate_of = NULL WHERE id IN ({})", id_list),
            [],
        )
        .map_err(|e| format!("Failed to release stale duplicate links: {}", e))?;
    Ok(released as u32)
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
        dup_flag_sql()
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

    /// Insert one release's copy of a song. Everything the matcher looks at is
    /// a parameter, because that's precisely what these tests vary.
    fn insert_version(
        conn: &Connection,
        path: &str,
        title: &str,
        artist: &str,
        album: &str,
        disc: Option<i32>,
        duration: f64,
    ) -> i64 {
        conn.execute(
            "INSERT INTO tracks (file_path, file_name, title, artist, album, disc_number, duration_seconds)
             VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6)",
            params![path, title, artist, album, disc, duration],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// Track ids the library view marks with the d!? badge.
    fn flagged_ids(conn: &Connection) -> Vec<i64> {
        let mut ids: Vec<i64> = get_tracks(conn, "title", "asc", None)
            .unwrap()
            .into_iter()
            .filter(|t| t.dup_flag)
            .map(|t| t.id)
            .collect();
        ids.sort();
        ids
    }

    /// Candidate ids the duplicates browser would show, grouped.
    fn candidate_groups(conn: &Connection) -> Vec<Vec<i64>> {
        let mut by_group: std::collections::BTreeMap<i64, Vec<i64>> = Default::default();
        for c in get_duplicate_candidates(conn).unwrap() {
            by_group.entry(c.group_id).or_default().push(c.track.id);
        }
        by_group
            .into_values()
            .map(|mut g| {
                g.sort();
                g
            })
            .collect()
    }

    #[test]
    fn same_recording_ripped_twice_is_still_a_duplicate() {
        let conn = test_conn();
        // The Masterplan's "Half the World Away" is the Definitely Maybe
        // recording — different album, near-identical runtime.
        insert_version(&conn, "C:/dm.flac", "Half the World Away", "Oasis", "Definitely Maybe", Some(1), 264.0);
        insert_version(&conn, "C:/mp.flac", "Half the World Away", "Oasis", "The Masterplan", Some(1), 262.0);

        assert_eq!(flagged_ids(&conn), vec![1, 2]);
        assert_eq!(candidate_groups(&conn), vec![vec![1, 2]]);
    }

    #[test]
    fn runtime_drift_past_the_tolerance_is_a_different_take() {
        let conn = test_conn();
        insert_version(&conn, "C:/a.flac", "D'You Know What I Mean?", "Oasis", "Be Here Now", None, 463.0);
        insert_version(&conn, "C:/b.flac", "D'You Know What I Mean?", "Oasis", "Be Here Now", None, 436.0);

        assert!(flagged_ids(&conn).is_empty(), "27s apart is a different recording");
        assert!(candidate_groups(&conn).is_empty());
    }

    #[test]
    fn different_discs_of_one_release_hold_different_versions() {
        let conn = test_conn();
        // Be Here Now deluxe: CD1 is the album, CD3 the Mustique demos. Both
        // tagged album="Be Here Now", and these two runtimes are within the
        // duration tolerance — only the disc number separates them.
        insert_version(&conn, "C:/cd1.flac", "Stand by Me", "Oasis", "Be Here Now", Some(1), 356.0);
        insert_version(&conn, "C:/cd3.flac", "Stand by Me", "Oasis", "Be Here Now", Some(3), 361.0);

        assert!(flagged_ids(&conn).is_empty(), "disc 1 vs disc 3 is album vs demo");
        assert!(candidate_groups(&conn).is_empty());

        // Same disc, same runtime — that really is the file twice over
        insert_version(&conn, "C:/cd1-copy.flac", "Stand by Me", "Oasis", "Be Here Now", Some(1), 356.0);
        assert_eq!(flagged_ids(&conn), vec![1, 3]);
    }

    #[test]
    fn a_live_release_is_not_the_studio_cut() {
        let conn = test_conn();
        // Runtimes deliberately inside the duration tolerance: only the album
        // naming a live release tells these apart.
        insert_version(&conn, "C:/studio.flac", "Root", "Deftones", "Adrenaline", Some(1), 221.0);
        insert_version(&conn, "C:/live.flac", "Root", "Deftones", "Live at Dynamo Open Air 1998", Some(1), 223.0);

        assert!(flagged_ids(&conn).is_empty());
        assert!(candidate_groups(&conn).is_empty());
    }

    #[test]
    fn two_live_albums_are_two_performances() {
        let conn = test_conn();
        insert_version(&conn, "C:/syd.flac", "Evan Finds the Third Room", "Khruangbin", "Live at Sydney Opera House", Some(1), 329.0);
        insert_version(&conn, "C:/rbc.flac", "Evan Finds the Third Room", "Khruangbin", "Live at RBC Echo Beach", Some(1), 325.0);

        assert!(flagged_ids(&conn).is_empty(), "different venues, different takes");
    }

    #[test]
    fn the_same_live_album_ripped_twice_is_a_duplicate() {
        let conn = test_conn();
        insert_version(&conn, "C:/x.flac", "Evan Finds the Third Room", "Khruangbin", "Live at Sydney Opera House", Some(1), 329.0);
        insert_version(&conn, "C:/y.flac", "Evan Finds the Third Room", "Khruangbin", "Live at Sydney Opera House", Some(1), 329.0);

        assert_eq!(flagged_ids(&conn), vec![1, 2]);
    }

    #[test]
    fn alt_release_keywords_match_whole_words_only() {
        let conn = test_conn();
        // "Alive" must not read as "live", or these two stop being duplicates
        insert_version(&conn, "C:/p.flac", "Black", "Pearl Jam", "Alive", Some(1), 343.0);
        insert_version(&conn, "C:/q.flac", "Black", "Pearl Jam", "Ten", Some(1), 344.0);

        assert_eq!(flagged_ids(&conn), vec![1, 2]);
    }

    #[test]
    fn parenthesised_version_markers_still_register() {
        let conn = test_conn();
        // Punctuation is flattened before matching, so "(demo)" reads as a word
        insert_version(&conn, "C:/alb.flac", "If We Shadows", "Oasis", "Be Here Now", Some(1), 293.0);
        insert_version(&conn, "C:/dem.flac", "If We Shadows", "Oasis", "Be Here Now (demo)", Some(1), 291.0);

        assert!(flagged_ids(&conn).is_empty());
    }

    #[test]
    fn the_two_apostrophes_name_the_same_release() {
        let conn = test_conn();
        // Same live album, tagged by two rippers who disagreed about ’ vs '.
        // Without folding them the pair reads as two different performances.
        insert_version(&conn, "C:/a.flac", "Hello", "Oasis", "Live at Knebworth '96", Some(1), 203.0);
        insert_version(&conn, "C:/b.flac", "Hello", "Oasis", "Live at Knebworth \u{2019}96", Some(1), 203.0);

        assert_eq!(flagged_ids(&conn), vec![1, 2]);
    }

    #[test]
    fn stale_links_from_the_old_matcher_are_released() {
        let conn = test_conn();
        // Exactly the Khruangbin shape: two live takes hidden behind the studio
        // cut they only share a title with.
        let studio = insert_version(&conn, "C:/m.flac", "Time (You and I)", "Khruangbin", "Mordechai", Some(1), 342.0);
        let rcmh = insert_version(&conn, "C:/r.flac", "Time (You and I)", "Khruangbin", "Live at Radio City Music Hall", Some(1), 541.0);
        let syd = insert_version(&conn, "C:/s.flac", "Time (You and I)", "Khruangbin", "Live at Sydney Opera House", Some(1), 367.0);
        set_track_hidden(&conn, rcmh, Some(studio)).unwrap();
        set_track_hidden(&conn, syd, Some(studio)).unwrap();
        assert_eq!(get_tracks(&conn, "title", "asc", None).unwrap().len(), 1);

        assert_eq!(release_stale_duplicate_links(&conn).unwrap(), 2);
        assert_eq!(get_tracks(&conn, "title", "asc", None).unwrap().len(), 3);
        assert!(get_duplicate_candidates(&conn).unwrap().is_empty());

        // Idempotent — a second pass has nothing left to do
        assert_eq!(release_stale_duplicate_links(&conn).unwrap(), 0);
    }

    #[test]
    fn a_link_through_a_third_copy_survives_the_repair() {
        let conn = test_conn();
        // A-B and B-C pair, A-C are 10s apart and don't. Hiding C picks the
        // first visible row as keeper, which can be A — a sound link the repair
        // must not mistake for a stale one.
        let a = insert_version(&conn, "C:/a.flac", "Wonderwall", "Oasis", "Morning Glory", Some(1), 258.0);
        let b = insert_version(&conn, "C:/b.flac", "Wonderwall", "Oasis", "Morning Glory", Some(1), 263.0);
        let c = insert_version(&conn, "C:/c.flac", "Wonderwall", "Oasis", "Morning Glory", Some(1), 268.0);
        set_track_hidden(&conn, b, Some(a)).unwrap();
        set_track_hidden(&conn, c, Some(a)).unwrap();

        assert_eq!(release_stale_duplicate_links(&conn).unwrap(), 0);
        assert_eq!(get_tracks(&conn, "title", "asc", None).unwrap().len(), 1);
    }

    #[test]
    fn a_genuine_hidden_duplicate_survives_the_repair() {
        let conn = test_conn();
        let keeper = insert_version(&conn, "C:/a.flac", "Live Forever", "Oasis", "Definitely Maybe", Some(1), 277.0);
        let dupe = insert_version(&conn, "C:/b.mp3", "Live Forever", "Oasis", "Definitely Maybe", Some(1), 277.0);
        set_track_hidden(&conn, dupe, Some(keeper)).unwrap();

        assert_eq!(release_stale_duplicate_links(&conn).unwrap(), 0);
        assert_eq!(get_tracks(&conn, "title", "asc", None).unwrap().len(), 1);
    }

    #[test]
    fn byte_identical_untitled_files_stay_collapsed() {
        let conn = test_conn();
        // No title means the matcher's gate can't see these, but
        // collapse_identical_duplicates linked them on content — leave it be.
        conn.execute(
            "INSERT INTO tracks (file_path, file_name, file_size) VALUES
             ('C:/a.mp3', 'a.mp3', 4096), ('C:/b.mp3', 'b.mp3', 4096)",
            [],
        )
        .unwrap();
        set_track_hidden(&conn, 2, Some(1)).unwrap();

        assert_eq!(release_stale_duplicate_links(&conn).unwrap(), 0);
        assert_eq!(get_tracks(&conn, "title", "asc", None).unwrap().len(), 1);
    }

    #[test]
    fn a_hidden_track_stays_reachable_after_it_stops_matching() {
        let conn = test_conn();
        let keeper = insert_version(&conn, "C:/a.flac", "Stay Young", "Oasis", "The Masterplan", Some(1), 305.0);
        let hidden = insert_version(&conn, "C:/b.flac", "Stay Young", "Oasis", "The Masterplan", Some(1), 305.0);
        set_track_hidden(&conn, hidden, Some(keeper)).unwrap();

        // Retag the hidden row as the demo it actually is — the matcher now
        // says these two are unrelated, but the browser must still offer it
        // back, or it is stranded: hidden from the library, absent here.
        conn.execute(
            "UPDATE tracks SET album = 'Mustique Demos', duration_seconds = 296.0 WHERE id = ?1",
            params![hidden],
        )
        .unwrap();

        let cands = get_duplicate_candidates(&conn).unwrap();
        let row = cands
            .iter()
            .find(|c| c.track.id == hidden)
            .expect("hidden track must remain listed so it can be unhidden");
        assert!(row.hidden);
        assert_eq!(
            row.group_id,
            cands.iter().find(|c| c.track.id == keeper).unwrap().group_id,
            "it should sit with the track it was hidden behind"
        );

        set_track_hidden(&conn, hidden, None).unwrap();
        assert_eq!(get_tracks(&conn, "title", "asc", None).unwrap().len(), 2);
    }

    #[test]
    fn a_group_drops_the_odd_version_out() {
        let conn = test_conn();
        // Two real copies plus one demo that merely shares the name. The demo
        // must not land in the group — the browser bulk-hides whole groups.
        insert_version(&conn, "C:/1.flac", "Stay Young", "Oasis", "The Masterplan", Some(1), 305.0);
        insert_version(&conn, "C:/2.mp3", "Stay Young", "Oasis", "The Masterplan", Some(1), 305.0);
        insert_version(&conn, "C:/3.flac", "Stay Young", "Oasis", "Mustique Demos", Some(1), 296.0);

        assert_eq!(candidate_groups(&conn), vec![vec![1, 2]]);
    }

    #[test]
    fn missing_durations_stay_matchable() {
        let conn = test_conn();
        // Nothing to compare — fall back to title+artist rather than silently
        // dropping the pair.
        conn.execute(
            "INSERT INTO tracks (file_path, file_name, title, artist) VALUES
             ('C:/a.flac', 'a.flac', 'Same Song', 'Artist'),
             ('C:/b.mp3', 'b.mp3', 'Same Song', 'Artist')",
            [],
        )
        .unwrap();
        assert_eq!(flagged_ids(&conn), vec![1, 2]);
    }

    #[test]
    fn removing_a_track_leaves_the_playlist_reorderable() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tracks (file_path, file_name, title) VALUES
             ('C:/1.flac', '1.flac', 'One'),
             ('C:/2.flac', '2.flac', 'Two'),
             ('C:/3.flac', '3.flac', 'Three')",
            [],
        )
        .unwrap();
        let pl = create_playlist(&conn, "Mix").unwrap();
        for id in 1..=3 {
            add_track_to_playlist(&conn, pl, id).unwrap();
        }

        remove_track_from_playlist(&conn, pl, 2).unwrap();
        let titles = |c: &Connection| -> Vec<String> {
            get_playlist_tracks(c, pl)
                .unwrap()
                .into_iter()
                .map(|t| t.title.unwrap_or_default())
                .collect()
        };
        assert_eq!(titles(&conn), vec!["One", "Three"]);

        // Removal leaves a gap in `position`; reorder works off rank, not the
        // raw values, so the shortened list still moves correctly.
        reorder_playlist_track(&conn, pl, 1, 0).unwrap();
        assert_eq!(titles(&conn), vec!["Three", "One"]);

        // A later add must not collide with the surviving positions
        add_track_to_playlist(&conn, pl, 2).unwrap();
        assert_eq!(titles(&conn), vec!["Three", "One", "Two"]);
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

    /// Seeds `n` tracks with realistic field widths and a deliberate crop of
    /// title+artist twins, so the dup_flag EXISTS probe has real work to do.
    fn seed_tracks(conn: &Connection, n: usize) {
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..n {
            tx.execute(
                "INSERT INTO tracks (file_path, file_name, title, artist, album, genre,
                                     year, duration_seconds, format, file_size)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    format!("D:\\Music\\artist{}\\album{}\\track{}.flac", i % 200, i % 400, i),
                    format!("track{}.flac", i),
                    // Wrapping the title below n leaves ~100 duplicate
                    // title+artist pairs, so dup_flag's probe has real work.
                    // saturating_sub keeps small-n callers from underflowing.
                    format!(
                        "Some Reasonably Long Track Title Number {}",
                        i % n.saturating_sub(100).max(1)
                    ),
                    format!("Artist Name {}", i % 200),
                    format!("Album Title {}", i % 400),
                    "Electronic",
                    2020,
                    245.5_f64,
                    "flac",
                    41_000_000_i64 + i as i64,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }

    #[test]
    fn prune_deletes_only_the_given_paths() {
        let conn = test_conn();
        seed_tracks(&conn, 5);
        let victim = "D:\\Music\\artist2\\album2\\track2.flac".to_string();

        let removed = delete_tracks_by_path(&conn, &[victim.clone()]).unwrap();

        assert_eq!(removed, 1);
        let left = get_tracks(&conn, "title", "asc", None).unwrap();
        assert_eq!(left.len(), 4);
        assert!(!left.iter().any(|t| t.file_path == victim));
    }

    #[test]
    fn known_files_are_scoped_to_the_folder() {
        let conn = test_conn();
        seed_tracks(&conn, 3);
        conn.execute(
            "INSERT INTO tracks (file_path, file_name) VALUES ('E:\\Other\\x.flac', 'x.flac')",
            [],
        )
        .unwrap();

        let known = get_known_files(&conn, "D:\\Music").unwrap();

        assert_eq!(known.len(), 3, "a track outside the scanned folder leaked in");
    }

    /// The dup_flag badge is computed by a correlated subquery. Without an index
    /// on its lower()-wrapped probe columns the cost is rows × table_size —
    /// measured at 2.85s for 4000 tracks, which made search unusable. This test
    /// fails if that index stops being used.
    #[test]
    fn library_query_stays_fast_at_scale() {
        let conn = test_conn();
        seed_tracks(&conn, 4000);

        let started = std::time::Instant::now();
        let tracks = get_tracks(&conn, "artist", "asc", None).unwrap();
        let elapsed = started.elapsed();

        assert_eq!(tracks.len(), 4000);
        assert!(
            elapsed < std::time::Duration::from_millis(500),
            "get_tracks took {:?} for 4000 tracks — the idx_tracks_dup_probe \
             expression index is missing or no longer matches same_recording_sql",
            elapsed
        );
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
