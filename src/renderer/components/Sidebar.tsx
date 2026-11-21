import React from 'react';
import {
  Home,
  Zap,
  Music,
  Users,
  History,
  Clock,
  Heart,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export type NavTab =
  | 'home'
  | 'shorts'
  | 'music'
  | 'subscriptions'
  | 'history'
  | 'watch_later'
  | 'favorites';

interface SidebarProps {
  activeView: string;
  onSelectTab: (tab: NavTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onSelectTab,
  collapsed,
  onToggleCollapse,
}) => {
  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: 'Trang chủ', icon: Home },
    { id: 'shorts', label: 'Shorts', icon: Zap },
    { id: 'music', label: 'YouTube Music', icon: Music },
    { id: 'subscriptions', label: 'Kênh đăng ký', icon: Users },
    { id: 'history', label: 'Lịch sử xem', icon: History },
    { id: 'watch_later', label: 'Xem sau', icon: Clock },
    { id: 'favorites', label: 'Đã lưu / Thích', icon: Heart },
  ];

  return (
    <aside
      className={`h-[calc(100vh-3.5rem)] bg-yt-sidebar border-r border-yt-border flex flex-col justify-between py-3 transition-[width] duration-200 select-none z-40 flex-shrink-0 ${
        collapsed ? 'w-16' : 'w-52'
      }`}
    >
      <div className="flex flex-col space-y-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center ${
                collapsed ? 'justify-center px-0' : 'space-x-3 px-3'
              } w-full py-2.5 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-yt-hover text-white border border-white/[0.07]'
                  : 'text-yt-subtext hover:bg-yt-card hover:text-white border border-transparent'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-yt-red' : ''}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Collapse / Expand toggle button at bottom */}
      <div className="px-2 border-t border-yt-border pt-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`flex items-center ${
            collapsed ? 'justify-center px-0' : 'space-x-2.5 px-3'
          } w-full py-2 rounded-[8px] text-xs text-yt-subtext hover:bg-yt-hover hover:text-white transition-colors duration-150`}
          title={collapsed ? 'Mở rộng thanh bên' : 'Thu nhỏ thanh bên'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Thu gọn menu</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
