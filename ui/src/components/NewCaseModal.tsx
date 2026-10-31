import React, { useState, useRef, useCallback } from 'react';
import {
  X,
  Upload,
  Video,
  Camera,
  FileAudio,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Volume2,
} from 'lucide-react';

export interface StatementInput {
  id: string;
  speaker: string;
  text: string;
  audioFile?: File | null;
  mode: 'text' | 'audio';
  language: 'Hindi' | 'English' | 'Both';
}

export interface NewCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaseCreated: (caseId: string, cameraMode: 'fixed' | 'dashcam') => void;
}

const ACCEPTED_VIDEO_TYPES = ['.mp4', '.mkv', '.avi', 'video/mp4', 'video/x-matroska', 'video/x-msvideo'];

export const NewCaseModal: React.FC<NewCaseModalProps> = ({
  isOpen,
  onClose,
  onCaseCreated,
}) => {
  // Form State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [cameraMode, setCameraMode] = useState<'fixed' | 'dashcam'>('fixed');
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['Hindi', 'English']);
  const [statements, setStatements] = useState<StatementInput[]>([
    {
      id: 's1',
      speaker: 'Driver of White Car',
      text: 'I was driving at 30 km/h and entered on a green light.',
      mode: 'text',
      language: 'English',
    },
    {
      id: 's2',
      speaker: 'Driver of Red Car',
      text: 'The other vehicle crossed the junction at high speed before I could brake.',
      mode: 'text',
      language: 'English',
    },
  ]);

  // UI state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video File Processing & Duration probe
  const processVideoFile = (file: File) => {
    setFileError(null);

    // Validate format
    const name = file.name.toLowerCase();
    const isFormatValid =
      name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi');

    if (!isFormatValid) {
      setFileError('Invalid format. Please upload an MP4, MKV, or AVI video file.');
      return;
    }

    setVideoFile(file);

    // Probe duration via temporary object URL
    try {
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      const objUrl = URL.createObjectURL(file);
      tempVideo.src = objUrl;
      tempVideo.onloadedmetadata = () => {
        setVideoDuration(Math.round(tempVideo.duration * 10) / 10);
        URL.revokeObjectURL(objUrl);
      };
    } catch {
      setVideoDuration(null);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processVideoFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Statement management
  const addStatement = () => {
    const nextNum = statements.length + 1;
    setStatements([
      ...statements,
      {
        id: `s${nextNum}`,
        speaker: nextNum === 3 ? 'Pedestrian / Witness' : `Party ${nextNum}`,
        text: '',
        mode: 'text',
        language: 'Both',
      },
    ]);
  };

  const removeStatement = (idx: number) => {
    if (statements.length <= 1) return;
    setStatements(statements.filter((_, i) => i !== idx));
  };

  const updateStatement = (idx: number, updates: Partial<StatementInput>) => {
    setStatements(statements.map((s, i) => (i === idx ? { ...s, ...updates } : s)));
  };

  // Submission handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setFileError('Please select or drop an incident video clip.');
      return;
    }

    setIsSubmitting(true);
    setUploadProgress('Preparing upload package...');

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('camera_mode', cameraMode);
      formData.append('languages', JSON.stringify(selectedLanguages));

      // Build statements list and collect audio attachments
      const statementsPayload = statements.map((s) => {
        const item: any = {
          id: s.id,
          speaker: s.speaker,
          text: s.text,
        };
        if (s.mode === 'audio' && s.audioFile) {
          const filename = `${s.id}_${s.audioFile.name}`;
          item.audio = `audio/${filename}`;
          formData.append('audio', s.audioFile, filename);
        }
        return item;
      });

      formData.append('statements_json', JSON.stringify(statementsPayload));

      setUploadProgress('Uploading video and statements to backend...');

      const response = await fetch('/cases', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${await response.text()}`);
      }

      const resData = await response.json();
      const caseId = resData.id || `case_${Date.now()}`;
      onCaseCreated(caseId, cameraMode);
      onClose();
    } catch (err: any) {
      console.warn('API upload encountered error, falling back to local case mode:', err);
      // Fallback locally for demo or offline mode
      const fallbackId = `case_${Date.now().toString(36).slice(-6)}`;
      onCaseCreated(fallbackId, cameraMode);
      onClose();
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-800 text-cyan-400">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100 tracking-wide">
                Initialize New Forensic Crash Case
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Ingest incident clip, configure camera mode, and register witness/driver statements
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Section 1: Video Clip Upload */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center justify-between">
              <span>Incident Video Clip</span>
              <span className="text-[11px] font-mono font-normal text-zinc-400">
                Recommended: ≤ 60s for deterministic microsecond accuracy
              </span>
            </label>

            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-950/30'
                  : videoFile
                  ? 'border-emerald-500/60 bg-emerald-950/10'
                  : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_VIDEO_TYPES.join(',')}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    processVideoFile(e.target.files[0]);
                  }
                }}
                className="hidden"
              />

              {videoFile ? (
                <div className="flex flex-col items-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-950 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-lg">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-zinc-100">{videoFile.name}</span>
                    <div className="flex items-center justify-center space-x-3 text-xs font-mono text-zinc-400 mt-1">
                      <span>{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                      <span>•</span>
                      <span>{videoFile.name.split('.').pop()?.toUpperCase()}</span>
                      {videoDuration !== null && (
                        <>
                          <span>•</span>
                          <span className={videoDuration > 60 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                            {videoDuration}s {videoDuration > 60 ? '(Long clip)' : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-cyan-400 hover:underline pt-1">
                    Click or drop another file to replace
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-zinc-200">
                      Drag and drop road video, or <span className="text-cyan-400 underline">browse</span>
                    </span>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Supports MP4 (H.264), MKV, AVI from CCTV, dashcam or witness phones
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Error or Duration Alert */}
            {fileError && (
              <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{fileError}</span>
              </div>
            )}

            {videoDuration !== null && videoDuration > 60 && (
              <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-800/80 text-amber-300 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  Video is {videoDuration}s long. For optimum forensic precision, clips under 60 seconds around the collision window are recommended.
                </span>
              </div>
            )}
          </div>

          {/* Section 2: Camera Type Selector */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Camera Vantage Type
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Option 1: Fixed CCTV */}
              <div
                onClick={() => setCameraMode('fixed')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start space-x-3 ${
                  cameraMode === 'fixed'
                    ? 'bg-cyan-950/30 border-cyan-500/80 shadow-md shadow-cyan-950/30'
                    : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div
                  className={`p-2 rounded-lg mt-0.5 ${
                    cameraMode === 'fixed' ? 'bg-cyan-900/60 text-cyan-400' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-semibold text-zinc-200">Fixed CCTV Junction</span>
                    {cameraMode === 'fixed' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    Roadside mast, pole or building camera. Fixed road plane homography with static stop line and traffic lights.
                  </p>
                </div>
              </div>

              {/* Option 2: Dashcam */}
              <div
                onClick={() => setCameraMode('dashcam')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start space-x-3 ${
                  cameraMode === 'dashcam'
                    ? 'bg-rose-950/30 border-rose-500/80 shadow-md shadow-rose-950/30'
                    : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div
                  className={`p-2 rounded-lg mt-0.5 ${
                    cameraMode === 'dashcam' ? 'bg-rose-900/60 text-rose-400' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-semibold text-zinc-200">Dashcam Ego-Motion</span>
                    {cameraMode === 'dashcam' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    Vehicle-mounted camera. Solves ego-vehicle trajectory with dynamic road plane and lane-width photogrammetry.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Multilingual Settings */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Model Speech & Text Languages
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">Muse Voice + Wonder</span>
            </div>
            <div className="flex items-center space-x-2">
              {['Hindi', 'English'].map((lang) => {
                const isSelected = selectedLanguages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      if (isSelected && selectedLanguages.length > 1) {
                        setSelectedLanguages(selectedLanguages.filter((l) => l !== lang));
                      } else if (!isSelected) {
                        setSelectedLanguages([...selectedLanguages, lang]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all ${
                      isSelected
                        ? 'bg-purple-950/70 border-purple-500/70 text-purple-300'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {lang === 'Hindi' ? 'Hindi (हिन्दी)' : 'English (en-IN / en-US)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 4: Witness & Party Statements */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                  Party & Witness Statements ({statements.length})
                </label>
                <p className="text-[11px] text-zinc-400">
                  Transcribed by Muse Voice and evaluated against physical trajectory bounds
                </p>
              </div>
              <button
                type="button"
                onClick={addStatement}
                className="px-2.5 py-1 rounded-lg text-xs font-mono bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center space-x-1 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Statement</span>
              </button>
            </div>

            <div className="space-y-3">
              {statements.map((stmt, idx) => (
                <div
                  key={stmt.id}
                  className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-mono text-zinc-300">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-mono font-semibold text-zinc-300">
                        Statement [{stmt.id}]
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {/* Mode Switch: Text vs Audio */}
                      <div className="flex items-center rounded-lg bg-zinc-950 p-0.5 border border-zinc-800 text-[10px] font-mono">
                        <button
                          type="button"
                          onClick={() => updateStatement(idx, { mode: 'text' })}
                          className={`px-2 py-0.5 rounded transition-all ${
                            stmt.mode === 'text'
                              ? 'bg-zinc-800 text-zinc-100'
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          Text
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatement(idx, { mode: 'audio' })}
                          className={`px-2 py-0.5 rounded transition-all ${
                            stmt.mode === 'audio'
                              ? 'bg-pink-950 text-pink-300 border border-pink-800/80'
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          Audio Upload
                        </button>
                      </div>

                      {statements.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStatement(idx)}
                          className="text-zinc-500 hover:text-rose-400 p-1 transition-colors"
                          title="Remove statement"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Speaker Attribution Label */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase text-zinc-400">
                        Speaker Attribution / Role:
                      </span>
                      <div className="flex items-center space-x-1">
                        {['Driver of White Car', 'Driver of Red Car', 'Pedestrian'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => updateStatement(idx, { speaker: preset })}
                            className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          >
                            {preset.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={stmt.speaker}
                      onChange={(e) => updateStatement(idx, { speaker: e.target.value })}
                      placeholder="e.g. Driver of the White Sedan, Shopkeeper Eyewitness"
                      className="w-full px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* Statement Input: Textarea or Audio Upload */}
                  {stmt.mode === 'text' ? (
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-zinc-400">
                        Statement Content (Hindi / English):
                      </span>
                      <textarea
                        value={stmt.text}
                        onChange={(e) => updateStatement(idx, { text: e.target.value })}
                        rows={2}
                        placeholder='e.g. "I was doing 30 and the light was green before impact."'
                        className="w-full px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 resize-none font-mono"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-pink-400 flex items-center space-x-1">
                        <Volume2 className="w-3 h-3" />
                        <span>Voice Recording (Muse Voice Transcribe):</span>
                      </span>
                      <div className="p-3 rounded-lg border border-dashed border-pink-900/60 bg-pink-950/10 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <FileAudio className="w-5 h-5 text-pink-400" />
                          <div className="text-left">
                            <span className="text-xs font-mono text-zinc-200">
                              {stmt.audioFile ? stmt.audioFile.name : 'No audio file attached'}
                            </span>
                            <p className="text-[10px] text-zinc-500">
                              Supports .mp3, .wav, .m4a recordings
                            </p>
                          </div>
                        </div>
                        <label className="px-2.5 py-1 rounded bg-pink-950 border border-pink-800 text-pink-300 text-xs font-mono cursor-pointer hover:bg-pink-900">
                          <span>{stmt.audioFile ? 'Change' : 'Browse'}</span>
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                updateStatement(idx, { audioFile: e.target.files[0] });
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons Footer */}
          <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-all"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !videoFile}
              className="px-5 py-2.5 rounded-lg text-xs font-mono font-semibold bg-cyan-400 hover:bg-cyan-300 text-zinc-950 shadow-lg shadow-cyan-950/40 flex items-center space-x-2 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{uploadProgress || 'Initializing...'}</span>
                </>
              ) : (
                <>
                  <span>Initialize Case & Calibrate</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
