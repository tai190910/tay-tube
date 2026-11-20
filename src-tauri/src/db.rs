use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub duration_sec: i64,
    pub watched_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInput {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    #[serde(default)]
    pub duration_sec: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeItem {
    pub id: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteItem {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub duration_sec: i64,
    pub added_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteInput {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    #[serde(default)]
    pub duration_sec: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Resolves `%APPDATA%\tay-tube-pc\taytube.db` on Windows so existing Electron SQLite history & favorites are preserved.
pub fn resolve_database_dir(fallback_app_data: Option<&Path>) -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let trimmed = appdata.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("tay-tube-pc");
        }
    }
    if let Some(dir) = fallback_app_data {
        return dir.to_path_buf();
    }
    PathBuf::from(".")
}

pub struct AppDatabase {
    conn: Mutex<Connection>,
}

impl AppDatabase {
    pub fn open(user_data_dir: &Path) -> Result<Self, String> {
        if !user_data_dir.exists() {
            std::fs::create_dir_all(user_data_dir)
                .map_err(|e| format!("Failed to create app data dir: {e}"))?;
        }

        let db_path = user_data_dir.join("taytube.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open SQLite database at {:?}: {e}", db_path))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                channel TEXT NOT NULL,
                thumbnail TEXT NOT NULL,
                durationSec INTEGER NOT NULL,
                watchedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_watchedAt ON history(watchedAt DESC);

            CREATE TABLE IF NOT EXISTS resume (
                id TEXT PRIMARY KEY,
                positionMs INTEGER NOT NULL,
                durationMs INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS favorites (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                channel TEXT NOT NULL,
                thumbnail TEXT NOT NULL,
                durationSec INTEGER NOT NULL,
                addedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_favorites_addedAt ON favorites(addedAt DESC);
            ",
        )
        .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;
        Ok(())
    }

    pub fn get_history(&self, limit: i64) -> Result<Vec<HistoryItem>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, title, channel, thumbnail, durationSec, watchedAt FROM history ORDER BY watchedAt DESC LIMIT ?1")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    channel: row.get(2)?,
                    thumbnail: row.get(3)?,
                    duration_sec: row.get(4)?,
                    watched_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item.map_err(|e| e.to_string())?);
        }
        Ok(list)
    }

    pub fn add_to_history(&self, item: HistoryInput) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        conn.execute(
            "
            INSERT INTO history (id, title, channel, thumbnail, durationSec, watchedAt)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                channel = excluded.channel,
                thumbnail = excluded.thumbnail,
                durationSec = excluded.durationSec,
                watchedAt = excluded.watchedAt;
            ",
            params![
                item.id,
                item.title,
                item.channel,
                item.thumbnail,
                item.duration_sec,
                now_ms()
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        conn.execute("DELETE FROM history", []).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_history_item(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_resume(&self, id: &str) -> Result<Option<ResumeItem>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        conn.query_row(
            "SELECT id, positionMs, durationMs, updatedAt FROM resume WHERE id = ?1",
            params![id],
            |row| {
                Ok(ResumeItem {
                    id: row.get(0)?,
                    position_ms: row.get(1)?,
                    duration_ms: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn get_all_resumes(&self) -> Result<HashMap<String, ResumeItem>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, positionMs, durationMs, updatedAt FROM resume")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ResumeItem {
                    id: row.get(0)?,
                    position_ms: row.get(1)?,
                    duration_ms: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for r in rows {
            let item = r.map_err(|e| e.to_string())?;
            map.insert(item.id.clone(), item);
        }
        Ok(map)
    }

    pub fn save_resume(&self, id: &str, position_ms: i64, duration_ms: i64) -> Result<(), String> {
        const EDGE_MS: i64 = 10_000;
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;

        if position_ms < EDGE_MS || (duration_ms > 0 && position_ms > duration_ms - EDGE_MS) {
            conn.execute("DELETE FROM resume WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            return Ok(());
        }

        conn.execute(
            "
            INSERT INTO resume (id, positionMs, durationMs, updatedAt)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                positionMs = excluded.positionMs,
                durationMs = excluded.durationMs,
                updatedAt = excluded.updatedAt;
            ",
            params![id, position_ms, duration_ms, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_favorites(&self) -> Result<Vec<FavoriteItem>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, title, channel, thumbnail, durationSec, addedAt FROM favorites ORDER BY addedAt DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(FavoriteItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    channel: row.get(2)?,
                    thumbnail: row.get(3)?,
                    duration_sec: row.get(4)?,
                    added_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item.map_err(|e| e.to_string())?);
        }
        Ok(list)
    }

    pub fn is_favorite(&self, id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM favorites WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(exists.is_some())
    }

    pub fn toggle_favorite(&self, item: FavoriteInput) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned".to_string())?;
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM favorites WHERE id = ?1",
                params![item.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if exists.is_some() {
            conn.execute("DELETE FROM favorites WHERE id = ?1", params![item.id])
                .map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            conn.execute(
                "INSERT INTO favorites (id, title, channel, thumbnail, durationSec, addedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    item.id,
                    item.title,
                    item.channel,
                    item.thumbnail,
                    item.duration_sec,
                    now_ms()
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(true)
        }
    }
}
