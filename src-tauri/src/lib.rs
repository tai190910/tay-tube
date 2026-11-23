pub mod auth;
pub mod db;
pub mod proxy;
pub mod youtube;

use auth::{AuthService, DeviceAuthPollResult, DeviceAuthStartResult};
use db::{
    resolve_database_dir, AppDatabase, AuthAccountProfile, FavoriteInput, FavoriteItem,
    HistoryInput, HistoryItem, ResumeItem,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, WebviewWindow,
    WindowEvent,
};
use url::Url;
use youtube::{
    CommentsResult, MusicAudioStreamResult, MusicShelf, MusicTrackItem, RelatedVideosResult,
    SearchVideoItem, ShortsFeedResult, StreamExtractMode, TayTubeVideoDetails, YouTubeService,
};

const NORMAL_MIN_WIDTH: f64 = 900.0;
const NORMAL_MIN_HEIGHT: f64 = 600.0;
const PIP_MIN_WIDTH: f64 = 320.0;
const PIP_MIN_HEIGHT: f64 = 180.0;
const PIP_DEFAULT_WIDTH: f64 = 480.0;
const PIP_DEFAULT_HEIGHT: f64 = 270.0;
const PIP_MARGIN_LOGICAL: f64 = 24.0;

#[derive(Debug, Clone)]
pub struct SavedWindowBounds {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub was_maximized: bool,
    pub was_decorated: bool,
}

#[derive(Debug, Default)]
pub struct PipWindowState {
    pub active: bool,
    pub saved: Option<SavedWindowBounds>,
    pub last_enforced_phys: Option<(u32, u32)>,
}

