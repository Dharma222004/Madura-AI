import React, { useState, useEffect, useCallback } from 'react';
import { X, Sun, Moon, Monitor, Brain, Trash2 } from 'lucide-react';
import { Theme } from '../hooks/useTheme.js';
import { UserSettings, ModelInfo } from '../../types/index.js';
import {
  MemoryItem,
  loadMemory,
  deleteMemory,
  clearMemory,
  isMemoryEnabled,
  setMemoryEnabled,
} from '../memory.js';

interface SettingsModalProps {
  isOpen: boolean;
  currentTheme: Theme;
  models?: ModelInfo[];
  settings?: UserSettings;
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  onSaveSettings?: (settings: Partial<UserSettings>) => void;
  onClearAllHistory?: () => void;
  onMemoryToast?: (notice: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  currentTheme,
  settings,
  onClose,
  onThemeChange,
  onSaveSettings,
  onMemoryToast,
}) => {
  const [userName, setUserName] = useState<string>(settings?.userName || 'Madura User');
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);
  const [memoryEnabledState, setMemoryEnabledState] = useState<boolean>(true);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);

  const refreshMemoryState = useCallback(() => {
    setMemoryItems(loadMemory());
    setMemoryEnabledState(isMemoryEnabled());
  }, []);

  // Sync state whenever settings or modal open state changes
  useEffect(() => {
    if (settings?.userName !== undefined) {
      setUserName(settings.userName || 'Madura User');
    }
  }, [settings?.userName]);

  useEffect(() => {
    if (isOpen) {
      refreshMemoryState();
      setConfirmClearAll(false);
    }
  }, [isOpen, refreshMemoryState]);

  useEffect(() => {
    const handleStorageUpdate = () => refreshMemoryState();
    window.addEventListener('madura-memory-changed', handleStorageUpdate);
    window.addEventListener('storage', handleStorageUpdate);
    return () => {
      window.removeEventListener('madura-memory-changed', handleStorageUpdate);
      window.removeEventListener('storage', handleStorageUpdate);
    };
  }, [refreshMemoryState]);

  if (!isOpen) return null;

  const saveUserNameIfChanged = () => {
    const trimmed = userName.trim() || 'Madura User';
    if (onSaveSettings && trimmed !== settings?.userName) {
      onSaveSettings({ userName: trimmed });
    }
  };

  const handleDone = () => {
    saveUserNameIfChanged();
    setConfirmClearAll(false);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDone();
    }
  };

  const handleToggleMemory = () => {
    const next = !memoryEnabledState;
    setMemoryEnabled(next);
    setMemoryEnabledState(next);
    if (onSaveSettings) {
      onSaveSettings({ enableMemory: next });
    }
  };

  const handleDeleteMemoryItem = (id: string) => {
    const updated = deleteMemory(id);
    setMemoryItems(updated);
    onMemoryToast?.('Memory updated');
  };

  const handleConfirmClearAllMemory = () => {
    clearMemory();
    setMemoryItems([]);
    setConfirmClearAll(false);
    onMemoryToast?.('Memory updated');
  };

  return (
    <div className="modal-backdrop" onClick={handleDone}>
      <div
        className="modal-card modal-container"
        style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Modal Header */}
        <div className="modal-header">
          <h2 id="settings-title" className="modal-title">
            Settings &amp; Connection
          </h2>
          <button
            className="modal-close-btn"
            onClick={handleDone}
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ padding: '20px 24px 24px', gap: '20px' }}>
          {/* Display Name Setting */}
          <div className="setting-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '8px' }}>
            <div className="setting-info">
              <span className="setting-label" style={{ fontSize: '15px', fontWeight: 600 }}>Display Name</span>
              <span className="setting-desc" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Choose the name displayed on your account and sidebar
              </span>
            </div>
            <div style={{ width: '100%', marginTop: '4px' }}>
              <input
                type="text"
                className="setting-text-input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onBlur={saveUserNameIfChanged}
                onKeyDown={handleKeyDown}
                placeholder="Enter your name"
                maxLength={32}
              />
            </div>
          </div>

          {/* Appearance Setting */}
          <div className="setting-row" style={{ alignItems: 'center', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
            <div className="setting-info">
              <span className="setting-label" style={{ fontSize: '15px', fontWeight: 600 }}>Appearance</span>
              <span className="setting-desc" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Select dark, light, or follow your system theme
              </span>
            </div>
            <div className="theme-button-group">
              <button
                type="button"
                className={`theme-btn ${currentTheme === 'light' ? 'active' : ''}`}
                onClick={() => onThemeChange('light')}
              >
                <Sun size={15} />
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`theme-btn ${currentTheme === 'dark' ? 'active' : ''}`}
                onClick={() => onThemeChange('dark')}
              >
                <Moon size={15} />
                <span>Dark</span>
              </button>
              <button
                type="button"
                className={`theme-btn ${currentTheme === 'system' ? 'active' : ''}`}
                onClick={() => onThemeChange('system')}
              >
                <Monitor size={15} />
                <span>System</span>
              </button>
            </div>
          </div>

          {/* Cross-Chat User Memory Section */}
          <div className="memory-settings-section">
            <div className="setting-row" style={{ alignItems: 'center', padding: 0 }}>
              <div className="setting-info">
                <span className="setting-label" style={{ fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <Brain size={16} />
                  <span>Memory</span>
                  <span className="memory-count-pill">{memoryItems.length}</span>
                </span>
                <span className="setting-desc" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Remember personal details you share and recall them in new chats
                </span>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={memoryEnabledState}
                aria-label="Toggle memory"
                data-testid="memory-toggle-btn"
                className={`memory-toggle-switch ${memoryEnabledState ? 'enabled' : ''}`}
                onClick={handleToggleMemory}
              >
                <span className="memory-toggle-knob" />
              </button>
            </div>

            {/* Saved Memory Items List */}
            {memoryItems.length > 0 && (
              <div className="memory-items-container" data-testid="memory-items-list">
                {memoryItems.map((item) => (
                  <div key={item.id} className="memory-item-row" data-testid={`memory-item-${item.key}`}>
                    <div className="memory-item-content">
                      <span className={`memory-category-tag memory-category-${item.category}`}>
                        {item.category}
                      </span>
                      <span className="memory-item-text">{item.text}</span>
                    </div>
                    <button
                      type="button"
                      className="memory-item-delete-btn"
                      onClick={() => handleDeleteMemoryItem(item.id)}
                      title="Delete memory"
                      aria-label={`Delete memory ${item.key}`}
                      data-testid={`delete-memory-${item.key}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Clear All Memory Action + Confirm Dialog */}
            {memoryItems.length > 0 && (
              <div className="memory-clear-row">
                {!confirmClearAll ? (
                  <button
                    type="button"
                    className="memory-clear-all-btn"
                    onClick={() => setConfirmClearAll(true)}
                    data-testid="clear-all-memory-btn"
                  >
                    <Trash2 size={13} />
                    <span>Clear all memory</span>
                  </button>
                ) : (
                  <div className="memory-confirm-box" role="alertdialog" aria-label="Confirm clear all memory">
                    <span className="memory-confirm-text">Clear all {memoryItems.length} saved memory item(s)?</span>
                    <div className="memory-confirm-actions">
                      <button
                        type="button"
                        className="btn-danger"
                        style={{ padding: '5px 12px', fontSize: '12.5px' }}
                        onClick={handleConfirmClearAllMemory}
                        data-testid="confirm-clear-memory-btn"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '5px 12px', fontSize: '12.5px' }}
                        onClick={() => setConfirmClearAll(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', padding: '14px 24px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDone}
            style={{ minWidth: 80 }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
