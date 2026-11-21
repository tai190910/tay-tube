import { invoke } from '@tauri-apps/api/core';
import {
  AuthAccountProfile,
  CommentsResult,
  DeviceAuthPollResult,
  DeviceAuthStartResult,
  FavoriteItemUI,
  HistoryItemUI,
  MusicAudioStreamResult,
  MusicShelf,
  MusicTrackItem,
  ResumeItemUI,
  ShortsFeedResult,
  TayTubeVideoDetails,
  VideoItemUI,
} from './types.js';

export const desktopAPI = {
  // Auth (Google Device OAuth2 + Token Refresh)
  getAuthAccount: (): Promise<AuthAccountProfile | null> =>
    invoke<AuthAccountProfile | null>('auth_get_account'),

  startDeviceAuth: (): Promise<DeviceAuthStartResult> =>
    invoke<DeviceAuthStartResult>('auth_start_device'),

  pollDeviceAuth: (deviceCode: string): Promise<DeviceAuthPollResult> =>
    invoke<DeviceAuthPollResult>('auth_poll_device', { deviceCode }),

  refreshAuthToken: (): Promise<AuthAccountProfile> =>
    invoke<AuthAccountProfile>('auth_refresh_token'),

  signOut: (): Promise<void> => invoke<void>('auth_sign_out'),

  openExternalUrl: (url: string): Promise<void> =>
    invoke<void>('open_external_url', { url }),

  // Video Core & Authenticated InnerTube APIs
  getVideoDetails: (
    urlOrId: string,
    options?: { targetQuality?: number; preferHdr?: boolean; mode?: 'video' | 'audio' }
  ): Promise<TayTubeVideoDetails> =>
    invoke<TayTubeVideoDetails>('get_video_details', { urlOrId, options }),

  searchVideos: (query: string): Promise<VideoItemUI[]> =>
    invoke<VideoItemUI[]>('search_videos', { query }),

  getTrendingVideos: (): Promise<VideoItemUI[]> =>
    invoke<VideoItemUI[]>('get_trending_videos'),

  getHomeVideos: (): Promise<VideoItemUI[]> =>
    invoke<VideoItemUI[]>('get_home_videos'),

  getSubscriptionsVideos: (): Promise<VideoItemUI[]> =>
    invoke<VideoItemUI[]>('get_subscriptions_videos'),

  getYouTubeHistory: (): Promise<VideoItemUI[]> =>
    invoke<VideoItemUI[]>('get_youtube_history'),

  getWatchLaterVideos: (): Promise<VideoItemUI[]> =>
    invoke<VideoItemUI[]>('get_watch_later_videos'),

  addToWatchLater: (videoId: string): Promise<boolean> =>
    invoke<boolean>('add_to_watch_later', { videoId }),

  removeFromWatchLater: (videoId: string): Promise<boolean> =>
    invoke<boolean>('remove_from_watch_later', { videoId }),

  syncWatchProgress: (
    videoId: string,
    positionSec: number,
    durationSec: number
  ): Promise<void> =>
    invoke<void>('sync_watch_progress', { videoId, positionSec, durationSec }),

  getVideoComments: (videoId: string): Promise<CommentsResult> =>
    invoke<CommentsResult>('get_video_comments', { videoId }),

  // YouTube Shorts APIs
  getShortsFeed: (continuation?: string | null): Promise<ShortsFeedResult> =>
    invoke<ShortsFeedResult>('get_shorts_feed', { continuation: continuation || null }),

  rateVideo: (videoId: string, like: boolean): Promise<boolean> =>
    invoke<boolean>('rate_video', { videoId, like }),

  // YouTube Music APIs (WEB_REMIX + audio-only proxy stream)
  getMusicHome: (): Promise<MusicShelf[]> => invoke<MusicShelf[]>('get_music_home'),

  searchMusic: (query: string, filter?: 'songs' | 'videos' | 'all'): Promise<MusicTrackItem[]> =>
    invoke<MusicTrackItem[]>('search_music', { query, filter: filter || 'songs' }),

  getMusicRadio: (videoId: string, playlistId?: string | null): Promise<MusicTrackItem[]> =>
    invoke<MusicTrackItem[]>('get_music_radio', {
      videoId,
      playlistId: playlistId || null,
    }),

  getMusicAudioStream: (
    videoId: string,
    playlistId?: string | null
  ): Promise<MusicAudioStreamResult> =>
    invoke<MusicAudioStreamResult>('get_music_audio_stream', {
      videoId,
      playlistId: playlistId || null,
    }),

  // SQLite Database APIs (rusqlite bundled in Tauri backend)
  getHistory: (limit = 100): Promise<HistoryItemUI[]> =>
    invoke<HistoryItemUI[]>('db_get_history', { limit }),

  addToHistory: (item: {
    id: string;
    title: string;
    channel: string;
    thumbnail: string;
    durationSec: number;
  }): Promise<void> => invoke<void>('db_add_to_history', { item }),

  clearHistory: (): Promise<void> => invoke<void>('db_clear_history'),

  deleteHistoryItem: (id: string): Promise<void> =>
    invoke<void>('db_delete_history_item', { id }),

  getResume: (id: string): Promise<ResumeItemUI | null> =>
    invoke<ResumeItemUI | null>('db_get_resume', { id }),

  getAllResumes: (): Promise<Record<string, ResumeItemUI>> =>
    invoke<Record<string, ResumeItemUI>>('db_get_all_resumes'),

  saveResume: (id: string, positionMs: number, durationMs: number): Promise<void> =>
    invoke<void>('db_save_resume', { id, positionMs, durationMs }),

  getFavorites: (): Promise<FavoriteItemUI[]> =>
    invoke<FavoriteItemUI[]>('db_get_favorites'),

  isFavorite: (id: string): Promise<boolean> =>
    invoke<boolean>('db_is_favorite', { id }),

  toggleFavorite: (item: {
    id: string;
    title: string;
    channel: string;
    thumbnail: string;
    durationSec: number;
  }): Promise<boolean> => invoke<boolean>('db_toggle_favorite', { item }),

  // Native Window Controls
  minimizeWindow: (): Promise<void> => invoke<void>('window_minimize'),
  maximizeWindow: (): Promise<void> => invoke<void>('window_toggle_maximize'),
  closeWindow: (): Promise<void> => invoke<void>('window_close'),
  toggleFullscreen: (): Promise<boolean> => invoke<boolean>('window_toggle_fullscreen'),
  isFullscreen: (): Promise<boolean> => invoke<boolean>('window_is_fullscreen'),
};
