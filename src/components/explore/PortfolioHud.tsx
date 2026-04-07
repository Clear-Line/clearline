'use client';

import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import type { PortfolioTotals } from './mapTypes';

interface PortfolioHudProps {
  totals: PortfolioTotals;
  walletCount: number;
  watchingCount: number;
  onClick?: () => void;
}

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(abs < 10 ? 2 : 0)}`;
}

function formatSignedMoney(n: number): string {
  if (n === 0) return '$0';
  const sign = n > 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(n)).replace(/^-/, '')}`;
}

/**
 * Floating bottom-left panel that shows the signed-in user's portfolio totals
 * on top of the constellation map. Only rendered when the user has at least
 * one linked wallet.
 */
export function PortfolioHud({ totals, walletCount, watchingCount, onClick }: PortfolioHudProps) {
  const isUp = totals.unrealizedPnl >= 0;
  const pnlColor = isUp ? '#10B981' : '#EF4444';

  return (
    <button
      onClick={onClick}
      className="fixed bottom-12 left-4 z-20 bg-[#04040B]/90 backdrop-blur-2xl border border-white/[0.08] rounded-xl px-4 py-3 text-left hover:border-white/[0.14] transition-colors shadow-lg"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Wallet className="h-3 w-3 text-[#10B981]" />
        <span className="text-[9px] tracking-[0.16em] uppercase text-[#10B981] font-medium">
          Your Portfolio
        </span>
      </div>

      <div className="flex items-baseline gap-4">
        <div>
          <div className="text-[8px] tracking-[0.18em] uppercase text-[#374151] mb-0.5">
            Exposure
          </div>
          <div className="text-[16px] font-semibold text-white font-mono tracking-tight">
            {formatMoney(totals.exposure)}
          </div>
        </div>

        <div>
          <div className="text-[8px] tracking-[0.18em] uppercase text-[#374151] mb-0.5">
            Unrealized
          </div>
          <div
            className="text-[16px] font-semibold font-mono tracking-tight flex items-center gap-0.5"
            style={{ color: pnlColor }}
          >
            {isUp ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {formatSignedMoney(totals.unrealizedPnl)}
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-2 pt-2 border-t border-white/[0.04]">
        <span className="text-[9px] font-mono text-[#475569]">
          <span className="text-[#94A3B8]">{totals.held}</span> held
        </span>
        <span className="text-[9px] font-mono text-[#475569]">
          <span className="text-[#94A3B8]">{watchingCount}</span> watching
        </span>
        <span className="text-[9px] font-mono text-[#475569]">
          <span className="text-[#94A3B8]">{walletCount}</span> wallet{walletCount === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  );
}
