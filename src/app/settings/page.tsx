'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton } from '@clerk/nextjs';
import { Loader2, MessageCircle, ExternalLink, Check, X, Trash2 } from 'lucide-react';

interface DiscordSettings {
  discordUserId: string;
  discordUsername: string | null;
  notificationsEnabled: boolean;
  minPriceMove: number;
  windowHours: number;
  linkedAt: string;
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const discordFlash = searchParams.get('discord');

  const [settings, setSettings] = useState<DiscordSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/user/notifications', { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setSettings(null);
          return;
        }
        throw new Error(`Request failed (${res.status})`);
      }
      const data: { settings: DiscordSettings | null } = await res.json();
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleToggleNotifications = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const res = await fetch('/api/user/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: !settings.notificationsEnabled }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data: { settings: DiscordSettings } = await res.json();
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/user/notifications', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setSettings(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  };

  const discordInviteUrl =
    process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || 'https://discord.gg/clearline';

  return (
    <div className="min-h-screen bg-[#04040B] pt-14">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Settings</h1>
        <p className="text-[13px] text-[#64748b] mb-8">
          Manage your Clearline account and notification preferences.
        </p>

        <SignedOut>
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-5 py-4">
            <p className="text-[13px] text-[#94A3B8] mb-3">
              Sign in to manage your settings.
            </p>
            <SignInButton mode="redirect">
              <button className="px-4 py-2 text-[12px] font-medium text-[#04040B] bg-[#00d4ff] rounded-md">
                Sign In
              </button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          {/* ─── Discord notifications ─── */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-[#5865F2]" />
                <h2 className="text-[14px] font-semibold text-white tracking-tight">
                  Discord Notifications
                </h2>
              </div>
              <p className="text-[12px] text-[#64748b] mt-1">
                Get pinged in the Clearline Discord when a market on your watchlist makes a
                big move. Alerts include the top connected markets from the constellation.
              </p>
            </div>

            {discordFlash === 'linked' && (
              <FlashBanner
                tone="success"
                message="Discord linked. You'll now be @mentioned on watchlist alerts."
              />
            )}
            {discordFlash && discordFlash !== 'linked' && (
              <FlashBanner tone="error" message={`Discord link failed: ${discordFlash}`} />
            )}

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-4 w-4 text-[#475569] animate-spin" />
              </div>
            ) : !settings ? (
              <div className="px-5 py-5">
                <ol className="space-y-3 mb-4">
                  <li className="flex items-start gap-3">
                    <span className="h-5 w-5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] text-[#94A3B8] flex items-center justify-center flex-shrink-0 mt-0.5">
                      1
                    </span>
                    <div className="flex-1">
                      <p className="text-[12px] text-[#94A3B8]">
                        Join the Clearline Discord server.
                      </p>
                      <a
                        href={discordInviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1.5 px-3 py-1.5 text-[11px] text-white bg-[#5865F2] hover:bg-[#4752C4] rounded-md transition-colors"
                      >
                        Join Discord
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="h-5 w-5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] text-[#94A3B8] flex items-center justify-center flex-shrink-0 mt-0.5">
                      2
                    </span>
                    <div className="flex-1">
                      <p className="text-[12px] text-[#94A3B8]">
                        Connect your Discord identity so alerts can @mention you.
                      </p>
                      <a
                        href="/api/auth/discord/start"
                        className="inline-flex items-center gap-1 mt-1.5 px-3 py-1.5 text-[11px] text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-md transition-colors"
                      >
                        Connect Discord
                      </a>
                    </div>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="px-5 py-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-[#64748b] mb-0.5">Linked as</div>
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-[#10B981]" />
                      <span className="text-[13px] text-white font-mono">
                        @{settings.discordUsername ?? settings.discordUserId}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] text-[#94A3B8] hover:text-[#EF4444] border border-white/[0.08] rounded-md transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                    Disconnect
                  </button>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/[0.04]">
                  <div>
                    <div className="text-[12px] text-white">Notifications</div>
                    <div className="text-[11px] text-[#64748b]">
                      {settings.notificationsEnabled ? 'Enabled' : 'Paused'}
                    </div>
                  </div>
                  <button
                    onClick={handleToggleNotifications}
                    disabled={busy}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors disabled:opacity-40 ${
                      settings.notificationsEnabled
                        ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30'
                        : 'bg-white/[0.04] text-[#94A3B8] border border-white/[0.08]'
                    }`}
                  >
                    {settings.notificationsEnabled ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    {settings.notificationsEnabled ? 'Enabled' : 'Paused'}
                  </button>
                </div>

                <div className="pt-3 border-t border-white/[0.04]">
                  <div className="text-[11px] text-[#64748b]">
                    Trigger: {Math.round(settings.minPriceMove * 100)}-point move over{' '}
                    {settings.windowHours} hours
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="px-5 py-3 border-t border-[#EF4444]/20 bg-[#EF4444]/5">
                <p className="text-[11px] text-[#EF4444]">{error}</p>
              </div>
            )}
          </section>
        </SignedIn>
      </div>
    </div>
  );
}

function FlashBanner({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const color = tone === 'success' ? '#10B981' : '#EF4444';
  return (
    <div
      className="px-5 py-2.5 text-[11px] border-b"
      style={{ color, borderColor: `${color}33`, backgroundColor: `${color}0D` }}
    >
      {message}
    </div>
  );
}
