import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Type, Cpu, Database, Zap, Layers, GitBranch, Code, Box,
  ArrowRight, Check, Settings, User, Globe, FileText, Search,
  Network, Server, Cloud, Shield, Lock, Key, Star, Heart, Home,
  Mail, Phone, Clock, Calendar, BarChart2, ChevronLeft, ChevronRight,
  Play, Pause, RotateCcw, Download, Copy, Maximize2, X, ZoomIn, ZoomOut,
  Brain, MoreHorizontal,
} from 'lucide-react';

export interface DiagramGroup {
  id: string;
  label: string;
  color: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  subtitle?: string;
  icon?: string;
  group?: string;
  description?: string;
  example?: { in: string; out: string };
  details?: string[];
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramData {
  type: 'flow' | 'cycle' | 'layers' | 'timeline' | 'comparison';
  title: string;
  summary?: string;
  direction?: 'LR' | 'TB';
  groups?: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface InteractiveDiagramProps {
  data: DiagramData;
  title?: string;
  isStreaming?: boolean;
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  type: Type, cpu: Cpu, database: Database, zap: Zap, layers: Layers,
  'git-branch': GitBranch, code: Code, box: Box, 'arrow-right': ArrowRight,
  check: Check, settings: Settings, user: User, globe: Globe, file: FileText,
  search: Search, brain: Brain, network: Network, server: Server, cloud: Cloud,
  shield: Shield, lock: Lock, key: Key, star: Star, heart: Heart, home: Home,
  mail: Mail, phone: Phone, clock: Clock, calendar: Calendar, chart: BarChart2,
};

// Calm muted palette — dark + light tokens
const GROUP_PALETTE: Record<string, {
  darkBg: string; darkBorder: string; darkText: string;
  lightBg: string; lightBorder: string; lightText: string;
}> = {
  blue:   { darkBg: 'rgba(30,64,175,0.12)', darkBorder: '#3b82f6', darkText: '#93c5fd',
             lightBg: 'rgba(59,130,246,0.07)', lightBorder: '#3b82f6', lightText: '#1d4ed8' },
  purple: { darkBg: 'rgba(109,40,217,0.12)', darkBorder: '#8b5cf6', darkText: '#c4b5fd',
             lightBg: 'rgba(139,92,246,0.07)', lightBorder: '#7c3aed', lightText: '#5b21b6' },
  green:  { darkBg: 'rgba(5,150,105,0.12)', darkBorder: '#10b981', darkText: '#6ee7b7',
             lightBg: 'rgba(16,185,129,0.07)', lightBorder: '#059669', lightText: '#065f46' },
  amber:  { darkBg: 'rgba(180,83,9,0.12)', darkBorder: '#f59e0b', darkText: '#fcd34d',
             lightBg: 'rgba(245,158,11,0.07)', lightBorder: '#d97706', lightText: '#78350f' },
  orange: { darkBg: 'rgba(194,65,12,0.12)', darkBorder: '#fb923c', darkText: '#fdba74',
             lightBg: 'rgba(249,115,22,0.07)', lightBorder: '#ea580c', lightText: '#7c2d12' },
  gray:   { darkBg: 'rgba(71,85,105,0.12)', darkBorder: '#64748b', darkText: '#94a3b8',
             lightBg: 'rgba(100,116,139,0.07)', lightBorder: '#475569', lightText: '#1e293b' },
};

function sanitizeDiagramData(raw: DiagramData): DiagramData {
  const cappedNodes = (raw.nodes || []).slice(0, 15).map((node) => ({
    ...node,
    id: String(node.id || '').trim(),
    label: String(node.label || '').trim(),
    subtitle: node.subtitle ? String(node.subtitle).trim() : undefined,
    icon: node.icon ? String(node.icon).toLowerCase().trim() : undefined,
    group: node.group ? String(node.group).trim() : undefined,
    description: node.description ? String(node.description).trim() : undefined,
    example: node.example ? { in: String(node.example.in || ''), out: String(node.example.out || '') } : undefined,
    details: Array.isArray(node.details) ? node.details.map((d) => String(d)) : undefined,
  }));

  const validIds = new Set(cappedNodes.map((n) => n.id));
  const validEdges = (raw.edges || []).filter((e) => e && validIds.has(e.from) && validIds.has(e.to));

  return {
    ...raw,
    type: raw.type || 'flow',
    title: String(raw.title || 'Interactive Diagram'),
    summary: raw.summary ? String(raw.summary).trim() : undefined,
    direction: raw.direction === 'TB' ? 'TB' : 'LR',
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    nodes: cappedNodes,
    edges: validEdges,
  };
}

export interface NodePos {
  x: number;
  y: number;
  row: number;
  col: number;
}

export interface GroupBand {
  id: string;
  group: DiagramGroup;
  x: number;
  y: number;
  w: number;
  h: number;
  labelX: number;
  labelY: number;
  showLabel: boolean;
  labelText: string;
}

export interface CalcEdge {
  from: string;
  to: string;
  label?: string;
  displayLabel?: string;
  pillWidth: number;
  path: string;
  midX: number;
  midY: number;
  isCycleBack: boolean;
}

export function computeDiagramLayout(
  data: DiagramData,
  containerWidth = 750,
  isTB = false
) {
  const nodes = data.nodes;
  const n = nodes.length;
  const isCycle = data.type === 'cycle';
  const hasGroups = Array.isArray(data.groups) && data.groups.length > 0;

  // Build edge list including cycle return loop if requested
  const allEdges: DiagramEdge[] = [...data.edges];
  if (isCycle && nodes.length > 1) {
    const lastId = nodes[nodes.length - 1].id;
    const firstId = nodes[0].id;
    if (!allEdges.some((e) => e.from === lastId && e.to === firstId)) {
      allEdges.push({ from: lastId, to: firstId, label: 'loop' });
    }
  }

  // Measure maximum edge label to ensure colGap fits the pill with clearance
  let maxEdgeLabelLen = 0;
  allEdges.forEach((e) => {
    if (e.label && e.label.trim().length > maxEdgeLabelLen) {
      maxEdgeLabelLen = e.label.trim().length;
    }
  });

  // Sizing constants
  const isMobile = containerWidth < 520 || isTB;
  const CARD_W = isMobile ? 250 : 190;
  const CARD_H = 104;
  const PAD = 36;

  // Determine max columns allowed per row based on container width
  let maxCols = 3;
  if (isMobile) {
    maxCols = 1;
  } else if (containerWidth < 700) {
    maxCols = 2;
  } else if (containerWidth >= 1000 && n >= 8) {
    maxCols = 4;
  } else {
    maxCols = 3;
  }

  // Dynamic horizontal & vertical gaps:
  // colGap must comfortably fit the widest edge pill + arrow clearance on both sides
  const badgeNeeded = maxEdgeLabelLen > 0 ? Math.round(maxEdgeLabelLen * 6.8 + 28) : 56;
  const colGap = isMobile ? 0 : Math.max(76, Math.min(138, badgeNeeded));
  const rowGap = isMobile ? 44 : (hasGroups ? 80 : 64);
  const colStep = CARD_W + colGap;
  const rowStep = CARD_H + rowGap;

  // Calculate node coordinates
  const positions = new Map<string, NodePos>();

  if (isMobile) {
    // Mobile: single vertical column
    nodes.forEach((node, idx) => {
      const x = PAD;
      const y = PAD + (hasGroups ? 20 : 0) + idx * rowStep;
      positions.set(node.id, { x, y, row: idx, col: 0 });
    });
  } else if (hasGroups) {
    // Group-aware grid packing:
    // Avoid splitting a group across a row break if the whole group (or its remaining nodes)
    // fits cleanly on a new row.
    let currentRow = 0;
    let currentCol = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      // Count how many consecutive nodes from here belong to this same group
      let groupRun = 1;
      while (i + groupRun < nodes.length && nodes[i + groupRun].group === node.group) {
        groupRun++;
      }

      const isStartOfGroup = i === 0 || nodes[i - 1].group !== node.group;
      if (isStartOfGroup && currentCol > 0) {
        const remainingCols = maxCols - currentCol;
        if (groupRun <= maxCols && groupRun > remainingCols) {
          currentRow++;
          currentCol = 0;
        }
      }

      const x = PAD + currentCol * colStep;
      const y = PAD + 20 + currentRow * rowStep;
      positions.set(node.id, { x, y, row: currentRow, col: currentCol });

      currentCol++;
      if (currentCol >= maxCols) {
        currentRow++;
        currentCol = 0;
      }
    }
  } else {
    // No groups: balanced grid
    let colsPerRow = maxCols;
    if (n <= 3) colsPerRow = n;
    else if (n === 4) colsPerRow = 2; // balanced 2x2 grid
    else if (n <= 6) colsPerRow = Math.min(3, maxCols);

    nodes.forEach((node, idx) => {
      const r = Math.floor(idx / colsPerRow);
      const c = idx % colsPerRow;
      const x = PAD + c * colStep;
      const y = PAD + r * rowStep;
      positions.set(node.id, { x, y, row: r, col: c });
    });
  }

  // Group bounding bands
  const groupBands: GroupBand[] = [];
  if (hasGroups && data.groups) {
    data.groups.forEach((group, gIdx) => {
      const gNodes = nodes.filter((node) => node.group === group.id);
      if (gNodes.length === 0) return;

      // Group nodes by row
      const rowMap = new Map<number, DiagramNode[]>();
      gNodes.forEach((node) => {
        const pos = positions.get(node.id)!;
        const list = rowMap.get(pos.row) || [];
        list.push(node);
        rowMap.set(pos.row, list);
      });

      // Check if a single bounding box would enclose any nodes from other groups
      const allXs = gNodes.map((n) => positions.get(n.id)!.x);
      const allYs = gNodes.map((n) => positions.get(n.id)!.y);
      const minX = Math.min(...allXs) - 16;
      const minY = Math.min(...allYs) - 26;
      const maxX = Math.max(...allXs) + CARD_W + 16;
      const maxY = Math.max(...allYs) + CARD_H + 16;

      const otherNodes = nodes.filter((n) => n.group !== group.id);
      const hasInterlopers = otherNodes.some((other) => {
        const oPos = positions.get(other.id);
        if (!oPos) return false;
        return (
          oPos.x >= minX - 4 &&
          oPos.x + CARD_W <= maxX + 4 &&
          oPos.y >= minY - 4 &&
          oPos.y + CARD_H <= maxY + 4
        );
      });

      if (!hasInterlopers) {
        // Clean single rectangle
        groupBands.push({
          id: `gb-${group.id}-${gIdx}`,
          group,
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
          labelX: minX + 14,
          labelY: minY + 16,
          showLabel: true,
          labelText: group.label.toUpperCase(),
        });
      } else {
        // Multi-row or segmented: create a band for each row
        const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
        sortedRows.forEach((r, rIdx) => {
          const rowNodes = rowMap.get(r)!;
          const rXs = rowNodes.map((n) => positions.get(n.id)!.x);
          const rYs = rowNodes.map((n) => positions.get(n.id)!.y);
          const rMinX = Math.min(...rXs) - 16;
          const rMinY = Math.min(...rYs) - 26;
          const rMaxX = Math.max(...rXs) + CARD_W + 16;
          const rMaxY = Math.max(...rYs) + CARD_H + 16;

          groupBands.push({
            id: `gb-${group.id}-${gIdx}-r${r}`,
            group,
            x: rMinX,
            y: rMinY,
            w: rMaxX - rMinX,
            h: rMaxY - rMinY,
            labelX: rMinX + 14,
            labelY: rMinY + 16,
            showLabel: true,
            labelText: rIdx === 0 ? group.label.toUpperCase() : `${group.label.toUpperCase()} (CONT.)`,
          });
        });
      }
    });

    // Label collision resolution pass:
    // If any two labels have (x, y) coordinates within collision distance, offset them
    for (let i = 0; i < groupBands.length; i++) {
      for (let j = i + 1; j < groupBands.length; j++) {
        const b1 = groupBands[i];
        const b2 = groupBands[j];
        if (!b1.showLabel || !b2.showLabel) continue;
        if (Math.abs(b1.labelX - b2.labelX) < 120 && Math.abs(b1.labelY - b2.labelY) < 22) {
          b2.labelY += 16;
        }
      }
    }
  }

  // Compute curved edge paths
  const calcEdges: CalcEdge[] = [];
  allEdges.forEach((edge) => {
    const src = positions.get(edge.from);
    const tgt = positions.get(edge.to);
    if (!src || !tgt) return;

    const isCycleBack = isCycle && edge.from === nodes[nodes.length - 1]?.id && edge.to === nodes[0]?.id;

    let sx: number, sy: number, tx: number, ty: number;
    let path = '';
    let midX = 0;
    let midY = 0;

    if (isCycleBack) {
      // Outer loop returning from last node back to first node
      sx = src.x + CARD_W / 2;
      sy = src.y + CARD_H;
      tx = tgt.x;
      ty = tgt.y + CARD_H / 2;
      const loopBottomY = Math.max(src.y, tgt.y) + CARD_H + 40;
      const loopLeftX = Math.max(8, tgt.x - 24);

      path = `M ${sx} ${sy} C ${sx} ${loopBottomY}, ${loopLeftX} ${loopBottomY}, ${loopLeftX} ${(sy + ty) / 2} C ${loopLeftX} ${ty}, ${loopLeftX} ${ty}, ${tx} ${ty}`;
      midX = (sx + loopLeftX) / 2;
      midY = loopBottomY;
    } else if (src.row === tgt.row) {
      // Both nodes in the same row: horizontal arrow right
      sx = src.x + CARD_W;
      sy = src.y + CARD_H / 2;
      tx = tgt.x;
      ty = tgt.y + CARD_H / 2;
      const dx = tx - sx;
      const cp1x = sx + dx * 0.5;
      const cp2x = sx + dx * 0.5;
      path = `M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ty}, ${tx} ${ty}`;
      midX = (sx + tx) / 2;
      midY = (sy + ty) / 2;
    } else if (tgt.row > src.row) {
      if (isMobile) {
        // Vertical stack: straight down
        sx = src.x + CARD_W / 2;
        sy = src.y + CARD_H;
        tx = tgt.x + CARD_W / 2;
        ty = tgt.y;
        const dy = ty - sy;
        path = `M ${sx} ${sy} C ${sx} ${sy + dy * 0.5}, ${tx} ${sy + dy * 0.5}, ${tx} ${ty}`;
        midX = sx;
        midY = sy + dy * 0.5;
      } else {
        // Wrap from end of row down to start of next row: smooth S-curve
        sx = src.x + CARD_W / 2;
        sy = src.y + CARD_H;
        tx = tgt.x + CARD_W / 2;
        ty = tgt.y;
        const channelY = (sy + ty) / 2;
        path = `M ${sx} ${sy} C ${sx} ${channelY + 8}, ${tx} ${channelY - 8}, ${tx} ${ty}`;
        midX = (sx + tx) / 2;
        midY = channelY;
      }
    } else {
      // Fallback backward arrow
      sx = src.x;
      sy = src.y + CARD_H / 2;
      tx = tgt.x + CARD_W;
      ty = tgt.y + CARD_H / 2;
      const loopY = Math.min(src.y, tgt.y) - 24;
      path = `M ${sx} ${sy} C ${sx - 30} ${loopY}, ${tx + 30} ${loopY}, ${tx} ${ty}`;
      midX = (sx + tx) / 2;
      midY = loopY;
    }

    // Format edge label and compute pill size
    let displayLabel: string | undefined = undefined;
    let pillWidth = 0;
    if (edge.label) {
      const rawLabel = edge.label.trim();
      displayLabel = rawLabel.length > 22 ? rawLabel.slice(0, 20) + '…' : rawLabel;
      const textWidth = displayLabel.length * 6.3 + 16;
      if (src.row === tgt.row) {
        pillWidth = Math.min(Math.max(colGap - 12, 28), textWidth);
      } else {
        pillWidth = Math.min(160, textWidth);
      }
    }

    calcEdges.push({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      displayLabel,
      pillWidth,
      path,
      midX,
      midY,
      isCycleBack,
    });
  });

  // Compute bounding canvas dimensions
  let maxX = 0;
  let maxY = 0;
  positions.forEach((pos) => {
    maxX = Math.max(maxX, pos.x + CARD_W + PAD);
    maxY = Math.max(maxY, pos.y + CARD_H + PAD);
  });
  groupBands.forEach((gb) => {
    maxX = Math.max(maxX, gb.x + gb.w + 24);
    maxY = Math.max(maxY, gb.y + gb.h + 24);
  });
  if (isCycle) {
    maxY += 48; // room for cycle bottom curve
  }

  return {
    positions,
    groupBands,
    calcEdges,
    CARD_W,
    CARD_H,
    colGap,
    rowGap,
    svgW: Math.max(maxX, 320),
    svgH: Math.max(maxY, 200),
  };
}

export const InteractiveDiagramComponent: React.FC<InteractiveDiagramProps> = ({
  data: rawData,
  title: customTitle,
  isStreaming = false,
}) => {
  if (isStreaming) {
    return (
      <div className="idiag-card idiag-skeleton">
        <div className="idiag-skel-bar" style={{ width: '45%' }} />
        <div className="idiag-skel-bar" style={{ width: '75%', opacity: 0.5 }} />
        <div className="idiag-skel-bar" style={{ width: '55%', opacity: 0.3 }} />
      </div>
    );
  }

  const data = useMemo(() => sanitizeDiagramData(rawData), [rawData]);
  const isCycle = data.type === 'cycle';
  const isTB = data.direction === 'TB';

  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [isFocusedOrHovered, setIsFocusedOrHovered] = useState<boolean>(false);
  const [containerWidth, setContainerWidth] = useState<number>(750);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Track container width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 50) {
          setContainerWidth(Math.round(entry.contentRect.width));
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Layout calculation
  const layout = useMemo(
    () => computeDiagramLayout(data, containerWidth, isTB),
    [data, containerWidth, isTB]
  );

  const activeNode = activeIndex >= 0 && activeIndex < data.nodes.length ? data.nodes[activeIndex] : null;

  const activeEdge = useMemo(() => {
    if (!activeNode) return null;
    const nextNode = data.nodes[activeIndex + 1] || (isCycle ? data.nodes[0] : null);
    if (nextNode) {
      const m = layout.calcEdges.find((e) => e.from === activeNode.id && e.to === nextNode.id);
      if (m) return m;
    }
    return layout.calcEdges.find((e) => e.from === activeNode.id) || null;
  }, [activeNode, activeIndex, data.nodes, isCycle, layout.calcEdges]);

  // Step walkthrough timer
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!isPlaying) return;

