import React, { useRef, useEffect, useState } from 'react';
import {
  ArrowUp,
  Square,
  Paperclip,
  X,
  FileText,
  Loader2,
  Globe,
  Mic,
  MicOff,
  Check,
  Trash2,
  AlertCircle,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Attachment, ModelInfo } from '../../types/index.js';
import * as api from '../services/api.js';
import { ModelSelector } from './ModelSelector.js';

interface MessageComposerProps {
  isStreaming: boolean;
  enterToSend: boolean;
  attachments: Attachment[];
  initialDraft?: string;
  onSendMessage: (content: string, enableSearch?: boolean) => void;
  onStopGeneration: () => void;
  onAddAttachment: (att: Attachment) => void;
  onRemoveAttachment: (id: string) => void;
  models?: ModelInfo[];
  selectedModel?: string;
  onSelectModel?: (id: string) => void;
}


export const MessageComposer: React.FC<MessageComposerProps> = ({
  isStreaming,
  enterToSend,
  attachments,
  initialDraft = '',
  onSendMessage,
  onStopGeneration,
  onAddAttachment,
  onRemoveAttachment,
  models,
  selectedModel,
  onSelectModel,
}) => {
  const [content, setContent] = useState(initialDraft);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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

  // Sync draft from external prompt selections (e.g. suggestion cards)
  useEffect(() => {
    if (initialDraft) {
      setContent(initialDraft);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [initialDraft]);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
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
        } catch { }
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

      // Dynamically select best supported audio MIME type
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

      recorder.start(250); // Collect in 250ms chunks
      setIsRecording(true);
      setRecordingSeconds(0);

      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 300) {
            // Auto-stop at 5 minutes
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

      // Upload audio to Groq Whisper Large V3 Turbo transcription endpoint
      setIsTranscribing(true);
      setVoiceError(null);
      try {
        const result = await api.transcribeAudio(
          audioBlob,
          `voice_note.${ext}`
        );

        const text = result.text.trim();
        if (text) {
          setContent((prev) => {
            const trimmedPrev = prev.trim();
            return trimmedPrev ? `${trimmedPrev} ${text}` : text;
          });
          // Focus textarea so user can review and edit recognized text before sending
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
        mediaRecorderRef.current.onstop = null; // Prevent transcription trigger
        mediaRecorderRef.current.stop();
      } catch { }
    }
    audioChunksRef.current = [];
    cleanUpRecording();
  };


  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

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
    if (isStreaming || isTranscribing || isRecording) return;
    if (!content.trim() && attachments.length === 0) return;

    onSendMessage(content.trim(), forceSearch || undefined);
    setContent('');
    setUploadError(null);
    setVoiceError(null);
    setForceSearch(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    for (let i = 0; i < files.length; i++) {
      try {
        const att = await api.uploadFile(files[i]);
        onAddAttachment(att);
      } catch (err: any) {
        setUploadError(err.message || 'File upload failed');
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const canSubmit = (content.trim().length > 0 || attachments.length > 0) && !isUploading && !isTranscribing && !isRecording;

  return (
    <div className="composer-outer">
      <div className="composer-box">
        {/* Attachment Pills */}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((att) => (
              <div key={att.id} className="composer-attachment-pill">
                <FileText size={13} style={{ color: 'var(--accent-light)' }} />
                <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.fileName}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  ({(att.fileSize / 1024).toFixed(0)} KB)
                </span>
                <button
                  className="composer-attachment-remove"
                  onClick={() => onRemoveAttachment(att.id)}
                  title="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload error banner if any */}
        {uploadError && (
          <div style={{ color: 'var(--status-error)', fontSize: '12px', padding: '2px 4px' }}>
            {uploadError}
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

              {/* Animated Waveform Bars */}
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
          /* Single-row pill layout matching ChatGPT (Screenshot 1) */
          <div className="composer-single-row">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              multiple
              accept=".pdf,.docx,.csv,.json,.txt,.md,.mp3,.wav,.m4a,.ogg,.flac,.webm,image/png,image/jpeg,image/webp,audio/*"
            />

            {/* Left '+' Attachment Button */}
            <button
              type="button"
              className="composer-plus-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Add attachment"
              aria-label="Add attachment"
              disabled={isUploading || isRecording || isTranscribing}
            >
              {isUploading ? (
                <Loader2 size={18} className="spin-animation" />
              ) : (
                <Plus size={19} />
              )}
            </button>

            {/* Main Textarea */}
            <textarea
              ref={textareaRef}
              className="composer-textarea"
              placeholder="Ask Madura AI..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />

            {/* Right Tools (Web Search, Mic, Send) */}
            <div className="composer-right-tools">
              {/* Think Button (replaces Globe) */}
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

              {/* Voice mic — white filled pill */}
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
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="composer-send-btn"
                  onClick={handleSend}
                  disabled={!canSubmit}
                  title="Send message"
                  aria-label="Send message"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bar below Chatbox: Model selector placed below the web search element */}
      {models && models.length > 0 && onSelectModel && (
        <div className="composer-bottom-bar">
          <div className="composer-bottom-spacer" />
          <div className="composer-bottom-model-slot">
            <ModelSelector
              models={models}
              selectedModel={selectedModel || 'auto'}
              onSelect={onSelectModel}
            />
          </div>
        </div>
      )}
    </div>
  );
};
