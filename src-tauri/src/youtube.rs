use crate::auth::{
    AuthService, TV_CLIENT_ID, TV_CLIENT_NAME, TV_CLIENT_VERSION,
    TV_COBALT_BROWSER_VERSION, TV_OAUTH_UA,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

const INNERTUBE_BASE: &str = "https://www.youtube.com/youtubei/v1/";
const MUSIC_INNERTUBE_BASE: &str = "https://music.youtube.com/youtubei/v1/";
const MUSIC_CLIENT_NAME: &str = "WEB_REMIX";
const MUSIC_CLIENT_ID: &str = "67";
const MUSIC_CLIENT_VERSION: &str = "1.20260708.01.00";
const MUSIC_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CACHE_TTL_PLAYER: Duration = Duration::from_secs(180);
const CACHE_TTL_SPONSOR: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy)]
pub struct InnerTubeClientConfig {
    pub name: &'static str,
    pub id: &'static str,
    pub version: &'static str,
    pub user_agent: &'static str,
    pub os_name: &'static str,
    pub os_version: &'static str,
    pub device_make: &'static str,
    pub device_model: &'static str,
    pub platform: &'static str,
    pub client_screen: &'static str,
    pub android_sdk_version: Option<u32>,
}

pub const CLIENT_VISIONOS: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "VISIONOS",
    id: "101",
    version: "1.02",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    os_name: "visionOS",
    os_version: "26.5.23O471",
    device_make: "Apple",
    device_model: "RealityDevice17,1",
    platform: "TABLET",
    client_screen: "WATCH",
    android_sdk_version: None,
};

pub const CLIENT_ANDROID_VR: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "ANDROID_VR",
    id: "28",
    version: "1.65.10",
    user_agent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    os_name: "Android",
    os_version: "12",
    device_make: "Oculus",
    device_model: "Quest 3",
    platform: "MOBILE",
    client_screen: "WATCH",
    android_sdk_version: Some(32),
};

pub const CLIENT_ANDROID: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "ANDROID",
    id: "3",
    version: "21.26.364",
    user_agent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
    os_name: "Android",
    os_version: "11",
    device_make: "Google",
    device_model: "Pixel 8",
    platform: "MOBILE",
    client_screen: "WATCH",
    android_sdk_version: Some(30),
};

pub const CLIENT_IOS: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "IOS",
    id: "5",
    version: "21.26.4",
    user_agent: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    os_name: "iPhone",
    os_version: "18.3.2.22D82",
    device_make: "Apple",
    device_model: "iPhone16,2",
    platform: "MOBILE",
    client_screen: "WATCH",
    android_sdk_version: None,
};

pub const CLIENT_IOS_HDR: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "IOS",
    id: "5",
    version: "20.10.4",
    user_agent: "com.google.ios.youtube/20.10.4 (iPhone16,3; U; CPU iOS 18_3_1 like Mac OS X;)",
    os_name: "iPhone",
    os_version: "18.3.1.22D72",
    device_make: "Apple",
    device_model: "iPhone16,3",
    platform: "MOBILE",
    client_screen: "WATCH",
    android_sdk_version: None,
};

pub const CLIENT_TVHTML5_SIMPLY_EMBED: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    id: "85",
    version: "2.0",
    user_agent: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15",
    os_name: "PlayStation",
    os_version: "12.00",
    device_make: "Sony",
    device_model: "PlayStation 4",
    platform: "TV",
    client_screen: "EMBED",
    android_sdk_version: None,
};

pub const CLIENT_TVHTML5: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "TVHTML5",
    id: "7",
    version: "7.20260213.00.00",
    user_agent: "Mozilla/5.0(SMART-TV; Linux; Tizen 4.0.0.2) AppleWebkit/605.1.15 (KHTML, like Gecko) SamsungBrowser/9.2 TV Safari/605.1.15",
    os_name: "Tizen",
    os_version: "4.0.0.2",
    device_make: "Samsung",
    device_model: "SmartTV",
    platform: "TV",
    client_screen: "WATCH",
    android_sdk_version: None,
};

pub const CLIENT_WEB_EMBED: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "WEB_EMBEDDED_PLAYER",
    id: "56",
    version: "1.20260213.00.00",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    os_name: "Windows",
    os_version: "10.0",
    device_make: "",
    device_model: "",
    platform: "DESKTOP",
    client_screen: "EMBED",
    android_sdk_version: None,
};

pub const CLIENT_WEB: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "WEB",
    id: "1",
    version: "2.20260901.00.00",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    os_name: "Windows",
    os_version: "10.0",
    device_make: "",
    device_model: "",
    platform: "DESKTOP",
    client_screen: "WATCH",
    android_sdk_version: None,
};

/// Resolves the exact User-Agent matching the YouTube InnerTube client that signed the googlevideo.com URL.
/// Always prioritizes the signed `c=` parameter inside the stream URL itself.
pub fn resolve_client_user_agent(
    url_client_param: Option<&str>,
    hint_client_param: Option<&str>,
) -> (&'static str, &'static str) {
    let raw = url_client_param
        .filter(|s| !s.is_empty())
        .or_else(|| hint_client_param.filter(|s| !s.is_empty()))
        .unwrap_or("VISIONOS")
        .to_uppercase();

    match raw.as_str() {
        "VISIONOS" => (CLIENT_VISIONOS.name, CLIENT_VISIONOS.user_agent),
        "ANDROID_VR" => (CLIENT_ANDROID_VR.name, CLIENT_ANDROID_VR.user_agent),
        "ANDROID" => (CLIENT_ANDROID.name, CLIENT_ANDROID.user_agent),
        "IOS" | "IOS_HDR" => (CLIENT_IOS.name, CLIENT_IOS.user_agent),
        "TVHTML5_SIMPLY_EMBEDDED_PLAYER" => (
            CLIENT_TVHTML5_SIMPLY_EMBED.name,
            CLIENT_TVHTML5_SIMPLY_EMBED.user_agent,
        ),
        "TVHTML5" => (CLIENT_TVHTML5.name, CLIENT_TVHTML5.user_agent),
        "WEB_EMBEDDED_PLAYER" => (CLIENT_WEB_EMBED.name, CLIENT_WEB_EMBED.user_agent),
        "WEB_REMIX" => (MUSIC_CLIENT_NAME, MUSIC_USER_AGENT),
        "WEB" => (CLIENT_WEB.name, CLIENT_WEB.user_agent),
        _ if raw.contains("VISION") => (CLIENT_VISIONOS.name, CLIENT_VISIONOS.user_agent),
        _ if raw.contains("IOS") => (CLIENT_IOS.name, CLIENT_IOS.user_agent),
        _ if raw.contains("VR") => (CLIENT_ANDROID_VR.name, CLIENT_ANDROID_VR.user_agent),
        _ if raw.contains("ANDROID") => (CLIENT_ANDROID.name, CLIENT_ANDROID.user_agent),
        _ if raw.contains("REMIX") => (MUSIC_CLIENT_NAME, MUSIC_USER_AGENT),
        _ if raw.contains("TVHTML5_SIMPLY") => (
            CLIENT_TVHTML5_SIMPLY_EMBED.name,
            CLIENT_TVHTML5_SIMPLY_EMBED.user_agent,
        ),
        _ if raw.contains("TV") => (CLIENT_TVHTML5.name, CLIENT_TVHTML5.user_agent),
        _ => (CLIENT_VISIONOS.name, CLIENT_VISIONOS.user_agent),
    }
}

