import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FILES,
  MAX_FILE_MB,
  MAX_FILE_BYTES,
  MAX_TOTAL_MB,
  validateFileBatch,
  getFileCategory,
  sanitizeFileName,
  truncateFilesToTokenBudget,
  formatFileDataBlock,
} from './upload.config.js';

describe('File Upload Configuration & Validation (upload.config.ts)', () => {
  it('enforces max 20 files per message and rejects the 21st file with a clear message', () => {
    assert.equal(MAX_FILES, 20);
    assert.equal(MAX_FILE_MB, 20);
    assert.equal(MAX_TOTAL_MB, 100);

    const files = Array.from({ length: 21 }, (_, idx) => ({
      name: `photo_${idx + 1}.png`,
      size: 1024 * 50,
      type: 'image/png',
    }));

    const result = validateFileBatch(files, []);
    assert.equal(result.acceptedIndices.length, 20);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].fileName, 'photo_21.png');
    assert.ok(result.rejected[0].reason.includes('maximum 20 files'));
  });

  it('rejects a 25 MB file while accepting other valid files in the same selection', () => {
    const files = [
      { name: 'oversized.pdf', size: 25 * 1024 * 1024, type: 'application/pdf' },
      { name: 'valid_notes.txt', size: 2048, type: 'text/plain' },
    ];

    const result = validateFileBatch(files, []);
    assert.deepEqual(result.acceptedIndices, [1]);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].fileName, 'oversized.pdf');
    assert.ok(result.rejected[0].reason.includes('exceeds the 20 MB per-file limit'));
  });

  it('rejects unsupported file types (.zip, .exe) without crashing while accepting supported ones', () => {
    assert.equal(getFileCategory('archive.zip', 'application/zip'), 'unsupported');
    assert.equal(getFileCategory('installer.exe', 'application/x-msdownload'), 'unsupported');
    assert.equal(getFileCategory('report.docx'), 'docx');
    assert.equal(getFileCategory('sales.xlsx'), 'spreadsheet');
    assert.equal(getFileCategory('slides.pptx'), 'pptx');

    const batch = validateFileBatch(
      [
        { name: 'archive.zip', size: 1000, type: 'application/zip' },
        { name: 'malware.exe', size: 1000, type: 'application/x-msdownload' },
        { name: 'data.csv', size: 1000, type: 'text/csv' },
      ],
      []
    );

    assert.deepEqual(batch.acceptedIndices, [2]);
    assert.equal(batch.rejected.length, 2);
    assert.equal(batch.rejected[0].reason, 'Unsupported file type: archive.zip');
    assert.equal(batch.rejected[1].reason, 'Unsupported file type: malware.exe');
  });

  it('truncates combined text smartly when exceeding the token budget and wraps files in data delimiters', () => {
    const longText = 'A'.repeat(5000);
    const truncated = truncateFilesToTokenBudget(
      [
        { fileName: 'doc1.txt', extractedText: longText },
        { fileName: 'doc2.txt', extractedText: longText },
      ],
      500 // 500 tokens => 2000 chars total => 1000 chars per file
    );

    assert.equal(truncated[0].truncated, true);
    assert.ok(truncated[0].extractedText.includes('[Notice: Content of File: doc1.txt was truncated'));

    const formatted = formatFileDataBlock('doc1.txt', 'Sample file content');
    assert.ok(formatted.startsWith('File: doc1.txt'));
    assert.ok(formatted.includes('--- BEGIN FILE DATA: File: doc1.txt'));
    assert.ok(formatted.includes('--- END FILE DATA: File: doc1.txt ---'));
  });

  it('sanitizes file names safely', () => {
    assert.equal(sanitizeFileName('../../evil<script>.pdf'), 'evil_script_.pdf');
  });
});
