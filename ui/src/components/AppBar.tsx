import React, { useLayoutEffect, useRef } from 'react';
import { CircleHelp, Plus, Workflow } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { ScenarioPicker } from './ScenarioPicker';
import { Button, IconButton, Mark } from './ui';
import { gsap, prefersReducedMotion } from '../lib/motion';

export type ActiveView = 'overview' | 'case' | 'calibration' | 'report' | 'accuracy' | 'system';

/** Keyboard: 1-4 are the investigator's original views; 0 and 5 the two new ones. */
export const VIEW_KEYS: Record<string, ActiveView> = {
  '0': 'overview',
  '1': 'case',
  '2': 'report',
  '3': 'accuracy',
  '4': 'calibration',
  '5': 'system',
};

const NAV: { view: ActiveView; label: string; hint: string; key: string }[] = [
  { view: 'overview', label: 'Overview', hint: 'What Sakshi does and why', key: '0' },
  { view: 'case', label: 'Investigate', hint: 'Synchronised footage, replay, speed and statements', key: '1' },
  { view: 'calibration', label: 'Calibrate', hint: 'Fit the road plane to the camera', key: '4' },
  { view: 'report', label: 'Report', hint: 'The written dossier', key: '2' },
  { view: 'accuracy', label: 'Validation', hint: 'Scores against CARLA ground truth', key: '3' },
  { view: 'system', label: 'System', hint: 'Models, pipeline and architecture', key: '5' },
];

interface AppBarProps {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  onOpenProcessing?: () => void;
  onOpenNewCase?: () => void;
  onOpenGuide?: () => void;
  onCalibrateCase?: (id: string) => void;
}

export const AppBar: React.FC<AppBarProps> = ({ activeView, setActiveView, onOpenProcessing, onOpenNewCase, onOpenGuide, onCalibrateCase }) => {
  const validated = useCaseStore((s) => s.caseData?.report?.validator?.passed);
  const navRef = useRef<HTMLElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  // The marker slides between tabs; it is the one piece of motion in the chrome.
  useLayoutEffect(() => {
    const place = (animate: boolean) => {
      const nav = navRef.current, marker = markerRef.current;
      const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !marker || !tab) return;
      const vars = { x: tab.offsetLeft, width: tab.offsetWidth, opacity: 1 };
      if (animate && !prefersReducedMotion()) gsap.to(marker, { ...vars, duration: 0.34, overwrite: true });
      else gsap.set(marker, vars);
    };
    place(placed.current);
    placed.current = true;
    document.fonts?.ready.then(() => place(false));
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeView]);

  return (
    <div className="border-b border-line bg-asphalt-900/95 backdrop-blur-sm">
      <header className="flex h-bar items-center gap-3 px-3 sm:px-4">
        <button onClick={() => setActiveView('overview')} className="flex shrink-0 items-center gap-2" aria-label="Sakshi, overview">
          <Mark />
          <span className="font-serif text-[17px] text-bone">Sakshi</span>
        </button>

        <div className="mx-1 hidden h-5 w-px bg-line lg:block" />

        <nav ref={navRef} aria-label="Primary" className="relative hidden h-bar items-stretch lg:flex">
          {NAV.map(({ view, label, hint, key }) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              aria-current={activeView === view ? 'page' : undefined}
              title={`${hint} (press ${key})`}
              className={`flex items-center gap-1.5 px-2.5 text-[13px] transition-colors ${
                activeView === view ? 'text-bone' : 'text-bone-400 hover:text-bone'
              }`}
            >
              {label}
              {view === 'report' && validated && (
                <span className="h-1 w-1 rounded-full bg-signal-green" title="Number check passed" />
              )}
            </button>
          ))}
          <span ref={markerRef} aria-hidden="true" className="absolute bottom-0 left-0 h-[2px] w-0 bg-paint opacity-0" />
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <ScenarioPicker onPicked={() => setActiveView('case')} onCalibrate={onCalibrateCase} />
          {onOpenGuide && (
            <IconButton label="Guide and shortcuts (press ?)" onClick={onOpenGuide}>
              <CircleHelp className="h-4 w-4" />
            </IconButton>
          )}
          {onOpenProcessing && (
            <IconButton label="Pipeline run" className="xl:hidden" onClick={onOpenProcessing}>
              <Workflow className="h-4 w-4" />
            </IconButton>
          )}
          {onOpenProcessing && (
            <Button variant="ghost" size="sm" className="hidden xl:inline-flex" title="See all 11 pipeline stages" icon={<Workflow className="h-3.5 w-3.5" />} onClick={onOpenProcessing}>
              Pipeline run
            </Button>
          )}
          {onOpenNewCase && (
            <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={onOpenNewCase} title="Upload new crash footage">
              <span className="hidden sm:inline">New case</span>
              <span className="sr-only sm:hidden">New case</span>
            </Button>
          )}
        </div>
      </header>

      {/* Small screens: the same navigation as a scrolling strip. */}
      <nav aria-label="Primary, compact" className="flex overflow-x-auto border-t border-line lg:hidden">
        {NAV.map(({ view, label }) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            aria-current={activeView === view ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-[13px] ${
              activeView === view ? 'border-paint text-bone' : 'border-transparent text-bone-400'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
};
