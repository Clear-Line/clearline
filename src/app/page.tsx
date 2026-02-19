import MarketGrid from "@/src/components/MarketGrid";
import { MARKETS } from "@/src/lib/markets";

export default function Home() {
  const highConfidenceCount = MARKETS.filter((m) => m.signal === "high").length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

      {/* ── Hero ── */}
      <section className="hero-gradient relative overflow-hidden rounded-2xl px-8 py-14 lg:px-16 lg:py-20 mb-14 text-white">
        {/* Decorative background circles */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-20 right-40 h-64 w-64 rounded-full bg-white/5" />

        <div className="relative max-w-2xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-blue-300">
            Prediction Market Intelligence
          </p>
          <h1 className="mb-5 text-4xl font-bold leading-tight lg:text-5xl">
            The intelligence layer for prediction markets
          </h1>
          <p className="mb-12 text-lg leading-relaxed text-blue-100">
            Decoding whether odds movements reflect real signal or just noise — across
            politics, crypto, economics, weather, and more. Every market move gets a
            confidence rating backed by on-chain behavioral analysis.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="hero-stat-chip rounded-xl px-6 py-4">
              <span className="block text-3xl font-bold">{MARKETS.length}</span>
              <span className="mt-0.5 block text-sm text-blue-200">Active Markets</span>
            </div>
            <div className="hero-stat-chip rounded-xl px-6 py-4">
              <span className="block text-3xl font-bold">{highConfidenceCount}</span>
              <span className="mt-0.5 block text-sm text-blue-200">High Confidence Today</span>
            </div>
            <div className="hero-stat-chip rounded-xl px-6 py-4">
              <span className="block text-3xl font-bold">92%</span>
              <span className="mt-0.5 block text-sm text-blue-200">Signal Accuracy</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Markets ── */}
      <MarketGrid markets={MARKETS} />

    </div>
  );
}
