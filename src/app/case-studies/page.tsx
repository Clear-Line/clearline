"use client";

import { ArrowUpRight } from "lucide-react";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";

// ─────────────────────────────────────────────────────────────────────────────
// Case studies registry. Add new entries here as more articles ship.
// ─────────────────────────────────────────────────────────────────────────────
const CASE_STUDIES: CaseStudyHero[] = [
  {
    slug: "iran-ceasefire-2026-04-07",
    eyebrow: "April 7, 2026  ·  Iran / US Ceasefire",
    title: "The Hidden Web Inside Polymarket That Nobody Is Talking About",
    description:
      "When the US–Iran ceasefire dropped, more than 120 Polymarket contracts moved in lockstep — across oil, regime change, crypto, and even Fed rate-path bets. The constellation map shows the network beneath every headline, and exposes the trades that look like diversification but aren't.",
    badges: ["120+ markets moved", "4-tier lag structure", "$200M+ in volume"],
    substackUrl:
      "https://open.substack.com/pub/rbh227/p/120-markets-one-ceasefire-mapping",
  },
];

type CaseStudyHero = {
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  badges: string[];
  substackUrl: string;
};

export default function CaseStudiesPage() {
  return (
    <div className="relative min-h-screen bg-[#04040B] text-white overflow-hidden">
      {/* Animated gradient background — same palette as the landing page hero */}
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

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
        {/* Page header */}
        <div className="text-center mb-14 lg:mb-20">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00d4ff]/80 mb-5">
            Case Studies
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] leading-[1.05]">
            Evidence from the network.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base sm:text-lg text-[#94a3b8] leading-relaxed">
            Real moments where the constellation map exposed how connected
            Polymarket really is — and what those connections were quietly
            saying before the headline arrived.
          </p>
        </div>

        {/* Case study cards */}
        <div className="space-y-10">
          {CASE_STUDIES.map((study) => (
            <CaseStudyHeroCard key={study.slug} study={study} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero card — Bubble-Maps-style layout: text on the left, viz on the right.
// ─────────────────────────────────────────────────────────────────────────────
function CaseStudyHeroCard({ study }: { study: CaseStudyHero }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#0a0f1a]/85 to-[#04040B]/85 backdrop-blur-xl shadow-[0_30px_120px_-30px_rgba(0,212,255,0.18)]">
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-0">
        {/* Left — copy */}
        <div className="p-8 sm:p-10 lg:p-12 flex flex-col justify-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#00d4ff] mb-5">
            {study.eyebrow}
          </p>

          <h2 className="text-3xl sm:text-4xl lg:text-[44px] font-bold tracking-[-0.025em] leading-[1.08] mb-6">
            {study.title}
          </h2>

          <p className="text-[#94a3b8] text-[15px] sm:text-base leading-7 mb-7">
            {study.description}
          </p>

          <div className="flex flex-wrap gap-2 mb-8">
            {study.badges.map((b) => (
              <span
                key={b}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-[#cbd5e1] tracking-wide"
              >
                {b}
              </span>
            ))}
          </div>

          <a
            href={study.substackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-md bg-[#00d4ff] px-7 py-3 text-sm font-bold uppercase tracking-wider text-[#04040B] transition hover:bg-[#22ddff]"
          >
            Read on Substack
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>

        {/* Right — animated mini constellation */}
        <div className="relative min-h-[340px] lg:min-h-full bg-[#04040B] overflow-hidden border-t lg:border-t-0 lg:border-l border-white/[0.06]">
          <ConstellationVisual />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG constellation — central "Iran ceasefire" node + orbital cluster.
// Pure CSS animations, no canvas, no data fetching.
// ─────────────────────────────────────────────────────────────────────────────
function ConstellationVisual() {
  // viewBox is 100x100 — coordinates are percentages of the visual area.
  const center = { id: "iran", x: 50, y: 50, r: 8 };

  const nodes: Array<{ id: string; x: number; y: number; r: number; delay: number }> = [
    { id: "oil",     x: 22, y: 28, r: 5,   delay: 0.0 },
    { id: "hormuz",  x: 18, y: 60, r: 4.2, delay: 0.4 },
    { id: "btc",     x: 78, y: 22, r: 5.5, delay: 0.2 },
    { id: "eth",     x: 84, y: 58, r: 4,   delay: 0.6 },
    { id: "fed",     x: 62, y: 86, r: 4.2, delay: 0.8 },
    { id: "vance",   x: 30, y: 84, r: 3.6, delay: 0.3 },
    { id: "regime",  x: 72, y: 80, r: 3.6, delay: 0.7 },
    { id: "nuke",    x: 38, y: 14, r: 4,   delay: 0.5 },
    { id: "russia",  x: 62, y: 14, r: 3.6, delay: 0.9 },
    { id: "wti",     x: 12, y: 42, r: 3.4, delay: 0.1 },
    { id: "isr",     x: 88, y: 40, r: 3.4, delay: 1.0 },
    { id: "kharg",   x: 50, y: 92, r: 3.2, delay: 0.45 },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Soft cyan glow behind the cluster */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,rgba(0,212,255,0.18),transparent_70%)] pointer-events-none" />

      <svg
        viewBox="0 0 100 100"
        className="relative w-[88%] h-[88%]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="cs-node-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22e7ff" stopOpacity="1" />
            <stop offset="60%" stopColor="#00d4ff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cs-center-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7df0ff" stopOpacity="1" />
            <stop offset="60%" stopColor="#00d4ff" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Edges */}
        <g stroke="#00d4ff" strokeWidth="0.35" strokeLinecap="round">
          {nodes.map((n) => (
            <line
              key={`edge-${n.id}`}
              x1={center.x}
              y1={center.y}
              x2={n.x}
              y2={n.y}
              opacity={0.35}
              className="cs-edge"
              style={{ animationDelay: `${n.delay}s` }}
            />
          ))}
          {/* A few cross-edges for that "web" feel */}
          <line x1={22} y1={28} x2={78} y2={22} opacity={0.18} />
          <line x1={18} y1={60} x2={62} y2={86} opacity={0.18} />
          <line x1={84} y1={58} x2={72} y2={80} opacity={0.18} />
          <line x1={38} y1={14} x2={62} y2={14} opacity={0.18} />
          <line x1={12} y1={42} x2={22} y2={28} opacity={0.18} />
          <line x1={88} y1={40} x2={78} y2={22} opacity={0.18} />
        </g>

        {/* Outer orbital nodes */}
        <g>
          {nodes.map((n) => (
            <g key={`node-${n.id}`}>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r * 2.4}
                fill="url(#cs-node-glow)"
                opacity={0.55}
                className="cs-node-glow"
                style={{ animationDelay: `${n.delay}s`, transformOrigin: `${n.x}px ${n.y}px` }}
              />
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill="#0a0f1a"
                stroke="#00d4ff"
                strokeWidth="0.5"
              />
            </g>
          ))}
        </g>

        {/* Central node — Iran ceasefire */}
        <g>
          <circle
            cx={center.x}
            cy={center.y}
            r={center.r * 3}
            fill="url(#cs-center-glow)"
            opacity={0.65}
            className="cs-center-glow"
            style={{ transformOrigin: `${center.x}px ${center.y}px` }}
          />
          <circle
            cx={center.x}
            cy={center.y}
            r={center.r}
            fill="#0a0f1a"
            stroke="#22e7ff"
            strokeWidth="0.8"
          />
          <circle
            cx={center.x}
            cy={center.y}
            r={center.r * 0.4}
            fill="#22e7ff"
          />
        </g>
      </svg>

      <style jsx>{`
        :global(.cs-edge) {
          stroke-dasharray: 1 1.4;
          animation: cs-edge-pulse 3.6s ease-in-out infinite;
        }
        :global(.cs-node-glow) {
          animation: cs-node-pulse 3.2s ease-in-out infinite;
        }
        :global(.cs-center-glow) {
          animation: cs-center-pulse 4s ease-in-out infinite;
        }
        @keyframes cs-edge-pulse {
          0%, 100% { opacity: 0.18; }
          50%      { opacity: 0.55; }
        }
        @keyframes cs-node-pulse {
          0%, 100% { transform: scale(0.9); opacity: 0.4; }
          50%      { transform: scale(1.1); opacity: 0.75; }
        }
        @keyframes cs-center-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.55; }
          50%      { transform: scale(1.08); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
