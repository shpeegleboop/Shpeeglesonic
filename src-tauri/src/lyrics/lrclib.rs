use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LrclibResponse {
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
}

/// Fetch lyrics from LRCLIB API.
pub async fn fetch_lyrics(
    artist: &str,
    title: &str,
    album: Option<&str>,
    duration: Option<f64>,
) -> Result<Option<LrclibResponse>, String> {
    let client = reqwest::Client::new();

    let mut url = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}",
        urlencod(artist),
        urlencod(title),
    );

    if let Some(album) = album {
        url.push_str(&format!("&album_name={}", urlencod(album)));
    }
    if let Some(dur) = duration {
        url.push_str(&format!("&duration={}", dur.round() as i64));
    }

    let response = client
        .get(&url)
        .header("User-Agent", "Shpeeglesonic/0.1.0")
        .send()
        .await
        .map_err(|e| format!("LRCLIB request failed: {}", e))?;

    if response.status() == 404 {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Err(format!("LRCLIB error: {}", response.status()));
    }

    let data: LrclibResponse = response
        .json()
        .await
        .map_err(|e| format!("LRCLIB parse error: {}", e))?;

    if data.synced_lyrics.is_none() && data.plain_lyrics.is_none() {
        return Ok(None);
    }

    Ok(Some(data))
}

/// Check for a local .lrc file next to the audio file.
pub fn find_local_lrc(audio_path: &str) -> Option<String> {
    let path = std::path::Path::new(audio_path);
    let lrc_path = path.with_extension("lrc");
    if lrc_path.exists() {
        std::fs::read_to_string(&lrc_path).ok()
    } else {
        None
    }
}

fn urlencod(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}
