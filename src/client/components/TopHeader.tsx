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
  onNewChat,
}) => {
  return (
    <header className="top-header">
      <div className="top-header-left">
        {/* Expand sidebar trigger (only when collapsed) */}
        {isSidebarCollapsed && (
          <button
            className="sidebar-btn-icon"
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
