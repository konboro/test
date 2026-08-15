import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/** Small shared primitives so every screen looks like the same product. */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-ink-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning' | 'positive';
}) {
  const toneClass =
    tone === 'warning' ? 'text-amber-700' : tone === 'positive' ? 'text-emerald-700' : 'text-ink-900';

  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`tabular mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}

const BADGE_TONES = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  positive: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-brand-50 text-brand-700 ring-brand-100',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} className={`${buttonClass(variant)} ${className}`} />;
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <Link {...props} className={`${buttonClass(variant)} ${className}`} />;
}

function buttonClass(variant: 'primary' | 'secondary' | 'danger') {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

  if (variant === 'primary') {
    return `${base} bg-ink-900 text-white hover:bg-ink-800`;
  }
  if (variant === 'danger') {
    return `${base} bg-red-600 text-white hover:bg-red-700`;
  }
  return `${base} border border-ink-300 bg-white text-ink-700 hover:bg-ink-50`;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'mt-1.5 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
