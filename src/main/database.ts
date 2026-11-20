import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export interface HistoryItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec: number;
  watchedAt: number;
}

export interface ResumeItem {
  id: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

export interface FavoriteItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec: number;
  addedAt: number;
}

export class AppDatabase {
  private db: Database.Database;

  constructor(userDataPath: string) {
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const dbPath = path.join(userDataPath, 'taytube.db');
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.pragma('journal_mode = WAL');

    // History table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        thumbnail TEXT NOT NULL,
        durationSec INTEGER NOT NULL,
        watchedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_watchedAt ON history(watchedAt DESC);
    `);

    // Resume position table (ported from Resume.kt)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resume (
        id TEXT PRIMARY KEY,
        positionMs INTEGER NOT NULL,
        durationMs INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    // Favorites / Subscriptions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        thumbnail TEXT NOT NULL,
        durationSec INTEGER NOT NULL,
        addedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_favorites_addedAt ON favorites(addedAt DESC);
    `);
  }

  // History operations
  getHistory(limit = 100): HistoryItem[] {
    const stmt = this.db.prepare('SELECT * FROM history ORDER BY watchedAt DESC LIMIT ?');
    return stmt.all(limit) as HistoryItem[];
  }

  addToHistory(item: Omit<HistoryItem, 'watchedAt'>) {
    const stmt = this.db.prepare(`
      INSERT INTO history (id, title, channel, thumbnail, durationSec, watchedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        channel = excluded.channel,
        thumbnail = excluded.thumbnail,
        durationSec = excluded.durationSec,
        watchedAt = excluded.watchedAt;
    `);
    stmt.run(item.id, item.title, item.channel, item.thumbnail, item.durationSec, Date.now());
  }

  clearHistory() {
    this.db.prepare('DELETE FROM history').run();
  }

  deleteHistoryItem(id: string) {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(id);
  }

  // Resume operations (Resume.kt logic: edge 10s ignored)
  getResume(id: string): ResumeItem | null {
    const stmt = this.db.prepare('SELECT * FROM resume WHERE id = ?');
    const row = stmt.get(id) as ResumeItem | undefined;
    return row || null;
  }

  getAllResumes(): Record<string, ResumeItem> {
    const stmt = this.db.prepare('SELECT * FROM resume');
    const rows = stmt.all() as ResumeItem[];
    const map: Record<string, ResumeItem> = {};
    for (const r of rows) {
      map[r.id] = r;
    }
    return map;
  }

  saveResume(id: string, positionMs: number, durationMs: number) {
    const EDGE_MS = 10_000;
    // If watched almost to end or at very beginning, remove resume record
    if (positionMs < EDGE_MS || (durationMs > 0 && positionMs > durationMs - EDGE_MS)) {
      this.db.prepare('DELETE FROM resume WHERE id = ?').run(id);
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO resume (id, positionMs, durationMs, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        positionMs = excluded.positionMs,
        durationMs = excluded.durationMs,
        updatedAt = excluded.updatedAt;
    `);
    stmt.run(id, positionMs, durationMs, Date.now());
  }

  // Favorites operations
  getFavorites(): FavoriteItem[] {
    const stmt = this.db.prepare('SELECT * FROM favorites ORDER BY addedAt DESC');
    return stmt.all() as FavoriteItem[];
  }

  isFavorite(id: string): boolean {
    const stmt = this.db.prepare('SELECT id FROM favorites WHERE id = ?');
    return Boolean(stmt.get(id));
  }

  toggleFavorite(item: Omit<FavoriteItem, 'addedAt'>): boolean {
    if (this.isFavorite(item.id)) {
      this.db.prepare('DELETE FROM favorites WHERE id = ?').run(item.id);
      return false;
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO favorites (id, title, channel, thumbnail, durationSec, addedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(item.id, item.title, item.channel, item.thumbnail, item.durationSec, Date.now());
      return true;
    }
  }
}
