use crate::db::{AppDatabase, AuthAccountProfile, StoredAuthAccount};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const TV_OAUTH_UA: &str = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)";
pub const TV_CLIENT_NAME: &str = "TVHTML5";
pub const TV_CLIENT_ID: &str = "7";
pub const TV_CLIENT_VERSION: &str = "7.20260707.07.00";
pub const TV_COBALT_BROWSER_VERSION: &str = "25.lts.30.1034943-gold";

const YOUTUBE_TV_URL: &str = "https://www.youtube.com/tv";
const DEVICE_CODE_URL: &str = "https://www.youtube.com/o/oauth2/device/code";
const TOKEN_URL: &str = "https://www.youtube.com/o/oauth2/token";
const ACCOUNTS_LIST_URL: &str = "https://www.youtube.com/youtubei/v1/account/accounts_list?prettyPrint=false";
const OAUTH_SCOPE: &str = "http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content";
const GRANT_TYPE_DEVICE: &str = "http://oauth.net/grant_type/device/1.0";
const GRANT_TYPE_REFRESH: &str = "refresh_token";
const MODEL_NAME: &str = "ytlr::";
const SOCS_COOKIE: &str = "SOCS=CAISEwgDEgk5NTA1MzE4OTQaAmVuIAEaBgiA7frSBg";
const DEFAULT_VERIFICATION_URL: &str = "https://www.google.com/device";

const META_KEY_CLIENT_ID: &str = "oauth_tv_client_id";
const META_KEY_CLIENT_SECRET: &str = "oauth_tv_client_secret";
const META_KEY_DEVICE_ID: &str = "oauth_device_id";
const CLIENT_CREDS_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_MARGIN_MS: i64 = 120_000;

