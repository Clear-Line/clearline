"use client";

export default function Home() {
  const stats = [
    { value: "13",  label: "Active Markets" },
    { value: "4",   label: "High Confidence Today" },
    { value: "92%", label: "Signal Accuracy" },
  ];

  return (
    <>
      {/* ── Hero ── */}
      <div className="w-full px-6 pt-8 pb-4">
        <section
          className="hero-gradient relative overflow-hidden rounded-2xl px-12 py-16"
          style={{ boxShadow: "0 8px 40px rgba(37,99,235,0.18)" }}
        >
          {/* Radial glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 55% 80% at 85% 50%, rgba(99,102,241,0.4) 0%, transparent 70%)",
            }}
          />

          <div className="relative max-w-3xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl leading-[1.1] font-bold mb-5 tracking-tight text-white">
              The intelligence layer for prediction markets
            </h1>
            <p className="text-lg text-blue-100 mb-10 leading-relaxed">
              Decoding whether odds movements reflect real signal or just noise —
              across politics, crypto, economics, weather, and more. Every market
              move gets a confidence rating backed by on-chain behavioral analysis.
            </p>

            {/* Stat chips */}
            <div className="flex flex-wrap justify-center gap-3">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="hero-stat-chip flex items-center gap-3 px-5 py-3 rounded-xl cursor-default select-none"
                >
                  <span className="text-lg font-bold text-white">{s.value}</span>
                  <span className="text-sm text-blue-100 font-medium">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── Page Content ── */}
      <div className="w-full px-6 pt-6 pb-8">
        {/* future content */}
      </div>
    </>
  );
}
