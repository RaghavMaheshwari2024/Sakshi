import React from 'react';
import { X, ExternalLink, MapPin, Info } from 'lucide-react';

interface GoogleMapsGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyPreset?: (w: number, l: number) => void;
}

export const GoogleMapsGuideModal: React.FC<GoogleMapsGuideModalProps> = ({
  isOpen,
  onClose,
  onApplyPreset,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 animate-fade-in">
      <div className="relative flex flex-col w-full max-w-2xl bg-asphalt-900 border border-line rounded-lg shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-asphalt-950">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-paint/10 border border-paint/20 text-paint">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-bone-100 font-mono">
                Google Maps Satellite Calibration Guide
              </h3>
              <p className="text-xs text-bone-400 mt-0.5">
                How any user can calibrate road dimensions in 60 seconds with honest ±15cm uncertainty.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded hover:bg-asphalt-800 text-bone-400 hover:text-bone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Quick launch link */}
          <div className="rounded-lg border border-paint/30 bg-paint/10 p-3.5 flex items-center justify-between">
            <div className="text-xs text-bone-200">
              <span className="font-semibold text-paint">Step 0:</span> Open the incident location on Google Maps Satellite.
            </div>
            <a
              href="https://www.google.com/maps/@?api=1&map_action=map&basemap=satellite"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-paint text-asphalt-950 font-mono text-xs font-semibold hover:bg-paint/90 transition-colors"
            >
              <span>Open Google Maps</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-4 p-4 rounded border border-line bg-asphalt-950">
              <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-asphalt-800 border border-line font-mono text-xs font-bold text-paint">
                1
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-bone-100">Find 4 Recognizable Road Features</h4>
                <p className="text-xs text-bone-300 leading-relaxed">
                  Identify a rectangular section of the road visible in both the CCTV clip and Google Maps satellite view
                  (e.g., crosswalk zebra stripes, lane edges, stop line, or manhole covers).
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4 p-4 rounded border border-line bg-asphalt-950">
              <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-asphalt-800 border border-line font-mono text-xs font-bold text-paint">
                2
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-bone-100">Right-Click & Select "Measure distance"</h4>
                <p className="text-xs text-bone-300 leading-relaxed">
                  Right-click corner 1 on Google Maps &rarr; select <span className="font-mono text-bone-200">"Measure distance"</span>.
                  Click corner 2 to measure the width (<span className="font-mono text-paint">W</span> in metres).
                  Click corner 3 to measure the length (<span className="font-mono text-paint">L</span> in metres).
                </p>
                <div className="mt-2 text-[11px] font-mono text-bone-400 bg-asphalt-900 p-2 rounded border border-line/60">
                  Example: Typical urban single lane width = 3.5 m · Junction segment length = 10.0 m
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4 p-4 rounded border border-line bg-asphalt-950">
              <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-asphalt-800 border border-line font-mono text-xs font-bold text-paint">
                3
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-bone-100">Enter W and L in Sakshi</h4>
                <p className="text-xs text-bone-300 leading-relaxed">
                  Click the 4 corners on the CCTV frame in order (Bottom-Left &rarr; Bottom-Right &rarr; Top-Right &rarr; Top-Left),
                  enter your measured Width and Length, and click <span className="font-mono text-bone-200">"Apply & Recalibrate"</span>.
                </p>
              </div>
            </div>
          </div>

          {/* Honest Uncertainty Explanation */}
          <div className="rounded border border-line bg-asphalt-950 p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 text-paint font-semibold font-mono">
              <Info className="w-4 h-4 text-paint" />
              <span>Honest Metric Uncertainty: ±15 cm (σ = 0.15 m)</span>
            </div>
            <p className="text-bone-300 leading-relaxed text-[12px]">
              Satellite orthorectification in Google Maps has a typical horizontal root-mean-square variance of ±15 cm.
              Instead of hiding this error, Sakshi propagates <span className="font-mono text-bone-200">σ = 0.15 m</span> through
              Monte Carlo variations, honestly widening the 90% confidence speed bands so forensic claims are mathematically defensible.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-line bg-asphalt-950 text-xs">
          <span className="text-bone-400 font-mono">Ready to calibrate?</span>
          <div className="flex items-center gap-2">
            {onApplyPreset && (
              <button
                onClick={() => {
                  onApplyPreset(3.5, 10.0);
                  onClose();
                }}
                className="px-3 py-1.5 rounded bg-paint/20 border border-paint text-paint font-mono text-xs font-semibold hover:bg-paint/30 transition-colors"
              >
                Use Standard 3.5m × 10.0m
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-asphalt-800 hover:bg-asphalt-700 text-bone-100 font-mono text-xs transition-colors border border-line"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
