'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Activity } from 'lucide-react';

export function AppFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/sign-in')) return null;

  const isMarketingPage = pathname === '/';

  return (
    <footer className="bg-[#0a0e17] border-t border-[rgba(255,255,255,0.06)] mt-0">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
                <Activity className="h-3 w-3 text-white" />
              </div>
              <span className="font-bold text-white text-sm tracking-tight">CLEARLINE</span>
              <span className="text-[#64748b] text-xs tracking-widest uppercase">
                {isMarketingPage ? 'Intelligence' : 'Terminal'}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#64748b]">
              Prediction market intelligence for traders who want live context, cleaner signals, and a faster path from discovery to action.
            </p>
          </div>

          <div className="flex flex-wrap gap-5 text-xs uppercase tracking-[0.16em] text-[#64748b]">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/terminal" className="hover:text-white transition-colors">Terminal</Link>
            <Link href="/alerts" className="hover:text-white transition-colors">Alerts</Link>
            <Link href="/wallets" className="hover:text-white transition-colors">Wallets</Link>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-4 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-[#475569] tracking-wide uppercase">
            Prediction Market Intelligence
          </div>
          <div className="text-xs text-[#475569] tracking-wide uppercase">
            Deployed pipeline. Live product surfaces.
          </div>
        </div>
      </div>
    </footer>
  );
}
