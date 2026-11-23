import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.js';
import { Sidebar, NavTab } from './components/Sidebar.js';
import { VideoGrid } from './components/VideoGrid.js';
import { WatchScreen } from './components/WatchScreen.js';
import { ShortsScreen } from './components/ShortsScreen.js';
import { MusicScreen, RepeatMode } from './components/MusicScreen.js';
import { MusicMiniPlayer } from './components/MusicMiniPlayer.js';
import { GoogleSignInModal } from './components/GoogleSignInModal.js';
import { desktopAPI, initProxyPort } from './api.js';
import {
  AuthAccountProfile,
  FavoriteItemUI,
  HistoryItemUI,
  MusicTrackItem,
  ResumeItemUI,
  VideoItemUI,
} from './types.js';

export type ActiveView =
  | 'home'
  | 'shorts'
  | 'music'
  | 'subscriptions'
  | 'history'
  | 'watch_later'
  | 'favorites'
  | 'search'
  | 'watch';

export const App: React.FC = () => {
  // Single Source of Truth for UI Navigation
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const lastBrowseViewRef = useRef<NavTab>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  // Google Account State
  const [authAccount, setAuthAccount] = useState<AuthAccountProfile | null>(null);
  const [showSignInModal, setShowSignInModal] = useState<boolean>(false);

  // Selected Video & PiP Window State
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [initialSeekSec, setInitialSeekSec] = useState<number>(0);
  const [isPipMode, setIsPipMode] = useState<boolean>(false);
  const isPipModeRef = useRef<boolean>(false);
  isPipModeRef.current = isPipMode;

  // Explicit Search States + Sequence counter to prevent stale search race conditions
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<VideoItemUI[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [musicSearchExternal, setMusicSearchExternal] = useState<string>('');
  const searchSeqRef = useRef<number>(0);

  // Feed States
  const [homeVideos, setHomeVideos] = useState<VideoItemUI[]>([]);
  const [subscriptionVideos, setSubscriptionVideos] = useState<VideoItemUI[]>([]);
  const [ytHistoryVideos, setYtHistoryVideos] = useState<VideoItemUI[]>([]);
  const [watchLaterVideos, setWatchLaterVideos] = useState<VideoItemUI[]>([]);
  const [historyVideos, setHistoryVideos] = useState<HistoryItemUI[]>([]);
  const [favoriteVideos, setFavoriteVideos] = useState<FavoriteItemUI[]>([]);
  const [resumes, setResumes] = useState<Record<string, ResumeItemUI>>({});
  const [loadingFeed, setLoadingFeed] = useState<boolean>(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [favoritesSet, setFavoritesSet] = useState<Set<string>>(new Set());
  const [watchLaterSet, setWatchLaterSet] = useState<Set<string>>(new Set());

  // Persistent YouTube Music Audio Player States
  const [musicTrack, setMusicTrack] = useState<MusicTrackItem | null>(null);
  const [musicQueue, setMusicQueue] = useState<MusicTrackItem[]>([]);
  const [musicPlaying, setMusicPlaying] = useState<boolean>(false);
  const [musicLoading, setMusicLoading] = useState<boolean>(false);
  const [musicCurrentTime, setMusicCurrentTime] = useState<number>(0);
  const [musicDuration, setMusicDuration] = useState<number>(0);
  const [musicVolume, setMusicVolume] = useState<number>(0.9);
  const [musicMuted, setMusicMuted] = useState<boolean>(false);
  const [musicShuffle, setMusicShuffle] = useState<boolean>(false);
  const [musicRepeat, setMusicRepeat] = useState<RepeatMode>('off');

  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicLoadSeqRef = useRef<number>(0);

  // Synchronous cleanup callback registered by active AvSyncPlayer or ShortsScreen
  const playerCleanupRef = useRef<(() => void) | null>(null);
  const registerPlayerCleanup = useCallback((cleanupFn: () => void) => {
    playerCleanupRef.current = cleanupFn;
  }, []);

  const stopActivePlayer = useCallback(() => {
    if (playerCleanupRef.current) {
      try {
        playerCleanupRef.current();
      } catch {
        // Ignore teardown errors
      }
      playerCleanupRef.current = null;
    }
  }, []);

  const pauseMusicPlayer = useCallback(() => {
    const audio = musicAudioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      setMusicPlaying(false);
    }
  }, []);

  const loadHomeVideos = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const items = await desktopAPI.getHomeVideos();
      setHomeVideos(items || []);
    } catch {
      setHomeVideos([]);
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const items = await desktopAPI.getSubscriptionsVideos();
      setSubscriptionVideos(items || []);
    } catch (err: any) {
      setFeedError(err?.message || String(err) || 'Không thể tải danh sách Kênh đăng ký.');
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadHistory = useCallback(async (signedIn: boolean) => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const localPromise = desktopAPI.getHistory(100);
      if (signedIn) {
        const [cloudRes, localRes] = await Promise.allSettled([
          desktopAPI.getYouTubeHistory(),
          localPromise,
        ]);
        if (localRes.status === 'fulfilled' && localRes.value) {
          setHistoryVideos(localRes.value);
        }
        if (cloudRes.status === 'fulfilled') {
          setYtHistoryVideos(cloudRes.value || []);
        } else {
          setYtHistoryVideos([]);
          setFeedError(
            cloudRes.reason?.message || 'Không đồng bộ được lịch sử Google, đang hiển thị lịch sử máy.'
          );
        }
      } else {
        const localHistory = await localPromise;
        setYtHistoryVideos([]);
        if (localHistory) setHistoryVideos(localHistory);
      }
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadWatchLater = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingFeed(true);
      setFeedError(null);
    }
    try {
      const items = await desktopAPI.getWatchLaterVideos();
      const safeItems = items || [];
      setWatchLaterVideos(safeItems);
      setWatchLaterSet(new Set(safeItems.map((v) => v.id)));
    } catch (err: any) {
      if (!silent) {
        setFeedError(err?.message || String(err) || 'Không thể tải danh sách Xem sau.');
      }
    } finally {
      if (!silent) {
        setLoadingFeed(false);
      }
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const favs = await desktopAPI.getFavorites();
      if (favs) {
        setFavoriteVideos(favs);
        setFavoritesSet(new Set(favs.map((f: FavoriteItemUI) => f.id)));
      }
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const refreshResumes = useCallback(() => {
    desktopAPI.getAllResumes().then((map) => {
      if (map) setResumes(map);
    });
  }, []);

  // 1. Initial Data & Auth Account Loading (Runs ONCE on mount)
  useEffect(() => {
    initProxyPort().catch(() => {});
    refreshResumes();

    desktopAPI.getFavorites().then((favs: FavoriteItemUI[]) => {
      if (favs) {
        setFavoriteVideos(favs);
        setFavoritesSet(new Set(favs.map((f: FavoriteItemUI) => f.id)));
      }
    });

    desktopAPI
      .getAuthAccount()
      .then((acc) => {
        setAuthAccount(acc);
        if (acc) {
          loadWatchLater(true);
        }
        loadHomeVideos();
      })
      .catch(() => {
        loadHomeVideos();
      });
  }, [loadHomeVideos, loadWatchLater, refreshResumes]);

  // 2. Music Playback Controller (Persistent audio-only proxy stream)
  const playMusicTrack = useCallback(
    async (track: MusicTrackItem, queueList?: MusicTrackItem[]) => {
      // Stop any running video player so audio never clashes
      stopActivePlayer();

      const seq = ++musicLoadSeqRef.current;
      setMusicTrack(track);
      setMusicCurrentTime(0);
      setMusicDuration(track.durationSec || 0);
      setMusicLoading(true);
      if (queueList && queueList.length > 0) {
        setMusicQueue(queueList);
      } else {
        setMusicQueue((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
      }

      const audio = musicAudioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }

      try {
        const res = await desktopAPI.getMusicAudioStream(track.id, track.playlistId);
        if (musicLoadSeqRef.current !== seq) return;

        const enrichedTrack: MusicTrackItem = {
          ...track,
          title: track.title || res.title,
          artist: track.artist || res.artist,
          durationSec: res.durationSec || track.durationSec,
          thumbnail: track.thumbnail || res.thumbnail,
        };
        setMusicTrack(enrichedTrack);
        setMusicDuration(res.durationSec || track.durationSec || 0);

        if (res.radioTracks && res.radioTracks.length > 0) {
          setMusicQueue((prev) => {
            if (prev.length > 1) return prev;
            const seen = new Set<string>([enrichedTrack.id]);
            const merged = [enrichedTrack];
            for (const r of res.radioTracks) {
              if (!seen.has(r.id)) {
                seen.add(r.id);
                merged.push(r);
              }
            }
            return merged;
          });
        }

        if (musicAudioRef.current) {
          musicAudioRef.current.src = res.proxyAudioUrl;
          musicAudioRef.current.volume = musicMuted ? 0 : musicVolume;
          musicAudioRef.current.load();
          await musicAudioRef.current.play();
          if (musicLoadSeqRef.current === seq) {
            setMusicPlaying(true);
          }
        }
      } catch {
        if (musicLoadSeqRef.current === seq) {
          setMusicPlaying(false);
        }
      } finally {
        if (musicLoadSeqRef.current === seq) {
          setMusicLoading(false);
        }
      }
    },
    [stopActivePlayer, musicMuted, musicVolume]
  );

  const handleMusicTogglePlay = useCallback(() => {
    const audio = musicAudioRef.current;
    if (!audio || !musicTrack) return;
    if (audio.paused) {
      audio.play().then(() => setMusicPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setMusicPlaying(false);
    }
  }, [musicTrack]);

  const handleMusicNext = useCallback(() => {
    if (!musicTrack || musicQueue.length === 0) return;
    if (musicRepeat === 'one') {
      if (musicAudioRef.current) {
        musicAudioRef.current.currentTime = 0;
        musicAudioRef.current.play().then(() => setMusicPlaying(true)).catch(() => {});
      }
      return;
    }

    if (musicShuffle && musicQueue.length > 1) {
      const candidates = musicQueue.filter((t) => t.id !== musicTrack.id);
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      if (picked) playMusicTrack(picked, musicQueue);
      return;
    }

    const idx = musicQueue.findIndex((t) => t.id === musicTrack.id);
    if (idx >= 0 && idx + 1 < musicQueue.length) {
      playMusicTrack(musicQueue[idx + 1], musicQueue);
    } else if (musicRepeat === 'all' && musicQueue.length > 0) {
      playMusicTrack(musicQueue[0], musicQueue);
    } else {
      setMusicPlaying(false);
    }
  }, [musicTrack, musicQueue, musicRepeat, musicShuffle, playMusicTrack]);

  const handleMusicPrev = useCallback(() => {
    const audio = musicAudioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (!musicTrack || musicQueue.length === 0) return;
    const idx = musicQueue.findIndex((t) => t.id === musicTrack.id);
    if (idx > 0) {
      playMusicTrack(musicQueue[idx - 1], musicQueue);
    } else if (musicRepeat === 'all' && musicQueue.length > 0) {
      playMusicTrack(musicQueue[musicQueue.length - 1], musicQueue);
    }
  }, [musicTrack, musicQueue, musicRepeat, playMusicTrack]);

  const handleMusicSeek = useCallback((sec: number) => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    audio.currentTime = sec;
    setMusicCurrentTime(sec);
  }, []);

  const handleMusicClose = useCallback(() => {
    musicLoadSeqRef.current += 1;
    const audio = musicAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setMusicPlaying(false);
    setMusicLoading(false);
    setMusicTrack(null);
    setMusicCurrentTime(0);
    setMusicDuration(0);
  }, []);

  // 3. Unified Navigation Controller (Sidebar & Logo clicks)
  const enterPipMode = useCallback(async () => {
    if (isPipModeRef.current) return;
    try {
      await desktopAPI.enterPipMode();
      setIsPipMode(true);
    } catch {
      // Ignore native window PiP errors
    }
  }, []);

  const exitPipMode = useCallback(async () => {
    if (!isPipModeRef.current) return;
    setIsPipMode(false);
    try {
      await desktopAPI.exitPipMode();
    } catch {
      // Ignore native window restore errors
    }
  }, []);

  const togglePipMode = useCallback(() => {
    if (isPipModeRef.current) {
      exitPipMode();
    } else {
      enterPipMode();
    }
  }, [enterPipMode, exitPipMode]);

  useEffect(() => {
    return () => {
      if (isPipModeRef.current) {
        desktopAPI.exitPipMode().catch(() => {});
      }
    };
  }, []);

  const navigateTo = useCallback(
    (targetView: NavTab) => {
      if (isPipModeRef.current) {
        exitPipMode();
      }
      // Step 1: Synchronously destroy any active video/shorts player
      stopActivePlayer();

      // Pause background Music audio if user opens Shorts (music continues on browse/watch-later/etc.)
      if (targetView === 'shorts') {
        pauseMusicPlayer();
      }

      // Step 2: Invalidate any in-flight search request and clear all search state
      searchSeqRef.current += 1;
      setIsSearching(false);
      setSearchQuery('');
      setSearchInput('');
      setSearchResults([]);
      setFeedError(null);

      // Step 3: Clear selected video and switch activeView cleanly
      setSelectedVideo(null);
      lastBrowseViewRef.current = targetView;
      setActiveView(targetView);

      // Step 4: Refresh data for the target tab
      refreshResumes();
      if (targetView === 'home') {
        if (homeVideos.length === 0) {
          loadHomeVideos();
        }
      } else if (targetView === 'subscriptions') {
        if (authAccount) {
          loadSubscriptions();
        } else {
          setLoadingFeed(false);
        }
      } else if (targetView === 'history') {
        loadHistory(Boolean(authAccount));
      } else if (targetView === 'watch_later') {
        if (authAccount) {
          loadWatchLater(false);
        } else {
          setLoadingFeed(false);
        }
      } else if (targetView === 'favorites') {
        loadFavorites();
      }
    },
    [
      stopActivePlayer,
      pauseMusicPlayer,
      refreshResumes,
      homeVideos.length,
      loadHomeVideos,
      authAccount,
      loadSubscriptions,
      loadHistory,
      loadWatchLater,
      loadFavorites,
      exitPipMode,
    ]
  );

  const handleClosePip = useCallback(async () => {
    stopActivePlayer();
    await exitPipMode();
    setSelectedVideo(null);
    if (searchQuery && searchResults.length > 0) {
      setActiveView('search');
    } else {
      navigateTo(lastBrowseViewRef.current);
    }
  }, [stopActivePlayer, exitPipMode, searchQuery, searchResults.length, navigateTo]);

  const handleSelectTab = useCallback(
    (tab: NavTab) => {
      navigateTo(tab);
    },
    [navigateTo]
  );

  // 4. Auth Callbacks
  const handleSignedIn = useCallback(
    (account: AuthAccountProfile) => {
      setAuthAccount(account);
      setShowSignInModal(false);
      setFeedError(null);
      loadWatchLater(true);
      loadHomeVideos();

      if (activeView === 'subscriptions') {
        loadSubscriptions();
      } else if (activeView === 'history') {
        loadHistory(true);
      } else if (activeView === 'watch_later') {
        loadWatchLater(false);
      }
    },
    [activeView, loadHomeVideos, loadSubscriptions, loadHistory, loadWatchLater]
  );

  const handleSignOut = useCallback(async () => {
    try {
      await desktopAPI.signOut();
    } catch {
      // Ignore sign out error
    }
    setAuthAccount(null);
    setSubscriptionVideos([]);
    setWatchLaterVideos([]);
    setWatchLaterSet(new Set());
    setYtHistoryVideos([]);
    setFeedError(null);

    if (activeView === 'history') {
      loadHistory(false);
    } else {
      loadHomeVideos();
    }
  }, [activeView, loadHistory, loadHomeVideos]);

  // 5. Select Video to Watch
  const handleSelectVideo = useCallback(
    (videoId: string) => {
      stopActivePlayer();
      pauseMusicPlayer();

      const resume = resumes[videoId];
      const startSec =
        resume && resume.positionMs > 10000 ? Math.floor(resume.positionMs / 1000) : 0;
      setInitialSeekSec(startSec);
      setSelectedVideo(videoId);
      setActiveView('watch');
    },
    [stopActivePlayer, pauseMusicPlayer, resumes]
  );

  // 6. Search Handler (Routes Music searches in Music Mode, else Video search / URL paste)
  const handleSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      // Check if input is a direct YouTube URL
      const watchMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
      const shortMatch = trimmed.match(/(?:youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
      const directId = watchMatch ? watchMatch[1] : shortMatch ? shortMatch[1] : null;

      if (directId) {
        handleSelectVideo(directId);
        return;
      }

      if (activeView === 'music') {
        setMusicSearchExternal(trimmed);
        return;
      }

      stopActivePlayer();

      const seq = ++searchSeqRef.current;
      setSelectedVideo(null);
      setSearchQuery(trimmed);
      setSearchInput(trimmed);
      setActiveView('search');
      setIsSearching(true);
      setFeedError(null);

      try {
        const results = await desktopAPI.searchVideos(trimmed);
        if (searchSeqRef.current !== seq) return;
        setSearchResults(results || []);
      } catch {
        if (searchSeqRef.current !== seq) return;
        setSearchResults([]);
      } finally {
        if (searchSeqRef.current === seq) {
          setIsSearching(false);
        }
      }
    },
    [activeView, handleSelectVideo, stopActivePlayer]
  );

  // 7. Toggle Favorite from Card
  const handleToggleFavorite = async (item: VideoItemUI) => {
    const isFavNow = await desktopAPI.toggleFavorite({
      id: item.id,
      title: item.title,
      channel: item.channel,
      thumbnail: item.thumbnail,
      durationSec: item.durationSec || 0,
    });

    setFavoritesSet((prev) => {
      const next = new Set(prev);
      if (isFavNow) next.add(item.id);
      else next.delete(item.id);
      return next;
    });

    if (activeView === 'favorites') {
      loadFavorites();
    }
  };

  // 8. Toggle Watch Later (Google WL Playlist)
  const handleToggleWatchLater = useCallback(
    async (item: VideoItemUI) => {
      if (!authAccount) {
        setShowSignInModal(true);
        return;
      }

      const wasIn = watchLaterSet.has(item.id);
      setWatchLaterSet((prev) => {
        const next = new Set(prev);
        if (wasIn) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      if (wasIn) {
        setWatchLaterVideos((prev) => prev.filter((v) => v.id !== item.id));
      } else {
        setWatchLaterVideos((prev) => [item, ...prev.filter((v) => v.id !== item.id)]);
      }

      try {
        if (wasIn) {
          await desktopAPI.removeFromWatchLater(item.id);
        } else {
          await desktopAPI.addToWatchLater(item.id);
        }
      } catch (err: any) {
        setWatchLaterSet((prev) => {
          const next = new Set(prev);
          if (wasIn) next.add(item.id);
          else next.delete(item.id);
          return next;
        });
        loadWatchLater(activeView !== 'watch_later');
        setFeedError(err?.message || 'Không thể cập nhật danh sách Xem sau.');
      }
    },
    [authAccount, watchLaterSet, activeView, loadWatchLater]
  );

  // 9. History Management
  const handleClearHistory = async () => {
    await desktopAPI.clearHistory();
    setHistoryVideos([]);
  };

  const handleDeleteHistoryItem = async (id: string) => {
    await desktopAPI.deleteHistoryItem(id);
    setHistoryVideos((prev) => prev.filter((item) => item.id !== id));
  };

  const formatDurationBadge = (sec?: number) => {
    if (!sec) return undefined;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const usingCloudHistory = Boolean(authAccount && ytHistoryVideos.length > 0);
  const displayedHistoryItems: VideoItemUI[] = usingCloudHistory
    ? ytHistoryVideos
    : historyVideos.map((h) => ({
        id: h.id,
        title: h.title,
        channel: h.channel,
        thumbnail: h.thumbnail,
        durationSec: h.durationSec,
        durationText: formatDurationBadge(h.durationSec),
        publishedText: new Date(h.watchedAt).toLocaleDateString('vi-VN'),
      }));

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-yt-bg text-yt-text">
      {/* Top Header (hidden during PiP while keeping WatchScreen tree intact) */}
      {!isPipMode && (
        <Header
          searchTerm={searchInput}
          onSearchTermChange={setSearchInput}
          onSearch={handleSearch}
          onGoHome={() => navigateTo('home')}
          account={authAccount}
          onOpenSignIn={() => setShowSignInModal(true)}
          onSignOut={handleSignOut}
        />
      )}

      {/* Hidden Persistent Audio Element for YouTube Music Mode */}
      <audio
        ref={musicAudioRef}
        onTimeUpdate={() => {
          if (musicAudioRef.current) {
            setMusicCurrentTime(musicAudioRef.current.currentTime || 0);
          }
        }}
        onDurationChange={() => {
          const d = musicAudioRef.current?.duration;
          if (d && isFinite(d) && d > 0) setMusicDuration(d);
        }}
        onPlay={() => setMusicPlaying(true)}
        onPause={() => setMusicPlaying(false)}
        onEnded={handleMusicNext}
        className="hidden"
      />

      {/* Main Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar: hidden in PiP mode without shifting main's tree slot */}
        {!isPipMode && (
          <Sidebar
            activeView={activeView}
            onSelectTab={handleSelectTab}
            collapsed={activeView === 'watch' ? true : sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          />
        )}

        {/* Content Region */}
        <main className="flex-1 h-full overflow-hidden bg-yt-bg relative">
          {activeView === 'watch' && selectedVideo ? (
            <WatchScreen
              key={selectedVideo}
              videoId={selectedVideo}
              initialPositionSec={initialSeekSec}
              onRegisterCleanup={registerPlayerCleanup}
              isSignedIn={Boolean(authAccount)}
              isWatchLater={watchLaterSet.has(selectedVideo)}
              onToggleWatchLater={handleToggleWatchLater}
              onOpenSignIn={() => setShowSignInModal(true)}
              isPipMode={isPipMode}
              onTogglePip={togglePipMode}
              onExitPip={exitPipMode}
              onClosePip={handleClosePip}
              onBack={() => {
                stopActivePlayer();
                if (isPipModeRef.current) {
                  exitPipMode();
                }
                setSelectedVideo(null);
                if (searchQuery && searchResults.length > 0) {
                  setActiveView('search');
                } else {
                  navigateTo(lastBrowseViewRef.current);
                }
              }}
              onSelectRelated={handleSelectVideo}
            />
          ) : activeView === 'shorts' ? (
            <ShortsScreen
              isSignedIn={Boolean(authAccount)}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
              onOpenSignIn={() => setShowSignInModal(true)}
              onOpenInWatch={handleSelectVideo}
              onRegisterCleanup={registerPlayerCleanup}
            />
          ) : activeView === 'music' ? (
            <MusicScreen
              currentTrack={musicTrack}
              isPlaying={musicPlaying}
              isLoadingTrack={musicLoading}
              currentTime={musicCurrentTime}
              duration={musicDuration}
              shuffle={musicShuffle}
              repeatMode={musicRepeat}
              queue={musicQueue}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              externalQuery={musicSearchExternal}
              onConsumeExternalQuery={() => setMusicSearchExternal('')}
              onPlayTrack={playMusicTrack}
              onAddToQueue={(t) =>
                setMusicQueue((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]))
              }
              onTogglePlay={handleMusicTogglePlay}
              onNext={handleMusicNext}
              onPrev={handleMusicPrev}
              onSeek={handleMusicSeek}
              onToggleShuffle={() => setMusicShuffle((s) => !s)}
              onCycleRepeat={() =>
                setMusicRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
              }
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
            />
          ) : activeView === 'search' ? (
            <VideoGrid
              title={`Kết quả cho: "${searchQuery}"`}
              subtitle={isSearching ? 'Đang tìm kiếm...' : `Tìm thấy ${searchResults.length} video`}
              items={searchResults}
              loading={isSearching}
              resumes={resumes}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
            />
          ) : activeView === 'subscriptions' ? (
            <VideoGrid
              title="Kênh đăng ký"
              subtitle={
                authAccount
                  ? feedError || `Video mới nhất từ các kênh của ${authAccount.name}`
                  : 'Đăng nhập Google để xem video mới từ các kênh đã đăng ký'
              }
              items={authAccount ? subscriptionVideos : []}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
              emptyTitle={
                authAccount ? 'Chưa có video mới từ kênh đăng ký' : 'Bạn chưa đăng nhập Google'
              }
              emptySubtitle={
                authAccount
                  ? feedError || 'Các video mới từ kênh bạn theo dõi sẽ hiển thị tại đây.'
                  : 'Đăng nhập tài khoản Google để xem danh sách video mới từ các kênh bạn đã đăng ký.'
              }
              emptyAction={
                !authAccount
                  ? { label: 'Đăng nhập Google', onClick: () => setShowSignInModal(true) }
                  : undefined
              }
            />
          ) : activeView === 'history' ? (
            <VideoGrid
              title="Lịch sử xem"
              subtitle={
                usingCloudHistory
                  ? `Đồng bộ trực tiếp với tài khoản ${authAccount?.name}`
                  : feedError || 'Các video bạn đã mở xem gần đây'
              }
              items={displayedHistoryItems}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
              onClearHistory={usingCloudHistory ? undefined : handleClearHistory}
              onDeleteHistoryItem={usingCloudHistory ? undefined : handleDeleteHistoryItem}
              showClearHistory={!usingCloudHistory}
            />
          ) : activeView === 'watch_later' ? (
            <VideoGrid
              title="Xem sau"
              subtitle={
                authAccount
                  ? feedError || `${watchLaterVideos.length} video trong danh sách Xem sau`
                  : 'Đăng nhập Google để xem danh sách Xem sau của bạn'
              }
              items={authAccount ? watchLaterVideos : []}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
              emptyTitle={
                authAccount ? 'Danh sách Xem sau đang trống' : 'Bạn chưa đăng nhập Google'
              }
              emptySubtitle={
                authAccount
                  ? feedError ||
                    'Nhấn biểu tượng đồng hồ trên thẻ video hoặc nút Xem sau khi phát để lưu.'
                  : 'Đăng nhập tài khoản Google để truy cập và thêm/xóa video khỏi danh sách Xem sau.'
              }
              emptyAction={
                !authAccount
                  ? { label: 'Đăng nhập Google', onClick: () => setShowSignInModal(true) }
                  : undefined
              }
            />
          ) : activeView === 'favorites' ? (
            <VideoGrid
              title="Video đã lưu / Yêu thích"
              subtitle={`${favoriteVideos.length} video`}
              items={favoriteVideos.map((f) => ({
                id: f.id,
                title: f.title,
                channel: f.channel,
                thumbnail: f.thumbnail,
                durationSec: f.durationSec,
                durationText: formatDurationBadge(f.durationSec),
              }))}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
            />
          ) : (
            <VideoGrid
              title={authAccount ? 'Đề xuất cho bạn' : 'Khám phá video'}
              subtitle={
                authAccount
                  ? `Trang chủ cá nhân hóa theo tài khoản ${authAccount.name}`
                  : 'Các video nổi bật được cập nhật liên tục'
              }
              items={homeVideos}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              watchLaterSet={watchLaterSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onToggleWatchLater={handleToggleWatchLater}
            />
          )}
        </main>
      </div>

      {/* Persistent Docked Bottom Mini-Player for YouTube Music Mode */}
      {!isPipMode && musicTrack && (
        <MusicMiniPlayer
          track={musicTrack}
          isPlaying={musicPlaying}
          isLoading={musicLoading}
          currentTime={musicCurrentTime}
          duration={musicDuration}
          volume={musicMuted ? 0 : musicVolume}
          isMuted={musicMuted}
          shuffle={musicShuffle}
          repeatMode={musicRepeat}
          onOpenMusic={() => navigateTo('music')}
          onTogglePlay={handleMusicTogglePlay}
          onNext={handleMusicNext}
          onPrev={handleMusicPrev}
          onSeek={handleMusicSeek}
          onVolumeChange={(v) => {
            setMusicVolume(v);
            setMusicMuted(v === 0);
            if (musicAudioRef.current) {
              musicAudioRef.current.volume = v;
              musicAudioRef.current.muted = v === 0;
            }
          }}
          onToggleMute={() => {
            const next = !musicMuted;
            setMusicMuted(next);
            if (musicAudioRef.current) {
              musicAudioRef.current.muted = next;
            }
          }}
          onToggleShuffle={() => setMusicShuffle((s) => !s)}
          onCycleRepeat={() =>
            setMusicRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
          }
          onClose={handleMusicClose}
        />
      )}

      {/* Google Device OAuth2 Sign-In Modal */}
      {!isPipMode && (
        <GoogleSignInModal
          isOpen={showSignInModal}
          onClose={() => setShowSignInModal(false)}
          onSignedIn={handleSignedIn}
        />
      )}
    </div>
  );
};
