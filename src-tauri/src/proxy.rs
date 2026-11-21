use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

use crate::youtube::{resolve_client_user_agent, YouTubeService, CLIENT_VISIONOS, CLIENT_WEB};

pub const PROXY_HOST: &str = "127.0.0.1";
pub const PROXY_PORT: u16 = 8989;
pub const MAX_RANGE_CHUNK_BYTES: u64 = 2 * 1024 * 1024; // 2MB cap per chunk

#[derive(Clone)]
pub struct ProxyState {
    pub http: reqwest::Client,
    pub yt: Arc<YouTubeService>,
}

#[derive(Debug, Deserialize)]
pub struct HlsManifestQuery {
    pub url: Option<String>,
    pub id: Option<String>,
    pub client: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    pub url: String,
    pub client: Option<String>,
    pub id: Option<String>,
    pub itag: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SubtitleQuery {
    pub url: String,
}

pub async fn start_proxy_server(yt: Arc<YouTubeService>) {
    // Dedicated streaming client: keep-alive pool, connect timeout only (never drop long streams mid-transfer)
    let http = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .pool_max_idle_per_host(64)
        .tcp_keepalive(Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[TayTube Proxy] Failed to build reqwest client: {e}");
            return;
        }
    };

    let state = ProxyState { http, yt };

    let app = Router::new()
        .route("/stream", get(handle_stream).options(handle_cors_preflight))
        .route("/stream.ts", get(handle_stream_ts).options(handle_cors_preflight))
        .route("/stream.mp4", get(handle_stream_mp4).options(handle_cors_preflight))
        .route("/stream.aac", get(handle_stream_aac).options(handle_cors_preflight))
        .route("/stream.vtt", get(handle_stream_vtt).options(handle_cors_preflight))
        .route("/hls-manifest", get(handle_hls_manifest).options(handle_cors_preflight))
        .route("/hls.m3u8", get(handle_hls_manifest).options(handle_cors_preflight))
        .route("/subtitle", get(handle_subtitle).options(handle_cors_preflight))
        .with_state(state);

    let addr = format!("{PROXY_HOST}:{PROXY_PORT}");
    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[TayTube Proxy] Server exited with error: {e}");
            }
        }
        Err(e) => {
            eprintln!("[TayTube Proxy] Failed to bind {addr}: {e}");
        }
    }
}

fn apply_cors_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Range, User-Agent, Accept, Content-Type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges"),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
}

async fn handle_cors_preflight() -> Response {
    let mut res = Response::new(Body::empty());
    *res.status_mut() = StatusCode::OK;
    apply_cors_headers(res.headers_mut());
    res
}

fn text_error(status: StatusCode, msg: String) -> Response {
    let mut res = (status, msg).into_response();
    apply_cors_headers(res.headers_mut());
    res
}

async fn handle_hls_manifest(
    State(state): State<ProxyState>,
    Query(q): Query<HlsManifestQuery>,
) -> Response {
    let video_id = q.id.unwrap_or_default();
    let mut target_hls_url = q.url.filter(|s| !s.is_empty());
    let mut hls_client_hint: Option<&str> = None;

    if target_hls_url.is_none() && !video_id.is_empty() {
        let ios = state.yt.fetch_ios_streaming_data(&video_id).await;
        target_hls_url = ios.hls_manifest_url;
        hls_client_hint = ios.client_name;
    }

    let Some(hls_url) = target_hls_url else {
        return text_error(StatusCode::NOT_FOUND, "HLS Manifest URL not found for video".to_string());
    };

    let (hls_client_name, hls_ua) = resolve_client_user_agent(
        q.client.as_deref().or(hls_client_hint),
        Some(CLIENT_VISIONOS.name),
    );

    let upstream = match state
        .http
        .get(&hls_url)
        .header(header::USER_AGENT, hls_ua)
        .header(header::ACCEPT, "*/*")
        .header(header::ACCEPT_ENCODING, "identity")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return text_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to fetch HLS manifest: {e}"),
            );
        }
    };

    let status = upstream.status();
    if status.as_u16() >= 400 {
        eprintln!(
            "[Proxy HLS Manifest Error] HTTP {} from googlevideo.com | client={} | headers={:?}",
            status.as_u16(),
            hls_client_name,
            upstream.headers()
        );
        return text_error(
            StatusCode::BAD_GATEWAY,
            format!("HTTP {} from Google HLS manifest", status.as_u16()),
        );
    }

    let final_url = upstream.url().to_string();
    let raw_m3u8 = match upstream.text().await {
        Ok(t) => t,
        Err(e) => {
            return text_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to read HLS manifest body: {e}"),
            );
        }
    };

    let rewritten = rewrite_m3u8(&raw_m3u8, &final_url, &video_id, hls_client_name);
    let mut res = Response::new(Body::from(rewritten));
    *res.status_mut() = StatusCode::OK;
    apply_cors_headers(res.headers_mut());
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/vnd.apple.mpegurl; charset=utf-8"),
    );
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );
    res
}