pub struct ProxyState {
    pub port: u16,
    shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl ProxyState {
    pub fn new(port: u16, shutdown_tx: tokio::sync::oneshot::Sender<()>) -> Self {
        Self {
            port,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.shutdown_tx.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }
    }
}

pub struct AppState {
    pub db: Arc<AppDatabase>,
    pub auth: Arc<AuthService>,
    pub yt: Arc<YouTubeService>,
    pub pip: Mutex<PipWindowState>,
}

#[tauri::command]
fn get_proxy_port(state: State<'_, ProxyState>) -> u16 {
    state.port
}

/// Computes a 16:9 size (width, height) clamped to at least `min_width`,
/// honoring either height-driven edge drags or width/corner drags.
pub fn compute_pip_aspect_size(
    width: u32,
    height: u32,
    prev: Option<(u32, u32)>,
    min_width: u32,
) -> (u32, u32) {
    let min_w = min_width.max(16);
    let min_h = ((min_w as f64) * 9.0 / 16.0).round().max(9.0) as u32;

    let height_driven = if let Some((pw, ph)) = prev {
        let dw = width.abs_diff(pw);
        let dh = height.abs_diff(ph);
        (dh > 0 && dw == 0) || ((dh as f64) * (16.0 / 9.0) > (dw as f64) * 1.15)
    } else {
        false
    };

    let target_w = if height_driven {
        (((height as f64) * 16.0 / 9.0).round() as u32).max(min_w)
    } else {
        width.max(min_w)
    };
    let target_h = (((target_w as f64) * 9.0 / 16.0).round() as u32).max(min_h);
    (target_w, target_h)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetailsOptions {
    pub target_quality: Option<i64>,
    pub prefer_hdr: Option<bool>,
    pub mode: Option<StreamExtractMode>,
}

#[tauri::command]
async fn get_video_details(
    state: State<'_, AppState>,
    url_or_id: String,
    options: Option<VideoDetailsOptions>,
) -> Result<TayTubeVideoDetails, String> {
    let target_q = options.as_ref().and_then(|o| o.target_quality);
    let pref_hdr = options.as_ref().and_then(|o| o.prefer_hdr);
    let mode = options.as_ref().and_then(|o| o.mode);
    state
        .yt
        .get_video_details(&url_or_id, target_q, pref_hdr, mode)
        .await
}

#[tauri::command]
async fn search_videos(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchVideoItem>, String> {
    state.yt.search_videos(&query).await
}

#[tauri::command]
async fn get_trending_videos(
    state: State<'_, AppState>,
) -> Result<Vec<SearchVideoItem>, String> {
    state.yt.get_trending_videos().await
}

#[tauri::command]
async fn get_video_comments(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<CommentsResult, String> {
    state.yt.get_video_comments(&video_id).await
}

#[tauri::command]
fn db_get_history(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<HistoryItem>, String> {
    state.db.get_history(limit.unwrap_or(100))
}

#[tauri::command]
fn db_add_to_history(state: State<'_, AppState>, item: HistoryInput) -> Result<(), String> {
    state.db.add_to_history(item)
}

#[tauri::command]
fn db_clear_history(state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_history()
}

#[tauri::command]
fn db_delete_history_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_history_item(&id)
}

#[tauri::command]
fn db_get_resume(state: State<'_, AppState>, id: String) -> Result<Option<ResumeItem>, String> {
    state.db.get_resume(&id)
}

#[tauri::command]
fn db_get_all_resumes(
    state: State<'_, AppState>,
) -> Result<HashMap<String, ResumeItem>, String> {
    state.db.get_all_resumes()
}

#[tauri::command]
fn db_save_resume(
    state: State<'_, AppState>,
    id: String,
    position_ms: i64,
    duration_ms: i64,
) -> Result<(), String> {
    state.db.save_resume(&id, position_ms, duration_ms)
}

#[tauri::command]
fn db_get_favorites(state: State<'_, AppState>) -> Result<Vec<FavoriteItem>, String> {
    state.db.get_favorites()
}

#[tauri::command]
fn db_is_favorite(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.db.is_favorite(&id)
}

#[tauri::command]
fn db_toggle_favorite(state: State<'_, AppState>, item: FavoriteInput) -> Result<bool, String> {
    state.db.toggle_favorite(item)
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
fn window_is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_enter_pip(window: WebviewWindow, state: State<'_, AppState>) -> Result<bool, String> {
    {
        let pip = state
            .pip
            .lock()
            .map_err(|_| "PiP state lock failed".to_string())?;
        if pip.active {
            return Ok(true);
        }
    }

    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
    }

    let was_maximized = window.is_maximized().unwrap_or(false);
    let was_decorated = window.is_decorated().unwrap_or(false);

    if was_maximized {
        let _ = window.unmaximize();
    }

    let scale = window.scale_factor().unwrap_or(1.0).max(0.5);
    let fallback_w = (1280.0 * scale).round() as u32;
    let fallback_h = (800.0 * scale).round() as u32;
    let inner_size = window
        .inner_size()
        .unwrap_or_else(|_| PhysicalSize::new(fallback_w, fallback_h));
    let outer_pos = window
        .outer_position()
        .unwrap_or_else(|_| PhysicalPosition::new(100, 100));

    let saved = SavedWindowBounds {
        width: inner_size.width,
        height: inner_size.height,
        x: outer_pos.x,
        y: outer_pos.y,
        was_maximized,
        was_decorated,
    };

    window.set_decorations(false).map_err(|e| e.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|e| e.to_string())?;
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(
            PIP_MIN_WIDTH,
            PIP_MIN_HEIGHT,
        ))))
        .map_err(|e| e.to_string())?;

    let pip_w = (PIP_DEFAULT_WIDTH * scale).round() as u32;
    let pip_h = (PIP_DEFAULT_HEIGHT * scale).round() as u32;
    let margin = (PIP_MARGIN_LOGICAL * scale).round() as i32;

    window
        .set_size(Size::Physical(PhysicalSize::new(pip_w, pip_h)))
        .map_err(|e| e.to_string())?;

    if let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
    {
        let work = monitor.work_area();
        let target_x =
            (work.position.x + (work.size.width as i32) - (pip_w as i32) - margin).max(work.position.x);
        let target_y =
            (work.position.y + (work.size.height as i32) - (pip_h as i32) - margin).max(work.position.y);
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(
            target_x, target_y,
        )));
    }

    let actual = window
        .inner_size()
        .unwrap_or_else(|_| PhysicalSize::new(pip_w, pip_h));

    {
        let mut pip = state
            .pip
            .lock()
            .map_err(|_| "PiP state lock failed".to_string())?;
        pip.saved = Some(saved);
        pip.last_enforced_phys = Some((actual.width, actual.height));
        pip.active = true;
    }

    Ok(true)
}

#[tauri::command]
fn window_exit_pip(window: WebviewWindow, state: State<'_, AppState>) -> Result<bool, String> {
    let saved = {
        let mut pip = state
            .pip
            .lock()
            .map_err(|_| "PiP state lock failed".to_string())?;
        if !pip.active {
            return Ok(false);
        }
        pip.active = false;
        pip.last_enforced_phys = None;
        pip.saved.take()
    };

    window
        .set_always_on_top(false)
        .map_err(|e| e.to_string())?;
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(
            NORMAL_MIN_WIDTH,
            NORMAL_MIN_HEIGHT,
        ))))
        .map_err(|e| e.to_string())?;

    if let Some(bounds) = saved {
        let scale = window.scale_factor().unwrap_or(1.0).max(0.5);
        let min_norm_w = (NORMAL_MIN_WIDTH * scale).round() as u32;
        let min_norm_h = (NORMAL_MIN_HEIGHT * scale).round() as u32;

        let _ = window.set_decorations(bounds.was_decorated);
        let _ = window.set_size(Size::Physical(PhysicalSize::new(
            bounds.width.max(min_norm_w),
            bounds.height.max(min_norm_h),
        )));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(
            bounds.x, bounds.y,
        )));
        if bounds.was_maximized {
            let _ = window.maximize();
        }
    }

    Ok(false)
}

