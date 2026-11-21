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
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};
use url::Url;
use youtube::{
    CommentsResult, MusicAudioStreamResult, MusicShelf, MusicTrackItem, SearchVideoItem,
    ShortsFeedResult, StreamExtractMode, TayTubeVideoDetails, YouTubeService,
};

pub struct AppState {
    pub db: Arc<AppDatabase>,
    pub auth: Arc<AuthService>,
    pub yt: Arc<YouTubeService>,
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
    let parsed = Url::parse(url.trim()).map_err(|e| format!("URL không hợp lệ: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Chỉ cho phép mở liên kết HTTPS".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    let path = parsed.path();
    let allowed = ((host == "www.google.com" || host == "google.com") && path.starts_with("/device"))
        || ((host == "yt.be" || host == "www.youtube.com" || host == "youtube.com")
            && (path.starts_with("/activate") || path.starts_with("/qr/activate")));
    if !allowed {
        return Err("Liên kết không nằm trong danh sách trang kích hoạt Google/YouTube".to_string());
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

            let yt_service = Arc::new(
                YouTubeService::new(Arc::clone(&auth_service))
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
            );

            let yt_for_proxy = Arc::clone(&yt_service);
            tauri::async_runtime::spawn(async move {
                proxy::start_proxy_server(yt_for_proxy).await;
            });

            app.manage(AppState {
                db: database,
                auth: auth_service,
                yt: yt_service,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_video_details,
            search_videos,
            get_trending_videos,
            get_video_comments,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tay Tube PC Tauri application");
}
