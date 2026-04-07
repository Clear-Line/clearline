'use client';

import Link from 'next/link';
import { Activity, Search, ArrowLeft } from 'lucide-react';
import type { Category } from './mapTypes';
import { CATEGORY_COLORS, CATEGORY_LABELS, ALL_CATEGORIES } from './mapConstants';

interface MapTopBarProps {
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function MapTopBar({
  activeCategories,
  onToggleCategory,
  searchQuery,
  onSearchChange,
}: MapTopBarProps) {
  return (
    <div className="fixed top-0 inset-x-0 z-10 h-16 flex items-center px-6 gap-5 bg-[#04040B]/85 backdrop-blur-2xl border-b border-white/[0.08]">
      {/* Logo */}
      <Link href="/terminal" className="flex items-center gap-2.5 shrink-0 group">
        <Activity className="h-5 w-5 text-[#00D4FF]" />
        <span className="text-[12px] tracking-[0.25em] uppercase text-[#E2E8F0] font-semibold group-hover:text-white transition-colors">
          Clearline
        </span>
      </Link>

      {/* Search */}
      <div className="flex-1 max-w-[460px] mx-auto relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search markets, wallets, topics..."
          className="w-full h-10 pl-10 pr-3 bg-white/[0.06] border border-white/[0.10] rounded-lg text-[13px] text-white placeholder-[#64748B] focus:border-[#00D4FF]/50 focus:bg-white/[0.08] focus:outline-none transition-colors"
        />
      </div>

      {/* Category pills — styled to match the map's colored bubbles */}
      <div className="flex items-center gap-2 shrink-0">
        {ALL_CATEGORIES.map((cat) => {
          const isActive = activeCategories.has(cat);
          const color = CATEGORY_COLORS[cat];
          return (
            <button
              key={cat}
              onClick={() => onToggleCategory(cat)}
              className="h-9 px-3.5 rounded-full text-[11px] font-semibold tracking-[0.12em] uppercase flex items-center gap-2 transition-all duration-200 cursor-pointer border"
              style={{
                color: isActive ? '#FFFFFF' : '#94A3B8',
                backgroundColor: isActive ? `${color}1F` : 'rgba(255,255,255,0.03)',
                borderColor: isActive ? `${color}80` : 'rgba(255,255,255,0.08)',
                boxShadow: isActive ? `0 0 14px ${color}40` : 'none',
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 10px ${color}, 0 0 4px ${color}`,
                  opacity: isActive ? 1 : 0.75,
                }}
              />
              {CATEGORY_LABELS[cat]}
            </button>
          );
        })}
      </div>

      {/* Back button */}
      <Link
        href="/terminal"
        className="h-10 w-10 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </div>
  );
}
