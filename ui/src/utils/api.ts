/** The backend (api/app.py). Optional: every pre-rendered scenario works without it. */
import type { CaseData } from '../types/case';
import { useCaseStore } from '../store/useCaseStore';

export interface BackendCase {
  id: string;
  status: 'done' | 'ready' | 'calibrate';
  camera_mode: 'fixed' | 'dashcam';
  statements: number;
  updated: number;
  thumbnail: string;
}

/** The case list, or null when no backend is running. */
export async function fetchBackendCases(): Promise<BackendCase[] | null> {
  try {
    const res = await fetch('/cases', { headers: { Accept: 'application/json' } });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const cases = await res.json();
    return Array.isArray(cases) ? cases : null; // something else may be answering on that port
  } catch {
    return null;
  }
}

export interface BackendStatus {
  live: boolean;
  code_required: boolean;
  max_upload_mb: number;
  max_clip_seconds: number;
}

/** What the server can do, or null when no backend is running. */
export async function fetchBackendStatus(): Promise<BackendStatus | null> {
  try {
    const res = await fetch('/cases/status', { headers: { Accept: 'application/json' } });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function unlockBackend(code: string): Promise<boolean> {
  const res = await fetch('/cases/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  return res.ok;
}

export const backendVideoUrl = (id: string) => `/cases/${id}/video`;

/** Open a finished backend case in the workspace. */
export async function openBackendCase(id: string): Promise<void> {
  const res = await fetch(`/cases/${id}/case.json`);
  if (!res.ok) throw new Error(res.status === 404 ? 'This case has not been run yet.' : `Server returned ${res.status}`);
  const data: CaseData = await res.json();
  acceptBackendCase(id, data);
}

export function acceptBackendCase(id: string, data: CaseData): void {
  const st = useCaseStore.getState();
  st.loadCase(data, backendVideoUrl(id));
  st.setScenarioId(null);
  st.setBackendCaseId(id);
  const u = new URL(window.location.href);
  u.searchParams.delete('scenario');
  window.history.replaceState(null, '', u.toString());
}
