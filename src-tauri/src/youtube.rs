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
}

pub const CLIENT_ANDROID_VR: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "ANDROID_VR",
    id: "28",
    version: "1.60.19",
    user_agent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    os_name: "Android",
    os_version: "12L",
    device_make: "Oculus",
    device_model: "Quest 3",
    platform: "MOBILE",
    client_screen: "WATCH",
};

pub const CLIENT_ANDROID: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "ANDROID",
    id: "3",
    version: "20.10.38",
    user_agent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    os_name: "Android",
    os_version: "14",
    device_make: "Google",
    device_model: "Pixel 8",
    platform: "MOBILE",
    client_screen: "WATCH",
};

pub const CLIENT_IOS: InnerTubeClientConfig = InnerTubeClientConfig {
    name: "IOS",
    id: "5",
    version: "21.10.3",
    user_agent: "com.google.ios.youtube/21.10.3 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
    os_name: "iPhone",
    os_version: "18.1.0.22B83",
    device_make: "Apple",
    device_model: "iPhone16,2",
    platform: "MOBILE",
    client_screen: "WATCH",
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
        .unwrap_or("ANDROID_VR")
        .to_uppercase();

    match raw.as_str() {
        "ANDROID_VR" => (CLIENT_ANDROID_VR.name, CLIENT_ANDROID_VR.user_agent),
        "ANDROID" => (CLIENT_ANDROID.name, CLIENT_ANDROID.user_agent),
        "IOS" | "IOS_HDR" => (CLIENT_IOS.name, CLIENT_IOS.user_agent),
        "TVHTML5_SIMPLY_EMBEDDED_PLAYER" => (
            CLIENT_TVHTML5_SIMPLY_EMBED.name,
            CLIENT_TVHTML5_SIMPLY_EMBED.user_agent,
        ),
        "TVHTML5" => (CLIENT_TVHTML5.name, CLIENT_TVHTML5.user_agent),
        "WEB_EMBEDDED_PLAYER" => (CLIENT_WEB_EMBED.name, CLIENT_WEB_EMBED.user_agent),
        "WEB" => (CLIENT_WEB.name, CLIENT_WEB.user_agent),
        _ if raw.contains("IOS") => (CLIENT_IOS.name, CLIENT_IOS.user_agent),
        _ if raw.contains("VR") => (CLIENT_ANDROID_VR.name, CLIENT_ANDROID_VR.user_agent),
        _ if raw.contains("ANDROID") => (CLIENT_ANDROID.name, CLIENT_ANDROID.user_agent),
        _ if raw.contains("TVHTML5_SIMPLY") => (
            CLIENT_TVHTML5_SIMPLY_EMBED.name,
            CLIENT_TVHTML5_SIMPLY_EMBED.user_agent,
        ),
        _ if raw.contains("TV") => (CLIENT_TVHTML5.name, CLIENT_TVHTML5.user_agent),
        _ => (CLIENT_ANDROID_VR.name, CLIENT_ANDROID_VR.user_agent),
    }
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

#[derive(Debug, Clone, Default)]
pub struct IosStreamingData {
    pub hls_manifest_url: Option<String>,
    pub adaptive_formats: Vec<Value>,
    pub formats: Vec<Value>,
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

    fn is_playable(resp: &Value) -> bool {
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

        if streaming
            .get("hlsManifestUrl")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false)
        {
            return true;
        }

        let has_formats = streaming
            .get("formats")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);
        let has_adaptive = streaming
            .get("adaptiveFormats")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);

        has_formats || has_adaptive
    }

    pub async fn resolve_player(&self, video_id: &str) -> Result<Value, String> {
        if let Ok(cache) = self.player_cache.read() {
            if let Some((at, data)) = cache.get(video_id) {
                if at.elapsed() < CACHE_TTL_PLAYER {
                    return Ok(data.clone());
                }
            }
        }

        let fallback_clients = [
            &CLIENT_ANDROID_VR,
            &CLIENT_ANDROID,
            &CLIENT_IOS,
            &CLIENT_TVHTML5_SIMPLY_EMBED,
            &CLIENT_TVHTML5,
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
                if Self::is_playable(&resp) {
                    if let Ok(mut cache) = self.player_cache.write() {
                        cache.insert(video_id.to_string(), (Instant::now(), resp.clone()));
                    }
                    return Ok(resp);
                }
            }
        }

        Err(format!(
            "Could not retrieve playable streams for video {video_id} across all fallback clients."
        ))
    }

    pub async fn fetch_ios_streaming_data(&self, video_id: &str) -> IosStreamingData {
        if let Ok(cache) = self.ios_cache.read() {
            if let Some((at, data)) = cache.get(video_id) {
                if at.elapsed() < CACHE_TTL_PLAYER {
                    return data.clone();
                }
            }
        }

        let mut best = IosStreamingData::default();
        for client_cfg in [&CLIENT_IOS, &CLIENT_IOS_HDR] {
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
                        };
                        if let Ok(mut cache) = self.ios_cache.write() {
                            cache.insert(video_id.to_string(), (Instant::now(), best.clone()));
                        }
                        return best;
                    }

                    if best.adaptive_formats.is_empty() && !adaptive.is_empty() {
                        best.adaptive_formats = adaptive;
                        best.formats = formats;
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

    pub async fn resolve_fallback_stream_url(
        &self,
        video_id: &str,
        itag: Option<i64>,
        exclude_client: Option<&str>,
    ) -> Option<(String, &'static str, &'static str)> {
        let candidates = [
            &CLIENT_ANDROID,
            &CLIENT_ANDROID_VR,
            &CLIENT_IOS,
            &CLIENT_TVHTML5_SIMPLY_EMBED,
        ];

        for client_cfg in candidates {
            if let Some(excl) = exclude_client {
                if client_cfg.name.eq_ignore_ascii_case(excl) {
                    continue;
                }
            }

            let body = json!({
                "videoId": video_id,
                "contentCheckOk": true,
                "racyCheckOk": true
            });

            if let Ok(resp) = self.innertube_request("player", body, client_cfg).await {
                if !Self::is_playable(&resp) {
                    continue;
                }

                let mut all_fmts = Vec::new();
                if let Some(fmts) = resp
                    .get("streamingData")
                    .and_then(|sd| sd.get("formats"))
                    .and_then(|f| f.as_array())
                {
                    all_fmts.extend(fmts.iter());
                }
                if let Some(afmts) = resp
                    .get("streamingData")
                    .and_then(|sd| sd.get("adaptiveFormats"))
                    .and_then(|f| f.as_array())
                {
                    all_fmts.extend(afmts.iter());
                }

                let matched = if let Some(target_itag) = itag {
                    all_fmts
                        .iter()
                        .find(|f| {
                            f.get("itag").and_then(|v| v.as_i64()) == Some(target_itag)
                                && extract_format_url(f).is_some()
                        })
                        .or_else(|| all_fmts.iter().find(|f| extract_format_url(f).is_some()))
                } else {
                    all_fmts.iter().find(|f| extract_format_url(f).is_some())
                };

                if let Some(fmt) = matched {
                    if let Some(url) = extract_format_url(fmt) {
                        return Some((url, client_cfg.name, client_cfg.user_agent));
                    }
                }
            }
        }

        None
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
    ) -> Result<TayTubeVideoDetails, String> {
        let video_id = Self::extract_video_id(url_or_id)?;

        let (player_res, ios_data, sponsor_segments, related_videos) = tokio::join!(
            self.resolve_player(&video_id),
            self.fetch_ios_streaming_data(&video_id),
            self.fetch_sponsor_segments(&video_id),
            self.fetch_related_videos(&video_id),
        );

        let mut player_resp = player_res?;

        // Merge iOS adaptiveFormats & muxed formats cleanly without duplicates
        if let Some(sd) = player_resp.get_mut("streamingData").and_then(|v| v.as_object_mut()) {
            if !ios_data.adaptive_formats.is_empty() {
                let adaptive_entry = sd
                    .entry("adaptiveFormats".to_string())
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Some(arr) = adaptive_entry.as_array_mut() {
                    let existing: HashSet<i64> = arr
                        .iter()
                        .filter_map(|f| f.get("itag").and_then(|v| v.as_i64()))
                        .collect();
                    for fmt in &ios_data.adaptive_formats {
                        if let Some(itag) = fmt.get("itag").and_then(|v| v.as_i64()) {
                            if !existing.contains(&itag) {
                                arr.push(fmt.clone());
                            }
                        }
                    }
                }
            }

            if !ios_data.formats.is_empty() {
                let formats_entry = sd
                    .entry("formats".to_string())
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Some(arr) = formats_entry.as_array_mut() {
                    let existing: HashSet<i64> = arr
                        .iter()
                        .filter_map(|f| f.get("itag").and_then(|v| v.as_i64()))
                        .collect();
                    for fmt in &ios_data.formats {
                        if let Some(itag) = fmt.get("itag").and_then(|v| v.as_i64()) {
                            if !existing.contains(&itag) {
                                arr.push(fmt.clone());
                            }
                        }
                    }
                }
            }
        }

        let raw_hls_url = player_resp
            .get("streamingData")
            .and_then(|sd| sd.get("hlsManifestUrl"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| ios_data.hls_manifest_url.clone());

        let parsed = parse_stream_formats(player_resp.get("streamingData"));
        let target_h = target_quality.unwrap_or(1080);
        let pref_hdr = prefer_hdr.unwrap_or(false);
        let selected = select_quality(
            &parsed.video_only,
            &parsed.audio_only,
            &parsed.muxed,
            target_h,
            pref_hdr,
        );

        let caption_tracks = extract_caption_tracks(&player_resp);

        let chosen_video = selected.video.as_ref().or(selected.muxed.as_ref());
        let proxy_video_url = chosen_video.map(|v| {
            format!(
                "http://127.0.0.1:8989/stream?url={}&id={}&itag={}",
                urlencoding::encode(&v.url),
                urlencoding::encode(&video_id),
                v.itag
            )
        });

        let proxy_audio_url = selected.audio.as_ref().map(|a| {
            format!(
                "http://127.0.0.1:8989/stream?url={}&id={}&itag={}",
                urlencoding::encode(&a.url),
                urlencoding::encode(&video_id),
                a.itag
            )
        });

        let proxy_hls_url = raw_hls_url.as_ref().map(|hls| {
            format!(
                "http://127.0.0.1:8989/hls-manifest?url={}&id={}",
                urlencoding::encode(hls),
                urlencoding::encode(&video_id)
            )
        });

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

fn select_best_audio(candidates: &[AudioStreamFormat]) -> Option<AudioStreamFormat> {
    if candidates.is_empty() {
        return None;
    }

    let score = |fmt: &AudioStreamFormat| -> i32 {
        if fmt.itag == 140 {
            return 1000;
        }
        let mime = fmt.mime_type.to_lowercase();
        let codec = fmt.codec.to_lowercase();
        if fmt.container == "m4a" || mime.contains("audio/mp4") || codec.contains("mp4a") {
            return 500;
        }
        100
    };

    let mut sorted: Vec<&AudioStreamFormat> = candidates.iter().collect();
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
