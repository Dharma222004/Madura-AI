import { describe, it, expect } from 'vitest';
import { DocumentService } from '../src/server/services/document.service.js';

describe('DocumentService Extraction', () => {
  const service = new DocumentService(25);

  it('should extract plain text and markdown documents', async () => {
    const content = '# Heading 1\nThis is a sample markdown document.';
    const buffer = Buffer.from(content, 'utf-8');

    const attachment = await service.processFile(
      buffer,
      'notes.md',
      'text/markdown',
      'att-1'
    );

    expect(attachment.id).toBe('att-1');
    expect(attachment.fileName).toBe('notes.md');
    expect(attachment.extractedText).toBe(content);
  });

  it('should parse CSV files into formatted table summaries', async () => {
    const csvContent = 'Name,Role,Department\nAlice,Architect,Engineering\nBob,Engineer,Product';
    const buffer = Buffer.from(csvContent, 'utf-8');

    const attachment = await service.processFile(
      buffer,
      'team.csv',
      'text/csv',
      'att-2'
    );

    expect(attachment.extractedText).toContain('CSV File Summary: 3 total rows');
    expect(attachment.extractedText).toContain('Alice | Architect | Engineering');
  });

  it('should parse and format JSON files', async () => {
    const jsonContent = JSON.stringify({ project: 'Madura AI', status: 'active', version: 1 });
    const buffer = Buffer.from(jsonContent, 'utf-8');

    const attachment = await service.processFile(
      buffer,
      'config.json',
      'application/json',
      'att-3'
    );

    expect(attachment.extractedText).toContain('"project": "Madura AI"');
  });

  it('should validate image formats without crashing', async () => {
    const fakeImageBuffer = Buffer.from('fake-png-bytes');
    const attachment = await service.processFile(
      fakeImageBuffer,
      'diagram.png',
      'image/png',
      'att-4'
    );

    expect(attachment.extractedText).toContain('[Image: diagram.png');
  });

  it('should reject unsupported file extensions', async () => {
    const buffer = Buffer.from('unsupported binary');
    await expect(
      service.processFile(buffer, 'unknown.exe', 'application/x-msdownload', 'att-5')
    ).rejects.toThrow(/Unsupported file type/);
  });

  it('should reject files exceeding maximum size limit', async () => {
    const tinyService = new DocumentService(0.001); // 1KB limit
    const largeBuffer = Buffer.alloc(5000); // 5KB

    await expect(
      tinyService.processFile(largeBuffer, 'large.txt', 'text/plain', 'att-6')
    ).rejects.toThrow(/exceeds maximum allowed limit/);
  });
});
