import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Heart,
  Clock,
  Check,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from 'lucide-react';
import { AvSyncPlayer, PlayerSeekController } from './AvSyncPlayer.js';
import { CommentsList } from './CommentsList.js';
import { desktopAPI } from '../api.js';
import {
  tokenizeDescriptionLine,
  extractChaptersFromDescription,
  extractYouTubeLinkTarget,
} from '../utils/descriptionParser.js';
import {
  CommentUI,
  RelatedVideoItem,
  TayTubeVideoDetails,
  VideoItemUI,
} from '../types.js';

interface WatchScreenProps {
  videoId: string;
  initialPositionSec?: number;
  onBack: () => void;
  onSelectRelated: (id: string) => void;
  onRegisterCleanup?: (cleanupFn: () => void) => void;
  isSignedIn?: boolean;
  isWatchLater?: boolean;
  onToggleWatchLater?: (item: VideoItemUI) => Promise<void> | void;
  onOpenSignIn?: () => void;
  isPipMode?: boolean;
  onTogglePip?: () => void;
  onExitPip?: () => void;
  onClosePip?: () => void;
}

export const WatchScreen: React.FC<WatchScreenProps> = ({
  videoId,
  initialPositionSec = 0,
  onBack,
  onSelectRelated,
  onRegisterCleanup,
  isSignedIn = false,
  isWatchLater = false,
  onToggleWatchLater,
  onOpenSignIn,
  isPipMode = false,
  onTogglePip,
  onExitPip,
  onClosePip,
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

  // Related videos + infinite continuation state
  const [relatedVideos, setRelatedVideos] = useState<RelatedVideoItem[]>([]);
  const [relatedContinuation, setRelatedContinuation] = useState<string | null>(null);
  const [loadingMoreRelated, setLoadingMoreRelated] = useState<boolean>(false);
  const loadingMoreRelatedRef = useRef<boolean>(false);
  const activeVideoIdRef = useRef<string>(videoId);
  activeVideoIdRef.current = videoId;

  // Scroll, infinite-load sentinel, and player seek controller refs
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const relatedSentinelRef = useRef<HTMLDivElement | null>(null);
  const seekControllerRef = useRef<PlayerSeekController | null>(null);
  const registerSeekController = useCallback((controller: PlayerSeekController | null) => {
    seekControllerRef.current = controller;
  }, []);

  // 1. Fetch Video Details & Stream URLs
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);
    setDetails(null);
    setRelatedVideos([]);
    setRelatedContinuation(null);
    setLoadingMoreRelated(false);
    loadingMoreRelatedRef.current = false;

    // Check favorite status
    desktopAPI
      .isFavorite(videoId)
      .then((fav) => {
        if (!isCancelled) setIsFavorite(fav);
      })
      .catch(() => {});

    desktopAPI
      .getVideoDetails(videoId, { targetQuality: 1080, preferHdr: true, mode: 'video' })
      .then((data: TayTubeVideoDetails) => {
        if (!isCancelled) {
          setDetails(data);
          setRelatedVideos(data.relatedVideos || []);
          setRelatedContinuation(data.relatedContinuationToken || null);
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

  const loadMoreRelated = useCallback(async () => {
    const token = relatedContinuation;
    if (!token || loadingMoreRelatedRef.current) return;
    const reqVideoId = activeVideoIdRef.current;
    loadingMoreRelatedRef.current = true;
    setLoadingMoreRelated(true);

    try {
      const res = await desktopAPI.getRelatedVideosContinuation(reqVideoId, token);
      if (activeVideoIdRef.current !== reqVideoId) return;
      setRelatedVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        const merged = [...prev];
        for (const item of res.items || []) {
          if (item.id !== reqVideoId && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
          }
        }
        return merged;
      });
      setRelatedContinuation(res.continuationToken || null);
    } catch {
      // Preserve existing items so user can retry
    } finally {
      if (activeVideoIdRef.current === reqVideoId) {
        loadingMoreRelatedRef.current = false;
        setLoadingMoreRelated(false);
      }
    }
  }, [relatedContinuation]);

  useEffect(() => {
    if (activeTab !== 'related' || isPipMode || !relatedContinuation) return;
    const sentinel = relatedSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreRelated();
        }
      },
      { root, rootMargin: '240px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, isPipMode, relatedContinuation, relatedVideos.length, loadMoreRelated]);

  const chapters = useMemo(
    () => extractChaptersFromDescription(details?.description || '', details?.durationSec),
    [details?.description, details?.durationSec]
  );

  const descriptionLines = useMemo(() => {
    if (!details?.description) return [];
    return details.description
      .split(/\r?\n/)
      .map((line) => tokenizeDescriptionLine(line, details.durationSec));
  }, [details?.description, details?.durationSec]);

  const handleTimestampClick = useCallback((seconds: number) => {
    seekControllerRef.current?.seekAndPlay(seconds);
    if (scrollContainerRef.current && scrollContainerRef.current.scrollTop > 40) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleDescriptionLinkClick = useCallback(
    (href: string) => {
      const ytTarget = extractYouTubeLinkTarget(href);
      if (ytTarget) {
        if (ytTarget.videoId === videoId && ytTarget.startSec !== undefined) {
          handleTimestampClick(ytTarget.startSec);
        } else {
          onSelectRelated(ytTarget.videoId);
        }
        return;
      }
      desktopAPI.openExternalUrl(href).catch(() => {});
    },
    [videoId, handleTimestampClick, onSelectRelated]
  );

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

  // 3. Toggle Favorite & Watch Later
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

  const handleWatchLaterClick = () => {
    if (!details) return;
    if (!isSignedIn) {
      onOpenSignIn?.();
      return;
    }
    onToggleWatchLater?.({
      id: details.id,
      title: details.title,
      channel: details.channel,
      channelId: details.channelId,
      thumbnail: details.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${details.id}/hqdefault.jpg`,
      durationSec: details.durationSec,
    });
  };

  // 4. Save Resume Position periodically (5s local SQLite, 25s Google Watch History sync)
  const lastSavedResumeMs = useRef<number>(0);
  const lastSyncedGoogleMs = useRef<number>(-1);
  const latestProgressRef = useRef<{ posMs: number; durMs: number; signedIn: boolean }>({
    posMs: 0,
    durMs: 0,
    signedIn: false,
  });

  useEffect(() => {
    latestProgressRef.current.signedIn = isSignedIn;
  }, [isSignedIn]);

  useEffect(() => {
    lastSavedResumeMs.current = 0;
    lastSyncedGoogleMs.current = -1;
    latestProgressRef.current = { posMs: 0, durMs: 0, signedIn: isSignedIn };

    return () => {
      const snap = latestProgressRef.current;
      if (
        snap.signedIn &&
        snap.durMs > 0 &&
        snap.posMs >= 3000 &&
        Math.abs(snap.posMs - lastSyncedGoogleMs.current) >= 2000
      ) {
        desktopAPI
          .syncWatchProgress(videoId, snap.posMs / 1000, snap.durMs / 1000)
          .catch(() => {});
      }
    };
  }, [videoId]);

  const handleTimeUpdate = (posMs: number, durMs: number) => {
    latestProgressRef.current = { posMs, durMs, signedIn: isSignedIn };

    if (Math.abs(posMs - lastSavedResumeMs.current) >= 5000) {
      lastSavedResumeMs.current = posMs;
      desktopAPI.saveResume(videoId, posMs, durMs);
    }

    if (
      isSignedIn &&
      durMs > 0 &&
      posMs >= 3000 &&
      (lastSyncedGoogleMs.current < 0 ||
        Math.abs(posMs - lastSyncedGoogleMs.current) >= 25000)
    ) {
      lastSyncedGoogleMs.current = posMs;
      desktopAPI
        .syncWatchProgress(videoId, posMs / 1000, durMs / 1000)
        .catch(() => {});
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
    <div
      ref={scrollContainerRef}
      className={
        isPipMode
          ? 'h-full w-full overflow-hidden p-0'
          : 'h-full w-full overflow-y-auto p-4 lg:p-5 space-y-4'
      }
    >
      {/* Back button */}
      {!isPipMode && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center space-x-2 text-yt-subtext hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-[8px] bg-yt-card hover:bg-yt-hover border border-white/[0.05] transition-colors duration-150 w-fit"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại</span>
        </button>
      )}

      {/* Main Layout: PiP Fullscreen Canvas, Theater Mode, or Two-Column */}
      <div
        className={
          isPipMode
            ? 'h-full w-full flex flex-col'
            : `flex flex-col ${isTheater ? 'space-y-5' : 'lg:flex-row lg:space-x-5 lg:space-y-0'}`
        }
      >
        {/* Left / Main Player Column */}
        <div
          className={
            isPipMode
              ? 'h-full w-full flex flex-col'
              : `flex-1 flex flex-col space-y-4 ${isTheater ? 'w-full' : 'lg:w-[70%]'}`
          }
        >
          {/* Custom AvSync Player (kept at fixed tree slot for zero-reload PiP transitions) */}
          <AvSyncPlayer
            details={details}
            initialPositionSec={initialPositionSec}
            onTimeUpdate={handleTimeUpdate}
            isTheater={isTheater}
            onToggleTheater={() => setIsTheater((prev) => !prev)}
            onRegisterCleanup={onRegisterCleanup}
            isPipMode={isPipMode}
            onTogglePip={onTogglePip}
            onExitPip={onExitPip}
            onClosePip={onClosePip}
            chapters={chapters}
            onRegisterSeekController={registerSeekController}
          />

          {/* Video Metadata Header */}
          {!isPipMode && (
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
                  {/* Watch Later Button */}
                  <button
                    type="button"
                    onClick={handleWatchLaterClick}
                    className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-[8px] text-xs font-semibold border transition-colors duration-150 ${
                      isSignedIn && isWatchLater
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-yt-card hover:bg-yt-hover text-yt-text border-white/[0.07]'
                    }`}
                    title={
                      isSignedIn
                        ? isWatchLater
                          ? 'Xóa khỏi Xem sau trên tài khoản Google'
                          : 'Thêm vào Xem sau trên tài khoản Google'
                        : 'Đăng nhập Google để lưu vào Xem sau'
                    }
                  >
                    {isSignedIn && isWatchLater ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                    <span>{isSignedIn && isWatchLater ? 'Đã thêm Xem sau' : 'Xem sau'}</span>
                  </button>

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

              {/* Expandable Description with Interactive Timestamps, URLs & Chapters */}
              {details.description && (
                <div
                  onClick={() => {
                    if (!isDescExpanded) setIsDescExpanded(true);
                  }}
                  className={`bg-yt-card p-3.5 rounded-[8px] border border-white/[0.05] transition-colors duration-150 text-xs text-yt-text leading-relaxed select-text ${
                    !isDescExpanded ? 'hover:bg-yt-hover cursor-pointer' : ''
                  }`}
                >
                  <div
                    className={
                      isDescExpanded
                        ? 'whitespace-pre-wrap break-words'
                        : 'line-clamp-3 whitespace-pre-wrap break-words'
                    }
                  >
                    {descriptionLines.map((tokens, lineIdx) => (
                      <React.Fragment key={`desc-line-${lineIdx}`}>
                        {tokens.map((tok, tokIdx) => {
                          if (tok.type === 'timestamp') {
                            return (
                              <button
                                key={`ts-${lineIdx}-${tokIdx}`}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTimestampClick(tok.seconds);
                                }}
                                className="text-[#3ea6ff] hover:underline font-medium inline cursor-pointer"
                                title={`Tua video tới ${tok.text}`}
                              >
                                {tok.text}
                              </button>
                            );
                          }
                          if (tok.type === 'url') {
                            return (
                              <button
                                key={`url-${lineIdx}-${tokIdx}`}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDescriptionLinkClick(tok.href);
                                }}
                                className="text-[#3ea6ff] hover:underline break-all inline text-left cursor-pointer"
                                title={tok.href}
                              >
                                {tok.text}
                              </button>
                            );
                          }
                          return (
                            <React.Fragment key={`txt-${lineIdx}-${tokIdx}`}>
                              {tok.text}
                            </React.Fragment>
                          );
                        })}
                        {lineIdx < descriptionLines.length - 1 ? '\n' : null}
                      </React.Fragment>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDescExpanded((prev) => !prev);
                    }}
                    className="mt-2 font-semibold text-white hover:text-[#3ea6ff] flex items-center space-x-1 transition-colors"
                  >
                    <span>{isDescExpanded ? 'Thu gọn' : 'Xem thêm'}</span>
                    {isDescExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right / Secondary Column: Related Videos & Comments Tabs */}
        {!isPipMode && (
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
                Video đề xuất ({relatedVideos.length})
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
                {relatedVideos.length === 0 ? (
                  <p className="text-xs text-yt-subtext py-6 text-center">
                    Chưa có video đề xuất nào cho video này.
                  </p>
                ) : (
                  relatedVideos.map((item) => (
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
                        {(item.viewCountText || item.publishedText) && (
                          <p className="text-[10px] text-yt-subtext truncate">
                            {[item.viewCountText, item.publishedText].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {relatedContinuation && (
                  <div ref={relatedSentinelRef} className="pt-2 flex justify-center">
                    <button
                      type="button"
                      disabled={loadingMoreRelated}
                      onClick={loadMoreRelated}
                      className="w-full py-2 px-3 rounded-[8px] bg-yt-card hover:bg-yt-hover border border-white/[0.06] text-xs font-semibold text-yt-subtext hover:text-white transition-colors disabled:opacity-60"
                    >
                      {loadingMoreRelated ? 'Đang tải thêm video đề xuất...' : 'Tải thêm video đề xuất'}
                    </button>
                  </div>
                )}
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
        )}
      </div>
    </div>
  );
};
