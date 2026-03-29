"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  CirclePlay,
  Crown,
  Database,
  LineChart,
  MessagesSquare,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
  Zap,
} from "lucide-react";

type HomeMarket = {
  id: string;
  title: string;
  currentOdds: number;
  change: number;
  volume24h: number;
  signal: "BUY" | "SELL" | "NEUTRAL";
  smartWalletCount: number;
};

function formatCompactCurrency(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function LivePreview() {
  const [markets, setMarkets] = useState<HomeMarket[]>([]);

  useEffect(() => {
    async function fetchPreview() {
      try {
        const res = await fetch("/api/markets?limit=6");
        if (!res.ok) throw new Error("preview failed");
        const json = await res.json();
        setMarkets(json.markets ?? []);
      } catch {
        setMarkets([]);
      }
    }

    fetchPreview();
  }, []);

  const stats = useMemo(() => {
    const signalCount = markets.filter((market) => market.signal !== "NEUTRAL").length;
    const totalVolume = markets.reduce((sum, market) => sum + market.volume24h, 0);
    const smartWallets = markets.reduce((sum, market) => sum + market.smartWalletCount, 0);
    return { signalCount, totalVolume, smartWallets };
  }, [markets]);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(13,17,23,0.96),rgba(8,11,18,0.98))] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,212,255,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_24%)]" />
      <div className="relative">
        <div className="flex items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.08)] pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">Live Terminal Preview</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">See what Clearline is tracking right now</h3>
          </div>
          <Link
            href="/terminal"
            className="inline-flex items-center gap-2 rounded-full border border-[#00d4ff]/30 bg-[#00d4ff]/10 px-4 py-2 text-sm font-medium text-[#00d4ff] transition hover:border-[#00d4ff]/60 hover:bg-[#00d4ff]/15"
          >
            Open Terminal
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            { label: "Active signals", value: stats.signalCount.toString(), accent: "text-[#10b981]" },
            { label: "Tracked volume", value: formatCompactCurrency(stats.totalVolume), accent: "text-white" },
            { label: "Smart wallets", value: stats.smartWallets.toString(), accent: "text-[#00d4ff]" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-white/[0.03] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748b]">{stat.label}</div>
              <div className={`mt-2 text-2xl font-semibold ${stat.accent}`}>{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {(markets.length > 0 ? markets : [
            {
              id: "preview-1",
              title: "Signal feed populates as Railway jobs compute new market cards",
              currentOdds: 0.62,
              change: 0.041,
              volume24h: 118000,
              signal: "BUY" as const,
              smartWalletCount: 6,
            },
            {
              id: "preview-2",
              title: "Wallet activity gets scored and ranked for decision speed",
              currentOdds: 0.44,
              change: -0.028,
              volume24h: 86000,
              signal: "SELL" as const,
              smartWalletCount: 4,
            },
            {
              id: "preview-3",
              title: "Market intelligence rolls into alerts, monitoring, and detail pages",
              currentOdds: 0.57,
              change: 0.013,
              volume24h: 143000,
              signal: "NEUTRAL" as const,
              smartWalletCount: 3,
            },
          ]).slice(0, 3).map((market) => {
            const isPositive = market.change >= 0;
            const signalTone =
              market.signal === "BUY"
                ? "text-[#10b981] bg-[#10b981]/10 border-[#10b981]/20"
                : market.signal === "SELL"
                  ? "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20"
                  : "text-[#94a3b8] bg-white/[0.04] border-white/10";

            return (
              <div
                key={market.id}
                className="grid gap-3 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#0d1117]/80 p-4 md:grid-cols-[1.7fr_0.65fr_0.65fr_0.65fr]"
              >
                <div>
                  <div className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${signalTone}`}>
                    {market.signal === "NEUTRAL" ? "Monitoring" : market.signal}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white">{market.title}</p>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748b]">Price</div>
                  <div className="mt-2 text-xl font-semibold text-white">{(market.currentOdds * 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748b]">24h move</div>
                  <div className={`mt-2 text-xl font-semibold ${isPositive ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                    {isPositive ? "+" : ""}
                    {(market.change * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748b]">Wallets</div>
                  <div className="mt-2 text-xl font-semibold text-[#00d4ff]">{market.smartWalletCount}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HeroCTA() {
  const { isSignedIn } = useUser();
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link
        href={isSignedIn ? "/terminal" : "/sign-up"}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#00d4ff] px-6 py-3 text-sm font-semibold text-[#080b12] transition hover:bg-[#22ddff]"
      >
        {isSignedIn ? "Open Terminal" : "Get Started Free"}
        <ArrowRight className="h-4 w-4" />
      </Link>
      <a
        href="#pricing"
        className="inline-flex items-center justify-center gap-2 rounded-full border border-[rgba(255,255,255,0.12)] bg-white/[0.03] px-6 py-3 text-sm font-medium text-white transition hover:border-[rgba(255,255,255,0.2)] hover:bg-white/[0.05]"
      >
        View Pricing
        <CirclePlay className="h-4 w-4 text-[#10b981]" />
      </a>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#080b12] text-white">
      <section className="relative overflow-hidden border-b border-[rgba(255,255,255,0.06)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,212,255,0.12),transparent_28%),radial-gradient(circle_at_70%_20%,rgba(16,185,129,0.08),transparent_20%),linear-gradient(180deg,#0a0e17_0%,#080b12_100%)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00d4ff]/50 to-transparent" />
        <div className="relative mx-auto flex max-w-[1400px] flex-col gap-12 px-4 py-20 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:py-24">
          <div className="max-w-2xl flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#94a3b8]">
              <Sparkles className="h-3.5 w-3.5 text-[#10b981]" />
              Railway deployed. Live intelligence pipeline online.
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">
              Prediction market intelligence,
              <span className="block text-[#00d4ff]">built for decision speed.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#94a3b8]">
              Clearline ingests live market activity, scores wallets, detects smart-money behavior, and turns raw Polymarket data into a terminal traders can act on.
            </p>

            <HeroCTA />

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Markets monitored", value: "24/7", detail: "Continuously refreshed market cards and alerts." },
                { label: "Pipeline layers", value: "4", detail: "Ingestion, enrichment, intelligence, and application delivery." },
                { label: "Core surfaces", value: "3", detail: "Terminal, smart alerts, and wallet tracking." },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748b]">{item.label}</div>
                  <div className="mt-2 text-3xl font-semibold text-white">{item.value}</div>
                  <p className="mt-2 text-sm leading-6 text-[#94a3b8]">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1">
            <LivePreview />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">How Data-Driven Trading Works</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-white">
            Clearline turns fragmented market noise into a repeatable workflow.
          </h2>
          <p className="mt-4 text-lg leading-8 text-[#94a3b8]">
            The goal is not more data. The goal is better decisions, faster, with context you can trust.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {[
            {
              icon: Radar,
              eyebrow: "Find Market Mistakes",
              title: "We analyze pricing, wallet behavior, and liquidity to spot contracts the market is misreading.",
              body: "When the broad market implies one fair price but concentrated, high-accuracy activity points somewhere else, Clearline surfaces the mismatch immediately.",
            },
            {
              icon: Bell,
              eyebrow: "Highlight Actionable Signals",
              title: "We package those signals into real-time tools instead of making you dig through raw tables.",
              body: "The terminal, alert feed, and market detail pages all stay aligned so you can move from discovery to conviction without context switching.",
            },
            {
              icon: Target,
              eyebrow: "You Take The Trade",
              title: "You still need to act while the edge exists.",
              body: "Clearline is built for speed because prices, wallet clustering, and market sentiment move fast. The faster the handoff, the better the edge survives.",
            },
          ].map((item, index) => (
            <div
              key={item.title}
              className={`rounded-[2rem] border border-[rgba(255,255,255,0.06)] p-8 ${
                index === 1 ? "bg-[linear-gradient(180deg,rgba(13,17,23,0.96),rgba(13,17,23,0.8))]" : "bg-[#0d1117]"
              }`}
            >
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
                <item.icon className="h-5 w-5 text-[#00d4ff]" />
              </div>
              <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.22em] text-[#10b981]">{item.eyebrow}</p>
              <h3 className="mt-4 text-2xl font-semibold leading-tight text-white">{item.title}</h3>
              <p className="mt-4 text-sm leading-7 text-[#94a3b8]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="products" className="border-y border-[rgba(255,255,255,0.06)] bg-[#0a0e17]/80">
        <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">What We Built</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-white">One product, three operational surfaces.</h2>
            <p className="mt-4 text-lg leading-8 text-[#94a3b8]">
              The experience follows the same logic as your pipeline: discover, verify, and act.
            </p>
          </div>

          <div className="mt-14 grid gap-6 xl:grid-cols-3">
            {[
              {
                icon: Activity,
                title: "Terminal",
                href: "/terminal",
                description: "A live market dashboard for scanning volume, price moves, and smart-money concentration in one place.",
                bullets: ["Search and rank live market cards", "Scan buy and sell concentration quickly", "Open detail pages without leaving the flow"],
              },
              {
                icon: Bell,
                title: "Smart Money Alerts",
                href: "/alerts",
                description: "A focused feed for high-signal moments when top wallets cluster around the same contract.",
                bullets: ["Separate BUY and SELL signals", "Track confidence and recent move strength", "Move straight into the matching market view"],
              },
              {
                icon: Wallet,
                title: "Wallet Tracker",
                href: "/wallets",
                description: "A research layer for understanding who is driving flow, how often they are right, and what they touched recently.",
                bullets: ["Rank high-accuracy wallets", "Inspect recent activity and resolved sample sizes", "Use wallet quality as context before acting"],
              },
            ].map((item) => (
              <div key={item.title} className="rounded-[2rem] border border-[rgba(255,255,255,0.06)] bg-[#0d1117] p-8">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00d4ff]/10 ring-1 ring-[#00d4ff]/20">
                  <item.icon className="h-5 w-5 text-[#00d4ff]" />
                </div>
                <h3 className="mt-6 text-2xl font-semibold text-white">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[#94a3b8]">{item.description}</p>
                <div className="mt-6 space-y-3">
                  {item.bullets.map((bullet) => (
                    <div key={bullet} className="flex items-start gap-3 text-sm text-white">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#10b981]" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
                <Link
                  href={item.href}
                  className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-[#00d4ff] transition hover:text-[#48e3ff]"
                >
                  Open {item.title}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pipeline" className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">Pipeline</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-white">Your new data stack should be part of the story.</h2>
            <p className="mt-4 text-lg leading-8 text-[#94a3b8]">
              Clearline is no longer just a frontend concept. It is a deployed product with a Railway-hosted pipeline that ingests, enriches, scores, and serves market intelligence continuously.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {["Polymarket ingestion", "Wallet profiling", "Signal generation", "BigQuery-backed views"].map((pill) => (
                <div
                  key={pill}
                  className="rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-4 py-2 text-sm text-[#cbd5e1]"
                >
                  {pill}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                icon: Database,
                title: "Ingestion",
                body: "Fetch market discovery, trades, and activity continuously so your front end is not waiting on raw APIs.",
              },
              {
                icon: Wallet,
                title: "Wallet Scoring",
                body: "Profile traders by accuracy, sample size, and recent behavior so the alert layer is grounded in quality, not noise.",
              },
              {
                icon: Zap,
                title: "Signal Generation",
                body: "Convert concentration, price movement, and wallet quality into BUY and SELL signals that can be ranked fast.",
              },
              {
                icon: LineChart,
                title: "Application Delivery",
                body: "Expose computed market cards through clean APIs that power the terminal, alerts feed, and wallet surfaces.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-[1.75rem] border border-[rgba(255,255,255,0.06)] bg-[#0d1117] p-6">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04]">
                  <item.icon className="h-5 w-5 text-[#00d4ff]" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#94a3b8]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="support" className="border-t border-[rgba(255,255,255,0.06)]">
        <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[2rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(13,17,23,0.96),rgba(13,17,23,0.82))] p-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">Why This Flow Works</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-white">It takes more than data to win. You need navigation that respects how traders actually work.</h2>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-[#94a3b8]">
                The redesigned UX gives Clearline a clearer sequence: learn what the product does, open the terminal, validate in alerts, then deepen conviction through wallet research.
              </p>
            </div>

            <div className="grid gap-4">
              {[
                { icon: Activity, title: "Fast market scanning", body: "The landing page points users into the terminal immediately instead of burying the core product." },
                { icon: MessagesSquare, title: "Clear product education", body: "Homepage copy explains what Clearline is, what the pipeline does, and how the surfaces connect." },
                { icon: Bell, title: "Better handoff into action", body: "Product routes now feel like one system instead of separate demos with different visual languages." },
              ].map((item) => (
                <div key={item.title} className="rounded-[1.75rem] border border-[rgba(255,255,255,0.06)] bg-[#0d1117] p-6">
                  <div className="flex items-center gap-3">
                    <item.icon className="h-5 w-5 text-[#00d4ff]" />
                    <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[#94a3b8]">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t border-[rgba(255,255,255,0.06)]">
        <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">Pricing</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-white">One plan. Full access.</h2>
            <p className="mt-4 text-lg leading-8 text-[#94a3b8]">
              Get the terminal, smart money alerts, and wallet intelligence — everything Clearline offers.
            </p>
          </div>

          <div className="mx-auto mt-14 max-w-lg">
            <div className="rounded-[2rem] border border-[rgba(255,255,255,0.08)] bg-[#0d1117] p-8">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-semibold text-white">Clearline Pro</h3>
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
                  "Live market terminal with 1000+ markets",
                  "Real-time smart money BUY/SELL alerts",
                  "Wallet intelligence and accuracy rankings",
                  "Market detail pages with order book data",
                ].map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <Check className="h-5 w-5 shrink-0 text-[#10b981]" />
                    <span className="text-sm text-white">{feature}</span>
                  </div>
                ))}
              </div>
              <Link
                href="/pricing"
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-[#00d4ff] px-6 py-3 text-sm font-semibold text-[#080b12] transition hover:bg-[#22ddff]"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-[#10b981]/20 bg-[#10b981]/5 p-5 text-center">
              <div className="flex items-center justify-center gap-2">
                <Crown className="h-5 w-5 text-[#10b981]" />
                <span className="text-sm font-semibold text-[#10b981]">Founding Members</span>
              </div>
              <p className="mt-2 text-sm text-[#94a3b8]">
                The first 100 users get <span className="font-semibold text-white">lifetime free access</span>. Sign up now to claim your spot.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-[2.25rem] border border-[rgba(255,255,255,0.08)] bg-[radial-gradient(circle_at_top,rgba(0,212,255,0.12),transparent_36%),#0d1117] px-8 py-12 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#10b981]">Launch Clearline</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-white">Start making better calls today.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-[#94a3b8]">
            Join the traders using smart-money intelligence to find edge in prediction markets. First 100 founding members get lifetime free access.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#00d4ff] px-6 py-3 text-sm font-semibold text-[#080b12] transition hover:bg-[#22ddff]"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[rgba(255,255,255,0.12)] bg-white/[0.03] px-6 py-3 text-sm font-medium text-white transition hover:border-[rgba(255,255,255,0.2)] hover:bg-white/[0.05]"
            >
              View Pricing
              <Bell className="h-4 w-4 text-[#10b981]" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
