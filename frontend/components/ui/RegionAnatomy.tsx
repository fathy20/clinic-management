"use client";

import { t } from "@/lib/strings";

// A labelled schematic of the region under examination, with the structure the
// current step is testing lit up.
//
// It is deliberately a *schematic*, not an illustration: simple shapes with
// leader lines, honest about being a diagram. A convincing-looking anatomical
// drawing that is subtly wrong is worse than a clear diagram that is obviously
// a diagram, and a clinician reads it faster anyway. Everything is inline SVG
// so it works offline, in both themes, and at any size.

type Shape = {
  id: string;
  /** where the label sits, and which side its leader line runs to */
  label: { x: number; y: number; anchor: "start" | "end" };
  draw: React.ReactNode;
  /** the point the leader line touches on the shape */
  from: { x: number; y: number };
};

const ACTIVE = "var(--jade)";
const QUIET = "var(--line)";
const FILL = "var(--sunken)";

function bone(d: string, on: boolean) {
  return (
    <path
      d={d}
      fill={on ? "var(--jade-wash)" : FILL}
      stroke={on ? ACTIVE : QUIET}
      strokeWidth={on ? 2 : 1.2}
      strokeLinejoin="round"
    />
  );
}

function soft(d: string, on: boolean) {
  return (
    <path
      d={d}
      fill="none"
      stroke={on ? ACTIVE : QUIET}
      strokeWidth={on ? 3.4 : 2.2}
      strokeLinecap="round"
    />
  );
}