async fn handle_subtitle(
    State(state): State<ProxyState>,
    Query(q): Query<SubtitleQuery>,
) -> Response {
    if q.url.trim().is_empty() {
        return text_error(StatusCode::BAD_REQUEST, "Missing url parameter".to_string());
    }

    let upstream = match state
        .http
        .get(&q.url)
        .header(header::USER_AGENT, CLIENT_WEB.user_agent)
        .header(header::ORIGIN, "https://www.youtube.com")
        .header(header::REFERER, "https://www.youtube.com/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return text_error(
                StatusCode::BAD_GATEWAY,
                format!("Subtitle fetch error: {e}"),
            );
        }
    };

    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut res_headers = HeaderMap::new();
    apply_cors_headers(&mut res_headers);
    res_headers.insert(
        header::CONTENT_TYPE,
        upstream
            .headers()
            .get(header::CONTENT_TYPE)
            .cloned()
            .unwrap_or_else(|| HeaderValue::from_static("text/vtt; charset=utf-8")),
    );
    if let Some(cl) = upstream.headers().get(header::CONTENT_LENGTH) {
        res_headers.insert(header::CONTENT_LENGTH, cl.clone());
    }

    if !status.is_success() {
        return text_error(status, format!("Subtitle upstream HTTP {}", status.as_u16()));
    }

    let stream = upstream.bytes_stream();
    let mut res = Response::new(Body::from_stream(stream));
    *res.status_mut() = status;
    *res.headers_mut() = res_headers;
    res
}

fn strip_range_query_params(mut parsed: Url) -> Url {
    let filtered_pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| k != "range" && k != "rn")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if filtered_pairs.is_empty() {
        parsed.set_query(None);
    } else {
        parsed.query_pairs_mut().clear().extend_pairs(filtered_pairs);
    }
    parsed
}

/// Resolves an accurate Content-Type for the proxy response while preserving concrete audio/video MIME headers.
/// Replaces generic `application/octet-stream` / `binary/octet-stream` headers returned on YouTube HLS segments.
pub fn resolve_stream_content_type(
    upstream_ct: Option<&str>,
    target_url: &Url,
    mime_hint: Option<&str>,
) -> HeaderValue {
    if let Some(raw_ct) = upstream_ct {
        let lower = raw_ct.trim().to_lowercase();
        if !lower.is_empty()
            && !lower.starts_with("application/octet-stream")
            && !lower.starts_with("binary/octet-stream")
        {
            if let Ok(hv) = HeaderValue::from_str(raw_ct) {
                return hv;
            }
        }
    }

    if let Some(hint) = mime_hint {
        if let Ok(hv) = HeaderValue::from_str(hint) {
            return hv;
        }
    }

    if let Some((_, query_mime)) = target_url.query_pairs().find(|(k, _)| k == "mime") {
        let lower_q = query_mime.trim().to_lowercase();
        if !lower_q.is_empty()
            && !lower_q.starts_with("application/octet-stream")
            && !lower_q.starts_with("binary/octet-stream")
        {
            if let Ok(hv) = HeaderValue::from_str(&query_mime) {
                return hv;
            }
        }
    }

    let path = target_url.path().to_lowercase();
    if path.contains("/goap/") {
        return HeaderValue::from_static("audio/aac");
    }
    if path.contains("/timedtext") || path.ends_with(".vtt") {
        return HeaderValue::from_static("text/vtt; charset=utf-8");
    }
    if target_url
        .query()
        .map(|q| q.split('&').any(|pair| pair == "is=1"))
        .unwrap_or(false)
        || path.ends_with(".mp4")
    {
        return HeaderValue::from_static("video/mp4");
    }
    if path.contains("/govp/") || path.ends_with(".ts") {
        return HeaderValue::from_static("video/mp2t");
    }

    HeaderValue::from_static("video/mp4")
}

