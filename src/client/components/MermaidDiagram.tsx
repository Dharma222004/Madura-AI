import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Copy, Check, Download, ZoomIn, ZoomOut, RotateCcw, AlertTriangle, Maximize2, RefreshCw } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  title?: string;
}

let mermaidInitialized = false;

async function initMermaid() {
  if (mermaidInitialized) return;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      primaryColor: '#1a1a1a',
      primaryTextColor: '#ededed',
      primaryBorderColor: '#333333',
      lineColor: '#666666',
      secondaryColor: '#111111',
      tertiaryColor: '#0a0a0a',
      background: '#000000',
      mainBkg: '#111111',
      nodeBorder: '#444444',
      clusterBkg: '#111111',
      titleColor: '#ededed',
      edgeLabelBackground: '#111111',
      attributeBackgroundColorEven: '#111111',
      attributeBackgroundColorOdd: '#0a0a0a',
      fontSize: '14px',
    },
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
    sequence: { useMaxWidth: true, mirrorActors: false, showSequenceNumbers: false },
    gantt: { useMaxWidth: true },
    er: { useMaxWidth: true },
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontSize: 14,
  });
  mermaidInitialized = true;
}

/**
 * Sanitizes AI-generated Mermaid code to fix common syntax errors:
 * 1. Removes wrapping ```mermaid fences
 * 2. Fixes quoted node labels in wrong positions (e.g. A "label" --> B)
 * 3. Escapes special characters inside node labels
 * 4. Fixes arrow labels with quotes (|"label"|  →  |label|)
 * 5. Removes trailing commas in node definitions
 * 6. Converts Windows line endings
 */
