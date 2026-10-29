import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Copy, Check, Download, ZoomIn, ZoomOut, RotateCcw, AlertTriangle, Maximize2, RefreshCw } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  title?: string;
}

let mermaidInitialized = false;

// Modern pastel infographic palette matching professional diagram generation style (Image 3)
const NODE_PALETTES = [
  { fill: '#dbeafe', stroke: '#93c5fd', text: '#0f172a' }, // Soft Sky Blue (Node 1)
  { fill: '#fef3c7', stroke: '#fcd34d', text: '#451a03' }, // Soft Warm Amber/Peach (Node 2)
  { fill: '#d1fae5', stroke: '#86efac', text: '#064e3b' }, // Soft Mint Green (Node 3)
  { fill: '#ede9fe', stroke: '#c4b5fd', text: '#3b0764' }, // Soft Lavender/Purple
  { fill: '#ffe4e6', stroke: '#fda4af', text: '#881337' }, // Soft Rose/Blush
  { fill: '#ccfbf1', stroke: '#5eead4', text: '#134e4a' }, // Soft Teal/Cyan
  { fill: '#e0e7ff', stroke: '#a5b4fc', text: '#1e1b4b' }, // Soft Indigo
];

async function initMermaid() {
  if (mermaidInitialized) return;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: {
      darkMode: true,
      background: '#06090f',
      mainBkg: '#0d131f',
      textColor: '#f1f5f9',
      lineColor: '#94a3b8',

      // Primary pastel styling
      primaryColor: '#dbeafe',
      primaryTextColor: '#0f172a',
      primaryBorderColor: '#93c5fd',

      secondaryColor: '#fef3c7',
      secondaryTextColor: '#451a03',
      secondaryBorderColor: '#fcd34d',

      tertiaryColor: '#d1fae5',
      tertiaryTextColor: '#064e3b',
      tertiaryBorderColor: '#86efac',

      nodeBorder: '#94a3b8',
      clusterBkg: 'rgba(255, 255, 255, 0.03)',
      clusterBorder: 'rgba(255, 255, 255, 0.12)',
      titleColor: '#f8fafc',
      edgeLabelBackground: '#1e293b',
      attributeBackgroundColorEven: '#0d131f',
      attributeBackgroundColorOdd: '#090d16',

      fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13.5px',
    },
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 22, // Generous padding so text never touches or cuts off against borders
    },
    sequence: {
      useMaxWidth: true,
      mirrorActors: false,
      showSequenceNumbers: false,
      actorFontSize: '13.5px',
      noteFontSize: '13px',
      messageFontSize: '13px',
    },
    state: {
      useMaxWidth: true,
      padding: 18,
    },
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
  });
  mermaidInitialized = true;
}

/**
 * Sanitizes AI-generated Mermaid code to fix common syntax errors:
 * 1. Removes wrapping ```mermaid fences and introductory text
 * 2. Wraps unquoted labels containing parentheses or special characters in quotes
 * 3. Converts newlines inside bracketed labels to <br/>
 * 4. Fixes arrow edge labels with quotes (|"label"|  →  |label|)
 * 5. Removes trailing semicolons
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

  // Strip any accidental leading conversational text before diagram keyword
  const firstDiagramIdx = code.search(/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/m);
  if (firstDiagramIdx > 0) {
    code = code.slice(firstDiagramIdx);
  }

  // Normalize multi-line labels inside brackets [ ... ] to single line with <br/>
  code = code.replace(/\[([^\]]+)\]/g, (_m, inner) => {
    const normalized = inner.replace(/\n+/g, '<br/>');
    return `[${normalized}]`;
  });

  const lines = code.split('\n');
  const fixed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Fix arrow edge labels with double-quoted strings: e.g. A -->|"label"| B  →  A -->|label| B
    line = line.replace(/\|"([^"]+)"\|/g, (_m, inner) => `|${inner.replace(/[[\]()]/g, '')}|`);

    // Fix unquoted node definitions with double-quoted labels: e.g. A "label" --> B → A["label"] --> B
    line = line.replace(
      /^(\s*\w[\w\s]*?)\s+"([^"]+)"\s*(-{1,2}[->|]|$)/gm,
      (_m, nodeId, label, arrow) => {
        const safeLabel = label.replace(/[[\]()]/g, '').replace(/"/g, "'");
        return `${nodeId.trim()}["${safeLabel}"] ${arrow}`;
      }
    );

    // Fix style declarations with quoted strings: e.g. style A fill:"#333" → style A fill:#333
    line = line.replace(/(\w+):"([^"]+)"/g, '$1:$2');

    // Fix unquoted square-bracket labels containing parentheses or colons by safely quoting them
    // e.g. A[Call foo()] → A["Call foo()"]
    line = line.replace(/(\w+)\s*\[([^"\]]*[\(\):\/&][^"\]]*)\]/g, (_m, id, text) => {
      const cleanText = text.replace(/"/g, "'").trim();
      return `${id}["${cleanText}"]`;
    });

    // Fix double-quoted strings in class definitions
    line = line.replace(/class\s+(\w+)\s+"([^"]+)"/g, 'class $1 $2');

    // Fix semicolons at end of flowchart lines
    line = line.replace(/;\s*$/, '');

    fixed.push(line);
  }

  return fixed.join('\n');
}

/**
 * Enhances SVG diagram elements in the DOM:
 * 1. Applies soft pastel infographic palette matching Image 3 reference
 * 2. Makes boxes rounded pills with smooth corners (rx="10" ry="10")
 * 3. Measures text height and AUTO-EXPANDS boxes & foreignObject to ensure ZERO CLIPPING
 * 4. Styles arrows, connector paths, and subgraph clusters cleanly
 */
