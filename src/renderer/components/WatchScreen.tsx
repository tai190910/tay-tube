import React, { useState, useEffect, useRef } from 'react';
import { Heart, ThumbsUp, Eye, Calendar, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { AvSyncPlayer } from './AvSyncPlayer.js';
import { CommentsList } from './CommentsList.js';
import { desktopAPI } from '../api.js';
import { CommentUI, RelatedVideoItem, TayTubeVideoDetails } from '../types.js';

interface WatchScreenProps {
  videoId: string;
  initialPositionSec?: number;
  onBack: () => void;
  onSelectRelated: (id: string) => void;
  onRegisterCleanup?: (cleanupFn: () => void) => void;
}

export const WatchScreen: React.FC<WatchScreenProps> = ({
  videoId,
  initialPositionSec = 0,
  onBack,
  onSelectRelated,
  onRegisterCleanup,
}) => {
  const [details, setDetails] = useState<TayTubeVideoDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Theater Mode
  const [isTheater, setIsTheater] = useState<boolean>(false);

  // Description collapse
  const [isDescExpanded, setIsDescExpanded] = useState<boolean>(false);

  // Favorite state
  const [isFavorite, setIsFavorite] = useState<boolean>(false);

  // Tabs: 'related' | 'comments'
  const [activeTab, setActiveTab] = useState<'related' | 'comments'>('related');

  // Comments state
  const [comments, setComments] = useState<CommentUI[]>([]);
  const [commentsCount, setCommentsCount] = useState<number>(0);
  const [commentsLoading, setCommentsLoading] = useState<boolean>(false);

  // 1. Fetch Video Details & Stream URLs
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);
    setDetails(null);

    // Check favorite status
    desktopAPI.isFavorite(videoId).then((fav) => {
      if (!isCancelled) setIsFavorite(fav);
    });

    desktopAPI
      .getVideoDetails(videoId, { targetQuality: 1080, preferHdr: true })
      .then((data: TayTubeVideoDetails) => {
        if (!isCancelled) {
          setDetails(data);
          setLoading(false);

          // Save to Watch History immediately on view
          desktopAPI.addToHistory({
            id: data.id,
            title: data.title,
            channel: data.channel,
            thumbnail: data.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
            durationSec: data.durationSec,
          });
        }
      })
      .catch((err: any) => {
        if (!isCancelled) {
          setError(err.message || 'Không thể tải video. Vui lòng thử lại.');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [videoId]);

  // 2. Fetch comments when Comments tab is selected or video loads
  useEffect(() => {
    if (activeTab === 'comments' && comments.length === 0) {
      setCommentsLoading(true);
      desktopAPI
        .getVideoComments(videoId)
        .then((res) => {
          setComments(res.comments || []);
          setCommentsCount(res.totalCount || 0);
          setCommentsLoading(false);
        })
        .catch(() => {
          setCommentsLoading(false);
        });
    }
  }, [videoId, activeTab, comments.length]);

  // 3. Toggle Favorite
  const handleToggleFavorite = async () => {
    if (!details) return;
    const nowFav = await desktopAPI.toggleFavorite({
      id: details.id,
      title: details.title,
      channel: details.channel,
      thumbnail: details.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${details.id}/hqdefault.jpg`,
      durationSec: details.durationSec,
    });
    setIsFavorite(nowFav);
  };

  // 4. Save Resume Position periodically (Throttled to at most once per 5 seconds to prevent Main Thread SQLite disk lock)
  const lastSavedResumeMs = useRef<number>(0);
  const handleTimeUpdate = (posMs: number, durMs: number) => {
    if (Math.abs(posMs - lastSavedResumeMs.current) >= 5000) {
      lastSavedResumeMs.current = posMs;
      desktopAPI.saveResume(videoId, posMs, durMs);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full space-y-4">
        <div className="w-12 h-12 border-4 border-yt-red border-t-transparent rounded-full animate-spin" />
        <p className="text-yt-subtext text-sm animate-pulse">Đang trích xuất luồng video mượt mà...</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full space-y-4 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-950/60 flex items-center justify-center text-yt-red text-2xl font-bold">
          !
        </div>
        <h2 className="text-lg font-bold text-white">Không thể phát video</h2>
        <p className="text-yt-subtext text-sm max-w-md">{error}</p>
        <button
          onClick={onBack}
          className="mt-4 px-5 py-2 bg-yt-hover hover:bg-yt-border rounded-xl text-sm font-semibold transition-colors"
        >
          Quay lại trang chủ
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto p-4 lg:p-5 space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center space-x-2 text-yt-subtext hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-[8px] bg-yt-card hover:bg-yt-hover border border-white/[0.05] transition-colors duration-150 w-fit"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Quay lại</span>
      </button>

      {/* Main Layout: Theater Mode or Two-Column */}
      <div className={`flex flex-col ${isTheater ? 'space-y-5' : 'lg:flex-row lg:space-x-5 lg:space-y-0'}`}>
        {/* Left / Main Player Column */}
        <div className={`flex-1 flex flex-col space-y-4 ${isTheater ? 'w-full' : 'lg:w-[70%]'}`}>
          {/* Custom AvSync Player */}
          <AvSyncPlayer
            details={details}
            initialPositionSec={initialPositionSec}
            onTimeUpdate={handleTimeUpdate}
            isTheater={isTheater}
            onToggleTheater={() => setIsTheater((prev) => !prev)}
            onRegisterCleanup={onRegisterCleanup}
          />

          {/* Video Metadata Header */}
          <div className="flex flex-col space-y-3">
            <h1 className="text-base md:text-lg font-bold text-white leading-snug">
              {details.title}
            </h1>

            {/* Author info & Actions Row */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-yt-border">
              {/* Channel */}
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-[8px] bg-yt-hover border border-white/10 flex items-center justify-center font-bold text-sm text-white">
                  {details.channel.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-white hover:text-yt-red transition-colors">
                    {details.channel}
                  </h3>
                  <p className="text-xs text-yt-subtext">
                    {parseInt(details.viewCount, 10).toLocaleString()} lượt xem
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                {/* Favorite Button */}
                <button
                  type="button"
                  onClick={handleToggleFavorite}
                  className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-[8px] text-xs font-semibold border transition-colors duration-150 ${
                    isFavorite
                      ? 'bg-yt-red text-white border-yt-red'
                      : 'bg-yt-card hover:bg-yt-hover text-yt-text border-white/[0.07]'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
                  <span>{isFavorite ? 'Đã thích' : 'Yêu thích'}</span>
                </button>
              </div>
            </div>

            {/* Expandable Description */}
            {details.description && (
              <div
                onClick={() => setIsDescExpanded(!isDescExpanded)}
                className="bg-yt-card hover:bg-yt-hover p-3.5 rounded-[8px] border border-white/[0.05] cursor-pointer transition-colors duration-150 text-xs text-yt-text leading-relaxed select-text"
              >
                <p className={isDescExpanded ? 'whitespace-pre-wrap' : 'line-clamp-3 whitespace-pre-wrap'}>
                  {details.description}
                </p>
                <div className="mt-2 font-semibold text-white flex items-center space-x-1">
                  <span>{isDescExpanded ? 'Thu gọn' : 'Xem thêm'}</span>
                  {isDescExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right / Secondary Column: Related Videos & Comments Tabs */}
        <div className={`flex flex-col space-y-3 ${isTheater ? 'w-full lg:max-w-4xl mx-auto' : 'lg:w-[30%]'}`}>
          {/* Tab buttons */}
          <div className="flex items-center space-x-1.5 border-b border-yt-border pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('related')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-[8px] transition-colors duration-150 ${
                activeTab === 'related'
                  ? 'bg-yt-hover text-white border border-white/10'
                  : 'text-yt-subtext hover:text-white hover:bg-yt-card'
              }`}
            >
              Video đề xuất ({details.relatedVideos.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('comments')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-[8px] transition-colors duration-150 ${
                activeTab === 'comments'
                  ? 'bg-yt-hover text-white border border-white/10'
                  : 'text-yt-subtext hover:text-white hover:bg-yt-card'
              }`}
            >
              Bình luận
            </button>
          </div>

          {/* Related Videos List */}
          {activeTab === 'related' && (
            <div className="flex flex-col space-y-2">
              {details.relatedVideos.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectRelated(item.id)}
                  className="flex space-x-2.5 p-2 rounded-[8px] bg-yt-card/60 hover:bg-yt-hover border border-transparent hover:border-white/[0.08] cursor-pointer group transition-colors duration-150"
                >
                  <div className="relative w-36 aspect-video bg-black rounded-[6px] overflow-hidden flex-shrink-0">
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                    />
                    {item.durationText && (
                      <span className="absolute bottom-1 right-1 bg-black/85 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-[4px] text-white">
                        {item.durationText}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col justify-start flex-1 min-w-0 pr-1">
                    <h4 className="text-xs font-semibold text-yt-text line-clamp-2 leading-snug group-hover:text-white transition-colors">
                      {item.title}
                    </h4>
                    <p className="text-[11px] text-yt-subtext mt-1 truncate">{item.channel}</p>
                    {item.viewCountText && (
                      <p className="text-[10px] text-yt-subtext truncate">{item.viewCountText}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Comments List */}
          {activeTab === 'comments' && (
            <CommentsList
              comments={comments}
              totalCount={commentsCount}
              loading={commentsLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
};
