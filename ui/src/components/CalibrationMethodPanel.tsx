/** How the road's real size is established when nobody has surveyed it. */
import React, { Suspense, lazy, useState } from 'react';
import { Crosshair, MapPin as MapPinIcon, Search, Undo2 } from 'lucide-react';
import { ROAD_PRESETS } from '../content/calibrationPresets';
import { parseLatLng } from '../utils/geo';
import { Button, Notice, Segmented, Skeleton } from './ui';

const SatelliteMap = lazy(() => import('./SatelliteMap'));

export type CalibMethod = 'manual' | 'preset' | 'satellite';

export interface RectSize {
  id: string;
  width_m: number;
  length_m: number;
  sigma_width_m: number;
  sigma_length_m: number;
}

interface PanelPoint {
  id: string;
  lat?: number;
  lng?: number;
  pending?: boolean;
}

interface Props {
  method: CalibMethod;
  points: PanelPoint[];
  rect: RectSize;
  onRectChange: (r: RectSize) => void;
  onStart: (m: CalibMethod) => void;
  onUndo: () => void;
  onMapPick: (lat: number, lng: number, zoom: number | null) => void;
  onMapMove: (id: string, lat: number, lng: number, zoom: number) => void;
}

const CORNERS = ['near left', 'near right', 'far right', 'far left'];
const num = 'measured w-full rounded border border-line-strong bg-asphalt-950 px-2 py-1 text-right text-[12.5px] text-bone-200 outline-none focus:border-paint';

const NumberField: React.FC<{ label: string; value: number; step: number; onChange: (v: number) => void }> = ({ label, value, step, onChange }) => (
  <label className="space-y-1 text-[11.5px] text-bone-400">
    <span>{label}</span>
    <input type="number" min={0} step={step} value={value} className={num} onChange={(e) => onChange(Number(e.target.value))} />
  </label>
);

