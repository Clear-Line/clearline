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
    <div className="fixed top-0 inset-x-0 z-10 h-12 flex items-center px-5 gap-4 bg-[#04040B]/60 backdrop-blur-2xl border-b border-white/[0.04]">
      {/* Logo */}
      <Link href="/terminal" className="flex items-center gap-2 shrink-0">
        <Activity className="h-4 w-4 text-[#00D4FF]" />
        <span className="text-[10px] tracking-[0.25em] uppercase text-[#475569] font-medium">
          Clearline
        </span>
      </Link>

      {/* Search */}
      <div className="flex-1 max-w-[400px] mx-auto relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#374151]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search markets, wallets, topics..."
          className="w-full h-8 pl-9 pr-3 bg-white/[0.04] border border-white/[0.06] rounded-lg text-[13px] text-[#E2E8F0] placeholder-[#374151] focus:border-[#00D4FF]/30 focus:bg-white/[0.06] focus:outline-none transition-colors"
        />
      </div>

      {/* Category pills */}
      <div className="flex items-center gap-1.5 shrink-0">
        {ALL_CATEGORIES.map((cat) => {
          const isActive = activeCategories.has(cat);
          return (
            <button
              key={cat}
              onClick={() => onToggleCategory(cat)}
              className={`h-7 px-2.5 rounded-full text-[9px] font-medium tracking-[0.12em] uppercase flex items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-white/[0.06] text-[#94A3B8]'
                  : 'text-[#374151] hover:text-[#475569]'
              }`}
            >
              <span
                className="w-[5px] h-[5px] rounded-full shrink-0"
                style={{
                  backgroundColor: isActive ? CATEGORY_COLORS[cat] : '#374151',
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
        className="h-8 w-8 flex items-center justify-center rounded-lg text-[#374151] hover:text-[#94A3B8] hover:bg-white/[0.04] transition-colors shrink-0"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </div>
  );
}
