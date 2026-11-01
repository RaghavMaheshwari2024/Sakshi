import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackendStatus, fetchBackendStatus, unlockBackend } from '../utils/api';
import { ArrowRight, Check, FileAudio, Plus, Trash2, Upload } from 'lucide-react';
import { Button, Dialog, IconButton, Notice, Segmented } from './ui';

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

const Heading: React.FC<{ children: React.ReactNode; hint?: React.ReactNode }> = ({ children, hint }) => (
  <div className="mb-2 flex items-baseline justify-between gap-3">
    <h3 className="text-[13px] font-medium text-bone">{children}</h3>
    {hint && <span className="text-[12px] text-bone-500">{hint}</span>}
  </div>
);

const CAMERAS = [
  { id: 'fixed' as const, label: 'Fixed camera', body: 'Roadside mast, pole or building. One road-plane homography, with a stop line and signals.' },
  { id: 'dashcam' as const, label: 'Dashcam', body: 'Stored with the case. The engine does not yet remove the camera’s own motion, so results assume a fixed camera.' },
];

export const NewCaseModal: React.FC<NewCaseModalProps> = ({ isOpen, onClose, onCaseCreated }) => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [cameraMode, setCameraMode] = useState<'fixed' | 'dashcam'>('fixed');
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['Hindi', 'English']);
  const [statements, setStatements] = useState<StatementInput[]>([
    { id: 's1', speaker: 'Driver of White Car', text: '', mode: 'text', language: 'English' },
    { id: 's2', speaker: 'Driver of Red Car', text: '', mode: 'text', language: 'English' },
  ]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [server, setServer] = useState<BackendStatus | null | 'checking'>('checking');
  const [accessCode, setAccessCode] = useState('');

  useEffect(() => {
    fetchBackendStatus().then(setServer);
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processVideoFile = (file: File) => {
    setFileError(null);
    const name = file.name.toLowerCase();
    if (!(name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi'))) {
      setFileError('Please choose an MP4, MKV or AVI video.');
      return;
    }
    setVideoFile(file);
    setVideoDuration(null);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    const objUrl = URL.createObjectURL(file);
    probe.src = objUrl;
    probe.onloadedmetadata = () => {
      setVideoDuration(Math.round(probe.duration * 10) / 10);
      URL.revokeObjectURL(objUrl);
    };
    probe.onerror = () => URL.revokeObjectURL(objUrl);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) processVideoFile(e.dataTransfer.files[0]);
  }, []);

  const addStatement = () => {
    const nextNum = Math.max(0, ...statements.map((s) => Number(s.id.slice(1)) || 0)) + 1;
    setStatements([...statements, {
      id: `s${nextNum}`,
      speaker: nextNum === 3 ? 'Pedestrian / Witness' : `Party ${nextNum}`,
      text: '',
      mode: 'text',
      language: 'Both',
    }]);
  };

  const removeStatement = (idx: number) => {
    if (statements.length > 1) setStatements(statements.filter((_, i) => i !== idx));
  };

  const updateStatement = (idx: number, updates: Partial<StatementInput>) => {
    setStatements(statements.map((s, i) => (i === idx ? { ...s, ...updates } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setFileError('Please choose an incident clip first.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    setUploadProgress('Preparing');
    try {
      if (server && server !== 'checking' && server.code_required && !(await unlockBackend(accessCode))) {
        throw new Error('That access code is not right.');
      }
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('camera_mode', cameraMode);
      formData.append('languages', JSON.stringify(selectedLanguages));
      const payload = statements.map((s) => {
        const item: { id: string; speaker: string; text: string; audio?: string } = { id: s.id, speaker: s.speaker, text: s.text };
        if (s.mode === 'audio' && s.audioFile) {
          const filename = `${s.id}_${s.audioFile.name}`;
          item.audio = `audio/${filename}`;
          formData.append('audio', s.audioFile, filename);
        }
        return item;
      });
      formData.append('statements_json', JSON.stringify(payload));
      setUploadProgress('Uploading');
      const response = await fetch('/cases', { method: 'POST', body: formData });
      if (!response.ok) {
        const detail = await response.json().then((j) => j.detail).catch(() => null);
        throw new Error(detail || `The server returned ${response.status}.`);
      }
      const resData = await response.json();
      onCaseCreated(resData.id, cameraMode);
    } catch (err) {
      setSubmitError(
        err instanceof TypeError || (err as Error).message?.includes('50')
          ? 'The backend is not reachable, so the case was not created. Start it with: uvicorn api.app:app'
          : (err as Error).message,
      );
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      width="max-w-2xl"
      title="New case"
      description="Add the clip and what each person said. Next you calibrate the road, then the pipeline runs."
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-case" busy={isSubmitting} disabled={!videoFile}
                  icon={<ArrowRight className="h-3.5 w-3.5" />}>
            {uploadProgress || 'Create and calibrate'}
          </Button>
        </div>
      }
    >
      <form id="new-case" onSubmit={handleSubmit} className="space-y-6 p-5">
        {submitError && <Notice tone="error">{submitError}</Notice>}
        {server === null && (
          <Notice tone="warn">No backend is connected here, so a new case cannot run. The 16 recorded benchmark cases still work.</Notice>
        )}
        {server && server !== 'checking' && !server.live && (
          <Notice tone="warn">This server has no model API key, so a new clip cannot be analysed.</Notice>
        )}
        {server && server !== 'checking' && (
          <p className="text-[12.5px] text-bone-400">
            This runs the real pipeline on the Meta models and usually takes a few minutes. Limits here: {server.max_upload_mb} MB, {server.max_clip_seconds} s.
          </p>
        )}
        {server && server !== 'checking' && server.code_required && (
          <label className="block space-y-1 text-[12.5px] text-bone-300">
            <span>Access code</span>
            <input type="password" required value={accessCode} autoComplete="off" onChange={(e) => setAccessCode(e.target.value)} className="field w-full" />
          </label>
        )}

        <section>
          <Heading hint="Under 60 s around the collision works best">Incident clip</Heading>
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose an incident clip"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed px-4 py-7 text-center transition-colors ${
              isDragging ? 'border-paint bg-paint-soft' : 'border-line-strong hover:bg-asphalt-850'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_VIDEO_TYPES.join(',')}
              onChange={(e) => { if (e.target.files?.[0]) processVideoFile(e.target.files[0]); }}
              className="hidden"
            />
            {videoFile ? (
              <>
                <Check className="h-4 w-4 text-signal-green" />
                <div className="text-[13px] text-bone">{videoFile.name}</div>
                <div className="measured text-[12px] text-bone-400">
                  {(videoFile.size / (1024 * 1024)).toFixed(2)} MB · {videoFile.name.split('.').pop()?.toUpperCase()}
                  {videoDuration !== null && <> · <span className={videoDuration > 60 ? 'text-signal-amber' : ''}>{videoDuration} s</span></>}
                </div>
                <div className="text-[12px] text-bone-500">Click or drop to replace</div>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-bone-400" />
                <div className="text-[13px] text-bone-200">Drop a video here, or <span className="text-paint">browse</span></div>
                <div className="text-[12px] text-bone-500">MP4, MKV or AVI from CCTV, a dashcam or a phone</div>
              </>
            )}
          </div>
          {fileError && <Notice tone="error" className="mt-2">{fileError}</Notice>}
          {videoDuration !== null && videoDuration > 60 && (
            <Notice tone="warn" className="mt-2">This clip is {videoDuration} s long. Trimming to under 60 s around the collision gives better tracking and lower cost.</Notice>
          )}
        </section>

        <section>
          <Heading>Camera</Heading>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Camera type">
            {CAMERAS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={cameraMode === c.id}
                onClick={() => setCameraMode(c.id)}
                className={`rounded border p-3 text-left transition-colors ${cameraMode === c.id ? 'border-paint' : 'border-line hover:border-line-strong'}`}
              >
                <div className="text-[13px] text-bone">{c.label}</div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-bone-400">{c.body}</p>
              </button>
            ))}
          </div>
        </section>

        <section>
          <Heading hint="Muse Voice and Muse Wonder">Languages</Heading>
          <div className="flex gap-2">
            {['Hindi', 'English'].map((lang) => {
              const on = selectedLanguages.includes(lang);
              return (
                <button
                  key={lang}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (on && selectedLanguages.length > 1) setSelectedLanguages(selectedLanguages.filter((l) => l !== lang));
                    else if (!on) setSelectedLanguages([...selectedLanguages, lang]);
                  }}
                  className={`rounded border px-3 py-1.5 text-[13px] transition-colors ${on ? 'border-paint text-bone' : 'border-line text-bone-400 hover:border-line-strong'}`}
                >
                  {lang === 'Hindi' ? 'हिन्दी Hindi' : 'English'}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium text-bone">Statements ({statements.length})</h3>
              <p className="text-[12px] text-bone-500">Each is checked against the measured motion. Audio is transcribed by Muse Voice.</p>
            </div>
            <Button size="sm" icon={<Plus className="h-3 w-3" />} onClick={addStatement}>Add</Button>
          </div>

          <div className="space-y-2">
            {statements.map((stmt, idx) => (
              <div key={stmt.id} className="space-y-2 rounded border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="measured text-[12px] text-bone-400">{stmt.id}</span>
                  <div className="flex items-center gap-1">
                    <Segmented
                      label={`Statement ${stmt.id} input`}
                      value={stmt.mode}
                      onChange={(mode) => updateStatement(idx, { mode })}
                      options={[{ value: 'text', label: 'Text' }, { value: 'audio', label: 'Audio' }]}
                    />
                    {statements.length > 1 && (
                      <IconButton label="Remove statement" onClick={() => removeStatement(idx)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={`speaker-${stmt.id}`} className="text-[12px] text-bone-400">Speaker</label>
                    <div className="flex gap-1">
                      {['Driver of White Car', 'Driver of Red Car', 'Pedestrian'].map((preset) => (
                        <button key={preset} type="button" onClick={() => updateStatement(idx, { speaker: preset })}
                                className="rounded-[3px] px-1 text-[11.5px] text-bone-500 hover:bg-asphalt-800 hover:text-bone">
                          {preset.split(' ').slice(-2).join(' ').replace('of ', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    id={`speaker-${stmt.id}`}
                    type="text"
                    value={stmt.speaker}
                    onChange={(e) => updateStatement(idx, { speaker: e.target.value })}
                    placeholder="Driver of the white sedan, shopkeeper, ..."
                    className="field"
                  />
                </div>

                {stmt.mode === 'text' ? (
                  <div>
                    <label htmlFor={`text-${stmt.id}`} className="mb-1 block text-[12px] text-bone-400">What they said, in Hindi or English</label>
                    <textarea
                      id={`text-${stmt.id}`}
                      value={stmt.text}
                      onChange={(e) => updateStatement(idx, { text: e.target.value })}
                      rows={2}
                      placeholder="I was doing 30 and the light was green."
                      className="field resize-none font-serif"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded border border-dashed border-line-strong px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileAudio className="h-4 w-4 shrink-0 text-bone-400" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-bone-200">{stmt.audioFile ? stmt.audioFile.name : 'No recording attached'}</div>
                        <div className="text-[12px] text-bone-500">.mp3, .wav or .m4a</div>
                      </div>
                    </div>
                    <label className="inline-flex h-7 cursor-pointer items-center rounded border border-line-strong px-2 text-[12px] text-bone hover:bg-asphalt-800">
                      {stmt.audioFile ? 'Change' : 'Browse'}
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => { if (e.target.files?.[0]) updateStatement(idx, { audioFile: e.target.files[0] }); }}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </form>
    </Dialog>
  );
};