async fn handle_stream(
    method: Method,
    state: State<ProxyState>,
    headers: HeaderMap,
    q: Query<StreamQuery>,
) -> Response {
    handle_stream_inner(method, state, headers, q, None).await
}

async fn handle_stream_ts(
    method: Method,
    state: State<ProxyState>,
    headers: HeaderMap,
    q: Query<StreamQuery>,
) -> Response {
    handle_stream_inner(method, state, headers, q, Some("video/mp2t")).await
}

async fn handle_stream_mp4(
    method: Method,
    state: State<ProxyState>,
    headers: HeaderMap,
    q: Query<StreamQuery>,
) -> Response {
    handle_stream_inner(method, state, headers, q, Some("video/mp4")).await
}

async fn handle_stream_aac(
    method: Method,
    state: State<ProxyState>,
    headers: HeaderMap,
    q: Query<StreamQuery>,
) -> Response {
    handle_stream_inner(method, state, headers, q, Some("audio/aac")).await
}

async fn handle_stream_vtt(
    method: Method,
    state: State<ProxyState>,
    headers: HeaderMap,
    q: Query<StreamQuery>,
) -> Response {
    handle_stream_inner(method, state, headers, q, Some("text/vtt; charset=utf-8")).await
}

async fn handle_stream_inner(
    method: Method,
    State(state): State<ProxyState>,
    headers: HeaderMap,
    Query(q): Query<StreamQuery>,
    mime_hint: Option<&'static str>,
) -> Response {
    let Ok(parsed_url) = Url::parse(&q.url) else {
        return text_error(StatusCode::BAD_REQUEST, "Invalid url parameter".to_string());
    };

    // Extract signed `c=` client param before cleaning query parameters
    let url_client: Option<String> = parsed_url
        .query_pairs()
        .find(|(k, _)| k == "c")
        .map(|(_, v)| v.into_owned());

    let url_itag: Option<i64> = parsed_url
        .query_pairs()
        .find(|(k, _)| k == "itag")
        .and_then(|(_, v)| v.parse::<i64>().ok());

    // Strip conflicting range and rn params so HTTP Range headers work cleanly
    let clean_url = strip_range_query_params(parsed_url);

    let itag = q.itag.or(url_itag);
    let (client_name, user_agent) =
        resolve_client_user_agent(url_client.as_deref(), q.client.as_deref());

    let raw_client_range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let range_header = build_chunked_range_header(raw_client_range.as_deref(), &clean_url);

    let req_method = if method == Method::HEAD {
        reqwest::Method::HEAD
    } else {
        reqwest::Method::GET
    };

    let send_upstream = |target: &str, ua: &str, range: Option<&str>, m: reqwest::Method| {
        let mut builder = state
            .http
            .request(m, target)
            .header(header::USER_AGENT, ua)
            .header(header::ACCEPT, "*/*")
            .header(header::ACCEPT_ENCODING, "identity");
        if let Some(r) = range {
            builder = builder.header(header::RANGE, r);
        }
        builder.send()
    };

    let mut upstream_res = match send_upstream(
        clean_url.as_str(),
        user_agent,
        range_header.as_deref(),
        req_method.clone(),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return text_error(
                StatusCode::BAD_GATEWAY,
                format!("Upstream Google Gateway Error: {e}"),
            );
        }
    };

    let initial_clean_str = clean_url.to_string();
    let mut active_target_url = clean_url;
    let mut raw_status = upstream_res.status().as_u16();

    // Detailed debug log when upstream googlevideo.com returns status >= 400
    if raw_status >= 400 {
        eprintln!(
            "[Proxy Upstream Error] HTTP {} from googlevideo.com | client={} | UA=\"{}\" | range={} | headers={:?}",
            raw_status,
            client_name,
            user_agent,
            range_header.as_deref().unwrap_or("none"),
            upstream_res.headers()
        );

        // Automatic multi-client fresh-URL fallback if googlevideo returns 403 Forbidden
        if raw_status == 403 {
            if let Some(ref vid) = q.id {
                let is_audio_stream =
                    matches!(itag, Some(139 | 140 | 141 | 249 | 250 | 251 | 599 | 600))
                        || active_target_url
                            .query_pairs()
                            .find(|(k, _)| k == "mime")
                            .map(|(_, v)| v.to_lowercase().starts_with("audio/"))
                            .unwrap_or(false);

                let candidates = state
                    .yt
                    .resolve_fallback_stream_candidates(
                        vid,
                        itag,
                        Some(client_name),
                        is_audio_stream,
                    )
                    .await;

                for (alt_url, alt_client, alt_ua) in candidates {
                    if alt_url == q.url {
                        continue;
                    }
                    let Ok(alt_parsed_raw) = Url::parse(&alt_url) else {
                        continue;
                    };
                    let alt_parsed = strip_range_query_params(alt_parsed_raw);
                    if alt_parsed.as_str() == initial_clean_str {
                        continue;
                    }
                    let alt_range =
                        build_chunked_range_header(raw_client_range.as_deref(), &alt_parsed);
                    if let Ok(retried) = send_upstream(
                        alt_parsed.as_str(),
                        alt_ua,
                        alt_range.as_deref(),
                        req_method.clone(),
                    )
                    .await
                    {
                        raw_status = retried.status().as_u16();
                        active_target_url = alt_parsed;
                        upstream_res = retried;
                        if (200..300).contains(&raw_status) {
                            eprintln!(
                                "[Proxy Fallback OK] HTTP {} | from={} -> fallback_client={} | itag={:?}",
                                raw_status,
                                client_name,
                                alt_client,
                                itag
                            );
                            break;
                        }
                        eprintln!(
                            "[Proxy Fallback Error] HTTP {} | fallback_client={} | UA=\"{}\" | headers={:?}",
                            raw_status,
                            alt_client,
                            alt_ua,
                            upstream_res.headers()
                        );
                    }
                }
            }
        }
    }

    let status_code = StatusCode::from_u16(raw_status).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut res_headers = HeaderMap::new();
    apply_cors_headers(&mut res_headers);
    res_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));

    if let Some(cr) = upstream_res.headers().get(header::CONTENT_RANGE) {
        res_headers.insert(header::CONTENT_RANGE, cr.clone());
    }
    if let Some(cl) = upstream_res.headers().get(header::CONTENT_LENGTH) {
        res_headers.insert(header::CONTENT_LENGTH, cl.clone());
    }
    let upstream_ct = upstream_res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    res_headers.insert(
        header::CONTENT_TYPE,
        resolve_stream_content_type(upstream_ct, &active_target_url, mime_hint),
    );

    if method == Method::HEAD || raw_status < 200 || raw_status >= 300 {
        let mut res = Response::new(Body::empty());
        *res.status_mut() = status_code;
        *res.headers_mut() = res_headers;
        return res;
    }

    // Stream directly from Google to WebView2 (zero full-body buffering in RAM; client disconnect aborts stream)
    let stream = upstream_res.bytes_stream();
    let mut res = Response::new(Body::from_stream(stream));
    *res.status_mut() = status_code;
    *res.headers_mut() = res_headers;
    res
}

