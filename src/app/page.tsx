"use client";

export default function Home() {
  const stats = [
    { value: "13", label: "Active Markets" },
    { value: "4",  label: "High Confidence Today" },
    { value: "92%", label: "Signal Accuracy" },
  ];

  return (
    <main className="max-w-screen-xl mx-auto px-6 pt-6 pb-8">
      {/* ── Hero Banner ── */}
      <section
        className="hero-gradient rounded-2xl px-10 py-12 mb-8 text-white overflow-hidden relative"
        style={{ minHeight: "240px" }}
      >
        {/* Subtle radial glow for depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 80% 50%, rgba(99,102,241,0.35) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-2xl">
          <h1 className="text-[2rem] leading-tight font-bold mb-3 tracking-tight">
            The intelligence layer for prediction markets
          </h1>
          <p className="text-[15px] text-blue-100 mb-8 leading-relaxed max-w-xl">
            Decoding whether odds movements reflect real signal or just noise —
            across politics, crypto, economics, weather, and more. Every market
            move gets a confidence rating backed by on-chain behavioral analysis.
          </p>

          {/* Stat chips */}
          <div className="flex flex-wrap gap-3">
            {stats.map((s) => (
              <div
                key={s.label}
                className="hero-stat-chip flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-default select-none"
              >
                <span className="text-[15px] font-bold text-white">{s.value}</span>
                <span className="text-[13px] text-blue-100 font-medium">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
