import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Dialog, Segmented } from './ui';

interface InvestigatorGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'workspace' | 'panels' | 'shortcuts' | 'limits';

const PANELS = [
  ['Footage', 'The clip with SAM 3.1 masks. Yellow dots mark tyre-road contact. Click a vehicle to filter everything to it; press M to hide the masks.'],
  ['Reconstruction', 'The same motion on the road plane, in metres: vehicles, stop line, impact point. Switch between road-fixed and car-centred, or open the 3D replay, where a wire-frame shows the vehicle at its claimed speed.'],
  ['Speed', 'Speed over time with its 90% interval. Vertical marks show impact and braking onset. Click or drag anywhere to move the playhead.'],
  ['Statements', 'Each checkable claim, quoted as it was said, in Hindi or English, with its verdict: consistent, not consistent, or can’t tell. Show me jumps to the measurement behind it.'],
];

const SHORTCUTS: [string, string, string][] = [
  ['Space or K', 'Play or pause', 'Footage and replay together'],
  ['← →', 'Step one frame', 'One frame of the clip'],
  ['J L', 'Step five frames', 'Back or forward'],
  ['M', 'Masks', 'Show or hide SAM 3.1 masks'],
  ['N P', 'Walkthrough', 'Next or previous step'],
  ['0 to 5', 'Change view', '0 Overview, 1 Investigate, 2 Report, 3 Validation, 4 Calibrate, 5 System'],
  ['?', 'This guide', 'Open or close it at any time'],
  ['Esc', 'Back out', 'Close a dialog, or return to the workspace'],
];

export const InvestigatorGuideModal: React.FC<InvestigatorGuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('workspace');
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (!isOpen && dontShowAgain) localStorage.setItem('sakshi_guide_seen', 'true');
  }, [isOpen, dontShowAgain]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Investigator guide"
      description="One timeline, four views of it, and every claim one click from its evidence."
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-bone-400">
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} className="accent-[#f2c037]" />
            Don’t show on startup
          </label>
          <Button variant="primary" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={onClose}>Enter the workspace</Button>
        </div>
      }
    >
      <div className="border-b border-line px-5 py-2">
        <Segmented
          label="Guide section"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'workspace', label: 'The idea' },
            { value: 'panels', label: 'The panels' },
            { value: 'shortcuts', label: 'Keyboard' },
            { value: 'limits', label: 'Limits' },
          ]}
        />
      </div>
      <div className="p-5 text-[14px] leading-relaxed text-bone-200">
        {activeTab === 'workspace' && (
          <div className="space-y-4">
            <p>
              Sakshi puts footage, reconstruction, speed and statements on a single timeline. Scrub any of them,
              click a speed curve or pick a statement, and every panel moves to that exact instant.
            </p>
            <dl className="divide-y divide-line border-y border-line">
              <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                <dt className="text-bone">Show me</dt>
                <dd className="text-bone-300">When a statement is in question, Show me jumps to the moment and marks the window the measurement came from.</dd>
              </div>
              <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                <dt className="text-bone">Intervals, always</dt>
                <dd className="text-bone-300">A bare speed is never shown. Monte Carlo runs over the clicks, ground distances, contact point, mask jitter, frame times and smoother stiffness give a 90% interval.</dd>
              </div>
              <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                <dt className="text-bone">The type tells you</dt>
                <dd className="text-bone-300"><span className="said">Serif italic is what someone said.</span> <span className="measured">Mono is what was measured.</span></dd>
              </div>
            </dl>
          </div>
        )}

        {activeTab === 'panels' && (
          <dl className="divide-y divide-line border-y border-line">
            {PANELS.map(([name, body]) => (
              <div key={name} className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                <dt className="text-bone">{name}</dt>
                <dd className="text-bone-300">{body}</dd>
              </div>
            ))}
          </dl>
        )}

        {activeTab === 'shortcuts' && (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Key</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                {SHORTCUTS.map(([key, action, detail]) => (
                  <tr key={key}>
                    <td className="whitespace-nowrap"><span className="kbd">{key}</span></td>
                    <td className="whitespace-nowrap text-bone">{action}</td>
                    <td>{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'limits' && (
          <div className="space-y-3">
            <p>
              Sakshi is a measurement instrument. It computes speeds, timing and statement consistency to support
              qualified reconstructionists, surveyors and courts.
            </p>
            <p className="said border-l-2 border-paint pl-3">
              Measurements to support expert review. Sakshi does not determine fault or legal liability.
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-bone-300">
              <li>It never assigns fault, blame or liability.</li>
              <li>Language models never produce a number; a validator rejects any figure in the report that the engine did not compute.</li>
              <li>Statements are judged only as consistent, not consistent, or can’t tell.</li>
              <li>The road is treated as flat. Dashcam motion is not yet removed, so results assume a fixed camera.</li>
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
};
