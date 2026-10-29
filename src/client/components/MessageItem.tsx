import React, { useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Copy,
  Check,
  RotateCw,
  Edit3,
  FileText,
  AlertCircle,
  FileCode,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Message } from '../../types/index.js';
import { ThinkingAccordion } from './ThinkingAccordion.js';
const MermaidDiagram = lazy(() => import('./MermaidDiagram.js'));

/** Fallback shimmer shown while the Mermaid renderer lazily loads */
const DiagramLoading: React.FC = () => (
  <div className="mermaid-loading-shimmer">
    <div className="mermaid-loading-shimmer-bar" />
    <div className="mermaid-loading-shimmer-bar" style={{ width: '75%' }} />
    <div className="mermaid-loading-shimmer-bar" style={{ width: '50%' }} />
  </div>
);

interface MessageItemProps {
  message: Message;
  isStreaming: boolean;
  onRegenerate?: (messageId: string) => void;
  onEditAndResubmit?: (messageId: string, newContent: string) => void;
}

/**
 * Recursively converts literal <br>, <br/>, or <br /> in strings to React <br /> elements
 */
function renderContentWithBreaks(content: React.ReactNode): React.ReactNode {
  if (typeof content === 'string') {
    if (!/<\s*br\s*\/?>/i.test(content)) return content;
    const parts = content.split(/<\s*br\s*\/?>/gi);
    return parts.map((part, index) => (
      <React.Fragment key={index}>
        {index > 0 && <br />}
        {part}
      </React.Fragment>
    ));
  }
  if (Array.isArray(content)) {
    return content.map((item, index) => (
      <React.Fragment key={index}>{renderContentWithBreaks(item)}</React.Fragment>
    ));
  }
  if (React.isValidElement(content) && (content.props as any) && (content.props as any).children) {
    return React.cloneElement(content, {
      ...(content.props as any),
      children: renderContentWithBreaks((content.props as any).children),
    });
  }
  return content;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isStreaming,
  onRegenerate,
  onEditAndResubmit,
}) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const isUser = message.role === 'user';

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && onEditAndResubmit) {
      onEditAndResubmit(message.id, editContent.trim());
      setIsEditing(false);
    }
  };

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {/* Brand Avatar (Assistant only, using the professional Madura AI logo) */}
      {!isUser && (
        <div className="message-avatar assistant">
          <img
            src="/logo.png"
            alt="Madura AI"
            className="message-avatar-img"
          />
        </div>
      )}

      <div className="message-content-wrapper">
        {/* Attachments preview */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments-list">
            {message.attachments.map((att) => (
              <div key={att.id} className="attachment-badge">
                <FileText size={14} className="attachment-badge-icon" />
                <span>{att.fileName}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  ({(att.fileSize / 1024).toFixed(0)} KB)
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Content Bubble or Inline Edit */}
        {isEditing ? (
          <div className="edit-message-box">
            <textarea
              className="edit-message-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={4}
            />
            <div className="edit-actions">
              <button
                className="btn-secondary"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSaveEdit}>
                Save & Submit
              </button>
            </div>
          </div>
        ) : (
          <div className="message-bubble">
            {isUser ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
            ) : (
              <div>
                {/* Search Sources Header: Collapsed/Hidden by default, click to view */}
                {message.searchSources && message.searchSources.length > 0 && (
                  <div className="message-search-sources">
                    <button
                      type="button"
                      className="search-sources-toggle-btn"
                      onClick={() => setIsSearchExpanded(prev => !prev)}
                      aria-expanded={isSearchExpanded}
                      title={isSearchExpanded ? 'Hide search sources' : 'View searched sources'}
                    >
                      <div className="search-sources-header-left">
                        <Globe size={13} className="search-globe-icon" />
                        <span className="search-sources-count-text">
                          Searched {message.searchSources.length} source{message.searchSources.length === 1 ? '' : 's'}
                        </span>
                        {message.searchQuery && (
                          <span className="search-query-tag">"{message.searchQuery}"</span>
                        )}
                      </div>
                      <span className="search-toggle-chevron">
                        {isSearchExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </span>
                    </button>

                    {/* Expandable sources list: only shown if user explicitly clicked */}
                    {isSearchExpanded && (
                      <div className="search-sources-pills">
                        {message.searchSources.map((source, idx) => (
                          <a
                            key={idx}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="search-source-pill"
                            title={`${source.title}\n${source.url}`}
                          >
                            <span className="search-source-num">{idx + 1}</span>
                            <span className="search-source-title">{source.title}</span>
                            <ExternalLink size={10} style={{ opacity: 0.6 }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Search In Progress Indicator: Only when searching before sources are received */}
                {message.status === 'streaming' && !message.content && message.searchQuery && (!message.searchSources || message.searchSources.length === 0) && (
                  <div className="search-in-progress">
                    <Globe size={13} className="spin-animation" style={{ color: 'var(--accent-light)' }} />
                    <span>Searching the web for <strong>"{message.searchQuery}"</strong>...</span>
                  </div>
                )}

                {/* Thinking / Reasoning Process Accordion (ChatGPT o1/o3 & DeepSeek R1 style) */}
                {(Boolean(message.thought) || (message.status === 'streaming' && !message.content && !message.searchQuery)) && (
                  <ThinkingAccordion
                    thought={message.thought || ''}
                    thoughtDurationMs={message.thoughtDurationMs}
                    isStreaming={message.status === 'streaming'}
                    hasContent={Boolean(message.content && message.content.trim().length > 0)}
                  />
                )}

                <div className="markdown-body">
                {/* Fallback 3-dot thinking indicator only when waiting for the very first token before any thought */}
                {message.status === 'streaming' && !message.content && !message.thought && !message.searchQuery && (
                  <div className="thinking-indicator">
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                  </div>
                )}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  urlTransform={(url) => url}
                  components={{
                    img({ src, alt, ...props }: any) {
                      return (
                        <div className="generated-image-card">
                          <img
                            src={src}
                            alt={alt || 'Generated Image'}
                            className="generated-image-media"
                            loading="eager"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.tried) {
                                target.dataset.tried = 'true';
                                target.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(alt || 'photograph')}?width=1024&height=1024&model=flux&nologo=true`;
                              }
                            }}
                            {...props}
                          />
                          {alt && (
                            <div className="generated-image-overlay">
                              <span className="generated-image-prompt-tag">{alt}</span>
                              <a
                                href={src}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="generated-image-open-btn"
                                title="Open full resolution image"
                              >
                                View Full Size ↗
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    },
                    code({ node, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || '');
                      const lang = match ? match[1].toLowerCase() : '';
                      const codeText = String(children).replace(/\n$/, '');
                      // Determine inline by checking if content has newlines or a language is specified
                      const isInline = !lang && !codeText.includes('\n');

                      // Render Mermaid diagrams interactively
                      if (!isInline && lang === 'mermaid') {
                        return (
                          <Suspense fallback={<DiagramLoading />}>
                            <MermaidDiagram code={codeText} />
                          </Suspense>
                        );
                      }

                      if (!isInline && lang) {
                        return (
                          <CodeBlock
                            language={lang}
                            value={codeText}
                          />
                        );
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    table({ children }) {
                      return (
                        <div className="table-responsive-wrapper">
                          <table>{children}</table>
                        </div>
                      );
                    },
                    th({ children, ...props }: any) {
                      return <th {...props}>{renderContentWithBreaks(children)}</th>;
                    },
                    td({ children, ...props }: any) {
                      return <td {...props}>{renderContentWithBreaks(children)}</td>;
                    },
                    p({ children, ...props }: any) {
                      return <p {...props}>{renderContentWithBreaks(children)}</p>;
                    },
                    li({ children, ...props }: any) {
                      return <li {...props}>{renderContentWithBreaks(children)}</li>;
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                {message.status === 'streaming' && message.content && (
                  <span className="streaming-cursor" />
                )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error Alert */}
        {message.status === 'failed' && (
          <div className="message-error-card">
            <AlertCircle size={18} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
            <div>
              <strong>Generation Error:</strong>{' '}
              {message.errorMessage || 'An unexpected error occurred during generation.'}
              {onRegenerate && (
                <div>
                  <button
                    className="retry-btn"
                    onClick={() => onRegenerate(message.id)}
                  >
                    Retry Generation
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions Toolbar */}
        {!isEditing && message.status !== 'streaming' && (
          <div className="message-actions-bar">
            <button
              className="message-tool-btn"
              onClick={copyContent}
              title="Copy message"
            >
              {copied ? <Check size={14} style={{ color: 'var(--status-success)' }} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {isUser && onEditAndResubmit && (
              <button
                className="message-tool-btn"
                onClick={() => {
                  setEditContent(message.content);
                  setIsEditing(true);
                }}
                title="Edit message"
              >
                <Edit3 size={14} />
                <span>Edit</span>
              </button>
            )}

            {!isUser && onRegenerate && (
              <button
                className="message-tool-btn"
                onClick={() => onRegenerate(message.id)}
                title="Regenerate response"
              >
                <RotateCw size={14} />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface CodeBlockProps {
  language: string;
  value: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileCode size={13} style={{ color: 'var(--accent-light)' }} />
          <span className="code-block-lang">{language || 'code'}</span>
        </div>
        <button className="code-copy-btn" onClick={copyCode}>
          {copied ? (
            <>
              <Check size={13} style={{ color: 'var(--status-success)' }} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
};
