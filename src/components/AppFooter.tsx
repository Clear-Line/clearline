'use client';

import { usePathname } from 'next/navigation';
import { Activity } from 'lucide-react';

export function AppFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/sign-in')) return null;

  return (
    <footer className="bg-[#0a0e17] border-t border-[rgba(255,255,255,0.06)] mt-0">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
              <Activity className="h-3 w-3 text-white" />
            </div>
            <span className="font-bold text-white text-sm tracking-tight">CLEARLINE</span>
            <span className="text-[#64748b] text-xs tracking-widest uppercase">Terminal</span>
          </div>
          <div className="text-xs text-[#475569] tracking-wide uppercase">
            Prediction Market Intelligence
          </div>
        </div>
      </div>
    </footer>
  );
}
