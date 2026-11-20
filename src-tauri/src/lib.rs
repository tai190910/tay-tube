pub mod db;
pub mod proxy;
pub mod youtube;

use db::{resolve_database_dir, AppDatabase, FavoriteInput, FavoriteItem, HistoryInput, HistoryItem, ResumeItem};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};
use youtube::{CommentsResult, SearchVideoItem, TayTubeVideoDetails, YouTubeService};

pub struct AppState {
    pub db: Arc<AppDatabase>,
    pub yt: Arc<YouTubeService>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetailsOptions {
    pub target_quality: Option<i64>,
    pub prefer_hdr: Option<bool>,
}

#[tauri::command]
async fn get_video_details(
    state: State<'_, AppState>,
    url_or_id: String,
    options: Option<VideoDetailsOptions>,
) -> Result<TayTubeVideoDetails, String> {
    let target_q = options.as_ref().and_then(|o| o.target_quality);
    let pref_hdr = options.as_ref().and_then(|o| o.prefer_hdr);
    state.yt.get_video_details(&url_or_id, target_q, pref_hdr).await
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

            let yt_service = Arc::new(
                YouTubeService::new()
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
            );

            let yt_for_proxy = Arc::clone(&yt_service);
            tauri::async_runtime::spawn(async move {
                proxy::start_proxy_server(yt_for_proxy).await;
            });

            app.manage(AppState {
                db: database,
                yt: yt_service,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_video_details,
            search_videos,
            get_trending_videos,
            get_video_comments,
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