function enhanceSvgDiagram(svgEl: SVGSVGElement) {
  if (!svgEl) return;

  // 1. Process all nodes (boxes, shapes, text labels)
  const nodes = svgEl.querySelectorAll<SVGGElement>('.node');
  nodes.forEach((node, idx) => {
    const palette = NODE_PALETTES[idx % NODE_PALETTES.length];
    const shape = node.querySelector<SVGGraphicsElement>('rect, polygon, circle, ellipse, path');
    const fo = node.querySelector<SVGForeignObjectElement>('foreignObject');
    const labelDiv = fo?.firstElementChild as HTMLElement | null;
    const svgText = node.querySelector<SVGTextElement>('text');

    // Make rects rounded pills like reference Image 3
    if (shape && shape.tagName.toLowerCase() === 'rect') {
      shape.setAttribute('rx', '10');
      shape.setAttribute('ry', '10');

      const inlineStyle = shape.getAttribute('style') || '';
      const hasCustomFill =
        inlineStyle.includes('fill:') &&
        !inlineStyle.includes('fill: rgb(26, 26, 26)') &&
        !inlineStyle.includes('fill: #1a1a1a') &&
        !inlineStyle.includes('fill: #111111') &&
        !inlineStyle.includes('fill: #dbeafe');

      if (!hasCustomFill) {
        shape.setAttribute('fill', palette.fill);
        shape.setAttribute('stroke', palette.stroke);
        shape.setAttribute('stroke-width', '1.5');
        shape.style.filter = 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.2))';
      }
    }

    // High-contrast, clean typography inside nodes
    if (labelDiv) {
      labelDiv.style.color = palette.text;
      labelDiv.style.fontWeight = '600';
      labelDiv.style.fontSize = '13.5px';
      labelDiv.style.lineHeight = '1.35';
    }
    if (svgText) {
      svgText.setAttribute('fill', palette.text);
      svgText.style.fontWeight = '600';
      svgText.style.fontSize = '13.5px';
    }

    // ZERO TEXT CLIPPING FIX:
    // Dynamically auto-expand foreignObject and rect if text height exceeds container
    if (fo && labelDiv && shape && shape.tagName.toLowerCase() === 'rect') {
      fo.setAttribute('overflow', 'visible');
      const realHeight = labelDiv.scrollHeight || labelDiv.getBoundingClientRect().height;
      const currentFoHeight = parseFloat(fo.getAttribute('height') || '0');
      const currentRectHeight = parseFloat(shape.getAttribute('height') || '0');

      // Ensure generous vertical breathing room (minimum 16px padding)
      const minNeededHeight = Math.max(currentRectHeight, realHeight + 16);
      if (minNeededHeight > currentRectHeight) {
        const heightDiff = minNeededHeight - currentRectHeight;
        shape.setAttribute('height', `${minNeededHeight}`);
        fo.setAttribute('height', `${minNeededHeight}`);

        const currentRectY = parseFloat(shape.getAttribute('y') || '0');
        const currentFoY = parseFloat(fo.getAttribute('y') || '0');
        shape.setAttribute('y', `${currentRectY - heightDiff / 2}`);
        fo.setAttribute('y', `${currentFoY - heightDiff / 2}`);
      }

      // Ensure generous horizontal breathing room
      const realWidth = labelDiv.scrollWidth || labelDiv.getBoundingClientRect().width;
      const currentRectWidth = parseFloat(shape.getAttribute('width') || '0');
      const minNeededWidth = Math.max(currentRectWidth, realWidth + 24);
      if (minNeededWidth > currentRectWidth) {
        const widthDiff = minNeededWidth - currentRectWidth;
        shape.setAttribute('width', `${minNeededWidth}`);
        fo.setAttribute('width', `${minNeededWidth}`);

        const currentRectX = parseFloat(shape.getAttribute('x') || '0');
        const currentFoX = parseFloat(fo.getAttribute('x') || '0');
        shape.setAttribute('x', `${currentRectX - widthDiff / 2}`);
        fo.setAttribute('x', `${currentFoX - widthDiff / 2}`);
      }
    }
  });

  // 2. Process clusters / subgraphs (sleek dark card styling with clear titles like Image 3)
  const clusters = svgEl.querySelectorAll<SVGGElement>('.cluster');
  clusters.forEach((cluster) => {
    const clusterRect = cluster.querySelector<SVGRectElement>('rect');
    if (clusterRect) {
      clusterRect.setAttribute('rx', '12');
      clusterRect.setAttribute('ry', '12');
      clusterRect.setAttribute('fill', 'rgba(255, 255, 255, 0.03)');
      clusterRect.setAttribute('stroke', 'rgba(255, 255, 255, 0.12)');
      clusterRect.setAttribute('stroke-width', '1.5');
    }
    const clusterTitle = cluster.querySelector<SVGTextElement>('text, .cluster-label');
    if (clusterTitle) {
      clusterTitle.setAttribute('fill', '#f8fafc');
      clusterTitle.style.fontWeight = '600';
      clusterTitle.style.fontSize = '13px';
      clusterTitle.style.letterSpacing = '-0.01em';
    }
  });

  // 3. Process edge paths (arrows & connectors)
  const edgePaths = svgEl.querySelectorAll<SVGPathElement>('.edgePath path');
  edgePaths.forEach((path) => {
    path.style.stroke = '#94a3b8';
    path.style.strokeWidth = '2px';
  });

  // 4. Arrowhead markers
  const markers = svgEl.querySelectorAll<SVGElement>('marker path, marker polygon');
  markers.forEach((m) => {
    m.setAttribute('fill', '#94a3b8');
    m.style.stroke = '#94a3b8';
  });

  // 5. Edge labels (badges on arrows)
  const edgeLabels = svgEl.querySelectorAll<SVGGElement>('.edgeLabel');
  edgeLabels.forEach((el) => {
    const edgeRect = el.querySelector<SVGRectElement>('rect');
    if (edgeRect) {
      edgeRect.setAttribute('rx', '6');
      edgeRect.setAttribute('ry', '6');
      edgeRect.setAttribute('fill', '#1e293b');
      edgeRect.setAttribute('stroke', 'rgba(255, 255, 255, 0.12)');
    }
    const labelSpan = el.querySelector<HTMLElement>('span, text');
    if (labelSpan) {
      labelSpan.style.color = '#e2e8f0';
      labelSpan.style.fontSize = '12px';
      labelSpan.style.fontWeight = '500';
    }
  });
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
      // Ensure web fonts are completely loaded so Mermaid measures font metrics accurately
      if (typeof document !== 'undefined' && document.fonts) {
        try {
          await document.fonts.ready;
        } catch {}
      }

      await initMermaid();
      const mermaid = (await import('mermaid')).default;

      // First attempt: raw clean code (strip fences only)
      const rawClean = code
        .replace(/^```mermaid\s*/im, '')
        .replace(/^```\s*/im, '')
        .replace(/```\s*$/m, '')
        .trim();

      let svg: string | undefined;

      // Always use fresh ID to avoid DOM cache clashes
      idRef.current = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

      try {
        const result = await mermaid.render(idRef.current, rawClean);
        svg = result.svg;
      } catch (rawErr: any) {
        // First attempt failed — try with full sanitization
        console.warn('[MermaidDiagram] Raw render failed, retrying with sanitizer…', rawErr?.message);

        // Reset mermaid element if it got corrupted
        const staleEl = document.getElementById(idRef.current);
        if (staleEl) staleEl.remove();
        idRef.current = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

        const sanitized = sanitizeMermaid(code);
        try {
          const result = await mermaid.render(idRef.current, sanitized);
          svg = result.svg;
          setUsedSanitized(true);
        } catch (sanitizedErr: any) {
          // Both failed — report the original error
          throw rawErr;
        }
      }

      if (svg) {
        setSvgContent(svg);
      }
    } catch (err: any) {
      console.warn('[MermaidDiagram] Render error:', err);
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

  // Apply visual enhancements (pastel palette, rounded pill rects, clipping prevention) as soon as SVG mounts
  useEffect(() => {
    if (!svgContent || !containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (svgEl) {
      enhanceSvgDiagram(svgEl);
    }
  }, [svgContent]);

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
    ctx.fillStyle = '#06090f'; // Dark canvas matching diagram viewport
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