#[tauri::command]
fn window_start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn auth_get_account(state: State<'_, AppState>) -> Result<Option<AuthAccountProfile>, String> {
    state.auth.get_account_profile()
}

#[tauri::command]
async fn auth_start_device(state: State<'_, AppState>) -> Result<DeviceAuthStartResult, String> {
    state.auth.start_device_auth().await
}

#[tauri::command]
async fn auth_poll_device(
    state: State<'_, AppState>,
    device_code: String,
) -> Result<DeviceAuthPollResult, String> {
    state.auth.poll_device_auth(&device_code).await
}

#[tauri::command]
async fn auth_refresh_token(state: State<'_, AppState>) -> Result<AuthAccountProfile, String> {
    state.auth.refresh_access_token().await
}

#[tauri::command]
fn auth_sign_out(state: State<'_, AppState>) -> Result<(), String> {
    state.yt.clear_account_caches();
    state.auth.sign_out()
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("URL chứa ký tự không hợp lệ".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|e| format!("URL không hợp lệ: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "https" && scheme != "http" {
        return Err("Chỉ cho phép mở liên kết HTTP/HTTPS".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    if host.is_empty() {
        return Err("URL thiếu tên miền hợp lệ".to_string());
    }

    let target = parsed.to_string();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &target])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Không thể mở trình duyệt ngoài: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Không thể mở trình duyệt ngoài: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Không thể mở trình duyệt ngoài: {e}"))?;
        return Ok(());
    }
}

#[tauri::command]
async fn get_related_videos_continuation(
    state: State<'_, AppState>,
    video_id: String,
    continuation: String,
) -> Result<RelatedVideosResult, String> {
    state
        .yt
        .get_related_videos_continuation(&video_id, &continuation)
        .await
}

#[tauri::command]
async fn get_home_videos(state: State<'_, AppState>) -> Result<Vec<SearchVideoItem>, String> {
    state.yt.get_home_videos().await
}

#[tauri::command]
async fn get_subscriptions_videos(
    state: State<'_, AppState>,
) -> Result<Vec<SearchVideoItem>, String> {
    state.yt.get_subscriptions_videos().await
}

#[tauri::command]
async fn get_youtube_history(
    state: State<'_, AppState>,
) -> Result<Vec<SearchVideoItem>, String> {
    state.yt.get_youtube_history().await
}

#[tauri::command]
async fn get_watch_later_videos(
    state: State<'_, AppState>,
) -> Result<Vec<SearchVideoItem>, String> {
    state.yt.get_watch_later_videos().await
}

