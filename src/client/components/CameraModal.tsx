import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Camera,
  X,
  RotateCcw,
  Check,
  Plus,
  Trash2,
  SwitchCamera,
  AlertCircle,
  Loader2,
  Upload,
  ArrowLeft,
  Image as ImageIcon,
} from 'lucide-react';

export interface CapturedPhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapturePhotos: (files: File[]) => void;
  existingAttachmentCount?: number;
  maxFilesAllowed?: number;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCapturePhotos,
  existingAttachmentCount = 0,
  maxFilesAllowed = 20,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Multi-image collection state
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhotoItem[]>([]);
  // Active newly captured snapshot awaiting user action (Retake / Add / Attach)
  const [currentSnapshot, setCurrentSnapshot] = useState<CapturedPhotoItem | null>(null);
  // Optional inspection of a previously captured photo from the gallery tray
  const [inspectPhotoId, setInspectPhotoId] = useState<string | null>(null);

  // Maximum new photos this session can add without exceeding total maxFilesAllowed (20)
  const maxSessionAllowed = Math.max(0, maxFilesAllowed - existingAttachmentCount);
  const totalCount = existingAttachmentCount + capturedPhotos.length + (currentSnapshot ? 1 : 0);
  const isMaxReached = capturedPhotos.length >= maxSessionAllowed;

  // Active item to display in preview mode if inspecting or reviewing
  const activePreviewItem =
    currentSnapshot ||
    (inspectPhotoId ? capturedPhotos.find((p) => p.id === inspectPhotoId) : null);

  // Stop camera stream tracks and clear video source
  const stopCameraTracks = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.warn('Error stopping camera track:', e);
          }
        });
      } catch (e) {
        console.warn('Error accessing tracks:', e);
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch (e) {
        console.warn('Error clearing video srcObject:', e);
      }
    }
  }, []);

  // Revoke object URLs created during the session
  const cleanupUrls = useCallback(() => {
    if (currentSnapshot?.previewUrl) {
      URL.revokeObjectURL(currentSnapshot.previewUrl);
    }
    capturedPhotos.forEach((p) => {
      if (p.previewUrl) {
        URL.revokeObjectURL(p.previewUrl);
      }
    });
  }, [currentSnapshot, capturedPhotos]);

  // Clean exit helper
  const handleFullCancel = useCallback(() => {
    cleanupUrls();
    setCapturedPhotos([]);
    setCurrentSnapshot(null);
    setInspectPhotoId(null);
    stopCameraTracks();
    setErrorMessage(null);
    onClose();
  }, [cleanupUrls, stopCameraTracks, onClose]);

  // Check if multiple camera devices exist
  const checkAvailableCameras = useCallback(async () => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.enumerateDevices === 'function'
      ) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      }
    } catch (e) {
      console.warn('Could not enumerate media devices:', e);
    }
  }, []);

  // Start live camera stream
  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      setIsLoading(true);
      setErrorMessage(null);
      stopCameraTracks();

      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.hostname === '::1');
      const isSecure =
        typeof window !== 'undefined' && (window.isSecureContext || isLocalhost);

      if (!isSecure) {
        setErrorMessage(
          'Camera access requires a secure connection (HTTPS) or localhost. Please use the fallback option below.'
        );
        setIsLoading(false);
        return;
      }

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setErrorMessage(
          'Live camera capture is not supported by your browser or environment. Please use the fallback option below.'
        );
        setIsLoading(false);
        return;
      }

      try {
        let stream: MediaStream;
        try {
          // Attempt ideal constraints preferring selected facingMode and full HD resolution
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch (constraintErr: any) {
          console.warn('Ideal constraints failed, attempting fallback constraints:', constraintErr);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: mode },
              audio: false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('muted', 'true');
          video.setAttribute('autoplay', 'true');

          const handleVideoReady = async () => {
            try {
              await video.play();
            } catch (playErr) {
              console.warn('video.play() failed:', playErr);
            }
            setIsLoading(false);
          };

          video.onloadedmetadata = handleVideoReady;
          video.oncanplay = handleVideoReady;

          video.play().then(() => setIsLoading(false)).catch(() => {});
        }

        await checkAvailableCameras();
      } catch (err: any) {
        stopCameraTracks();
        setIsLoading(false);
        console.error('getUserMedia error:', err);

        let friendlyMsg = 'Unable to access the camera.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          friendlyMsg =
            'Camera permission was denied. Please allow camera access in your browser site permissions.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          friendlyMsg = 'No camera device found on this system.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          friendlyMsg =
            'Camera is currently in use by another application or blocked by the operating system.';
        } else if (err.name === 'OverconstrainedError') {
          friendlyMsg = 'Your camera does not support the requested video settings.';
        } else if (err.message) {
          friendlyMsg = `Camera error: ${err.message}`;
        }

        setErrorMessage(friendlyMsg);
      }
    },
    [stopCameraTracks, checkAvailableCameras]
  );

  // Switch between front and rear cameras
  const handleSwitchCamera = useCallback(() => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    startCamera(newMode);
  }, [facingMode, startCamera]);

  // Capture current video frame to JPEG Blob -> File -> CapturedPhotoItem
  const handleCapture = useCallback(() => {
    if (isMaxReached) {
      setErrorMessage(
        `Maximum limit of ${maxFilesAllowed} total images reached for this message.`
      );
      return;
    }

    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setErrorMessage('Camera video feed is still initializing. Please wait a moment.');
      return;
    }

    try {
      const videoW = video.videoWidth;
      const videoH = video.videoHeight;
      const MAX_CAPTURE_WIDTH = 1600;

      let targetW = videoW;
      let targetH = videoH;

      if (targetW > MAX_CAPTURE_WIDTH || targetH > MAX_CAPTURE_WIDTH) {
        if (targetW >= targetH) {
          const scale = MAX_CAPTURE_WIDTH / targetW;
          targetW = MAX_CAPTURE_WIDTH;
          targetH = Math.max(1, Math.round(videoH * scale));
        } else {
          const scale = MAX_CAPTURE_WIDTH / targetH;
          targetH = MAX_CAPTURE_WIDTH;
          targetW = Math.max(1, Math.round(videoW * scale));
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context could not be created.');
      }

      // Draw the video frame onto the canvas (mirror horizontally if front camera)
      if (facingMode === 'user') {
        ctx.save();
        ctx.translate(targetW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, targetW, targetH);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, targetW, targetH);
      }

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size === 0) {
            setErrorMessage('Failed to generate image file from captured frame.');
            return;
          }

          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(Math.floor(now.getMilliseconds() / 10))}`;
          const fileName = `camera_photo_${timestamp}.jpg`;

          const file = new File([blob], fileName, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          const previewUrl = URL.createObjectURL(blob);
          const newItem: CapturedPhotoItem = {
            id: `cam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            file,
            previewUrl,
            width: targetW,
            height: targetH,
          };

          setCurrentSnapshot(newItem);
          setInspectPhotoId(null);
          setErrorMessage(null);
        },
        'image/jpeg',
        0.9
      );
    } catch (err: any) {
      console.error('Frame capture failed:', err);
      setErrorMessage(`Capture failed: ${err?.message || 'unknown error'}`);
    }
  }, [isMaxReached, maxFilesAllowed, facingMode]);

  // Retake current snapshot: discard and return to live camera
  const handleRetakeSnapshot = useCallback(() => {
    if (currentSnapshot?.previewUrl) {
      URL.revokeObjectURL(currentSnapshot.previewUrl);
    }
    setCurrentSnapshot(null);
    setInspectPhotoId(null);
    setErrorMessage(null);
  }, [currentSnapshot]);

  // Add current snapshot to collection and continue capturing
  const handleAddSnapshot = useCallback(() => {
    if (!currentSnapshot) return;

    setCapturedPhotos((prev) => [...prev, currentSnapshot]);
    setCurrentSnapshot(null);
    setInspectPhotoId(null);
    setErrorMessage(null);
  }, [currentSnapshot]);

  // Remove a single photo from collection
  const handleRemovePhoto = useCallback(
    (photoId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setCapturedPhotos((prev) => {
        const target = prev.find((p) => p.id === photoId);
        if (target?.previewUrl) {
          URL.revokeObjectURL(target.previewUrl);
        }
        return prev.filter((p) => p.id !== photoId);
      });
      if (inspectPhotoId === photoId) {
        setInspectPhotoId(null);
      }
    },
    [inspectPhotoId]
  );

  // Clear all captured photos from this session
  const handleClearAllPhotos = useCallback(() => {
    capturedPhotos.forEach((p) => {
      if (p.previewUrl) {
        URL.revokeObjectURL(p.previewUrl);
      }
    });
    if (currentSnapshot?.previewUrl) {
      URL.revokeObjectURL(currentSnapshot.previewUrl);
    }
    setCapturedPhotos([]);
    setCurrentSnapshot(null);
    setInspectPhotoId(null);
  }, [capturedPhotos, currentSnapshot]);

  // Finish capturing and attach all images to chatbox
  const handleAttachAll = useCallback(() => {
    const filesToAttach: File[] = [];

    // Include already collected photos
    capturedPhotos.forEach((item) => {
      filesToAttach.push(item.file);
    });

    // If currently reviewing a snapshot, include it as well
    if (currentSnapshot) {
      filesToAttach.push(currentSnapshot.file);
    }

    if (filesToAttach.length === 0) {
      handleFullCancel();
      return;
    }

    // Cleanup session preview URLs
    cleanupUrls();
    setCapturedPhotos([]);
    setCurrentSnapshot(null);
    setInspectPhotoId(null);
    stopCameraTracks();

    // Pass all File objects to the existing chat attachment pipeline
    onCapturePhotos(filesToAttach);
    onClose();
  }, [capturedPhotos, currentSnapshot, cleanupUrls, handleFullCancel, stopCameraTracks, onCapturePhotos, onClose]);

  // Handle fallback file selection (e.g. mobile system camera/gallery)
  const handleFallbackFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const selected = Array.from(files).slice(0, maxSessionAllowed);
      cleanupUrls();
      setCapturedPhotos([]);
      setCurrentSnapshot(null);
      setInspectPhotoId(null);
      stopCameraTracks();
      onCapturePhotos(selected);
      onClose();
    }
    if (fallbackInputRef.current) {
      fallbackInputRef.current.value = '';
    }
  };

  // Modal open/close lifecycle
  useEffect(() => {
    if (isOpen) {
      setCapturedPhotos([]);
      setCurrentSnapshot(null);
      setInspectPhotoId(null);
      setErrorMessage(null);
      startCamera(facingMode);
    } else {
      cleanupUrls();
      setCapturedPhotos([]);
      setCurrentSnapshot(null);
      setInspectPhotoId(null);
      stopCameraTracks();
    }

    return () => {
      stopCameraTracks();
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleFullCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleFullCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop camera-modal-backdrop"
      onClick={handleFullCancel}
      data-testid="camera-modal-backdrop"
    >
      <div
        className="modal-card camera-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-modal-title"
      >
        {/* Hidden Fallback Input */}
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFallbackFiles}
          data-testid="camera-fallback-input"
        />

        {/* Modal Header */}
        <div className="modal-header camera-modal-header">
          <div className="camera-modal-title-row">
            <Camera size={18} className="camera-modal-icon" />
            <h3 id="camera-modal-title" className="modal-title">
              {currentSnapshot
                ? 'Preview Photo'
                : inspectPhotoId
                ? 'Review Captured Photo'
                : 'Take Photos'}
            </h3>
            <span
              className={`camera-counter-badge ${isMaxReached ? 'limit-reached' : ''}`}
              title={`${totalCount} of ${maxFilesAllowed} maximum attachments`}
            >
              {totalCount}/{maxFilesAllowed}
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleFullCancel}
            aria-label="Close camera"
            title="Close camera"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Video or Preview Image */}
        <div className="camera-modal-body">
          {errorMessage ? (
            <div className="camera-error-container">
              <AlertCircle size={36} className="camera-error-icon" />
              <p className="camera-error-title">Camera Unavailable</p>
              <p className="camera-error-message">{errorMessage}</p>
              <div className="camera-error-actions">
                <button
                  type="button"
                  className="camera-fallback-btn"
                  onClick={() => fallbackInputRef.current?.click()}
                >
                  <Upload size={16} />
                  <span>Use System Camera / Files</span>
                </button>
                <button
                  type="button"
                  className="camera-retry-btn"
                  onClick={() => startCamera(facingMode)}
                >
                  Retry Camera
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Live Video Feed (Always mounted so stream stays active without re-initialization) */}
              <div
                className="camera-live-container"
                style={{ display: activePreviewItem ? 'none' : 'flex' }}
              >
                {isLoading && (
                  <div className="camera-loading-overlay">
                    <Loader2 size={32} className="spin-animation" />
                    <span>Connecting camera...</span>
                  </div>
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`camera-video-stream ${facingMode === 'user' ? 'mirrored' : ''}`}
                />
              </div>

              {/* Captured Photo / Inspected Photo Preview */}
              {activePreviewItem && (
                <div className="camera-preview-container">
                  <img
                    src={activePreviewItem.previewUrl}
                    alt="Captured snapshot preview"
                    className="camera-captured-img"
                  />
                  <div className="camera-preview-badge">
                    {activePreviewItem.width} × {activePreviewItem.height} px
                    {currentSnapshot && ' • Current Frame'}
                    {inspectPhotoId && !currentSnapshot && ' • Saved Photo'}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Max images limit notice banner */}
          {isMaxReached && !errorMessage && !currentSnapshot && (
            <div className="camera-limit-notice">
              Maximum of {maxFilesAllowed} images reached. Click <strong>Attach Photos</strong> below to add them to your message.
            </div>
          )}
        </div>

        {/* Thumbnail Gallery Tray (shows collected photos in this session) */}
        {capturedPhotos.length > 0 && (
          <div className="camera-gallery-tray">
            <div className="camera-gallery-header">
              <span className="camera-gallery-label">
                <ImageIcon size={13} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
                Captured Photos ({capturedPhotos.length})
              </span>
              <button
                type="button"
                className="camera-clear-all-btn"
                onClick={handleClearAllPhotos}
                title="Remove all captured photos from this session"
              >
                <Trash2 size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />
                Clear All
              </button>
            </div>

            <div className="camera-thumbnails-scroll">
              {capturedPhotos.map((item, idx) => {
                const isSelected = inspectPhotoId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`camera-thumb-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setCurrentSnapshot(null);
                      setInspectPhotoId(isSelected ? null : item.id);
                    }}
                    title={`Photo ${idx + 1} (${item.width}x${item.height}) - Click to inspect`}
                  >
                    <img src={item.previewUrl} alt={`Captured ${idx + 1}`} />
                    <button
                      type="button"
                      className="camera-thumb-remove-btn"
                      onClick={(e) => handleRemovePhoto(item.id, e)}
                      title="Remove this photo"
                      aria-label="Remove photo"
                    >
                      <X size={11} />
                    </button>
                    <span className="camera-thumb-index">{idx + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Modal Footer Controls */}
        <div className="camera-modal-footer">
          {currentSnapshot ? (
            /* Reviewing just-captured snapshot */
            <div className="camera-review-controls">
              <button
                type="button"
                className="btn-secondary camera-retake-btn"
                onClick={handleRetakeSnapshot}
                title="Discard this photo and return to live camera"
              >
                <RotateCcw size={15} />
                <span>Retake</span>
              </button>

              <div className="camera-review-right-group">
                {!isMaxReached && (
                  <button
                    type="button"
                    className="btn-secondary camera-add-btn"
                    onClick={handleAddSnapshot}
                    title="Add this photo and continue capturing more"
                  >
                    <Plus size={15} />
                    <span>Add Photo</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn-primary camera-attach-btn"
                  onClick={handleAttachAll}
                  data-testid="camera-attach-photos-btn"
                  title="Finish capturing and attach all photos to chat"
                >
                  <Check size={16} />
                  <span>
                    Attach {capturedPhotos.length + 1} Photo
                    {capturedPhotos.length + 1 > 1 ? 's' : ''}
                  </span>
                </button>
              </div>
            </div>
          ) : inspectPhotoId ? (
            /* Inspecting a previously collected photo */
            <div className="camera-inspect-controls">
              <button
                type="button"
                className="btn-secondary camera-back-btn"
                onClick={() => setInspectPhotoId(null)}
                title="Return to live camera"
              >
                <ArrowLeft size={15} />
                <span>Back to Camera</span>
              </button>

              <div className="camera-review-right-group">
                <button
                  type="button"
                  className="btn-danger camera-delete-btn"
                  onClick={() => handleRemovePhoto(inspectPhotoId)}
                  title="Delete this photo from collection"
                >
                  <Trash2 size={15} />
                  <span>Delete</span>
                </button>

                <button
                  type="button"
                  className="btn-primary camera-attach-btn"
                  onClick={handleAttachAll}
                >
                  <Check size={16} />
                  <span>Attach {capturedPhotos.length} Photo{capturedPhotos.length > 1 ? 's' : ''}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Live Camera Feed Mode */
            <div className="camera-live-controls-bar">
              <div className="camera-live-row">
                <button
                  type="button"
                  className="camera-cancel-btn"
                  onClick={handleFullCancel}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="camera-shutter-btn"
                  onClick={handleCapture}
                  disabled={isLoading || !!errorMessage || isMaxReached}
                  aria-label="Capture Photo"
                  title={
                    isMaxReached
                      ? 'Maximum 20 photos reached'
                      : 'Capture current camera frame'
                  }
                  data-testid="camera-capture-btn"
                >
                  <div className="camera-shutter-inner" />
                </button>

                <button
                  type="button"
                  className={`camera-switch-btn ${hasMultipleCameras ? 'visible' : 'optional'}`}
                  onClick={handleSwitchCamera}
                  disabled={isLoading || !!errorMessage}
                  aria-label="Switch Camera"
                  title={
                    facingMode === 'environment'
                      ? 'Switch to Front Camera'
                      : 'Switch to Rear Camera'
                  }
                >
                  <SwitchCamera size={19} />
                </button>
              </div>

              {/* If user already captured photos, provide immediate Attach button */}
              {capturedPhotos.length > 0 && (
                <div className="camera-attach-bar">
                  <button
                    type="button"
                    className="btn-primary camera-attach-all-btn"
                    onClick={handleAttachAll}
                    data-testid="camera-attach-all-btn"
                  >
                    <Check size={16} />
                    <span>
                      Attach {capturedPhotos.length} Photo
                      {capturedPhotos.length > 1 ? 's' : ''} to Message
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
