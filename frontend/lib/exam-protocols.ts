// Guided examination pathways.
//
// WHAT THIS IS: the structure of an examination — which things to look at, in
// what order, and which anatomical structure each step is examining. It is a
// checklist and a prompt, in the order a physiotherapist actually works.
//
// WHAT THIS IS NOT, and must never become: a diagnosis. Nothing here maps
// findings to a condition, and nothing here carries a sensitivity, a
// specificity or a likelihood. Two reasons, and the second matters more:
//
//   1. Software that outputs a diagnosis is a regulated medical device, and
//      that is a liability this product is not taking on.
//   2. A clinician does not trust a black box. "Kleiger's test — examines the
//      distal tibiofibular syndesmosis" is useful to them. "Probably a high
//      ankle sprain" is not, and they would stop using the product.
//
// Test names are standard orthopaedic vocabulary, not clinical claims. Where
// a step needs a threshold or a norm, it asks for the measurement and leaves
// interpretation to the clinician.

export type ExamStep = {
  id: string;
  /** what the clinician does */
  action: string;
  /** the structure or function this step is examining */
  examines: string;
  /** what to write down — a measurement, a side-to-side comparison, a yes/no */
  records: "note" | "degrees" | "compare" | "yesno";
  /** which anatomical structure to highlight while this step is active */
  highlight?: string;
};

export type ExamPhase = {
  id: string;
  label: string;
  steps: ExamStep[];
};

// The disciplines this clinic practises. A region can belong to several: a
// knee is a knee whether the practitioner is a physiotherapist, an osteopath
// or a sports therapist, and the examination structure is shared.
//
// What is NOT here, deliberately: traditional Chinese medicine. TCM has its
// own diagnostic framework — pattern differentiation, tongue and pulse
// examination, channel theory — and it is not a relabelling of an orthopaedic
// assessment. Borrowing this file's structure for it would produce something
// that looks authoritative and is not. It needs protocols authored by a TCM
// practitioner, in their own vocabulary, and until someone writes those the
// honest thing is to leave the discipline out rather than fake it.
export type Discipline =
  | "physio"
  | "osteopathy"
  | "sports"
  | "movement"
  | "nutrition";

export const DISCIPLINES: { id: Discipline; label: string }[] = [
  { id: "physio", label: "Physiotherapy" },
  { id: "osteopathy", label: "Osteopathy" },
  { id: "sports", label: "Sports injury" },
  { id: "movement", label: "Movement analysis" },
  { id: "nutrition", label: "Nutrition" },
];

export type Region = {
  id: string;
  label: string;
  /** which practices use this pathway */
  disciplines: Discipline[];
  /** the SOAP template this examination feeds into */
  template: string;
  /** outcome measures conventionally used for this region */
  measures: string[];
  /** structures the anatomy panel can label, in draw order */
  structures: { id: string; label: string }[];
  phases: ExamPhase[];
};

// Red flags are shared across regions and always come first. IFOMPT's own
// framework is explicit that these are a reasoning pathway rather than a
// diagnostic rule — the point is to ask the question at the initial
// assessment, and to consider referral if something is present.
export const RED_FLAG_PROMPTS = [
  { id: "rf-weight", prompt: "Unexplained weight loss, night sweats or fever" },
  { id: "rf-night", prompt: "Night pain unrelieved by any position" },
  { id: "rf-cancer", prompt: "History of cancer" },
  { id: "rf-cauda", prompt: "Saddle anaesthesia, or bladder or bowel change" },
  { id: "rf-neuro", prompt: "Progressive or bilateral neurological deficit" },
  { id: "rf-trauma", prompt: "Significant trauma, or minor trauma with osteoporosis" },
  { id: "rf-steroid", prompt: "Long-term corticosteroid use or immunosuppression" },
  { id: "rf-age", prompt: "First onset before 20 or after 55" },
  { id: "rf-vbi", prompt: "Dizziness, diplopia, dysarthria or drop attacks" },
];

