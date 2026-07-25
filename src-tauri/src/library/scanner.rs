use std::collections::HashMap;
use std::path::Path;

use crate::audio::metadata;
use crate::library::db;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "aiff", "aif", "ogg", "m4a", "aac", "wma", "opus",
];

/// An audio file as found on disk, with the stat data the scan diff needs.
pub struct DiskFile {
    pub path: String,
    pub size: u64,
    pub mtime: i64,
}

/// What the database already believes about a file. Both fields are nullable:
/// file_size can be 0 for files that failed to stat, and file_mtime is NULL on
/// every row written before incremental scanning existed.
pub struct KnownRow {
    pub size: Option<i64>,
    pub mtime: Option<i64>,
}

/// The work a scan needs to do, partitioned. `unchanged` files still need their
/// mtime written when it was NULL, but never need a tag parse.
pub struct ScanPlan {
    pub new: Vec<DiskFile>,
    pub changed: Vec<DiskFile>,
    pub unchanged: Vec<DiskFile>,
    pub missing: Vec<String>,
}

/// Diff what's on disk against what the DB knows. Pure — no filesystem, no DB —
/// so the whole incremental rule is directly testable.
///
/// A file is unchanged only when its size AND mtime both match. The one
/// exception: a row with a NULL mtime but a matching size is trusted, because
/// every row written before the file_mtime column existed has NULL there and
/// re-parsing the entire library on the first quick scan would defeat the point.
pub fn classify(disk: &[DiskFile], known: &HashMap<String, KnownRow>) -> ScanPlan {
    let mut plan = ScanPlan {
        new: Vec::new(),
        changed: Vec::new(),
        unchanged: Vec::new(),
        missing: Vec::new(),
    };

    for f in disk {
        let copy = DiskFile { path: f.path.clone(), size: f.size, mtime: f.mtime };
        match known.get(&f.path) {
            None => plan.new.push(copy),
            Some(row) => {
                let size_matches = row.size == Some(f.size as i64);
                let mtime_matches = row.mtime == Some(f.mtime);
                if size_matches && (mtime_matches || row.mtime.is_none()) {
                    plan.unchanged.push(copy);
                } else {
                    plan.changed.push(copy);
                }
            }
        }
    }

    let on_disk: std::collections::HashSet<&String> = disk.iter().map(|f| &f.path).collect();
    plan.missing = known
        .keys()
        .filter(|p| !on_disk.contains(p))
        .cloned()
        .collect();
    plan.missing.sort();

    plan
}

/// The outcome of a scan, for the UI to report.
#[derive(Default, serde::Serialize)]
pub struct ScanSummary {
    pub added: u32,
    pub updated: u32,
    pub skipped: u32,
    pub errors: u32,
    /// Library paths under this folder that are no longer on disk. Reported,
    /// never acted on — pruning is an explicit user confirmation.
    pub missing: Vec<String>,
}

/// How many tracks to parse before taking the DB lock to commit them.
const BATCH_SIZE: usize = 100;

/// Walk `root` for supported audio files. No DB, no lock, no tag parsing —
/// size and mtime come from the directory entry the walk already produced.
pub fn enumerate_audio_files(root: &Path) -> Result<Vec<DiskFile>, String> {
    let mut out = Vec::new();
    walk(root, &mut out);
    Ok(out)
}

fn walk(dir: &Path, out: &mut Vec<DiskFile>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            // Skip hidden directories
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            walk(&path, out);
            continue;
        }

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

        let Ok(meta) = entry.metadata() else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        out.push(DiskFile {
            path: path.to_string_lossy().to_string(),
            size: meta.len(),
            mtime,
        });
    }
}

