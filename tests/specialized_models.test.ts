import { describe, it, expect } from 'vitest';
import { RAGService, RAG_RERANK_MODEL } from '../src/server/services/rag.service.js';
import { ImageService } from '../src/server/services/image.service.js';
import { SpeechService } from '../src/server/services/speech.service.js';
import { NvidiaProvider, CLEAN_MODELS } from '../src/server/providers/nvidia.provider.js';
import { DocumentService } from '../src/server/services/document.service.js';

describe('Dedicated Specialized Models Integration', () => {
  describe('1. RAG - nemotron-3_5-rerank-8b', () => {
    it('should use nemotron-3_5-rerank-8b for neural document reranking', () => {
      expect(RAG_RERANK_MODEL).toBe('nemotron-3_5-rerank-8b');
      const rag = new RAGService();
      expect(rag.rerankModel).toBe('nemotron-3_5-rerank-8b');

      const fullText = `
Chapter 1: Multi-Head Attention Mechanisms
Multi-head attention allows the model to attend to information from different representation subspaces.
Chapter 2: Training Large Language Models
We optimize transformers using AdamW and cross-entropy loss.
      `;
      rag.indexDocument('doc-test-1', 'llm-guide.txt', fullText);

      const chunks = rag.retrieveRelevantChunks('doc-test-1', 'how does multi-head attention work?', 2);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].chunk.text.toLowerCase()).toContain('attention');
    });
  });

  describe('2. Image Generation - flux-3-image-klein', () => {
    const imageService = new ImageService();

    it('should identify flux-3-image-klein as the dedicated image model', () => {
      expect(imageService.model).toBe('flux-3-image-klein');
    });

    it('should accurately detect image generation prompts', () => {
      expect(imageService.isImagePrompt('generate one lion image')).toBe(true);
      expect(imageService.isImagePrompt('generate image of a futuristic cyberpunk city')).toBe(true);
      expect(imageService.isImagePrompt('draw a cute cat on a skateboard')).toBe(true);
      expect(imageService.isImagePrompt('create a photo of sunset over the mountains')).toBe(true);
      expect(imageService.isImagePrompt('who are you')).toBe(false);
      expect(imageService.isImagePrompt('write python code to sort an array')).toBe(false);
    });

    it('should extract the clean visual subject from prompts', () => {
      expect(imageService.cleanImagePrompt('generate one lion image')).toBe('lion');
      expect(imageService.cleanImagePrompt('draw a cute cat on a skateboard')).toBe('cute cat on a skateboard');
      expect(imageService.cleanImagePrompt('create an image of a red sports car')).toBe('a red sports car');
    });

    it('should synthesize high-resolution visual results citing flux-3-image-klein', async () => {
      const result = await imageService.generateImage('generate one lion image');
      expect(result.model).toBe('flux-3-image-klein');
      expect(result.markdownContent).toContain('flux-3-image-klein');
      expect(result.imageUrl).toContain('pollinations.ai');
    });
  });

  describe('3. High-Performance Model - qwen-3.8', () => {
    it('should register qwen-3.8 in clean models and upstream mappings', () => {
      const codingModel = CLEAN_MODELS.find(m => m.id === 'qwen-3.8');
      expect(codingModel).toBeDefined();
      expect(codingModel?.name).toContain('Qwen 3.8');
    });
  });

  describe('4. Speech Recognition - whisper-large-v3', () => {
    const speechService = new SpeechService();

    it('should identify whisper-large-v3-turbo as the speech recognition model', () => {
      expect(speechService.model).toBe('whisper-large-v3-turbo');
    });

    it('should transcribe audio attachments through DocumentService', async () => {
      const docService = new DocumentService(25, new RAGService(), speechService);
      const audioBuffer = Buffer.from('RIFF....WAVEfmt ....data....test audio sample');

      const attachment = await docService.processFile(
        audioBuffer,
        'voice_note.mp3',
        'audio/mpeg',
        'audio-1'
      );

      expect(attachment.id).toBe('audio-1');
      expect(attachment.extractedText).toContain('whisper-large-v3');
      expect(attachment.extractedText).toContain('Audio Transcription');
    });
  });
});
