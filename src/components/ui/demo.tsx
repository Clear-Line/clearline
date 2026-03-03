import { Component as Globe } from "@/components/ui/interactive-globe";

export default function Demo() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card">
        <div className="pointer-events-none absolute right-1/4 top-0 h-96 w-96 rounded-full bg-blue-500/5 blur-3xl" />

        <div className="flex min-h-[500px] flex-col md:flex-row">
          <div className="relative z-10 flex flex-1 flex-col justify-center p-10 md:p-14">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              All systems operational
            </div>

            <h1 className="mb-4 text-3xl font-bold leading-[1.1] tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Global Edge
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Network
              </span>
            </h1>

            <p className="mb-8 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
              Deployed across 150+ points of presence worldwide. Your data served
              from the nearest node in under 50ms. Drag the globe to explore.
            </p>

            <div className="flex items-center gap-6">
              <div>
                <p className="text-2xl font-bold text-foreground">150+</p>
                <p className="text-xs text-muted-foreground">Edge Nodes</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-2xl font-bold text-foreground">&lt;50ms</p>
                <p className="text-xs text-muted-foreground">Avg Latency</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-2xl font-bold text-foreground">99.99%</p>
                <p className="text-xs text-muted-foreground">Uptime</p>
              </div>
            </div>
          </div>

          <div className="flex min-h-[400px] flex-1 items-center justify-center p-4 md:p-0">
            <Globe size={460} />
          </div>
        </div>
      </div>
    </div>
  );
}
