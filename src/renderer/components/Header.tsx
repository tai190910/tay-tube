import React from 'react';
import { Search, Minus, Square, X, Tv } from 'lucide-react';
import { desktopAPI } from '../api.js';

interface HeaderProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onSearch: (query: string) => void;
  onGoHome: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  searchTerm,
  onSearchTermChange,
  onSearch,
  onGoHome,
}) => {
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

      {/* Window Controls */}
      <div className="flex items-center space-x-1 app-no-drag">
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
