import { describe, it, expect } from 'vitest';
import { RAGService } from '../src/server/services/rag.service.js';

describe('RAGService (Retrieval-Augmented Generation & Document Profiling)', () => {
  const ragService = new RAGService();

  const sampleBookText = `
Build a Large Language Model (From Scratch)
by Sebastian Raschka
Manning Publications Co. 2024

Chapter 1: Understanding Large Language Models
Large language models (LLMs) have revolutionized natural language processing. In this book, we build a generative pre-trained transformer (GPT) from scratch using PyTorch.

Chapter 2: Working with Text Data
Text preprocessing involves tokenization, Byte-Pair Encoding (BPE), creating vocabulary dictionaries, and setting up PyTorch DataLoaders with sliding window datasets.

Chapter 3: Coding Attention Mechanisms
In this chapter, we implement scaled dot-product attention and multi-head attention blocks. We apply causal masks so that tokens cannot attend to future positions during autoregressive generation.

Chapter 4: Implementing a GPT Model from Scratch
We assemble the complete transformer architecture including LayerNorm, GELU activation functions, residual shortcut connections, and feed-forward networks.

Chapter 5: Pretraining on Unlabeled Data
We train the GPT model using cross-entropy loss and the AdamW optimizer to perform next-token prediction on text corpora.

Chapter 6: Fine-Tuning for Text Classification
We adapt the pre-trained weights to classify spam and sentiment by replacing the final projection head.

Chapter 7: Fine-Tuning with Human Feedback
We implement instruction fine-tuning and explore Direct Preference Optimization (DPO) and reinforcement learning from human feedback (RLHF).
`;

  it('should correctly index and profile document metadata and structure', () => {
    const profile = ragService.indexDocument(
      'doc-101',
      "Build a Large Language Model (From Scratch) -- Sebastian Raschka -- 2024 -- Manning Publications Co_ LLC -- isbn13 9781633437166 -- da37a83a6833048cedff22fda0dfc2b8 -- Anna's Archive.pdf",
      sampleBookText
    );

    expect(profile.detectedTitle).toContain('Build a Large Language Model (From Scratch)');
    expect(profile.detectedAuthor).toBe('Sebastian Raschka');
    expect(profile.detectedPublisher).toContain('Manning');
    expect(profile.detectedYear).toBe('2024');
    expect(profile.chapters.length).toBeGreaterThanOrEqual(5);
    expect(profile.chunks.length).toBeGreaterThanOrEqual(1);
    expect(profile.keyTopics).toContain('attention');
  });

  it('should identify overview and summary queries accurately', () => {
    expect(ragService.isOverviewQuery('what this pdf about ?')).toBe(true);
    expect(ragService.isOverviewQuery('what is this document about')).toBe(true);
    expect(ragService.isOverviewQuery('summarize this file')).toBe(true);
    expect(ragService.isOverviewQuery('give me an overview')).toBe(true);
    expect(ragService.isOverviewQuery('table of contents')).toBe(true);
    expect(ragService.isOverviewQuery('what does this book cover')).toBe(true);

    // Specific queries should not be classified as overview
    expect(ragService.isOverviewQuery('how to compute scaled dot product attention')).toBe(false);
    expect(ragService.isOverviewQuery('what loss function is used in chapter 5')).toBe(false);
  });

  it('should generate a comprehensive, structured overview response for "what this pdf about ?"', () => {
    const fileName = "Build a Large Language Model (From Scratch) -- Sebastian Raschka -- 2024 -- Manning.pdf";
    const answer = ragService.answerDocumentQuery(fileName, sampleBookText, 'what this pdf about ?');

    expect(answer).toContain('Build a Large Language Model (From Scratch)');
    expect(answer).toContain('Sebastian Raschka');
    expect(answer).toContain('PyTorch');
    expect(answer).toContain('Attention');
    expect(answer).toContain('Fine-Tuning');
    expect(answer).not.toContain('The file contains structured information regarding what this pdf about ?');
    expect(answer).not.toContain('Extracted key data points and text entries');
  });

  it('should retrieve relevant chunks using BM25 for specific queries', () => {
    const fileName = 'llm-book.pdf';
    ragService.indexDocument('doc-102', fileName, sampleBookText);

    const relevant = ragService.retrieveRelevantChunks('doc-102', 'multi-head attention causal mask', 2);
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant[0].chunk.text.toLowerCase()).toContain('attention');
  });

  it('should answer specific technical queries using retrieved passages', () => {
    const fileName = 'llm-book.pdf';
    const answer = ragService.answerDocumentQuery(
      fileName,
      sampleBookText,
      'how does causal mask work in attention'
    );

    expect(answer.toLowerCase()).toContain('attention');
    expect(answer).not.toContain('important concept with widespread applications');
  });

  it('should retrieve and rerank chunks across multiple documents and format prompt context', () => {
    const doc1 = 'Doc 1: Quantum Computing Fundamentals\nQubits use superposition and entanglement to perform parallel quantum state calculations.';
    const doc2 = 'Doc 2: Deep Learning Architectures\nTransformer models use self-attention to process tokens in parallel.';

    ragService.indexDocument('quantum-doc', 'quantum.pdf', doc1);
    ragService.indexDocument('dl-doc', 'deeplearning.pdf', doc2);

    expect(ragService.hasDocument('quantum-doc')).toBe(true);
    expect(ragService.hasDocument('dl-doc')).toBe(true);

    const quantumChunks = ragService.retrieveMultiDocChunks(['quantum-doc', 'dl-doc'], 'qubits superposition', 2);
    expect(quantumChunks.length).toBeGreaterThan(0);
    expect(quantumChunks[0].chunk.text).toContain('superposition');

    const formatted = ragService.formatContextForPrompt(quantumChunks);
    expect(formatted).toContain('Passage 1');
    expect(formatted).toContain('quantum.pdf');
    expect(formatted).toContain('superposition');
  });
});
