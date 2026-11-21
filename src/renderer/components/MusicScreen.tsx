import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Clock,
  Check,
  ListPlus,
  Music,
  RefreshCw,
} from 'lucide-react';
import { desktopAPI } from '../api.js';
import { MusicShelf, MusicTrackItem, VideoItemUI } from '../types.js';

export type RepeatMode = 'off' | 'all' | 'one';

interface MusicScreenProps {
  currentTrack: MusicTrackItem | null;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  queue: MusicTrackItem[];
  favoritesSet: Set<string>;
  watchLaterSet: Set<string>;
  externalQuery?: string;
  onConsumeExternalQuery?: () => void;
  onPlayTrack: (track: MusicTrackItem, queueList?: MusicTrackItem[]) => void;
  onAddToQueue: (track: MusicTrackItem) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (sec: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleFavorite: (item: VideoItemUI) => void;
  onToggleWatchLater: (item: VideoItemUI) => void;
}

function formatMusicTime(sec: number): string {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const MusicScreen: React.FC<MusicScreenProps> = ({
  currentTrack,
  isPlaying,
  isLoadingTrack,
  currentTime,
  duration,
  shuffle,
  repeatMode,
  queue,
  favoritesSet,
  watchLaterSet,
  externalQuery,
  onConsumeExternalQuery,
  onPlayTrack,
  onAddToQueue,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onToggleShuffle,
  onCycleRepeat,
  onToggleFavorite,
  onToggleWatchLater,
}) => {
  const [shelves, setShelves] = useState<MusicShelf[]>([]);
  const [loadingHome, setLoadingHome] = useState<boolean>(true);
  const [searchInput, setSearchInput] = useState<string>('');
  const [activeQuery, setActiveQuery] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<'songs' | 'videos' | 'all'>('songs');
  const [searchResults, setSearchResults] = useState<MusicTrackItem[]>([]);
  const [searching, setSearching] = useState<boolean>(false);

  const loadHome = useCallback(async () => {
    setLoadingHome(true);
    try {
      const data = await desktopAPI.getMusicHome();
      setShelves(data || []);
    } catch {
      setShelves([]);
    } finally {
      setLoadingHome(false);
    }
  }, []);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  const runSearch = useCallback(
    async (q: string, filter: 'songs' | 'videos' | 'all') => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setActiveQuery(trimmed);
      setSearchInput(trimmed);
      setSearching(true);
      try {
        const res = await desktopAPI.searchMusic(trimmed, filter);
        setSearchResults(res || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    []
  );

  useEffect(() => {
    if (externalQuery && externalQuery.trim()) {
      runSearch(externalQuery.trim(), searchFilter);
      onConsumeExternalQuery?.();
    }
  }, [externalQuery, searchFilter, runSearch, onConsumeExternalQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(searchInput, searchFilter);
  };

  const toVideoItemUI = (t: MusicTrackItem): VideoItemUI => ({
    id: t.id,
    title: t.title,
    channel: t.artist,
    thumbnail: t.thumbnail,
    durationText: t.durationText,
    durationSec: t.durationSec,
  });

  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  return (
    <div className="h-full w-full overflow-y-auto p-4 lg:p-6 space-y-6 bg-yt-bg">
      {/* Top Bar: Music Search + Filter Chips */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-yt-border">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-[8px] bg-yt-red flex items-center justify-center flex-shrink-0">
            <Music className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">YouTube Music</h2>
            <p className="text-[11px] text-yt-subtext">
              Phát chỉ âm thanh (Audio-only) qua Chunked Proxy tiết kiệm GPU
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 flex-1 max-w-2xl justify-end">
          <div className="flex items-center flex-1 min-w-[220px]">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm bài hát, ca sĩ, album trên YouTube Music..."
              className="w-full bg-[#0d0d0d] border border-yt-border rounded-l-[8px] px-3 py-1.5 text-xs text-white placeholder-yt-subtext focus:outline-none focus:border-yt-red/70"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-yt-card hover:bg-yt-hover border border-l-0 border-yt-border rounded-r-[8px] text-yt-subtext hover:text-white transition-colors"
              title="Tìm nhạc"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center space-x-1">
            {(
              [
                { id: 'songs', label: 'Bài hát' },
                { id: 'videos', label: 'MV / Video' },
                { id: 'all', label: 'Tất cả' },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  setSearchFilter(chip.id);
                  if (activeQuery) runSearch(activeQuery, chip.id);
                }}
                className={`px-2.5 py-1.5 rounded-[7px] text-[11px] font-semibold border transition-colors ${
                  searchFilter === chip.id
                    ? 'bg-white text-black border-white'
                    : 'bg-yt-card text-yt-subtext hover:text-white border-yt-border'
                }`}
              >
                {chip.label}
              </button>
            ))}
            {activeQuery && (
              <button
                type="button"
                onClick={() => {
                  setActiveQuery('');
                  setSearchInput('');
                  setSearchResults([]);
                }}
                className="px-2.5 py-1.5 rounded-[7px] text-[11px] font-semibold bg-yt-card hover:bg-yt-hover text-yt-subtext hover:text-white border border-yt-border transition-colors"
              >
                Khám phá
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Now Playing Hero + Queue Panel */}
      {currentTrack && (
        <div className="bg-[#141414] border border-white/[0.08] rounded-[12px] p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Square Cover Art + Player Controls */}
          <div className="lg:col-span-7 flex flex-col sm:flex-row items-center sm:items-stretch gap-5">
            <img
              src={currentTrack.thumbnail}
              alt={currentTrack.title}
              className="w-40 h-40 sm:w-44 sm:h-44 rounded-[12px] object-cover border border-white/10 flex-shrink-0 bg-black"
            />
            <div className="flex flex-col justify-between flex-1 w-full min-w-0 space-y-3">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className="px-2 py-0.5 rounded-[5px] bg-yt-red/15 border border-yt-red/30 text-[10px] font-semibold text-yt-red uppercase">
                    Audio Mode
                  </span>
                  {isLoadingTrack && (
                    <span className="text-[11px] text-yt-subtext animate-pulse">
                      Đang nạp luồng âm thanh...
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-white truncate" title={currentTrack.title}>
                  {currentTrack.title}
                </h3>
                <p className="text-xs text-yt-subtext truncate mt-0.5">{currentTrack.artist}</p>
              </div>

              {/* Seek Bar */}
              <div className="space-y-1.5">
                <div
                  className="h-2.5 flex items-center cursor-pointer group"
                  onClick={(e) => {
                    if (duration <= 0) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    onSeek(r * duration);
                  }}
                >
                  <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yt-red"
                      style={{ width: `${progressRatio * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[11px] font-mono text-yt-subtext">
                  <span>{formatMusicTime(currentTime)}</span>
                  <span>{formatMusicTime(duration || currentTrack.durationSec)}</span>
                </div>
              </div>

              {/* Transport & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={onToggleShuffle}
                    className={`p-2 rounded-[8px] border transition-colors ${
                      shuffle
                        ? 'bg-yt-red/20 border-yt-red/40 text-yt-red'
                        : 'bg-yt-card hover:bg-yt-hover border-white/[0.06] text-yt-subtext hover:text-white'
                    }`}
                    title="Phát ngẫu nhiên"
                  >
                    <Shuffle className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onPrev}
                    className="p-2 rounded-[8px] bg-yt-card hover:bg-yt-hover border border-white/[0.06] text-white transition-colors"
                    title="Bài trước"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onTogglePlay}
                    className="w-10 h-10 rounded-full bg-white hover:bg-white/90 text-black flex items-center justify-center transition-colors"
                    title={isPlaying ? 'Tạm dừng' : 'Phát'}
                  >
                    {isPlaying ? (
                      <Pause className="w-5 h-5 fill-current" />
                    ) : (
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    className="p-2 rounded-[8px] bg-yt-card hover:bg-yt-hover border border-white/[0.06] text-white transition-colors"
                    title="Bài tiếp theo"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onCycleRepeat}
                    className={`p-2 rounded-[8px] border transition-colors ${
                      repeatMode !== 'off'
                        ? 'bg-yt-red/20 border-yt-red/40 text-yt-red'
                        : 'bg-yt-card hover:bg-yt-hover border-white/[0.06] text-yt-subtext hover:text-white'
                    }`}
                    title={`Lặp lại: ${repeatMode === 'one' ? '1 bài' : repeatMode === 'all' ? 'Danh sách' : 'Tắt'}`}
                  >
                    {repeatMode === 'one' ? (
                      <Repeat1 className="w-4 h-4" />
                    ) : (
                      <Repeat className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleWatchLater(toVideoItemUI(currentTrack))}
                    className={`p-2 rounded-[8px] border transition-colors ${
                      watchLaterSet.has(currentTrack.id)
                        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-yt-card hover:bg-yt-hover border-white/[0.06] text-yt-subtext hover:text-white'
                    }`}
                    title="Xem sau"
                  >
                    {watchLaterSet.has(currentTrack.id) ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(toVideoItemUI(currentTrack))}
                    className={`p-2 rounded-[8px] border transition-colors ${
                      favoritesSet.has(currentTrack.id)
                        ? 'bg-yt-red border-yt-red text-white'
                        : 'bg-yt-card hover:bg-yt-hover border-white/[0.06] text-yt-subtext hover:text-white'
                    }`}
                    title="Yêu thích"
                  >
                    <Heart
                      className={`w-4 h-4 ${favoritesSet.has(currentTrack.id) ? 'fill-current' : ''}`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Radio / Up Next Queue */}
          <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-yt-border pt-4 lg:pt-0 lg:pl-5 flex flex-col">
            <h4 className="text-xs font-bold uppercase tracking-wider text-yt-subtext mb-2.5">
              Tiếp theo trong danh sách ({queue.length})
            </h4>
            <div className="flex-1 max-h-48 overflow-y-auto space-y-1 pr-1">
              {queue.map((qItem) => {
                const isActive = qItem.id === currentTrack.id;
                return (
                  <div
                    key={qItem.id}
                    onClick={() => onPlayTrack(qItem, queue)}
                    className={`flex items-center space-x-2.5 p-1.5 rounded-[8px] cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-yt-hover border border-white/10'
                        : 'hover:bg-yt-card border border-transparent'
                    }`}
                  >
                    <img
                      src={qItem.thumbnail}
                      alt={qItem.title}
                      className="w-9 h-9 rounded-[6px] object-cover flex-shrink-0 bg-black"
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs font-semibold truncate ${
                          isActive ? 'text-yt-red' : 'text-white'
                        }`}
                      >
                        {qItem.title}
                      </p>
                      <p className="text-[11px] text-yt-subtext truncate">{qItem.artist}</p>
                    </div>
                    {qItem.durationText && (
                      <span className="text-[10px] font-mono text-yt-subtext pr-1">
                        {qItem.durationText}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Search Results View OR Home Shelves */}
      {activeQuery ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">
              Kết quả nhạc cho: "{activeQuery}"
            </h3>
            <span className="text-xs text-yt-subtext">
              {searching ? 'Đang tìm...' : `${searchResults.length} bài hát / video`}
            </span>
          </div>

          {searching ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-14 bg-yt-card rounded-[8px]" />
              ))}
            </div>
          ) : searchResults.length === 0 ? (
            <p className="text-xs text-yt-subtext py-8 text-center">
              Không tìm thấy kết quả phù hợp trên YouTube Music.
            </p>
          ) : (
            <div className="space-y-1.5">
              {searchResults.map((track) => {
                const active = currentTrack?.id === track.id;
                return (
                  <div
                    key={track.id}
                    onClick={() => onPlayTrack(track, searchResults)}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-[8px] border cursor-pointer transition-colors ${
                      active
                        ? 'bg-yt-hover border-white/15'
                        : 'bg-yt-card/70 hover:bg-yt-hover border-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        loading="lazy"
                        className="w-11 h-11 rounded-[8px] object-cover flex-shrink-0 bg-black"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-1.5">
                          <p
                            className={`text-sm font-semibold truncate ${
                              active ? 'text-yt-red' : 'text-white'
                            }`}
                          >
                            {track.title}
                          </p>
                          {track.explicit && (
                            <span className="px-1 py-0.2 bg-white/15 text-[9px] font-bold rounded text-white/90">
                              E
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-yt-subtext truncate">{track.artist}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {track.durationText && (
                        <span className="text-xs font-mono text-yt-subtext mr-2">
                          {track.durationText}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToQueue(track);
                        }}
                        className="p-2 rounded-[8px] bg-yt-bg/60 hover:bg-yt-bg text-yt-subtext hover:text-white transition-colors"
                        title="Thêm vào danh sách phát"
                      >
                        <ListPlus className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(toVideoItemUI(track));
                        }}
                        className={`p-2 rounded-[8px] transition-colors ${
                          favoritesSet.has(track.id)
                            ? 'text-yt-red bg-yt-red/15'
                            : 'bg-yt-bg/60 hover:bg-yt-bg text-yt-subtext hover:text-white'
                        }`}
                        title="Yêu thích"
                      >
                        <Heart
                          className={`w-4 h-4 ${favoritesSet.has(track.id) ? 'fill-current' : ''}`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : loadingHome ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-pulse">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-square bg-yt-hover rounded-[10px]" />
              <div className="h-3.5 bg-yt-hover rounded w-3/4" />
              <div className="h-3 bg-yt-hover rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : shelves.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-3 text-center">
          <p className="text-sm font-semibold text-white">Không tải được trang chủ YouTube Music</p>
          <button
            type="button"
            onClick={loadHome}
            className="flex items-center space-x-1.5 px-4 py-2 bg-yt-red hover:bg-red-700 text-white text-xs font-semibold rounded-[8px]"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Tải lại</span>
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {shelves.map((shelf, sIdx) => (
            <section key={`${shelf.title}-${sIdx}`} className="space-y-3">
              <h3 className="text-base font-bold text-white tracking-tight">{shelf.title}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {shelf.items.map((track) => {
                  const active = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id}
                      onClick={() => onPlayTrack(track, shelf.items)}
                      className={`group flex flex-col p-2.5 rounded-[10px] border cursor-pointer transition-colors duration-150 ${
                        active
                          ? 'bg-yt-hover border-yt-red/60'
                          : 'bg-yt-card hover:bg-yt-hover border-white/[0.04] hover:border-white/[0.12]'
                      }`}
                    >
                      <div className="relative aspect-square w-full rounded-[8px] overflow-hidden bg-black mb-2.5">
                        <img
                          src={track.thumbnail}
                          alt={track.title}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
                          }}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                        />
                        <div
                          className={`absolute inset-0 bg-black/35 flex items-center justify-center transition-opacity ${
                            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full bg-yt-red text-white flex items-center justify-center shadow-lg">
                            {active && isPlaying ? (
                              <Pause className="w-4 h-4 fill-current" />
                            ) : (
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            )}
                          </div>
                        </div>
                        {track.durationText && (
                          <span className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                            {track.durationText}
                          </span>
                        )}
                      </div>
                      <h4
                        className={`text-xs font-semibold line-clamp-1 ${
                          active ? 'text-yt-red' : 'text-white'
                        }`}
                        title={track.title}
                      >
                        {track.title}
                      </h4>
                      <p className="text-[11px] text-yt-subtext line-clamp-1 mt-0.5">
                        {track.artist}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
