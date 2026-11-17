/**
 * Modular Browser-Side File Processor
 *
 * Processes attached files directly in the browser to stay well under
 * Vercel's ~4.5 MB serverless request body limit:
 * - Images (jpg, png, webp, gif, heic): resized (max 1600px) & compressed (~0.8 quality) via canvas
 * - PDF: text extracted via pdf.js; scanned pages with little/no text rendered to images (capped at 30 pages)
 * - DOCX: text extracted via mammoth (dynamic import)
 * - XLSX/XLS/CSV: parsed via SheetJS (xlsx, dynamic import) into compact CSV text per sheet
 * - PPTX: slide text extracted via JSZip (dynamic import)
 * - TXT, MD, JSON, code files: read as UTF-8 text
 */

import {
  MAX_IMAGE_DIMENSION,
  IMAGE_COMPRESSION_QUALITY,
  MAX_THUMBNAIL_DIMENSION,
  MAX_PDF_PAGES,
  MAX_SHEET_ROWS,
  sanitizeFileName,
  getFileCategory,
  getFileExtension,
} from '../config/upload.config.js';

export interface ProcessedFileResult {
  name: string;
  type: string;
  kind: 'image' | 'text';
  content: string;
  extractedText?: string;
  pageImages?: string[];
  thumbnailUrl?: string;
  meta: {
    originalSize: number;
    processedSize: number;
    pageCount?: number;
    truncated?: boolean;
    sheetCount?: number;
    slideCount?: number;
    width?: number;
    height?: number;
  };
  warnings: string[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('File processing aborted', 'AbortError');
  }
}

/**
 * Extracts any embedded UTF-8/Latin1 text chunks (e.g. PNG tEXt / iTXt metadata)
 * from an image buffer if present.
 */
function extractEmbeddedImageMetadataText(bytes: Uint8Array): string {
  try {
    // Check PNG signature
    if (
      bytes.length > 16 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const texts: string[] = [];
      let offset = 8;
      const decoder = new TextDecoder('utf-8', { fatal: false });
      while (offset + 8 <= bytes.length) {
        const length =
          ((bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3]) >>>
          0;
        const type = String.fromCharCode(
          bytes[offset + 4],
          bytes[offset + 5],
          bytes[offset + 6],
          bytes[offset + 7]
        );
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd > bytes.length) break;

        if (type === 'tEXt' || type === 'iTXt') {
          const raw = decoder.decode(bytes.subarray(dataStart, dataEnd));
          const cleaned = raw.replace(/\0+/g, ': ').trim();
          if (cleaned) texts.push(cleaned);
        }
        offset = dataEnd + 4; // skip CRC
        if (type === 'IEND') break;
      }
      return texts.join('\n');
    }
  } catch {
    // Ignore metadata parsing errors
  }
  return '';
}

/**
 * Resizes and compresses an image file in the browser using HTMLCanvasElement.
 * Also produces a small thumbnail for lightweight chat history persistence.
 */
