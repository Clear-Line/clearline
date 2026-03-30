"use client";

import Link from "next/link";
import { SignUpButton, useUser } from "@clerk/nextjs";
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  Crown,
  Wallet,
  Zap,
} from "lucide-react";

export default function PricingPage() {
  const { isSignedIn } = useUser();
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        alert(data.error);
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080b12] text-white">
      <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">
            Pricing
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.04em] text-white">
            One plan. Full access.
          </h1>
          <p className="mt-4 text-lg leading-8 text-[#94a3b8]">
            Get the terminal, smart money alerts, and wallet intelligence — everything Clearline offers.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-lg">
          <div className="rounded-[2rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(13,17,23,0.96),rgba(8,11,18,0.98))] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
            <div className="absolute inset-0 rounded-[2rem] bg-[radial-gradient(circle_at_top_left,rgba(0,212,255,0.12),transparent_32%)]" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-white">Clearline Pro</h2>
                <div className="rounded-full border border-[#10b981]/30 bg-[#10b981]/10 px-3 py-1 text-xs font-medium text-[#10b981]">
                  Full Access
                </div>
              </div>

              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-5xl font-bold text-white">$49</span>
                <span className="text-lg text-[#94a3b8]">/month</span>
              </div>

              <div className="mt-8 space-y-4">
                {[
                  { icon: Activity, text: "Live market terminal with 1000+ markets" },
                  { icon: Bell, text: "Real-time smart money alerts" },
                  { icon: Wallet, text: "Wallet intelligence and rankings" },
                  { icon: Zap, text: "BUY/SELL signals from high-accuracy wallets" },
                ].map((feature) => (
                  <div key={feature.text} className="flex items-center gap-3">
                    <Check className="h-5 w-5 shrink-0 text-[#10b981]" />
                    <span className="text-sm text-white">{feature.text}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                {isSignedIn ? (
                  <button
                    onClick={handleCheckout}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-[#00d4ff] px-6 py-3 text-sm font-semibold text-[#080b12] transition hover:bg-[#22ddff] disabled:opacity-50"
                  >
                    {loading ? "Loading..." : "Subscribe Now"}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <SignUpButton mode="redirect">
                    <button className="flex w-full items-center justify-center gap-2 rounded-full bg-[#00d4ff] px-6 py-3 text-sm font-semibold text-[#080b12] transition hover:bg-[#22ddff]">
                      Get Started
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </SignUpButton>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-[1.5rem] border border-[#10b981]/20 bg-[#10b981]/5 p-6 text-center">
            <div className="flex items-center justify-center gap-2">
              <Crown className="h-5 w-5 text-[#10b981]" />
              <span className="text-sm font-semibold text-[#10b981]">Founding Members</span>
            </div>
            <p className="mt-2 text-sm text-[#94a3b8]">
              The first 100 users get <span className="font-semibold text-white">lifetime free access</span> to Clearline Pro. Sign up now to claim your spot.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