export const CalibrationMethodPanel: React.FC<Props> = ({ method, points, rect, onRectChange, onStart, onUndo, onMapPick, onMapMove }) => {
  const [tab, setTab] = useState<CalibMethod>(method);
  const [place, setPlace] = useState('');
  const [placeNote, setPlaceNote] = useState<string | null>(null);
  const [target, setTarget] = useState<[number, number] | null>(null);
  const [typed, setTyped] = useState('');

  const placed = points.length;
  const awaitingMap = method === 'satellite' && points.some((p) => p.pending);
  const pairs = points.filter((p) => !p.pending).length;

  const choosePreset = (id: string) => {
    if (id === 'custom') { onRectChange({ ...rect, id }); return; }
    const p = ROAD_PRESETS.find((x) => x.id === id)!;
    onRectChange({ id, width_m: p.width_m, length_m: p.length_m, sigma_width_m: p.sigma_width_m, sigma_length_m: p.sigma_length_m });
  };

  const search = async () => {
    const coords = parseLatLng(place);
    if (coords) { setTarget(coords); setPlaceNote(null); return; }
    setPlaceNote('Searching…');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`);
      const hits = await res.json();
      if (!hits.length) { setPlaceNote('Nothing found. Try a nearby place, or paste coordinates.'); return; }
      setTarget([Number(hits[0].lat), Number(hits[0].lon)]);
      setPlaceNote(null);
    } catch {
      setPlaceNote('Search is not reachable. Paste coordinates instead.');
    }
  };

  const addTyped = () => {
    const c = parseLatLng(typed);
    if (!c) { setPlaceNote('Coordinates look like 28.6139, 77.2090.'); return; }
    setPlaceNote(null);
    setTyped('');
    onMapPick(c[0], c[1], null);
  };

  return (
    <div className="space-y-3 border-b border-line p-4">
      <div className="space-y-1.5">
        <h3 className="text-[12.5px] font-medium text-bone-200">How do you know the road’s size?</h3>
        <Segmented
          label="Calibration method"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'preset', label: 'Road markings', title: 'Assume standard road sizes' },
            { value: 'satellite', label: 'Satellite map', title: 'Match points on a satellite map' },
            { value: 'manual', label: 'I measured it', title: 'Type measured ground coordinates' },
          ]}
        />
      </div>

      {tab === 'manual' && (
        <div className="space-y-2 text-[12.5px] text-bone-300">
          <p>Best if someone has surveyed the site: click road points and type their positions in metres.</p>
          {method !== 'manual' && <Button size="sm" onClick={() => onStart('manual')}>Go back to typed points</Button>}
        </div>
      )}

      {tab === 'preset' && (
        <div className="space-y-2.5">
          <p className="text-[12.5px] text-bone-300">Pick a rectangle you can see on the road. Its size is assumed, so speed intervals widen to allow for it.</p>
          <div className="space-y-1.5">
            {[...ROAD_PRESETS, { id: 'custom', label: 'My own rectangle', hint: 'Sides you measured, for example with Google Maps’ “Measure distance”.', width_m: 0, length_m: 0, sigma_width_m: 0, sigma_length_m: 0 }].map((p) => (
              <button key={p.id} type="button" onClick={() => choosePreset(p.id)} aria-pressed={rect.id === p.id}
                      className={`w-full rounded border p-2 text-left transition-colors ${rect.id === p.id ? 'border-paint bg-paint-soft' : 'border-line bg-asphalt-850 hover:bg-asphalt-800'}`}>
                <span className="flex items-baseline justify-between gap-2 text-[12.5px] text-bone">
                  {p.label}
                  {p.id !== 'custom' && <span className="measured shrink-0 text-[11.5px] text-bone-400">{p.width_m} × {p.length_m} m</span>}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-bone-400">{p.hint}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Width (m)" step={0.1} value={rect.width_m} onChange={(v) => onRectChange({ ...rect, width_m: v })} />
            <NumberField label="Length (m)" step={0.1} value={rect.length_m} onChange={(v) => onRectChange({ ...rect, length_m: v })} />
            <NumberField label="Width unsure by ± (m)" step={0.05} value={rect.sigma_width_m} onChange={(v) => onRectChange({ ...rect, sigma_width_m: v })} />
            <NumberField label="Length unsure by ± (m)" step={0.05} value={rect.sigma_length_m} onChange={(v) => onRectChange({ ...rect, sigma_length_m: v })} />
          </div>
          {method === 'preset' && placed < 4 ? (
            <Notice><span className="text-bone">Click corner {placed + 1} of 4 on the frame: {CORNERS[placed]}.</span> “Width” runs from corner 1 to corner 2.</Notice>
          ) : (
            <Button size="sm" variant="primary" icon={<Crosshair className="h-3.5 w-3.5" />} onClick={() => onStart('preset')}>
              {method === 'preset' ? 'Click the corners again' : 'Click the 4 corners'}
            </Button>
          )}
          {method === 'preset' && placed > 0 && placed < 4 && <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={onUndo}>Undo last corner</Button>}
        </div>
      )}

      {tab === 'satellite' && (
        <div className="space-y-2.5">
          <p className="text-[12.5px] text-bone-300">Find the junction, then click the same road mark on the frame and on the map. Use marks flat on the road, spread widely. Tiles and searches go to Esri and OpenStreetMap, which reveals the area you look at.</p>
          <div className="flex gap-1.5">
            <input value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                   placeholder="Place, or 28.6139, 77.2090" aria-label="Search for a place"
                   className="min-w-0 flex-1 rounded border border-line-strong bg-asphalt-950 px-2 py-1 text-[12.5px] text-bone-200 outline-none focus:border-paint" />
            <Button size="sm" icon={<Search className="h-3.5 w-3.5" />} onClick={search} disabled={!place.trim()}>Find</Button>
          </div>
          {placeNote && <p className="text-[12px] text-signal-amber">{placeNote}</p>}
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <SatelliteMap
              pins={points.filter((p) => p.lat !== undefined).map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng! }))}
              target={target}
              armed={awaitingMap}
              onPick={onMapPick}
              onMovePin={onMapMove}
            />
          </Suspense>
          {method === 'satellite' ? (
            <>
              <Notice>
                <span className="text-bone">{awaitingMap ? `Now click the same mark on the map for ${points[points.length - 1].id}.` : `Click a road mark on the frame for point ${placed + 1}.`}</span>{' '}
                {pairs} pair{pairs === 1 ? '' : 's'} so far. {pairs < 4 ? 'At least 4 are needed.' : pairs < 6 ? '6 or more let the fit check itself.' : 'The fit error now checks your clicks.'}
              </Notice>
              {awaitingMap && (
                <div className="flex gap-1.5">
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTyped(); }}
                         placeholder="Or paste from Google Earth: lat, lng" aria-label="Paste coordinates for this point"
                         className="min-w-0 flex-1 rounded border border-line-strong bg-asphalt-950 px-2 py-1 text-[12.5px] text-bone-200 outline-none focus:border-paint" />
                  <Button size="sm" onClick={addTyped} disabled={!typed.trim()}>Add</Button>
                </div>
              )}
              {placed > 0 && <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={onUndo}>Undo last point</Button>}
            </>
          ) : (
            <Button size="sm" variant="primary" icon={<MapPinIcon className="h-3.5 w-3.5" />} onClick={() => onStart('satellite')}>Start matching points</Button>
          )}
        </div>
      )}
    </div>
  );
};