async function processImageFile(
  file: File,
  safeName: string,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  throwIfAborted(signal);
  const warnings: string[] = [];
  const ext = getFileExtension(safeName);

  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const embeddedMetaText = extractEmbeddedImageMetadataText(new Uint8Array(arrayBuffer));

  if (ext === '.heic' || ext === '.heif' || file.type === 'image/heic' || file.type === 'image/heif') {
    warnings.push('Converted HEIC image to JPEG format.');
  }

  const blob = new Blob([arrayBuffer], { type: file.type || 'image/jpeg' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode image: ${safeName}`));
      el.src = objectUrl;
    });
    throwIfAborted(signal);

    const origW = img.naturalWidth || img.width || 800;
    const origH = img.naturalHeight || img.height || 600;

    // 1. Main compressed image (longest side <= 1600px)
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(origW, origH, 1));
    const targetW = Math.max(1, Math.round(origW * scale));
    const targetH = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    // Fill white background for JPEG conversion so transparent PNGs don't turn black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const compressedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_COMPRESSION_QUALITY);

    // 2. Small thumbnail for chat history display (longest side <= 180px)
    const thumbScale = Math.min(1, MAX_THUMBNAIL_DIMENSION / Math.max(origW, origH, 1));
    const thumbW = Math.max(1, Math.round(origW * thumbScale));
    const thumbH = Math.max(1, Math.round(origH * thumbScale));
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbW;
    thumbCanvas.height = thumbH;
    const thumbCtx = thumbCanvas.getContext('2d');
    if (thumbCtx) {
      thumbCtx.fillStyle = '#ffffff';
      thumbCtx.fillRect(0, 0, thumbW, thumbH);
      thumbCtx.drawImage(img, 0, 0, thumbW, thumbH);
    }
    const thumbnailUrl = thumbCtx
      ? thumbCanvas.toDataURL('image/jpeg', 0.65)
      : compressedDataUrl;

    const processedBytes = Math.round((compressedDataUrl.length * 3) / 4);
    const extractedDesc = embeddedMetaText
      ? `[Image: ${safeName} (${targetW}x${targetH}px)]\n${embeddedMetaText}`
      : `[Image: ${safeName} (${targetW}x${targetH}px)]`;

    return {
      name: safeName,
      type: 'image/jpeg',
      kind: 'image',
      content: compressedDataUrl,
      extractedText: extractedDesc,
      thumbnailUrl,
      meta: {
        originalSize: file.size,
        processedSize: processedBytes,
        width: targetW,
        height: targetH,
      },
      warnings,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Extracts text from a PDF using pdf.js (dynamic import).
 * Pages with little or no selectable text (scanned PDFs) are rendered to canvas images.
 * Caps extraction at MAX_PDF_PAGES (30 pages) and records a truncation warning if exceeded.
 */
async function processPdfFile(
  file: File,
  safeName: string,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  throwIfAborted(signal);
  const warnings: string[] = [];
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);

  const pdfjsLib: any = await import('pdfjs-dist');
  try {
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
    }
  } catch {
    // Fallback if worker URL cannot be resolved
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const totalPages: number = pdf.numPages || 0;
  const pagesToProcess = Math.min(totalPages, MAX_PDF_PAGES);
  const truncated = totalPages > MAX_PDF_PAGES;

  if (truncated) {
    warnings.push(
      `PDF truncated: processed first ${MAX_PDF_PAGES} of ${totalPages} pages.`
    );
  }

  const pageTextBlocks: string[] = [];
  const scannedPageImages: string[] = [];
  let totalSelectableChars = 0;

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    throwIfAborted(signal);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = (textContent.items || [])
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    totalSelectableChars += pageText.length;

    if (pageText.length >= 20) {
      pageTextBlocks.push(`[Page ${pageNum}]\n${pageText}`);
    } else {
      // Scanned PDF page (little or no selectable text): render page to canvas image
      try {
        const baseViewport = page.getViewport({ scale: 1.5 });
        const maxSide = Math.max(baseViewport.width, baseViewport.height, 1);
        const scaleFactor =
          maxSide > MAX_IMAGE_DIMENSION ? (1.5 * MAX_IMAGE_DIMENSION) / maxSide : 1.5;
        const viewport = page.getViewport({ scale: scaleFactor });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport } as any).promise;
          const imgDataUrl = canvas.toDataURL('image/jpeg', IMAGE_COMPRESSION_QUALITY);
          scannedPageImages.push(imgDataUrl);
          pageTextBlocks.push(
            `[Page ${pageNum} — Scanned page rendered as image${pageText ? `: "${pageText}"` : ''}]`
          );
        }
      } catch {
        pageTextBlocks.push(`[Page ${pageNum}] ${pageText || '(Scanned page)'}`);
      }
    }
  }

  if (truncated) {
    pageTextBlocks.push(
      `\n[Notice: PDF truncated at ${MAX_PDF_PAGES} of ${totalPages} pages.]`
    );
  }

  const combinedText = pageTextBlocks.join('\n\n').trim() || `[PDF: ${safeName} (${totalPages} pages)]`;
  const isPureScannedPdf = totalSelectableChars < 20 && scannedPageImages.length > 0;

  return {
    name: safeName,
    type: 'application/pdf',
    kind: isPureScannedPdf ? 'image' : 'text',
    content: isPureScannedPdf ? scannedPageImages[0] : combinedText,
    extractedText: combinedText,
    pageImages: scannedPageImages.length > 0 ? scannedPageImages : undefined,
    thumbnailUrl: scannedPageImages[0],
    meta: {
      originalSize: file.size,
      processedSize: combinedText.length,
      pageCount: totalPages,
      truncated,
    },
    warnings,
  };
}

/**
 * Extracts text from a DOCX file using mammoth (dynamic import).
 */
async function processDocxFile(
  file: File,
  safeName: string,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  throwIfAborted(signal);
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);

  const mammothMod: any = await import('mammoth');
  const mammoth = mammothMod.default || mammothMod;
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = (result?.value || '').trim() || `[Empty DOCX document: ${safeName}]`;

  return {
    name: safeName,
    type:
      file.type ||
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'text',
    content: text,
    extractedText: text,
    meta: {
      originalSize: file.size,
      processedSize: text.length,
    },
    warnings: [],
  };
}

/**
 * Parses XLSX, XLS, or CSV files using SheetJS (xlsx, dynamic import)
 * and converts each sheet into compact CSV text.
 */
async function processSpreadsheetFile(
  file: File,
  safeName: string,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  throwIfAborted(signal);
  const warnings: string[] = [];
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);

  const XLSX: any = await import('xlsx');
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetNames: string[] = workbook.SheetNames || [];

  const sheetBlocks: string[] = [];
  let truncatedAny = false;

  for (const sheetName of sheetNames) {
    throwIfAborted(signal);
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rows.length === 0) {
      sheetBlocks.push(`Sheet: ${sheetName} (Empty)`);
      continue;
    }

    const totalRows = rows.length;
    const isTruncated = totalRows > MAX_SHEET_ROWS;
    const keptRows = isTruncated ? rows.slice(0, MAX_SHEET_ROWS) : rows;

    if (isTruncated) {
      truncatedAny = true;
      warnings.push(
        `Sheet "${sheetName}" truncated to ${MAX_SHEET_ROWS} of ${totalRows} rows.`
      );
    }

    const csvLines = keptRows.map((row) =>
      row
        .map((cell) => {
          const str = String(cell ?? '').replace(/\r?\n/g, ' ').trim();
          return str.includes(',') || str.includes('"')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(',')
    );

    let block = `Sheet: ${sheetName} (${totalRows} total rows)\n${csvLines.join('\n')}`;
    if (isTruncated) {
      block += `\n[Notice: Sheet "${sheetName}" truncated at ${MAX_SHEET_ROWS} of ${totalRows} rows.]`;
    }
    sheetBlocks.push(block);
  }

  const combined =
    sheetBlocks.join('\n\n') || `[Empty spreadsheet: ${safeName}]`;

  return {
    name: safeName,
    type: file.type || 'text/csv',
    kind: 'text',
    content: combined,
    extractedText: combined,
    meta: {
      originalSize: file.size,
      processedSize: combined.length,
      sheetCount: sheetNames.length,
      truncated: truncatedAny,
    },
    warnings,
  };
}

/**
 * Extracts slide text from a PPTX presentation using JSZip (dynamic import).
 */
async function processPptxFile(
  file: File,
  safeName: string,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  throwIfAborted(signal);
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);

  const JSZipMod: any = await import('jszip');
  const JSZip = JSZipMod.default || JSZipMod;
  const zip = await JSZip.loadAsync(arrayBuffer);

  const slideFiles = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      return numA - numB;
    });

  const slideBlocks: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    throwIfAborted(signal);
    const xml = await zip.files[slideFiles[i]].async('string');
    const textRuns = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) =>
        m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim()
      )
      .filter(Boolean);
    if (textRuns.length > 0) {
      slideBlocks.push(`[Slide ${i + 1}]\n${textRuns.join(' ')}`);
    }
  }

  const combined =
    slideBlocks.join('\n\n') || `[Presentation: ${safeName} (${slideFiles.length} slides)]`;

  return {
    name: safeName,
    type:
      file.type ||
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'text',
    content: combined,
    extractedText: combined,
    meta: {
      originalSize: file.size,
      processedSize: combined.length,
      slideCount: slideFiles.length,
    },
    warnings: [],
  };
}

/**
 * Reads plain text, markdown, JSON, or source code files as UTF-8 text.
 */
async function processTextFile(
  file: File,
  safeName: string,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  throwIfAborted(signal);
  const rawText = await file.text();
  throwIfAborted(signal);
  const text = rawText.trim() || `[Empty file: ${safeName}]`;

  return {
    name: safeName,
    type: file.type || 'text/plain',
    kind: 'text',
    content: text,
    extractedText: text,
    meta: {
      originalSize: file.size,
      processedSize: text.length,
    },
    warnings: [],
  };
}

/**
 * Main entry point: processes a single File in the browser and returns
 * { name, type, kind: "image" | "text", content, meta, warnings }.
 */
export async function processFile(
  file: File,
  signal?: AbortSignal
): Promise<ProcessedFileResult> {
  const safeName = sanitizeFileName(file.name);
  const category = getFileCategory(safeName, file.type);

  if (category === 'unsupported') {
    // TODO: Future audio/video attachment transcription can be handled here.
    throw new Error(`Unsupported file type: ${safeName}`);
  }

  if (category === 'image') {
    return processImageFile(file, safeName, signal);
  }
  if (category === 'pdf') {
    return processPdfFile(file, safeName, signal);
  }
  if (category === 'docx') {
    return processDocxFile(file, safeName, signal);
  }
  if (category === 'spreadsheet') {
    return processSpreadsheetFile(file, safeName, signal);
  }
  if (category === 'pptx') {
    return processPptxFile(file, safeName, signal);
  }

  return processTextFile(file, safeName, signal);
}
