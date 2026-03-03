import { ConfidenceLevel } from "../data/mockData";

interface ConfidenceBadgeProps {
  confidence: ConfidenceLevel;
  score?: number;
  size?: "sm" | "md" | "lg";
}

export function ConfidenceBadge({
  confidence,
  score,
  size = "md",
}: ConfidenceBadgeProps) {
  const colors = {
    high: "text-[#10b981] border-[#10b981]/20 bg-[#10b981]/10",
    medium: "text-[#f59e0b] border-[#f59e0b]/20 bg-[#f59e0b]/10",
    low: "text-[#64748b] border-[#64748b]/20 bg-[#64748b]/10",
  };

  const dotColors = {
    high: "bg-[#10b981]",
    medium: "bg-[#f59e0b]",
    low: "bg-[#64748b]",
  };

  const sizes = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2.5 py-1",
    lg: "text-sm px-3 py-1.5",
  };

  const displayScore = score ?? (confidence === "high" ? 75 : confidence === "medium" ? 50 : 25);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-medium ${colors[confidence]} ${sizes[size]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotColors[confidence]}`} />
      {displayScore}
    </span>
  );
}
