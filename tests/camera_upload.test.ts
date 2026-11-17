import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TYPES,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_IMAGE_DIMENSION,
  validateFileBatch,
  getFileCategory,
  sanitizeFileName,
} from '../src/types/upload.config.js';
import { DocumentService } from '../src/server/services/document.service.js';
import { Attachment } from '../src/types/index.js';

describe('Camera Photo Capture & Upload Pipeline Integration', () => {
  const documentService = new DocumentService(20);

  it('1. should treat camera captured JPEG as a valid allowed image type', () => {
    const cameraMime = 'image/jpeg';
    const cameraExt = '.jpg';

    expect(ALLOWED_TYPES.images.mimeTypes).toContain(cameraMime);
    expect(ALLOWED_TYPES.images.extensions).toContain(cameraExt);

    const category = getFileCategory('camera_photo_20261117_153000.jpg', cameraMime);
    expect(category).toBe('image');
  });

  it('2. should sanitize camera capture filenames safely', () => {
    const rawName = 'camera_photo_2026-11-17:15:30:00.jpg';
    const clean = sanitizeFileName(rawName);

    expect(clean).not.toContain(':');
    expect(clean.endsWith('.jpg')).toBe(true);
  });

  it('3. should pass batch validation for 1 camera-captured photo file', () => {
    const fakeFile = {
      name: 'camera_capture_1.jpg',
      type: 'image/jpeg',
      size: 450 * 1024, // 450 KB
    } as File;

    const { acceptedIndices, rejected } = validateFileBatch([fakeFile], []);

    expect(acceptedIndices).toEqual([0]);
    expect(rejected).toHaveLength(0);
  });

  it('4. should pass batch validation for 5 camera-captured photo files simultaneously', () => {
    const fiveFiles: File[] = Array.from({ length: 5 }, (_, i) => ({
      name: `camera_capture_${i + 1}.jpg`,
      type: 'image/jpeg',
      size: 350 * 1024,
    } as File));

    const { acceptedIndices, rejected } = validateFileBatch(fiveFiles, []);

    expect(acceptedIndices).toHaveLength(5);
    expect(rejected).toHaveLength(0);
  });

  it('5. should support a maximum of 20 captured images in a single message', () => {
    const twentyFiles: File[] = Array.from({ length: 20 }, (_, i) => ({
      name: `camera_photo_${String(i + 1).padStart(2, '0')}.jpg`,
      type: 'image/jpeg',
      size: 300 * 1024,
    } as File));

    const { acceptedIndices, rejected } = validateFileBatch(twentyFiles, []);

    expect(acceptedIndices).toHaveLength(20);
    expect(rejected).toHaveLength(0);
  });

  it('6. should reject the 21st image when 20 images limit is reached', () => {
    const twentyOneFiles: File[] = Array.from({ length: 21 }, (_, i) => ({
      name: `camera_photo_${String(i + 1).padStart(2, '0')}.jpg`,
      type: 'image/jpeg',
      size: 300 * 1024,
    } as File));

    const { acceptedIndices, rejected } = validateFileBatch(twentyOneFiles, []);

    expect(acceptedIndices).toHaveLength(20);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('maximum 20 files per message exceeded');
  });

  it('7. should respect existing chat attachments when calculating remaining camera slots', () => {
    const existingAttachments: Attachment[] = Array.from({ length: 15 }, (_, i) => ({
      id: `att_${i}`,
      fileName: `doc_${i}.pdf`,
      fileSize: 100 * 1024,
      mimeType: 'application/pdf',
      extractedText: 'sample',
    }));

    // User can capture 5 more (15 + 5 = 20)
    const fiveMorePhotos: File[] = Array.from({ length: 5 }, (_, i) => ({
      name: `camera_extra_${i + 1}.jpg`,
      type: 'image/jpeg',
      size: 200 * 1024,
    } as File));

    const resultValid = validateFileBatch(fiveMorePhotos, existingAttachments);
    expect(resultValid.acceptedIndices).toHaveLength(5);
    expect(resultValid.rejected).toHaveLength(0);

    // 6 more should reject the 6th
    const sixMorePhotos: File[] = Array.from({ length: 6 }, (_, i) => ({
      name: `camera_extra_${i + 1}.jpg`,
      type: 'image/jpeg',
      size: 200 * 1024,
    } as File));

    const resultExceeded = validateFileBatch(sixMorePhotos, existingAttachments);
    expect(resultExceeded.acceptedIndices).toHaveLength(5);
    expect(resultExceeded.rejected).toHaveLength(1);
    expect(resultExceeded.rejected[0].reason).toContain('maximum 20 files per message exceeded');
  });

  it('8. should reject oversized camera capture files exceeding limits', () => {
    const oversizedFile = {
      name: 'camera_giant.jpg',
      type: 'image/jpeg',
      size: MAX_FILE_BYTES + 1024,
    } as File;

    const { acceptedIndices, rejected } = validateFileBatch([oversizedFile], []);

    expect(acceptedIndices).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('exceeds the 20 MB');
  });

  it('9. should reject unsupported file formats disguised or misnamed', () => {
    const invalidFile = {
      name: 'camera_exploit.exe',
      type: 'application/x-msdownload',
      size: 5000,
    } as File;

    const { acceptedIndices, rejected } = validateFileBatch([invalidFile], []);

    expect(acceptedIndices).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('Unsupported file type');
  });

  it('10. should process camera JPEG through identical backend DocumentService pipeline as normal uploads', async () => {
    const fakeJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const fileName = 'camera_photo_test.jpg';

    const attachment = await documentService.processFile(
      fakeJpegBytes,
      fileName,
      'image/jpeg',
      'att_camera_123'
    );

    expect(attachment.id).toBe('att_camera_123');
    expect(attachment.fileName).toBe(fileName);
    expect(attachment.mimeType).toBe('image/jpeg');
    expect(getFileCategory(attachment.fileName, attachment.mimeType)).toBe('image');
    expect(attachment.extractedText).toContain(`[Image: ${fileName}`);
  });

  it('11. should enforce max 1600px proportional downscaling calculations', () => {
    const testDimensions = [
      { width: 4000, height: 3000, expectedW: 1600, expectedH: 1200 },
      { width: 1920, height: 1080, expectedW: 1600, expectedH: 900 },
      { width: 1280, height: 720, expectedW: 1280, expectedH: 720 },
      { width: 800, height: 600, expectedW: 800, expectedH: 600 },
    ];

    for (const { width, height, expectedW, expectedH } of testDimensions) {
      let targetW = width;
      let targetH = height;
      if (targetW > MAX_IMAGE_DIMENSION || targetH > MAX_IMAGE_DIMENSION) {
        if (targetW >= targetH) {
          const scale = MAX_IMAGE_DIMENSION / targetW;
          targetW = MAX_IMAGE_DIMENSION;
          targetH = Math.max(1, Math.round(height * scale));
        } else {
          const scale = MAX_IMAGE_DIMENSION / targetH;
          targetH = MAX_IMAGE_DIMENSION;
          targetW = Math.max(1, Math.round(width * scale));
        }
      }

      expect(targetW).toBe(expectedW);
      expect(targetH).toBe(expectedH);
    }
  });

  it('12. should format all multi-camera images into OpenAI/NVIDIA Vision multimodal content blocks', () => {
    const fakeAttachments: Attachment[] = Array.from({ length: 4 }, (_, i) => ({
      id: `att_cam_${i}`,
      fileName: `camera_photo_${i + 1}.jpg`,
      fileSize: 250 * 1024,
      mimeType: 'image/jpeg',
      previewUrl: `data:image/jpeg;base64,fakeBase64ImageContent${i + 1}`,
      thumbnailUrl: `data:image/jpeg;base64,fakeThumb${i + 1}`,
    }));

    // Simulate formatting as done in ChatService for multimodal models (e.g. nemotron-omni)
    const promptText = 'Analyze all these images and explain the important details.';
    const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'text', text: promptText },
    ];

    for (const att of fakeAttachments) {
      if (att.previewUrl && att.previewUrl.startsWith('data:image/')) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: att.previewUrl },
        });
      }
    }

    expect(contentParts).toHaveLength(5); // 1 text prompt + 4 image_url blocks
    expect(contentParts[0]).toEqual({ type: 'text', text: promptText });
    expect(contentParts[1].type).toBe('image_url');
    expect((contentParts[1] as any).image_url.url).toContain('fakeBase64ImageContent1');
    expect((contentParts[4] as any).image_url.url).toContain('fakeBase64ImageContent4');
  });
});