export const REGIONS: Region[] = [
  {
    id: "ankle_foot",
    disciplines: ["physio", "sports", "osteopathy"],
    label: "Ankle and foot",
    template: "follow_up",
    measures: ["NPRS", "PSFS", "SixMWT"],
    structures: [
      { id: "atfl", label: "Anterior talofibular ligament" },
      { id: "syndesmosis", label: "Distal syndesmosis" },
      { id: "achilles", label: "Achilles tendon" },
      { id: "arch", label: "Medial arch" },
      { id: "talus", label: "Talus" },
    ],
    phases: [
      {
        id: "observe",
        label: "Observation",
        steps: [
          {
            id: "swelling",
            action: "Swelling and bruising, weight-bearing status",
            examines: "Extent and location of injury",
            records: "note",
          },
          {
            id: "arch_stance",
            action: "Arch in standing and on single-leg stance",
            examines: "Medial arch and foot posture under load",
            records: "compare",
            highlight: "arch",
          },
        ],
      },
      {
        id: "movement",
        label: "Movement",
        steps: [
          {
            id: "dorsiflexion",
            action: "Weight-bearing lunge for dorsiflexion",
            examines: "Ankle dorsiflexion range",
            records: "compare",
          },
          {
            id: "inversion",
            action: "Inversion and eversion",
            examines: "Subtalar movement",
            records: "compare",
            highlight: "talus",
          },
        ],
      },
      {
        id: "stability",
        label: "Ligament and tendon testing",
        steps: [
          {
            id: "anterior_drawer",
            action: "Anterior drawer",
            examines: "Anterior talofibular ligament",
            records: "yesno",
            highlight: "atfl",
          },
          {
            id: "squeeze",
            action: "Squeeze test",
            examines: "Distal tibiofibular syndesmosis",
            records: "yesno",
            highlight: "syndesmosis",
          },
          {
            id: "thompson",
            action: "Thompson (calf squeeze)",
            examines: "Achilles tendon continuity",
            records: "yesno",
            highlight: "achilles",
          },
          {
            id: "hop_single",
            action: "Single-leg heel raise, then hop if appropriate",
            examines: "Calf endurance and load tolerance",
            records: "compare",
            highlight: "achilles",
          },
        ],
      },
    ],
  },
  {
    id: "movement_screen",
    disciplines: ["movement", "sports", "physio"],
    label: "Movement screen",
    template: "follow_up",
    measures: ["PSFS", "NPRS"],
    structures: [],
    phases: [
      {
        id: "fundamental",
        label: "Fundamental patterns",
        steps: [
          {
            id: "squat_pattern",
            action: "Overhead squat, front and side",
            examines: "Ankle, hip and thoracic contribution to a squat",
            records: "note",
          },
          {
            id: "sl_squat",
            action: "Single-leg squat",
            examines: "Frontal plane hip and knee control",
            records: "compare",
          },
          {
            id: "hinge",
            action: "Hip hinge",
            examines: "Ability to dissociate hip from lumbar movement",
            records: "note",
          },
          {
            id: "step_down",
            action: "Step down from a box",
            examines: "Eccentric control under load",
            records: "compare",
          },
        ],
      },
      {
        id: "capacity",
        label: "Capacity",
        steps: [
          {
            id: "calf_raise",
            action: "Single-leg calf raise to fatigue",
            examines: "Plantarflexor endurance",
            records: "compare",
          },
          {
            id: "plank",
            action: "Trunk endurance hold",
            examines: "Trunk endurance",
            records: "note",
          },
          {
            id: "hop_test",
            action: "Single-leg hop for distance",
            examines: "Limb symmetry under power",
            records: "compare",
          },
        ],
      },
      {
        id: "sport",
        label: "Sport-specific",
        steps: [
          {
            id: "cod",
            action: "Change of direction at controlled speed",
            examines: "Deceleration and re-acceleration control",
            records: "note",
          },
          {
            id: "sport_task",
            action: "The task the athlete actually needs to return to",
            examines: "Readiness for their own demand, not a generic one",
            records: "note",
          },
        ],
      },
    ],
  },
  {
    id: "nutrition",
    disciplines: ["nutrition"],
    label: "Nutrition assessment",
    template: "",
    measures: ["PSFS"],
    structures: [],
    phases: [
      {
        id: "anthropometry",
        label: "Measurements",
        steps: [
          {
            id: "weight",
            action: "Weight (kg)",
            examines: "Body mass, to be trended rather than judged once",
            records: "degrees",
          },
          {
            id: "height",
            action: "Height (cm)",
            examines: "Stature",
            records: "degrees",
          },
          {
            id: "waist",
            action: "Waist circumference (cm)",
            examines: "Central adiposity",
            records: "degrees",
          },
          {
            id: "bodyfat",
            action: "Body composition, if measured",
            examines: "Fat and lean mass distribution",
            records: "note",
          },
        ],
      },
      {
        id: "intake",
        label: "Intake and habits",
        steps: [
          {
            id: "recall",
            action: "24-hour recall or typical day",
            examines: "Habitual intake pattern",
            records: "note",
          },
          {
            id: "fluid",
            action: "Fluid intake",
            examines: "Hydration habit",
            records: "note",
          },
          {
            id: "meal_timing",
            action: "Meal timing relative to training",
            examines: "Fuelling around load",
            records: "note",
          },
          {
            id: "restrictions",
            action: "Allergies, intolerances, religious or personal restrictions",
            examines: "What any plan has to work within",
            records: "note",
          },
        ],
      },
      {
        id: "context",
        label: "Context",
        steps: [
          {
            id: "conditions",
            action: "Relevant medical conditions and medication",
            examines: "Constraints and interactions to refer on if needed",
            records: "note",
          },
          {
            id: "goal",
            action: "What the patient actually wants to change",
            examines: "The goal the plan is measured against",
            records: "note",
          },
        ],
      },
    ],
  },
  {
    id: "low_back",
    disciplines: ["physio", "osteopathy", "sports", "movement"],
    label: "Low back",
    template: "low_back",
    measures: ["NPRS", "ODI", "PSFS"],
    structures: [
      { id: "lumbar_spine", label: "Lumbar vertebrae" },
      { id: "disc", label: "Intervertebral disc" },
      { id: "facet", label: "Facet joints" },
      { id: "si_joint", label: "Sacroiliac joint" },
      { id: "erector", label: "Erector spinae" },
      { id: "sciatic", label: "Sciatic nerve" },
    ],
    phases: [
      {
        id: "observe",
        label: "Observation",
        steps: [
          {
            id: "posture",
            action: "Standing posture, from behind and from the side",
            examines: "Lumbar lordosis, pelvic tilt, lateral shift",
            records: "note",
            highlight: "lumbar_spine",
          },
          {
            id: "gait",
            action: "Walk a few metres",
            examines: "Antalgic pattern, trunk control",
            records: "note",
          },
        ],
      },
      {
        id: "movement",
        label: "Active movement",
        steps: [
          {
            id: "flexion",
            action: "Forward flexion",
            examines: "Lumbar flexion range and symptom response",
            records: "degrees",
            highlight: "disc",
          },
          {
            id: "extension",
            action: "Extension",
            examines: "Lumbar extension range; loads the facet joints",
            records: "degrees",
            highlight: "facet",
          },
          {
            id: "sidebend",
            action: "Side flexion, left and right",
            examines: "Symmetry of lateral movement",
            records: "compare",
          },
          {
            id: "repeated",
            action: "Repeated movements in the direction that eases symptoms",
            examines: "Directional preference and symptom behaviour",
            records: "note",
          },
        ],
      },
      {
        id: "neuro",
        label: "Neurological screen",
        steps: [
          {
            id: "slr",
            action: "Straight leg raise",
            examines: "Neural mechanosensitivity of the sciatic tract",
            records: "degrees",
            highlight: "sciatic",
          },
          {
            id: "myotome",
            action: "Myotomes L2–S1",
            examines: "Segmental motor supply",
            records: "compare",
          },
          {
            id: "dermatome",
            action: "Dermatomes L2–S1",
            examines: "Segmental sensory supply",
            records: "compare",
          },
          {
            id: "reflex",
            action: "Knee and ankle reflexes",
            examines: "L3–4 and S1 reflex arcs",
            records: "compare",
          },
        ],
      },
      {
        id: "palpation",
        label: "Palpation and specific tests",
        steps: [
          {
            id: "palpate",
            action: "Palpate spinous processes, paraspinals, SIJ",
            examines: "Local tenderness and muscle tone",
            records: "note",
            highlight: "erector",
          },
          {
            id: "sij_cluster",
            action: "Sacroiliac provocation cluster",
            examines: "Sacroiliac joint as a symptom source",
            records: "yesno",
            highlight: "si_joint",
          },
        ],
      },
    ],
  },
  {
    id: "shoulder",
    disciplines: ["physio", "osteopathy", "sports"],
    label: "Shoulder",
    template: "shoulder",
    measures: ["NPRS", "DASH", "PSFS"],
    structures: [
      { id: "gh_joint", label: "Glenohumeral joint" },
      { id: "supraspinatus", label: "Supraspinatus" },
      { id: "subacromial", label: "Subacromial space" },
      { id: "labrum", label: "Glenoid labrum" },
      { id: "ac_joint", label: "Acromioclavicular joint" },
      { id: "scapula", label: "Scapula" },
    ],
    phases: [
      {
        id: "observe",
        label: "Observation",
        steps: [
          {
            id: "resting",
            action: "Resting scapular position, both sides",
            examines: "Scapular orientation and symmetry",
            records: "compare",
            highlight: "scapula",
          },
          {
            id: "wasting",
            action: "Look for muscle wasting",
            examines: "Deltoid and rotator cuff bulk",
            records: "note",
          },
        ],
      },
      {
        id: "movement",
        label: "Active and passive movement",
        steps: [
          {
            id: "flexion",
            action: "Active flexion",
            examines: "Glenohumeral and scapulothoracic contribution",
            records: "degrees",
            highlight: "gh_joint",
          },
          {
            id: "abduction",
            action: "Active abduction, watching the painful arc",
            examines: "Subacromial space under load",
            records: "degrees",
            highlight: "subacromial",
          },
          {
            id: "rotation",
            action: "External and internal rotation, at 0° and 90°",
            examines: "Rotator cuff length and joint capsule",
            records: "compare",
          },
          {
            id: "passive",
            action: "Repeat passively where active movement is limited",
            examines: "Whether the limit is capsular or muscular",
            records: "note",
          },
        ],
      },
      {
        id: "strength",
        label: "Resisted testing",
        steps: [
          {
            id: "abduction_resist",
            action: "Resisted abduction in the scapular plane",
            examines: "Supraspinatus",
            records: "compare",
            highlight: "supraspinatus",
          },
          {
            id: "er_resist",
            action: "Resisted external rotation",
            examines: "Infraspinatus and teres minor",
            records: "compare",
          },
          {
            id: "ir_resist",
            action: "Resisted internal rotation",
            examines: "Subscapularis",
            records: "compare",
          },
        ],
      },
      {
        id: "special",
        label: "Specific tests",
        steps: [
          {
            id: "hawkins",
            action: "Hawkins–Kennedy",
            examines: "Subacromial structures under internal rotation",
            records: "yesno",
            highlight: "subacromial",
          },
          {
            id: "obrien",
            action: "O'Brien (active compression)",
            examines: "Labrum and acromioclavicular joint",
            records: "yesno",
            highlight: "labrum",
          },
          {
            id: "ac_palpate",
            action: "Palpate the acromioclavicular joint",
            examines: "Acromioclavicular joint",
            records: "yesno",
            highlight: "ac_joint",
          },
        ],
      },
    ],
  },
  {
    id: "knee",
    disciplines: ["physio", "sports", "movement"],
    label: "Knee",
    template: "knee",
    measures: ["NPRS", "PSFS", "SixMWT"],
    structures: [
      { id: "acl", label: "Anterior cruciate ligament" },
      { id: "mcl", label: "Medial collateral ligament" },
      { id: "meniscus", label: "Menisci" },
      { id: "patella", label: "Patella" },
      { id: "quads", label: "Quadriceps" },
      { id: "joint_line", label: "Joint line" },
    ],
    phases: [
      {
        id: "observe",
        label: "Observation",
        steps: [
          {
            id: "effusion",
            action: "Look and sweep for effusion",
            examines: "Intra-articular swelling",
            records: "yesno",
            highlight: "joint_line",
          },
          {
            id: "alignment",
            action: "Standing alignment and quadriceps bulk",
            examines: "Varus/valgus, quadriceps wasting",
            records: "compare",
            highlight: "quads",
          },
        ],
      },
      {
        id: "movement",
        label: "Movement",
        steps: [
          {
            id: "flexion",
            action: "Active and passive flexion",
            examines: "Knee flexion range",
            records: "degrees",
          },
          {
            id: "extension",
            action: "Extension, including terminal extension",
            examines: "Extension lag or fixed flexion",
            records: "degrees",
          },
          {
            id: "patellar",
            action: "Patellar glide and tracking",
            examines: "Patellofemoral joint",
            records: "note",
            highlight: "patella",
          },
        ],
      },
      {
        id: "stability",
        label: "Ligament and meniscal testing",
        steps: [
          {
            id: "lachman",
            action: "Lachman",
            examines: "Anterior cruciate ligament",
            records: "yesno",
            highlight: "acl",
          },
          {
            id: "valgus",
            action: "Valgus stress at 30°",
            examines: "Medial collateral ligament",
            records: "yesno",
            highlight: "mcl",
          },
          {
            id: "varus",
            action: "Varus stress at 30°",
            examines: "Lateral collateral ligament",
            records: "yesno",
          },
          {
            id: "mcmurray",
            action: "McMurray",
            examines: "Menisci",
            records: "yesno",
            highlight: "meniscus",
          },
          {
            id: "joint_line_tender",
            action: "Palpate the joint line",
            examines: "Meniscal and joint-line tenderness",
            records: "compare",
            highlight: "joint_line",
          },
        ],
      },
      {
        id: "function",
        label: "Function",
        steps: [
          {
            id: "squat",
            action: "Double then single-leg squat",
            examines: "Load tolerance and control",
            records: "note",
          },
          {
            id: "hop",
            action: "Single-leg hop, if appropriate",
            examines: "Readiness for impact loading",
            records: "compare",
          },
        ],
      },
    ],
  },
  {
    id: "neck",
    disciplines: ["physio", "osteopathy"],
    label: "Neck",
    template: "neck",
    measures: ["NPRS", "PSFS"],
    structures: [
      { id: "cervical_spine", label: "Cervical vertebrae" },
      { id: "facet_c", label: "Cervical facet joints" },
      { id: "brachial", label: "Brachial plexus" },
      { id: "upper_trap", label: "Upper trapezius" },
      { id: "deep_flexors", label: "Deep neck flexors" },
    ],
    phases: [
      {
        id: "screen",
        label: "Screening first",
        steps: [
          {
            id: "vbi",
            action: "Ask about dizziness, diplopia, dysarthria, drop attacks",
            examines: "Symptoms warranting caution before manual technique",
            records: "yesno",
          },
          {
            id: "cranial",
            action: "Cranial nerve screen if indicated",
            examines: "Cranial nerve function",
            records: "note",
          },
        ],
      },
      {
        id: "movement",
        label: "Active movement",
        steps: [
          {
            id: "rotation",
            action: "Rotation, left and right",
            examines: "Cervical rotation range and symmetry",
            records: "compare",
            highlight: "cervical_spine",
          },
          {
            id: "extension",
            action: "Extension",
            examines: "Posterior element loading",
            records: "degrees",
            highlight: "facet_c",
          },
          {
            id: "flexion_c",
            action: "Flexion and chin tuck",
            examines: "Deep neck flexor control",
            records: "note",
            highlight: "deep_flexors",
          },
        ],
      },
      {
        id: "neuro",
        label: "Upper limb neurological screen",
        steps: [
          {
            id: "myotome_c",
            action: "Myotomes C5–T1",
            examines: "Segmental motor supply",
            records: "compare",
          },
          {
            id: "dermatome_c",
            action: "Dermatomes C5–T1",
            examines: "Segmental sensory supply",
            records: "compare",
          },
          {
            id: "ulnt",
            action: "Upper limb neurodynamic test",
            examines: "Neural mechanosensitivity",
            records: "yesno",
            highlight: "brachial",
          },
        ],
      },
      {
        id: "palpation",
        label: "Palpation",
        steps: [
          {
            id: "palpate_c",
            action: "Palpate cervical segments and upper trapezius",
            examines: "Segmental tenderness and muscle tone",
            records: "note",
            highlight: "upper_trap",
          },
        ],
      },
    ],
  },
];

