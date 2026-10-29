import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { TopHeader } from './components/TopHeader.js';
import { MessageItem } from './components/MessageItem.js';
import { MessageComposer } from './components/MessageComposer.js';
import { SettingsModal } from './components/SettingsModal.js';
import { ConfirmationModal } from './components/ConfirmationModal.js';
import { useTheme, Theme } from './hooks/useTheme.js';
import { useConversations } from './hooks/useConversations.js';
import { useChat } from './hooks/useChat.js';
import { UserSettings, ModelInfo } from '../types/index.js';
import * as api from './services/api.js';
import { initAuthSession } from './services/supabase.js';
import { ChevronDown, Check } from 'lucide-react';

const DEFAULT_SETTINGS: UserSettings = {
  userName: 'Madura User',
  theme: 'system',
  model: 'auto',
  temperature: 0.7,
  maxTokens: 8192,
  systemPrompt: '',
  enterToSend: true,
  useMockFallback: true,
  enableMemory: true,
};

export const App: React.FC = () => {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  // Suggested prompt draft buffer
  const [composerDraft, setComposerDraft] = useState('');

  // Scroll to bottom visibility
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const chatViewportRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef<boolean>(false);

  // Theme hook
  const { theme, setTheme } = useTheme(settings.theme);

  // Conversation list hook
  const {
    conversations,
    groupedConversations,
    searchQuery,
    setSearchQuery,
    togglePin,
    renameConversation,
    deleteConversation,
    clearAll,
    updateLocalTitle,
    addOrUpdateConversation,
  } = useConversations(activeConversationId, setActiveConversationId);

  // Load models, settings, and initialize Supabase Auth session
  useEffect(() => {
    initAuthSession().catch((err) => console.warn('Supabase auth session notice:', err));

    api.fetchSettings()
      .then(s => setSettings(s))
      .catch(err => console.error('Failed to load settings:', err));

    api.fetchModels()
      .then(m => setModels(m))
      .catch(err => console.error('Failed to load models:', err));
  }, []);

  // Reset scroll state on switching conversations
  useEffect(() => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    if (chatViewportRef.current) {
      chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
    }
  }, [activeConversationId]);

  // Chat hook
  const {
    messages,
    isStreaming,
    attachments,
    sendMessage,
    stopGeneration,
    regenerateResponse,
    editAndResubmit,
    addAttachment,
    removeAttachment,
  } = useChat(
    activeConversationId,
    settings.model,
    (createdConv) => {
      setActiveConversationId(createdConv.id);
      addOrUpdateConversation(createdConv);
    },
    (id, title) => {
      updateLocalTitle(id, title);
    }
  );

  // Handle auto-scroll during streaming or message addition:
  // ONLY auto-scrolls down if the user has NOT deliberately scrolled up to read earlier text!
  useEffect(() => {
    if (chatViewportRef.current && !userScrolledUpRef.current) {
      chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Viewport scroll listener: detects when user scrolls up vs when they reach the bottom
  const handleScroll = () => {
    if (chatViewportRef.current) {
      const { scrollHeight, scrollTop, clientHeight } = chatViewportRef.current;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      // If user is more than 80px from the bottom, they scrolled up to read previous content
      if (distanceFromBottom > 80) {
        userScrolledUpRef.current = true;
        setShowScrollBottom(true);
      } else {
        // User has returned near the bottom
        userScrolledUpRef.current = false;
        setShowScrollBottom(false);
      }
    }
  };

  const scrollToBottom = () => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    if (chatViewportRef.current) {
      chatViewportRef.current.scrollTo({
        top: chatViewportRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  // Keyboard shortcut listener (Ctrl+K for new chat)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleNewChat();
      }
      if (e.key === 'Escape') {
        if (isSettingsOpen) setIsSettingsOpen(false);
        if (deleteTarget) setDeleteTarget(null);
        if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSettingsOpen, deleteTarget, isMobileSidebarOpen]);

  const handleNewChat = () => {
    setActiveConversationId(null);
    setComposerDraft('');
    setIsMobileSidebarOpen(false);
  };

  const handleCycleTheme = () => {
    const cycle: Theme[] = ['dark', 'light', 'system'];
    const nextTheme = cycle[(cycle.indexOf(theme) + 1) % cycle.length];
    setTheme(nextTheme);
    api.saveSettings({ theme: nextTheme }).catch(() => { });
  };

  const handleSaveSettings = async (updates: Partial<UserSettings>) => {
    try {
      const updated = await api.saveSettings(updates);
      setSettings(updated);
    } catch (err) {
      console.error('Failed to save user settings:', err);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setSettings(prev => ({ ...prev, model: modelId }));
    api.saveSettings({ model: modelId }).catch(() => { });
  };

  return (
    <div className="app-container">
      {/* Mobile Drawer Overlay */}
      {isMobileSidebarOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        isMobileOpen={isMobileSidebarOpen}
        userName={settings.userName}
        activeConversationId={activeConversationId}
        groupedConversations={groupedConversations}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSelectConversation={setActiveConversationId}
        onNewChat={handleNewChat}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onTogglePin={togglePin}
        onRename={renameConversation}
        onDeleteRequest={(id, title) => setDeleteTarget({ id, title })}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Content Area */}
      <div className="main-content">
        <TopHeader
          isSidebarCollapsed={isSidebarCollapsed}
          theme={theme}
          onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onNewChat={handleNewChat}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onCycleTheme={handleCycleTheme}
        />

        {/* Chat Viewport or Centered Empty State (ChatGPT structure) */}
        {messages.length === 0 ? (
          <div className="empty-chat-viewport">
            <div className="empty-chat-center-container">
              <h1 className="welcome-heading">
                {settings.userName && settings.userName !== 'Madura User'
                  ? `What can I help you with, ${settings.userName}?`
                  : 'What can I help you with?'}
              </h1>
              <div className="composer-container-wrapper centered">
                <MessageComposer
                  isStreaming={isStreaming}
                  enterToSend={settings.enterToSend}
                  attachments={attachments}
                  initialDraft={composerDraft}
                  onSendMessage={(content, enableSearch) => {
                    userScrolledUpRef.current = false;
                    setShowScrollBottom(false);
                    sendMessage(content, undefined, enableSearch);
                    setComposerDraft('');
                  }}
                  onStopGeneration={stopGeneration}
                  onAddAttachment={addAttachment}
                  onRemoveAttachment={removeAttachment}
                  models={models}
                  selectedModel={settings.model}
                  onSelectModel={handleSelectModel}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={chatViewportRef}
              className="chat-viewport"
              onScroll={handleScroll}
            >
              <div className="messages-list">
                {messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    isStreaming={isStreaming}
                    onRegenerate={regenerateResponse}
                    onEditAndResubmit={editAndResubmit}
                  />
                ))}
              </div>
            </div>

            {/* Composer and Floating Scroll to Latest Button */}
            <div className="composer-container-wrapper">
              {showScrollBottom && (
                <button
                  type="button"
                  className="scroll-to-bottom-btn"
                  onClick={scrollToBottom}
                  title="Scroll to latest"
                  aria-label="Scroll to latest messages"
                >
                  <ChevronDown size={18} />
                </button>
              )}

              <MessageComposer
                isStreaming={isStreaming}
                enterToSend={settings.enterToSend}
                attachments={attachments}
                initialDraft={composerDraft}
                onSendMessage={(content, enableSearch) => {
                  userScrolledUpRef.current = false;
                  setShowScrollBottom(false);
                  sendMessage(content, undefined, enableSearch);
                  setComposerDraft('');
                  requestAnimationFrame(() => {
                    if (chatViewportRef.current) {
                      chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
                    }
                  });
                }}
                onStopGeneration={stopGeneration}
                onAddAttachment={addAttachment}
                onRemoveAttachment={removeAttachment}
                models={models}
                selectedModel={settings.model}
                onSelectModel={handleSelectModel}
              />
            </div>
          </>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        currentTheme={theme}
        models={models}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onThemeChange={(newTheme) => {
          setTheme(newTheme);
          handleSaveSettings({ theme: newTheme });
        }}
        onSaveSettings={handleSaveSettings}
        onClearAllHistory={clearAll}
      />

      {/* Delete Conversation Confirmation Modal */}
      <ConfirmationModal
        isOpen={Boolean(deleteTarget)}
        title="Delete Conversation"
        message={`Are you sure you want to delete this conversation? `}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) {
            deleteConversation(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
