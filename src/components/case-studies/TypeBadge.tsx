import { Activity, Newspaper, Calendar, CheckCircle2 } from 'lucide-react';
import type { CaseStudyType } from './caseStudyTypes';

const TYPE_CONFIG: Record<CaseStudyType, { label: string; color: string; bg: string; border: string; Icon: typeof Activity }> = {
  volume_shock: {
    label: 'Volume Shock',
    color: 'text-[#f59e0b]',
    bg: 'bg-[#f59e0b]/10',
    border: 'border-[#f59e0b]/30',
    Icon: Activity,
  },
  external_event: {
    label: 'External Event',
    color: 'text-[#00d4ff]',
    bg: 'bg-[#00d4ff]/10',
    border: 'border-[#00d4ff]/30',
    Icon: Newspaper,
  },
  calendar: {
    label: 'Calendar',
    color: 'text-[#8b5cf6]',
    bg: 'bg-[#8b5cf6]/10',
    border: 'border-[#8b5cf6]/30',
    Icon: Calendar,
  },
  resolution: {
    label: 'Resolution',
    color: 'text-[#10b981]',
    bg: 'bg-[#10b981]/10',
    border: 'border-[#10b981]/30',
    Icon: CheckCircle2,
  },
};

export function TypeBadge({ type, size = 'sm' }: { type: CaseStudyType; size?: 'sm' | 'md' }) {
  const cfg = TYPE_CONFIG[type];
  const padding = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';
  const text = size === 'md' ? 'text-[11px]' : 'text-[10px]';
  const iconSize = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${padding} rounded-md ${text} font-bold tracking-wider uppercase ${cfg.bg} ${cfg.color} border ${cfg.border}`}
    >
      <cfg.Icon className={iconSize} />
      {cfg.label}
    </span>
  );
}

export function typeColor(type: CaseStudyType): string {
  return TYPE_CONFIG[type].color.match(/#[0-9a-f]+/i)?.[0] ?? '#00d4ff';
}
