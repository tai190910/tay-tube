import React, { useState } from 'react';
import { Search, Minus, Square, X, Tv, LogIn, LogOut } from 'lucide-react';
import { desktopAPI } from '../api.js';
import { AuthAccountProfile } from '../types.js';

interface HeaderProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onSearch: (query: string) => void;
  onGoHome: () => void;
  account: AuthAccountProfile | null;
  onOpenSignIn: () => void;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  searchTerm,
  onSearchTermChange,
  onSearch,
  onGoHome,
  account,
  onOpenSignIn,
  onSignOut,
}) => {
  const [avatarError, setAvatarError] = useState<boolean>(false);

  React.useEffect(() => {
    setAvatarError(false);
  }, [account?.avatar]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      onSearch(searchTerm.trim());
    }
  };

  const handleMinimize = () => desktopAPI.minimizeWindow();
  const handleMaximize = () => desktopAPI.maximizeWindow();
  const handleClose = () => desktopAPI.closeWindow();

  return (
    <header
      data-tauri-drag-region
      className="h-14 bg-yt-sidebar border-b border-yt-border flex items-center justify-between px-4 z-50 select-none"
    >
      {/* Brand logo & name */}
      <button
        type="button"
        className="flex items-center space-x-2.5 cursor-pointer app-no-drag px-2 py-1 rounded-[8px] hover:bg-yt-hover transition-colors duration-150"
        onClick={onGoHome}
        title="Về Trang chủ"
      >
        <div className="w-8 h-8 bg-yt-red rounded-[8px] flex items-center justify-center shadow-sm">
          <Tv className="w-4 h-4 text-white" />
        </div>
        <div className="flex items-baseline space-x-1.5">
          <span className="font-bold text-base tracking-tight text-white">Tày Tube</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-yt-red bg-yt-red/15 border border-yt-red/30 px-1.5 py-0.5 rounded-[6px]">
            Cinema
          </span>
        </div>
      </button>

      {/* Center Search Bar */}
      <form onSubmit={handleSubmit} className="flex-1 max-w-xl mx-6 app-no-drag">
        <div className="flex items-center">
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Tìm kiếm phim, video hoặc dán link YouTube..."
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className="w-full bg-[#0d0d0d] border border-yt-border hover:border-[#3a3a3a] rounded-l-[8px] py-1.5 pl-3.5 pr-9 text-sm text-yt-text placeholder-yt-subtext focus:outline-none focus:border-yt-red/70 transition-colors duration-150"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => onSearchTermChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-yt-subtext hover:text-white text-xs px-1 py-0.5 rounded-[6px] hover:bg-yt-hover transition-colors"
                title="Xóa từ khóa"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            className="bg-yt-card hover:bg-yt-hover border border-l-0 border-yt-border rounded-r-[8px] px-4 py-1.5 transition-colors duration-150 text-yt-subtext hover:text-white flex items-center justify-center"
            title="Tìm kiếm"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Account & Window Controls */}
      <div className="flex items-center space-x-2 app-no-drag">
        {account ? (
          <div className="flex items-center space-x-2 bg-yt-card border border-yt-border rounded-[8px] pl-2 pr-1 py-1">
            {account.avatar && !avatarError ? (
              <img
                src={account.avatar}
                alt={account.name}
                onError={() => setAvatarError(true)}
                className="w-6 h-6 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-yt-red flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                {(account.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <span
              className="text-xs font-medium text-white max-w-[130px] truncate"
              title={account.email ? `${account.name} (${account.email})` : account.name}
            >
              {account.name}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center space-x-1 px-2 py-1 rounded-[6px] text-[11px] font-semibold text-yt-subtext hover:text-white hover:bg-red-600/80 transition-colors duration-150"
              title="Đăng xuất tài khoản Google"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenSignIn}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-[8px] bg-yt-card hover:bg-yt-hover border border-white/10 text-xs font-semibold text-white transition-colors duration-150"
            title="Đăng nhập tài khoản Google để đồng bộ Kênh đăng ký, Lịch sử và Xem sau"
          >
            <LogIn className="w-3.5 h-3.5 text-yt-red" />
            <span>Đăng nhập Google</span>
          </button>
        )}

        <div className="w-px h-5 bg-yt-border mx-1" />

        <button
          type="button"
          onClick={handleMinimize}
          className="p-2 hover:bg-yt-hover rounded-[8px] text-yt-subtext hover:text-white transition-colors duration-150"
          title="Thu nhỏ"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="p-2 hover:bg-yt-hover rounded-[8px] text-yt-subtext hover:text-white transition-colors duration-150"
          title="Phóng to / Khôi phục"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="p-2 hover:bg-red-600 rounded-[8px] text-yt-subtext hover:text-white transition-colors duration-150"
          title="Đóng"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