function sanitizeMermaid(raw: string): string {
  // Strip code fences
  let code = raw
    .replace(/^```mermaid\s*/im, '')
    .replace(/^```\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();

  // Normalize line endings
  code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = code.split('\n');
  const fixed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // ── Fix: arrow edge labels with double-quoted strings ──────────────────
    // e.g.  A -->|"some label"| B  →  A -->|some label| B
    line = line.replace(/\|"([^"]+)"\|/g, (_m, inner) => `|${inner.replace(/[[\]()]/g, '')}|`);

    // ── Fix: node definitions with double-quoted labels in wrong place ──────
    // e.g.  A "repetitive data"  (no bracket)  →  A["repetitive data"]
    // Only apply when there's NO existing bracket wrapper
    line = line.replace(
      /^(\s*\w[\w\s]*?)\s+"([^"]+)"\s*(-{1,2}[->|]|$)/gm,
      (_m, nodeId, label, arrow) => {
        const safeLabel = label.replace(/[[\]()]/g, '').replace(/"/g, "'");
        return `${nodeId.trim()}["${safeLabel}"] ${arrow}`;
      }
    );

    // ── Fix: style declarations with quoted strings as attribute values ─────
    // e.g.  style A fill:"#333"  →  style A fill:#333
    line = line.replace(/(\w+):"([^"]+)"/g, '$1:$2');

    // ── Fix: parentheses inside square-bracket node labels ─────────────────
    // e.g.  A[some (thing)]  →  A[some thing]
    line = line.replace(/\[([^\]]*)\(([^\)]*)\)([^\]]*)\]/g, (_m, pre, inner, post) => {
      return `[${pre}${inner}${post}]`;
    });

    // ── Fix: double-quoted strings in class definitions ────────────────────
    line = line.replace(/class\s+(\w+)\s+"([^"]+)"/g, 'class $1 $2');

    // ── Fix: semicolons at end of flowchart node lines (causes parse errors) 
    line = line.replace(/;\s*$/, '');

    fixed.push(line);
  }

  return fixed.join('\n');
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, title }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [usedSanitized, setUsedSanitized] = useState(false);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`);

  const renderDiagram = useCallback(async () => {
    if (!code?.trim()) return;
    setLoading(true);
    setError(null);
    setUsedSanitized(false);

    try {
      await initMermaid();
      const mermaid = (await import('mermaid')).default;

      // First attempt: raw clean code (strip fences only)
      const rawClean = code
        .replace(/^```mermaid\s*/im, '')
        .replace(/^```\s*/im, '')
        .replace(/```\s*$/m, '')
        .trim();

      let svg: string | undefined;

      try {
        const result = await mermaid.render(idRef.current, rawClean);
        svg = result.svg;
      } catch (rawErr: any) {
        // First attempt failed — try with full sanitization
        console.warn('[MermaidDiagram] Raw render failed, retrying with sanitizer…', rawErr?.message);

        // Reset mermaid element if it got corrupted
        const staleEl = document.getElementById(idRef.current);
        if (staleEl) staleEl.remove();
        // Use a fresh ID for the retry
        idRef.current = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

        const sanitized = sanitizeMermaid(code);
        try {
          const result = await mermaid.render(idRef.current, sanitized);
          svg = result.svg;
          setUsedSanitized(true);
        } catch (sanitizedErr: any) {
          // Both failed — report the original error (more useful)
          throw rawErr;
        }
      }

      if (svg) {
        setSvgContent(svg);
      }
    } catch (err: any) {
      console.warn('[MermaidDiagram] Render error:', err);
      // Extract the most useful part of the error message
      const msg = err?.message || 'Failed to render diagram';
      const shortMsg = msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
      setError(shortMsg);
      setSvgContent('');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  const handleCopyCode = async () => {
    try {
      const clean = code
        .replace(/^```mermaid\s*/im, '')
        .replace(/^```\s*/im, '')
        .replace(/```\s*$/m, '')
        .trim();
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownloadSVG = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'diagram'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPNG = async () => {
    if (!svgContent || !containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;
    const canvas = document.createElement('canvas');
    const scale = 2;
    const bbox = svgEl.getBoundingClientRect();
    canvas.width = bbox.width * scale;
    canvas.height = bbox.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.download = `${title || 'diagram'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = url;
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));
  const resetZoom = () => setZoom(1);

  const cleanSource = sanitizeMermaid(code);

  return (
    <div className={`mermaid-diagram-card${isFullscreen ? ' mermaid-fullscreen' : ''}`}>
      {/* Header */}
      <div className="mermaid-diagram-header">
        <div className="mermaid-diagram-title-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-light)', flexShrink: 0 }}>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span className="mermaid-diagram-title">{title || 'Diagram'}</span>
          <span className="mermaid-diagram-badge">MERMAID</span>
          {usedSanitized && (
            <span className="mermaid-diagram-badge" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}>
              AUTO-FIXED
            </span>
          )}
        </div>
        <div className="mermaid-diagram-controls">
          <button className="mermaid-ctrl-btn" onClick={zoomOut} title="Zoom out"><ZoomOut size={13} /></button>
          <span className="mermaid-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="mermaid-ctrl-btn" onClick={zoomIn} title="Zoom in"><ZoomIn size={13} /></button>
          <button className="mermaid-ctrl-btn" onClick={resetZoom} title="Reset zoom"><RotateCcw size={13} /></button>
          <div className="mermaid-ctrl-divider" />
          <button className="mermaid-ctrl-btn" onClick={renderDiagram} title="Retry render"><RefreshCw size={13} /></button>
          <button className="mermaid-ctrl-btn" onClick={handleCopyCode} title="Copy Mermaid source">
            {copied ? <Check size={13} style={{ color: 'var(--status-success)' }} /> : <Copy size={13} />}
          </button>
          <button className="mermaid-ctrl-btn" onClick={handleDownloadSVG} title="Download SVG" disabled={!svgContent}><Download size={13} /></button>
          <button className="mermaid-ctrl-btn mermaid-ctrl-png" onClick={handleDownloadPNG} title="Download PNG" disabled={!svgContent}>PNG</button>
          <button className="mermaid-ctrl-btn" onClick={() => setIsFullscreen((f) => !f)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}><Maximize2 size={13} /></button>
        </div>
      </div>

      {/* Diagram viewport */}
      <div className="mermaid-diagram-viewport" ref={containerRef}>
        {loading && (
          <div className="mermaid-loading">
            <div className="mermaid-loading-spinner" />
            <span>Rendering diagram…</span>
          </div>
        )}

        {error && !loading && (
          <div className="mermaid-error-state">
            <AlertTriangle size={20} style={{ color: 'var(--status-warning)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Diagram render error</strong>
              <p className="mermaid-error-detail">{error}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="mermaid-ctrl-btn"
                  onClick={renderDiagram}
                  style={{ padding: '4px 12px', fontSize: 12, gap: 5, display: 'flex', alignItems: 'center' }}
                >
                  <RefreshCw size={12} /> Retry
                </button>
                <button
                  className="mermaid-ctrl-btn"
                  onClick={() => setShowSource((s) => !s)}
                  style={{ padding: '4px 12px', fontSize: 12 }}
                >
                  {showSource ? 'Hide source' : 'View source'}
                </button>
              </div>
              {showSource && (
                <pre className="mermaid-error-source-pre">{cleanSource}</pre>
              )}
            </div>
          </div>
        )}

        {svgContent && !loading && (
          <div
            className="mermaid-svg-wrapper"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
      </div>
    </div>
  );
};

export default MermaidDiagram;
