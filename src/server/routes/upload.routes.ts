import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { DocumentService } from '../services/document.service.js';

export function createUploadRouter(documentService: DocumentService): Router {
  const router = Router();

  // Use memory storage to avoid unneeded disk persistence & path traversal vulnerabilities
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB
      files: 5,
    },
  });

  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const fileId = uuidv4();
      const attachment = await documentService.processFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        fileId
      );

      res.json({
        attachment,
        message: 'File processed and extracted successfully',
      });
    } catch (err: any) {
      console.error('[UploadError]', err);
      res.status(400).json({ error: err.message || 'Failed to process file' });
    }
  });

  return router;
}
