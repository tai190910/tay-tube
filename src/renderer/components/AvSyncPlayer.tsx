import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import shaka from 'shaka-player';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Subtitles,
  Settings,
  Maximize,
  Minimize,
  Tv,
  Check,
} from 'lucide-react';
import { SubtitleParser, SubtitleCue } from '../../core/subtitles/subtitle-parser.js';
import { CaptionTrackInfo, TayTubeVideoDetails } from '../types.js';

interface AvSyncPlayerProps {
  details: TayTubeVideoDetails;
  initialPositionSec?: number;
  onTimeUpdate?: (positionMs: number, durationMs: number) => void;
  isTheater: boolean;
  onToggleTheater: () => void;
  onRegisterCleanup?: (cleanupFn: () => void) => void;
}

type StreamMode = 'hls' | 'muxed';

/**
 * Binary search to find subtitle cue at currentMs in O(log n).
 * For 50,000 cues (37-hour video), executes in at most 16 iterations (<1µs).
 */
function findCueBinary(cues: SubtitleCue[], currentMs: number): SubtitleCue | null {
  const len = cues.length;
  if (len === 0) return null;

  let low = 0;
  let high = len - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].startMs <= currentMs) {
      bestIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestIdx !== -1) {
    const cue = cues[bestIdx];
    if (currentMs <= cue.endMs) {
      return cue;
    }
    if (bestIdx > 0 && currentMs <= cues[bestIdx - 1].endMs && currentMs >= cues[bestIdx - 1].startMs) {
      return cues[bestIdx - 1];
    }
  }
  return null;
}

/**
 * Formats time as HH:MM:SS for multi-hour videos (or when forceHours is true) and MM:SS for shorter videos.
 */
