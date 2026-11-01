/** The design system's small parts. Everything else is composed from these. */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, HelpCircle, Loader2, X } from 'lucide-react';
import { gsap, prefersReducedMotion, useGSAP } from '../../lib/motion';
import type { Claim } from '../../types/case';

// ------------------------------------------------------------------ brand

export const Mark: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <path d="M3 16c3.600-5.700 7.900-8.500 13-8.500S25.400 10.300 29 16c-3.600 5.700-7.900 8.500-13 8.500S6.600 21.700 3 16Z"
          fill="none" stroke="#edeae3" strokeWidth="1.8" />
    <circle cx="16" cy="16" r="3.800" fill="#f2c037" />
  </svg>
);

// ------------------------------------------------------------------ buttons

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  busy?: boolean;
}

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-paint text-asphalt-950 hover:bg-[#f7cd58] font-medium',
  secondary: 'border border-line-strong text-bone hover:bg-asphalt-800',
  ghost: 'text-bone-300 hover:bg-asphalt-800 hover:text-bone',
  danger: 'border border-signal-red/50 text-signal-red hover:bg-signal-redsoft',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon, busy, children, className = '', disabled, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]'
      } ${BUTTON[variant]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({ label, active, children, className = '', ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={rest.title ?? label}
    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-40 ${
      active ? 'bg-asphalt-700 text-bone' : 'text-bone-400 hover:bg-asphalt-800 hover:text-bone'
    } ${className}`}
    {...rest}
  >
    {children}
  </button>
);

// ------------------------------------------------------------------ segmented control

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex shrink-0 rounded border border-line p-px ${className}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[3px] px-2 text-[12px] transition-colors ${
            o.value === value ? 'bg-asphalt-700 text-bone' : 'text-bone-400 hover:text-bone'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ verdicts

export const VERDICT: Record<Claim['verdict'], { label: string; tone: string; bg: string; Icon: typeof Check }> = {
  consistent: { label: 'Consistent', tone: 'text-signal-green', bg: 'bg-signal-greensoft', Icon: Check },
  inconsistent: { label: 'Not consistent', tone: 'text-signal-red', bg: 'bg-signal-redsoft', Icon: X },
  cant_tell: { label: "Can't tell", tone: 'text-bone-300', bg: 'bg-asphalt-700', Icon: HelpCircle },
};

export const VerdictTag: React.FC<{ verdict: Claim['verdict']; className?: string }> = ({ verdict, className = '' }) => {
  const v = VERDICT[verdict] ?? VERDICT.cant_tell;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[12px] font-medium ${v.tone} ${v.bg} ${className}`}>
      <v.Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
      {v.label}
    </span>
  );
};

// ------------------------------------------------------------------ panels

export const Panel: React.FC<{
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  label?: string;
}> = ({ title, meta, actions, children, className = '', bodyClassName = '', label }) => (
  <section aria-label={label ?? title} className={`flex min-h-0 min-w-0 flex-col bg-asphalt-900 ${className}`}>
    <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="truncate text-[13px] font-medium text-bone">{title}</h2>
        {meta && <span className="truncate text-[12px] text-bone-500">{meta}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
    <div className={`relative min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
  </section>
);

export const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  tone?: string;
  className?: string;
}> = ({ label, value, unit, note, tone = 'text-bone', className = '' }) => (
  <div className={className}>
    <div className="eyebrow">{label}</div>
    <div className={`measured mt-1.5 text-[26px] leading-none ${tone}`}>
      {value}
      {unit && <span className="ml-1 text-[13px] text-bone-400">{unit}</span>}
    </div>
    {note && <div className="mt-1.5 text-[12px] leading-snug text-bone-400">{note}</div>}
  </div>
);

export const Notice: React.FC<{
  tone?: 'info' | 'warn' | 'error';
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ tone = 'info', children, action, className = '' }) => {
  const colour = tone === 'error' ? 'text-signal-red' : tone === 'warn' ? 'text-signal-amber' : 'text-bone-400';
  return (
    <div role={tone === 'error' ? 'alert' : undefined}
         className={`flex items-start gap-2 rounded border border-line bg-asphalt-850 px-3 py-2 text-[13px] text-bone-200 ${className}`}>
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${colour}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; children?: React.ReactNode; action?: React.ReactNode }> = ({ title, children, action }) => (
  <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 p-6 text-center">
    <div className="text-[13px] text-bone-200">{title}</div>
    {children && <div className="max-w-xs text-[12px] leading-relaxed text-bone-400">{children}</div>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-asphalt-800 ${className}`} aria-hidden="true" />
);

// ------------------------------------------------------------------ dialog

export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerExtra?: React.ReactNode;
  width?: string;
}> = ({ open, onClose, title, description, children, footer, headerExtra, width = 'max-w-3xl' }) => {
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previousFocus.current?.focus?.();
    };
  }, [open]);

  useGSAP(
    () => {
      if (!open || prefersReducedMotion()) return;
      gsap.from(root.current, { opacity: 0, duration: 0.18, ease: 'none' });
      gsap.from(sheet.current, { y: 14, opacity: 0, duration: 0.38 });
    },
    { dependencies: [open], scope: root },
  );

  // Keep Tab inside the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !sheet.current) return;
    const items = sheet.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;
  return createPortal(
    <div ref={root} className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`flex max-h-[92dvh] w-full ${width} flex-col overflow-hidden rounded-t-lg border border-line-strong bg-asphalt-900 outline-none sm:rounded-lg`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-[20px] font-light leading-tight text-bone">{title}</h2>
              {headerExtra}
            </div>
            {description && <p className="mt-1 text-[13px] text-bone-400">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="shrink-0 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};
