import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { ModelInfo } from '../../types/index.js';

export interface ModelSelectorProps {
  models: ModelInfo[];
  selectedModel: string;
  onSelect: (id: string) => void;
  className?: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onSelect,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current =
    models.find((m) => m.id === selectedModel) ||
    models.find((m) => m.isDefault) ||
    models[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!models || models.length === 0) return null;

  return (
    <div className={`model-selector-bar ${className}`} ref={ref}>
      <button
        type="button"
        className="model-selector-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Select AI model"
        aria-label={`Current model: ${current?.name || 'Select model'}. Click to change`}
        aria-expanded={open}
      >
        <span className="model-selector-name">{current?.name || 'Select model'}</span>
        <ChevronDown
          size={13}
          className={`model-selector-chevron ${open ? 'open' : ''}`}
        />
      </button>

      {open && (
        <div className="model-selector-dropdown" role="menu">
          {models.map((m) => {
            const isSelected = m.id === current?.id;
            return (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                className={`model-selector-item ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
              >
                <div className="model-selector-item-info">
                  <span className="model-selector-item-name">{m.name}</span>
                </div>
                {isSelected && (
                  <Check size={14} className="model-selector-check" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
