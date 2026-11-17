import React, { useRef, useEffect, useState } from 'react';
import {
  ArrowUp,
  Square,
  Paperclip,
  X,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Loader2,
  Globe,
  Mic,
  Check,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { Attachment, ModelInfo } from '../../types/index.js';
import * as api from '../services/api.js';
import { ModelSelector } from './ModelSelector.js';
import {
  MAX_FILES,
  validateFileBatch,
  sanitizeFileName,
  getFileCategory,
} from '../config/upload.config.js';
import { processFile } from '../services/fileProcessor.js';

interface MessageComposerProps {
  isStreaming: boolean;
  enterToSend: boolean;
  attachments: Attachment[];
  initialDraft?: string;
  activeConversationId?: string | null;
  onSendMessage: (content: string, enableSearch?: boolean) => void;
  onStopGeneration: () => void;
  onAddAttachment: (att: Attachment) => void;
  onUpdateAttachment?: (id: string, updates: Partial<Attachment>) => void;
  onRemoveAttachment: (id: string) => void;
  models?: ModelInfo[];
  selectedModel?: string;
  onSelectModel?: (id: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  isStreaming,
  enterToSend,
  attachments,
  initialDraft = '',
  activeConversationId,
  onSendMessage,
  onStopGeneration,
  onAddAttachment,
  onUpdateAttachment,
  onRemoveAttachment,
  models,
  selectedModel,
  onSelectModel,
}) => {
  const [content, setContent] = useState(initialDraft);
  const [rejectionReasons, setRejectionReasons] = useState<string[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [forceSearch, setForceSearch] = useState(false);

  // Voice recording & Groq Whisper STT state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Track in-flight file processing AbortControllers so removal or chat switch cancels immediately
  const fileAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Keep latest attachments count & total bytes in a ref for accurate synchronous batch validation
  const attachmentsRef = useRef<Attachment[]>(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Cancel any in-flight file processing if the user switches or closes the chat, or unmounts
  useEffect(() => {
    return () => {
      for (const ctrl of fileAbortControllersRef.current.values()) {
        try {
          ctrl.abort();
        } catch {
          // ignore
        }
      }
      fileAbortControllersRef.current.clear();
    };
  }, [activeConversationId]);

  // Sync draft from external prompt selections (e.g. suggestion cards)
  useEffect(() => {
    if (initialDraft) {
      setContent(initialDraft);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [initialDraft]);

  // Dynamic multiline layout detection (switches between single-line pill and multiline card)
  const [isMultiLine, setIsMultiLine] = useState(false);

  // Auto-resize textarea height & toggle multiline mode
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      const multi = content.includes('\n') || scrollH > 44;
      setIsMultiLine(multi);
      if (content) {
        textareaRef.current.style.height = `${Math.min(scrollH, 200)}px`;
      }
    } else {
      setIsMultiLine(false);
    }
  }, [content]);

  // Clean up recording tracks & intervals on unmount
  useEffect(() => {
    return () => {
      cleanUpRecording();
    };
  }, []);

  const cleanUpRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const startRecording = async () => {
    if (isStreaming || isTranscribing) return;
    setVoiceError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceError('Voice recording is not supported on this browser/environment.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      let selectedMimeType = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          selectedMimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          selectedMimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          selectedMimeType = 'audio/ogg;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          selectedMimeType = 'audio/mp4';
        }
      }

      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);

      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 300) {
            stopRecording();
            return 300;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      console.error('[VoiceRecordError]', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setVoiceError('Microphone permission was denied. Please allow microphone access in browser settings to speak.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setVoiceError('No microphone detected on your device.');
      } else {
        setVoiceError(err.message || 'Unable to access microphone.');
      }
      cleanUpRecording();
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      cleanUpRecording();
      return;
    }

    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      const mime = recorder.mimeType || 'audio/webm';
      let ext = 'webm';
      if (mime.includes('wav')) ext = 'wav';
      else if (mime.includes('ogg')) ext = 'ogg';
      else if (mime.includes('mp4')) ext = 'mp4';

      const audioBlob = new Blob(audioChunksRef.current, { type: mime });
      cleanUpRecording();

      if (audioBlob.size < 100) {
        setVoiceError('Recording was too short. Please speak clearly into the microphone.');
        return;
      }

      setIsTranscribing(true);
      setVoiceError(null);
      try {
        const result = await api.transcribeAudio(audioBlob, `voice_note.${ext}`);
        const text = result.text.trim();
        if (text) {
          setContent((prev) => {
            const trimmedPrev = prev.trim();
            return trimmedPrev ? `${trimmedPrev} ${text}` : text;
          });
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(
                textareaRef.current.value.length,
                textareaRef.current.value.length
              );
            }
          }, 60);
        } else {
          setVoiceError('No speech was detected in the recording. Please try speaking closer to the microphone.');
        }
      } catch (err: any) {
        console.error('[VoiceTranscribeError]', err);
        setVoiceError(err.message || 'Voice transcription failed.');
      } finally {
        setIsTranscribing(false);
      }
    };

    try {
      recorder.stop();
    } catch {
      cleanUpRecording();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      } catch {}
    }
    audioChunksRef.current = [];
    cleanUpRecording();
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  /**
   * Validates and processes a batch of selected/dropped/pasted files in the browser.
   */
  const handleFilesSelected = async (incomingFiles: FileList | File[]) => {
    const fileArray = Array.from(incomingFiles || []);
    if (fileArray.length === 0) return;

    const currentAtts = attachmentsRef.current;
    const { acceptedIndices, rejected } = validateFileBatch(fileArray, currentAtts);
    const accepted = acceptedIndices.map((idx) => fileArray[idx]);

    if (rejected.length > 0) {
      setRejectionReasons(rejected.map((r) => r.reason));
    } else {
      setRejectionReasons([]);
    }

    if (accepted.length === 0) return;

    // 1. Immediately add placeholder entries with 'processing' status so user sees per-file spinners & counter
    const pendingEntries: Array<{ id: string; file: File; controller: AbortController }> = [];

    for (const file of accepted) {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const controller = new AbortController();
      fileAbortControllersRef.current.set(id, controller);

      const safeName = sanitizeFileName(file.name);
      const category = getFileCategory(safeName, file.type);

      const placeholder: Attachment = {
        id,
        fileName: safeName,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        kind: category === 'image' ? 'image' : 'text',
        status: 'processing',
        extractedText: '',
      };

      onAddAttachment(placeholder);
      pendingEntries.push({ id, file, controller });
    }

    // 2. Process each accepted file asynchronously in browser
    await Promise.all(
      pendingEntries.map(async ({ id, file, controller }) => {
        try {
          const processed = await processFile(file, controller.signal);
          if (controller.signal.aborted) return;

          const updates: Partial<Attachment> = {
            fileName: processed.name,
            mimeType: processed.type,
            kind: processed.kind,
            status: 'ready',
            extractedText:
              processed.kind === 'text'
                ? processed.content
                : processed.extractedText || `[Image: ${processed.name}]`,
            previewUrl: processed.kind === 'image' ? processed.content : undefined,
            thumbnailUrl: processed.thumbnailUrl,
            pageImages: processed.pageImages,
            warnings: processed.warnings,
            meta: processed.meta,
          };

          if (onUpdateAttachment) {
            onUpdateAttachment(id, updates);
          } else {
            onRemoveAttachment(id);
            onAddAttachment({
              id,
              fileName: processed.name,
              mimeType: processed.type,
              fileSize: file.size,
              ...updates,
            });
          }
        } catch (err: any) {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          const errMsg = err?.message || `Failed to process "${file.name}".`;
          if (onUpdateAttachment) {
            onUpdateAttachment(id, {
              status: 'error',
              errorMessage: errMsg,
            });
          }
          setRejectionReasons((prev) => [...prev, errMsg]);
        } finally {
          fileAbortControllersRef.current.delete(id);
        }
      })
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await handleFilesSelected(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (id: string) => {
    const ctrl = fileAbortControllersRef.current.get(id);
    if (ctrl) {
      try {
        ctrl.abort();
      } catch {}
      fileAbortControllersRef.current.delete(id);
    }
    onRemoveAttachment(id);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      await handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          pastedFiles.push(file);
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      await handleFilesSelected(pastedFiles);
    }
  };

  const isAnyFileProcessing = attachments.some((a) => a.status === 'processing');
  const readyAttachments = attachments.filter((a) => a.status !== 'error' && a.status !== 'processing');

  const canSubmit =
    (content.trim().length > 0 || readyAttachments.length > 0) &&
    !isAnyFileProcessing &&
    !isTranscribing &&
    !isRecording;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (enterToSend && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      } else if (!enterToSend && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleSend = () => {
    if (isStreaming || isTranscribing || isRecording || isAnyFileProcessing) return;
    if (!content.trim() && readyAttachments.length === 0) return;

    onSendMessage(content.trim(), forceSearch || undefined);
    setContent('');
    setRejectionReasons([]);
    setVoiceError(null);
    setForceSearch(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const renderAttachmentIcon = (att: Attachment) => {
    const cat = getFileCategory(att.fileName, att.mimeType);
    if (cat === 'spreadsheet') {
      return <FileSpreadsheet size={14} style={{ color: '#10b981', flexShrink: 0 }} />;
    }
    if (cat === 'text' && /\.(js|jsx|ts|tsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|html|css|json|xml|yaml|yml|sql)$/i.test(att.fileName)) {
      return <FileCode size={14} style={{ color: '#60a5fa', flexShrink: 0 }} />;
    }
    if (cat === 'image') {
      return <ImageIcon size={14} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />;
    }
    return <FileText size={14} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />;
  };

  return (
    <div className="composer-outer">
      <div
        className={`composer-box ${isMultiLine ? 'is-multiline' : ''} ${
          attachments.length > 0 || rejectionReasons.length > 0 ? 'has-attachments' : ''
        } ${isDragActive ? 'composer-drag-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="composer-dropzone"
      >
        {/* Preview Area Above Input: Counter + Image Thumbnails + File Chips */}
        {attachments.length > 0 && (
          <div className="composer-attachments-area" data-testid="composer-attachments-area">
            <div className="composer-attachments-header">
              <span className="composer-attachment-counter" data-testid="attachment-counter">
                {attachments.length}/{MAX_FILES} files
              </span>
              {isAnyFileProcessing && (
                <span className="composer-processing-hint">
                  <Loader2 size={12} className="spin-animation" />
                  <span>Processing files...</span>
                </span>
              )}
            </div>

            <div className="composer-attachments">
              {attachments.map((att) => {
                const thumbSrc = att.thumbnailUrl || (att.previewUrl && att.previewUrl.startsWith('data:image/') ? att.previewUrl : undefined);
                const isImage =
                  att.kind === 'image' ||
                  Boolean(thumbSrc) ||
                  Boolean(att.mimeType && att.mimeType.startsWith('image/'));
                const status = att.status || 'ready';

                return (
                  <div
                    key={att.id}
                    className={`composer-attachment-pill status-${status}`}
                    data-testid="attachment-chip"
                    data-status={status}
                    title={
                      att.errorMessage
                        ? att.errorMessage
                        : att.warnings && att.warnings.length > 0
                        ? `${att.fileName} — ${att.warnings.join(' ')}`
                        : att.fileName
                    }
                  >
                    {status === 'processing' ? (
                      <Loader2
                        size={14}
                        className="spin-animation"
                        style={{ color: 'var(--accent-light)', flexShrink: 0 }}
                        data-testid="attachment-spinner"
                      />
                    ) : status === 'error' ? (
                      <AlertCircle
                        size={14}
                        style={{ color: 'var(--status-error)', flexShrink: 0 }}
                      />
                    ) : isImage && thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={att.fileName}
                        className="composer-attachment-thumb"
                        data-testid="attachment-thumbnail"
                      />
                    ) : (
                      renderAttachmentIcon(att)
                    )}

                    <div className="composer-attachment-info">
                      <span className="composer-attachment-name">{att.fileName}</span>
                      <span className="composer-attachment-meta">
                        {formatFileSize(att.fileSize)}
                        {status === 'processing' && ' • Processing…'}
                        {status === 'ready' && ' • Ready'}
                        {status === 'error' && ' • Error'}
                        {att.warnings && att.warnings.length > 0 && ` • ${att.warnings[0]}`}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="composer-attachment-remove"
                      onClick={() => handleRemoveFile(att.id)}
                      title={`Remove ${att.fileName}`}
                      aria-label={`Remove ${att.fileName}`}
                      data-testid="remove-attachment-btn"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* File Rejection / Validation Error Banner */}
        {rejectionReasons.length > 0 && (
          <div
            className="composer-rejection-banner"
            role="alert"
            data-testid="upload-rejection-banner"
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <div className="composer-rejection-list">
              {rejectionReasons.map((reason, idx) => (
                <div key={idx} className="composer-rejection-item">
                  {reason}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="composer-voice-error-dismiss"
              onClick={() => setRejectionReasons([])}
              aria-label="Dismiss file warning"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Voice error banner if any */}
        {voiceError && (
          <div className="composer-voice-error-banner">
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{voiceError}</span>
            <button
              type="button"
              className="composer-voice-error-dismiss"
              onClick={() => setVoiceError(null)}
              aria-label="Dismiss error"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Live Audio Recording Interface */}
        {isRecording ? (
          <div className="composer-recording-bar">
            <div className="recording-indicator-left">
              <span className="recording-pulse-dot" />
              <span className="recording-status-label">REC</span>
              <span className="recording-timer">{formatTimer(recordingSeconds)}</span>

              <div className="recording-waveform">
                <span className="waveform-bar bar-1" />
                <span className="waveform-bar bar-2" />
                <span className="waveform-bar bar-3" />
                <span className="waveform-bar bar-4" />
                <span className="waveform-bar bar-5" />
              </div>
            </div>

            <div className="recording-actions-right">
              <button
                type="button"
                className="recording-action-btn cancel"
                onClick={cancelRecording}
                title="Cancel recording (discard audio)"
                aria-label="Cancel recording"
              >
                <Trash2 size={15} />
                <span>Cancel</span>
              </button>

              <button
                type="button"
                className="recording-action-btn finish"
                onClick={stopRecording}
                title="Finish recording and transcribe"
                aria-label="Finish recording"
              >
                <Check size={15} />
                <span>Done</span>
              </button>
            </div>
          </div>
        ) : isTranscribing ? (
          <div className="composer-transcribing-banner">
            <Loader2 size={16} className="spin-animation" style={{ color: 'var(--accent-light)' }} />
            <span>Transcribing your voice...</span>
          </div>
        ) : (
          /* Single-row pill or multiline card layout */
          <div className={`composer-single-row ${isMultiLine ? 'is-multiline' : ''}`}>
            {/* Hidden file input supporting desktop + mobile gallery/camera */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              multiple
              data-testid="file-upload-input"
              accept="image/*,.heic,.heif,.pdf,.docx,.xlsx,.xls,.csv,.pptx,.txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.html,.htm,.css,.scss,.sql,.sh,.yaml,.yml,.xml,.ini,.toml,.log"
            />

            {/* Left Paperclip Attachment Button */}
            <button
              type="button"
              className="composer-plus-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files or images (up to 20 files, 20 MB each)"
              aria-label="Attach files"
              data-testid="attach-file-btn"
              disabled={isRecording || isTranscribing}
            >
              {isAnyFileProcessing ? (
                <Loader2 size={18} className="spin-animation" />
              ) : (
                <Paperclip size={18} />
              )}
            </button>

            {/* Main Textarea */}
            <textarea
              ref={textareaRef}
              className="composer-textarea"
              placeholder={
                attachments.length > 0
                  ? 'Add a message or press Send to analyze attached files...'
                  : 'Ask Madura AI...'
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              data-testid="chat-input-textarea"
            />

            {/* Right Tools (Web Search, Mic, Send) */}
            <div className="composer-right-tools">
              <button
                type="button"
                className={`composer-tool-btn composer-think-btn ${forceSearch ? 'active' : ''}`}
                onClick={() => setForceSearch(!forceSearch)}
                title={forceSearch ? 'Web search ON — click to disable' : 'Enable web search'}
                aria-label="Toggle web search"
                disabled={isRecording || isTranscribing}
              >
                <Globe size={16} />
                <span className="composer-think-label">Search</span>
              </button>

              <button
                type="button"
                className="composer-voice-pill-btn"
                onClick={startRecording}
                title="Click to speak"
                aria-label="Start voice input"
                disabled={isStreaming || isTranscribing}
              >
                {isTranscribing ? (
                  <Loader2 size={16} className="spin-animation" />
                ) : (
                  <Mic size={16} />
                )}
              </button>

              {/* Send / Stop Generation Button */}
              {isStreaming ? (
                <button
                  type="button"
                  className="composer-send-btn stop"
                  onClick={onStopGeneration}
                  title="Stop generating"
                  aria-label="Stop generation"
                  data-testid="stop-generation-btn"
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="composer-send-btn"
                  onClick={handleSend}
                  disabled={!canSubmit}
                  title={
                    isAnyFileProcessing
                      ? 'Please wait for files to finish processing'
                      : 'Send message'
                  }
                  aria-label="Send message"
                  data-testid="send-message-btn"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bar below Chatbox: Model selector */}
      {models && models.length > 0 && onSelectModel && (
        <div className="composer-bottom-bar">
          <div className="composer-bottom-spacer" />
          <div className="composer-bottom-model-slot">
            <ModelSelector
              models={models}
              selectedModel={selectedModel || (models[0]?.id ?? '')}
              onSelect={onSelectModel}
            />
          </div>
        </div>
      )}
    </div>
  );
};
