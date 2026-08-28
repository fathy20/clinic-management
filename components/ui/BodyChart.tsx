"use client";

import { useRef } from "react";
import type { BodyMark } from "@/lib/exam-protocols";
import { t } from "@/lib/strings";

// The body chart is the oldest tool in physiotherapy and still the fastest way
// to record where something hurts. Marks are stored normalised 0–1 so a chart
// drawn on a phone reads back correctly on a desktop, and so the same points
// can be re-rendered over the outline at any size.
//
// The outline is hand-authored SVG rather than an image: it has to work in
// both themes, scale without blurring, and carry no external request.

const MARK_KINDS: { kind: BodyMark["kind"]; label: string; colour: string }[] = [
  { kind: "pain", label: "Pain", colour: "var(--brick)" },
  { kind: "ache", label: "Ache", colour: "var(--money)" },
  { kind: "pins", label: "Pins", colour: "var(--jade)" },
  { kind: "numb", label: "Numb", colour: "var(--muted)" },
];

export function BodyChart({
  marks,
  active,
  onAdd,
  onRemove,
  onKindChange,
}: {
  marks: BodyMark[];
  active: BodyMark["kind"];
  onAdd: (mark: BodyMark) => void;
  onRemove: (index: number) => void;
  onKindChange: (kind: BodyMark["kind"]) => void;
}) {
  return (
    <div className="bodychart">
      <div className="bodychart-legend">
        {MARK_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={active === k.kind ? "markpick is-on" : "markpick"}
            onClick={() => onKindChange(k.kind)}
          >
            <span className="markdot" style={{ background: k.colour }} />
            {k.label}
          </button>
        ))}
      </div>

      <div className="bodychart-views">
        {(["front", "back"] as const).map((view) => (
          <BodyView
            key={view}
            view={view}
            marks={marks}
            active={active}
            onAdd={onAdd}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

function BodyView({
  view,
  marks,
  active,
  onAdd,
  onRemove,
}: {
  view: "front" | "back";
  marks: BodyMark[];
  active: BodyMark["kind"];
  onAdd: (mark: BodyMark) => void;
  onRemove: (index: number) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);

  function place(e: React.MouseEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    onAdd({
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
      view,
      kind: active,
    });
  }

  const mine = marks
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.view === view);

  return (
    <figure className="bodyview">
      <figcaption>{view === "front" ? t("frontView") : t("backView")}</figcaption>
      <svg
        ref={ref}
        viewBox="0 0 100 240"
        className="bodysvg"
        onClick={place}
        role="img"
        aria-label={view === "front" ? t("frontView") : t("backView")}
      >
        <g
          fill="var(--sunken)"
          stroke="var(--line)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        >
          {/* head and neck */}
          <ellipse cx="50" cy="18" rx="11" ry="13" />
          <rect x="45" y="30" width="10" height="7" rx="2" />

          {/* torso: shoulders taper to waist, then pelvis */}
          <path d="M32 38 h36 l4 10 -3 44 -3 22 h-32 l-3 -22 -3 -44 z" />

          {/* arms */}
          <path d="M32 40 l-9 5 -6 40 -2 26 h8 l4 -25 7 -34 z" />
          <path d="M68 40 l9 5 6 40 2 26 h-8 l-4 -25 -7 -34 z" />

          {/* legs */}
          <path d="M38 114 l-2 52 -1 44 h12 l1 -44 3 -52 z" />
          <path d="M62 114 l2 52 1 44 h-12 l-1 -44 -3 -52 z" />

          {/* feet */}
          <path d="M35 210 h12 v6 h-14 z" />
          <path d="M65 210 h-12 v6 h14 z" />
        </g>

        {/* Midline on the back view only — it is the landmark a clinician
            marks spinal levels against. */}
        {view === "back" && (
          <line
            x1="50"
            y1="38"
            x2="50"
            y2="112"
            stroke="var(--line)"
            strokeWidth="0.7"
            strokeDasharray="3 3"
          />
        )}

        {mine.map(({ m, i }) => {
          const colour =
            MARK_KINDS.find((k) => k.kind === m.kind)?.colour ?? "var(--brick)";
          return (
            <circle
              key={i}
              cx={m.x * 100}
              cy={m.y * 240}
              r="3.6"
              fill={colour}
              fillOpacity="0.75"
              stroke="var(--raised)"
              strokeWidth="1"
              className="bodymark"
              onClick={(e) => {
                // Clicking a mark removes it; without this the only way to
                // undo a misplaced point would be to start the chart again.
                e.stopPropagation();
                onRemove(i);
              }}
            />
          );
        })}
      </svg>
    </figure>
  );
}
