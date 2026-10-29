import React, { useState, useEffect } from 'react';
import { X, Sun, Moon, Monitor } from 'lucide-react';
import { Theme } from '../hooks/useTheme.js';
import { UserSettings, ModelInfo } from '../../types/index.js';

interface SettingsModalProps {
  isOpen: boolean;
  currentTheme: Theme;
  models?: ModelInfo[];
  settings?: UserSettings;
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  onSaveSettings?: (settings: Partial<UserSettings>) => void;
  onClearAllHistory?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  currentTheme,
  settings,
  onClose,
  onThemeChange,
  onSaveSettings,
}) => {
  const [userName, setUserName] = useState<string>(settings?.userName || 'Madura User');

  // Sync state whenever settings change
  useEffect(() => {
    if (settings?.userName !== undefined) {
      setUserName(settings.userName || 'Madura User');
    }
  }, [settings?.userName]);

  if (!isOpen) return null;

  const saveUserNameIfChanged = () => {
    const trimmed = userName.trim() || 'Madura User';
    if (onSaveSettings && trimmed !== settings?.userName) {
      onSaveSettings({ userName: trimmed });
    }
  };

  const handleDone = () => {
    saveUserNameIfChanged();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDone();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleDone}>
      <div
        className="modal-card modal-container"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Modal Header */}
        <div className="modal-header">
          <h2 id="settings-title" className="modal-title">
            Settings
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
        <div className="modal-body" style={{ padding: '24px 24px 28px', gap: '22px' }}>
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
          <div className="setting-row" style={{ alignItems: 'center', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
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
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ justifyContent: 'flex-end', borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '14px 24px' }}>
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
