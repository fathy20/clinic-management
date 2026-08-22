// The signature device: the range-of-motion sweep, the physiotherapist's own
// geometry. Package progress, plan completion, utilisation and recovery all
// render as arcs — never bars. See DESIGN.md §4.
//
// 220deg sweep (200deg -> -20deg). pathLength=100 makes the dash array
// literally the percentage, so no arc-length maths at render time.
const GEOM = {
  lg: { w: 80, h: 58, d: "M 8.05 51.63 A 34 34 0 1 1 71.95 51.63", stroke: 6 },
  sm: { w: 32, h: 22, d: "M 3.78 20.45 A 13 13 0 1 1 28.22 20.45", stroke: 3.4 },
} as const;

export function Arc({
  value,
  max = 100,
  size = "lg",
  tone = "jade",
  label,
  caption,
}: {
  value: number;
  max?: number;
  size?: "lg" | "sm";
  tone?: "jade" | "brick";
  label?: string;
  caption?: string;
}) {
  const g = GEOM[size];
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const rounded = Math.round(pct);

  return (
    <div className="arc">
      <svg
        width={g.w}
        height={g.h}
        viewBox={`0 0 ${g.w} ${g.h}`}
        role="img"
        aria-label={`${caption ?? "التقدم"} ${rounded}٪`}
      >
        <path className="track" d={g.d} strokeWidth={g.stroke} pathLength={100} />
        <path
          className={tone === "brick" ? "value warn" : "value"}
          d={g.d}
          strokeWidth={g.stroke}
          pathLength={100}
          strokeDasharray={`${pct} 100`}
        />
      </svg>
      {label && (
        <div className="arc-num">
          {label}
        </div>
      )}
      {caption && <div className="arc-cap">{caption}</div>}
    </div>
  );
}