    const ms = Math.round(2500 / speed);
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = prev + 1;
        if (next >= data.nodes.length) {
          if (isCycle) return 0;
          setIsPlaying(false);
          return prev;
        }
        return next;
      });
    }, ms);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, speed, data.nodes.length, isCycle]);

  const handleNext = useCallback(() => {
    setActiveIndex((p) => (p < data.nodes.length - 1 ? p + 1 : isCycle ? 0 : p));
  }, [data.nodes.length, isCycle]);

  const handlePrev = useCallback(() => {
    setActiveIndex((p) => (p > 0 ? p - 1 : isCycle ? data.nodes.length - 1 : 0));
  }, [data.nodes.length, isCycle]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev) {
        setActiveIndex((c) => (c === -1 || (!isCycle && c >= data.nodes.length - 1) ? 0 : c));
        return true;
      }
      return false;
    });
  }, [data.nodes.length, isCycle]);

  const handleRestart = useCallback(() => {
    setActiveIndex(0);
    setIsPlaying(true);
  }, []);

  const handleDeselect = useCallback(() => {
    setActiveIndex(-1);
    setIsPlaying(false);
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed((s) => (s === 0.5 ? 1 : s === 1 ? 2 : 0.5));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isFocusedOrHovered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleDeselect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFocusedOrHovered, handlePrev, handleNext, togglePlay, handleDeselect]);

  // Zoom controls
  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 2.0));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const resetZoom = () => setZoom(1);

  // Copy / Download handlers
  const handleCopyJSON = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawData, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  };

  const handleDownloadSVG = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.download = `${(customTitle || data.title).replace(/[^a-z0-9_-]/gi, '_')}.svg`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleDownloadPNG = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = layout.svgW * scale;
    canvas.height = layout.svgH * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.download = `${(customTitle || data.title).replace(/[^a-z0-9_-]/gi, '_')}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      handleDownloadSVG();
    };
    img.src = url;
  };

  const handleNodeClick = (index: number) => {
    if (activeIndex === index) {
      handleDeselect();
    } else {
      setActiveIndex(index);
      setIsPlaying(false);
    }
  };

  return (
    <div
      className={`idiag-card${isFullscreen ? ' idiag-fullscreen' : ''}`}
      tabIndex={0}
      ref={containerRef}
      onMouseEnter={() => setIsFocusedOrHovered(true)}
      onMouseLeave={() => setIsFocusedOrHovered(false)}
      onFocus={() => setIsFocusedOrHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setIsFocusedOrHovered(false);
      }}
    >
      {/* Screen-reader live region (properly clipped via .sr-only) */}
      <div className="sr-only" role="status" aria-live="polite">
        {activeNode
          ? `Step ${activeIndex + 1} of ${data.nodes.length}: ${activeNode.label}. ${activeNode.description || ''}`
          : 'Interactive diagram. Click a step to explore.'}
      </div>

      {/* ── Header ── */}
      <div className="idiag-header">
        <div className="idiag-header-meta">
          <div className="idiag-header-row1">
            <span className="idiag-title">{customTitle || data.title}</span>
            <span className="idiag-type-tag">{data.type}</span>
          </div>
          {data.summary && <p className="idiag-summary">{data.summary}</p>}
        </div>

        {/* ⋯ Menu */}
        <div className="idiag-menu-wrap" ref={menuRef}>
          <button
            className="idiag-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Diagram options"
            title="Options"
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <div className="idiag-menu-dropdown">
              <button className="idiag-menu-item" onClick={() => { zoomIn(); setMenuOpen(false); }}>
                <ZoomIn size={13} /> Zoom in
              </button>
              <button className="idiag-menu-item" onClick={() => { zoomOut(); setMenuOpen(false); }}>
                <ZoomOut size={13} /> Zoom out
              </button>
              <button className="idiag-menu-item" onClick={() => { resetZoom(); setMenuOpen(false); }}>
                <RotateCcw size={13} /> Fit to view
              </button>
              <div className="idiag-menu-divider" />
              <button className="idiag-menu-item" onClick={() => { setIsFullscreen((f) => !f); setMenuOpen(false); }}>
                <Maximize2 size={13} /> {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </button>
              <div className="idiag-menu-divider" />
              <button className="idiag-menu-item" onClick={() => { handleCopyJSON(); setMenuOpen(false); }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} Copy as JSON
              </button>
              <button className="idiag-menu-item" onClick={() => { handleDownloadSVG(); setMenuOpen(false); }}>
                <Download size={13} /> Download SVG
              </button>
              <button className="idiag-menu-item" onClick={() => { handleDownloadPNG(); setMenuOpen(false); }}>
                <Download size={13} /> Download PNG
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Responsive Viewport (Fits 100% width with auto aspect-ratio height) ── */}
      <div
        className="idiag-viewport"
        style={{
          width: '100%',
          overflow: zoom > 1 ? 'auto' : 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.svgW} ${layout.svgH}`}
          className="idiag-svg"
          style={{
            width: zoom === 1 ? '100%' : `${zoom * 100}%`,
            height: 'auto',
            display: 'block',
            maxWidth: isFullscreen ? 'none' : '100%',
          }}
        >
          <defs>
            <filter id="idiag-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker id="idiag-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 2 L 8 5 L 0 8 z" fill="currentColor" />
            </marker>
            <marker id="idiag-arr-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 2 L 8 5 L 0 8 z" fill="var(--idiag-active)" />
            </marker>
            <marker id="idiag-arr-done" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 2 L 8 5 L 0 8 z" fill="var(--idiag-done)" />
            </marker>
          </defs>

          {/* Group bounding bands */}
          {layout.groupBands.map((gb) => {
            const pal = GROUP_PALETTE[gb.group.color] || GROUP_PALETTE.gray;
            return (
              <g key={gb.id}>
                <rect
                  x={gb.x}
                  y={gb.y}
                  width={gb.w}
                  height={gb.h}
                  rx="12"
                  className="idiag-group-rect"
                  style={{
                    fill: `var(--idiag-group-bg-${gb.group.color}, ${pal.darkBg})`,
                    stroke: `var(--idiag-group-border-${gb.group.color}, ${pal.darkBorder})`,
                  }}
                />
                {gb.showLabel && (
                  <text
                    x={gb.labelX}
                    y={gb.labelY}
                    className="idiag-group-label"
                    style={{ fill: `var(--idiag-group-text-${gb.group.color}, ${pal.darkText})` }}
                  >
                    {gb.labelText}
                  </text>
                )}
              </g>
            );
          })}

          {/* Edges */}
          {layout.calcEdges.map((edge, i) => {
            const srcIdx = data.nodes.findIndex((n) => n.id === edge.from);
            const tgtIdx = data.nodes.findIndex((n) => n.id === edge.to);
            const isActive = activeIndex >= 0 && edge.from === activeNode?.id;
            const isDone = activeIndex >= 0 && srcIdx >= 0 && tgtIdx >= 0
              && srcIdx < activeIndex
              && (tgtIdx <= activeIndex || (isCycle && tgtIdx === 0 && activeIndex === data.nodes.length - 1));

            return (
              <g key={`e-${i}`}>
                <path
                  d={edge.path}
                  fill="none"
                  strokeWidth={isActive ? 2 : 1.5}
                  strokeDasharray={isActive ? '6 4' : edge.isCycleBack ? '5 4' : 'none'}
                  markerEnd={isActive ? 'url(#idiag-arr-active)' : isDone ? 'url(#idiag-arr-done)' : 'url(#idiag-arr)'}
                  className={`idiag-edge${isActive ? ' active' : isDone ? ' done' : ''}`}
                  style={{ color: 'var(--idiag-edge)' }}
                />
              </g>
            );
          })}

          {/* Animated data packet traveling along active edge */}
          {activeEdge && !prefersReducedMotion && (
            <circle r="3.5" className="idiag-packet" filter="url(#idiag-soft-glow)">
              <animateMotion
                dur={`${1.4 / speed}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.6 1"
                path={activeEdge.path}
                key={`${activeEdge.from}->${activeEdge.to}-${speed}-${activeIndex}`}
              />
            </circle>
          )}

          {/* Node cards via foreignObject */}
          {data.nodes.map((node, index) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const isActive = activeIndex === index;
            const isDone = activeIndex > index;
            const isDimmed = activeIndex >= 0 && !isActive && !isDone;
            const isPulse = activeIndex === -1 && index === 0;
            const IconComp = (node.icon && ICON_MAP[node.icon]) || Box;

            const nodeGroup = data.groups?.find((g) => g.id === node.group);
            const pal = nodeGroup ? (GROUP_PALETTE[nodeGroup.color] || GROUP_PALETTE.gray) : null;

            return (
              <foreignObject
                key={node.id}
                x={pos.x}
                y={pos.y}
                width={layout.CARD_W}
                height={layout.CARD_H}
                className="idiag-fo"
                style={{ overflow: 'visible' }}
              >
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{ width: `${layout.CARD_W}px`, height: `${layout.CARD_H}px`, boxSizing: 'border-box' }}
                >
                  <button
                    type="button"
                    className={`idiag-node${isActive ? ' active' : ''}${isDone ? ' done' : ''}${isDimmed ? ' dimmed' : ''}${isPulse ? ' pulse' : ''}`}
                    onClick={() => handleNodeClick(index)}
                    aria-label={`Step ${index + 1}: ${node.label}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      boxSizing: 'border-box',
                      ...(isActive && pal
                        ? {
                            borderColor: pal.darkBorder,
                            boxShadow: `0 0 0 2px ${pal.darkBorder}40, 0 2px 8px rgba(0,0,0,0.3)`,
                          }
                        : {}),
                    }}
                  >
                    <div className="idiag-node-top">
                      <span className={`idiag-node-badge${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}>
                        {isDone ? <Check size={9} strokeWidth={3} /> : index + 1}
                      </span>
                      <div className="idiag-node-icon-wrap">
                        <IconComp size={14} />
                      </div>
                    </div>
                    <div className="idiag-node-body">
                      <div className="idiag-node-title">{node.label}</div>
                      {node.subtitle && <div className="idiag-node-sub">{node.subtitle}</div>}
                    </div>
                  </button>
                </div>
              </foreignObject>
            );
          })}

          {/* Edge label pills rendered above cards to prevent occlusion */}
          {layout.calcEdges.map((edge, i) => {
            if (!edge.label || !edge.displayLabel) return null;
            const isActive = activeIndex >= 0 && edge.from === activeNode?.id;

            return (
              <g key={`e-pill-${i}`} className="idiag-edge-label-pill">
                <rect
                  x={edge.midX - edge.pillWidth / 2}
                  y={edge.midY - 9}
                  width={edge.pillWidth}
                  height={18}
                  rx={9}
                  className="idiag-edge-pill-bg"
                />
                <text
                  x={edge.midX}
                  y={edge.midY + 3.5}
                  textAnchor="middle"
                  className="idiag-edge-label-text"
                  style={{ fill: isActive ? 'var(--idiag-active)' : 'var(--idiag-edge-text)' }}
                >
                  {edge.displayLabel}
                </text>
                {edge.label !== edge.displayLabel && (
                  <title>{edge.label}</title>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── Detail Panel (Inline below diagram) ── */}
      <div className={`idiag-detail${activeNode ? ' open' : ''}`} aria-hidden={!activeNode}>
        {activeNode && (
          <div className="idiag-detail-inner">
            <div className="idiag-detail-header">
              <span className="idiag-step-badge">Step {activeIndex + 1} of {data.nodes.length}</span>
              <span className="idiag-detail-title">{activeNode.label}</span>
              <button
                className="idiag-detail-close"
                onClick={handleDeselect}
                aria-label="Close details"
                title="Close (Esc)"
              >
                <X size={13} />
              </button>
            </div>

            {activeNode.subtitle && <p className="idiag-detail-sub">{activeNode.subtitle}</p>}
            {activeNode.description && <p className="idiag-detail-desc">{activeNode.description}</p>}

            {activeNode.example && (activeNode.example.in || activeNode.example.out) && (
              <div className="idiag-example">
                <div className="idiag-example-head">Example</div>
                {activeNode.example.in && (
                  <div className="idiag-example-row">
                    <span className="idiag-ex-tag in">IN</span>
                    <code className="idiag-ex-code">{activeNode.example.in}</code>
                  </div>
                )}
                {activeNode.example.out && (
                  <div className="idiag-example-row">
                    <span className="idiag-ex-tag out">OUT</span>
                    <code className="idiag-ex-code">{activeNode.example.out}</code>
                  </div>
                )}
              </div>
            )}

            {activeNode.details && activeNode.details.length > 0 && (
              <ul className="idiag-detail-list">
                {activeNode.details.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Footer Controls ── */}
      <div className="idiag-footer">
        <div className="idiag-footer-left">
          <button className="idiag-btn" onClick={handlePrev} disabled={!isCycle && activeIndex <= 0} title="Prev (←)">
            <ChevronLeft size={13} />
          </button>
          <button
            className={`idiag-btn idiag-play${isPlaying ? ' playing' : ''}`}
            onClick={togglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            className="idiag-btn"
            onClick={handleNext}
            disabled={!isCycle && activeIndex >= data.nodes.length - 1}
            title="Next (→)"
          >
            <ChevronRight size={13} />
          </button>
          <button className="idiag-btn" onClick={handleRestart} title="Restart">
            <RotateCcw size={12} />
          </button>
          <button className="idiag-speed" onClick={cycleSpeed} title="Playback speed">
            {speed}×
          </button>
        </div>

        <div className="idiag-footer-right">
          {activeIndex >= 0 ? (
            <span className="idiag-step-label">Step {activeIndex + 1} of {data.nodes.length}</span>
          ) : (
            <span className="idiag-caption">Click a step to explore</span>
          )}
          <div className="idiag-dots">
            {data.nodes.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`idiag-dot${i === activeIndex ? ' active' : ''}${i < activeIndex ? ' done' : ''}`}
                onClick={() => {
                  setActiveIndex(i);
                  setIsPlaying(false);
                }}
                aria-label={`Step ${i + 1}: ${data.nodes[i].label}`}
                title={`${i + 1}: ${data.nodes[i].label}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const InteractiveDiagram = React.memo(InteractiveDiagramComponent);
export default InteractiveDiagram;
