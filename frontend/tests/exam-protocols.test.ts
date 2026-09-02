import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISCIPLINES,
  RED_FLAG_PROMPTS,
  REGIONS,
  findingsToObjective,
  regionById,
  type BodyMark,
  type Finding,
} from "@/lib/exam-protocols";

const ROOT = join(import.meta.dirname, "..");
const SRC = readFileSync(join(ROOT, "lib/exam-protocols.ts"), "utf8");

// The line this product must not cross. Software that outputs a diagnosis is a
// regulated medical device, and a clinician will not trust a black box anyway.
// These assertions exist so that the line cannot be crossed by accident, one
// well-meaning commit at a time.
describe("the examination guide never diagnoses", () => {
  it("carries no probability, sensitivity or specificity in the protocol data", () => {
    // Numbers like these are how a checklist quietly becomes a diagnostic
    // instrument. Where a threshold matters, the step asks the clinician for
    // the measurement instead.
    //
    // Asserted against the DATA, not the file: the header comment names these
    // words to explain their absence, and "neural mechanosensitivity" is
    // correct physiotherapy vocabulary that a naive substring match would
    // flag. Word boundaries, so it does not.
    const banned = /\b(sensitivity|specificity|likelihood|probability|predictive value|diagnosis|diagnostic)\b/i;
    const text = REGIONS.flatMap((r) =>
      r.phases.flatMap((p) =>
        p.steps.flatMap((st) => [st.action, st.examines])
      )
    ).concat(RED_FLAG_PROMPTS.map((f) => f.prompt));

    for (const line of text) {
      expect(banned.test(line), `protocol text carries a claim: "${line}"`).toBe(
        false
      );
    }
  });

  it("keeps clinically correct vocabulary that merely looks similar", () => {
    // A guard against the previous version of the test above, which rejected
    // "neural mechanosensitivity" for containing "sensitivity".
    const all = REGIONS.flatMap((r) =>
      r.phases.flatMap((p) => p.steps.map((s) => s.examines))
    );
    expect(all.some((x) => /mechanosensitivity/i.test(x))).toBe(true);
  });

  it("describes what each step examines, never what it concludes", () => {
    for (const region of REGIONS) {
      for (const phase of region.phases) {
        for (const step of phase.steps) {
          expect(step.examines.length, `${step.id} has no 'examines'`).toBeGreaterThan(3);
          expect(step.examines.toLowerCase()).not.toMatch(
            /\b(indicates|confirms|means|suggests|rules out)\b/
          );
        }
      }
    }
  });

  it("frames red flags as prompts to consider referral", () => {
    expect(RED_FLAG_PROMPTS.length).toBeGreaterThanOrEqual(8);
    for (const f of RED_FLAG_PROMPTS) {
      expect(f.prompt).not.toMatch(/\b(cancer is|has |likely)\b/i);
    }
  });

  it("leaves traditional Chinese medicine out rather than faking it", () => {
    // TCM has its own diagnostic framework; relabelling an orthopaedic
    // assessment as TCM would look authoritative and be wrong.
    expect(DISCIPLINES.map((d) => d.id)).not.toContain("tcm");
    expect(SRC).toContain("authored by a TCM");
  });
});

describe("the protocol library is internally consistent", () => {
  it("gives every region at least one discipline and one phase", () => {
    for (const r of REGIONS) {
      expect(r.disciplines.length, `${r.id} has no discipline`).toBeGreaterThan(0);
      expect(r.phases.length, `${r.id} has no phases`).toBeGreaterThan(0);
      for (const d of r.disciplines) {
        expect(DISCIPLINES.map((x) => x.id)).toContain(d);
      }
    }
  });

  it("uses a unique step id within a region, so findings cannot collide", () => {
    for (const r of REGIONS) {
      const ids = r.phases.flatMap((p) => p.steps.map((s) => s.id));
      expect(new Set(ids).size, `${r.id} has duplicate step ids`).toBe(ids.length);
    }
  });

  it("only highlights structures the anatomy panel actually knows", () => {
    for (const r of REGIONS) {
      const known = new Set(r.structures.map((s) => s.id));
      for (const phase of r.phases) {
        for (const step of phase.steps) {
          if (step.highlight) {
            expect(
              known.has(step.highlight),
              `${r.id}/${step.id} highlights unknown structure "${step.highlight}"`
            ).toBe(true);
          }
        }
      }
    }
  });

  it("every discipline has at least one pathway", () => {
    for (const d of DISCIPLINES) {
      const mine = REGIONS.filter((r) => r.disciplines.includes(d.id));
      expect(mine.length, `${d.id} has no pathway`).toBeGreaterThan(0);
    }
  });

  it("finds a region by id and reports nothing for an unknown one", () => {
    expect(regionById("low_back")?.label).toBe("Low back");
    expect(regionById("nope")).toBeUndefined();
  });
});

describe("an examination becomes a readable note", () => {
  const findings: Finding[] = [
    { stepId: "posture", value: "increased lordosis" },
    { stepId: "flexion", value: "40" },
    { stepId: "sidebend", value: "", left: "20", right: "12" },
    { stepId: "slr", value: "55" },
  ];
  const marks: BodyMark[] = [
    { x: 0.5, y: 0.4, view: "back", kind: "pain" },
    { x: 0.4, y: 0.6, view: "back", kind: "pins" },
  ];

  it("groups findings under the phase they came from", () => {
    const out = findingsToObjective("low_back", findings, marks, []);
    expect(out).toContain("Observation:");
    expect(out).toContain("Active movement:");
    expect(out).toContain("Neurological screen:");
    // and the phase with nothing recorded is left out entirely
    expect(out).not.toContain("Palpation and specific tests:");
  });

  it("writes a side-by-side comparison as L / R", () => {
    const out = findingsToObjective("low_back", findings, marks, []);
    expect(out).toContain("L 20 / R 12");
  });

  it("leads with screening when something was flagged", () => {
    const out = findingsToObjective("low_back", findings, marks, ["rf-cauda"]);
    expect(out.startsWith("SCREENING POSITIVE")).toBe(true);
    expect(out).toContain("consider referral");
    expect(out).toContain("Saddle anaesthesia");
  });

  it("says nothing about screening when nothing was flagged", () => {
    const out = findingsToObjective("low_back", findings, marks, []);
    expect(out).not.toContain("SCREENING");
  });

  it("summarises the body chart without inventing coordinates", () => {
    const out = findingsToObjective("low_back", findings, marks, []);
    expect(out).toContain("Body chart:");
    expect(out).toContain("pain (back)");
    expect(out).toContain("pins (back)");
    expect(out).not.toContain("0.5");
  });

  it("omits an empty finding rather than writing a blank line", () => {
    const out = findingsToObjective(
      "low_back",
      [{ stepId: "posture", value: "" }],
      [],
      []
    );
    expect(out).not.toContain("Standing posture");
  });

  it("returns nothing for a region it does not know", () => {
    expect(findingsToObjective("nope", findings, marks, [])).toBe("");
  });
});