function formatTime(sec: number, forceHours = false): string {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return forceHours ? '00:00:00' : '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0 || forceHours) {
    const hh = forceHours && h < 10 ? `0${h}` : `${h}`;
    return `${hh}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const AvSyncPlayer: React.FC<AvSyncPlayerProps> = ({
  details,
  initialPositionSec = 0,
  onTimeUpdate,
  isTheater,
  onToggleTheater,
  onRegisterCleanup,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shakaPlayerRef = useRef<any | null>(null);
  const shakaAttachPromiseRef = useRef<Promise<void> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seekbarRef = useRef<HTMLDivElement | null>(null);
  const isDestroyedRef = useRef<boolean>(false);

  // Playback States
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [bufferedEndSec, setBufferedEndSec] = useState<number>(0);
  const [duration, setDuration] = useState<number>(details.durationSec || 0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Seekbar Hover & Drag Scrubbing States
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubTimeSec, setScrubTimeSec] = useState<number>(0);

  // High-frequency refs so effects never re-run on currentTime / volume / callback changes
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(details.durationSec || 0);
  const volumeRef = useRef<number>(1);
  const isMutedRef = useRef<boolean>(false);
  const playbackRateRef = useRef<number>(1);
  const initialPosRef = useRef<number>(initialPositionSec);
  const lastResumeSaveRef = useRef<number>(0);
  const lastSkippedSegRef = useRef<string | null>(null);
  const onToggleTheaterRef = useRef(onToggleTheater);
  onToggleTheaterRef.current = onToggleTheater;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  // Auto-hide Controls & Cursor Refs (2.5s idle timeout)
  const [showControls, setShowControls] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringControlsRef = useRef<boolean>(false);
  const isScrubbingRef = useRef<boolean>(false);
  const isMenuOpenRef = useRef<boolean>(false);

  // Toasts & Popover Menus
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [showCcMenu, setShowCcMenu] = useState<boolean>(false);

  isMenuOpenRef.current = showQualityMenu || showSpeedMenu || showCcMenu;

  // Schedule auto-hiding controls & cursor after 2.5s of mouse inactivity
  const scheduleHideControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }

    controlsTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (
        video &&
        !video.paused &&
        !isHoveringControlsRef.current &&
        !isScrubbingRef.current &&
        !isMenuOpenRef.current
      ) {
        setShowControls(false);
      }
    }, 2500);
  }, []);

  // Resolve Official HLS URL (from YouTube VISIONOS / iOS client via .m3u8 proxy)
  const hlsUrl = useMemo(() => {
    if (details.proxyHlsUrl) return details.proxyHlsUrl;
    if (details.hlsManifestUrl) {
      return `http://127.0.0.1:8989/hls.m3u8?url=${encodeURIComponent(details.hlsManifestUrl)}&id=${encodeURIComponent(details.id)}`;
    }
    return '';
  }, [details.id, details.proxyHlsUrl, details.hlsManifestUrl]);

  // Resolve Direct Muxed MP4 fallback streams: prefer itag 22 (720p) then itag 18 (360p)
  const muxedStreams = useMemo(() => {
    const allMuxed = details.allVideoStreams.filter((v) => v.isMuxed && v.url);
    const itag22 = allMuxed.find((v) => v.itag === 22) || allMuxed.find((v) => v.height === 720);
    const itag18 = allMuxed.find((v) => v.itag === 18) || allMuxed.find((v) => v.height === 360);
    const best = itag22 || details.selectedStreams.muxed || itag18 || allMuxed[0] || null;
    return { itag22, itag18, best };
  }, [details]);

  const toProxyStreamUrl = useCallback(
    (rawUrl?: string, itag?: number) => {
      if (!rawUrl) return '';
      const itagParam = itag ? `&itag=${itag}` : '';
      return `http://127.0.0.1:8989/stream?url=${encodeURIComponent(rawUrl)}&id=${encodeURIComponent(details.id)}${itagParam}`;
    },
    [details.id]
  );

  const muxedFallbackSrc = useMemo(
    () => toProxyStreamUrl(muxedStreams.best?.url, muxedStreams.best?.itag),
    [muxedStreams.best?.url, muxedStreams.best?.itag, toProxyStreamUrl]
  );

  // Stream mode: 'hls' (default when hlsUrl exists) or 'muxed' (MP4 itag 22/18 fallback / 720p Direct)
  const [streamMode, setStreamMode] = useState<StreamMode>(() => (hlsUrl ? 'hls' : 'muxed'));
  const [currentQuality, setCurrentQuality] = useState<number>(1080);
  const [hlsQualities, setHlsQualities] = useState<number[]>([]);
  const streamModeRef = useRef<StreamMode>(streamMode);
  streamModeRef.current = streamMode;
  const currentQualityRef = useRef<number>(currentQuality);
  currentQualityRef.current = currentQuality;
  const muxedFallbackSrcRef = useRef<string>(muxedFallbackSrc);
  muxedFallbackSrcRef.current = muxedFallbackSrc;

  // Subtitles: store cues in useRef (NOT useState)
  const [isCcEnabled, setIsCcEnabled] = useState<boolean>(false);
  const [isCcLoading, setIsCcLoading] = useState<boolean>(false);
  const [activeCaption, setActiveCaption] = useState<CaptionTrackInfo | null>(null);
  const userRequestedCcRef = useRef<boolean>(false);
  const subtitleAbortRef = useRef<AbortController | null>(null);
  const cuesRef = useRef<SubtitleCue[]>([]);
  const currentCueTextRef = useRef<string>('');
  const [currentCueText, setCurrentCueText] = useState<string>('');

  // Show Toast notification
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }, []);

  // Helper: Select matching HLS resolution inside already-loaded Shaka Player (preferring H.264 avc1 for hardware decode)
  const applyHlsQuality = useCallback((player: any, targetHeight: number) => {
    if (!player) return;
    try {
      const tracks = player.getVariantTracks?.() || [];
      if (tracks.length === 0) return;

      const heights = Array.from(
        new Set<number>(tracks.map((t: any) => Number(t.height || 0)).filter((h: number) => h > 0))
      ).sort((a, b) => b - a);
      if (heights.length > 0) {
        setHlsQualities(heights);
      }

      const isAvc = (t: any) => String(t?.videoCodec || '').toLowerCase().startsWith('avc1');
      const sortedMatches = tracks
        .filter((t: any) => t.height === targetHeight)
        .sort(
          (a: any, b: any) =>
            Number(isAvc(b)) - Number(isAvc(a)) || (b.bandwidth || 0) - (a.bandwidth || 0)
        );

      let chosen = sortedMatches[0];
      if (!chosen) {
        const lower = tracks
          .filter((t: any) => t.height && t.height <= targetHeight)
          .sort(
            (a: any, b: any) =>
              b.height - a.height ||
              Number(isAvc(b)) - Number(isAvc(a)) ||
              (b.bandwidth || 0) - (a.bandwidth || 0)
          );
        chosen =
          lower[0] ||
          tracks
            .slice()
            .sort(
              (a: any, b: any) =>
                (b.height || 0) - (a.height || 0) ||
                Number(isAvc(b)) - Number(isAvc(a)) ||
                (b.bandwidth || 0) - (a.bandwidth || 0)
            )[0];
      }

      if (chosen) {
        player.configure({ abr: { enabled: false } });
        player.selectVariantTrack(chosen, /* clearBuffer */ true);
      }
    } catch {
      // Ignore if manifest is not loaded yet
    }
  }, []);

  // Explicit synchronous teardown helper (called on unmount AND immediately on Sidebar/Logo click)
  const destroyPlayerImmediately = useCallback(() => {
    if (isDestroyedRef.current) return;
    isDestroyedRef.current = true;
    shakaAttachPromiseRef.current = null;

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    if (subtitleAbortRef.current) {
      subtitleAbortRef.current.abort();
      subtitleAbortRef.current = null;
    }

    const player = shakaPlayerRef.current;
    shakaPlayerRef.current = null;
    if (player) {
      try {
        player.destroy();
      } catch {
        // Ignore destroy errors
      }
    }

    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Ignore
      }
    }
  }, []);

  // Register teardown callback with App/WatchScreen so navigation kills playback immediately
  useEffect(() => {
    onRegisterCleanup?.(destroyPlayerImmediately);
    return () => {
      onRegisterCleanup?.(() => {});
    };
  }, [onRegisterCleanup, destroyPlayerImmediately]);

  // ==========================================================================
  // 1. INITIAL SUBTITLE SETUP (Do NOT auto-enable on ultra-long videos > 1h)
  // ==========================================================================
  useEffect(() => {
    userRequestedCcRef.current = false;
    cuesRef.current = [];
    currentCueTextRef.current = '';
    setCurrentCueText('');

    if (details.captionTracks.length > 0) {
      const viTrack =
        details.captionTracks.find((t) => t.languageTag.toLowerCase().startsWith('vi') && !t.isAutoGenerated) ||
        details.captionTracks.find((t) => t.languageTag.toLowerCase().startsWith('vi')) ||
        details.captionTracks[0];

      setActiveCaption(viTrack || null);
      const isLongVideo = (details.durationSec || 0) > 3600;
      setIsCcEnabled(Boolean(viTrack) && !isLongVideo);
    } else {
      setActiveCaption(null);
      setIsCcEnabled(false);
    }
  }, [details.id]);

  // Load Subtitle cues asynchronously into cuesRef (NEVER useState)
  useEffect(() => {
    if (subtitleAbortRef.current) {
      subtitleAbortRef.current.abort();
      subtitleAbortRef.current = null;
    }

    if (!activeCaption || !isCcEnabled) {
      cuesRef.current = [];
      if (currentCueTextRef.current !== '') {
        currentCueTextRef.current = '';
        setCurrentCueText('');
      }
      setIsCcLoading(false);
      return;
    }

    const controller = new AbortController();
    subtitleAbortRef.current = controller;
    const allowLarge = userRequestedCcRef.current;

    if (allowLarge) {
      setIsCcLoading(true);
    }

    SubtitleParser.fetchAndParseAsync(activeCaption.vttUrl, {
      allowLarge,
      maxAutoSizeBytes: 500 * 1024,
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      setIsCcLoading(false);

      if (result.skippedLarge) {
        cuesRef.current = [];
        setIsCcEnabled(false);
        return;
      }

      cuesRef.current = result.cues;
      if (allowLarge && result.cues.length > 0) {
        showToast(`Đã tải phụ đề (${result.cues.length} dòng)`);
      }
    });

    return () => {
      controller.abort();
    };
  }, [activeCaption, isCcEnabled, showToast]);

  // ==========================================================================
  // 2. SHAKA PLAYER INITIALIZATION (Runs ONCE on mount, destroys on unmount)
  // ==========================================================================
  useEffect(() => {
    isDestroyedRef.current = false;
    shaka.polyfill.installAll();

    const video = videoRef.current;
    if (!video) return;

    const player = new shaka.Player();
    shakaAttachPromiseRef.current = player.attach(video).catch(() => {});

    player.configure({
      streaming: {
        rebufferingGoal: 2,
        bufferingGoal: 15,         // maxBufferLength: 15s
        bufferBehind: 15,          // backBufferLength: 15s
        ignoreTextStreamFailures: true,
        retryParameters: {
          maxAttempts: 4,
          baseDelay: 300,
          backoffFactor: 1.5,
        },
      },
      manifest: {
        retryParameters: {
          maxAttempts: 4,
          baseDelay: 300,
          backoffFactor: 1.5,
        },
        hls: {
          ignoreManifestProgramDateTime: true,
        },
      },
    });

    player.addEventListener('buffering', (event: any) => {
      if (!isDestroyedRef.current) {
        setIsBuffering(Boolean(event.buffering));
      }
    });

    player.addEventListener('error', (event: any) => {
      console.error('[AvSyncPlayer Shaka Error]', event?.detail || event);
      if (isDestroyedRef.current) return;
      if (streamModeRef.current === 'hls' && muxedFallbackSrcRef.current) {
        showToast('HLS gặp sự cố, tự động chuyển sang MP4 trực tiếp');
        setStreamMode('muxed');
      } else {
        setIsBuffering(false);
        setPlaybackError('Không thể tải luồng phát video. Nhấn thử lại hoặc chọn chất lượng khác.');
      }
    });

    shakaPlayerRef.current = player;

    return () => {
      destroyPlayerImmediately();
    };
  }, [destroyPlayerImmediately, showToast]);

  // ==========================================================================
  // 3. LOAD STREAM (ONLY runs when videoId or streamMode changes — NEVER on currentTime/isBuffering)
  // ==========================================================================
  useEffect(() => {
    const video = videoRef.current;
    const player = shakaPlayerRef.current;
    if (!video || isDestroyedRef.current) return;

    let cancelled = false;
    setPlaybackError(null);
    setIsBuffering(true);

    const resumeAt = currentTimeRef.current > 1 ? currentTimeRef.current : initialPosRef.current;

    const loadStream = async () => {
      try {
        if (streamMode === 'hls' && hlsUrl && player) {
          if (shakaAttachPromiseRef.current) {
            await shakaAttachPromiseRef.current;
          }
          if (cancelled || isDestroyedRef.current) return;

          if (video.src) {
            video.removeAttribute('src');
            video.load();
          }

          await player.load(hlsUrl, resumeAt > 0 ? resumeAt : null, 'application/x-mpegurl');
          if (cancelled || isDestroyedRef.current) return;

          applyHlsQuality(player, currentQualityRef.current);
        } else {
          if (player) {
            try {
              await player.unload();
            } catch {
              // Ignore
            }
          }
          if (cancelled || isDestroyedRef.current) return;

          const fallbackUrl = muxedFallbackSrc;
          if (!fallbackUrl) {
            setIsBuffering(false);
            setPlaybackError('Không tìm thấy luồng phát video phù hợp.');
            return;
          }

          video.src = fallbackUrl;
          video.load();
          if (resumeAt > 0) {
            video.currentTime = resumeAt;
          }
        }

        if (cancelled || isDestroyedRef.current) return;

        video.volume = isMutedRef.current ? 0 : volumeRef.current;
        video.muted = isMutedRef.current;
        video.playbackRate = playbackRateRef.current;

        video
          .play()
          .then(() => {
            if (!cancelled && !isDestroyedRef.current) {
              setIsPlaying(true);
              setIsBuffering(false);
              scheduleHideControls();
            }
          })
          .catch(() => {
            if (!cancelled && !isDestroyedRef.current) {
              setIsBuffering(false);
            }
          });
      } catch (err) {
        console.error('[AvSyncPlayer Load Error]', err);
        if (cancelled || isDestroyedRef.current) return;
        if (streamMode === 'hls' && muxedFallbackSrc) {
          showToast('Không tải được HLS, chuyển sang MP4 trực tiếp');
          setStreamMode('muxed');
        } else {
          setIsBuffering(false);
          setPlaybackError('Không thể tải luồng phát video. Nhấn thử lại hoặc chọn chất lượng khác.');
        }
      }
    };

    loadStream();

    return () => {
      cancelled = true;
    };
  }, [
    details.id,
    streamMode,
    hlsUrl,
    muxedFallbackSrc,
    reloadNonce,
    applyHlsQuality,
    showToast,
    scheduleHideControls,
  ]);

  // ==========================================================================
  // 4. QUALITY SWITCHING IN HLS MODE (Seamless track switch without re-init)
  // ==========================================================================
  useEffect(() => {
    if (streamMode === 'hls' && shakaPlayerRef.current) {
      applyHlsQuality(shakaPlayerRef.current, currentQuality);
    }
  }, [currentQuality, streamMode, applyHlsQuality]);

  // Synchronize playbackRate without reloading stream
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // ==========================================================================
  // 5. PLAY / PAUSE / SEEK / VOLUME / FULLSCREEN CONTROLLERS
  // ==========================================================================
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          scheduleHideControls();
        })
        .catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
    }
  }, [scheduleHideControls]);

  const seek = useCallback(
    (newTimeSec: number) => {
      const video = videoRef.current;
      if (!video) return;

      const dur =
        video.duration && isFinite(video.duration) && !isNaN(video.duration)
          ? video.duration
          : durationRef.current || details.durationSec || 0;
      const clamped = Math.max(0, dur > 0 ? Math.min(newTimeSec, dur) : newTimeSec);
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      setIsBuffering(true);
      video.currentTime = clamped;
      scheduleHideControls();
    },
    [details.durationSec, scheduleHideControls]
  );

  // Interactive Seekbar Ratio Calculator & Drag Scrubbing
  const computeSeekRatioFromClientX = useCallback((clientX: number): number => {
    const bar = seekbarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleSeekbarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const dur = durationRef.current || duration || 0;
      if (dur <= 0) return;

      const initialRatio = computeSeekRatioFromClientX(e.clientX);
      isScrubbingRef.current = true;
      setIsScrubbing(true);
      setHoverRatio(initialRatio);
      setScrubTimeSec(initialRatio * dur);
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }

      const onWindowMouseMove = (moveEvt: MouseEvent) => {
        const r = computeSeekRatioFromClientX(moveEvt.clientX);
        setHoverRatio(r);
        setScrubTimeSec(r * (durationRef.current || dur));
      };

      const onWindowMouseUp = (upEvt: MouseEvent) => {
        window.removeEventListener('mousemove', onWindowMouseMove);
        window.removeEventListener('mouseup', onWindowMouseUp);
        const finalRatio = computeSeekRatioFromClientX(upEvt.clientX);
        const finalSec = finalRatio * (durationRef.current || dur);
        isScrubbingRef.current = false;
        setIsScrubbing(false);
        seek(finalSec);
      };

      window.addEventListener('mousemove', onWindowMouseMove);
      window.addEventListener('mouseup', onWindowMouseUp);
    },
    [computeSeekRatioFromClientX, duration, seek]
  );

  const handleVolumeChange = useCallback((newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    volumeRef.current = clamped;
    setVolume(clamped);
    const shouldMute = clamped === 0;
    isMutedRef.current = shouldMute;
    setIsMuted(shouldMute);

    if (videoRef.current) {
      videoRef.current.volume = clamped;
      videoRef.current.muted = shouldMute;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);

    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
      if (!nextMuted && volumeRef.current === 0) {
        volumeRef.current = 0.8;
        setVolume(0.8);
        videoRef.current.volume = 0.8;
      }
    }
  }, []);

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
    scheduleHideControls();
  };

  const handleQualityChange = (q: number) => {
    setCurrentQuality(q);
    if (hlsUrl && streamMode !== 'hls') {
      setStreamMode('hls');
    } else if (streamMode === 'muxed') {
      const targetStream = q <= 360 && muxedStreams.itag18 ? muxedStreams.itag18 : muxedStreams.best;
      if (targetStream?.url && videoRef.current) {
        const pos = videoRef.current.currentTime;
        videoRef.current.src = toProxyStreamUrl(targetStream.url, targetStream.itag);
        videoRef.current.load();
        videoRef.current.currentTime = pos;
        videoRef.current.play().catch(() => {});
      }
    }
    setShowQualityMenu(false);
    scheduleHideControls();
  };

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Update buffered progress bar from video.buffered TimeRanges
  const updateBufferedRange = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.buffered || video.buffered.length === 0) return;
    const curr = video.currentTime;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      const startB = video.buffered.start(i);
      const endB = video.buffered.end(i);
      if (curr >= startB - 1.5 && curr <= endB + 1.5) {
        end = endB;
        break;
      }
      if (endB > end) end = endB;
    }
    setBufferedEndSec(end);
  }, []);

  // Video Time Update & SponsorBlock Skip & O(log n) Subtitle Matching
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || isDestroyedRef.current) return;

    const curr = video.currentTime;
    currentTimeRef.current = curr;
    if (!isScrubbingRef.current) {
      setCurrentTime(curr);
    }
    updateBufferedRange();

    // Save resume position at most once every 5s to prevent SQLite I/O stall
    if (onTimeUpdateRef.current && Math.abs(curr - lastResumeSaveRef.current) >= 5) {
      lastResumeSaveRef.current = curr;
      onTimeUpdateRef.current(Math.round(curr * 1000), Math.round((durationRef.current || duration) * 1000));
    }

    // SponsorBlock Auto-Skip Check
    if (details.sponsorSegments && details.sponsorSegments.length > 0) {
      for (const seg of details.sponsorSegments) {
        if (curr >= seg.startSec && curr < seg.endSec) {
          if (lastSkippedSegRef.current !== seg.uuid) {
            lastSkippedSegRef.current = seg.uuid;
            seek(seg.endSec);
            showToast(`Đã tự động bỏ qua: ${seg.categoryLabel}`);
          }
          break;
        }
      }
    }

    // Subtitle Cue Matching via O(log n) Binary Search (only re-render when cue text changes)
    if (isCcEnabled && cuesRef.current.length > 0) {
      const currentMs = Math.round(curr * 1000);
      const matched = findCueBinary(cuesRef.current, currentMs);
      const newText = matched ? matched.text : '';
      if (currentCueTextRef.current !== newText) {
        currentCueTextRef.current = newText;
        setCurrentCueText(newText);
      }
    } else if (currentCueTextRef.current !== '') {
      currentCueTextRef.current = '';
      setCurrentCueText('');
    }
  };

  // Keyboard Shortcuts (Bound ONCE on mount — zero dependency on currentTime / volume)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          seek(currentTimeRef.current - 10);
          showToast('-10s');
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          seek(currentTimeRef.current + 10);
          showToast('+10s');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(currentTimeRef.current - 5);
          showToast('-5s');
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(currentTimeRef.current + 5);
          showToast('+5s');
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          onToggleTheaterRef.current();
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volumeRef.current + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volumeRef.current - 0.05));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seek, toggleMute, toggleFullscreen, handleVolumeChange, showToast]);

  // Quality options shown in menu: HLS heights if loaded, else available muxed/all qualities
  const availableQualities = useMemo(() => {
    if (streamMode === 'hls' && hlsQualities.length > 0) {
      return hlsQualities;
    }
    if (details.allQualities.length > 0) {
      return details.allQualities;
    }
    return [720, 360];
  }, [streamMode, hlsQualities, details.allQualities]);

  const activeBadgeText =
    streamMode === 'hls'
      ? `${currentQuality}p HLS`
      : `${muxedStreams.best?.height || 720}p MP4`;

  const effectiveTime = isScrubbing ? scrubTimeSec : currentTime;
  const safeDuration = duration > 0 ? duration : 1;
  const playedPercent = Math.min(100, Math.max(0, (effectiveTime / safeDuration) * 100));
  const bufferedPercent = Math.min(100, Math.max(0, (bufferedEndSec / safeDuration) * 100));
  const isControlsVisible = showControls || !isPlaying || isScrubbing || showQualityMenu || showSpeedMenu || showCcMenu;
  const isMultiHourVideo = duration >= 3600;

  return (
    <div
      ref={containerRef}
      onMouseMove={scheduleHideControls}
      onMouseDown={scheduleHideControls}
      style={{ cursor: !isControlsVisible && isPlaying ? 'none' : 'default' }}
      className={`relative w-full bg-black select-none group overflow-hidden border border-white/[0.06] shadow-2xl ${
        isTheater ? 'h-[76vh] rounded-[12px]' : 'aspect-video rounded-[12px]'
      } flex items-center justify-center`}
    >
      {/* DUY NHẤT 1 THẺ <video> - Không dùng thẻ <audio> ẩn hay Virtual DASH */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
          scheduleHideControls();
        }}
        onCanPlay={() => setIsBuffering(false)}
        onPlay={() => {
          setIsPlaying(true);
          scheduleHideControls();
        }}
        onPause={() => {
          setIsPlaying(false);
          setShowControls(true);
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
          }
        }}
        onError={() => {
          if (isDestroyedRef.current) return;
          if (!videoRef.current?.currentSrc && !shakaPlayerRef.current) return;
          if (streamModeRef.current === 'hls' && muxedFallbackSrcRef.current) {
            showToast('HLS gặp sự cố, tự động chuyển sang MP4 trực tiếp');
            setStreamMode('muxed');
          } else {
            setIsBuffering(false);
            setPlaybackError('Trình duyệt không giải mã được luồng video này.');
          }
        }}
        onProgress={updateBufferedRange}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={() => {
          const d = videoRef.current?.duration;
          if (d && !isNaN(d) && isFinite(d) && d > 0 && Math.round(d) !== Math.round(durationRef.current)) {
            durationRef.current = d;
            setDuration(d);
          }
        }}
        onClick={togglePlay}
        className="w-full h-full object-contain"
      />

      {/* Buffering Spinner */}
      {isBuffering && !playbackError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none z-20">
          <div className="w-11 h-11 border-[3px] border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Playback Error & Retry Overlay */}
      {playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30 px-6 text-center space-y-3">
          <p className="text-sm font-semibold text-white max-w-md">{playbackError}</p>
          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-4 py-2 min-h-[40px] bg-yt-red hover:bg-red-700 text-white text-xs font-semibold rounded-[8px] transition-colors"
            >
              Thử lại
            </button>
            {streamMode === 'hls' && muxedFallbackSrc && (
              <button
                type="button"
                onClick={() => setStreamMode('muxed')}
                className="px-4 py-2 min-h-[40px] bg-[#222] hover:bg-[#2c2c2c] border border-white/10 text-white text-xs font-semibold rounded-[8px] transition-colors"
              >
                Chuyển sang MP4 trực tiếp
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast Notification (Pure rgba background, zero GPU backdrop-blur) */}
      {toastMessage && (
        <div className="absolute top-14 left-5 z-30 bg-[#141414]/95 text-white px-3.5 py-2 rounded-[8px] shadow-xl border border-white/10 flex items-center space-x-2 text-xs font-medium pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Subtitles Overlay (Automatically shifts down smoothly when controls auto-hide) */}
      {isCcEnabled && currentCueText && (
        <div
          className={`absolute left-0 right-0 flex justify-center pointer-events-none z-20 px-8 transition-[bottom] duration-300 ease-out ${
            isControlsVisible ? 'bottom-20' : 'bottom-6'
          }`}
        >
          <span className="bg-black/85 text-white text-base md:text-lg px-3.5 py-1.5 rounded-[8px] font-medium text-center shadow-lg whitespace-pre-wrap leading-snug border border-white/5">
            {currentCueText}
          </span>
        </div>
      )}

      {/* Top Title Bar Overlay (Smooth opacity + translateY transition) */}
      <div
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 100%)',
        }}
        className={`absolute top-0 left-0 right-0 px-5 pt-3.5 pb-6 flex items-center justify-between text-white text-sm font-semibold z-20 transition-[opacity,transform] duration-300 ease-out ${
          isControlsVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-3 pointer-events-none'
        }`}
      >
        <span className="truncate drop-shadow-sm">{details.title}</span>
        <span className="text-[11px] bg-[#1a1a1a]/90 border border-white/10 px-2.5 py-0.5 rounded-[8px] text-yt-subtext ml-4 flex-shrink-0 font-mono">
          {activeBadgeText}
        </span>
      </div>

      {/* Center Play Indicator when Paused */}
      {!isPlaying && !isBuffering && !playbackError && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute z-20 w-16 h-16 rounded-full bg-black/75 border border-white/15 flex items-center justify-center text-white hover:bg-yt-red hover:border-yt-red hover:scale-105 transition-all duration-200 shadow-2xl"
          title="Phát (Space)"
        >
          <Play className="w-7 h-7 fill-current ml-0.5" />
        </button>
      )}

      {/* Bottom Controls & Seekbar Overlay (Smooth opacity + translateY, soft bottom gradient, zero blur) */}
      <div
        onMouseEnter={() => {
          isHoveringControlsRef.current = true;
          setShowControls(true);
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
          }
        }}
        onMouseLeave={() => {
          isHoveringControlsRef.current = false;
          scheduleHideControls();
        }}
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.48) 65%, rgba(0,0,0,0) 100%)',
        }}
        className={`absolute bottom-0 left-0 right-0 px-4 pt-8 pb-3.5 flex flex-col space-y-2 z-20 transition-[opacity,transform] duration-300 ease-out ${
          isControlsVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        {/* Modern Cinema Seekbar (3.5px normal -> 6px on hover, buffered bar, thumb dot, time tooltip) */}
        <div
          ref={seekbarRef}
          onMouseDown={handleSeekbarMouseDown}
          onMouseMove={(e) => {
            const r = computeSeekRatioFromClientX(e.clientX);
            setHoverRatio(r);
          }}
          onMouseLeave={() => {
            if (!isScrubbingRef.current) {
              setHoverRatio(null);
            }
          }}
          className="relative h-5 flex items-center cursor-pointer group/seek select-none"
        >
          {/* Floating Time Tooltip on Hover / Scrub */}
          {hoverRatio !== null && duration > 0 && (
            <div
              style={{
                left: `${Math.min(95, Math.max(5, hoverRatio * 100))}%`,
              }}
              className="absolute -top-8 -translate-x-1/2 bg-[#141414]/95 border border-white/15 text-white text-[11px] font-mono font-semibold px-2 py-0.5 rounded-[6px] shadow-lg pointer-events-none whitespace-nowrap z-30"
            >
              {formatTime(hoverRatio * duration, isMultiHourVideo)}
            </div>
          )}

          {/* Track Background */}
          <div
            className={`relative w-full bg-white/20 rounded-full transition-[height] duration-150 ${
              isScrubbing ? 'h-[6px]' : 'h-[3.5px] group-hover/seek:h-[6px]'
            }`}
          >
            {/* Buffered Progress Layer (Translucent White) */}
            <div
              style={{ width: `${bufferedPercent}%` }}
              className="absolute left-0 top-0 bottom-0 bg-white/35 rounded-full pointer-events-none transition-[width] duration-200"
            />

            {/* Hover Preview Layer */}
            {hoverRatio !== null && (
              <div
                style={{ width: `${hoverRatio * 100}%` }}
                className="absolute left-0 top-0 bottom-0 bg-white/20 rounded-full pointer-events-none"
              />
            )}

            {/* SponsorBlock Segments */}
            {details.sponsorSegments?.map((seg) => {
              if (duration <= 0) return null;
              const left = (seg.startSec / duration) * 100;
              const width = ((seg.endSec - seg.startSec) / duration) * 100;
              return (
                <div
                  key={seg.uuid}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  className="absolute top-0 bottom-0 bg-emerald-400/85 rounded-full z-10"
                  title={seg.categoryLabel}
                />
              );
            })}

            {/* Played Progress Layer (Cinema Red) */}
            <div
              style={{ width: `${playedPercent}%` }}
              className="absolute left-0 top-0 bottom-0 bg-yt-red rounded-full pointer-events-none z-10"
            />

            {/* Thumb Handle (Dot appears smoothly on hover or drag) */}
            <div
              style={{ left: `${playedPercent}%` }}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-yt-red rounded-full shadow-md pointer-events-none z-20 transition-transform duration-150 ${
                isScrubbing ? 'scale-110' : 'scale-0 group-hover/seek:scale-100'
              }`}
            />
          </div>
        </div>

        {/* Controls Buttons Row */}
        <div className="flex items-center justify-between text-white text-xs">
          {/* Left Controls */}
          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={togglePlay}
              className="p-1.5 rounded-[8px] hover:bg-white/10 hover:text-white transition-colors"
              title={isPlaying ? 'Tạm dừng (K / Space)' : 'Phát (K / Space)'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            <button
              type="button"
              onClick={() => seek(currentTimeRef.current - 10)}
              className="p-1.5 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white transition-colors"
              title="Lùi 10s (J)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => seek(currentTimeRef.current + 10)}
              className="p-1.5 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white transition-colors"
              title="Tới 10s (L)"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume Control */}
            <div className="flex items-center space-x-1.5 pl-1">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1.5 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white transition-colors"
                title="Tắt/Bật tiếng (M)"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-16 h-1 accent-yt-red cursor-pointer"
              />
            </div>

            {/* Time Display */}
            <span className="text-[11px] text-white/85 font-mono pl-2 tracking-tight">
              {formatTime(effectiveTime, isMultiHourVideo)}{' '}
              <span className="text-white/40">/</span>{' '}
              <span className="text-white/65">{formatTime(duration, isMultiHourVideo)}</span>
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-1.5 relative">
            {/* Quick Switch to 720p Direct MP4 (itag 22 / 18) */}
            {muxedFallbackSrc && (
              <button
                type="button"
                onClick={() => {
                  const nextMode: StreamMode = streamMode === 'muxed' && hlsUrl ? 'hls' : 'muxed';
                  setStreamMode(nextMode);
                  showToast(
                    nextMode === 'muxed'
                      ? 'Đã chuyển sang 720p Trực tiếp (MP4 gộp)'
                      : 'Đã quay lại luồng HLS chất lượng cao'
                  );
                }}
                className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold border transition-colors ${
                  streamMode === 'muxed'
                    ? 'bg-yt-red text-white border-yt-red shadow'
                    : 'bg-white/[0.06] text-yt-subtext border-white/10 hover:text-white hover:bg-white/15'
                }`}
                title="Chuyển ngay sang luồng MP4 gộp hình+tiếng (itag 22/18) nếu bị lag hoặc YouTube bóp băng thông"
              >
                720p Trực tiếp
              </button>
            )}

            {/* Subtitles CC Toggle */}
            {details.captionTracks.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (!isCcEnabled) {
                      userRequestedCcRef.current = true;
                      setIsCcEnabled(true);
                      showToast('Đang tải phụ đề...');
                    } else {
                      setShowCcMenu(!showCcMenu);
                      setShowSpeedMenu(false);
                      setShowQualityMenu(false);
                    }
                  }}
                  className={`p-1.5 rounded-[8px] hover:bg-white/10 transition-colors ${
                    isCcEnabled ? 'text-white border-b-2 border-yt-red' : 'text-yt-subtext hover:text-white'
                  }`}
                  title={isCcLoading ? 'Đang tải phụ đề...' : 'Phụ đề (CC)'}
                >
                  <Subtitles className={`w-4 h-4 ${isCcLoading ? 'animate-pulse' : ''}`} />
                </button>

                {showCcMenu && (
                  <div className="absolute bottom-10 right-0 bg-[#141414]/95 border border-white/10 rounded-[8px] py-1.5 w-48 shadow-2xl text-xs z-30">
                    <div className="px-3 py-1 font-semibold text-yt-subtext border-b border-white/10">Phụ đề</div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCcEnabled(false);
                        setShowCcMenu(false);
                      }}
                      className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-white/10 text-left transition-colors"
                    >
                      <span>Tắt phụ đề</span>
                      {!isCcEnabled && <Check className="w-3.5 h-3.5 text-yt-red" />}
                    </button>
                    {details.captionTracks.map((track) => (
                      <button
                        key={track.languageTag}
                        type="button"
                        onClick={() => {
                          userRequestedCcRef.current = true;
                          setActiveCaption(track);
                          setIsCcEnabled(true);
                          setShowCcMenu(false);
                        }}
                        className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-white/10 text-left truncate transition-colors"
                      >
                        <span className="truncate">{track.label}</span>
                        {isCcEnabled && activeCaption?.languageTag === track.languageTag && (
                          <Check className="w-3.5 h-3.5 text-yt-red flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowCcMenu(false);
                  setShowQualityMenu(false);
                }}
                className="px-2 py-1 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white text-[11px] font-semibold transition-colors"
                title="Tốc độ phát"
              >
                {playbackRate}x
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-10 right-0 bg-[#141414]/95 border border-white/10 rounded-[8px] py-1.5 w-28 shadow-2xl text-xs z-30">
                  <div className="px-3 py-1 font-semibold text-yt-subtext border-b border-white/10">Tốc độ</div>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleSpeedChange(r)}
                      className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-white/10 text-left transition-colors"
                    >
                      <span>{r === 1 ? 'Chuẩn' : `${r}x`}</span>
                      {playbackRate === r && <Check className="w-3.5 h-3.5 text-yt-red" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quality Settings Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowQualityMenu(!showQualityMenu);
                  setShowCcMenu(false);
                  setShowSpeedMenu(false);
                }}
                className="p-1.5 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white transition-colors"
                title="Chất lượng hình ảnh"
              >
                <Settings className="w-4 h-4" />
              </button>

              {showQualityMenu && (
                <div className="absolute bottom-10 right-0 bg-[#141414]/95 border border-white/10 rounded-[8px] py-1.5 w-48 shadow-2xl text-xs z-30">
                  <div className="px-3 py-1 font-semibold text-yt-subtext border-b border-white/10">Chất lượng</div>
                  {availableQualities.map((q) => {
                    const isHdr = details.hdrQualities.includes(q);
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => handleQualityChange(q)}
                        className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-white/10 text-left transition-colors"
                      >
                        <span>
                          {q}p {isHdr ? 'HDR' : ''}
                        </span>
                        {streamMode === 'hls' && currentQuality === q && (
                          <Check className="w-3.5 h-3.5 text-yt-red" />
                        )}
                      </button>
                    );
                  })}

                  {muxedFallbackSrc && (
                    <div className="pt-1 mt-1 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => {
                          const nextMode: StreamMode = streamMode === 'muxed' && hlsUrl ? 'hls' : 'muxed';
                          setStreamMode(nextMode);
                          setShowQualityMenu(false);
                          showToast(
                            nextMode === 'muxed' ? 'Đã bật MP4 gộp (itag 22/18)' : 'Đã bật HLS chính chủ'
                          );
                        }}
                        className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-white/10 text-left text-yt-subtext hover:text-white transition-colors"
                      >
                        <span className="truncate">Chế độ MP4 gộp trực tiếp</span>
                        {streamMode === 'muxed' && <Check className="w-3.5 h-3.5 text-yt-red flex-shrink-0" />}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theater Mode Toggle */}
            <button
              type="button"
              onClick={onToggleTheater}
              className="p-1.5 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white transition-colors"
              title={isTheater ? 'Chế độ mặc định (T)' : 'Chế độ rạp hát (T)'}
            >
              <Tv className={`w-4 h-4 ${isTheater ? 'text-yt-red' : ''}`} />
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded-[8px] hover:bg-white/10 text-yt-subtext hover:text-white transition-colors"
              title="Toàn màn hình (F)"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
