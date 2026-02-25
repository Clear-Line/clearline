import { ConfidenceLevel } from "../app/data/mockData";

interface ConfidenceBadgeProps {
  confidence: ConfidenceLevel;
  size?: "sm" | "md" | "lg";
}

export function ConfidenceBadge({
  confidence,
  size = "md",
}: ConfidenceBadgeProps) {
  const colors = {
    high: "bg-green-500/10 text-green-600 border-green-500/20",
    medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    low: "bg-red-500/10 text-red-600 border-red-500/20",
  };

  const sizes = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${colors[confidence]} ${sizes[size]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${confidence === "high" ? "bg-green-600" : confidence === "medium" ? "bg-yellow-600" : "bg-red-600"}`}
      />
      {confidence.charAt(0).toUpperCase() + confidence.slice(1)} signal
    </span>
  );
}
