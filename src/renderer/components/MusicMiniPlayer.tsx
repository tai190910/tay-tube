import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { MusicTrackItem } from '../types.js';
import { RepeatMode } from './MusicScreen.js';

interface MusicMiniPlayerProps {
  track: MusicTrackItem;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  onOpenMusic: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (sec: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onClose: () => void;
}

function formatSec(sec: number): string {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const MusicMiniPlayer: React.FC<MusicMiniPlayerProps> = ({
  track,
  isPlaying,
  isLoading,
  currentTime,
  duration,
  volume,
  isMuted,
  shuffle,
  repeatMode,
  onOpenMusic,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onClose,
}) => {
  const safeDur = duration > 0 ? duration : track.durationSec || 1;
  const pct = Math.min(100, Math.max(0, (currentTime / safeDur) * 100));

  return (
    <div className="relative h-16 bg-[#121212] border-t border-white/10 px-4 flex items-center justify-between gap-4 z-50 flex-shrink-0 select-none">
      {/* Top Edge Interactive Progress Bar */}
      <div
        className="absolute -top-1 left-0 right-0 h-2 cursor-pointer group flex items-end"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || safeDur <= 0) return;
          const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onSeek(r * safeDur);
        }}
        title="Nhấn để tua bài hát"
      >
        <div className="w-full h-[2px] group-hover:h-1 bg-white/15 transition-[height]">
          <div className="h-full bg-yt-red" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Left: Square Cover & Track Info */}
      <button
        type="button"
        onClick={onOpenMusic}
        className="flex items-center space-x-3 min-w-0 flex-1 max-w-xs text-left hover:bg-yt-card/70 p-1 -ml-1 rounded-[8px] transition-colors"
        title="Mở giao diện YouTube Music"
      >
        <img
          src={track.thumbnail}
          alt={track.title}
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
          }}
          className="w-11 h-11 rounded-[8px] object-cover flex-shrink-0 border border-white/10 bg-black"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white truncate">{track.title}</p>
          <p className="text-[11px] text-yt-subtext truncate">
            {isLoading ? 'Đang nạp âm thanh...' : track.artist}
          </p>
        </div>
      </button>

      {/* Center: Playback Controls & Time */}
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onToggleShuffle}
          className={`p-1.5 rounded-[7px] transition-colors ${
            shuffle ? 'text-yt-red bg-yt-red/15' : 'text-yt-subtext hover:text-white'
          }`}
          title="Ngẫu nhiên"
        >
          <Shuffle className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onPrev}
          className="p-2 rounded-[7px] text-yt-subtext hover:text-white hover:bg-yt-hover transition-colors"
          title="Bài trước"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="w-9 h-9 rounded-full bg-white hover:bg-white/90 text-black flex items-center justify-center transition-colors"
          title={isPlaying ? 'Tạm dừng' : 'Phát'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="p-2 rounded-[7px] text-yt-subtext hover:text-white hover:bg-yt-hover transition-colors"
          title="Bài tiếp theo"
        >
          <SkipForward className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCycleRepeat}
          className={`p-1.5 rounded-[7px] transition-colors ${
            repeatMode !== 'off' ? 'text-yt-red bg-yt-red/15' : 'text-yt-subtext hover:text-white'
          }`}
          title={`Lặp lại: ${repeatMode === 'one' ? '1 bài' : repeatMode === 'all' ? 'Danh sách' : 'Tắt'}`}
        >
          {repeatMode === 'one' ? (
            <Repeat1 className="w-3.5 h-3.5" />
          ) : (
            <Repeat className="w-3.5 h-3.5" />
          )}
        </button>

        <span className="hidden md:inline-block text-[11px] font-mono text-yt-subtext pl-2">
          {formatSec(currentTime)} / {formatSec(safeDur)}
        </span>
      </div>

      {/* Right: Volume & Dismiss */}
      <div className="flex items-center space-x-2 flex-1 max-w-xs justify-end">
        <button
          type="button"
          onClick={onToggleMute}
          className="p-1.5 rounded-[7px] text-yt-subtext hover:text-white hover:bg-yt-hover transition-colors"
          title={isMuted ? 'Bật tiếng' : 'Tắt tiếng'}
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={isMuted ? 0 : volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="hidden sm:block w-20 accent-yt-red cursor-pointer"
          aria-label="Âm lượng nhạc"
        />
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-[8px] text-yt-subtext hover:text-white hover:bg-red-600/80 transition-colors"
          title="Đóng trình phát nhạc"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