function REGION_SHAPES(regionId: string, on: (id: string) => boolean): Shape[] {
  switch (regionId) {
    case "low_back":
      return [
        {
          id: "lumbar_spine",
          label: { x: 152, y: 46, anchor: "start" },
          from: { x: 100, y: 46 },
          draw: (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  {bone(
                    `M84 ${30 + i * 22} h32 a5 5 0 0 1 5 5 v10 a5 5 0 0 1 -5 5 h-32 a5 5 0 0 1 -5 -5 v-10 a5 5 0 0 1 5 -5 z`,
                    on("lumbar_spine")
                  )}
                </g>
              ))}
            </>
          ),
        },
        {
          id: "disc",
          label: { x: 152, y: 90, anchor: "start" },
          from: { x: 100, y: 72 },
          draw: (
            <>
              {[0, 1, 2, 3].map((i) => (
                <ellipse
                  key={i}
                  cx="100"
                  cy={72 + i * 22}
                  rx="20"
                  ry="4"
                  fill={on("disc") ? ACTIVE : "var(--muted)"}
                  opacity={on("disc") ? 0.85 : 0.35}
                />
              ))}
            </>
          ),
        },
        {
          id: "facet",
          label: { x: 48, y: 60, anchor: "end" },
          from: { x: 79, y: 62 },
          draw: (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <circle
                  key={i}
                  cx="77"
                  cy={40 + i * 22}
                  r="4.5"
                  fill={on("facet") ? ACTIVE : FILL}
                  stroke={on("facet") ? ACTIVE : QUIET}
                  strokeWidth="1.2"
                />
              ))}
            </>
          ),
        },
        {
          id: "si_joint",
          label: { x: 48, y: 158, anchor: "end" },
          from: { x: 82, y: 152 },
          draw: bone("M74 140 l52 0 -8 34 -36 0 z", on("si_joint")),
        },
        {
          id: "erector",
          label: { x: 152, y: 128, anchor: "start" },
          from: { x: 124, y: 110 },
          draw: (
            <>
              {soft("M126 28 q8 60 -2 110", on("erector"))}
              {soft("M74 28 q-8 60 2 110", on("erector"))}
            </>
          ),
        },
        {
          id: "sciatic",
          label: { x: 152, y: 196, anchor: "start" },
          from: { x: 112, y: 190 },
          draw: soft("M104 168 q10 24 6 52", on("sciatic")),
        },
      ];

    case "shoulder":
      return [
        {
          id: "scapula",
          label: { x: 44, y: 132, anchor: "end" },
          from: { x: 74, y: 118 },
          draw: bone("M56 78 l38 14 -6 62 -30 -22 z", on("scapula")),
        },
        {
          id: "gh_joint",
          label: { x: 158, y: 96, anchor: "start" },
          from: { x: 118, y: 92 },
          draw: (
            <>
              {bone("M96 76 a24 24 0 0 1 0 40 z", on("gh_joint"))}
              <circle
                cx="118"
                cy="96"
                r="19"
                fill={on("gh_joint") ? "var(--jade-wash)" : FILL}
                stroke={on("gh_joint") ? ACTIVE : QUIET}
                strokeWidth={on("gh_joint") ? 2 : 1.2}
              />
            </>
          ),
        },
        {
          id: "ac_joint",
          label: { x: 158, y: 48, anchor: "start" },
          from: { x: 116, y: 58 },
          draw: (
            <>
              {bone("M62 50 h48 v9 h-48 z", on("ac_joint"))}
              <rect
                x="110"
                y="46"
                width="9"
                height="17"
                rx="2"
                fill={on("ac_joint") ? ACTIVE : "var(--muted)"}
                opacity={on("ac_joint") ? 0.9 : 0.4}
              />
            </>
          ),
        },
        {
          id: "subacromial",
          label: { x: 158, y: 70, anchor: "start" },
          from: { x: 122, y: 70 },
          draw: (
            <path
              d="M104 62 q20 -8 34 4"
              fill="none"
              stroke={on("subacromial") ? ACTIVE : QUIET}
              strokeWidth={on("subacromial") ? 5 : 3}
              strokeLinecap="round"
              opacity="0.8"
            />
          ),
        },
        {
          id: "supraspinatus",
          label: { x: 44, y: 74, anchor: "end" },
          from: { x: 82, y: 76 },
          draw: soft("M64 72 q28 -4 48 12", on("supraspinatus")),
        },
        {
          id: "labrum",
          label: { x: 44, y: 104, anchor: "end" },
          from: { x: 94, y: 100 },
          draw: soft("M96 78 a22 22 0 0 1 0 36", on("labrum")),
        },
      ];

    case "knee":
      return [
        {
          id: "patella",
          label: { x: 44, y: 104, anchor: "end" },
          from: { x: 78, y: 106 },
          draw: bone("M70 92 q16 -6 22 6 q2 16 -11 22 q-14 -4 -11 -28 z", on("patella")),
        },
        {
          id: "quads",
          label: { x: 152, y: 40, anchor: "start" },
          from: { x: 106, y: 46 },
          draw: (
            <>
              {bone("M86 12 h34 v66 h-34 z", on("quads"))}
              {soft("M92 74 q10 12 22 0", on("quads"))}
            </>
          ),
        },
        {
          id: "joint_line",
          label: { x: 152, y: 118, anchor: "start" },
          from: { x: 122, y: 116 },
          draw: (
            <line
              x1="80"
              y1="116"
              x2="126"
              y2="116"
              stroke={on("joint_line") ? ACTIVE : QUIET}
              strokeWidth={on("joint_line") ? 3.4 : 1.6}
              strokeDasharray={on("joint_line") ? "none" : "4 3"}
            />
          ),
        },
        {
          id: "meniscus",
          label: { x: 152, y: 140, anchor: "start" },
          from: { x: 124, y: 128 },
          draw: (
            <>
              <path
                d="M84 124 q10 -6 18 0"
                fill="none"
                stroke={on("meniscus") ? ACTIVE : QUIET}
                strokeWidth={on("meniscus") ? 4 : 2.4}
                strokeLinecap="round"
              />
              <path
                d="M106 124 q10 -6 18 0"
                fill="none"
                stroke={on("meniscus") ? ACTIVE : QUIET}
                strokeWidth={on("meniscus") ? 4 : 2.4}
                strokeLinecap="round"
              />
            </>
          ),
        },
        {
          id: "acl",
          label: { x: 44, y: 136, anchor: "end" },
          from: { x: 96, y: 132 },
          draw: soft("M90 142 l24 -22", on("acl")),
        },
        {
          id: "mcl",
          label: { x: 44, y: 166, anchor: "end" },
          from: { x: 80, y: 150 },
          draw: soft("M80 104 l0 56", on("mcl")),
        },
        {
          id: "tibia",
          label: { x: 152, y: 196, anchor: "start" },
          from: { x: 112, y: 190 },
          draw: bone("M88 148 h30 v62 h-30 z", false),
        },
      ];

    case "neck":
      return [
        {
          id: "cervical_spine",
          label: { x: 152, y: 60, anchor: "start" },
          from: { x: 106, y: 60 },
          draw: (
            <>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <g key={i}>
                  {bone(
                    `M86 ${24 + i * 17} h24 a4 4 0 0 1 4 4 v7 a4 4 0 0 1 -4 4 h-24 a4 4 0 0 1 -4 -4 v-7 a4 4 0 0 1 4 -4 z`,
                    on("cervical_spine")
                  )}
                </g>
              ))}
            </>
          ),
        },
        {
          id: "facet_c",
          label: { x: 44, y: 76, anchor: "end" },
          from: { x: 80, y: 78 },
          draw: (
            <>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <circle
                  key={i}
                  cx="79"
                  cy={40 + i * 17}
                  r="3.6"
                  fill={on("facet_c") ? ACTIVE : FILL}
                  stroke={on("facet_c") ? ACTIVE : QUIET}
                  strokeWidth="1.1"
                />
              ))}
            </>
          ),
        },
        {
          id: "deep_flexors",
          label: { x: 152, y: 108, anchor: "start" },
          from: { x: 116, y: 100 },
          draw: soft("M112 30 q10 44 0 78", on("deep_flexors")),
        },
        {
          id: "upper_trap",
          label: { x: 44, y: 148, anchor: "end" },
          from: { x: 74, y: 146 },
          draw: soft("M84 140 q-24 6 -34 26", on("upper_trap")),
        },
        {
          id: "brachial",
          label: { x: 152, y: 156, anchor: "start" },
          from: { x: 122, y: 152 },
          draw: (
            <>
              {soft("M108 132 q18 8 30 26", on("brachial"))}
              {soft("M108 142 q20 6 28 22", on("brachial"))}
            </>
          ),
        },
      ];

    default:
      return [];
  }
}

