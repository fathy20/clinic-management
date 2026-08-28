// The clinical vocabulary, in one place so the UI, the server actions and the
// database check constraint cannot drift apart.

export const OUTCOME_MEASURES = {
  // Numeric pain rating, 0–10. The one every physiotherapist uses.
  NPRS: { max: 10, lowerIsBetter: true, label: "NPRS — pain (0–10)" },
  // Patient-specific functional scale: the patient names the activities.
  PSFS: { max: 10, lowerIsBetter: false, label: "PSFS — function (0–10)" },
  // Oswestry disability index, as a percentage.
  ODI: { max: 100, lowerIsBetter: true, label: "ODI — low back disability (%)" },
  // Disabilities of arm, shoulder and hand.
  DASH: { max: 100, lowerIsBetter: true, label: "DASH — upper limb (%)" },
  // Berg balance scale, 0–56.
  BERG: { max: 56, lowerIsBetter: false, label: "Berg — balance (0–56)" },
  // Six-minute walk test, in metres. No true ceiling, so the cap is generous
  // rather than meaningful — it exists to catch a typed-in mistake.
  SixMWT: { max: 1000, lowerIsBetter: false, label: "6MWT — distance (m)" },
} as const;

export type MeasureKind = keyof typeof OUTCOME_MEASURES;

export const MEASURE_KINDS = Object.keys(OUTCOME_MEASURES) as MeasureKind[];

export function isMeasureKind(value: string): value is MeasureKind {
  return value in OUTCOME_MEASURES;
}

// SOAP templates for the presentations that fill a physiotherapy diary. These
// are scaffolding a clinician edits, not text to be signed as-is — the point
// is that a follow-up starts from something rather than an empty box.
export const NOTE_TEMPLATES: Record<
  string,
  { label: string; subjective: string; objective: string; assessment: string; plan: string }
> = {
  low_back: {
    label: "Mechanical low back pain",
    subjective: "Pain: \nAggravating: \nEasing: \nSleep: \nNPRS: /10",
    objective:
      "Posture: \nLumbar ROM — flexion: , extension: , side flexion L/R: \nNeuro screen: \nPalpation: ",
    assessment: "",
    plan: "Manual therapy: \nExercise: \nHome programme: \nNext review: ",
  },
  shoulder: {
    label: "Shoulder / rotator cuff",
    subjective: "Onset: \nPain with overhead: \nNight pain: \nNPRS: /10",
    objective:
      "Active ROM — flexion: , abduction: , ext rotation: , int rotation: \nStrength: \nImpingement tests: ",
    assessment: "",
    plan: "Loading programme: \nRange work: \nHome programme: \nNext review: ",
  },
  knee: {
    label: "Knee",
    subjective: "Mechanism: \nSwelling: \nGiving way / locking: \nNPRS: /10",
    objective:
      "Effusion: \nROM — flexion: , extension: \nQuads/hamstring strength: \nSpecial tests: \nGait: ",
    assessment: "",
    plan: "Strength: \nProprioception: \nHome programme: \nNext review: ",
  },
  neck: {
    label: "Neck / cervical",
    subjective: "Pain and referral: \nHeadache: \nDesk setup: \nNPRS: /10",
    objective:
      "Cervical ROM: \nUpper limb neuro screen: \nPalpation: \nPosture: ",
    assessment: "",
    plan: "Manual therapy: \nDeep neck flexor work: \nErgonomics: \nNext review: ",
  },
  post_op: {
    label: "Post-operative rehab",
    subjective: "Surgery and date: \nSurgeon's protocol stage: \nPain: /10\nWound: ",
    objective: "ROM: \nStrength: \nSwelling: \nWeight bearing: \nFunction: ",
    assessment: "",
    plan: "Protocol stage goals: \nProgression criteria: \nNext review: ",
  },
  follow_up: {
    label: "Routine follow-up",
    subjective: "Since last visit: \nNPRS now: /10 (was /10)\nHome programme adherence: ",
    objective: "Re-test: \nChanged since last visit: ",
    assessment: "",
    plan: "Progress / regress: \nNext review: ",
  },
};

// Red-flag screening, framed as prompts. This deliberately does not conclude
// anything: an instrument that outputs a diagnosis is a regulated medical
// device, and a clinician will not trust a black box anyway. The value is in
// asking the right question at the initial assessment.
export const RED_FLAGS = [
  "Unexplained weight loss, night sweats or fever",
  "Night pain that wakes the patient and is unrelieved by position",
  "History of cancer",
  "Saddle anaesthesia, or bladder or bowel change",
  "Progressive neurological deficit or bilateral symptoms",
  "Recent significant trauma, or minor trauma with osteoporosis",
  "Long-term corticosteroid use, or immunosuppression",
  "Age of first onset under 20 or over 55",
];

// Change between two readings, signed so that positive always means better
// whichever direction the instrument runs. A caller that had to work the
// direction out itself would get it wrong for one measure in six.
export function improvement(kind: MeasureKind, first: number, latest: number) {
  const { lowerIsBetter } = OUTCOME_MEASURES[kind];
  return lowerIsBetter ? first - latest : latest - first;
}

// How far along a recovery is, as a share of the instrument's own range, for
// drawing the arc. Clamped: a patient can score worse than they started, and
// a negative arc would render as a full sweep.
export function recoveryFraction(
  kind: MeasureKind,
  first: number,
  latest: number
) {
  const { max, lowerIsBetter } = OUTCOME_MEASURES[kind];
  // The distance there was to travel, not the whole scale: improving from
  // 4/10 to 2/10 is half the available gain, not a fifth of the scale.
  const room = lowerIsBetter ? first : max - first;
  if (room <= 0) return latest === first ? 1 : 0;
  const gained = improvement(kind, first, latest);
  return Math.max(0, Math.min(1, gained / room));
}
