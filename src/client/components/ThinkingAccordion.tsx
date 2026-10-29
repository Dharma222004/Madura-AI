import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Brain, ChevronDown, ChevronUp, Copy, Check, Sparkles } from 'lucide-react';

interface ThinkingAccordionProps {
  thought: string;
  thoughtDurationMs?: number;
  isStreaming: boolean;
  hasContent: boolean;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = ({
  thought,
  thoughtDurationMs,
  isStreaming,
  hasContent,
}) => {
  // Always hidden by default: only shown if the user explicitly touches/clicks it.
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [liveElapsedSec, setLiveElapsedSec] = useState<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const thoughtBodyRef = useRef<HTMLDivElement>(null);
  const prevHasContentRef = useRef<boolean>(hasContent);

  const isActivelyThinking = isStreaming && !hasContent;

  // When results start generating the answer (hasContent transitions from false -> true),
  // automatically hide/collapse the thinking details so the user can immediately read the answer.
  useEffect(() => {
    if (hasContent && !prevHasContentRef.current) {
      setIsExpanded(false);
    }
    prevHasContentRef.current = hasContent;
  }, [hasContent]);

  // Live timer while actively thinking
  useEffect(() => {
    if (!isActivelyThinking) return;

    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setLiveElapsedSec(Math.round(elapsed * 10) / 10);
    }, 100);

    return () => clearInterval(interval);
  }, [isActivelyThinking]);

  // Auto-scroll thought content as it streams in ONLY if the user explicitly opened it
  useEffect(() => {
    if (isActivelyThinking && isExpanded && thoughtBodyRef.current) {
      thoughtBodyRef.current.scrollTop = thoughtBodyRef.current.scrollHeight;
    }
  }, [thought, isActivelyThinking, isExpanded]);

  if (!thought && !isActivelyThinking) {
    return null;
  }

  const handleToggle = () => {
    setIsExpanded(prev => !prev);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!thought) return;
    try {
      await navigator.clipboard.writeText(thought);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy thought:', err);
    }
  };

  // Format thinking duration — abbreviated to prevent wrapping on narrow screens
  const formatDuration = () => {
    if (isActivelyThinking) {
      return `${liveElapsedSec.toFixed(1)}s`;
    }
    if (thoughtDurationMs && thoughtDurationMs > 0) {
      const seconds = Math.round(thoughtDurationMs / 100) / 10;
      return `${seconds}s`;
    }
    return '~1s';
  };

  const wordCount = thought ? thought.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className={`thinking-accordion-container ${isActivelyThinking ? 'active-thinking' : 'completed-thinking'}`}>
      <button
        type="button"
        className="thinking-accordion-header"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        title={isExpanded ? 'Collapse reasoning steps' : 'Tap to view reasoning steps'}
      >
        <div className="thinking-header-left">
          <div className="thinking-icon-badge">
            {isActivelyThinking ? (
              <Sparkles size={14} className="thinking-sparkles-icon spin-slow" />
            ) : (
              <Brain size={14} className="thinking-brain-icon" />
            )}
          </div>
          <span className="thinking-header-title">
            {isActivelyThinking ? (
              <>
                <span className="thinking-pulse-text">Thinking</span>
                <span className="thinking-timer-pill">{formatDuration()}</span>
              </>
            ) : (
              <>
                Thought for {formatDuration()}
                {wordCount > 0 && (
                  <span className="thinking-word-count">({wordCount} words)</span>
                )}
              </>
            )}
          </span>
        </div>

        <div className="thinking-header-right">
          {thought && (
            <button
              type="button"
              className="thinking-copy-btn"
              onClick={handleCopy}
              title="Copy reasoning process"
              aria-label="Copy reasoning process"
            >
              {copied ? (
                <>
                  <Check size={12} style={{ color: 'var(--status-success)' }} />
                  <span className="copy-label">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span className="copy-label">Copy</span>
                </>
              )}
            </button>
          )}
          <span className="thinking-toggle-btn">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="thinking-accordion-body" ref={thoughtBodyRef}>
          <div className="thinking-content-inner">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              urlTransform={(url) => url}
            >
              {thought || '*Synthesizing step-by-step reasoning plan...*'}
            </ReactMarkdown>
            {isActivelyThinking && <span className="thinking-typing-cursor" />}
          </div>
        </div>
      )}
    </div>
  );
};