#[tauri::command]
async fn add_to_watch_later(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<bool, String> {
    state.yt.add_to_watch_later(&video_id).await
}

#[tauri::command]
async fn remove_from_watch_later(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<bool, String> {
    state.yt.remove_from_watch_later(&video_id).await
}

#[tauri::command]
async fn sync_watch_progress(
    state: State<'_, AppState>,
    video_id: String,
    position_sec: f64,
    duration_sec: f64,
) -> Result<(), String> {
    state
        .yt
        .sync_watch_progress(&video_id, position_sec, duration_sec)
        .await
}

#[tauri::command]
async fn get_shorts_feed(
    state: State<'_, AppState>,
    continuation: Option<String>,
) -> Result<ShortsFeedResult, String> {
    state.yt.get_shorts_feed(continuation).await
}

#[tauri::command]
async fn rate_video(
    state: State<'_, AppState>,
    video_id: String,
    like: bool,
) -> Result<bool, String> {
    state.yt.rate_video(&video_id, like).await
}

#[tauri::command]
async fn get_music_home(state: State<'_, AppState>) -> Result<Vec<MusicShelf>, String> {
    state.yt.get_music_home().await
}

#[tauri::command]
async fn search_music(
    state: State<'_, AppState>,
    query: String,
    filter: Option<String>,
) -> Result<Vec<MusicTrackItem>, String> {
    state.yt.search_music(&query, filter.as_deref()).await
}

#[tauri::command]
async fn get_music_radio(
    state: State<'_, AppState>,
    video_id: String,
    playlist_id: Option<String>,
) -> Result<Vec<MusicTrackItem>, String> {
    state
        .yt
        .get_music_radio(&video_id, playlist_id.as_deref())
        .await
}

#[tauri::command]
async fn get_music_audio_stream(
    state: State<'_, AppState>,
    video_id: String,
    playlist_id: Option<String>,
) -> Result<MusicAudioStreamResult, String> {
    state
        .yt
        .get_music_audio_stream(&video_id, playlist_id.as_deref())
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let fallback_dir = app.path().app_data_dir().ok();
            let db_dir = resolve_database_dir(fallback_dir.as_deref());
            let database = Arc::new(
                AppDatabase::open(&db_dir)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
            );

            let auth_service = Arc::new(
                AuthService::new(Arc::clone(&database))
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
            );

            let (proxy_listener, proxy_port) = proxy::bind_proxy_listener()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::AddrInUse, e))?;
            let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

            let yt_service = Arc::new(
                YouTubeService::new(Arc::clone(&auth_service), proxy_port)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
            );

            let yt_for_proxy = Arc::clone(&yt_service);
            tauri::async_runtime::spawn(async move {
                proxy::start_proxy_server(proxy_listener, proxy_port, yt_for_proxy, shutdown_rx)
                    .await;
            });

            app.manage(ProxyState::new(proxy_port, shutdown_tx));
            app.manage(AppState {
                db: database,
                auth: auth_service,
                yt: yt_service,
                pip: Mutex::new(PipWindowState::default()),
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Resized(size) = event {
                if size.width == 0 || size.height == 0 {
                    return;
                }
                let Some(state) = window.try_state::<AppState>() else {
                    return;
                };
                let scale = window.scale_factor().unwrap_or(1.0).max(0.5);
                let min_w = (PIP_MIN_WIDTH * scale).round() as u32;

                let resize_target = {
                    let Ok(mut pip) = state.pip.lock() else {
                        return;
                    };
                    if !pip.active {
                        None
                    } else {
                        let (target_w, target_h) = compute_pip_aspect_size(
                            size.width,
                            size.height,
                            pip.last_enforced_phys,
                            min_w,
                        );
                        if size.width.abs_diff(target_w) <= 2 && size.height.abs_diff(target_h) <= 2
                        {
                            pip.last_enforced_phys = Some((size.width, size.height));
                            None
                        } else {
                            pip.last_enforced_phys = Some((target_w, target_h));
                            Some((target_w, target_h))
                        }
                    }
                };

                if let Some((tw, th)) = resize_target {
                    let _ = window.set_size(Size::Physical(PhysicalSize::new(tw, th)));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_video_details,
            search_videos,
            get_trending_videos,
            get_video_comments,
            get_related_videos_continuation,
            get_home_videos,
            get_subscriptions_videos,
            get_youtube_history,
            get_watch_later_videos,
            add_to_watch_later,
            remove_from_watch_later,
            sync_watch_progress,
            get_shorts_feed,
            rate_video,
            get_music_home,
            search_music,
            get_music_radio,
            get_music_audio_stream,
            auth_get_account,
            auth_start_device,
            auth_poll_device,
            auth_refresh_token,
            auth_sign_out,
            open_external_url,
            db_get_history,
            db_add_to_history,
            db_clear_history,
            db_delete_history_item,
            db_get_resume,
            db_get_all_resumes,
            db_save_resume,
            db_get_favorites,
            db_is_favorite,
            db_toggle_favorite,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_toggle_fullscreen,
            window_is_fullscreen,
            window_enter_pip,
            window_exit_pip,
            window_start_dragging,
            get_proxy_port,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tay Tube PC Tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(proxy_state) = app_handle.try_state::<ProxyState>() {
                    proxy_state.shutdown();
                }
                if let Some(app_state) = app_handle.try_state::<AppState>() {
                    app_state.yt.clear_account_caches();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::compute_pip_aspect_size;

    #[test]
    fn pip_aspect_width_driven_locks_16_9() {
        assert_eq!(compute_pip_aspect_size(640, 400, None, 320), (640, 360));
    }

    #[test]
    fn pip_aspect_height_driven_locks_16_9() {
        assert_eq!(
            compute_pip_aspect_size(480, 360, Some((480, 270)), 320),
            (640, 360)
        );
    }

    #[test]
    fn pip_aspect_enforces_minimum_width() {
        assert_eq!(
            compute_pip_aspect_size(200, 120, Some((480, 270)), 320),
            (320, 180)
        );
    }

    #[test]
    fn pip_aspect_preserves_exact_16_9() {
        assert_eq!(
            compute_pip_aspect_size(480, 270, Some((480, 270)), 320),
            (480, 270)
        );
    }
}
