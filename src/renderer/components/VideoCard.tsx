import React from 'react';
import { Heart, Trash2 } from 'lucide-react';
import { ResumeItemUI } from '../types.js';

interface VideoCardProps {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationText?: string;
  viewCountText?: string;
  publishedText?: string;
  resumeInfo?: ResumeItemUI;
  isFavorite?: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onDeleteHistory?: (e: React.MouseEvent) => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  id,
  title,
  channel,
  thumbnail,
  durationText,
  viewCountText,
  publishedText,
  resumeInfo,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onDeleteHistory,
}) => {
  let progressPercent = 0;
  if (resumeInfo && resumeInfo.durationMs > 0) {
    progressPercent = Math.min(
      100,
      Math.max(0, (resumeInfo.positionMs / resumeInfo.durationMs) * 100)
    );
  }

  return (
    <div
      onClick={() => onSelect(id)}
      className="group flex flex-col bg-yt-card rounded-[8px] overflow-hidden cursor-pointer hover:bg-yt-hover transition-colors duration-150 border border-white/[0.04] hover:border-white/[0.12]"
    >
      {/* Thumbnail Container */}
      <div className="relative aspect-video w-full bg-black overflow-hidden">
        <img
          src={thumbnail}
          alt={title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
          }}
        />

        {/* Duration badge */}
        {durationText && (
          <span className="absolute bottom-2 right-2 bg-black/85 text-white text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-[6px]">
            {durationText}
          </span>
        )}

        {/* Watch Resume Progress Bar */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/20">
            <div
              className="h-full bg-yt-red"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Quick action buttons on hover */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex space-x-1">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`p-1.5 rounded-[8px] transition-colors ${
                isFavorite
                  ? 'bg-yt-red text-white'
                  : 'bg-black/80 hover:bg-black text-white'
              }`}
              title={isFavorite ? 'Bỏ thích' : 'Thêm vào yêu thích'}
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
            </button>
          )}
          {onDeleteHistory && (
            <button
              type="button"
              onClick={onDeleteHistory}
              className="p-1.5 rounded-[8px] bg-black/80 hover:bg-red-600 text-white transition-colors"
              title="Xóa khỏi lịch sử"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Video Metadata */}
      <div className="p-3 flex flex-col justify-between flex-1">
        <h3
          className="text-[13px] font-semibold text-yt-text line-clamp-2 leading-snug group-hover:text-white transition-colors"
          title={title}
        >
          {title}
        </h3>
        <div className="mt-2 text-xs text-yt-subtext space-y-0.5">
          <p className="hover:text-yt-text truncate font-medium">{channel}</p>
          <div className="flex items-center space-x-1.5 truncate text-[11px]">
            {viewCountText && <span>{viewCountText}</span>}
            {viewCountText && publishedText && <span>•</span>}
            {publishedText && <span>{publishedText}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