static UUID_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthStartResult {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub interval_sec: u64,
    pub expires_in_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthPollResult {
    pub status: String,
    pub account: Option<AuthAccountProfile>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthHeaders {
    pub authorization: String,
    pub page_id: Option<String>,
    pub visitor_data: Option<String>,
}

pub struct AuthService {
    http: reqwest::Client,
    db: Arc<AppDatabase>,
    client_creds: RwLock<Option<(String, String, Instant)>>,
    visitor_data: RwLock<Option<String>>,
    refresh_lock: tokio::sync::Mutex<()>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn generate_uuid_v4() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let seq = UUID_SEQ.fetch_add(1, Ordering::Relaxed);

    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    hasher.update(seq.to_le_bytes());
    let mut b = hasher.finalize();

    // RFC 4122 version 4 & variant bits
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

pub fn read_env_override() -> Option<(String, String)> {
    let env_id = std::env::var("TAYTUBE_OAUTH_CLIENT_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let env_sec = std::env::var("TAYTUBE_OAUTH_CLIENT_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let (Some(id), Some(sec)) = (env_id, env_sec) {
        return Some((id, sec));
    }

    let dotenv_candidates = [
        std::path::PathBuf::from(".env"),
        std::path::PathBuf::from("..").join(".env"),
    ];

    for path in dotenv_candidates {
        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        let mut file_id: Option<String> = None;
        let mut file_sec: Option<String> = None;
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let Some((k, v)) = trimmed.split_once('=') else {
                continue;
            };
            let key = k.trim();
            let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if val.is_empty() {
                continue;
            }
            if key == "TAYTUBE_OAUTH_CLIENT_ID" {
                file_id = Some(val);
            } else if key == "TAYTUBE_OAUTH_CLIENT_SECRET" {
                file_sec = Some(val);
            }
        }
        if let (Some(id), Some(sec)) = (file_id, file_sec) {
            return Some((id, sec));
        }
    }

    None
}

fn tidy_youtube_url(raw: &str) -> String {
    let unescaped = raw.replace("\\/", "/").replace("\\u002F", "/");
    if unescaped.starts_with("http://") || unescaped.starts_with("https://") {
        unescaped
    } else if unescaped.starts_with("//") {
        format!("https:{unescaped}")
    } else if unescaped.starts_with('/') {
        format!("https://www.youtube.com{unescaped}")
    } else {
        format!("https://www.youtube.com/{unescaped}")
    }
}

fn extract_quoted_value(slice: &str, quote: char) -> Option<String> {
    let end = slice.find(quote)?;
    let val = &slice[..end];
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

pub fn extract_base_js_url(html: &str) -> Option<String> {
    // Pattern 1: id="base-js" src="..."
    if let Some(pos) = html.find("id=\"base-js\"") {
        let window = &html[pos..html.len().min(pos + 512)];
        if let Some(src_pos) = window.find("src=\"") {
            let rest = &window[src_pos + 5..];
            if let Some(url) = extract_quoted_value(rest, '"') {
                return Some(tidy_youtube_url(&url));
            }
        }
    }

    // Pattern 2: .src = '...m=base' (modern YouTube TV Cobalt shell)
    let mut offset = 0usize;
    while let Some(rel) = html[offset..].find(".src = '") {
        let start = offset + rel + 8;
        if let Some(end_rel) = html[start..].find('\'') {
            let candidate = &html[start..start + end_rel];
            let tail = &html[start + end_rel..html.len().min(start + end_rel + 48)];
            if candidate.contains("m=base") || tail.contains("base-js") {
                return Some(tidy_youtube_url(candidate));
            }
        }
        offset += rel + 8;
    }

    // Fallback pattern: .src = "..." referencing m=base
    offset = 0;
    while let Some(rel) = html[offset..].find(".src = \"") {
        let start = offset + rel + 8;
        if let Some(end_rel) = html[start..].find('"') {
            let candidate = &html[start..start + end_rel];
            if candidate.contains("m=base") {
                return Some(tidy_youtube_url(candidate));
            }
        }
        offset += rel + 8;
    }

    None
}

pub fn extract_visitor_data(html: &str) -> Option<String> {
    let marker = "\"visitorData\":\"";
    let pos = html.find(marker)?;
    let rest = &html[pos + marker.len()..];
    extract_quoted_value(rest, '"')
}

/// Extracts the first `clientId:"...apps.googleusercontent.com",<ident>:"<secret>"` pair
/// from YouTube TV's `m=base` bundle (same logic as MediaServiceCore's ClientData.java).
pub fn extract_tv_oauth_client(js: &str) -> Option<(String, String)> {
    let marker = "clientId:\"";
    let mut search_from = 0usize;

    while let Some(rel) = js[search_from..].find(marker) {
        let id_start = search_from + rel + marker.len();
        let Some(id_end_rel) = js[id_start..].find('"') else {
            break;
        };
        let client_id = &js[id_start..id_start + id_end_rel];
        search_from = id_start + id_end_rel + 1;

        if !client_id.ends_with(".apps.googleusercontent.com")
            || !client_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            continue;
        }

        // Next character must be ',' followed by optional whitespace/newlines, key identifier, and ':"<secret>"'
        let after_quote = &js[search_from..];
        let trimmed = after_quote.strip_prefix(',').unwrap_or("");
        if trimmed.is_empty() {
            continue;
        }
        let after_ws = trimmed.trim_start();
        let ident_len = after_ws
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || *b == b'$' || *b == b'_')
            .count();
        if ident_len == 0 {
            continue;
        }
        let rest_after_ident = &after_ws[ident_len..];
        let Some(after_colon_quote) = rest_after_ident.strip_prefix(":\"") else {
            continue;
        };
        let Some(sec_end) = after_colon_quote.find('"') else {
            continue;
        };
        let client_secret = &after_colon_quote[..sec_end];
        if !client_secret.is_empty()
            && client_secret
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Some((client_id.to_string(), client_secret.to_string()));
        }
    }

    None
}

fn extract_text_item(val: Option<&Value>) -> String {
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

#[derive(Debug, Clone)]
struct ParsedAccountItem {
    name: String,
    email: String,
    avatar: String,
    channel_handle: String,
    page_id: String,
    is_selected: bool,
    is_disabled: bool,
    has_channel: bool,
}

fn collect_account_items(val: &Value, out: &mut Vec<ParsedAccountItem>) {
    match val {
        Value::Object(map) => {
            if let Some(item) = map.get("accountItem") {
                let name = extract_text_item(item.get("accountName"));
                let email = extract_text_item(item.get("accountByline"));
                let channel_handle = extract_text_item(item.get("channelHandle"));
                let avatar = item
                    .pointer("/accountPhoto/thumbnails")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|u| u.as_str())
                    .map(|u| {
                        if u.starts_with("//") {
                            format!("https:{u}")
                        } else {
                            u.to_string()
                        }
                    })
                    .unwrap_or_default();

                let is_selected = item
                    .get("isSelected")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let is_disabled = item
                    .get("isDisabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let has_channel = item
                    .get("hasChannel")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let page_id = item
                    .pointer("/serviceEndpoint/selectActiveIdentityEndpoint/supportedTokens")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| {
                        arr.iter().find_map(|tok| {
                            tok.pointer("/pageIdToken/pageId")
                                .and_then(|p| p.as_str())
                                .map(|s| s.to_string())
                        })
                    })
                    .unwrap_or_default();

                if !name.is_empty() || !email.is_empty() {
                    out.push(ParsedAccountItem {
                        name: if name.is_empty() {
                            email.clone()
                        } else {
                            name
                        },
                        email,
                        avatar,
                        channel_handle,
                        page_id,
                        is_selected,
                        is_disabled,
                        has_channel,
                    });
                }
            }

            for child in map.values() {
                collect_account_items(child, out);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_account_items(child, out);
            }
        }
        _ => {}
    }
}

pub fn parse_accounts_list(json: &Value) -> Option<(String, String, String, String, String)> {
    let mut items = Vec::new();
    collect_account_items(json, &mut items);
    if items.is_empty() {
        return None;
    }

    let chosen = items
        .iter()
        .find(|i| i.is_selected && !i.is_disabled)
        .or_else(|| items.iter().find(|i| i.has_channel && !i.is_disabled))
        .or_else(|| items.iter().find(|i| !i.is_disabled))
        .unwrap_or(&items[0]);

    Some((
        chosen.name.clone(),
        chosen.email.clone(),
        chosen.avatar.clone(),
        chosen.channel_handle.clone(),
        chosen.page_id.clone(),
    ))
}

impl AuthService {
    pub fn new(db: Arc<AppDatabase>) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(12))
            .timeout(Duration::from_secs(20))
            .pool_max_idle_per_host(8)
            .tcp_keepalive(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to initialize OAuth HTTP client: {e}"))?;

        Ok(Self {
            http,
            db,
            client_creds: RwLock::new(None),
            visitor_data: RwLock::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn is_signed_in(&self) -> bool {
        self.db
            .get_auth_account()
            .ok()
            .flatten()
            .map(|a| !a.refresh_token.is_empty())
            .unwrap_or(false)
    }

    pub fn get_account_profile(&self) -> Result<Option<AuthAccountProfile>, String> {
        Ok(self.db.get_auth_account()?.as_ref().map(AuthAccountProfile::from))
    }

    pub fn get_visitor_data_cached(&self) -> Option<String> {
        self.visitor_data.read().ok().and_then(|g| g.clone())
    }

    pub fn sign_out(&self) -> Result<(), String> {
        self.db.clear_auth_account()
    }

    fn get_or_create_device_id(&self) -> String {
        if let Ok(Some((existing, _))) = self.db.get_meta(META_KEY_DEVICE_ID) {
            if !existing.trim().is_empty() {
                return existing;
            }
        }
        let fresh = generate_uuid_v4();
        let _ = self.db.set_meta(META_KEY_DEVICE_ID, &fresh);
        fresh
    }

    pub async fn get_oauth_client(&self, force_refresh: bool) -> Result<(String, String), String> {
        if let Some(env_pair) = read_env_override() {
            return Ok(env_pair);
        }

        if !force_refresh {
            if let Ok(guard) = self.client_creds.read() {
                if let Some((id, sec, fetched_at)) = guard.as_ref() {
                    if fetched_at.elapsed() < Duration::from_secs(12 * 3600) {
                        return Ok((id.clone(), sec.clone()));
                    }
                }
            }

            if let (Ok(Some((cid, ts1))), Ok(Some((csec, ts2)))) = (
                self.db.get_meta(META_KEY_CLIENT_ID),
                self.db.get_meta(META_KEY_CLIENT_SECRET),
            ) {
                let oldest = ts1.min(ts2);
                if !cid.is_empty()
                    && !csec.is_empty()
                    && now_ms().saturating_sub(oldest) < CLIENT_CREDS_TTL_MS
                {
                    if let Ok(mut guard) = self.client_creds.write() {
                        *guard = Some((cid.clone(), csec.clone(), Instant::now()));
                    }
                    return Ok((cid, csec));
                }
            }
        }

        let html = self
            .http
            .get(YOUTUBE_TV_URL)
            .header("User-Agent", TV_OAUTH_UA)
            .header("Cookie", SOCS_COOKIE)
            .send()
            .await
            .map_err(|e| format!("Không thể kết nối YouTube TV shell: {e}"))?
            .error_for_status()
            .map_err(|e| format!("YouTube TV trả về lỗi: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Không đọc được nội dung YouTube TV: {e}"))?;

        if let Some(vd) = extract_visitor_data(&html) {
            if let Ok(mut guard) = self.visitor_data.write() {
                *guard = Some(vd);
            }
        }

        let client_url = extract_base_js_url(&html)
            .ok_or_else(|| "Không tìm thấy script OAuth client trong trang YouTube TV".to_string())?;

        let js = match self.fetch_text(&client_url).await {
            Ok(body) => body,
            Err(_) => {
                let legacy_url = client_url
                    .replace("/dg=0/", "/exm=base/ed=1/")
                    .replace("/m=base", "/m=main");
                self.fetch_text(&legacy_url).await?
            }
        };

        let (client_id, client_secret) = extract_tv_oauth_client(&js)
            .ok_or_else(|| "Không trích xuất được thông số OAuth client từ YouTube TV".to_string())?;

        if let Ok(mut guard) = self.client_creds.write() {
            *guard = Some((client_id.clone(), client_secret.clone(), Instant::now()));
        }
        let _ = self.db.set_meta(META_KEY_CLIENT_ID, &client_id);
        let _ = self.db.set_meta(META_KEY_CLIENT_SECRET, &client_secret);

        Ok((client_id, client_secret))
    }

    async fn fetch_text(&self, url: &str) -> Result<String, String> {
        self.http
            .get(url)
            .header("User-Agent", TV_OAUTH_UA)
            .send()
            .await
            .map_err(|e| format!("Lỗi tải script OAuth: {e}"))?
            .error_for_status()
            .map_err(|e| format!("HTTP lỗi khi tải script OAuth: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Lỗi đọc script OAuth: {e}"))
    }

    pub async fn start_device_auth(&self) -> Result<DeviceAuthStartResult, String> {
        let device_id = self.get_or_create_device_id();

        for attempt in 0..2 {
            let (client_id, _) = self.get_oauth_client(attempt > 0).await?;
            let payload = json!({
                "client_id": client_id,
                "device_id": device_id,
                "model_name": MODEL_NAME,
                "scope": OAUTH_SCOPE,
            });

            let res = self
                .http
                .post(DEVICE_CODE_URL)
                .header("User-Agent", TV_OAUTH_UA)
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Không thể lấy mã thiết bị Google: {e}"))?;

            let status = res.status();
            let val: Value = res
                .json()
                .await
                .map_err(|e| format!("Phản hồi device_code không hợp lệ: {e}"))?;

            if status.is_success() {
                let device_code = val
                    .get("device_code")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let raw_user_code = val
                    .get("user_code")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if device_code.is_empty() || raw_user_code.is_empty() {
                    return Err("Google trả về thiếu device_code hoặc user_code".to_string());
                }

                let verification_url = val
                    .get("verification_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| DEFAULT_VERIFICATION_URL.to_string());
                let interval_sec = val
                    .get("interval")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(5)
                    .max(3);
                let expires_in_sec = val
                    .get("expires_in")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1800);

                return Ok(DeviceAuthStartResult {
                    device_code,
                    user_code: raw_user_code,
                    verification_url,
                    interval_sec,
                    expires_in_sec,
                });
            }

            let err_code = val.get("error").and_then(|v| v.as_str()).unwrap_or("");
            if err_code == "invalid_client" && attempt == 0 {
                continue;
            }
            let err_desc = val
                .get("error_description")
                .and_then(|v| v.as_str())
                .unwrap_or(err_code);
            return Err(format!("Google từ chối cấp mã xác thực: {err_desc}"));
        }

        Err("Không thể khởi tạo phiên đăng nhập Google".to_string())
    }

    pub async fn poll_device_auth(&self, device_code: &str) -> Result<DeviceAuthPollResult, String> {
        let (client_id, client_secret) = self.get_oauth_client(false).await?;
        let payload = json!({
            "code": device_code,
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": GRANT_TYPE_DEVICE,
        });

        let res = self
            .http
            .post(TOKEN_URL)
            .header("User-Agent", TV_OAUTH_UA)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Lỗi kiểm tra xác nhận Google: {e}"))?;

        let status = res.status();
        let val: Value = res
            .json()
            .await
            .map_err(|e| format!("Phản hồi token không hợp lệ: {e}"))?;

        if !status.is_success() || val.get("error").is_some() {
            let err_code = val
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown_error");
            let mapped_status = match err_code {
                "authorization_pending" => "pending",
                "slow_down" => "slow_down",
                "expired_token" => "expired",
                "access_denied" => "denied",
                _ => "error",
            };
            let msg = val
                .get("error_description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return Ok(DeviceAuthPollResult {
                status: mapped_status.to_string(),
                account: None,
                error: msg,
            });
        }

        let access_token = val
            .get("access_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let refresh_token = val
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let token_type = val
            .get("token_type")
            .and_then(|v| v.as_str())
            .unwrap_or("Bearer")
            .to_string();
        let expires_in = val
            .get("expires_in")
            .and_then(|v| v.as_i64())
            .unwrap_or(3600);

        if access_token.is_empty() || refresh_token.is_empty() {
            return Ok(DeviceAuthPollResult {
                status: "error".to_string(),
                account: None,
                error: Some("Thiếu access_token hoặc refresh_token từ Google".to_string()),
            });
        }

        let expires_at = now_ms() + expires_in * 1000;
        let (name, email, avatar, channel_handle, page_id) =
            self.fetch_account_profile(&access_token).await.unwrap_or_else(|| {
                (
                    "Tài khoản Google".to_string(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                )
            });

        let stored = StoredAuthAccount {
            access_token,
            refresh_token,
            token_type,
            expires_at,
            name,
            email,
            avatar,
            channel_handle,
            page_id,
            updated_at: now_ms(),
        };
        self.db.save_auth_account(&stored)?;

        Ok(DeviceAuthPollResult {
            status: "authorized".to_string(),
            account: Some(AuthAccountProfile::from(&stored)),
            error: None,
        })
    }

    async fn fetch_account_profile(
        &self,
        access_token: &str,
    ) -> Option<(String, String, String, String, String)> {
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
        if let Some(vd) = self.get_visitor_data_cached() {
            client_ctx["visitorData"] = Value::String(vd);
        }

        let body = json!({
            "context": {
                "client": client_ctx,
                "user": {
                    "enableSafetyMode": false,
                    "lockedSafetyMode": false
                }
            },
            "racyCheckOk": true,
            "contentCheckOk": true,
            "accountReadMask": {
                "returnOwner": true,
                "returnBrandAccounts": true,
                "returnPersonaAccounts": false
            }
        });

        let res = self
            .http
            .post(ACCOUNTS_LIST_URL)
            .header("User-Agent", TV_OAUTH_UA)
            .header("Content-Type", "application/json")
            .header("Referer", YOUTUBE_TV_URL)
            .header("Origin", "https://www.youtube.com")
            .header("X-YouTube-Client-Name", TV_CLIENT_ID)
            .header("X-YouTube-Client-Version", TV_CLIENT_VERSION)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(&body)
            .send()
            .await
            .ok()?;

        if !res.status().is_success() {
            return None;
        }
        let val: Value = res.json().await.ok()?;
        parse_accounts_list(&val)
    }

    async fn refresh_token_locked(&self) -> Result<StoredAuthAccount, String> {
        let current = self
            .db
            .get_auth_account()?
            .ok_or_else(|| "Chưa đăng nhập tài khoản Google".to_string())?;
        if current.refresh_token.is_empty() {
            return Err("Không tìm thấy refresh_token, vui lòng đăng nhập lại".to_string());
        }

        for attempt in 0..2 {
            let (client_id, client_secret) = self.get_oauth_client(attempt > 0).await?;
            let payload = json!({
                "refresh_token": current.refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": GRANT_TYPE_REFRESH,
            });

            let res = self
                .http
                .post(TOKEN_URL)
                .header("User-Agent", TV_OAUTH_UA)
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Không thể làm mới phiên đăng nhập Google: {e}"))?;

            let status = res.status();
            let val: Value = res
                .json()
                .await
                .map_err(|e| format!("Phản hồi làm mới token không hợp lệ: {e}"))?;

            if status.is_success() {
                let access_token = val
                    .get("access_token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if access_token.is_empty() {
                    return Err("Google trả về access_token rỗng khi làm mới".to_string());
                }
                let new_refresh = val
                    .get("refresh_token")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                let token_type = val
                    .get("token_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Bearer");
                let expires_in = val
                    .get("expires_in")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(3600);
                let expires_at = now_ms() + expires_in * 1000;

                self.db
                    .update_auth_tokens(&access_token, new_refresh, token_type, expires_at)?;

                return self
                    .db
                    .get_auth_account()?
                    .ok_or_else(|| "Không đọc lại được tài khoản sau khi làm mới".to_string());
            }

            let err_code = val.get("error").and_then(|v| v.as_str()).unwrap_or("");
            if err_code == "invalid_client" && attempt == 0 {
                continue;
            }
            if err_code == "invalid_grant" {
                let _ = self.db.clear_auth_account();
                return Err("Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi, vui lòng đăng nhập lại".to_string());
            }
            let err_desc = val
                .get("error_description")
                .and_then(|v| v.as_str())
                .unwrap_or(err_code);
            return Err(format!("Làm mới token thất bại: {err_desc}"));
        }

        Err("Không thể làm mới access_token".to_string())
    }

    pub async fn refresh_access_token(&self) -> Result<AuthAccountProfile, String> {
        let _guard = self.refresh_lock.lock().await;
        let updated = self.refresh_token_locked().await?;
        Ok(AuthAccountProfile::from(&updated))
    }

    pub async fn get_valid_auth_headers(&self) -> Result<Option<AuthHeaders>, String> {
        let Some(acc) = self.db.get_auth_account()? else {
            return Ok(None);
        };

        let acc = if acc.access_token.is_empty()
            || now_ms() >= acc.expires_at.saturating_sub(ACCESS_TOKEN_REFRESH_MARGIN_MS)
        {
            let _guard = self.refresh_lock.lock().await;
            let recheck = self
                .db
                .get_auth_account()?
                .ok_or_else(|| "Phiên đăng nhập đã bị đăng xuất".to_string())?;
            if recheck.access_token.is_empty()
                || now_ms() >= recheck.expires_at.saturating_sub(ACCESS_TOKEN_REFRESH_MARGIN_MS)
            {
                self.refresh_token_locked().await?
            } else {
                recheck
            }
        } else {
            acc
        };

        let token_type = if acc.token_type.is_empty() {
            "Bearer"
        } else {
            acc.token_type.as_str()
        };

        Ok(Some(AuthHeaders {
            authorization: format!("{token_type} {}", acc.access_token),
            page_id: if acc.page_id.is_empty() {
                None
            } else {
                Some(acc.page_id)
            },
            visitor_data: self.get_visitor_data_cached(),
        }))
    }

    pub async fn force_refresh_auth_headers(
        &self,
        rejected_header: &str,
    ) -> Result<Option<AuthHeaders>, String> {
        let _guard = self.refresh_lock.lock().await;
        let Some(current) = self.db.get_auth_account()? else {
            return Ok(None);
        };

        let current_type = if current.token_type.is_empty() {
            "Bearer"
        } else {
            current.token_type.as_str()
        };
        let current_header = format!("{current_type} {}", current.access_token);

        let fresh = if current_header == rejected_header {
            self.refresh_token_locked().await?
        } else {
            current
        };

        let fresh_type = if fresh.token_type.is_empty() {
            "Bearer"
        } else {
            fresh.token_type.as_str()
        };

        Ok(Some(AuthHeaders {
            authorization: format!("{fresh_type} {}", fresh.access_token),
            page_id: if fresh.page_id.is_empty() {
                None
            } else {
                Some(fresh.page_id)
            },
            visitor_data: self.get_visitor_data_cached(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_base_js_handles_cobalt_shell_and_id_attr() {
        let html_cobalt = r#"<script nonce="abc">var s=document.createElement('script');s.src = '/s/_/kabuki/_/js/k=kabuki.base_cr.en_US.test/m=base';</script>"#;
        assert_eq!(
            extract_base_js_url(html_cobalt).as_deref(),
            Some("https://www.youtube.com/s/_/kabuki/_/js/k=kabuki.base_cr.en_US.test/m=base")
        );

        let html_tag = r#"<script id="base-js" src="/s/player/abc/base.js"></script>"#;
        assert_eq!(
            extract_base_js_url(html_tag).as_deref(),
            Some("https://www.youtube.com/s/player/abc/base.js")
        );
    }

    #[test]
    fn extract_tv_oauth_client_reads_first_valid_pair() {
        let fake_js = r#"var a={clientId:"1234567890-fakeunittestclient.apps.googleusercontent.com",clientSecret:"UnitTest_FakeSecret_12345"};var b={clientId:"9999-other.apps.googleusercontent.com",secret:"OTHER_999"};"#;
        let parsed = extract_tv_oauth_client(fake_js).expect("should match synthetic test client");
        assert_eq!(
            parsed.0,
            "1234567890-fakeunittestclient.apps.googleusercontent.com"
        );
        assert_eq!(parsed.1, "UnitTest_FakeSecret_12345");
    }

    #[test]
    fn parse_accounts_list_extracts_selected_profile_and_page_id() {
        let sample = json!({
            "contents": [{
                "accountSectionListRenderer": {
                    "contents": [{
                        "accountItemSectionRenderer": {
                            "contents": [{
                                "accountItem": {
                                    "accountName": { "simpleText": "Nguyen Van A" },
                                    "accountByline": { "simpleText": "user@example.com" },
                                    "channelHandle": { "simpleText": "@nguyenvana" },
                                    "accountPhoto": {
                                        "thumbnails": [
                                            { "url": "//yt3.ggpht.com/small.jpg" },
                                            { "url": "//yt3.ggpht.com/large.jpg" }
                                        ]
                                    },
                                    "isSelected": true,
                                    "isDisabled": false,
                                    "hasChannel": true,
                                    "serviceEndpoint": {
                                        "selectActiveIdentityEndpoint": {
                                            "supportedTokens": [{
                                                "pageIdToken": { "pageId": "109876543210" }
                                            }]
                                        }
                                    }
                                }
                            }]
                        }
                    }]
                }
            }]
        });

        let (name, email, avatar, handle, page_id) =
            parse_accounts_list(&sample).expect("should parse account");
        assert_eq!(name, "Nguyen Van A");
        assert_eq!(email, "user@example.com");
        assert_eq!(avatar, "https://yt3.ggpht.com/large.jpg");
        assert_eq!(handle, "@nguyenvana");
        assert_eq!(page_id, "109876543210");
    }

    #[test]
    fn uuid_v4_has_standard_format() {
        let id = generate_uuid_v4();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[8..9], "-");
        assert_eq!(&id[13..14], "-");
        assert_eq!(&id[14..15], "4");
        assert_eq!(&id[18..19], "-");
        assert_eq!(&id[23..24], "-");
    }
}
