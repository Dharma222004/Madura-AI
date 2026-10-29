import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { parse as parseCsv } from 'csv-parse/sync';
import pdfParse from 'pdf-parse';
import { Attachment } from '../../types/index.js';
import { RAGService } from './rag.service.js';
import { SpeechService } from './speech.service.js';

export class DocumentService {
  private maxFileSize: number; // in bytes
  private maxExtractedChars: number = 250000; // ~60k tokens for deep RAG indexing
  private ragService: RAGService;
  private speechService: SpeechService;

  constructor(
    maxSizeMb: number = 25,
    ragService: RAGService = new RAGService(),
    speechService: SpeechService = new SpeechService()
  ) {
    this.maxFileSize = maxSizeMb * 1024 * 1024;
    this.ragService = ragService;
    this.speechService = speechService;
  }

  getRagService(): RAGService {
    return this.ragService;
  }

  getSpeechService(): SpeechService {
    return this.speechService;
  }

  async processFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    fileId: string
  ): Promise<Attachment> {
    if (fileBuffer.length > this.maxFileSize) {
      throw new Error(`File size (${(fileBuffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed limit (${this.maxFileSize / (1024 * 1024)}MB)`);
    }

    const ext = path.extname(originalName).toLowerCase();
    let extractedText = '';

    try {
      if (ext === '.pdf' || mimeType === 'application/pdf') {
        extractedText = await this.extractPdf(fileBuffer);
      } else if (
        ext === '.docx' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        extractedText = await this.extractDocx(fileBuffer);
      } else if (ext === '.csv' || mimeType === 'text/csv') {
        extractedText = this.extractCsv(fileBuffer);
      } else if (ext === '.json' || mimeType === 'application/json') {
        extractedText = this.extractJson(fileBuffer);
      } else if (
        ext === '.txt' ||
        ext === '.md' ||
        mimeType.startsWith('text/')
      ) {
        extractedText = this.extractText(fileBuffer);
      } else if (
        ext === '.png' ||
        ext === '.jpg' ||
        ext === '.jpeg' ||
        ext === '.webp' ||
        mimeType.startsWith('image/')
      ) {
        extractedText = `[Image: ${originalName} (${(fileBuffer.length / 1024).toFixed(1)} KB)]`;
      } else if (
        ext === '.mp3' ||
        ext === '.wav' ||
        ext === '.m4a' ||
        ext === '.ogg' ||
        ext === '.flac' ||
        ext === '.webm' ||
        mimeType.startsWith('audio/')
      ) {
        // Speech recognition via whisper-large-v3
        const result = await this.speechService.transcribeAudio(fileBuffer, originalName, mimeType);
        extractedText = result.text;
      } else {
        throw new Error(`Unsupported file type: ${ext || mimeType}. Supported formats: PDF, DOCX, CSV, TXT, MD, JSON, Images (PNG, JPEG, WEBP), and Audio (MP3, WAV, M4A, WEBM transcribed via whisper-large-v3).`);
      }
    } catch (err: any) {
      throw new Error(`Failed to extract text from ${originalName}: ${err.message}`);
    }

    if (extractedText.length > this.maxExtractedChars) {
      extractedText =
        extractedText.slice(0, this.maxExtractedChars) +
        `\n\n[Notice: Document content truncated at ${this.maxExtractedChars.toLocaleString()} characters to maintain optimal model context.]`;
    }

    if (extractedText && !extractedText.startsWith('[Image:') && !extractedText.startsWith('[Empty')) {
      try {
        this.ragService.indexDocument(fileId, originalName, extractedText);
      } catch (err) {
        console.warn(`[RAGService] Failed to pre-index ${originalName}:`, err);
      }
    }

    return {
      id: fileId,
      fileName: originalName,
      fileSize: fileBuffer.length,
      mimeType,
      extractedText,
    };
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const data = await pdfParse(buffer);
    if (!data.text || !data.text.trim()) {
      return '[Notice: PDF contains no selectable text or is an image-only scan.]';
    }
    return data.text.trim();
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  private extractCsv(buffer: Buffer): string {
    const content = buffer.toString('utf-8');
    const records = parseCsv(content, {
      skip_empty_lines: true,
      relax_quotes: true,
    });

    if (records.length === 0) return '[Empty CSV file]';

    const header = records[0];
    const rows = records.slice(1, 101); // up to 100 rows preview

    let formatted = `CSV File Summary: ${records.length} total rows\nHeaders: ${header.join(' | ')}\n\n`;
    formatted += rows.map((r: string[]) => r.join(' | ')).join('\n');
    if (records.length > 101) {
      formatted += `\n... [${records.length - 101} additional rows omitted for brevity]`;
    }
    return formatted;
  }

  private extractJson(buffer: Buffer): string {
    const raw = buffer.toString('utf-8');
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  }

  private extractText(buffer: Buffer): string {
    return buffer.toString('utf-8').trim();
  }
}
