import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.js';
import { Sidebar, NavTab } from './components/Sidebar.js';
import { VideoGrid } from './components/VideoGrid.js';
import { WatchScreen } from './components/WatchScreen.js';
import { desktopAPI } from './api.js';
import { VideoItemUI, HistoryItemUI, FavoriteItemUI, ResumeItemUI } from './types.js';

export type ActiveView = 'home' | 'trending' | 'search' | 'history' | 'favorites' | 'watch';

export const App: React.FC = () => {
  // Single Source of Truth for UI Navigation
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  // Selected Video State
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [initialSeekSec, setInitialSeekSec] = useState<number>(0);

  // Explicit Search States + Sequence counter to prevent stale search race conditions
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<VideoItemUI[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const searchSeqRef = useRef<number>(0);

  // Feed States
  const [homeVideos, setHomeVideos] = useState<VideoItemUI[]>([]);
  const [historyVideos, setHistoryVideos] = useState<HistoryItemUI[]>([]);
  const [favoriteVideos, setFavoriteVideos] = useState<FavoriteItemUI[]>([]);
  const [resumes, setResumes] = useState<Record<string, ResumeItemUI>>({});
  const [loadingFeed, setLoadingFeed] = useState<boolean>(false);
  const [favoritesSet, setFavoritesSet] = useState<Set<string>>(new Set());

  // Synchronous cleanup callback registered by active AvSyncPlayer (destroys Shaka/HLS & stops <video> immediately)
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

  const loadHomeVideos = useCallback(async () => {
    setLoadingFeed(true);
    try {
      const trending = await desktopAPI.getTrendingVideos();
      if (trending && trending.length > 0) {
        setHomeVideos(trending);
      }
    } catch {
      // Fallback
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingFeed(true);
    try {
      const history = await desktopAPI.getHistory(100);
      if (history) setHistoryVideos(history);
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    setLoadingFeed(true);
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

  // 1. Initial Data Loading (Runs ONCE on mount)
  useEffect(() => {
    refreshResumes();

    desktopAPI.getFavorites().then((favs: FavoriteItemUI[]) => {
      if (favs) {
        setFavoriteVideos(favs);
        setFavoritesSet(new Set(favs.map((f: FavoriteItemUI) => f.id)));
      }
    });

    loadHomeVideos();
  }, [loadHomeVideos, refreshResumes]);

  // 2. Unified Navigation Controller (Sidebar & Logo clicks)
  const navigateTo = useCallback(
    (targetView: Exclude<ActiveView, 'watch' | 'search'>) => {
      // Step 1: Synchronously destroy any active video player so nothing keeps running in background
      stopActivePlayer();

      // Step 2: Invalidate any in-flight search request and clear all search state
      searchSeqRef.current += 1;
      setIsSearching(false);
      setSearchQuery('');
      setSearchInput('');
      setSearchResults([]);

      // Step 3: Clear selected video and switch activeView cleanly
      setSelectedVideo(null);
      setActiveView(targetView);

      // Step 4: Refresh data for the target tab
      refreshResumes();
      if (targetView === 'home' || targetView === 'trending') {
        if (homeVideos.length === 0) {
          loadHomeVideos();
        }
      } else if (targetView === 'history') {
        loadHistory();
      } else if (targetView === 'favorites') {
        loadFavorites();
      }
    },
    [stopActivePlayer, refreshResumes, homeVideos.length, loadHomeVideos, loadHistory, loadFavorites]
  );

  const handleSelectTab = useCallback(
    (tab: NavTab) => {
      navigateTo(tab);
    },
    [navigateTo]
  );

  // 3. Select Video to Watch
  const handleSelectVideo = useCallback(
    (videoId: string) => {
      // Tear down previous player before switching videos
      stopActivePlayer();

      const resume = resumes[videoId];
      const startSec = resume && resume.positionMs > 10000 ? Math.floor(resume.positionMs / 1000) : 0;
      setInitialSeekSec(startSec);
      setSelectedVideo(videoId);
      setActiveView('watch');
    },
    [stopActivePlayer, resumes]
  );

  // 4. Search Handler (Supports search queries or direct YouTube URL pasting)
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

      // Stop any running video player immediately
      stopActivePlayer();

      const seq = ++searchSeqRef.current;
      setSelectedVideo(null);
      setSearchQuery(trimmed);
      setSearchInput(trimmed);
      setActiveView('search');
      setIsSearching(true);

      try {
        const results = await desktopAPI.searchVideos(trimmed);
        // Ignore stale results if the user already navigated to another tab
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
    [handleSelectVideo, stopActivePlayer]
  );

  // 5. Toggle Favorite from Card
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

  // 6. History Management
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-yt-bg text-yt-text">
      {/* Top Header */}
      <Header
        searchTerm={searchInput}
        onSearchTermChange={setSearchInput}
        onSearch={handleSearch}
        onGoHome={() => navigateTo('home')}
      />

      {/* Main Body */}
      <div className="flex flex-1 h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Sidebar: always accessible (compact rail in watch mode so user can switch tabs anytime) */}
        <Sidebar
          activeView={activeView}
          onSelectTab={handleSelectTab}
          collapsed={activeView === 'watch' ? true : sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />

        {/* Content Region */}
        <main className="flex-1 h-full overflow-hidden bg-yt-bg relative">
          {activeView === 'watch' && selectedVideo ? (
            <WatchScreen
              key={selectedVideo}
              videoId={selectedVideo}
              initialPositionSec={initialSeekSec}
              onRegisterCleanup={registerPlayerCleanup}
              onBack={() => {
                stopActivePlayer();
                setSelectedVideo(null);
                if (searchQuery && searchResults.length > 0) {
                  setActiveView('search');
                } else {
                  navigateTo('home');
                }
              }}
              onSelectRelated={handleSelectVideo}
            />
          ) : activeView === 'search' ? (
            <VideoGrid
              title={`Kết quả cho: "${searchQuery}"`}
              subtitle={isSearching ? 'Đang tìm kiếm...' : `Tìm thấy ${searchResults.length} video`}
              items={searchResults}
              loading={isSearching}
              resumes={resumes}
              favoritesSet={favoritesSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : activeView === 'history' ? (
            <VideoGrid
              title="Lịch sử xem"
              subtitle="Các video bạn đã mở xem gần đây"
              items={historyVideos.map((h) => ({
                id: h.id,
                title: h.title,
                channel: h.channel,
                thumbnail: h.thumbnail,
                durationSec: h.durationSec,
                durationText: formatDurationBadge(h.durationSec),
                publishedText: new Date(h.watchedAt).toLocaleDateString('vi-VN'),
              }))}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
              onClearHistory={handleClearHistory}
              onDeleteHistoryItem={handleDeleteHistoryItem}
              showClearHistory={true}
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
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : activeView === 'trending' ? (
            <VideoGrid
              title="Thịnh hành"
              subtitle="Các video hot nhất được cập nhật liên tục"
              items={homeVideos}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : (
            <VideoGrid
              title="Khám phá video"
              subtitle="Các video hot nhất được cập nhật liên tục"
              items={homeVideos}
              loading={loadingFeed}
              resumes={resumes}
              favoritesSet={favoritesSet}
              onSelectVideo={handleSelectVideo}
              onToggleFavorite={handleToggleFavorite}
            />
          )}
        </main>
      </div>
    </div>
  );
};
