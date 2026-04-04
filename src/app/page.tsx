"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#04040B] text-white">
      {/* ─── Hero ─── */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
        {/* Animated gradient background */}
        <BackgroundGradientAnimation
          gradientBackgroundStart="rgb(4, 4, 11)"
          gradientBackgroundEnd="rgb(4, 10, 30)"
          firstColor="0, 150, 200"
          secondColor="0, 212, 255"
          thirdColor="30, 100, 180"
          fourthColor="0, 80, 160"
          fifthColor="60, 160, 220"
          pointerColor="0, 180, 255"
          size="100%"
          blendingValue="hard-light"
          interactive={true}
          containerClassName="!absolute !inset-0 !h-full !w-full"
          className="hidden"
        />

        <div className="relative z-10 mx-auto max-w-4xl px-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00d4ff]/70 mb-8">
            Prediction Market Intelligence
          </p>
          <h1 className="text-5xl font-bold tracking-[-0.04em] leading-[1.1] sm:text-7xl">
            The Smart Money
            <br />
            Intelligence Layer
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#94a3b8]">
            Visual analytics platform to track wallet behavior, detect smart-money signals, and map market relationships in real time across Polymarket.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-md bg-[#00d4ff] px-7 py-3 text-sm font-bold uppercase tracking-wider text-[#04040B] transition hover:bg-[#22ddff]"
            >
              Launch Map
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/terminal"
              className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-7 py-3 text-sm font-medium uppercase tracking-wider text-white transition hover:bg-white/10"
            >
              Open Terminal
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Powered By ─── */}
      <section className="border-y border-white/[0.06] bg-[#04040B]">
        <div className="mx-auto max-w-[1200px] px-4 py-12">
          <p className="text-center text-[11px] font-medium uppercase tracking-[0.25em] text-[#475569] mb-8">
            Built on
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {["Polymarket", "BigQuery", "Railway", "Vercel", "Clerk"].map((name) => (
              <span
                key={name}
                className="text-sm font-semibold tracking-wide text-[#64748b]/60"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Core Products ─── */}
      <section className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
        <div className="text-center mb-16">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00d4ff]/70 mb-4">
            What We Built
          </p>
          <h2 className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
            Four surfaces. One intelligence pipeline.
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Constellation Map - Featured */}
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0a0f1a] to-[#04040B] p-8 lg:row-span-2">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[radial-gradient(circle,rgba(0,212,255,0.08),transparent_70%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#00d4ff]/20 bg-[#00d4ff]/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#00d4ff]">
                Featured
              </div>
              <h3 className="mt-6 text-3xl font-bold tracking-tight">
                Constellation Map
              </h3>
              <p className="mt-4 text-[#94a3b8] leading-7 max-w-md">
                A force-directed visualization of 300+ live markets, clustered by category and connected by wallet overlap and price correlation. See how markets relate to each other at a glance.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Real-time market nodes sized by volume",
                  "Wallet overlap and correlation edges",
                  "Category clustering with interactive filters",
                  "Click any node for deep market details",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#cbd5e1]">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#00d4ff] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/explore"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#00d4ff] hover:text-[#48e3ff] transition"
              >
                Explore the Map
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Terminal */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0a0f1a] p-8">
            <h3 className="text-xl font-bold">Smart Money Terminal</h3>
            <p className="mt-3 text-sm text-[#94a3b8] leading-7">
              Live dashboard scanning volume, price momentum, and wallet concentration across every active Polymarket contract. Filter, sort, and act.
            </p>
            <Link
              href="/terminal"
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#00d4ff] hover:text-[#48e3ff] transition"
            >
              Open Terminal
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Alerts */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0a0f1a] p-8">
            <h3 className="text-xl font-bold">Real-Time Alerts</h3>
            <p className="mt-3 text-sm text-[#94a3b8] leading-7">
              Focused signal feed that fires when high-accuracy wallets cluster on the same contract. Separate BUY and SELL streams with confidence scoring.
            </p>
            <Link
              href="/alerts"
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#00d4ff] hover:text-[#48e3ff] transition"
            >
              View Alerts
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Wallets */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0a0f1a] p-8 lg:col-span-2">
            <div className="lg:flex lg:items-start lg:justify-between lg:gap-8">
              <div className="lg:max-w-lg">
                <h3 className="text-xl font-bold">Wallet Intelligence</h3>
                <p className="mt-3 text-sm text-[#94a3b8] leading-7">
                  Research layer for understanding who drives flow. Rank wallets by accuracy, inspect recent trades, and use wallet quality as conviction context before you act.
                </p>
                <Link
                  href="/wallets"
                  className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#00d4ff] hover:text-[#48e3ff] transition"
                >
                  Browse Wallets
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-6 lg:mt-0 grid grid-cols-3 gap-4 text-center">
                {[
                  { label: "Wallets Tracked", value: "31K+" },
                  { label: "Accuracy Scored", value: "Real-time" },
                  { label: "Trade History", value: "3-day" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
                    <div className="text-lg font-bold text-white">{stat.value}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-[#64748b]">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="border-y border-white/[0.06] bg-[#060810]">
        <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00d4ff]/70 mb-4">
              How It Works
            </p>
            <h2 className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
              From raw data to actionable edge.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-[#94a3b8]">
              Clearline runs a continuous pipeline that ingests, enriches, and scores Polymarket activity every five minutes.
            </p>
          </div>

          <div className="grid gap-px bg-white/[0.06] rounded-2xl overflow-hidden lg:grid-cols-4">
            {[
              {
                step: "01",
                title: "Ingest",
                body: "Market discovery, order books, and trade flow stream in from Polymarket APIs every 5 minutes.",
              },
              {
                step: "02",
                title: "Enrich",
                body: "Wallets are profiled by accuracy, PnL, and behavioral patterns. Every trader gets a quality score.",
              },
              {
                step: "03",
                title: "Score",
                body: "Smart-money concentration, price momentum, and wallet clustering produce BUY/SELL signals per market.",
              },
              {
                step: "04",
                title: "Serve",
                body: "Computed market cards power the terminal, alerts, wallet views, and the constellation map in real time.",
              },
            ].map((item) => (
              <div key={item.step} className="bg-[#060810] p-8">
                <div className="text-3xl font-bold text-white/10">{item.step}</div>
                <h3 className="mt-4 text-xl font-bold">{item.title}</h3>
                <p className="mt-3 text-sm text-[#94a3b8] leading-7">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Intelligence Features ─── */}
      <section className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
        <div className="text-center mb-16">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00d4ff]/70 mb-4">
            Intelligence
          </p>
          <h2 className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
            See what others miss.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Smart Money Detection",
              body: "Identify wallets with consistently high prediction accuracy and track their real-time positioning across markets.",
            },
            {
              title: "Market Relationships",
              body: "Discover hidden connections between markets through wallet overlap analysis and price correlation mapping.",
            },
            {
              title: "Volume Intelligence",
              body: "Separate noise from signal by tracking where high-accuracy wallets concentrate their capital versus retail flow.",
            },
            {
              title: "Signal Confidence",
              body: "Every BUY and SELL signal comes with a confidence score derived from wallet quality, concentration, and momentum.",
            },
            {
              title: "Wallet Profiling",
              body: "31,000+ wallets scored by accuracy, sample size, and recent behavior. Know who is behind the flow before you follow it.",
            },
            {
              title: "Real-Time Pipeline",
              body: "No stale data. The Railway-hosted pipeline refreshes market cards, wallet scores, and signals every five minutes.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/[0.08] bg-[#0a0f1a] p-7"
            >
              <h3 className="text-lg font-bold">{item.title}</h3>
              <p className="mt-3 text-sm text-[#94a3b8] leading-7">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="border-t border-white/[0.06] bg-[#060810]">
        <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
          <div className="text-center mb-14">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00d4ff]/70 mb-4">
              Pricing
            </p>
            <h2 className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
              One plan. Full access.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-[#94a3b8]">
              Everything Clearline offers. Terminal, alerts, wallet intelligence, and the constellation map.
            </p>
          </div>

          <div className="mx-auto max-w-md">
            <div className="rounded-2xl border border-white/[0.08] bg-[#0a0f1a] p-8">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold">Clearline Pro</h3>
                <span className="rounded-full border border-[#00d4ff]/20 bg-[#00d4ff]/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#00d4ff]">
                  Full Access
                </span>
              </div>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-5xl font-bold">$49</span>
                <span className="text-lg text-[#64748b]">/month</span>
              </div>
              <div className="mt-8 space-y-4">
                {[
                  "Live terminal with 1000+ markets",
                  "Real-time smart money alerts",
                  "Wallet intelligence rankings",
                  "Constellation map access",
                  "Market detail with order book data",
                ].map((feature) => (
                  <div key={feature} className="flex items-center gap-3 text-sm text-[#cbd5e1]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#00d4ff] shrink-0" />
                    {feature}
                  </div>
                ))}
              </div>
              <Link
                href="/pricing"
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-[#00d4ff] px-6 py-3 text-sm font-bold uppercase tracking-wider text-[#04040B] transition hover:bg-[#22ddff]"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-center">
              <p className="text-sm text-[#94a3b8]">
                The first 100 users get <span className="font-semibold text-white">lifetime free access</span>. Sign up now to claim your spot.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA ─── */}
      <section className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0f1a] px-8 py-16 text-center">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(0,212,255,0.10),transparent_60%)]" />
            <div className="relative">
              <h2 className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
                Start making better calls.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-[#94a3b8]">
                Join the traders using smart-money intelligence to find edge in prediction markets.
              </p>
              <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <Link
                  href="/explore"
                  className="inline-flex items-center gap-2 rounded-md bg-[#00d4ff] px-7 py-3 text-sm font-bold uppercase tracking-wider text-[#04040B] transition hover:bg-[#22ddff]"
                >
                  Launch Map
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-7 py-3 text-sm font-medium uppercase tracking-wider text-white transition hover:bg-white/10"
                >
                  View Pricing
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