export function RegionAnatomy({
  regionId,
  highlight,
  structures,
}: {
  regionId: string;
  highlight?: string;
  structures: { id: string; label: string }[];
}) {
  const on = (id: string) => id === highlight;
  const shapes = REGION_SHAPES(regionId, on);
  if (shapes.length === 0) return null;

  const labelOf = (id: string) =>
    structures.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="anatomy">
      <svg viewBox="0 0 240 220" role="img" aria-label={t("anatomyOf")}>
        {shapes.map((s) => (
          <g key={s.id}>{s.draw}</g>
        ))}

        {/* Leader lines and labels drawn last so nothing overlaps the text. */}
        {shapes
          .filter((s) => structures.some((st) => st.id === s.id))
          .map((s) => {
            const lit = on(s.id);
            const toX = s.label.anchor === "start" ? s.label.x - 6 : s.label.x + 6;
            return (
              <g key={`l-${s.id}`}>
                <line
                  x1={s.from.x}
                  y1={s.from.y}
                  x2={toX}
                  y2={s.label.y}
                  stroke={lit ? ACTIVE : "var(--line)"}
                  strokeWidth={lit ? 1.2 : 0.7}
                />
                <text
                  x={s.label.x}
                  y={s.label.y + 3}
                  textAnchor={s.label.anchor}
                  className={lit ? "anatomy-label is-on" : "anatomy-label"}
                >
                  {labelOf(s.id)}
                </text>
              </g>
            );
          })}
      </svg>
      <p className="hint">{t("schematicNote")}</p>
    </div>
  );
}
