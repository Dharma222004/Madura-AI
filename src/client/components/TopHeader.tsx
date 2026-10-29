import React from 'react';
import { PanelLeftOpen, PenSquare } from 'lucide-react';
import { Theme } from '../hooks/useTheme.js';

interface TopHeaderProps {
  isSidebarCollapsed: boolean;
  theme: Theme;
  onToggleSidebar: () => void;
  onOpenMobileSidebar?: () => void;
  onNewChat: () => void;
  onOpenSettings?: () => void;
  onCycleTheme: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileSidebar,
  onNewChat,
}) => {
  return (
    <header className="top-header">
      <div className="top-header-left">
        {/* Mobile sidebar trigger (always visible on mobile screens) */}
        <button
          type="button"
          className="sidebar-btn-icon mobile-sidebar-toggle-btn"
          onClick={onOpenMobileSidebar}
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen size={19} />
        </button>

        {/* Expand sidebar trigger (only on desktop when collapsed) */}
        {isSidebarCollapsed && (
          <button
            type="button"
            className="sidebar-btn-icon desktop-sidebar-toggle-btn"
            onClick={onToggleSidebar}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={19} />
          </button>
        )}
      </div>

      <div className="top-header-right">
        {/* Single action: New Chat */}
        <button
          className="sidebar-btn-icon"
          onClick={onNewChat}
          title="New chat"
          aria-label="New chat"
        >
          <PenSquare size={18} />
        </button>
      </div>
    </header>
  );
};
