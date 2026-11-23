import React, { useState, useEffect, useRef, useCallback } from 'react';
import shaka from 'shaka-player';
import {
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ThumbsUp,
  Heart,
  Clock,
  Check,
  MessageSquare,
  Maximize2,
  RefreshCw,
} from 'lucide-react';
import {
  desktopAPI,
  initProxyPort,
  getProxyBaseUrl,
  extractProxyPortFromUrl,
} from '../api.js';
import { ShortVideoItem, TayTubeVideoDetails, VideoItemUI } from '../types.js';

interface ShortsScreenProps {
  isSignedIn: boolean;
  favoritesSet: Set<string>;
  watchLaterSet: Set<string>;
  onToggleFavorite: (item: VideoItemUI) => void;
  onToggleWatchLater: (item: VideoItemUI) => void;
  onOpenSignIn: () => void;
  onOpenInWatch: (videoId: string) => void;
  onRegisterCleanup?: (cleanupFn: () => void) => void;
}

export const ShortsScreen: React.FC<ShortsScreenProps> = ({
  isSignedIn,
  favoritesSet,
  watchLaterSet,
  onToggleFavorite,
  onToggleWatchLater,
  onOpenSignIn,
  onOpenInWatch,
  onRegisterCleanup,
}) => {
  const [items, setItems] = useState<ShortVideoItem[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [loadingFeed, setLoadingFeed] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [streamError, setStreamError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shakaPlayerRef = useRef<any | null>(null);
  const wheelLockRef = useRef<number>(0);
  const loadSeqRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);

  const currentItem = items[activeIndex] || null;

  const releasePlayer = useCallback(() => {
    if (shakaPlayerRef.current) {
      const p = shakaPlayerRef.current;
      shakaPlayerRef.current = null;
      try {
        p.unload?.();
        p.destroy?.();
      } catch {
        // Ignore teardown errors
      }
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Ignore video reset errors
      }
    }
  }, []);

  useEffect(() => {
    onRegisterCleanup?.(releasePlayer);
    return () => {
      loadSeqRef.current += 1;
      releasePlayer();
    };
  }, [onRegisterCleanup, releasePlayer]);

  const loadInitialFeed = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    releasePlayer();
    try {
      const res = await desktopAPI.getShortsFeed(null);
      setItems(res.items || []);
      setContinuation(res.continuationToken || null);
      setActiveIndex(0);
    } catch (err: any) {
      setFeedError(err?.message || String(err) || 'Không tải được YouTube Shorts.');
    } finally {
      setLoadingFeed(false);
    }
  }, [releasePlayer]);

  useEffect(() => {
    loadInitialFeed();
  }, [loadInitialFeed]);

  // Infinite prefetch when approaching end of loaded Shorts list
  const loadNextPage = useCallback(async () => {
    if (!continuation || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await desktopAPI.getShortsFeed(continuation);
      setContinuation(res.continuationToken || null);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const added = (res.items || []).filter((it) => !seen.has(it.id));
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    } catch {
      // Stop silently on continuation error
    } finally {
      setLoadingMore(false);
    }
  }, [continuation, loadingMore]);

  useEffect(() => {
    if (items.length > 0 && continuation && activeIndex >= items.length - 3) {
      loadNextPage();
    }
  }, [activeIndex, items.length, continuation, loadNextPage]);

  // Load current Short stream cleanly and free previous video's buffers first
  useEffect(() => {
    const seq = ++loadSeqRef.current;
    releasePlayer();
    setCurrentTime(0);
    setDuration(0);
    setStreamError(null);

    if (!currentItem) return;

    setIsBuffering(true);
    setIsPlaying(true);

    const loadShortStream = async () => {
      try {
        const details: TayTubeVideoDetails = await desktopAPI.getVideoDetails(currentItem.id, {
          targetQuality: 1080,
          preferHdr: false,
          mode: 'video',
        });
        if (loadSeqRef.current !== seq) return;

        const video = videoRef.current;
        if (!video) return;

        // Update missing metadata from video details if available
        setItems((prev) =>
          prev.map((it) =>
            it.id === currentItem.id
              ? {
                  ...it,
                  title: it.title.startsWith('YouTube Shorts #') && details.title ? details.title : it.title,
                  channel:
                    it.channel === 'YouTube Shorts' && details.channel ? details.channel : it.channel,
                }
              : it
          )
        );

        const muxed =
          details.selectedStreams?.muxed ||
          details.allVideoStreams?.find((v) => v.isMuxed && v.url) ||
          null;
        const activePort =
          extractProxyPortFromUrl(details.proxyHlsUrl || details.proxyVideoUrl) ??
          (await initProxyPort());
        const proxyBase = getProxyBaseUrl(activePort);
        const hlsUrl =
          details.proxyHlsUrl ||
          (details.hlsManifestUrl
            ? `${proxyBase}/hls.m3u8?url=${encodeURIComponent(details.hlsManifestUrl)}&id=${encodeURIComponent(details.id)}`
            : null);
        const directProxyUrl = muxed
          ? `${proxyBase}/stream?url=${encodeURIComponent(muxed.url)}&id=${encodeURIComponent(details.id)}&itag=${muxed.itag}`
          : details.proxyVideoUrl || null;

        if (hlsUrl && shaka.Player.isBrowserSupported()) {
          shaka.polyfill.installAll();
          const player = new shaka.Player();
          await player.attach(video);
          if (loadSeqRef.current !== seq) {
            await player.destroy();
            return;
          }
          shakaPlayerRef.current = player;
          player.configure({
            streaming: {
              bufferingGoal: 12,
              rebufferingGoal: 2,
              ignoreTextStreamFailures: true,
              retryParameters: { maxAttempts: 3, baseDelay: 500, backoffFactor: 1.5 },
            },
            manifest: {
              hls: {
                ignoreManifestProgramDateTime: true,
              },
            },
          });

          player.addEventListener('buffering', (evt: any) => {
            if (loadSeqRef.current === seq) {
              setIsBuffering(Boolean(evt?.buffering));
            }
          });

          player.addEventListener('error', (evt: any) => {
            console.error('[ShortsScreen Shaka Error]', evt?.detail || evt);
            if (loadSeqRef.current !== seq) return;
            if (directProxyUrl) {
              player.destroy().catch(() => {});
              if (shakaPlayerRef.current === player) shakaPlayerRef.current = null;
              video.src = directProxyUrl;
              video.load();
              video.play().catch(() => {});
            } else {
              setStreamError('Không thể tải luồng phát cho Short này.');
              setIsBuffering(false);
            }
          });

          try {
            await player.load(hlsUrl, null, 'application/x-mpegurl');
            if (loadSeqRef.current !== seq) return;
            const tracks = player.getVariantTracks?.() || [];
            const avcTracks = tracks
              .filter((t: any) => String(t?.videoCodec || '').toLowerCase().startsWith('avc1'))
              .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
            const chosen = avcTracks.find((t: any) => (t.height || 0) <= 1080) || avcTracks[0];
            if (chosen) {
              player.configure({ abr: { enabled: false } });
              player.selectVariantTrack(chosen, true);
            }
          } catch (err) {
            console.error('[ShortsScreen Load Error]', err);
            if (loadSeqRef.current !== seq) return;
            await player.destroy();
            if (shakaPlayerRef.current === player) shakaPlayerRef.current = null;
            if (directProxyUrl) {
              video.src = directProxyUrl;
              video.load();
            } else {
              setStreamError('Không tải được luồng phát HLS cho Short này.');
              setIsBuffering(false);
              return;
            }
          }
        } else if (directProxyUrl) {
          video.src = directProxyUrl;
          video.load();
        } else {
          setStreamError('Không tìm thấy luồng phát phù hợp cho Short này.');
          setIsBuffering(false);
          return;
        }

        if (loadSeqRef.current !== seq) return;
        video.muted = isMutedRef.current;
        video
          .play()
          .then(() => {
            if (loadSeqRef.current === seq) {
              setIsPlaying(true);
              setIsBuffering(false);
            }
          })
          .catch(() => {
            if (loadSeqRef.current === seq) {
              setIsBuffering(false);
            }
          });
      } catch (err: any) {
        if (loadSeqRef.current === seq) {
          setStreamError(err?.message || 'Không thể phát Short này.');
          setIsBuffering(false);
        }
      }
    };

    loadShortStream();
  }, [currentItem?.id, releasePlayer]);

  const goNext = useCallback(() => {
    setActiveIndex((prev) => {
      if (prev + 1 < items.length) return prev + 1;
      return prev;
    });
  }, [items.length]);

  const goPrev = useCallback(() => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
    }
  }, []);

  // Keyboard navigation (ArrowUp/Down, Space/K, M)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, togglePlay, toggleMute]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const now = Date.now();
      if (now - wheelLockRef.current < 380) return;
      if (Math.abs(e.deltaY) < 25) return;
      wheelLockRef.current = now;
      if (e.deltaY > 0) {
        goNext();
      } else {
        goPrev();
      }
    },
    [goNext, goPrev]
  );

  const handleLikeShort = async () => {
    if (!currentItem) return;
    if (!isSignedIn) {
      onOpenSignIn();
      return;
    }
    const wasLiked = likedSet.has(currentItem.id);
    setLikedSet((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(currentItem.id);
      else next.add(currentItem.id);
      return next;
    });
    try {
      await desktopAPI.rateVideo(currentItem.id, !wasLiked);
    } catch {
      // Revert on failure
      setLikedSet((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(currentItem.id);
        else next.delete(currentItem.id);
        return next;
      });
    }
  };

  if (loadingFeed) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center space-y-3 bg-yt-bg">
        <div className="w-10 h-10 border-4 border-yt-red border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-yt-subtext">Đang tải bảng tin YouTube Shorts...</p>
      </div>
    );
  }

  if (feedError || !currentItem) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center space-y-3 text-center px-4">
        <p className="text-base font-semibold text-white">Không tải được YouTube Shorts</p>
        <p className="text-xs text-yt-subtext max-w-md">{feedError}</p>
        <button
          type="button"
          onClick={loadInitialFeed}
          className="flex items-center space-x-2 px-4 py-2 min-h-[44px] bg-yt-red hover:bg-red-700 text-white text-xs font-semibold rounded-[8px] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Thử lại</span>
        </button>
      </div>
    );
  }

  const isLiked = likedSet.has(currentItem.id);
  const isFav = favoritesSet.has(currentItem.id);
  const isWL = watchLaterSet.has(currentItem.id);
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const asVideoItem: VideoItemUI = {
    id: currentItem.id,
    title: currentItem.title,
    channel: currentItem.channel,
    channelId: currentItem.channelId,
    thumbnail: currentItem.thumbnail,
    durationSec: Math.round(duration) || 60,
  };

  return (
    <div
      onWheel={handleWheel}
      className="h-full w-full flex items-center justify-center bg-yt-bg px-4 py-3 select-none overflow-hidden"
    >
      <div className="flex items-center space-x-5">
        {/* Vertical 9:16 Cinema Player Card */}
        <div className="relative aspect-[9/16] h-[calc(100vh-5.5rem)] max-h-[820px] bg-black rounded-[14px] overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center">
          <video
            ref={videoRef}
            loop
            autoPlay
            playsInline
            poster={currentItem.thumbnail}
            onClick={togglePlay}
            onWaiting={() => setIsBuffering(true)}
            onCanPlay={() => setIsBuffering(false)}
            onPlaying={() => {
              setIsBuffering(false);
              setIsPlaying(true);
            }}
            onPause={() => setIsPlaying(false)}
            onError={() => {
              if (!videoRef.current?.currentSrc && !shakaPlayerRef.current) return;
              setIsBuffering(false);
              setStreamError('Trình phát không thể giải mã luồng video Short này.');
            }}
            onTimeUpdate={() => {
              if (videoRef.current) setCurrentTime(videoRef.current.currentTime || 0);
            }}
            onDurationChange={() => {
              const d = videoRef.current?.duration;
              if (d && isFinite(d) && d > 0) setDuration(d);
            }}
            className="w-full h-full object-cover cursor-pointer"
          />

          {/* Top Controls: Mute + Index Counter */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
            <span className="px-2.5 py-1 rounded-[6px] bg-black/75 text-[11px] font-mono text-white/90">
              Shorts {activeIndex + 1} / {items.length}
              {continuation ? '+' : ''}
            </span>
            <button
              type="button"
              onClick={toggleMute}
              className="pointer-events-auto p-2 rounded-[8px] bg-black/75 hover:bg-black text-white transition-colors"
              title={isMuted ? 'Bật tiếng (M)' : 'Tắt tiếng (M)'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          {/* Center Play/Buffering Indicator */}
          {(isBuffering || !isPlaying || streamError) && (
            <div
              onClick={togglePlay}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black/35 cursor-pointer px-6 text-center"
            >
              {streamError ? (
                <div className="space-y-2 bg-black/85 p-4 rounded-[10px] border border-white/10">
                  <p className="text-xs text-white font-semibold">{streamError}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goNext();
                    }}
                    className="px-3 py-1.5 bg-yt-red rounded-[6px] text-xs font-semibold text-white"
                  >
                    Chuyển video tiếp theo
                  </button>
                </div>
              ) : isBuffering ? (
                <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-black/75 flex items-center justify-center border border-white/15">
                  <Play className="w-7 h-7 text-white fill-current ml-0.5" />
                </div>
              )}
            </div>
          )}

          {/* Bottom Metadata Overlay + Thin Progress Bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent pt-12 pb-3 px-3.5 space-y-2.5 pointer-events-none">
            <div className="flex items-center space-x-2.5">
              {currentItem.channelAvatar ? (
                <img
                  src={currentItem.channelAvatar}
                  alt={currentItem.channel}
                  className="w-8 h-8 rounded-full object-cover border border-white/20 flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-yt-red flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {currentItem.channel.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-bold text-white truncate">{currentItem.channel}</span>
            </div>

            <p className="text-xs text-white/95 font-medium line-clamp-2 leading-snug">
              {currentItem.title}
            </p>

            {/* Thin Interactive Seek Bar */}
            <div
              className="pointer-events-auto h-3 flex items-center cursor-pointer group"
              onClick={(e) => {
                e.stopPropagation();
                if (!videoRef.current || duration <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                videoRef.current.currentTime = ratio * duration;
              }}
            >
              <div className="w-full h-1 group-hover:h-1.5 bg-white/25 rounded-full overflow-hidden transition-[height]">
                <div className="h-full bg-yt-red" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side Action & Navigation Rail */}
        <div className="flex flex-col items-center space-y-3">
          {/* Previous Short */}
          <button
            type="button"
            onClick={goPrev}
            disabled={activeIndex === 0}
            className="w-11 h-11 rounded-full bg-yt-card hover:bg-yt-hover disabled:opacity-35 disabled:cursor-not-allowed border border-white/10 flex items-center justify-center text-white transition-colors"
            title="Short trước (Mũi tên lên / Cuộn lên)"
          >
            <ChevronUp className="w-5 h-5" />
          </button>

          {/* Next Short */}
          <button
            type="button"
            onClick={goNext}
            disabled={activeIndex >= items.length - 1}
            className="w-11 h-11 rounded-full bg-yt-card hover:bg-yt-hover disabled:opacity-35 disabled:cursor-not-allowed border border-white/10 flex items-center justify-center text-white transition-colors"
            title="Short tiếp theo (Mũi tên xuống / Cuộn xuống)"
          >
            <ChevronDown className="w-5 h-5" />
          </button>

          <div className="w-6 h-px bg-yt-border my-1" />

          {/* Like */}
          <button
            type="button"
            onClick={handleLikeShort}
            className="flex flex-col items-center space-y-1 group"
            title={isSignedIn ? 'Thích video này' : 'Đăng nhập Google để Thích'}
          >
            <div
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                isLiked
                  ? 'bg-yt-red border-yt-red text-white'
                  : 'bg-yt-card group-hover:bg-yt-hover border-white/10 text-white'
              }`}
            >
              <ThumbsUp className="w-4 h-4" />
            </div>
            <span className="text-[10px] text-yt-subtext font-medium max-w-[56px] truncate">
              {currentItem.likeCountText || 'Thích'}
            </span>
          </button>

          {/* Comments count badge / Open full watch view for comments */}
          <button
            type="button"
            onClick={() => {
              releasePlayer();
              onOpenInWatch(currentItem.id);
            }}
            className="flex flex-col items-center space-y-1 group"
            title="Xem bình luận & chi tiết"
          >
            <div className="w-11 h-11 rounded-full bg-yt-card group-hover:bg-yt-hover border border-white/10 flex items-center justify-center text-white transition-colors">
              <MessageSquare className="w-4 h-4" />
            </div>
            <span className="text-[10px] text-yt-subtext font-medium max-w-[56px] truncate">
              {currentItem.commentCountText || 'Bình luận'}
            </span>
          </button>

          {/* Watch Later */}
          <button
            type="button"
            onClick={() => onToggleWatchLater(asVideoItem)}
            className="flex flex-col items-center space-y-1 group"
            title={isWL ? 'Xóa khỏi Xem sau' : 'Thêm vào Xem sau'}
          >
            <div
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                isWL
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-yt-card group-hover:bg-yt-hover border-white/10 text-white'
              }`}
            >
              {isWL ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
            </div>
            <span className="text-[10px] text-yt-subtext font-medium">Xem sau</span>
          </button>

          {/* Local Favorite */}
          <button
            type="button"
            onClick={() => onToggleFavorite(asVideoItem)}
            className="flex flex-col items-center space-y-1 group"
            title={isFav ? 'Bỏ yêu thích' : 'Lưu vào Yêu thích'}
          >
            <div
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                isFav
                  ? 'bg-yt-red border-yt-red text-white'
                  : 'bg-yt-card group-hover:bg-yt-hover border-white/10 text-white'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
            </div>
            <span className="text-[10px] text-yt-subtext font-medium">Yêu thích</span>
          </button>

          {/* Play/Pause & Expand */}
          <button
            type="button"
            onClick={togglePlay}
            className="w-11 h-11 rounded-full bg-yt-card hover:bg-yt-hover border border-white/10 flex items-center justify-center text-white transition-colors"
            title={isPlaying ? 'Tạm dừng (Space)' : 'Phát (Space)'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => {
              releasePlayer();
              onOpenInWatch(currentItem.id);
            }}
            className="w-11 h-11 rounded-full bg-yt-card hover:bg-yt-hover border border-white/10 flex items-center justify-center text-yt-subtext hover:text-white transition-colors"
            title="Mở ở trình phát chính"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