export function regionById(id: string) {
  return REGIONS.find((r) => r.id === id);
}

export type Finding = {
  stepId: string;
  value: string;
  /** left/right where the step asks for a comparison */
  left?: string;
  right?: string;
};

export type BodyMark = {
  /** normalised 0–1 within the chart, so it survives any render size */
  x: number;
  y: number;
  view: "front" | "back";
  kind: "pain" | "pins" | "numb" | "ache";
};

// Turns a completed examination into the objective half of a SOAP note.
// Written as prose because that is what a clinician reads back in six weeks —
// the structured version is kept alongside it for redrawing the body chart.
export function findingsToObjective(
  regionId: string,
  findings: Finding[],
  marks: BodyMark[],
  flags: string[]
): string {
  const region = regionById(regionId);
  if (!region) return "";

  const byId = new Map(findings.map((f) => [f.stepId, f]));
  const lines: string[] = [];

  if (flags.length > 0) {
    const labels = RED_FLAG_PROMPTS.filter((f) => flags.includes(f.id)).map(
      (f) => f.prompt
    );
    lines.push(`SCREENING POSITIVE — consider referral: ${labels.join("; ")}`);
    lines.push("");
  }

  for (const phase of region.phases) {
    const written = phase.steps
      .map((step) => {
        const f = byId.get(step.id);
        if (!f) return null;
        if (step.records === "compare" && (f.left || f.right)) {
          return `  ${step.action}: L ${f.left || "—"} / R ${f.right || "—"}`;
        }
        if (!f.value) return null;
        return `  ${step.action}: ${f.value}`;
      })
      .filter(Boolean);

    if (written.length > 0) {
      lines.push(`${phase.label}:`);
      lines.push(...(written as string[]));
    }
  }

  if (marks.length > 0) {
    const summary = marks
      .map((m) => `${m.kind} (${m.view})`)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ");
    lines.push("");
    lines.push(`Body chart: ${summary}`);
  }

  return lines.join("\n");
}