/// Bounds open-ended or oversized `Range` requests to 2MB chunks so seeking 19-37h videos never overflows RAM.
/// Leaves discrete HLS segments untouched when no Range header was requested.
pub fn build_chunked_range_header(raw_range: Option<&str>, target_url: &Url) -> Option<String> {
    let path = target_url.path();
    let is_discrete_hls_segment = path.contains("/gosq/")
        || path.ends_with(".ts")
        || path.ends_with(".vtt")
        || path.contains("/timedtext")
        || path.contains("/slices=")
        || path.contains("/slices%3D")
        || path.contains("/slices%3d")
        || target_url
            .query()
            .map(|q| q.split('&').any(|pair| pair == "is=1"))
            .unwrap_or(false);

    let effective_range = match raw_range {
        Some(r) if !r.trim().is_empty() => r,
        _ => {
            if is_discrete_hls_segment {
                return None;
            }
            "bytes=0-"
        }
    };

    let after_prefix = effective_range.trim().strip_prefix("bytes=")?;
    let (start_str, end_str) = after_prefix.split_once('-')?;
    let start = start_str.trim().parse::<u64>().ok()?;
    let requested_end = if end_str.trim().is_empty() {
        None
    } else {
        end_str.trim().parse::<u64>().ok()
    };

    let total_size = target_url
        .query_pairs()
        .find(|(k, _)| k == "clen")
        .and_then(|(_, v)| v.parse::<u64>().ok());

    let max_end = start.saturating_add(MAX_RANGE_CHUNK_BYTES).saturating_sub(1);
    let mut end = match requested_end {
        Some(req_end) if req_end >= start && req_end - start + 1 <= MAX_RANGE_CHUNK_BYTES => req_end,
        _ => max_end,
    };

    if let Some(total) = total_size {
        if total > 0 && end >= total {
            end = total - 1;
        }
    }

    if end >= start {
        Some(format!("bytes={start}-{end}"))
    } else {
        Some(format!("bytes={start}-"))
    }
}

