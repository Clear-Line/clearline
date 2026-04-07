'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, Trash2, Plus, Loader2 } from 'lucide-react';

interface LinkedWallet {
  id: number;
  address: string;
  label: string | null;
  createdAt: string;
}

interface LinkWalletModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful link / unlink so the parent can refetch positions. */
  onChange?: () => void;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Paste-address modal for linking Polymarket wallets to the signed-in Clearline account.
 * Supports listing, adding, and removing wallets.
 */
export function LinkWalletModal({ open, onClose, onChange }: LinkWalletModalProps) {
  const [wallets, setWallets] = useState<LinkedWallet[]>([]);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/user/wallets', { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setWallets([]);
          setError('Sign in with an active subscription to link wallets.');
          return;
        }
        throw new Error(`Request failed (${res.status})`);
      }
      const data: { wallets: LinkedWallet[] } = await res.json();
      setWallets(data.wallets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchWallets();
  }, [open, fetchWallets]);

  // Escape closes the modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (!ADDRESS_REGEX.test(trimmed)) {
      setError('Enter a valid 0x-prefixed 40-character hex address.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/user/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: trimmed, label: label.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data: { wallets: LinkedWallet[] } = await res.json();
      setWallets(data.wallets ?? []);
      setAddress('');
      setLabel('');
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link wallet');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (addr: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/user/wallets/${addr}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setWallets((prev) => prev.filter((w) => w.address !== addr));
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink wallet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <div className="min-h-full flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative w-full max-w-md max-h-[calc(100vh-2rem)] flex flex-col bg-[#04040B]/95 border border-white/[0.08] rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-white/[0.04] flex items-start justify-between flex-shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-[#10B981]" />
                  <h2 className="text-[14px] font-medium text-white tracking-tight">
                    Linked Wallets
                  </h2>
                </div>
                <p className="text-[11px] text-[#64748b] mt-1">
                  Paste any Polygon address to overlay its Polymarket positions on the map.
                </p>
              </div>
              <button
                onClick={onClose}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-[#475569] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Add wallet form */}
            <form onSubmit={handleAdd} className="px-6 py-4 border-b border-white/[0.04] flex-shrink-0">
              <label className="block text-[9px] tracking-[0.18em] uppercase text-[#374151] mb-1.5">
                Polygon Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                spellCheck={false}
                autoComplete="off"
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] font-mono text-white placeholder:text-[#374151] focus:outline-none focus:border-[#10B981]/50"
              />

              <label className="block text-[9px] tracking-[0.18em] uppercase text-[#374151] mt-3 mb-1.5">
                Label <span className="normal-case text-[#475569]">(optional)</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Main wallet"
                maxLength={64}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-[#374151] focus:outline-none focus:border-[#10B981]/50"
              />

              {error && (
                <p className="text-[11px] text-[#EF4444] mt-2.5">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !address.trim()}
                className="mt-3 w-full flex items-center justify-center gap-1.5 bg-[#10B981] hover:bg-[#10B981]/90 disabled:bg-[#10B981]/30 disabled:cursor-not-allowed text-black text-[12px] font-medium py-2 rounded-lg transition-colors"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Link Wallet
              </button>
            </form>

            {/* Existing wallets */}
            <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto">
              <div className="text-[9px] tracking-[0.18em] uppercase text-[#374151] mb-2">
                {wallets.length} linked
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 text-[#475569] animate-spin" />
                </div>
              ) : wallets.length === 0 ? (
                <p className="text-[11px] text-[#475569] py-3 text-center">
                  No wallets linked yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {wallets.map((w) => (
                    <li
                      key={w.id}
                      className="flex items-center justify-between gap-3 bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        {w.label && (
                          <div className="text-[11px] text-white truncate">{w.label}</div>
                        )}
                        <div className="text-[10px] font-mono text-[#64748b] truncate">
                          {truncate(w.address)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(w.address)}
                        disabled={submitting}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-[#475569] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors disabled:opacity-40"
                        aria-label="Unlink wallet"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