/// Scan `folder`, parsing only what changed when `incremental`.
///
/// Takes the pool rather than a connection so the lock can be held per batch
/// instead of for the whole scan: tag parsing and art extraction — the
/// expensive part — happen with the mutex released, which is what keeps the UI
/// and playback alive during a scan.
pub fn run_scan(
    pool: &db::DbPool,
    folder: &str,
    art_cache_dir: &Path,
    incremental: bool,
    on_progress: &dyn Fn(u32, u32, &str),
) -> Result<ScanSummary, String> {
    let root = Path::new(folder);
    if !root.is_dir() {
        // Guards the offline-drive case: an unplugged D:\ aborts here rather
        // than reporting the whole library as missing.
        return Err(format!("Not a directory: {}", folder));
    }

    let disk = enumerate_audio_files(root)?;

    let known = {
        let conn = pool.lock().map_err(|e| e.to_string())?;
        db::get_known_files(&conn, folder)?
    };

    let plan = classify(&disk, &known);
    let mut summary = ScanSummary { missing: plan.missing, ..Default::default() };

    // Heal mtimes for files verified unchanged by size, then skip them entirely.
    {
        let conn = pool.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for f in &plan.unchanged {
            if known.get(&f.path).and_then(|r| r.mtime).is_none() {
                db::set_file_mtime(&tx, &f.path, f.mtime)?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    // A full rescan re-parses everything; a quick scan only what's new or changed.
    let mut targets: Vec<(&DiskFile, bool)> = plan
        .new
        .iter()
        .map(|f| (f, true))
        .chain(plan.changed.iter().map(|f| (f, false)))
        .collect();
    if incremental {
        summary.skipped = plan.unchanged.len() as u32;
    } else {
        targets.extend(plan.unchanged.iter().map(|f| (f, false)));
    }

    let total = targets.len() as u32;
    let mut done = 0u32;

    for batch in targets.chunks(BATCH_SIZE) {
        // Parse with the lock RELEASED — this is the expensive part, and doing
        // it under the mutex is what used to freeze the window.
        let mut parsed: Vec<(metadata::TrackMetadata, Option<String>, bool)> = Vec::new();
        for (f, is_new) in batch {
            done += 1;
            match metadata::extract_metadata(&f.path) {
                Ok(meta) => {
                    let art = metadata::extract_album_art(&f.path, art_cache_dir)
                        .or_else(|| metadata::find_folder_art(&f.path));
                    // Throttled so a 4000-file scan doesn't flood the webview.
                    if done % 50 == 0 || done == total {
                        let label = meta.title.clone().unwrap_or_else(|| meta.file_name.clone());
                        on_progress(done, total, &label);
                    }
                    parsed.push((meta, art, *is_new));
                }
                Err(e) => {
                    eprintln!("Metadata error for {}: {}", f.path, e);
                    summary.errors += 1;
                }
            }
        }

        // Commit with the lock held only for this batch.
        let conn = pool.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (meta, art, is_new) in &parsed {
            match db::upsert_track(&tx, meta, art.as_deref()) {
                Ok(_) => {
                    if *is_new {
                        summary.added += 1;
                    } else {
                        summary.updated += 1;
                    }
                }
                Err(e) => {
                    eprintln!("DB error for {}: {}", meta.file_path, e);
                    summary.errors += 1;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    println!(
        "Scan complete: {} added, {} updated, {} skipped, {} errors, {} missing",
        summary.added, summary.updated, summary.skipped, summary.errors, summary.missing.len()
    );

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk(path: &str, size: u64, mtime: i64) -> DiskFile {
        DiskFile { path: path.to_string(), size, mtime }
    }

    fn known(entries: &[(&str, Option<i64>, Option<i64>)]) -> HashMap<String, KnownRow> {
        entries
            .iter()
            .map(|(p, size, mtime)| (p.to_string(), KnownRow { size: *size, mtime: *mtime }))
            .collect()
    }

    #[test]
    fn unknown_paths_are_new() {
        let plan = classify(&[disk("a.flac", 100, 50)], &known(&[]));
        assert_eq!(plan.new.len(), 1);
        assert!(plan.changed.is_empty() && plan.unchanged.is_empty() && plan.missing.is_empty());
    }

    #[test]
    fn matching_size_and_mtime_is_unchanged() {
        let plan = classify(
            &[disk("a.flac", 100, 50)],
            &known(&[("a.flac", Some(100), Some(50))]),
        );
        assert_eq!(plan.unchanged.len(), 1);
        assert!(plan.new.is_empty() && plan.changed.is_empty());
    }

    #[test]
    fn a_different_size_or_mtime_is_changed() {
        let db = known(&[("a.flac", Some(100), Some(50))]);
        assert_eq!(classify(&[disk("a.flac", 999, 50)], &db).changed.len(), 1);
        assert_eq!(classify(&[disk("a.flac", 100, 999)], &db).changed.len(), 1);
    }

    // Rows written before file_mtime existed have NULL mtime. Re-parsing all
    // 4000 of them would make the first quick scan as slow as a full rescan, so
    // a matching size is trusted and the mtime is simply healed.
    #[test]
    fn null_mtime_with_matching_size_is_unchanged() {
        let plan = classify(
            &[disk("a.flac", 100, 50)],
            &known(&[("a.flac", Some(100), None)]),
        );
        assert_eq!(plan.unchanged.len(), 1);
        assert!(plan.changed.is_empty());
    }

    #[test]
    fn null_mtime_with_a_different_size_is_changed() {
        let plan = classify(
            &[disk("a.flac", 999, 50)],
            &known(&[("a.flac", Some(100), None)]),
        );
        assert_eq!(plan.changed.len(), 1);
        assert!(plan.unchanged.is_empty());
    }

    #[test]
    fn a_null_size_cannot_be_verified_and_is_changed() {
        let plan = classify(
            &[disk("a.flac", 100, 50)],
            &known(&[("a.flac", None, None)]),
        );
        assert_eq!(plan.changed.len(), 1);
    }

    #[test]
    fn known_paths_absent_from_disk_are_missing() {
        let plan = classify(
            &[disk("a.flac", 100, 50)],
            &known(&[("a.flac", Some(100), Some(50)), ("gone.flac", Some(1), Some(1))]),
        );
        assert_eq!(plan.missing, vec!["gone.flac".to_string()]);
    }

    /// End-to-end over real files: the whole point of the feature is that a
    /// second scan does no work, so this drives run_scan against a temp folder
    /// built from the decoder test fixtures.
    #[test]
    fn incremental_scan_skips_unchanged_and_notices_edits_and_deletions() {
        let tmp = std::env::temp_dir().join(format!(
            "shpeegle_scan_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let music = tmp.join("music");
        let art = tmp.join("art");
        std::fs::create_dir_all(&music).unwrap();

        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tone.aiff");
        let a = music.join("a.aiff");
        let b = music.join("b.aiff");
        std::fs::copy(&fixture, &a).unwrap();
        std::fs::copy(&fixture, &b).unwrap();

        let pool = db::init_db(&tmp.join("test.db")).unwrap();
        let folder = music.to_string_lossy().to_string();
        let noop = |_: u32, _: u32, _: &str| {};

        // First scan: both files are new.
        let s1 = run_scan(&pool, &folder, &art, true, &noop).unwrap();
        assert_eq!((s1.added, s1.updated, s1.skipped), (2, 0, 0), "first scan");

        // Second scan: nothing touched, so nothing is parsed.
        let s2 = run_scan(&pool, &folder, &art, true, &noop).unwrap();
        assert_eq!((s2.added, s2.updated, s2.skipped), (0, 0, 2), "unchanged rescan");

        // A full rescan re-reads everything even though nothing changed.
        let s3 = run_scan(&pool, &folder, &art, false, &noop).unwrap();
        assert_eq!((s3.added, s3.updated, s3.skipped), (0, 2, 0), "full rescan");

        // Bumping mtime is the "tags edited in another app" case.
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(120);
        std::fs::File::options().write(true).open(&a).unwrap().set_modified(later).unwrap();
        let s4 = run_scan(&pool, &folder, &art, true, &noop).unwrap();
        assert_eq!((s4.added, s4.updated, s4.skipped), (0, 1, 1), "mtime bump");

        // Rows written before file_mtime existed have NULL there; a matching
        // size must be trusted and the mtime healed rather than re-parsed.
        {
            let conn = pool.lock().unwrap();
            conn.execute("UPDATE tracks SET file_mtime = NULL", []).unwrap();
        }
        let s5 = run_scan(&pool, &folder, &art, true, &noop).unwrap();
        assert_eq!((s5.added, s5.updated, s5.skipped), (0, 0, 2), "NULL-mtime heal");
        {
            let conn = pool.lock().unwrap();
            let nulls: i64 = conn
                .query_row("SELECT COUNT(*) FROM tracks WHERE file_mtime IS NULL", [], |r| r.get(0))
                .unwrap();
            assert_eq!(nulls, 0, "heal should have written every mtime");
        }

        // A deleted file is reported, never removed on the scan's own authority.
        std::fs::remove_file(&b).unwrap();
        let s6 = run_scan(&pool, &folder, &art, true, &noop).unwrap();
        assert_eq!(s6.missing.len(), 1, "deleted file reported missing");
        assert!(s6.missing[0].ends_with("b.aiff"));
        {
            let conn = pool.lock().unwrap();
            let rows: i64 = conn
                .query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))
                .unwrap();
            assert_eq!(rows, 2, "scan must not delete anything by itself");
        }

        // The pool holds the SQLite file open; Windows refuses to remove a
        // directory containing an open handle, so drop it before cleaning up.
        drop(pool);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Times a real incremental scan against an existing library. Ignored by
    /// default — it needs a music folder and a populated DB, supplied as:
    ///   SHPEEGLE_BENCH_MUSIC=D:\Music
    ///   SHPEEGLE_BENCH_DB=<copy of library.db>
    /// Run with: cargo test --lib --release bench_real_incremental_scan -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_real_incremental_scan() {
        let Ok(music) = std::env::var("SHPEEGLE_BENCH_MUSIC") else {
            println!("SHPEEGLE_BENCH_MUSIC unset — skipping");
            return;
        };
        let db_path = std::env::var("SHPEEGLE_BENCH_DB").expect("SHPEEGLE_BENCH_DB required");
        let art = std::env::temp_dir().join("shpeegle_bench_art");

        let pool = db::init_db(Path::new(&db_path)).unwrap();
        let noop = |_: u32, _: u32, _: &str| {};

        let t = std::time::Instant::now();
        let files = enumerate_audio_files(Path::new(&music)).unwrap();
        println!("enumerate: {:?} for {} files", t.elapsed(), files.len());

        let t = std::time::Instant::now();
        let s = run_scan(&pool, &music, &art, true, &noop).unwrap();
        println!(
            "incremental scan: {:?} — {} added, {} updated, {} skipped, {} errors, {} missing",
            t.elapsed(), s.added, s.updated, s.skipped, s.errors, s.missing.len()
        );
    }
}
