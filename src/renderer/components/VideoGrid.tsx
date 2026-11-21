import React from 'react';
import { VideoCard } from './VideoCard.js';
import { Trash2 } from 'lucide-react';
import { ResumeItemUI } from '../types.js';

interface VideoGridItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationText?: string;
  durationSec?: number;
  viewCountText?: string;
  publishedText?: string;
  percentWatched?: number;
}

interface VideoGridProps {
  title: string;
  subtitle?: string;
  items: VideoGridItem[];
  loading?: boolean;
  resumes?: Record<string, ResumeItemUI>;
  favoritesSet?: Set<string>;
  watchLaterSet?: Set<string>;
  onSelectVideo: (id: string) => void;
  onToggleFavorite?: (item: VideoGridItem) => void;
  onToggleWatchLater?: (item: VideoGridItem) => void;
  onClearHistory?: () => void;
  onDeleteHistoryItem?: (id: string) => void;
  showClearHistory?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
  emptyAction?: { label: string; onClick: () => void };
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  title,
  subtitle,
  items,
  loading = false,
  resumes = {},
  favoritesSet = new Set(),
  watchLaterSet = new Set(),
  onSelectVideo,
  onToggleFavorite,
  onToggleWatchLater,
  onClearHistory,
  onDeleteHistoryItem,
  showClearHistory = false,
  emptyTitle = 'Chưa có video nào ở đây',
  emptySubtitle = 'Hãy thử tìm kiếm từ khóa hoặc khám phá video thịnh hành.',
  emptyAction,
}) => {
  return (
    <div className="h-full w-full overflow-y-auto p-4 lg:p-6 space-y-6">
      {/* Title & Action Row */}
      <div className="flex items-center justify-between pb-3 border-b border-yt-border">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-yt-subtext mt-0.5">{subtitle}</p>}
        </div>
        {showClearHistory && items.length > 0 && onClearHistory && (
          <button
            onClick={onClearHistory}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-yt-subtext hover:text-red-400 bg-yt-card hover:bg-yt-hover rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa lịch sử</span>
          </button>
        )}
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="flex flex-col space-y-2 animate-pulse">
              <div className="aspect-video bg-yt-hover rounded-xl w-full" />
              <div className="h-4 bg-yt-hover rounded w-3/4" />
              <div className="h-3 bg-yt-hover rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <p className="text-base font-semibold text-white">{emptyTitle}</p>
          <p className="text-xs text-yt-subtext max-w-md">{emptySubtitle}</p>
          {emptyAction && (
            <button
              type="button"
              onClick={emptyAction.onClick}
              className="mt-2 px-4 py-2 min-h-[44px] bg-yt-red hover:bg-red-700 text-white text-xs font-semibold rounded-[8px] transition-colors"
            >
              {emptyAction.label}
            </button>
          )}
        </div>
      )}

      {/* Grid of Video Cards */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((item) => (
            <VideoCard
              key={item.id}
              id={item.id}
              title={item.title}
              channel={item.channel}
              thumbnail={item.thumbnail}
              durationText={item.durationText}
              viewCountText={item.viewCountText}
              publishedText={item.publishedText}
              resumeInfo={resumes[item.id]}
              percentWatched={item.percentWatched}
              isFavorite={favoritesSet.has(item.id)}
              isWatchLater={watchLaterSet.has(item.id)}
              onSelect={onSelectVideo}
              onToggleFavorite={
                onToggleFavorite
                  ? (e) => {
                      e.stopPropagation();
                      onToggleFavorite(item);
                    }
                  : undefined
              }
              onToggleWatchLater={
                onToggleWatchLater
                  ? (e) => {
                      e.stopPropagation();
                      onToggleWatchLater(item);
                    }
                  : undefined
              }
              onDeleteHistory={
                onDeleteHistoryItem
                  ? (e) => {
                      e.stopPropagation();
                      onDeleteHistoryItem(item.id);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};