/// Classifies whether an HLS URL points to a nested `.m3u8` playlist or a discrete media segment.
/// Critical: YouTube HLS `.ts` segment URLs contain `/playlist/index.m3u8/govp/.../file/seg.ts`,
/// so `/videoplayback`, `.ts`, and `.mp4` must be excluded before checking `.m3u8`.
pub fn is_hls_playlist_url(abs_url: &str) -> bool {
    if let Ok(u) = Url::parse(abs_url) {
        let p = u.path();
        if p.contains("/videoplayback") || p.ends_with(".ts") || p.ends_with(".mp4") {
            return false;
        }
        return p.ends_with(".m3u8")
            || p.contains("/api/manifest/hls_playlist")
            || p.contains("/api/manifest/hls_variant")
            || p.contains("/api/manifest/hls_timedtext");
    }
    abs_url.ends_with(".m3u8") && !abs_url.contains("/videoplayback")
}

/// Rewrites every nested playlist URL to `/hls.m3u8` and every media segment URL to typed `/stream.*` routes.
pub fn rewrite_m3u8(
    raw_m3u8: &str,
    base_url: &str,
    video_id: &str,
    client_name: &str,
) -> String {
    let proxy_base = format!("http://{PROXY_HOST}:{PROXY_PORT}");
    let id_suffix = if video_id.is_empty() {
        String::new()
    } else {
        format!("&id={}", urlencoding::encode(video_id))
    };
    let encoded_client = urlencoding::encode(client_name);
    let is_fmp4_playlist = raw_m3u8.contains("#EXT-X-MAP:");

    let base_parsed = Url::parse(base_url).ok();

    let rewrite_target = |raw_uri: &str| -> String {
        let resolved = match &base_parsed {
            Some(base) => base
                .join(raw_uri)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| raw_uri.to_string()),
            None => raw_uri.to_string(),
        };

        if is_hls_playlist_url(&resolved) {
            format!(
                "{proxy_base}/hls.m3u8?url={}&client={encoded_client}{id_suffix}",
                urlencoding::encode(&resolved)
            )
        } else {
            let seg_route = if is_fmp4_playlist {
                "/stream.mp4"
            } else if resolved.contains("/goap/") {
                "/stream.aac"
            } else if resolved.contains("/timedtext") || resolved.ends_with(".vtt") {
                "/stream.vtt"
            } else {
                "/stream.ts"
            };
            format!(
                "{proxy_base}{seg_route}?url={}&client={encoded_client}{id_suffix}",
                urlencoding::encode(&resolved)
            )
        }
    };

    let mut out = Vec::new();
    for raw_line in raw_m3u8.split('\n') {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            out.push(raw_line.to_string());
            continue;
        }

        if trimmed.starts_with('#') {
            if let Some(uri_pos) = trimmed.find("URI=\"") {
                let prefix_end = uri_pos + 5;
                if let Some(rel_end) = trimmed[prefix_end..].find('"') {
                    let abs_end = prefix_end + rel_end;
                    let orig_uri = &trimmed[prefix_end..abs_end];
                    let rewritten_uri = rewrite_target(orig_uri);
                    let mut line_out = String::with_capacity(trimmed.len() + 64);
                    line_out.push_str(&trimmed[..prefix_end]);
                    line_out.push_str(&rewritten_uri);
                    line_out.push_str(&trimmed[abs_end..]);
                    out.push(line_out);
                    continue;
                }
            }
            out.push(raw_line.to_string());
            continue;
        }

        out.push(rewrite_target(trimmed));
    }

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunked_range_caps_open_range_to_2mb_and_respects_clen() {
        let url = Url::parse("https://rr1.googlevideo.com/videoplayback?clen=10485760").unwrap();
        assert_eq!(
            build_chunked_range_header(None, &url).as_deref(),
            Some("bytes=0-2097151")
        );
        assert_eq!(
            build_chunked_range_header(Some("bytes=9000000-"), &url).as_deref(),
            Some("bytes=9000000-10485759")
        );
        assert_eq!(
            build_chunked_range_header(Some("bytes=100-500"), &url).as_deref(),
            Some("bytes=100-500")
        );
    }

    #[test]
    fn discrete_hls_segment_leaves_range_none_when_client_omits_it() {
        let url = Url::parse(
            "https://rr9.googlevideo.com/videoplayback/id/abc/playlist/index.m3u8/govp/slices=0-85301/gosq/0/file/seg.ts",
        )
        .unwrap();
        assert_eq!(build_chunked_range_header(None, &url), None);
    }

    #[test]
    fn rewrite_m3u8_distinguishes_playlist_vs_typed_segments() {
        let master = "#EXTM3U\n#EXT-X-MEDIA:URI=\"https://manifest.googlevideo.com/api/manifest/hls_playlist/id/123/index.m3u8\",TYPE=AUDIO\nhttps://rr9.googlevideo.com/videoplayback/id/123/playlist/index.m3u8/govp/slices=0-100/gosq/0/file/seg.ts\nhttps://rr9.googlevideo.com/videoplayback/id/123/playlist/index.m3u8/goap/slices=0-100/gosq/0/file/seg.ts\n";
        let out_ios = rewrite_m3u8(
            master,
            "https://manifest.googlevideo.com/api/manifest/hls_variant/index.m3u8",
            "dQw4w9WgXcQ",
            "IOS",
        );

        assert!(out_ios.contains("URI=\"http://127.0.0.1:8989/hls.m3u8?url="));
        assert!(out_ios.contains("&client=IOS&id=dQw4w9WgXcQ\""));
        assert!(out_ios.contains("\nhttp://127.0.0.1:8989/stream.ts?url="));
        assert!(out_ios.contains("\nhttp://127.0.0.1:8989/stream.aac?url="));
        assert!(out_ios.contains("&client=IOS&id=dQw4w9WgXcQ"));

        let fmp4_variant = "#EXTM3U\n#EXT-X-MAP:URI=\"https://rr1.googlevideo.com/videoplayback/id/123/govp/slices=0-500/gosq/0?is=1&file=seg.ts\"\nhttps://rr1.googlevideo.com/videoplayback/id/123/govp/slices=501-1000/gosq/1/file/seg.ts\n";
        let out_vision = rewrite_m3u8(
            fmp4_variant,
            "https://manifest.googlevideo.com/api/manifest/hls_playlist/index.m3u8",
            "dQw4w9WgXcQ",
            "VISIONOS",
        );
        assert!(out_vision.contains("URI=\"http://127.0.0.1:8989/stream.mp4?url="));
        assert!(out_vision.contains("\nhttp://127.0.0.1:8989/stream.mp4?url="));
        assert!(out_vision.contains("&client=VISIONOS&id=dQw4w9WgXcQ"));
    }

    #[test]
    fn resolve_stream_content_type_replaces_octet_stream_and_preserves_media_mimes() {
        let ts_url = Url::parse("https://rr1.googlevideo.com/videoplayback/id/abc/govp/slices%3D0-100/gosq/0/file/seg.ts").unwrap();
        let aac_url = Url::parse("https://rr1.googlevideo.com/videoplayback/id/abc/goap/slices%3D0-100/gosq/0/file/seg.ts").unwrap();
        let audio_url = Url::parse("https://rr1.googlevideo.com/videoplayback?itag=140").unwrap();

        assert_eq!(
            resolve_stream_content_type(Some("application/octet-stream"), &ts_url, Some("video/mp2t"))
                .to_str()
                .unwrap(),
            "video/mp2t"
        );
        assert_eq!(
            resolve_stream_content_type(Some("application/octet-stream"), &aac_url, None)
                .to_str()
                .unwrap(),
            "audio/aac"
        );
        assert_eq!(
            resolve_stream_content_type(Some("audio/mp4"), &audio_url, None)
                .to_str()
                .unwrap(),
            "audio/mp4"
        );
        assert_eq!(
            resolve_stream_content_type(Some("audio/webm"), &audio_url, None)
                .to_str()
                .unwrap(),
            "audio/webm"
        );
    }
}
