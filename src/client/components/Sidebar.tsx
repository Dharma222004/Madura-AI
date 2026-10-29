import React, { useState } from 'react';
import {
  PenSquare,
  Search,
  Pin,
  Trash2,
  Edit2,
  PanelLeftClose,
  X,
  Check,
  Home,
  Compass,
  BookOpen,
} from 'lucide-react';
import { Conversation } from '../../types/index.js';
import { GroupedConversations } from '../hooks/useConversations.js';

interface SidebarProps {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  userName?: string;
  activeConversationId: string | null;
  groupedConversations: GroupedConversations;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectConversation: (id: string | null) => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onTogglePin: (id: string, current: boolean) => void;
  onRename: (id: string, newTitle: string) => void;
  onDeleteRequest: (id: string, title: string) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  isMobileOpen,
  userName,
  activeConversationId,
  groupedConversations,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  onNewChat,
  onToggleCollapse,
  onCloseMobile,
  onTogglePin,
  onRename,
  onDeleteRequest,
  onOpenSettings,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  };

  const submitRename = (id: string) => {
    if (editingTitle.trim()) onRename(id, editingTitle.trim());
    setEditingId(null);
  };

  const hasGroups = Object.keys(groupedConversations).length > 0;
  const displayName = userName?.trim() || 'Madura User';
  const displayInitial = (displayName[0] || 'M').toUpperCase();

  return (
    <aside
      className={`sidebar ${isCollapsed ? 'sidebar-collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
      aria-label="Conversation Sidebar"
    >
      {/* ── Header: Logo + Pencil (new chat) + Search + Collapse ── */}
      <div className="sidebar-header">
        <div className="sidebar-brand" onClick={() => { onSelectConversation(null); onCloseMobile(); }}>
          <img src="/logo.png" alt="Madura AI" className="sidebar-brand-logo" />
          <span className="sidebar-brand-text">Madura</span>
        </div>
        <div className="sidebar-header-actions">
          {/* Search icon toggle */}
          <button
            className="sidebar-btn-icon"
            onClick={() => setShowSearch((s) => !s)}
            title="Search chats"
            aria-label="Search chats"
          >
            <Search size={17} />
          </button>
          {/* New Chat pencil icon */}
          <button
            className="sidebar-btn-icon"
            onClick={() => {
              onNewChat();
              if (isMobileOpen) onCloseMobile();
            }}
            title="New chat"
            aria-label="New chat"
          >
            <PenSquare size={17} />
          </button>
          {/* Collapse sidebar (or close mobile drawer) */}
          <button
            className="sidebar-btn-icon"
            onClick={isMobileOpen ? onCloseMobile : onToggleCollapse}
            title={isMobileOpen ? "Close sidebar" : "Collapse sidebar"}
            aria-label={isMobileOpen ? "Close sidebar" : "Collapse sidebar"}
          >
            {isMobileOpen ? <X size={18} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
      </div>

      {/* ── Inline Search (shown when search icon clicked) ── */}
      {showSearch && (
        <div className="sidebar-search-box">
          <Search size={13} className="sidebar-search-icon" />
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="Search chats…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* ── Navigation section ── */}
      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item ${activeConversationId === null && !searchQuery ? 'active' : ''}`}
          onClick={() => { onSelectConversation(null); onCloseMobile(); }}
        >
          <Home size={16} />
          <span>Home</span>
        </button>
        <button className="sidebar-nav-item" onClick={onOpenSettings}>
          <Compass size={16} />
          <span>Explore</span>
        </button>
        <button className="sidebar-nav-item" onClick={onOpenSettings}>
          <BookOpen size={16} />
          <span>Library</span>
        </button>
      </nav>

      {/* ── Divider ── */}
      <div className="sidebar-section-divider" />

      {/* ── Conversation List ── */}
      <div className="sidebar-conversations">
        {!hasGroups && (
          <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </div>
        )}

        {Object.entries(groupedConversations).map(([groupTitle, convs]) => (
          <div key={groupTitle} className="conversation-group">
            <div className="conversation-group-title">{groupTitle}</div>
            {convs.map((conv) => {
              const isActive = activeConversationId === conv.id;
              const isEditing = editingId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`conversation-item ${isActive ? 'active' : ''}`}
                  onClick={() => { onSelectConversation(conv.id); onCloseMobile(); }}
                >
                  {conv.pinned && <Pin size={11} className="conversation-item-pinned" />}

                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename(conv.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        style={{ flex: 1, fontSize: '13px', padding: '2px 6px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-focus)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      />
                      <button className="conversation-action-btn" onClick={() => submitRename(conv.id)} title="Save">
                        <Check size={13} />
                      </button>
                      <button className="conversation-action-btn" onClick={() => setEditingId(null)} title="Cancel">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="conversation-item-title">{conv.title}</span>
                      <div className="conversation-item-actions">
                        <button className="conversation-action-btn" onClick={(e) => { e.stopPropagation(); onTogglePin(conv.id, conv.pinned); }} title={conv.pinned ? 'Unpin' : 'Pin'}>
                          <Pin size={12} />
                        </button>
                        <button className="conversation-action-btn" onClick={(e) => startRename(conv, e)} title="Rename">
                          <Edit2 size={12} />
                        </button>
                        <button className="conversation-action-btn" onClick={(e) => { e.stopPropagation(); onDeleteRequest(conv.id, conv.title); }} title="Delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Footer: User avatar + name + plan label (no gear) ── */}
      <div className="sidebar-footer">
        <div className="user-profile-badge" onClick={onOpenSettings}>
          <div className="user-avatar">{displayInitial}</div>
          <div className="user-info">
            <span className="user-name">{displayName}</span>

          </div>
        </div>
      </div>
    </aside>
  );
};
