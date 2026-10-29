import { Router, Request, Response } from 'express';
import multer from 'multer';
import { SpeechService } from '../services/speech.service.js';
import { SupabaseService } from '../services/supabase.service.js';

export function createTranscribeRouter(
  speechService: SpeechService,
  supabaseService?: SupabaseService
): Router {
  const router = Router();

  // 1. Multer memory storage: audio kept in memory buffer, never persisted to disk
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB max Groq audio limit
      files: 1,
    },
  });

  // User authentication helper
  const authenticateUser = async (
    req: Request
  ): Promise<{ authenticated: boolean; userId?: string }> => {
    // Check Supabase bearer token
    const authHeader = req.headers.authorization;
    if (authHeader && supabaseService) {
      const verifiedId = await supabaseService.verifyUserToken(authHeader);
      if (verifiedId) {
        return { authenticated: true, userId: verifiedId };
      }
    }

    // Check x-user-id header for active user session / guest
    const headerUserId = req.headers['x-user-id'] as string;
    if (headerUserId && headerUserId.trim()) {
      return { authenticated: true, userId: headerUserId.trim() };
    }

    return { authenticated: false };
  };

  /**
   * POST /api/transcribe
   * Accepts multipart/form-data with:
   * - file: audio recording
   * - language: (optional) 'en', 'ta', 'hi', or omitted for auto-detection
   */
  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    try {
      // 1. Enforce user authentication
      const auth = await authenticateUser(req);
      if (!auth.authenticated) {
        res.status(401).json({
          error: 'Authentication required. Please sign in or initiate a session to use voice transcription.',
        });
        return;
      }

      // 2. File presence check
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'No audio file provided in request.' });
        return;
      }

      const audioBuffer = req.file.buffer;
      const originalName = req.file.originalname || 'recording.webm';
      const mimeType = req.file.mimetype || 'audio/webm';

      // 3. File format validation
      if (!speechService.isAudioFormatSupported(originalName, mimeType)) {
        res.status(415).json({
          error: `Unsupported audio format: "${mimeType}". Supported audio formats: webm, wav, mp3, m4a, ogg, flac.`,
        });
        return;
      }

      // 4. File size check (empty or corrupt)
      if (audioBuffer.length < 32) {
        res.status(400).json({
          error: 'Audio recording is empty or too short. Please speak clearly and try again.',
        });
        return;
      }

      // 5. Language parameter
      let language = req.body?.language ? String(req.body.language).trim() : undefined;
      if (language && (language.toLowerCase() === 'auto' || language === '')) {
        language = undefined;
      }

      // 6. Execute Groq Whisper Large V3 Turbo transcription
      const result = await speechService.transcribeAudio(
        audioBuffer,
        originalName,
        mimeType,
        { language }
      );

      // 7. Validate non-empty recognized text
      if (!result.text || !result.text.trim()) {
        res.json({
          text: '',
          message: 'No clear speech detected in recording. Please try speaking closer to the microphone.',
          model: result.model,
          language: result.language,
          duration: result.duration,
        });
        return;
      }

      res.json({
        text: result.text,
        model: result.model,
        language: result.language,
        duration: result.duration,
      });
    } catch (err: any) {
      console.error('[TranscribeError]', err.message);

      const rawMsg = err.message || 'Speech transcription failed.';
      const msg = rawMsg.toLowerCase();

      if (msg.includes('rate limit') || msg.includes('429')) {
        res.status(429).json({ error: rawMsg });
        return;
      }
      if (msg.includes('timed out') || msg.includes('timeout')) {
        res.status(504).json({ error: rawMsg });
        return;
      }
      if (
        msg.includes('authentication failed') ||
        msg.includes('invalid api key') ||
        msg.includes('groq_api_key') ||
        msg.includes('(401)') ||
        msg.includes('(403)')
      ) {
        res.status(503).json({ error: 'Groq Whisper speech-to-text service is currently unavailable.' });
        return;
      }
      if (msg.includes('exceeds maximum size')) {
        res.status(413).json({ error: rawMsg });
        return;
      }
      if (msg.includes('unsupported audio format')) {
        res.status(415).json({ error: rawMsg });
        return;
      }

      res.status(500).json({ error: rawMsg });
    }
  });

  return router;
}
