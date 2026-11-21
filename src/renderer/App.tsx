import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.js';
import { Sidebar, NavTab } from './components/Sidebar.js';
import { VideoGrid } from './components/VideoGrid.js';
import { WatchScreen } from './components/WatchScreen.js';
import { GoogleSignInModal } from './components/GoogleSignInModal.js';
import { desktopAPI } from './api.js';
import {
  AuthAccountProfile,
  FavoriteItemUI,
  HistoryItemUI,
  ResumeItemUI,
  VideoItemUI,
} from './types.js';

export type ActiveView =
  | 'home'
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

  // 2. Unified Navigation Controller (Sidebar & Logo clicks)
  const navigateTo = useCallback(
    (targetView: NavTab) => {
      // Step 1: Synchronously destroy any active video player so nothing keeps running in background
      stopActivePlayer();

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
      refreshResumes,
      homeVideos.length,
      loadHomeVideos,
      authAccount,
      loadSubscriptions,
      loadHistory,
      loadWatchLater,
      loadFavorites,
    ]
  );

  const handleSelectTab = useCallback(
    (tab: NavTab) => {
      navigateTo(tab);
    },
    [navigateTo]
  );

  // 3. Auth Callbacks
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

  // 4. Select Video to Watch
  const handleSelectVideo = useCallback(
    (videoId: string) => {
      // Tear down previous player before switching videos
      stopActivePlayer();

      const resume = resumes[videoId];
      const startSec =
        resume && resume.positionMs > 10000 ? Math.floor(resume.positionMs / 1000) : 0;
      setInitialSeekSec(startSec);
      setSelectedVideo(videoId);
      setActiveView('watch');
    },
    [stopActivePlayer, resumes]
  );

  // 5. Search Handler (Supports search queries or direct YouTube URL pasting)
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
      setFeedError(null);

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

  // 6. Toggle Favorite from Card
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

  // 7. Toggle Watch Later (Google WL Playlist)
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
        // Revert optimistic update on failure
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

  // 8. History Management
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
      {/* Top Header */}
      <Header
        searchTerm={searchInput}
        onSearchTermChange={setSearchInput}
        onSearch={handleSearch}
        onGoHome={() => navigateTo('home')}
        account={authAccount}
        onOpenSignIn={() => setShowSignInModal(true)}
        onSignOut={handleSignOut}
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
              isSignedIn={Boolean(authAccount)}
              isWatchLater={watchLaterSet.has(selectedVideo)}
              onToggleWatchLater={handleToggleWatchLater}
              onOpenSignIn={() => setShowSignInModal(true)}
              onBack={() => {
                stopActivePlayer();
                setSelectedVideo(null);
                if (searchQuery && searchResults.length > 0) {
                  setActiveView('search');
                } else {
                  navigateTo(lastBrowseViewRef.current);
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
                  ? feedError || 'Nhấn biểu tượng đồng hồ trên thẻ video hoặc nút Xem sau khi phát để lưu.'
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

      {/* Google Device OAuth2 Sign-In Modal */}
      <GoogleSignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        onSignedIn={handleSignedIn}
      />
    </div>
  );
};
