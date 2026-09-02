import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const PORTAL = readFileSync(join(ROOT, "lib/portal.ts"), "utf8");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/0007_patient_portal.sql"),
  "utf8"
);

// Comments explain why a thing is absent, and naming it there is not the same
// as doing it. Three tests in this project have failed on that distinction;
// this strips them so the assertion is about code.
function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type Row = Record<string, unknown> | null;
let tokenRow: Row;
let updates: { table: string; payload: unknown }[];
let selected: Record<string, Row | Row[]>;

function table(name: string) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: selected[name] ?? [], error: null }),
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    order: () => chain,
    maybeSingle: async () => ({
      data: name === "patient_portal_tokens" ? tokenRow : (selected[name] ?? null),
      error: null,
    }),
    update: (payload: unknown) => {
      updates.push({ table: name, payload });
      return { eq: async () => ({ error: null }) };
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({ from: table }),
}));

beforeEach(() => {
  tokenRow = null;
  updates = [];
  selected = {};
});

describe("the link is treated as a credential", () => {
  it("stores only a sha256 hash, never the token", () => {
    expect(PORTAL).toContain('createHash("sha256")');
    // the migration constrains the column to a hex digest
    expect(MIGRATION).toContain("token_hash");
    expect(MIGRATION).toMatch(/token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    // and nothing anywhere persists the raw token
    expect(PORTAL).not.toMatch(/insert[\s\S]{0,200}token:/);
  });

  it("mints 256 bits of entropy, so a link cannot be guessed", async () => {
    const { newPortalToken, hashToken } = await import("@/lib/portal");
    const a = newPortalToken();
    const b = newPortalToken();
    expect(a.token).not.toBe(b.token);
    // 32 bytes base64url is 43 characters
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a.token)).toBe(a.hash);
  });

  it("compares in constant time, so timing cannot leak a prefix", () => {
    expect(PORTAL).toContain("timingSafeEqual");
  });

  it("keeps the token out of search engines and referrers", () => {
    const page = readFileSync(join(ROOT, "app/portal/[token]/page.tsx"), "utf8");
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).toContain('referrer: "no-referrer"');
  });
});

describe("verifying a link", () => {
  it("refuses a token that does not exist", async () => {
    const { verifyPortalToken } = await import("@/lib/portal");
    const r = await verifyPortalToken("a".repeat(43));
    expect(r).toEqual({ ok: false, reason: "unknown" });
  });

  // A caller probing links must not be able to tell a wrong token from a
  // real-but-expired one, so anything malformed reports the same reason.
  it("refuses a malformed token without a distinct reason", async () => {
    const { verifyPortalToken } = await import("@/lib/portal");
    for (const bad of ["", "short", "x".repeat(500)]) {
      expect((await verifyPortalToken(bad)).ok).toBe(false);
      expect(await verifyPortalToken(bad)).toMatchObject({ reason: "unknown" });
    }
  });

  it("refuses a withdrawn link and says so", async () => {
    const { hashToken, verifyPortalToken } = await import("@/lib/portal");
    const token = "t".repeat(43);
    tokenRow = {
      id: "tk1",
      patient_id: "p1",
      clinic_id: "c1",
      token_hash: hashToken(token),
      revoked_at: "2026-01-01T00:00:00Z",
      expires_at: null,
    };
    expect(await verifyPortalToken(token)).toEqual({
      ok: false,
      reason: "revoked",
    });
    // and a refused link is not marked as seen
    expect(updates).toEqual([]);
  });

  it("refuses an expired link", async () => {
    const { hashToken, verifyPortalToken } = await import("@/lib/portal");
    const token = "e".repeat(43);
    tokenRow = {
      id: "tk1",
      patient_id: "p1",
      clinic_id: "c1",
      token_hash: hashToken(token),
      revoked_at: null,
      expires_at: "2020-01-01T00:00:00Z",
    };
    expect(await verifyPortalToken(token)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts a live link and resolves the patient from the token alone", async () => {
    const { hashToken, verifyPortalToken } = await import("@/lib/portal");
    const token = "g".repeat(43);
    tokenRow = {
      id: "tk9",
      patient_id: "patient-42",
      clinic_id: "clinic-7",
      token_hash: hashToken(token),
      revoked_at: null,
      expires_at: null,
    };
    const r = await verifyPortalToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.patientId).toBe("patient-42");
      expect(r.session.clinicId).toBe("clinic-7");
    }
  });

  it("records that a live link was opened, but not what was read", async () => {
    const { hashToken, verifyPortalToken } = await import("@/lib/portal");
    const token = "h".repeat(43);
    tokenRow = {
      id: "tk1",
      patient_id: "p1",
      clinic_id: "c1",
      token_hash: hashToken(token),
      revoked_at: null,
      expires_at: null,
    };
    await verifyPortalToken(token);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].payload as object)).toEqual(["last_seen_at"]);
  });
});

// The property that makes the portal safe: there is no patient id to tamper
// with, because nothing but the token ever names one.
describe("a patient cannot reach another patient", () => {
  it("exposes no function that accepts a patient id", async () => {
    // The safety property is structural: with no id to pass, there is no id
    // to tamper with. loadPortalView takes a session, and a session can only
    // come out of verifyPortalToken.
    const mod = await import("@/lib/portal");
    expect(mod.loadPortalView.length).toBe(1);
    expect(mod.verifyPortalToken.length).toBe(1);
  });

  it("reads only the tables a patient is allowed to see", () => {
    // Source-scanned, but with comments stripped first: an earlier version of
    // this test failed because the header comment *names* the tables it
    // excludes, in the sentence explaining why they are excluded.
    const code = stripComments(PORTAL);
    const tables = [...code.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set([
        "patient_portal_tokens",
        "patients",
        "clinics",
        "appointments",
        "packages",
        "patient_balances",
        "exercise_prescriptions",
        "profiles",
      ])
    );
    // and specifically never the clinical record
    expect(tables).not.toContain("soap_notes");
    expect(tables).not.toContain("outcome_measures");
  });

  it("scopes every read in loadPortalView to the resolved ids", () => {
    const code = stripComments(PORTAL);
    const body = code.slice(code.indexOf("export async function loadPortalView"));
    for (const q of body.split('.from("').slice(1)) {
      const head = q.slice(0, 320);
      expect(
        /eq\("(patient_id|id)", (patientId|clinicId)\)|in\("id", therapistIds\)/.test(
          head
        ),
        `unscoped read: ${head.slice(0, 60)}`
      ).toBe(true);
    }
  });
});

describe("the migration keeps staff roles apart", () => {
  it("lets reception issue a link but never prescribe", () => {
    const issue = MIGRATION.slice(MIGRATION.indexOf("on patient_portal_tokens"));
    expect(issue).toContain("'owner','reception','therapist'");

    const rx = MIGRATION.slice(MIGRATION.indexOf("on exercise_prescriptions for select"));
    expect(rx).toContain("'owner','therapist'");
    expect(rx.slice(0, 400)).not.toContain("reception");
  });

  it("allows no delete on either table", () => {
    expect(MIGRATION).not.toMatch(/for delete/i);
  });

  it("refuses a video url that is not http", () => {
    expect(MIGRATION).toContain("video_url ~ '^https?://'");
  });

  it("refuses a token pointing at another clinic's patient", () => {
    expect(MIGRATION).toContain("portal token patient belongs to a different clinic");
  });
});