/// Extracts the signed `c=` InnerTube client identifier from a googlevideo.com stream URL.
pub fn extract_url_client_param(raw_url: &str) -> Option<String> {
    Url::parse(raw_url).ok().and_then(|parsed| {
        parsed
            .query_pairs()
            .find(|(k, _)| k == "c")
            .map(|(_, v)| v.into_owned())
            .filter(|s| !s.is_empty())
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamExtractMode {
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamRange {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamFormat {
    pub itag: i64,
    pub url: String,
    pub mime_type: String,
    pub container: String,
    pub codec: String,
    pub width: i64,
    pub height: i64,
    pub fps: i64,
    pub quality: String,
    pub quality_label: String,
    pub bitrate: i64,
    pub average_bitrate: Option<i64>,
    pub content_length: Option<u64>,
    pub approx_duration_ms: Option<u64>,
    pub init_range: Option<StreamRange>,
    pub index_range: Option<StreamRange>,
    pub is_hdr: bool,
    pub is_video: bool,
    pub is_audio: bool,
    pub is_muxed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamFormat {
    pub itag: i64,
    pub url: String,
    pub mime_type: String,
    pub container: String,
    pub codec: String,
    pub bitrate: i64,
    pub average_bitrate: Option<i64>,
    pub audio_sample_rate: Option<String>,
    pub audio_channels: Option<i64>,
    pub content_length: Option<u64>,
    pub approx_duration_ms: Option<u64>,
    pub init_range: Option<StreamRange>,
    pub index_range: Option<StreamRange>,
    pub is_original: Option<bool>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedStreams {
    pub video: Option<VideoStreamFormat>,
    pub audio: Option<AudioStreamFormat>,
    pub muxed: Option<VideoStreamFormat>,
    pub quality_label: String,
    pub is_separate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrackInfo {
    pub language_tag: String,
    pub label: String,
    pub url: String,
    pub vtt_url: String,
    pub is_auto_generated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorBlockSegment {
    pub uuid: String,
    pub category: String,
    pub category_label: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub duration_ms: i64,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedVideoItem {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub duration_text: Option<String>,
    pub view_count_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailInfo {
    pub url: String,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TayTubeVideoDetails {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_id: Option<String>,
    pub duration_sec: i64,
    pub view_count: String,
    pub description: String,
    pub thumbnails: Vec<ThumbnailInfo>,
    pub all_qualities: Vec<i64>,
    pub hdr_qualities: Vec<i64>,
    pub selected_streams: SelectedStreams,
    pub all_video_streams: Vec<VideoStreamFormat>,
    pub all_audio_streams: Vec<AudioStreamFormat>,
    pub caption_tracks: Vec<CaptionTrackInfo>,
    pub sponsor_segments: Vec<SponsorBlockSegment>,
    pub related_videos: Vec<RelatedVideoItem>,
    pub proxy_video_url: Option<String>,
    pub proxy_audio_url: Option<String>,
    pub hls_manifest_url: Option<String>,
    pub proxy_hls_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchVideoItem {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_id: Option<String>,
    pub thumbnail: String,
    pub duration_text: String,
    pub duration_sec: i64,
    pub view_count_text: String,
    pub published_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent_watched: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoComment {
    pub id: String,
    pub author: String,
    pub author_avatar: Option<String>,
    pub channel_id: Option<String>,
    pub text: String,
    pub likes: i64,
    pub published_text: Option<String>,
    pub pinned: bool,
    pub reply_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsResult {
    pub comments: Vec<VideoComment>,
    pub total_count: i64,
    pub disabled: bool,
    pub continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortVideoItem {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_id: Option<String>,
    pub channel_avatar: Option<String>,
    pub thumbnail: String,
    pub like_count_text: Option<String>,
    pub comment_count_text: Option<String>,
    pub view_count_text: Option<String>,
    pub published_text: Option<String>,
    pub params: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortsFeedResult {
    pub items: Vec<ShortVideoItem>,
    pub continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrackItem {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_text: String,
    pub duration_sec: i64,
    pub thumbnail: String,
    pub playlist_id: Option<String>,
    pub explicit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicShelf {
    pub title: String,
    pub items: Vec<MusicTrackItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAudioStreamResult {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub duration_sec: i64,
    pub thumbnail: String,
    pub proxy_audio_url: String,
    pub mime_type: String,
    pub bitrate: i64,
    pub radio_tracks: Vec<MusicTrackItem>,
}

#[derive(Debug, Clone, Default)]
pub struct IosStreamingData {
    pub hls_manifest_url: Option<String>,
    pub adaptive_formats: Vec<Value>,
    pub formats: Vec<Value>,
    pub client_name: Option<&'static str>,
}

#[derive(Debug, Clone)]
struct TrackingSession {
    ei: String,
    vm: String,
    of: String,
    cpn: String,
    last_pos_sec: f64,
    record_created_at_ms: i64,
}

pub struct YouTubeService {
    http: reqwest::Client,
    auth: Arc<AuthService>,
    visitor_data: RwLock<Option<String>>,
    player_cache: RwLock<HashMap<String, (Instant, Value)>>,
    ios_cache: RwLock<HashMap<String, (Instant, IosStreamingData)>>,
    sponsor_cache: RwLock<HashMap<String, (Instant, Vec<SponsorBlockSegment>)>>,
    tracking_cache: RwLock<HashMap<String, TrackingSession>>,
}

impl YouTubeService {
    pub fn new(auth: Arc<AuthService>) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(12))
            .timeout(Duration::from_secs(20))
            .pool_max_idle_per_host(16)
            .tcp_keepalive(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

        Ok(Self {
            http,
            auth,
            visitor_data: RwLock::new(None),
            player_cache: RwLock::new(HashMap::new()),
            ios_cache: RwLock::new(HashMap::new()),
            sponsor_cache: RwLock::new(HashMap::new()),
            tracking_cache: RwLock::new(HashMap::new()),
        })
    }

    pub fn extract_video_id(input: &str) -> Result<String, String> {
        let trimmed = input.trim();
        if is_valid_video_id(trimmed) {
            return Ok(trimmed.to_string());
        }

        if let Ok(parsed) = Url::parse(trimmed) {
            for (k, v) in parsed.query_pairs() {
                if k == "v" && is_valid_video_id(&v) {
                    return Ok(v.into_owned());
                }
            }
            if let Some(segments) = parsed.path_segments() {
                let segs: Vec<&str> = segments.collect();
                for (i, s) in segs.iter().enumerate() {
                    if (*s == "shorts" || *s == "embed" || *s == "live") && i + 1 < segs.len() {
                        let cand = segs[i + 1];
                        if is_valid_video_id(cand) {
                            return Ok(cand.to_string());
                        }
                    }
                    if is_valid_video_id(s) {
                        return Ok((*s).to_string());
                    }
                }
            }
        }

        Err(format!("Invalid YouTube URL or ID: {input}"))
    }

    async fn innertube_request(
        &self,
        endpoint: &str,
        mut body: Value,
        client_cfg: &InnerTubeClientConfig,
    ) -> Result<Value, String> {
        let lang = "vi";
        let country = "VN";
        let visitor = self.visitor_data.read().ok().and_then(|v| v.clone());

        let mut client_ctx = json!({
            "clientName": client_cfg.name,
            "clientVersion": client_cfg.version,
            "clientScreen": client_cfg.client_screen,
            "platform": client_cfg.platform,
            "deviceMake": client_cfg.device_make,
            "deviceModel": client_cfg.device_model,
            "osName": client_cfg.os_name,
            "osVersion": client_cfg.os_version,
            "hl": lang,
            "gl": country,
        });

        if let Some(sdk) = client_cfg.android_sdk_version {
            client_ctx["androidSdkVersion"] = json!(sdk);
        }

        if let Some(ref vd) = visitor {
            client_ctx["visitorData"] = Value::String(vd.clone());
        }

        if let Some(obj) = body.as_object_mut() {
            obj.insert("context".to_string(), json!({ "client": client_ctx }));
            if client_cfg.name == "WEB_EMBEDDED_PLAYER" {
                let vid = obj
                    .get("videoId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                obj.insert(
                    "thirdPartyEmbedUrl".to_string(),
                    Value::String(format!("https://www.youtube.com/embed/{vid}")),
                );
            }
        }

        let pref_cookie = format!("PREF=hl={lang}&gl={country}");
        let url = format!("{INNERTUBE_BASE}{endpoint}?prettyPrint=false&hl={lang}&gl={country}");

        let mut req = self
            .http
            .post(&url)
            .header("User-Agent", client_cfg.user_agent)
            .header("Content-Type", "application/json")
            .header("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
            .header("X-Goog-Api-Format-Version", "2")
            .header("X-YouTube-Client-Name", client_cfg.id)
            .header("X-YouTube-Client-Version", client_cfg.version)
            .header("Cookie", pref_cookie);

        if let Some(ref vd) = visitor {
            req = req.header("X-Goog-Visitor-Id", vd);
        }

        if client_cfg.name == "WEB_EMBEDDED_PLAYER" {
            let vid = body.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
            req = req
                .header("Origin", "https://www.youtube.com")
                .header("Referer", format!("https://www.youtube.com/embed/{vid}"));
        }

        let res = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("InnerTube request failed: {e}"))?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let txt = res.text().await.unwrap_or_default();
            let preview: String = txt.chars().take(240).collect();
            return Err(format!("InnerTube HTTP {status} on {endpoint}: {preview}"));
        }

        let parsed: Value = res
            .json()
            .await
            .map_err(|e| format!("Invalid InnerTube JSON: {e}"))?;

        if visitor.is_none() {
            if let Some(new_vd) = parsed
                .get("responseContext")
                .and_then(|rc| rc.get("visitorData"))
                .and_then(|v| v.as_str())
            {
                if let Ok(mut guard) = self.visitor_data.write() {
                    if guard.is_none() {
                        *guard = Some(new_vd.to_string());
                    }
                }
            }
        }

        Ok(parsed)
    }

    async fn ensure_visitor_data(&self) {
        let has_vd = self
            .visitor_data
            .read()
            .ok()
            .and_then(|v| v.clone())
            .is_some();
        if has_vd {
            return;
        }
        let _ = self
            .innertube_request("browse", json!({ "browseId": "FEwhat_to_watch" }), &CLIENT_WEB)
            .await;
    }

    async fn reroll_visitor_data(&self) {
        if let Ok(mut guard) = self.visitor_data.write() {
            *guard = None;
        }
        if let Ok(mut cache) = self.player_cache.write() {
            cache.clear();
        }
        if let Ok(mut cache) = self.ios_cache.write() {
            cache.clear();
        }
        self.ensure_visitor_data().await;
    }

    fn is_playable_for_mode(resp: &Value, mode: StreamExtractMode) -> bool {
        let status = resp
            .get("playabilityStatus")
            .and_then(|p| p.get("status"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_uppercase();

        if status != "OK" {
            return false;
        }

        let Some(streaming) = resp.get("streamingData") else {
            return false;
        };

        let has_muxed = streaming
            .get("formats")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().any(|f| extract_format_url(f).is_some()))
            .unwrap_or(false);

        let has_mime = |prefix: &str| {
            streaming
                .get("adaptiveFormats")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter().any(|f| {
                        let mime = f
                            .get("mimeType")
                            .and_then(|m| m.as_str())
                            .unwrap_or("")
                            .to_lowercase();
                        mime.starts_with(prefix) && extract_format_url(f).is_some()
                    })
                })
                .unwrap_or(false)
        };

        match mode {
            StreamExtractMode::Audio => has_mime("audio/") || has_muxed,
            StreamExtractMode::Video => {
                let has_hls = streaming
                    .get("hlsManifestUrl")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                has_hls || has_mime("video/") || has_muxed
            }
        }
    }

    fn is_playable(resp: &Value) -> bool {
        Self::is_playable_for_mode(resp, StreamExtractMode::Video)
            || Self::is_playable_for_mode(resp, StreamExtractMode::Audio)
    }

    pub async fn resolve_player_for_mode(
        &self,
        video_id: &str,
        mode: StreamExtractMode,
    ) -> Result<Value, String> {
        if let Ok(cache) = self.player_cache.read() {
            if let Some((at, data)) = cache.get(video_id) {
                if at.elapsed() < CACHE_TTL_PLAYER && Self::is_playable_for_mode(data, mode) {
                    return Ok(data.clone());
                }
            }
        }

        self.ensure_visitor_data().await;

        let fallback_clients = [
            &CLIENT_VISIONOS,
            &CLIENT_ANDROID_VR,
            &CLIENT_TVHTML5_SIMPLY_EMBED,
            &CLIENT_TVHTML5,
            &CLIENT_IOS,
            &CLIENT_ANDROID,
            &CLIENT_WEB_EMBED,
            &CLIENT_WEB,
        ];

        for client_cfg in fallback_clients {
            let body = json!({
                "videoId": video_id,
                "contentCheckOk": true,
                "racyCheckOk": true
            });

            if let Ok(resp) = self.innertube_request("player", body, client_cfg).await {
                if Self::is_playable_for_mode(&resp, mode) {
                    if let Ok(mut cache) = self.player_cache.write() {
                        cache.insert(video_id.to_string(), (Instant::now(), resp.clone()));
                    }
                    return Ok(resp);
                }
            }
        }

        Err(format!(
            "Could not retrieve playable streams for video {video_id} ({mode:?}) across all fallback clients."
        ))
    }

    pub async fn resolve_player(&self, video_id: &str) -> Result<Value, String> {
        self.resolve_player_for_mode(video_id, StreamExtractMode::Video)
            .await
    }

    async fn fetch_muxed_mp4_fallback(&self, video_id: &str) -> Vec<Value> {
        self.ensure_visitor_data().await;
        let body = json!({
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true
        });
        let Ok(resp) = self.innertube_request("player", body, &CLIENT_ANDROID).await else {
            return Vec::new();
        };
        resp.pointer("/streamingData/formats")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|f| extract_format_url(f).is_some())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn fetch_ios_streaming_data(&self, video_id: &str) -> IosStreamingData {
        if let Ok(cache) = self.ios_cache.read() {
            if let Some((at, data)) = cache.get(video_id) {
                if at.elapsed() < CACHE_TTL_PLAYER {
                    return data.clone();
                }
            }
        }

        self.ensure_visitor_data().await;

        let mut best = IosStreamingData::default();
        for client_cfg in [&CLIENT_VISIONOS, &CLIENT_IOS, &CLIENT_IOS_HDR] {
            let body = json!({
                "videoId": video_id,
                "contentCheckOk": true,
                "racyCheckOk": true
            });

            if let Ok(resp) = self.innertube_request("player", body, client_cfg).await {
                if let Some(sd) = resp.get("streamingData") {
                    let hls = sd
                        .get("hlsManifestUrl")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                    let adaptive = sd
                        .get("adaptiveFormats")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let formats = sd
                        .get("formats")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();

                    if hls.is_some() {
                        best = IosStreamingData {
                            hls_manifest_url: hls,
                            adaptive_formats: adaptive,
                            formats,
                            client_name: Some(client_cfg.name),
                        };
                        if let Ok(mut cache) = self.ios_cache.write() {
                            cache.insert(video_id.to_string(), (Instant::now(), best.clone()));
                        }
                        return best;
                    }

                    if best.adaptive_formats.is_empty() && !adaptive.is_empty() {
                        best.adaptive_formats = adaptive;
                        best.formats = formats;
                        best.client_name = Some(client_cfg.name);
                    }
                }
            }
        }

        if !best.adaptive_formats.is_empty() || !best.formats.is_empty() {
            if let Ok(mut cache) = self.ios_cache.write() {
                cache.insert(video_id.to_string(), (Instant::now(), best.clone()));
            }
        }

        best
    }

    pub async fn resolve_fallback_stream_candidates(
        &self,
        video_id: &str,
        itag: Option<i64>,
        exclude_client: Option<&str>,
        audio_only_hint: bool,
    ) -> Vec<(String, &'static str, &'static str)> {
        if let Ok(mut cache) = self.player_cache.write() {
            cache.remove(video_id);
        }
        if let Ok(mut cache) = self.ios_cache.write() {
            cache.remove(video_id);
        }

        let exclude_upper = exclude_client.unwrap_or("").trim().to_uppercase();
        let retry_visionos_reroll = exclude_upper == "VISIONOS";
        if retry_visionos_reroll {
            self.reroll_visitor_data().await;
        } else {
            self.ensure_visitor_data().await;
        }

        let is_audio = audio_only_hint
            || matches!(itag, Some(139 | 140 | 141 | 249 | 250 | 251 | 599 | 600));

        let mut primary_out: Vec<(String, &'static str, &'static str)> = Vec::new();
        let mut muxed_out: Vec<(String, &'static str, &'static str)> = Vec::new();
        let mut seen: HashSet<(&'static str, i64)> = HashSet::new();

        let primary_clients = [
            &CLIENT_VISIONOS,
            &CLIENT_ANDROID_VR,
            &CLIENT_TVHTML5_SIMPLY_EMBED,
            &CLIENT_TVHTML5,
        ];

        for client_cfg in primary_clients {
            if !retry_visionos_reroll && client_cfg.name.eq_ignore_ascii_case(&exclude_upper) {
                continue;
            }
            let body = json!({
                "videoId": video_id,
                "contentCheckOk": true,
                "racyCheckOk": true
            });
            if let Ok(resp) = self.innertube_request("player", body, client_cfg).await {
                collect_fallback_candidates_from_resp(
                    &resp,
                    client_cfg.name,
                    itag,
                    is_audio,
                    &mut seen,
                    &mut primary_out,
                    &mut muxed_out,
                );
            }
        }

        if self.auth.is_signed_in() && exclude_upper != "TVHTML5" {
            if let Ok(resp) = self
                .innertube_tv_auth_request(
                    "player",
                    json!({
                        "videoId": video_id,
                        "contentCheckOk": true,
                        "racyCheckOk": true
                    }),
                )
                .await
            {
                collect_fallback_candidates_from_resp(
                    &resp,
                    CLIENT_TVHTML5.name,
                    itag,
                    is_audio,
                    &mut seen,
                    &mut primary_out,
                    &mut muxed_out,
                );
            }
        }

        let legacy_clients = [&CLIENT_IOS, &CLIENT_ANDROID];
        for client_cfg in legacy_clients {
            let skip_direct = client_cfg.name.eq_ignore_ascii_case(&exclude_upper);
            let body = json!({
                "videoId": video_id,
                "contentCheckOk": true,
                "racyCheckOk": true
            });
            if let Ok(resp) = self.innertube_request("player", body, client_cfg).await {
                if skip_direct {
                    if is_audio {
                        collect_fallback_candidates_from_resp(
                            &resp,
                            client_cfg.name,
                            itag,
                            is_audio,
                            &mut seen,
                            &mut Vec::new(),
                            &mut muxed_out,
                        );
                    }
                    continue;
                }
                collect_fallback_candidates_from_resp(
                    &resp,
                    client_cfg.name,
                    itag,
                    is_audio,
                    &mut seen,
                    &mut primary_out,
                    &mut muxed_out,
                );
            }
        }

        primary_out.extend(muxed_out);
        primary_out
    }

    pub async fn fetch_sponsor_segments(&self, video_id: &str) -> Vec<SponsorBlockSegment> {
        if let Ok(cache) = self.sponsor_cache.read() {
            if let Some((at, segs)) = cache.get(video_id) {
                if at.elapsed() < CACHE_TTL_SPONSOR {
                    return segs.clone();
                }
            }
        }

        let mut hasher = Sha256::new();
        hasher.update(video_id.as_bytes());
        let hash_hex = hex::encode(hasher.finalize());
        let prefix = &hash_hex[..4];

        let cats = urlencoding::encode(
            r#"["sponsor","selfpromo","interaction","intro","outro","preview","music_offtopic","filler"]"#,
        );
        let url = format!(
            "https://sponsor.ajay.app/api/skipSegments/{prefix}?categories={cats}&actionType=skip"
        );

        let Ok(res) = self
            .http
            .get(&url)
            .header("User-Agent", "TayTube-PC/1.0")
            .send()
            .await
        else {
            return Vec::new();
        };

        if res.status().as_u16() == 404 {
            if let Ok(mut cache) = self.sponsor_cache.write() {
                cache.insert(video_id.to_string(), (Instant::now(), Vec::new()));
            }
            return Vec::new();
        }

        if !res.status().is_success() {
            return Vec::new();
        }

        let Ok(list) = res.json::<Vec<Value>>().await else {
            return Vec::new();
        };

        let matched = list
            .iter()
            .find(|item| item.get("videoID").and_then(|v| v.as_str()) == Some(video_id));

        let Some(segments_arr) = matched
            .and_then(|m| m.get("segments"))
            .and_then(|s| s.as_array())
        else {
            if let Ok(mut cache) = self.sponsor_cache.write() {
                cache.insert(video_id.to_string(), (Instant::now(), Vec::new()));
            }
            return Vec::new();
        };

        let mut segments = Vec::new();
        for seg in segments_arr {
            let cat = seg
                .get("category")
                .and_then(|v| v.as_str())
                .unwrap_or("sponsor");
            let Some(range) = seg.get("segment").and_then(|v| v.as_array()) else {
                continue;
            };
            if range.len() < 2 {
                continue;
            }
            let start_sec = range[0].as_f64().unwrap_or(0.0);
            let end_sec = range[1].as_f64().unwrap_or(0.0);
            let start_ms = (start_sec * 1000.0).round() as i64;
            let end_ms = (end_sec * 1000.0).round() as i64;
            let duration_ms = end_ms - start_ms;
            if duration_ms < 1000 {
                continue;
            }

            segments.push(SponsorBlockSegment {
                uuid: seg
                    .get("UUID")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                category: cat.to_string(),
                category_label: sponsor_category_label(cat).to_string(),
                start_sec,
                end_sec,
                start_ms,
                end_ms,
                duration_ms,
                action: "skip".to_string(),
            });
        }

        segments.sort_by_key(|s| s.start_ms);
        if let Ok(mut cache) = self.sponsor_cache.write() {
            cache.insert(video_id.to_string(), (Instant::now(), segments.clone()));
        }
        segments
    }

    pub async fn fetch_related_videos(&self, video_id: &str) -> Vec<RelatedVideoItem> {
        let Ok(resp) = self
            .innertube_request("next", json!({ "videoId": video_id }), &CLIENT_WEB)
            .await
        else {
            return Vec::new();
        };

        let mut items = Vec::new();
        let mut seen = HashSet::new();
        walk_related(&resp, video_id, &mut items, &mut seen);
        items.truncate(15);
        items
    }

    pub async fn get_video_details(
        &self,
        url_or_id: &str,
        target_quality: Option<i64>,
        prefer_hdr: Option<bool>,
        mode: Option<StreamExtractMode>,
    ) -> Result<TayTubeVideoDetails, String> {
        let video_id = Self::extract_video_id(url_or_id)?;
        let extract_mode = mode.unwrap_or(StreamExtractMode::Video);

        self.ensure_visitor_data().await;

        let (player_resp, ios_data, sponsor_segments, related_videos) = match extract_mode {
            StreamExtractMode::Video => {
                let (player_res, ios_data, muxed_fallback, sponsor_segments, related_videos) =
                    tokio::join!(
                        self.resolve_player_for_mode(&video_id, StreamExtractMode::Video),
                        self.fetch_ios_streaming_data(&video_id),
                        self.fetch_muxed_mp4_fallback(&video_id),
                        self.fetch_sponsor_segments(&video_id),
                        self.fetch_related_videos(&video_id),
                    );

                let mut resp = player_res?;
                merge_streaming_formats(&mut resp, &ios_data);
                if !muxed_fallback.is_empty() {
                    let muxed_extra = IosStreamingData {
                        formats: muxed_fallback,
                        ..Default::default()
                    };
                    merge_streaming_formats(&mut resp, &muxed_extra);
                }
                (resp, ios_data, sponsor_segments, related_videos)
            }
            StreamExtractMode::Audio => {
                let (player_res, sponsor_segments, related_videos) = tokio::join!(
                    self.resolve_player_for_mode(&video_id, StreamExtractMode::Audio),
                    self.fetch_sponsor_segments(&video_id),
                    self.fetch_related_videos(&video_id),
                );
                let mut resp = player_res?;
                let pre_parsed = parse_stream_formats(resp.get("streamingData"));
                if pre_parsed.audio_only.is_empty() {
                    let ios_extra = self.fetch_ios_streaming_data(&video_id).await;
                    merge_streaming_formats(&mut resp, &ios_extra);
                }
                (resp, IosStreamingData::default(), sponsor_segments, related_videos)
            }
        };

        let (player_hls, hls_from_player, raw_hls_url) = if extract_mode == StreamExtractMode::Video {
            let phls = player_resp
                .get("streamingData")
                .and_then(|sd| sd.get("hlsManifestUrl"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let from_player = phls.is_some();
            let raw = phls.clone().or_else(|| ios_data.hls_manifest_url.clone());
            (phls, from_player, raw)
        } else {
            (None, false, None)
        };
        let _ = player_hls;

        let mut parsed = parse_stream_formats(player_resp.get("streamingData"));
        if extract_mode == StreamExtractMode::Audio {
            parsed.video_only.clear();
            parsed.all_qualities.clear();
            parsed.hdr_qualities.clear();
        }
        let target_h = target_quality.unwrap_or(1080);
        let pref_hdr = prefer_hdr.unwrap_or(false);
        let mut selected = select_quality(
            &parsed.video_only,
            &parsed.audio_only,
            &parsed.muxed,
            target_h,
            pref_hdr,
        );
        if extract_mode == StreamExtractMode::Audio {
            selected.video = None;
            if selected.audio.is_some() {
                selected.muxed = None;
            }
            selected.is_separate = false;
            selected.quality_label = "Audio".to_string();
        }

        let caption_tracks = extract_caption_tracks(&player_resp);

        let chosen_video = selected.video.as_ref().or(selected.muxed.as_ref());
        let proxy_video_url = chosen_video.map(|v| {
            let client = extract_url_client_param(&v.url)
                .unwrap_or_else(|| CLIENT_VISIONOS.name.to_string());
            format!(
                "http://127.0.0.1:8989/stream?url={}&client={}&id={}&itag={}",
                urlencoding::encode(&v.url),
                urlencoding::encode(&client),
                urlencoding::encode(&video_id),
                v.itag
            )
        });

        let proxy_audio_url = selected.audio.as_ref().map(|a| {
            let client = extract_url_client_param(&a.url)
                .unwrap_or_else(|| CLIENT_VISIONOS.name.to_string());
            format!(
                "http://127.0.0.1:8989/stream?url={}&client={}&id={}&itag={}",
                urlencoding::encode(&a.url),
                urlencoding::encode(&client),
                urlencoding::encode(&video_id),
                a.itag
            )
        });

        let hls_client_name = if hls_from_player {
            parsed
                .video_only
                .first()
                .map(|v| v.url.as_str())
                .or_else(|| parsed.audio_only.first().map(|a| a.url.as_str()))
                .or_else(|| parsed.muxed.first().map(|m| m.url.as_str()))
                .and_then(extract_url_client_param)
                .unwrap_or_else(|| CLIENT_VISIONOS.name.to_string())
        } else {
            ios_data
                .client_name
                .unwrap_or(CLIENT_VISIONOS.name)
                .to_string()
        };

        let proxy_hls_url = raw_hls_url.as_ref().map(|hls| {
            format!(
                "http://127.0.0.1:8989/hls.m3u8?url={}&client={}&id={}",
                urlencoding::encode(hls),
                urlencoding::encode(&hls_client_name),
                urlencoding::encode(&video_id)
            )
        });

        eprintln!(
            "[TayTube Stream] id={} mode={:?} | video_af={} audio_af={} muxed={} has_hls={} | selected_video_itag={:?} selected_muxed_itag={:?} selected_audio_itag={:?} | hls_client={} | proxy_hls={} | proxy_video={}",
            video_id,
            extract_mode,
            parsed.video_only.len(),
            parsed.audio_only.len(),
            parsed.muxed.len(),
            raw_hls_url.is_some(),
            selected.video.as_ref().map(|v| v.itag),
            selected.muxed.as_ref().map(|m| m.itag),
            selected.audio.as_ref().map(|a| a.itag),
            hls_client_name,
            proxy_hls_url.as_deref().map(|u| &u[..u.len().min(72)]).unwrap_or("none"),
            proxy_video_url.as_deref().map(|u| &u[..u.len().min(72)]).unwrap_or("none"),
        );

        let vd = player_resp.get("videoDetails");
        let title = vd
            .and_then(|d| d.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Title")
            .to_string();
        let channel = vd
            .and_then(|d| d.get("author"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Channel")
            .to_string();
        let channel_id = vd
            .and_then(|d| d.get("channelId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let duration_sec = vd
            .and_then(|d| d.get("lengthSeconds"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let view_count = vd
            .and_then(|d| d.get("viewCount"))
            .and_then(|v| v.as_str())
            .unwrap_or("0")
            .to_string();
        let description = vd
            .and_then(|d| d.get("shortDescription"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let thumbnails = vd
            .and_then(|d| d.get("thumbnail"))
            .and_then(|t| t.get("thumbnails"))
            .and_then(|arr| arr.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let url = item.get("url")?.as_str()?.to_string();
                        let width = item.get("width").and_then(|w| w.as_i64()).unwrap_or(0);
                        let height = item.get("height").and_then(|h| h.as_i64()).unwrap_or(0);
                        Some(ThumbnailInfo { url, width, height })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut all_video_streams = parsed.video_only;
        all_video_streams.extend(parsed.muxed);

        Ok(TayTubeVideoDetails {
            id: video_id,
            title,
            channel,
            channel_id,
            duration_sec,
            view_count,
            description,
            thumbnails,
            all_qualities: parsed.all_qualities,
            hdr_qualities: parsed.hdr_qualities,
            selected_streams: selected,
            all_video_streams,
            all_audio_streams: parsed.audio_only,
            caption_tracks,
            sponsor_segments,
            related_videos,
            proxy_video_url,
            proxy_audio_url,
            hls_manifest_url: raw_hls_url,
            proxy_hls_url,
        })
    }

    pub async fn search_videos(&self, query: &str) -> Result<Vec<SearchVideoItem>, String> {
        let json = self
            .innertube_request("search", json!({ "query": query }), &CLIENT_WEB)
            .await?;

        let mut results = Vec::new();
        let sections = json
            .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents")
            .and_then(|v| v.as_array());

        if let Some(secs) = sections {
            for section in secs {
                if let Some(items) = section
                    .pointer("/itemSectionRenderer/contents")
                    .and_then(|v| v.as_array())
                {
                    for item in items {
                        if let Some(v) = item.get("videoRenderer") {
                            if let Some(parsed) = parse_video_renderer(v) {
                                results.push(parsed);
                            }
                        }
                    }
                }
            }
        }

        Ok(results)
    }

    pub async fn get_trending_videos(&self) -> Result<Vec<SearchVideoItem>, String> {
        let resp = match self
            .innertube_request("browse", json!({ "browseId": "FEtrending" }), &CLIENT_WEB)
            .await
        {
            Ok(v) => v,
            Err(_) => {
                self.innertube_request("search", json!({ "query": "trending" }), &CLIENT_WEB)
                    .await?
            }
        };

        let mut list = Vec::new();
        let mut seen = HashSet::new();
        walk_trending(&resp, &mut list, &mut seen);
        Ok(list)
    }

    pub async fn get_video_comments(&self, video_id: &str) -> Result<CommentsResult, String> {
        let Ok(next_resp) = self
            .innertube_request("next", json!({ "videoId": video_id }), &CLIENT_WEB)
            .await
        else {
            return Ok(CommentsResult {
                comments: Vec::new(),
                total_count: 0,
                disabled: false,
                continuation_token: None,
            });
        };

        let Some(token) = find_comment_continuation(&next_resp) else {
            return Ok(CommentsResult {
                comments: Vec::new(),
                total_count: 0,
                disabled: false,
                continuation_token: None,
            });
        };

        let Ok(comments_resp) = self
            .innertube_request("next", json!({ "continuation": token }), &CLIENT_WEB)
            .await
        else {
            return Ok(CommentsResult {
                comments: Vec::new(),
                total_count: 0,
                disabled: false,
                continuation_token: None,
            });
        };

        let mut comments = Vec::new();
        let mut seen = HashSet::new();
        let mut total_count = 0i64;
        let mut next_token = None;
        walk_comments(
            &comments_resp,
            &mut comments,
            &mut seen,
            &mut total_count,
            &mut next_token,
        );

        let final_total = total_count.max(comments.len() as i64);
        Ok(CommentsResult {
            comments,
            total_count: final_total,
            disabled: false,
            continuation_token: next_token,
        })
    }

    pub fn clear_account_caches(&self) {
        if let Ok(mut guard) = self.tracking_cache.write() {
            guard.clear();
        }
    }

    async fn innertube_tv_auth_request(
        &self,
        endpoint: &str,
        extra_body: Value,
    ) -> Result<Value, String> {
        let mut auth = self
            .auth
            .get_valid_auth_headers()
            .await?
            .ok_or_else(|| "Vui lòng đăng nhập Google để sử dụng tính năng này".to_string())?;

        for attempt in 0..2 {
            let mut client_ctx = json!({
                "clientName": TV_CLIENT_NAME,
                "clientVersion": TV_CLIENT_VERSION,
                "clientScreen": "WATCH",
                "userAgent": TV_OAUTH_UA,
                "browserName": "Cobalt",
                "browserVersion": TV_COBALT_BROWSER_VERSION,
                "tvAppInfo": {
                    "appQuality": "TV_APP_QUALITY_FULL_ANIMATION",
                    "zylonLeftNav": true
                },
                "webpSupport": false,
                "animatedWebpSupport": true,
                "hl": "vi",
                "gl": "VN",
                "acceptLanguage": "vi",
                "acceptRegion": "VN",
                "utcOffsetMinutes": 420
            });

            if let Some(ref vd) = auth.visitor_data {
                client_ctx["visitorData"] = Value::String(vd.clone());
            }

            let mut body = match extra_body {
                Value::Object(ref map) => Value::Object(map.clone()),
                _ => Value::Object(serde_json::Map::new()),
            };
            if let Some(obj) = body.as_object_mut() {
                obj.insert(
                    "context".to_string(),
                    json!({
                        "client": client_ctx,
                        "user": {
                            "enableSafetyMode": false,
                            "lockedSafetyMode": false
                        }
                    }),
                );
                obj.entry("racyCheckOk").or_insert(Value::Bool(true));
                obj.entry("contentCheckOk").or_insert(Value::Bool(true));
            }

            let url = format!("{INNERTUBE_BASE}{endpoint}?prettyPrint=false");
            let mut req = self
                .http
                .post(&url)
                .header("User-Agent", TV_OAUTH_UA)
                .header("Content-Type", "application/json")
                .header("Referer", "https://www.youtube.com/tv")
                .header("Origin", "https://www.youtube.com")
                .header("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
                .header("X-YouTube-Client-Name", TV_CLIENT_ID)
                .header("X-YouTube-Client-Version", TV_CLIENT_VERSION)
                .header("Authorization", &auth.authorization);

            if let Some(ref pid) = auth.page_id {
                req = req.header("X-Goog-Pageid", pid);
            }
            if let Some(ref vd) = auth.visitor_data {
                req = req.header("X-Goog-Visitor-Id", vd);
            }

            let res = req
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Lỗi gọi InnerTube TV ({endpoint}): {e}"))?;

            let status = res.status().as_u16();
            if status == 401 && attempt == 0 {
                if let Some(refreshed) = self
                    .auth
                    .force_refresh_auth_headers(&auth.authorization)
                    .await?
                {
                    auth = refreshed;
                    continue;
                }
            }

            if !res.status().is_success() {
                let txt = res.text().await.unwrap_or_default();
                let preview: String = txt.chars().take(240).collect();
                return Err(format!("InnerTube TV HTTP {status} trên {endpoint}: {preview}"));
            }

            return res
                .json::<Value>()
                .await
                .map_err(|e| format!("JSON InnerTube TV không hợp lệ: {e}"));
        }

        Err(format!("Không thể xác thực yêu cầu InnerTube TV ({endpoint})"))
    }

    async fn stats_get_with_auth(&self, full_url: &str) -> Result<(), String> {
        let mut auth = self
            .auth
            .get_valid_auth_headers()
            .await?
            .ok_or_else(|| "Chưa đăng nhập Google".to_string())?;

        for attempt in 0..2 {
            let mut req = self
                .http
                .get(full_url)
                .header("User-Agent", TV_OAUTH_UA)
                .header("Referer", "https://www.youtube.com/tv")
                .header("Origin", "https://www.youtube.com")
                .header("Authorization", &auth.authorization);

            if let Some(ref pid) = auth.page_id {
                req = req.header("X-Goog-Pageid", pid);
            }
            if let Some(ref vd) = auth.visitor_data {
                req = req.header("X-Goog-Visitor-Id", vd);
            }

            let res = req
                .send()
                .await
                .map_err(|e| format!("Lỗi đồng bộ lịch sử xem YouTube: {e}"))?;

            if res.status().as_u16() == 401 && attempt == 0 {
                if let Some(refreshed) = self
                    .auth
                    .force_refresh_auth_headers(&auth.authorization)
                    .await?
                {
                    auth = refreshed;
                    continue;
                }
            }

            if !res.status().is_success() {
                let code = res.status().as_u16();
                return Err(format!("YouTube stats trả về HTTP {code}"));
            }

            return Ok(());
        }

        Ok(())
    }

    pub async fn get_home_videos(&self) -> Result<Vec<SearchVideoItem>, String> {
        if self.auth.is_signed_in() {
            if let Ok(resp) = self
                .innertube_tv_auth_request("browse", json!({ "browseId": "default" }))
                .await
            {
                let mut list = Vec::new();
                let mut seen = HashSet::new();
                walk_browse_videos(&resp, &mut list, &mut seen);
                if !list.is_empty() {
                    return Ok(list);
                }
            }
        }
        self.get_trending_videos().await
    }

    pub async fn get_subscriptions_videos(&self) -> Result<Vec<SearchVideoItem>, String> {
        let resp = self
            .innertube_tv_auth_request("browse", json!({ "browseId": "FEsubscriptions" }))
            .await?;

        let mut list = Vec::new();
        let mut seen = HashSet::new();
        walk_browse_videos(&resp, &mut list, &mut seen);
        Ok(list)
    }

    pub async fn get_youtube_history(&self) -> Result<Vec<SearchVideoItem>, String> {
        let resp = self
            .innertube_tv_auth_request("browse", json!({ "browseId": "FEhistory" }))
            .await?;

        let mut list = Vec::new();
        let mut seen = HashSet::new();
        walk_browse_videos(&resp, &mut list, &mut seen);
        Ok(list)
    }

    pub async fn get_watch_later_videos(&self) -> Result<Vec<SearchVideoItem>, String> {
        let resp = self
            .innertube_tv_auth_request("browse", json!({ "browseId": "VLWL" }))
            .await?;

        let mut list = Vec::new();
        let mut seen = HashSet::new();
        walk_browse_videos(&resp, &mut list, &mut seen);

        if list.is_empty() {
            if let Ok(alt) = self
                .innertube_tv_auth_request(
                    "browse",
                    json!({ "browseId": "FEmy_youtube", "params": "cAc%3D" }),
                )
                .await
            {
                walk_browse_videos(&alt, &mut list, &mut seen);
            }
        }

        Ok(list)
    }

    pub async fn add_to_watch_later(&self, video_id: &str) -> Result<bool, String> {
        let vid = Self::extract_video_id(video_id)?;
        let resp = self
            .innertube_tv_auth_request(
                "browse/edit_playlist",
                json!({
                    "playlistId": "WL",
                    "actions": [{
                        "addedVideoId": vid,
                        "action": "ACTION_ADD_VIDEO"
                    }]
                }),
            )
            .await?;

        let status = resp
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("STATUS_SUCCEEDED");
        Ok(status == "STATUS_SUCCEEDED" || resp.get("playlistEditResults").is_some())
    }

    pub async fn remove_from_watch_later(&self, video_id: &str) -> Result<bool, String> {
        let vid = Self::extract_video_id(video_id)?;
        let resp = self
            .innertube_tv_auth_request(
                "browse/edit_playlist",
                json!({
                    "playlistId": "WL",
                    "actions": [{
                        "removedVideoId": vid,
                        "action": "ACTION_REMOVE_VIDEO_BY_VIDEO_ID"
                    }]
                }),
            )
            .await?;

        let status = resp
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("STATUS_SUCCEEDED");
        Ok(status == "STATUS_SUCCEEDED" || resp.get("playlistEditResults").is_some())
    }

    pub async fn sync_watch_progress(
        &self,
        video_id: &str,
        position_sec: f64,
        duration_sec: f64,
    ) -> Result<(), String> {
        if !self.auth.is_signed_in() || duration_sec <= 0.0 || !position_sec.is_finite() {
            return Ok(());
        }

        let vid = Self::extract_video_id(video_id)?;
        let now = now_unix_ms();
        let clamped_pos = position_sec.max(0.0).min(duration_sec);

        const HISTORY_RENEW_MS: i64 = 30 * 60 * 1000;
        const START_THRESHOLD_SEC: f64 = 180.0;

        let existing = {
            let guard = self.tracking_cache.read().ok();
            guard.and_then(|m| m.get(&vid).cloned())
        };

        let mut need_new_record = false;
        let session = if let Some(s) = existing {
            if now.saturating_sub(s.record_created_at_ms) > HISTORY_RENEW_MS {
                need_new_record = true;
            }
            s
        } else {
            let player_resp = self
                .innertube_tv_auth_request(
                    "player",
                    json!({
                        "videoId": vid,
                        "contentCheckOk": true,
                        "racyCheckOk": true
                    }),
                )
                .await?;

            let Some((ei, vm, of)) = extract_tracking_params(&player_resp) else {
                return Ok(());
            };
            need_new_record = true;
            TrackingSession {
                ei,
                vm,
                of,
                cpn: generate_cpn(),
                last_pos_sec: if clamped_pos < START_THRESHOLD_SEC {
                    0.0
                } else {
                    clamped_pos
                },
                record_created_at_ms: now,
            }
        };

        let old_pos_sec = session.last_pos_sec.max(0.0).min(duration_sec);
        let is_almost_watched = (duration_sec - clamped_pos) < (duration_sec * 0.05);

        let len_str = format!("{duration_sec:.1}");
        let pos_str = format!("{clamped_pos:.3}");
        let old_str = format!("{old_pos_sec:.3}");

        if is_almost_watched {
            let playback_url = build_stats_url(
                "https://www.youtube.com/api/stats/playback",
                &[
                    ("ns", "yt"),
                    ("ver", "2"),
                    ("final", "1"),
                    ("docid", &vid),
                    ("cpn", &session.cpn),
                    ("ei", &session.ei),
                    ("vm", &session.vm),
                    ("of", &session.of),
                ],
            )?;
            let _ = self.stats_get_with_auth(&playback_url).await;

            let watchtime_url = build_stats_url(
                "https://www.youtube.com/api/stats/watchtime",
                &[
                    ("ns", "yt"),
                    ("ver", "2"),
                    ("final", "1"),
                    ("docid", &vid),
                    ("st", &len_str),
                    ("et", &len_str),
                    ("cpn", &session.cpn),
                    ("ei", &session.ei),
                    ("vm", &session.vm),
                    ("of", &session.of),
                ],
            )?;
            self.stats_get_with_auth(&watchtime_url).await?;
        } else {
            if need_new_record {
                let playback_url = build_stats_url(
                    "https://www.youtube.com/api/stats/playback",
                    &[
                        ("ns", "yt"),
                        ("ver", "2"),
                        ("docid", &vid),
                        ("len", &len_str),
                        ("cmt", &old_str),
                        ("cpn", &session.cpn),
                        ("ei", &session.ei),
                        ("vm", &session.vm),
                        ("of", &session.of),
                    ],
                )?;
                let _ = self.stats_get_with_auth(&playback_url).await;
            }

            let watchtime_url = build_stats_url(
                "https://www.youtube.com/api/stats/watchtime",
                &[
                    ("ns", "yt"),
                    ("ver", "2"),
                    ("docid", &vid),
                    ("len", &len_str),
                    ("st", &old_str),
                    ("et", &pos_str),
                    ("cmt", &pos_str),
                    ("cpn", &session.cpn),
                    ("ei", &session.ei),
                    ("vm", &session.vm),
                    ("of", &session.of),
                ],
            )?;
            self.stats_get_with_auth(&watchtime_url).await?;
        }

        if let Ok(mut guard) = self.tracking_cache.write() {
            let updated_created_at = if need_new_record {
                now
            } else {
                session.record_created_at_ms
            };
            guard.insert(
                vid,
                TrackingSession {
                    ei: session.ei,
                    vm: session.vm,
                    of: session.of,
                    cpn: session.cpn,
                    last_pos_sec: clamped_pos,
                    record_created_at_ms: updated_created_at,
                },
            );
        }

        Ok(())
    }

    pub async fn rate_video(&self, video_id: &str, like: bool) -> Result<bool, String> {
        let vid = Self::extract_video_id(video_id)?;
        let endpoint = if like { "like/like" } else { "like/removelike" };
        self.innertube_tv_auth_request(endpoint, json!({ "target": { "videoId": vid } }))
            .await?;
        Ok(like)
    }

    pub async fn get_shorts_feed(
        &self,
        continuation: Option<String>,
    ) -> Result<ShortsFeedResult, String> {
        if let Some(token) = continuation.filter(|s| !s.trim().is_empty()) {
            return self.fetch_reel_sequence(&token).await;
        }

        let mut items = Vec::new();
        let mut seen = HashSet::new();

        // If signed in, pull recent Shorts from Subscriptions on TVHTML5 first
        if self.auth.is_signed_in() {
            if let Ok(subs_resp) = self
                .innertube_tv_auth_request("browse", json!({ "browseId": "FEsubscriptions" }))
                .await
            {
                let mut sub_shorts = Vec::new();
                collect_tv_subscribed_shorts(&subs_resp, &mut sub_shorts, &mut seen);
                items.extend(sub_shorts);
            }
        }

        // Seedless Shorts request (matching MeeTube BrowseApiHelper.getReelQuery)
        let seed_resp = self
            .innertube_request(
                "reel/reel_item_watch",
                json!({
                    "disablePlayerResponse": true,
                    "inputType": "REEL_WATCH_INPUT_TYPE_SEEDLESS",
                    "params": "CA8%3D"
                }),
                &CLIENT_WEB,
            )
            .await?;

        if let Some(seed_vid) = seed_resp
            .pointer("/replacementEndpoint/reelWatchEndpoint/videoId")
            .and_then(|v| v.as_str())
            .filter(|v| is_valid_video_id(v))
        {
            let seed_params = seed_resp
                .pointer("/replacementEndpoint/reelWatchEndpoint/params")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut seed_item = ShortVideoItem {
                id: seed_vid.to_string(),
                title: String::new(),
                channel: String::new(),
                channel_id: None,
                channel_avatar: None,
                thumbnail: format!("https://i.ytimg.com/vi/{seed_vid}/oar2.jpg"),
                like_count_text: None,
                comment_count_text: None,
                view_count_text: None,
                published_text: None,
                params: seed_params,
            };
            parse_reel_overlay_metadata(&seed_resp, &mut seed_item);
            if seed_item.title.is_empty() {
                seed_item.title = format!("YouTube Shorts #{seed_vid}");
            }
            if seed_item.channel.is_empty() {
                seed_item.channel = "YouTube Shorts".to_string();
            }
            if seen.insert(seed_item.id.clone()) {
                items.push(seed_item);
            }
        }

        let seq_token = seed_resp
            .get("sequenceContinuation")
            .and_then(|v| v.as_str())
            .or_else(|| {
                seed_resp
                    .pointer("/continuationEndpoint/reelWatchSequenceEndpoint/sequenceParams")
                    .and_then(|v| v.as_str())
            })
            .or_else(|| {
                seed_resp
                    .pointer("/continuationEndpoint/continuationCommand/token")
                    .and_then(|v| v.as_str())
            })
            .map(|s| s.to_string());

        let mut next_token = None;
        if let Some(tok) = seq_token {
            if let Ok(seq_res) = self.fetch_reel_sequence(&tok).await {
                next_token = seq_res.continuation_token;
                for item in seq_res.items {
                    if seen.insert(item.id.clone()) {
                        items.push(item);
                    }
                }
            }
        }

        if items.is_empty() {
            return Err("Không tải được danh sách YouTube Shorts".to_string());
        }

        Ok(ShortsFeedResult {
            items,
            continuation_token: next_token,
        })
    }

    async fn fetch_reel_sequence(&self, seq_token: &str) -> Result<ShortsFeedResult, String> {
        let resp = self
            .innertube_request(
                "reel/reel_watch_sequence",
                json!({ "sequenceParams": seq_token }),
                &CLIENT_WEB,
            )
            .await?;

        let mut drafts: Vec<ShortVideoItem> = Vec::new();
        let mut seen = HashSet::new();

        if let Some(entries) = resp.get("entries").and_then(|v| v.as_array()) {
            for entry in entries {
                let endpoint = match entry.pointer("/command/reelWatchEndpoint") {
                    Some(ep) => ep,
                    None => continue,
                };
                if endpoint
                    .pointer("/adClientParams/isAd")
                    .and_then(|v| v.as_bool())
                    == Some(true)
                {
                    continue;
                }
                let Some(vid) = endpoint.get("videoId").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !is_valid_video_id(vid) || !seen.insert(vid.to_string()) {
                    continue;
                }

                let params = endpoint
                    .get("params")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let thumb = endpoint
                    .pointer("/thumbnail/thumbnails/0/url")
                    .and_then(|v| v.as_str())
                    .map(normalize_thumb_url)
                    .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{vid}/oar2.jpg"));

                let mut item = ShortVideoItem {
                    id: vid.to_string(),
                    title: String::new(),
                    channel: String::new(),
                    channel_id: None,
                    channel_avatar: None,
                    thumbnail: thumb,
                    like_count_text: None,
                    comment_count_text: None,
                    view_count_text: None,
                    published_text: None,
                    params: params.clone(),
                };

                if let Some(pr) = entry.pointer("/unserializedPrefetchData/playerResponse") {
                    parse_short_prefetch_player(pr, &mut item);
                }
                if let Some(watch_resp) =
                    entry.pointer("/unserializedPrefetchData/reelItemWatchResponse")
                {
                    parse_reel_overlay_metadata(watch_resp, &mut item);
                }

                drafts.push(item);
            }
        }

        // Concurrently fetch missing titles/channel/actions via reel_item_watch for entries without complete metadata
        let enrich_indices: Vec<usize> = drafts
            .iter()
            .enumerate()
            .filter(|(_, it)| it.title.is_empty() || it.channel.is_empty())
            .take(8)
            .map(|(idx, _)| idx)
            .collect();

        if !enrich_indices.is_empty() {
            let futs = enrich_indices.iter().map(|&idx| {
                let vid = drafts[idx].id.clone();
                let params = drafts[idx].params.clone();
                async move {
                    let mut body = json!({
                        "disablePlayerResponse": true,
                        "playerRequest": { "videoId": vid }
                    });
                    if let Some(p) = params {
                        body["params"] = Value::String(p);
                    }
                    let res = self
                        .innertube_request("reel/reel_item_watch", body, &CLIENT_WEB)
                        .await;
                    (idx, res)
                }
            });

            let enriched = futures_util::future::join_all(futs).await;
            for (idx, res) in enriched {
                if let Ok(watch_json) = res {
                    parse_reel_overlay_metadata(&watch_json, &mut drafts[idx]);
                }
            }
        }

        for item in &mut drafts {
            if item.title.is_empty() {
                item.title = format!("YouTube Shorts #{}", item.id);
            }
            if item.channel.is_empty() {
                item.channel = "YouTube Shorts".to_string();
            }
        }

        let next_token = resp
            .pointer("/continuationEndpoint/continuationCommand/token")
            .and_then(|v| v.as_str())
            .or_else(|| {
                resp.pointer("/continuationEndpoint/reelWatchSequenceEndpoint/sequenceParams")
                    .and_then(|v| v.as_str())
            })
            .or_else(|| resp.get("sequenceContinuation").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        Ok(ShortsFeedResult {
            items: drafts,
            continuation_token: next_token,
        })
    }

    async fn innertube_music_request(
        &self,
        endpoint: &str,
        mut body: Value,
    ) -> Result<Value, String> {
        let visitor = self.visitor_data.read().ok().and_then(|v| v.clone());
        let mut client_ctx = json!({
            "clientName": MUSIC_CLIENT_NAME,
            "clientVersion": MUSIC_CLIENT_VERSION,
            "hl": "vi",
            "gl": "VN"
        });
        if let Some(ref vd) = visitor {
            client_ctx["visitorData"] = Value::String(vd.clone());
        }

        if let Some(obj) = body.as_object_mut() {
            obj.insert("context".to_string(), json!({ "client": client_ctx }));
        }

        let url = format!("{MUSIC_INNERTUBE_BASE}{endpoint}?prettyPrint=false");
        let mut req = self
            .http
            .post(&url)
            .header("User-Agent", MUSIC_USER_AGENT)
            .header("Content-Type", "application/json")
            .header("Origin", "https://music.youtube.com")
            .header("X-Origin", "https://music.youtube.com")
            .header("Referer", "https://music.youtube.com/")
            .header("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
            .header("X-YouTube-Client-Name", MUSIC_CLIENT_ID)
            .header("X-YouTube-Client-Version", MUSIC_CLIENT_VERSION);

        if let Some(ref vd) = visitor {
            req = req.header("X-Goog-Visitor-Id", vd);
        }

        let res = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Lỗi gọi YouTube Music ({endpoint}): {e}"))?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let txt = res.text().await.unwrap_or_default();
            let preview: String = txt.chars().take(240).collect();
            return Err(format!("YouTube Music HTTP {status} ({endpoint}): {preview}"));
        }

        res.json::<Value>()
            .await
            .map_err(|e| format!("JSON YouTube Music không hợp lệ: {e}"))
    }

    pub async fn get_music_home(&self) -> Result<Vec<MusicShelf>, String> {
        let mut shelves = Vec::new();
        if let Ok(resp) = self
            .innertube_music_request("browse", json!({ "browseId": "FEmusic_home" }))
            .await
        {
            if let Some(contents) = resp.get("contents") {
                walk_music_shelves(contents, &mut shelves);
            } else {
                walk_music_shelves(&resp, &mut shelves);
            }
        }

        shelves.retain(|s| !s.items.is_empty());

        // Anonymous FEmusic_home sometimes only returns mood tiles without playable tracks;
        // enrich concurrently with curated YouTube Music song search shelves.
        if shelves.len() < 2 {
            let presets = [
                ("Nhạc Việt Thịnh Hành", "Nhac Viet Hot Thinh Hanh"),
                ("V-Pop Chill & Acoustic", "V-Pop Chill Acoustic"),
                ("Top Hits Quốc Tế", "Top Hits 2026 Official Audio"),
            ];
            let futs = presets.iter().map(|(label, query)| async move {
                let items = self
                    .search_music(query, Some("songs"))
                    .await
                    .unwrap_or_default();
                ((*label).to_string(), items)
            });
            let extras = futures_util::future::join_all(futs).await;
            for (label, mut items) in extras {
                if !items.is_empty() {
                    items.truncate(12);
                    shelves.push(MusicShelf {
                        title: label,
                        items,
                    });
                }
            }
        }

        Ok(shelves)
    }

    pub async fn search_music(
        &self,
        query: &str,
        filter: Option<&str>,
    ) -> Result<Vec<MusicTrackItem>, String> {
        let filter_params = match filter.unwrap_or("songs") {
            "all" => None,
            "videos" => Some("EgWKAQIQAWoMEA4QChADEAQQCRAF"),
            _ => Some("EgWKAQIIAWoMEA4QChADEAQQCRAF"),
        };

        let mut body = json!({ "query": query });
        if let Some(p) = filter_params {
            body["params"] = Value::String(p.to_string());
        }

        let resp = self.innertube_music_request("search", body).await?;
        let mut tracks = Vec::new();
        let mut seen = HashSet::new();
        if let Some(contents) = resp.get("contents") {
            walk_music_tracks(contents, &mut tracks, &mut seen);
        } else {
            walk_music_tracks(&resp, &mut tracks, &mut seen);
        }

        Ok(tracks)
    }

    pub async fn get_music_radio(
        &self,
        video_id: &str,
        playlist_id: Option<&str>,
    ) -> Result<Vec<MusicTrackItem>, String> {
        let vid = Self::extract_video_id(video_id)?;
        let pid = playlist_id
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("RDAMVM{vid}"));

        let resp = self
            .innertube_music_request(
                "next",
                json!({
                    "videoId": vid,
                    "playlistId": pid,
                    "isAudioOnly": true
                }),
            )
            .await?;

        let mut tracks = Vec::new();
        let mut seen = HashSet::new();
        walk_music_panel_tracks(&resp, &mut tracks, &mut seen);
        Ok(tracks)
    }

    pub async fn get_music_audio_stream(
        &self,
        video_id: &str,
        playlist_id: Option<&str>,
    ) -> Result<MusicAudioStreamResult, String> {
        let vid = Self::extract_video_id(video_id)?;

        self.ensure_visitor_data().await;

        let (player_res, radio_res) = tokio::join!(
            self.resolve_player_for_mode(&vid, StreamExtractMode::Audio),
            self.get_music_radio(&vid, playlist_id)
        );

        let mut player_resp = player_res?;
        let mut parsed = parse_stream_formats(player_resp.get("streamingData"));

        if parsed.audio_only.is_empty() {
            let ios_data = self.fetch_ios_streaming_data(&vid).await;
            merge_streaming_formats(&mut player_resp, &ios_data);
            parsed = parse_stream_formats(player_resp.get("streamingData"));
        }

        let best_audio = select_best_audio(&parsed.audio_only);

        let (raw_url, itag, mime_type, bitrate) = if let Some(audio) = best_audio {
            (audio.url, audio.itag, audio.mime_type, audio.bitrate)
        } else if let Some(muxed) = parsed
            .muxed
            .iter()
            .find(|m| m.itag == 18)
            .or_else(|| parsed.muxed.first())
        {
            (
                muxed.url.clone(),
                muxed.itag,
                muxed.mime_type.clone(),
                muxed.bitrate,
            )
        } else {
            return Err("Không tìm thấy luồng âm thanh cho bài hát này".to_string());
        };

        let resolved_client = extract_url_client_param(&raw_url)
            .unwrap_or_else(|| CLIENT_VISIONOS.name.to_string());

        let proxy_audio_url = format!(
            "http://127.0.0.1:8989/stream?url={}&client={}&id={}&itag={}",
            urlencoding::encode(&raw_url),
            urlencoding::encode(&resolved_client),
            urlencoding::encode(&vid),
            itag
        );

        eprintln!(
            "[TayTube Music] id={} mode=Audio | audio_af={} | selected_itag={} client={} bitrate={}",
            vid,
            parsed.audio_only.len(),
            itag,
            resolved_client,
            bitrate
        );

        let vd = player_resp.get("videoDetails");
        let title = vd
            .and_then(|d| d.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("YouTube Music")
            .to_string();
        let artist = vd
            .and_then(|d| d.get("author"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Artist")
            .to_string();
        let duration_sec = vd
            .and_then(|d| d.get("lengthSeconds"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let thumbnail = vd
            .and_then(|d| d.pointer("/thumbnail/thumbnails"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|v| v.as_str())
            .map(|u| upgrade_music_thumb(u, 544))
            .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg"));

        let radio_tracks = radio_res.unwrap_or_default();

        Ok(MusicAudioStreamResult {
            video_id: vid,
            title,
            artist,
            duration_sec,
            thumbnail,
            proxy_audio_url,
            mime_type,
            bitrate,
            radio_tracks,
        })
    }
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn generate_cpn() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(16);
    for b in digest.iter().take(16) {
        out.push(ALPHABET[(*b as usize) % ALPHABET.len()] as char);
    }
    out
}

fn build_stats_url(base: &str, params: &[(&str, &str)]) -> Result<String, String> {
    let mut parsed = Url::parse(base).map_err(|e| format!("Invalid stats URL: {e}"))?;
    {
        let mut pairs = parsed.query_pairs_mut();
        for (k, v) in params {
            if !v.is_empty() {
                pairs.append_pair(k, v);
            }
        }
    }
    Ok(parsed.to_string())
}

fn extract_tracking_params(player_resp: &Value) -> Option<(String, String, String)> {
    let base_url = player_resp
        .pointer("/playbackTracking/videostatsWatchtimeUrl/baseUrl")
        .or_else(|| player_resp.pointer("/playbackTracking/videostatsPlaybackUrl/baseUrl"))
        .and_then(|v| v.as_str())?;

    let parsed = Url::parse(base_url).ok()?;
    let mut ei = String::new();
    let mut vm = String::new();
    let mut of = String::new();

    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "ei" => ei = v.into_owned(),
            "vm" => vm = v.into_owned(),
            "of" => of = v.into_owned(),
            _ => {}
        }
    }

    if ei.is_empty() || vm.is_empty() || of.is_empty() {
        None
    } else {
        Some((ei, vm, of))
    }
}

fn is_valid_video_id(s: &str) -> bool {
    s.len() == 11
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn sponsor_category_label(cat: &str) -> &'static str {
    match cat {
        "sponsor" => "Sponsor / Tài trợ",
        "selfpromo" => "Self-promotion / Tự quảng cáo",
        "interaction" => "Interaction / Kêu gọi Like & Sub",
        "intro" => "Intro / Đoạn mở đầu",
        "outro" => "Outro / Đoạn kết thúc",
        "preview" => "Preview & Recap / Xem trước",
        "music_offtopic" => "Non-music / Đoạn ngoài âm nhạc",
        "filler" => "Filler / Đoạn lan man",
        _ => "SponsorBlock",
    }
}

fn extract_runs_or_simple(val: Option<&Value>) -> String {
    let Some(v) = val else {
        return String::new();
    };
    if let Some(simple) = v.get("simpleText").and_then(|s| s.as_str()) {
        return simple.to_string();
    }
    if let Some(runs) = v.get("runs").and_then(|r| r.as_array()) {
        let mut out = String::new();
        for run in runs {
            if let Some(t) = run.get("text").and_then(|s| s.as_str()) {
                out.push_str(t);
            }
        }
        return out;
    }
    String::new()
}

fn parse_duration_to_sec(s: &str) -> i64 {
    if s.trim().is_empty() {
        return 0;
    }
    let parts: Vec<i64> = s
        .trim()
        .split(':')
        .filter_map(|p| p.trim().parse::<i64>().ok())
        .collect();
    match parts.len() {
        3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
        2 => parts[0] * 60 + parts[1],
        1 => parts[0],
        _ => 0,
    }
}

fn extract_format_url(raw: &Value) -> Option<String> {
    if let Some(url) = raw.get("url").and_then(|v| v.as_str()) {
        if !url.is_empty() {
            return Some(url.to_string());
        }
    }
    let cipher = raw
        .get("signatureCipher")
        .or_else(|| raw.get("cipher"))
        .and_then(|v| v.as_str())?;

    let mut base_url: Option<String> = None;
    let mut sig: Option<String> = None;
    let mut sp = "sig".to_string();

    for (k, v) in url::form_urlencoded::parse(cipher.as_bytes()) {
        match k.as_ref() {
            "url" => base_url = Some(v.into_owned()),
            "s" | "sig" => sig = Some(v.into_owned()),
            "sp" => sp = v.into_owned(),
            _ => {}
        }
    }

    let url = base_url?;
    if let Some(s) = sig {
        let sep = if url.contains('?') { '&' } else { '?' };
        Some(format!("{url}{sep}{sp}={}", urlencoding::encode(&s)))
    } else {
        Some(url)
    }
}

fn extract_codec(mime: &str) -> String {
    if let Some(start) = mime.find("codecs=\"") {
        let rest = &mime[start + 8..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    String::new()
}

fn parse_range_obj(val: Option<&Value>) -> Option<StreamRange> {
    let obj = val?.as_object()?;
    let start = value_to_string(obj.get("start")?)?;
    let end = value_to_string(obj.get("end")?)?;
    Some(StreamRange { start, end })
}

fn value_to_string(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        Some(s.to_string())
    } else if let Some(n) = v.as_i64() {
        Some(n.to_string())
    } else if let Some(n) = v.as_u64() {
        Some(n.to_string())
    } else {
        None
    }
}

fn value_to_u64(v: Option<&Value>) -> Option<u64> {
    let v = v?;
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
}

fn is_hdr_format(raw: &Value, itag: i64, codec: &str) -> bool {
    if matches!(itag, 334..=337 | 698..=701) {
        return true;
    }
    if let Some(color) = raw.get("colorInfo") {
        let transfer = color
            .get("transferCharacteristics")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let primaries = color
            .get("primaries")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        if transfer.contains("2084")
            || transfer.contains("HLG")
            || transfer.contains("ARIB_STD_B67")
            || primaries.contains("BT2020")
        {
            return true;
        }
    }
    let lower_codec = codec.to_lowercase();
    if lower_codec.contains("vp09.02") || lower_codec.contains("vp9.2") {
        return true;
    }
    if lower_codec.starts_with("av01") {
        let parts: Vec<&str> = lower_codec.split('.').collect();
        if parts.len() > 3 && parts[3].len() >= 2 {
            if let Ok(depth) = parts[3][..2].parse::<i32>() {
                if depth >= 10 {
                    return true;
                }
            }
        }
    }
    false
}

struct ParsedStreamFormats {
    muxed: Vec<VideoStreamFormat>,
    video_only: Vec<VideoStreamFormat>,
    audio_only: Vec<AudioStreamFormat>,
    all_qualities: Vec<i64>,
    hdr_qualities: Vec<i64>,
}

fn parse_stream_formats(streaming_data: Option<&Value>) -> ParsedStreamFormats {
    let mut muxed = Vec::new();
    let mut video_only = Vec::new();
    let mut audio_only = Vec::new();

    let Some(sd) = streaming_data else {
        return ParsedStreamFormats {
            muxed,
            video_only,
            audio_only,
            all_qualities: Vec::new(),
            hdr_qualities: Vec::new(),
        };
    };

    if let Some(raw_muxed) = sd.get("formats").and_then(|v| v.as_array()) {
        for raw in raw_muxed {
            if let Some(stream) = parse_video_format(raw, true) {
                muxed.push(stream);
            }
        }
    }

    if let Some(raw_adaptive) = sd.get("adaptiveFormats").and_then(|v| v.as_array()) {
        for raw in raw_adaptive {
            let mime = raw
                .get("mimeType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            if mime.starts_with("video/") {
                if let Some(stream) = parse_video_format(raw, false) {
                    video_only.push(stream);
                }
            } else if mime.starts_with("audio/") {
                if let Some(stream) = parse_audio_format(raw) {
                    audio_only.push(stream);
                }
            }
        }
    }

    let mut q_set = HashSet::new();
    let mut hdr_set = HashSet::new();
    for v in video_only.iter().chain(muxed.iter()) {
        if v.height > 0 {
            q_set.insert(v.height);
            if v.is_hdr {
                hdr_set.insert(v.height);
            }
        }
    }

    let mut all_qualities: Vec<i64> = q_set.into_iter().collect();
    all_qualities.sort_by(|a, b| b.cmp(a));
    let mut hdr_qualities: Vec<i64> = hdr_set.into_iter().collect();
    hdr_qualities.sort_by(|a, b| b.cmp(a));

    ParsedStreamFormats {
        muxed,
        video_only,
        audio_only,
        all_qualities,
        hdr_qualities,
    }
}

fn parse_video_format(raw: &Value, is_muxed: bool) -> Option<VideoStreamFormat> {
    let url = extract_format_url(raw)?;
    let itag = raw.get("itag").and_then(|v| v.as_i64()).unwrap_or(0);
    let mime = raw
        .get("mimeType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let codec = extract_codec(&mime);
    let container = if mime.contains("mp4") {
        "mp4"
    } else if mime.contains("webm") {
        "webm"
    } else {
        "unknown"
    }
    .to_string();

    let height = raw.get("height").and_then(|v| v.as_i64()).unwrap_or(0);
    let width = raw.get("width").and_then(|v| v.as_i64()).unwrap_or(0);
    let fps = raw.get("fps").and_then(|v| v.as_i64()).unwrap_or(30);
    let is_hdr = is_hdr_format(raw, itag, &codec);

    let quality_label = raw
        .get("qualityLabel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            format!(
                "{height}p{}{}",
                if fps > 30 { fps.to_string() } else { String::new() },
                if is_hdr { " HDR" } else { "" }
            )
        });

    Some(VideoStreamFormat {
        itag,
        url,
        mime_type: mime,
        container,
        codec,
        width,
        height,
        fps,
        quality: raw
            .get("quality")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        quality_label,
        bitrate: raw.get("bitrate").and_then(|v| v.as_i64()).unwrap_or(0),
        average_bitrate: raw.get("averageBitrate").and_then(|v| v.as_i64()),
        content_length: value_to_u64(raw.get("contentLength")),
        approx_duration_ms: value_to_u64(raw.get("approxDurationMs")),
        init_range: parse_range_obj(raw.get("initRange")),
        index_range: parse_range_obj(raw.get("indexRange")),
        is_hdr,
        is_video: true,
        is_audio: is_muxed,
        is_muxed,
    })
}

fn parse_audio_format(raw: &Value) -> Option<AudioStreamFormat> {
    let url = extract_format_url(raw)?;
    let itag = raw.get("itag").and_then(|v| v.as_i64()).unwrap_or(0);
    let mime = raw
        .get("mimeType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let codec = extract_codec(&mime);
    let container = if mime.contains("mp4") || mime.contains("m4a") {
        "m4a"
    } else if mime.contains("webm") {
        "webm"
    } else {
        "unknown"
    }
    .to_string();

    Some(AudioStreamFormat {
        itag,
        url,
        mime_type: mime,
        container,
        codec,
        bitrate: raw.get("bitrate").and_then(|v| v.as_i64()).unwrap_or(0),
        average_bitrate: raw.get("averageBitrate").and_then(|v| v.as_i64()),
        audio_sample_rate: raw.get("audioSampleRate").and_then(value_to_string),
        audio_channels: raw.get("audioChannels").and_then(|v| v.as_i64()),
        content_length: value_to_u64(raw.get("contentLength")),
        approx_duration_ms: value_to_u64(raw.get("approxDurationMs")),
        init_range: parse_range_obj(raw.get("initRange")),
        index_range: parse_range_obj(raw.get("indexRange")),
        is_original: raw
            .get("audioTrack")
            .and_then(|t| t.get("audioIsDefault"))
            .and_then(|v| v.as_bool())
            .map(|d| Some(d))
            .unwrap_or(Some(true)),
        language: raw
            .get("audioTrack")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(|id| id.chars().take(2).collect()),
    })
}

fn find_best_video(
    candidates: &[VideoStreamFormat],
    target_height: i64,
    prefer_hdr: bool,
) -> Option<VideoStreamFormat> {
    if candidates.is_empty() {
        return None;
    }

    let lower: Vec<&VideoStreamFormat> = candidates
        .iter()
        .filter(|v| v.height <= target_height)
        .collect();
    let mut pool: Vec<&VideoStreamFormat> = if lower.is_empty() {
        candidates.iter().collect()
    } else {
        lower
    };

    pool.sort_by(|a, b| {
        b.height
            .cmp(&a.height)
            .then_with(|| {
                if prefer_hdr {
                    b.is_hdr.cmp(&a.is_hdr)
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .then_with(|| b.fps.cmp(&a.fps))
            .then_with(|| b.bitrate.cmp(&a.bitrate))
    });

    pool.first().map(|v| (*v).clone())
}

fn merge_streaming_formats(player_resp: &mut Value, ios_data: &IosStreamingData) {
    let Some(sd) = player_resp
        .get_mut("streamingData")
        .and_then(|v| v.as_object_mut())
    else {
        return;
    };

    for (key, extra_formats) in [
        ("adaptiveFormats", &ios_data.adaptive_formats),
        ("formats", &ios_data.formats),
    ] {
        if extra_formats.is_empty() {
            continue;
        }
        let entry = sd
            .entry(key.to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(arr) = entry.as_array_mut() {
            let existing: HashSet<i64> = arr
                .iter()
                .filter_map(|f| f.get("itag").and_then(|v| v.as_i64()))
                .collect();
            for fmt in extra_formats {
                if let Some(itag) = fmt.get("itag").and_then(|v| v.as_i64()) {
                    if !existing.contains(&itag) {
                        arr.push(fmt.clone());
                    }
                }
            }
        }
    }
}

fn push_stream_candidate(
    raw_url: String,
    fmt_itag: i64,
    client_hint: &'static str,
    seen: &mut HashSet<(&'static str, i64)>,
    out: &mut Vec<(String, &'static str, &'static str)>,
) {
    let url_client = extract_url_client_param(&raw_url);
    let (resolved_client, resolved_ua) =
        resolve_client_user_agent(url_client.as_deref(), Some(client_hint));
    if seen.insert((resolved_client, fmt_itag)) {
        out.push((raw_url, resolved_client, resolved_ua));
    }
}

fn collect_fallback_candidates_from_resp(
    resp: &Value,
    client_hint: &'static str,
    itag: Option<i64>,
    is_audio: bool,
    seen: &mut HashSet<(&'static str, i64)>,
    primary_out: &mut Vec<(String, &'static str, &'static str)>,
    muxed_out: &mut Vec<(String, &'static str, &'static str)>,
) {
    if !YouTubeService::is_playable(resp) {
        return;
    }

    let parsed = parse_stream_formats(resp.get("streamingData"));

    if is_audio {
        if let Some(target_itag) = itag {
            if let Some(exact) = parsed.audio_only.iter().find(|f| f.itag == target_itag) {
                push_stream_candidate(exact.url.clone(), exact.itag, client_hint, seen, primary_out);
            }
        }
        if let Some(best) = select_best_audio(&parsed.audio_only) {
            push_stream_candidate(best.url, best.itag, client_hint, seen, primary_out);
        }
        if let Some(mux_18) = parsed
            .muxed
            .iter()
            .find(|m| m.itag == 18)
            .or_else(|| parsed.muxed.first())
        {
            push_stream_candidate(
                mux_18.url.clone(),
                mux_18.itag,
                client_hint,
                seen,
                muxed_out,
            );
        }
        return;
    }

    if let Some(target_itag) = itag {
        if let Some(v) = parsed
            .video_only
            .iter()
            .chain(parsed.muxed.iter())
            .find(|f| f.itag == target_itag)
        {
            push_stream_candidate(v.url.clone(), v.itag, client_hint, seen, primary_out);
            return;
        }
        if let Some(a) = parsed.audio_only.iter().find(|f| f.itag == target_itag) {
            push_stream_candidate(a.url.clone(), a.itag, client_hint, seen, primary_out);
            return;
        }
    }

    if let Some(m) = parsed.muxed.first() {
        push_stream_candidate(m.url.clone(), m.itag, client_hint, seen, primary_out);
    } else if let Some(v) = parsed.video_only.first() {
        push_stream_candidate(v.url.clone(), v.itag, client_hint, seen, primary_out);
    }
}

fn select_best_audio(candidates: &[AudioStreamFormat]) -> Option<AudioStreamFormat> {
    if candidates.is_empty() {
        return None;
    }

    let supported: Vec<&AudioStreamFormat> = candidates
        .iter()
        .filter(|fmt| {
            let mime = fmt.mime_type.to_lowercase();
            mime.starts_with("audio/mp4") || mime.starts_with("audio/webm")
        })
        .collect();

    let mut sorted: Vec<&AudioStreamFormat> = if supported.is_empty() {
        candidates.iter().collect()
    } else {
        supported
    };

    let score = |fmt: &AudioStreamFormat| -> i32 {
        if fmt.itag == 140 {
            return 1000;
        }
        if fmt.itag == 251 {
            return 850;
        }
        let mime = fmt.mime_type.to_lowercase();
        let codec = fmt.codec.to_lowercase();
        if fmt.container == "m4a" || mime.starts_with("audio/mp4") || codec.contains("mp4a") {
            return 600;
        }
        if fmt.container == "webm" || mime.starts_with("audio/webm") || codec.contains("opus") {
            return 450;
        }
        100
    };

    sorted.sort_by(|a, b| {
        b.is_original
            .unwrap_or(true)
            .cmp(&a.is_original.unwrap_or(true))
            .then_with(|| score(b).cmp(&score(a)))
            .then_with(|| {
                b.average_bitrate
                    .unwrap_or(b.bitrate)
                    .cmp(&a.average_bitrate.unwrap_or(a.bitrate))
            })
    });

    sorted.first().map(|a| (*a).clone())
}

fn select_quality(
    video_only: &[VideoStreamFormat],
    audio_only: &[AudioStreamFormat],
    muxed: &[VideoStreamFormat],
    target_height: i64,
    prefer_hdr: bool,
) -> SelectedStreams {
    let non_hdr: Vec<VideoStreamFormat> = if prefer_hdr {
        video_only.to_vec()
    } else {
        video_only.iter().filter(|v| !v.is_hdr).cloned().collect()
    };

    let mut best_video = find_best_video(&non_hdr, target_height, prefer_hdr);
    if best_video.is_none() && !video_only.is_empty() {
        best_video = find_best_video(video_only, target_height, prefer_hdr);
    }

    let best_audio = select_best_audio(audio_only);
    let best_muxed = find_best_video(muxed, target_height, prefer_hdr);
    let is_separate = best_video.is_some() && best_audio.is_some();

    let quality_label = best_video
        .as_ref()
        .map(|v| v.quality_label.clone())
        .or_else(|| best_muxed.as_ref().map(|m| m.quality_label.clone()))
        .unwrap_or_else(|| format!("{target_height}p"));

    SelectedStreams {
        video: best_video,
        audio: best_audio,
        muxed: best_muxed,
        quality_label,
        is_separate,
    }
}

fn extract_caption_tracks(player_resp: &Value) -> Vec<CaptionTrackInfo> {
    let Some(tracks) = player_resp
        .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for t in tracks {
        let Some(base_url) = t.get("baseUrl").and_then(|v| v.as_str()) else {
            continue;
        };
        if base_url.is_empty() {
            continue;
        }
        let lang = t
            .get("languageCode")
            .and_then(|v| v.as_str())
            .unwrap_or("und")
            .to_string();
        let is_auto = t.get("kind").and_then(|v| v.as_str()) == Some("asr");

        let mut label = extract_runs_or_simple(t.get("name"));
        if label.is_empty() {
            label = lang.clone();
        }
        if is_auto && !label.to_lowercase().contains("auto") {
            label = format!("{label} (tự động)");
        }

        let raw_vtt_url = match Url::parse(base_url) {
            Ok(mut parsed) => {
                let pairs: Vec<(String, String)> = parsed
                    .query_pairs()
                    .filter(|(k, _)| k != "fmt")
                    .map(|(k, v)| (k.into_owned(), v.into_owned()))
                    .collect();
                parsed.query_pairs_mut().clear().extend_pairs(pairs).append_pair("fmt", "vtt");
                parsed.to_string()
            }
            Err(_) => {
                if base_url.contains('?') {
                    format!("{base_url}&fmt=vtt")
                } else {
                    format!("{base_url}?fmt=vtt")
                }
            }
        };

        // Route subtitle fetches through Local Proxy port 8989 so WebView2 avoids CORS issues
        let vtt_url = format!(
            "http://127.0.0.1:8989/subtitle?url={}",
            urlencoding::encode(&raw_vtt_url)
        );

        out.push(CaptionTrackInfo {
            language_tag: lang,
            label,
            url: base_url.to_string(),
            vtt_url,
            is_auto_generated: is_auto,
        });
    }

    out
}

fn parse_video_renderer(v: &Value) -> Option<SearchVideoItem> {
    let id = v.get("videoId").and_then(|x| x.as_str())?.to_string();
    if id.is_empty() {
        return None;
    }

    let title = extract_runs_or_simple(v.get("title"));
    let mut channel = extract_runs_or_simple(v.get("ownerText"));
    if channel.is_empty() {
        channel = extract_runs_or_simple(v.get("longBylineText"));
    }
    if channel.is_empty() {
        channel = extract_runs_or_simple(v.get("shortBylineText"));
    }

    let channel_id = v
        .pointer("/ownerText/runs/0/navigationEndpoint/browseEndpoint/browseId")
        .or_else(|| v.pointer("/longBylineText/runs/0/navigationEndpoint/browseEndpoint/browseId"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let thumbnail = v
        .pointer("/thumbnail/thumbnails")
        .and_then(|arr| arr.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));

    let duration_text = v
        .pointer("/lengthText/simpleText")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let duration_sec = parse_duration_to_sec(&duration_text);

    let view_count_text = v
        .pointer("/viewCountText/simpleText")
        .or_else(|| v.pointer("/shortViewCountText/simpleText"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();

    let published_text = v
        .pointer("/publishedTimeText/simpleText")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    Some(SearchVideoItem {
        id,
        title,
        channel,
        channel_id,
        thumbnail,
        duration_text,
        duration_sec,
        view_count_text,
        published_text,
        percent_watched: None,
    })
}

fn normalize_thumb_url(raw: &str) -> String {
    if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_string()
    }
}

fn parse_tile_renderer(tile: &Value) -> Option<SearchVideoItem> {
    let mut id = tile
        .pointer("/onSelectCommand/watchEndpoint/videoId")
        .or_else(|| tile.pointer("/onSelectCommand/reelWatchEndpoint/videoId"))
        .or_else(|| tile.pointer("/onSelectCommand/showMenuCommand/contentId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if id.is_empty() {
        if let Some(items) = tile
            .pointer("/menu/menuRenderer/items")
            .or_else(|| tile.pointer("/onLongPressCommand/showMenuCommand/menu/menuRenderer/items"))
            .and_then(|v| v.as_array())
        {
            for item in items {
                if let Some(vid) = item
                    .pointer("/menuNavigationItemRenderer/navigationEndpoint/watchEndpoint/videoId")
                    .and_then(|v| v.as_str())
                {
                    if !vid.is_empty() {
                        id = vid.to_string();
                        break;
                    }
                }
            }
        }
    }

    if !is_valid_video_id(&id) {
        return None;
    }

    let meta = tile.pointer("/metadata/tileMetadataRenderer");
    let header = tile
        .pointer("/header/tileHeaderRenderer")
        .or_else(|| tile.pointer("/header/trackTileHeaderRenderer"));

    let mut title = extract_runs_or_simple(meta.and_then(|m| m.get("title")));
    if title.is_empty() {
        title = extract_runs_or_simple(header.and_then(|h| h.get("title")));
    }
    if title.is_empty() {
        return None;
    }

    let mut lines: Vec<Vec<String>> = Vec::new();
    if let Some(raw_lines) = meta
        .and_then(|m| m.get("lines"))
        .and_then(|v| v.as_array())
    {
        for line in raw_lines {
            let mut parts = Vec::new();
            if let Some(items) = line
                .pointer("/lineRenderer/items")
                .and_then(|v| v.as_array())
            {
                for it in items {
                    let txt = extract_runs_or_simple(it.pointer("/lineItemRenderer/text"));
                    if !txt.trim().is_empty() {
                        parts.push(txt.trim().to_string());
                    }
                }
            }
            if !parts.is_empty() {
                lines.push(parts);
            }
        }
    }

    let (channel, view_count_text, published_text) = if lines.len() >= 2 {
        let ch = lines[0].join(" • ");
        let vc = lines[1].first().cloned().unwrap_or_default();
        let pub_t = if lines[1].len() > 1 {
            Some(lines[1][1..].join(" • "))
        } else {
            None
        };
        (ch, vc, pub_t)
    } else if lines.len() == 1 {
        let ch = lines[0].first().cloned().unwrap_or_default();
        let vc = lines[0].get(1).cloned().unwrap_or_default();
        let pub_t = if lines[0].len() > 2 {
            Some(lines[0][2..].join(" • "))
        } else {
            None
        };
        (ch, vc, pub_t)
    } else {
        (String::new(), String::new(), None)
    };

    let channel_id = tile
        .pointer("/onSelectCommand/browseEndpoint/browseId")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    let thumbnail = header
        .and_then(|h| h.pointer("/thumbnail/thumbnails"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|s| s.as_str())
        .map(normalize_thumb_url)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));

    let mut duration_text = String::new();
    let mut percent_watched: Option<i64> = None;

    if let Some(overlays) = header
        .and_then(|h| h.get("thumbnailOverlays"))
        .and_then(|v| v.as_array())
    {
        for ov in overlays {
            if duration_text.is_empty() {
                if let Some(time_renderer) = ov.get("thumbnailOverlayTimeStatusRenderer") {
                    let txt = extract_runs_or_simple(time_renderer.get("text"));
                    if !txt.trim().is_empty() {
                        duration_text = txt.trim().to_string();
                    } else if time_renderer.get("style").and_then(|v| v.as_str()) == Some("LIVE") {
                        duration_text = "LIVE".to_string();
                    }
                }
            }
            if percent_watched.is_none() {
                if let Some(pct) = ov
                    .pointer("/thumbnailOverlayResumePlaybackRenderer/percentDurationWatched")
                    .and_then(|v| v.as_i64())
                {
                    if pct > 0 {
                        percent_watched = Some(pct.min(100));
                    }
                }
            }
        }
    }

    let duration_sec = parse_duration_to_sec(&duration_text);

    Some(SearchVideoItem {
        id,
        title,
        channel,
        channel_id,
        thumbnail,
        duration_text,
        duration_sec,
        view_count_text,
        published_text,
        percent_watched,
    })
}

fn parse_standard_video_card(v: &Value) -> Option<SearchVideoItem> {
    let mut item = parse_video_renderer(v)?;
    item.thumbnail = normalize_thumb_url(&item.thumbnail);
    if item.channel.is_empty() {
        item.channel = extract_runs_or_simple(v.get("shortBylineText"));
    }
    if item.duration_text.is_empty() {
        if let Some(overlays) = v.get("thumbnailOverlays").and_then(|o| o.as_array()) {
            for ov in overlays {
                if let Some(ts) = ov.pointer("/thumbnailOverlayTimeStatusRenderer/text") {
                    let txt = extract_runs_or_simple(Some(ts));
                    if !txt.trim().is_empty() {
                        item.duration_text = txt.trim().to_string();
                        item.duration_sec = parse_duration_to_sec(&item.duration_text);
                    }
                }
                if let Some(pct) = ov
                    .pointer("/thumbnailOverlayResumePlaybackRenderer/percentDurationWatched")
                    .and_then(|p| p.as_i64())
                {
                    if pct > 0 {
                        item.percent_watched = Some(pct.min(100));
                    }
                }
            }
        }
    } else if let Some(overlays) = v.get("thumbnailOverlays").and_then(|o| o.as_array()) {
        for ov in overlays {
            if let Some(pct) = ov
                .pointer("/thumbnailOverlayResumePlaybackRenderer/percentDurationWatched")
                .and_then(|p| p.as_i64())
            {
                if pct > 0 {
                    item.percent_watched = Some(pct.min(100));
                    break;
                }
            }
        }
    }
    Some(item)
}

fn parse_lockup_video(map: &serde_json::Map<String, Value>, val: &Value) -> Option<SearchVideoItem> {
    if map.get("contentType").and_then(|x| x.as_str()) != Some("LOCKUP_CONTENT_TYPE_VIDEO")
        || !map.contains_key("lockupViewModel")
    {
        return None;
    }
    let id = map.get("contentId").and_then(|x| x.as_str())?.to_string();
    if !is_valid_video_id(&id) {
        return None;
    }
    let title = val
        .pointer("/metadata/lockupMetadataViewModel/title/content")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    if title.is_empty() {
        return None;
    }
    let channel = val
        .pointer("/metadata/lockupMetadataViewModel/metadata/contentMetadataViewModel/metadataRows/0/metadataParts/0/text/content")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let thumbnail = val
        .pointer("/contentImage/thumbnailViewModel/image/sources")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|s| s.get("url"))
        .and_then(|s| s.as_str())
        .map(normalize_thumb_url)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));

    Some(SearchVideoItem {
        id,
        title,
        channel,
        channel_id: None,
        thumbnail,
        duration_text: String::new(),
        duration_sec: 0,
        view_count_text: String::new(),
        published_text: None,
        percent_watched: None,
    })
}

fn walk_browse_videos(val: &Value, list: &mut Vec<SearchVideoItem>, seen: &mut HashSet<String>) {
    match val {
        Value::Object(map) => {
            if let Some(tabs) = map.get("tabs").and_then(|t| t.as_array()) {
                // On multi-tab views (e.g. TV Subscriptions with channel sidebar tabs),
                // prefer only the selected tab or the first tab with content so channel tabs don't mix.
                let selected_tab = tabs
                    .iter()
                    .find(|t| t.pointer("/tabRenderer/selected").and_then(|v| v.as_bool()) == Some(true))
                    .or_else(|| tabs.first());
                if let Some(tab) = selected_tab {
                    walk_browse_videos(tab, list, seen);
                }
                return;
            }

            if let Some(tile) = map.get("tileRenderer") {
                if let Some(item) = parse_tile_renderer(tile) {
                    if seen.insert(item.id.clone()) {
                        list.push(item);
                    }
                }
                return;
            }

            for key in [
                "videoRenderer",
                "gridVideoRenderer",
                "playlistVideoRenderer",
                "compactVideoRenderer",
            ] {
                if let Some(vr) = map.get(key) {
                    if let Some(item) = parse_standard_video_card(vr) {
                        if seen.insert(item.id.clone()) {
                            list.push(item);
                        }
                    }
                    return;
                }
            }

            if let Some(item) = parse_lockup_video(map, val) {
                if seen.insert(item.id.clone()) {
                    list.push(item);
                }
                return;
            }

            for child in map.values() {
                walk_browse_videos(child, list, seen);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_browse_videos(child, list, seen);
            }
        }
        _ => {}
    }
}

fn walk_trending(val: &Value, list: &mut Vec<SearchVideoItem>, seen: &mut HashSet<String>) {
    match val {
        Value::Object(map) => {
            if let Some(vr) = map.get("videoRenderer") {
                if let Some(item) = parse_video_renderer(vr) {
                    if seen.insert(item.id.clone()) {
                        list.push(item);
                    }
                }
            }
            for child in map.values() {
                walk_trending(child, list, seen);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_trending(child, list, seen);
            }
        }
        _ => {}
    }
}

fn walk_related(
    val: &Value,
    current_video_id: &str,
    items: &mut Vec<RelatedVideoItem>,
    seen: &mut HashSet<String>,
) {
    if items.len() >= 20 {
        return;
    }
    match val {
        Value::Object(map) => {
            if let Some(v) = map.get("compactVideoRenderer") {
                if let Some(vid) = v.get("videoId").and_then(|x| x.as_str()) {
                    if vid != current_video_id && seen.insert(vid.to_string()) {
                        let title = extract_runs_or_simple(v.get("title"));
                        if !title.is_empty() {
                            let channel = extract_runs_or_simple(v.get("shortBylineText"));
                            let thumbnail = v
                                .pointer("/thumbnail/thumbnails/0/url")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg"));
                            let duration_text = v
                                .pointer("/lengthText/simpleText")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());
                            let view_count_text = v
                                .pointer("/viewCountText/simpleText")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());

                            items.push(RelatedVideoItem {
                                id: vid.to_string(),
                                title,
                                channel,
                                thumbnail,
                                duration_text,
                                view_count_text,
                            });
                        }
                    }
                }
            } else if map.get("contentType").and_then(|x| x.as_str()) == Some("LOCKUP_CONTENT_TYPE_VIDEO")
                && map.contains_key("lockupViewModel")
            {
                if let Some(vid) = map.get("contentId").and_then(|x| x.as_str()) {
                    if vid != current_video_id && seen.insert(vid.to_string()) {
                        let title = val
                            .pointer("/metadata/lockupMetadataViewModel/title/content")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !title.is_empty() {
                            let channel = val
                                .pointer("/metadata/lockupMetadataViewModel/metadata/contentMetadataViewModel/metadataRows/0/metadataParts/0/text/content")
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string();
                            let thumbnail = val
                                .pointer("/contentImage/thumbnailViewModel/image/sources/0/url")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg"));
                            items.push(RelatedVideoItem {
                                id: vid.to_string(),
                                title,
                                channel,
                                thumbnail,
                                duration_text: None,
                                view_count_text: None,
                            });
                        }
                    }
                }
            }

            for child in map.values() {
                walk_related(child, current_video_id, items, seen);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_related(child, current_video_id, items, seen);
            }
        }
        _ => {}
    }
}

fn find_comment_continuation(val: &Value) -> Option<String> {
    match val {
        Value::Object(map) => {
            let sec_id = map.get("sectionIdentifier").and_then(|v| v.as_str());
            let target_id = map.get("targetId").and_then(|v| v.as_str());
            if sec_id == Some("comment-item-section") || target_id == Some("comments-section") {
                if let Some(tok) = val
                    .pointer("/contents/0/continuationItemRenderer/continuationEndpoint/continuationCommand/token")
                    .and_then(|v| v.as_str())
                {
                    return Some(tok.to_string());
                }
            }
            for child in map.values() {
                if let Some(found) = find_comment_continuation(child) {
                    return Some(found);
                }
            }
        }
        Value::Array(arr) => {
            for child in arr {
                if let Some(found) = find_comment_continuation(child) {
                    return Some(found);
                }
            }
        }
        _ => {}
    }
    None
}

fn walk_comments(
    val: &Value,
    comments: &mut Vec<VideoComment>,
    seen: &mut HashSet<String>,
    total_count: &mut i64,
    continuation_token: &mut Option<String>,
) {
    match val {
        Value::Object(map) => {
            if let Some(header) = map.get("commentsHeaderRenderer") {
                let count_txt = extract_runs_or_simple(header.get("countText"));
                let digits: String = count_txt.chars().filter(|c| c.is_ascii_digit()).collect();
                if let Ok(num) = digits.parse::<i64>() {
                    *total_count = num;
                }
            }

            if let Some(thread) = map.get("commentThreadRenderer") {
                let renderer = thread
                    .pointer("/comment/commentRenderer")
                    .or_else(|| thread.pointer("/commentViewModel/commentViewModel"));
                if let Some(r) = renderer {
                    if let Some(parsed) = parse_single_comment(r) {
                        if seen.insert(parsed.id.clone()) {
                            comments.push(parsed);
                        }
                    }
                }
            }

            if let Some(tok) = val
                .pointer("/continuationItemRenderer/continuationEndpoint/continuationCommand/token")
                .and_then(|v| v.as_str())
            {
                *continuation_token = Some(tok.to_string());
            }

            for child in map.values() {
                walk_comments(child, comments, seen, total_count, continuation_token);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_comments(child, comments, seen, total_count, continuation_token);
            }
        }
        _ => {}
    }
}

fn parse_single_comment(renderer: &Value) -> Option<VideoComment> {
    let id = renderer
        .get("commentId")
        .or_else(|| renderer.pointer("/properties/commentId"))
        .and_then(|v| v.as_str())?
        .to_string();

    let mut author = extract_runs_or_simple(renderer.get("authorText"));
    if author.is_empty() {
        author = renderer
            .pointer("/author/displayName")
            .and_then(|v| v.as_str())
            .unwrap_or("Người dùng ẩn danh")
            .to_string();
    }

    let author_avatar = renderer
        .pointer("/authorThumbnail/thumbnails/0/url")
        .or_else(|| renderer.pointer("/author/avatarThumbnailUrl"))
        .and_then(|v| v.as_str())
        .map(|s| {
            if s.starts_with("//") {
                format!("https:{s}")
            } else {
                s.to_string()
            }
        });

    let channel_id = renderer
        .pointer("/authorEndpoint/browseEndpoint/browseId")
        .or_else(|| renderer.pointer("/author/channelId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut text = extract_runs_or_simple(renderer.get("contentText"));
    if text.is_empty() {
        text = renderer
            .pointer("/properties/content/content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
    }

    let likes_str = renderer
        .pointer("/voteCount/simpleText")
        .or_else(|| renderer.pointer("/toolbar/likeCountNotliked"))
        .and_then(|v| v.as_str())
        .unwrap_or("0");
    let digits: String = likes_str.chars().filter(|c| c.is_ascii_digit()).collect();
    let likes = digits.parse::<i64>().unwrap_or(0);

    let published_text = {
        let pt = extract_runs_or_simple(renderer.get("publishedTimeText"));
        if !pt.is_empty() {
            Some(pt)
        } else {
            renderer
                .pointer("/properties/publishedTime")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        }
    };

    let pinned = renderer.get("pinnedTextList").is_some()
        || renderer.pointer("/properties/pinnedText").is_some();

    let reply_count = renderer
        .get("replyCount")
        .or_else(|| renderer.pointer("/toolbar/replyCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Some(VideoComment {
        id,
        author,
        author_avatar,
        channel_id,
        text,
        likes,
        published_text,
        pinned,
        reply_count,
    })
}

fn collect_tv_subscribed_shorts(
    val: &Value,
    list: &mut Vec<ShortVideoItem>,
    seen: &mut HashSet<String>,
) {
    match val {
        Value::Object(map) => {
            if let Some(tabs) = map.get("tabs").and_then(|t| t.as_array()) {
                let selected_tab = tabs
                    .iter()
                    .find(|t| {
                        t.pointer("/tabRenderer/selected").and_then(|v| v.as_bool()) == Some(true)
                    })
                    .or_else(|| tabs.first());
                if let Some(tab) = selected_tab {
                    collect_tv_subscribed_shorts(tab, list, seen);
                }
                return;
            }
            if let Some(tile) = map.get("tileRenderer") {
                let is_reel_cmd = tile.pointer("/onSelectCommand/reelWatchEndpoint/videoId").is_some();
                let is_shorts_style =
                    tile.get("style").and_then(|v| v.as_str()) == Some("TILE_STYLE_YTLR_SHORTS");
                if is_reel_cmd || is_shorts_style {
                    if let Some(parsed) = parse_tile_renderer(tile) {
                        if seen.insert(parsed.id.clone()) {
                            list.push(ShortVideoItem {
                                id: parsed.id.clone(),
                                title: parsed.title,
                                channel: parsed.channel,
                                channel_id: parsed.channel_id,
                                channel_avatar: None,
                                thumbnail: format!("https://i.ytimg.com/vi/{}/oar2.jpg", parsed.id),
                                like_count_text: None,
                                comment_count_text: None,
                                view_count_text: if parsed.view_count_text.is_empty() {
                                    None
                                } else {
                                    Some(parsed.view_count_text)
                                },
                                published_text: parsed.published_text,
                                params: None,
                            });
                        }
                    }
                }
                return;
            }
            for child in map.values() {
                collect_tv_subscribed_shorts(child, list, seen);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_tv_subscribed_shorts(child, list, seen);
            }
        }
        _ => {}
    }
}

fn parse_short_prefetch_player(pr: &Value, item: &mut ShortVideoItem) {
    if let Some(vd) = pr.get("videoDetails") {
        if item.title.is_empty() {
            if let Some(t) = vd.get("title").and_then(|v| v.as_str()) {
                item.title = t.to_string();
            }
        }
        if item.channel.is_empty() {
            if let Some(ch) = vd.get("author").and_then(|v| v.as_str()) {
                item.channel = ch.to_string();
            }
        }
        if item.channel_id.is_none() {
            item.channel_id = vd
                .get("channelId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
        if item.view_count_text.is_none() {
            item.view_count_text = vd
                .get("viewCount")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }
    if item.like_count_text.is_none() {
        item.like_count_text = pr
            .pointer("/microformat/playerMicroformatRenderer/likeCount")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
}

pub fn parse_reel_overlay_metadata(resp: &Value, item: &mut ShortVideoItem) {
    let ov = resp
        .pointer("/overlay/reelPlayerOverlayRenderer")
        .unwrap_or(resp);

    // Modern ViewModel format (YouTube 2025+)
    if let Some(meta_items) = ov
        .pointer("/playerOverlay/reelPlayerOverlayViewModel/metapanel/reelMetapanelViewModel/metadataItems")
        .and_then(|v| v.as_array())
    {
        for m in meta_items {
            if let Some(ch_bar) = m.get("reelChannelBarViewModel") {
                if let Some(ch_name) = ch_bar.pointer("/channelName/content").and_then(|v| v.as_str())
                {
                    if !ch_name.trim().is_empty() {
                        item.channel = ch_name.trim().to_string();
                    }
                }
                if item.channel_id.is_none() {
                    item.channel_id = ch_bar
                        .pointer("/channelName/commandRuns/0/onTap/innertubeCommand/browseEndpoint/browseId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if item.channel_avatar.is_none() {
                    let av = ch_bar
                        .pointer("/decoratedAvatarViewModel/decoratedAvatarViewModel/avatar/avatarViewModel/image/sources")
                        .or_else(|| ch_bar.pointer("/decoratedAvatarViewModel/avatar/avatarViewModel/image/sources"))
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|s| s.get("url"))
                        .and_then(|u| u.as_str())
                        .map(normalize_thumb_url);
                    item.channel_avatar = av;
                }
            }

            if let Some(title_vm) = m.get("shortsVideoTitleViewModel") {
                if let Some(t) = title_vm.pointer("/text/content").and_then(|v| v.as_str()) {
                    if !t.trim().is_empty() {
                        item.title = t.trim().to_string();
                    }
                }
            }
        }
    }

    if let Some(buttons) = ov
        .pointer("/playerOverlay/reelPlayerOverlayViewModel/actionBar/reelActionBarViewModel/buttonViewModels")
        .and_then(|v| v.as_array())
    {
        for btn in buttons {
            if let Some(like_btn) = btn
                .pointer("/likeButtonViewModel/toggleButtonViewModel/toggleButtonViewModel/defaultButtonViewModel/buttonViewModel/title")
                .or_else(|| btn.pointer("/likeButtonViewModel/toggleButtonViewModel/defaultButtonViewModel/buttonViewModel/title"))
                .and_then(|v| v.as_str())
            {
                if !like_btn.trim().is_empty() {
                    item.like_count_text = Some(like_btn.trim().to_string());
                }
            }
            if let Some(bvm) = btn.get("buttonViewModel") {
                let icon = bvm.get("iconName").and_then(|v| v.as_str()).unwrap_or("");
                if icon.contains("COMMENT") {
                    if let Some(cnt) = bvm.get("title").and_then(|v| v.as_str()) {
                        if !cnt.trim().is_empty() {
                            item.comment_count_text = Some(cnt.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    // Legacy reelPlayerHeaderRenderer format
    if let Some(hdr) = ov.pointer("/reelPlayerHeaderSupportedRenderers/reelPlayerHeaderRenderer") {
        if item.title.is_empty() {
            let t = extract_runs_or_simple(hdr.get("reelTitleText"));
            if !t.is_empty() {
                item.title = t;
            } else if let Some(acc) = hdr
                .pointer("/accessibility/accessibilityData/label")
                .and_then(|v| v.as_str())
            {
                if !acc.trim().is_empty() {
                    item.title = acc.trim().to_string();
                }
            }
        }
        if item.channel.is_empty() {
            let ch = extract_runs_or_simple(hdr.get("channelTitleText"));
            if !ch.is_empty() {
                item.channel = ch;
            }
        }
        if item.channel_id.is_none() {
            item.channel_id = hdr
                .pointer("/channelNavigationEndpoint/browseEndpoint/browseId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
        if item.channel_avatar.is_none() {
            item.channel_avatar = hdr
                .pointer("/channelThumbnail/thumbnails")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.last())
                .and_then(|t| t.get("url"))
                .and_then(|v| v.as_str())
                .map(normalize_thumb_url);
        }
        if item.published_text.is_none() {
            let ts = extract_runs_or_simple(hdr.get("timestampText"));
            if !ts.is_empty() {
                item.published_text = Some(ts);
            }
        }
    }
}

pub fn upgrade_music_thumb(raw: &str, size_px: u32) -> String {
    let mut url = normalize_thumb_url(raw);
    if let Some(pos) = url.find("=w") {
        let rest = &url[pos + 2..];
        let w_digits = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
        if w_digits > 0 && rest[w_digits..].starts_with("-h") {
            let after_h = &rest[w_digits + 2..];
            let h_digits = after_h.bytes().take_while(|b| b.is_ascii_digit()).count();
            if h_digits > 0 {
                let end = pos + 2 + w_digits + 2 + h_digits;
                let suffix = &url[end..];
                url = format!("{}=w{}-h{}{}", &url[..pos], size_px, size_px, suffix);
                return url;
            }
        }
    }
    url
}

fn extract_music_thumb(renderer: &Value) -> Option<String> {
    let url = renderer
        .pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .or_else(|| renderer.pointer("/thumbnailRenderer/musicThumbnailRenderer/thumbnail/thumbnails"))
        .or_else(|| renderer.pointer("/thumbnail/thumbnails"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|v| v.as_str())?;
    if url.is_empty() {
        None
    } else {
        Some(upgrade_music_thumb(url, 544))
    }
}

fn extract_watch_endpoint(val: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(v) = val else {
        return (None, None);
    };
    let watch = v
        .get("watchEndpoint")
        .or_else(|| v.pointer("/navigationEndpoint/watchEndpoint"))
        .or_else(|| v.pointer("/watchPlaylistEndpoint"));
    let vid = watch
        .and_then(|w| w.get("videoId"))
        .and_then(|s| s.as_str())
        .filter(|s| is_valid_video_id(s))
        .map(|s| s.to_string());
    let pid = watch
        .and_then(|w| w.get("playlistId"))
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    (vid, pid)
}

fn extract_trailing_duration(subtitle: &str) -> String {
    for token in subtitle.split('•').rev() {
        let trimmed = token.trim();
        if !trimmed.is_empty()
            && trimmed.contains(':')
            && trimmed.chars().all(|c| c.is_ascii_digit() || c == ':')
        {
            return trimmed.to_string();
        }
    }
    String::new()
}

pub fn parse_music_responsive_item(r: &Value) -> Option<MusicTrackItem> {
    let mut video_id = r
        .pointer("/playlistItemData/videoId")
        .and_then(|v| v.as_str())
        .filter(|s| is_valid_video_id(s))
        .map(|s| s.to_string());
    let mut playlist_id: Option<String> = None;

    if video_id.is_none() {
        let (v, p) = extract_watch_endpoint(r.pointer(
            "/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint",
        ));
        if v.is_some() {
            video_id = v;
            playlist_id = p;
        }
    }

    let mut title = String::new();
    let mut subtitle_parts: Vec<String> = Vec::new();
    let mut album: Option<String> = None;

    if let Some(cols) = r.get("flexColumns").and_then(|v| v.as_array()) {
        for (idx, col) in cols.iter().enumerate() {
            let text_obj = col.pointer("/musicResponsiveListItemFlexColumnRenderer/text");
            let val = extract_runs_or_simple(text_obj).trim().to_string();
            if val.is_empty() {
                continue;
            }
            if idx == 0 {
                title = val;
                if let Some(runs) = text_obj.and_then(|t| t.get("runs")).and_then(|a| a.as_array()) {
                    if let Some(first_run) = runs.first() {
                        let (v, p) = extract_watch_endpoint(first_run.get("navigationEndpoint"));
                        if video_id.is_none() {
                            video_id = v;
                        }
                        if playlist_id.is_none() {
                            playlist_id = p;
                        }
                    }
                }
            } else {
                if let Some(runs) = text_obj.and_then(|t| t.get("runs")).and_then(|a| a.as_array()) {
                    for run in runs {
                        let page_type = run
                            .pointer("/navigationEndpoint/browseEndpoint/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if page_type.contains("ALBUM") && album.is_none() {
                            if let Some(txt) = run.get("text").and_then(|v| v.as_str()) {
                                album = Some(txt.trim().to_string());
                            }
                        }
                    }
                }
                subtitle_parts.push(val);
            }
        }
    }

    if video_id.is_none() {
        let (v, p) = extract_watch_endpoint(r.get("navigationEndpoint"));
        video_id = v;
        if playlist_id.is_none() {
            playlist_id = p;
        }
    }

    let vid = video_id?;
    if title.is_empty() {
        return None;
    }

    let mut duration_text = r
        .pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text")
        .map(|t| extract_runs_or_simple(Some(t)))
        .unwrap_or_default()
        .trim()
        .to_string();

    let combined_subtitle = subtitle_parts.join(" • ");
    if duration_text.is_empty() {
        duration_text = extract_trailing_duration(&combined_subtitle);
    }
    let duration_sec = parse_duration_to_sec(&duration_text);

    let explicit = r
        .get("badges")
        .and_then(|b| b.as_array())
        .map(|arr| {
            arr.iter().any(|badge| {
                badge.pointer("/musicInlineBadgeRenderer/icon/iconType").and_then(|v| v.as_str())
                    == Some("MUSIC_EXPLICIT_BADGE")
            })
        })
        .unwrap_or(false);

    let thumbnail =
        extract_thumb_or_fallback(extract_music_thumb(r), &vid);

    let artist = if combined_subtitle.is_empty() {
        "YouTube Music".to_string()
    } else {
        combined_subtitle
    };

    Some(MusicTrackItem {
        id: vid,
        title,
        artist,
        album,
        duration_text,
        duration_sec,
        thumbnail,
        playlist_id,
        explicit,
    })
}

fn extract_thumb_or_fallback(found: Option<String>, video_id: &str) -> String {
    found.unwrap_or_else(|| format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"))
}

fn parse_music_two_row_item(r: &Value) -> Option<MusicTrackItem> {
    let (v1, p1) = extract_watch_endpoint(r.get("navigationEndpoint"));
    let (v2, p2) = extract_watch_endpoint(
        r.pointer("/thumbnailOverlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint"),
    );
    let vid = v1.or(v2)?;
    let playlist_id = p1.or(p2);
    let title = extract_runs_or_simple(r.get("title")).trim().to_string();
    if title.is_empty() {
        return None;
    }
    let artist = extract_runs_or_simple(r.get("subtitle")).trim().to_string();
    let duration_text = extract_trailing_duration(&artist);
    let duration_sec = parse_duration_to_sec(&duration_text);
    let thumbnail = extract_thumb_or_fallback(extract_music_thumb(r), &vid);

    Some(MusicTrackItem {
        id: vid,
        title,
        artist: if artist.is_empty() {
            "YouTube Music".to_string()
        } else {
            artist
        },
        album: None,
        duration_text,
        duration_sec,
        thumbnail,
        playlist_id,
        explicit: false,
    })
}

fn parse_music_panel_renderer(
    renderer: &Value,
    override_video_id: Option<&str>,
) -> Option<MusicTrackItem> {
    let vid = override_video_id
        .map(|s| s.to_string())
        .or_else(|| {
            renderer
                .get("videoId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })?;
    if !is_valid_video_id(&vid) {
        return None;
    }
    let title = extract_runs_or_simple(renderer.get("title"))
        .trim()
        .to_string();
    if title.is_empty() {
        return None;
    }
    let artist = extract_runs_or_simple(renderer.get("longBylineText"))
        .trim()
        .to_string();
    let duration_text = extract_runs_or_simple(renderer.get("lengthText"))
        .trim()
        .to_string();
    let duration_sec = parse_duration_to_sec(&duration_text);
    let thumbnail = extract_thumb_or_fallback(
        renderer
            .pointer("/thumbnail/thumbnails")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|s| s.as_str())
            .map(|u| upgrade_music_thumb(u, 544)),
        &vid,
    );
    let playlist_id = renderer
        .pointer("/navigationEndpoint/watchEndpoint/playlistId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(MusicTrackItem {
        id: vid,
        title,
        artist: if artist.is_empty() {
            "YouTube Music".to_string()
        } else {
            artist
        },
        album: None,
        duration_text,
        duration_sec,
        thumbnail,
        playlist_id,
        explicit: false,
    })
}

fn walk_music_tracks(val: &Value, tracks: &mut Vec<MusicTrackItem>, seen: &mut HashSet<String>) {
    match val {
        Value::Object(map) => {
            if let Some(r) = map.get("musicResponsiveListItemRenderer") {
                if let Some(item) = parse_music_responsive_item(r) {
                    if seen.insert(item.id.clone()) {
                        tracks.push(item);
                    }
                }
                return;
            }
            if let Some(r) = map.get("musicTwoRowItemRenderer") {
                if let Some(item) = parse_music_two_row_item(r) {
                    if seen.insert(item.id.clone()) {
                        tracks.push(item);
                    }
                }
                return;
            }
            if let Some(card) = map.get("musicCardShelfRenderer") {
                let (vid, playlist_id) = extract_watch_endpoint(card.get("onTap"));
                if let Some(id) = vid {
                    let title = extract_runs_or_simple(card.get("title")).trim().to_string();
                    let artist = extract_runs_or_simple(card.get("subtitle")).trim().to_string();
                    if !title.is_empty() && seen.insert(id.clone()) {
                        let duration_text = extract_trailing_duration(&artist);
                        let duration_sec = parse_duration_to_sec(&duration_text);
                        tracks.push(MusicTrackItem {
                            id: id.clone(),
                            title,
                            artist: if artist.is_empty() {
                                "YouTube Music".to_string()
                            } else {
                                artist
                            },
                            album: None,
                            duration_text,
                            duration_sec,
                            thumbnail: extract_thumb_or_fallback(extract_music_thumb(card), &id),
                            playlist_id,
                            explicit: false,
                        });
                    }
                }
                if let Some(contents) = card.get("contents") {
                    walk_music_tracks(contents, tracks, seen);
                }
                return;
            }
            for (k, child) in map {
                if !k.ends_with("HeaderRenderer") && k != "header" {
                    walk_music_tracks(child, tracks, seen);
                }
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_music_tracks(child, tracks, seen);
            }
        }
        _ => {}
    }
}

fn walk_music_shelves(val: &Value, shelves: &mut Vec<MusicShelf>) {
    match val {
        Value::Object(map) => {
            for key in [
                "musicCarouselShelfRenderer",
                "musicImmersiveCarouselShelfRenderer",
            ] {
                if let Some(carousel) = map.get(key) {
                    let hdr = carousel
                        .pointer("/header/musicCarouselShelfBasicHeaderRenderer")
                        .or_else(|| {
                            carousel.pointer("/header/musicImmersiveCarouselShelfBasicHeaderRenderer")
                        });
                    let title = extract_runs_or_simple(hdr.and_then(|h| h.get("title")))
                        .trim()
                        .to_string();
                    let mut items = Vec::new();
                    let mut seen = HashSet::new();
                    if let Some(contents) = carousel.get("contents") {
                        walk_music_tracks(contents, &mut items, &mut seen);
                    }
                    if !items.is_empty() {
                        shelves.push(MusicShelf {
                            title: if title.is_empty() {
                                "Đề xuất cho bạn".to_string()
                            } else {
                                title
                            },
                            items,
                        });
                    }
                    return;
                }
            }

            for key in ["musicShelfRenderer", "musicPlaylistShelfRenderer"] {
                if let Some(shelf) = map.get(key) {
                    let title = extract_runs_or_simple(shelf.get("title"))
                        .trim()
                        .to_string();
                    let mut items = Vec::new();
                    let mut seen = HashSet::new();
                    if let Some(contents) = shelf.get("contents") {
                        walk_music_tracks(contents, &mut items, &mut seen);
                    }
                    if !items.is_empty() {
                        shelves.push(MusicShelf {
                            title: if title.is_empty() {
                                "Danh sách nhạc".to_string()
                            } else {
                                title
                            },
                            items,
                        });
                    }
                    return;
                }
            }

            for (k, child) in map {
                if !k.ends_with("HeaderRenderer") && k != "header" {
                    walk_music_shelves(child, shelves);
                }
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_music_shelves(child, shelves);
            }
        }
        _ => {}
    }
}

fn walk_music_panel_tracks(
    val: &Value,
    tracks: &mut Vec<MusicTrackItem>,
    seen: &mut HashSet<String>,
) {
    match val {
        Value::Object(map) => {
            if let Some(panel) = map.get("playlistPanelVideoRenderer") {
                if let Some(item) = parse_music_panel_renderer(panel, None) {
                    if seen.insert(item.id.clone()) {
                        tracks.push(item);
                    }
                }
                return;
            }
            if let Some(wrapper) = map.get("playlistPanelVideoWrapperRenderer") {
                if let Some(primary) = wrapper.pointer("/primaryRenderer/playlistPanelVideoRenderer")
                {
                    if let Some(item) = parse_music_panel_renderer(primary, None) {
                        if seen.insert(item.id.clone()) {
                            tracks.push(item);
                        }
                    }
                }
                return;
            }
            for child in map.values() {
                walk_music_panel_tracks(child, tracks, seen);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                walk_music_panel_tracks(child, tracks, seen);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrade_music_thumb_resizes_google_cover_art() {
        let small = "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj";
        assert_eq!(
            upgrade_music_thumb(small, 544),
            "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj"
        );
    }

    #[test]
    fn parse_reel_overlay_extracts_modern_viewmodel() {
        let payload = json!({
            "overlay": {
                "reelPlayerOverlayRenderer": {
                    "playerOverlay": {
                        "reelPlayerOverlayViewModel": {
                            "metapanel": {
                                "reelMetapanelViewModel": {
                                    "metadataItems": [
                                        {
                                            "reelChannelBarViewModel": {
                                                "channelName": { "content": "@Vuimoi-ngay" },
                                                "decoratedAvatarViewModel": {
                                                    "decoratedAvatarViewModel": {
                                                        "avatar": {
                                                            "avatarViewModel": {
                                                                "image": {
                                                                    "sources": [{ "url": "https://yt3.ggpht.com/av.jpg" }]
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            "shortsVideoTitleViewModel": {
                                                "text": { "content": "Video Shorts Mau" }
                                            }
                                        }
                                    ]
                                }
                            },
                            "actionBar": {
                                "reelActionBarViewModel": {
                                    "buttonViewModels": [
                                        {
                                            "likeButtonViewModel": {
                                                "toggleButtonViewModel": {
                                                    "toggleButtonViewModel": {
                                                        "defaultButtonViewModel": {
                                                            "buttonViewModel": { "title": "12 N" }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            "buttonViewModel": {
                                                "iconName": "SHORTS_COMMENT",
                                                "title": "621"
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        });

        let mut item = ShortVideoItem {
            id: "dQw4w9WgXcQ".to_string(),
            title: String::new(),
            channel: String::new(),
            channel_id: None,
            channel_avatar: None,
            thumbnail: String::new(),
            like_count_text: None,
            comment_count_text: None,
            view_count_text: None,
            published_text: None,
            params: None,
        };
        parse_reel_overlay_metadata(&payload, &mut item);
        assert_eq!(item.title, "Video Shorts Mau");
        assert_eq!(item.channel, "@Vuimoi-ngay");
        assert_eq!(item.like_count_text.as_deref(), Some("12 N"));
        assert_eq!(item.comment_count_text.as_deref(), Some("621"));
        assert_eq!(
            item.channel_avatar.as_deref(),
            Some("https://yt3.ggpht.com/av.jpg")
        );
    }

    #[test]
    fn parse_music_responsive_item_extracts_song_fields() {
        let sample = json!({
            "playlistItemData": { "videoId": "qHpE45b4INk" },
            "thumbnail": {
                "musicThumbnailRenderer": {
                    "thumbnail": {
                        "thumbnails": [
                            { "url": "https://lh3.googleusercontent.com/cover=w60-h60-l90-rj" }
                        ]
                    }
                }
            },
            "flexColumns": [
                {
                    "musicResponsiveListItemFlexColumnRenderer": {
                        "text": { "runs": [{ "text": "Chung Ta Cua Tuong Lai" }] }
                    }
                },
                {
                    "musicResponsiveListItemFlexColumnRenderer": {
                        "text": { "runs": [{ "text": "Son Tung M-TP" }] }
                    }
                }
            ],
            "fixedColumns": [
                {
                    "musicResponsiveListItemFixedColumnRenderer": {
                        "text": { "runs": [{ "text": "4:09" }] }
                    }
                }
            ],
            "badges": [
                { "musicInlineBadgeRenderer": { "icon": { "iconType": "MUSIC_EXPLICIT_BADGE" } } }
            ]
        });

        let parsed = parse_music_responsive_item(&sample).expect("should parse music track");
        assert_eq!(parsed.id, "qHpE45b4INk");
        assert_eq!(parsed.title, "Chung Ta Cua Tuong Lai");
        assert_eq!(parsed.artist, "Son Tung M-TP");
        assert_eq!(parsed.duration_text, "4:09");
        assert_eq!(parsed.duration_sec, 249);
        assert!(parsed.explicit);
        assert_eq!(
            parsed.thumbnail,
            "https://lh3.googleusercontent.com/cover=w544-h544-l90-rj"
        );
    }

    #[test]
    fn resolve_client_user_agent_matches_visionos_and_web_remix() {
        let (vis_name, vis_ua) = resolve_client_user_agent(Some("VISIONOS"), Some("IOS"));
        assert_eq!(vis_name, "VISIONOS");
        assert_eq!(vis_ua, CLIENT_VISIONOS.user_agent);

        let (remix_name, remix_ua) = resolve_client_user_agent(None, Some("WEB_REMIX"));
        assert_eq!(remix_name, MUSIC_CLIENT_NAME);
        assert_eq!(remix_ua, MUSIC_USER_AGENT);
    }

    #[test]
    fn select_best_audio_prefers_140_then_251_by_bitrate() {
        let make_fmt = |itag: i64, mime: &str, container: &str, codec: &str, bitrate: i64| AudioStreamFormat {
            itag,
            url: format!("https://rr1.googlevideo.com/videoplayback?itag={itag}"),
            mime_type: mime.to_string(),
            container: container.to_string(),
            codec: codec.to_string(),
            bitrate,
            average_bitrate: Some(bitrate),
            audio_sample_rate: Some("44100".to_string()),
            audio_channels: Some(2),
            content_length: Some(1_000_000),
            approx_duration_ms: Some(180_000),
            init_range: None,
            index_range: None,
            is_original: Some(true),
            language: None,
        };

        let f250 = make_fmt(250, "audio/webm; codecs=\"opus\"", "webm", "opus", 80_000);
        let f251 = make_fmt(251, "audio/webm; codecs=\"opus\"", "webm", "opus", 160_000);
        let f140 = make_fmt(140, "audio/mp4; codecs=\"mp4a.40.2\"", "m4a", "mp4a.40.2", 130_000);

        let chosen_with_140 = select_best_audio(&[f250.clone(), f251.clone(), f140.clone()]).unwrap();
        assert_eq!(chosen_with_140.itag, 140);

        let chosen_without_140 = select_best_audio(&[f250, f251]).unwrap();
        assert_eq!(chosen_without_140.itag, 251);
    }

    #[test]
    fn is_playable_rejects_sabr_only_formats_without_urls() {
        let sabr_only = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "adaptiveFormats": [
                    { "itag": 140, "mimeType": "audio/mp4" },
                    { "itag": 137, "mimeType": "video/mp4" }
                ]
            }
        });
        assert!(!YouTubeService::is_playable(&sabr_only));

        let playable = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "adaptiveFormats": [
                    { "itag": 140, "mimeType": "audio/mp4", "url": "https://rr1.googlevideo.com/videoplayback?itag=140" }
                ]
            }
        });
        assert!(YouTubeService::is_playable(&playable));
    }

    #[test]
    fn is_playable_for_mode_separates_video_and_audio_requirements() {
        let audio_only_resp = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "adaptiveFormats": [
                    { "itag": 140, "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"", "url": "https://rr1.googlevideo.com/videoplayback?itag=140" }
                ]
            }
        });
        assert!(YouTubeService::is_playable_for_mode(
            &audio_only_resp,
            StreamExtractMode::Audio
        ));
        assert!(!YouTubeService::is_playable_for_mode(
            &audio_only_resp,
            StreamExtractMode::Video
        ));

        let video_only_resp = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "adaptiveFormats": [
                    { "itag": 137, "mimeType": "video/mp4; codecs=\"avc1.640028\"", "url": "https://rr1.googlevideo.com/videoplayback?itag=137" }
                ]
            }
        });
        assert!(YouTubeService::is_playable_for_mode(
            &video_only_resp,
            StreamExtractMode::Video
        ));
        assert!(!YouTubeService::is_playable_for_mode(
            &video_only_resp,
            StreamExtractMode::Audio
        ));

        let hls_resp = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "hlsManifestUrl": "https://manifest.googlevideo.com/api/manifest/hls_variant/index.m3u8"
            }
        });
        assert!(YouTubeService::is_playable_for_mode(
            &hls_resp,
            StreamExtractMode::Video
        ));
    }
}
