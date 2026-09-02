import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/0010_consent_and_access_log.sql"),
  "utf8"
);
const AUDIT = readFileSync(join(ROOT, "lib/audit.ts"), "utf8");
const ACTIONS = readFileSync(join(ROOT, "app/patients/consent-actions.ts"), "utf8");
const PANEL = readFileSync(join(ROOT, "app/patients/[id]/ConsentPanel.tsx"), "utf8");
const PORTAL = readFileSync(join(ROOT, "lib/portal.ts"), "utf8");

// A comment explaining why something is absent NAMES the absent thing. This
// project has now had four tests fail on that distinction — including the first
// version of the assertion below, which tripped on the migration's own comment
// "No name, no phone, no diagnosis". Strip them, so the assertion is about the
// columns rather than the prose about the columns.
function stripSqlComments(sql: string) {
  return sql.replace(/--.*$/gm, "");
}

// Egypt's PDPL wants explicit, purpose-specific consent for health data, and
// accountability for processing — which includes reads. The behavioural
// properties (immutability, withdrawal that sticks, an append-only log the owner
// cannot prune) are proved against a real Postgres in the embedded-postgres
// harness. These are the structural rules a later edit could remove silently.

describe("consent is per purpose, not a single tick", () => {
  it("names the purposes as an enum rather than free text", () => {
    // Free text cannot answer "may we message this patient", which is the
    // question the code has to ask before it sends anything.
    for (const purpose of [
      "treatment",
      "records_storage",
      "whatsapp_messaging",
      "insurance_disclosure",
    ]) {
      expect(MIGRATION).toContain(`'${purpose}'`);
    }
    expect(MIGRATION).toContain("create type consent_purpose as enum");
  });

  it("records how consent was given, not just that it was", () => {
    expect(MIGRATION).toContain("create type consent_method as enum");
    for (const m of ["in_person_signature", "portal", "verbal_witnessed"]) {
      expect(MIGRATION).toContain(`'${m}'`);
    }
  });

  it("stores the wording the patient actually saw", () => {
    // Consent is only informed if the wording is recoverable afterwards. A
    // version number pointing at a document that may have changed is not.
    expect(MIGRATION).toMatch(/wording\s+text not null check \(length\(trim\(wording\)\) > 0\)/);
  });

  it("leaves patients.consent_at alone", () => {
    // It is the record that treatment consent was taken at registration and it
    // is referenced by screens already. Rewriting live history to fit a new
    // model would destroy the evidence it holds.
    expect(MIGRATION).not.toMatch(/alter table patients[\s\S]{0,80}consent_at/);
    expect(MIGRATION).not.toMatch(/drop column consent_at/);
  });

  it("answers the question in the database, so the screen cannot disagree", () => {
    expect(MIGRATION).toContain("create or replace function has_consent");
    // Newest row per purpose wins, and it must default to false rather than
    // null — an unanswered question is not consent.
    expect(MIGRATION).toContain("order by c.granted_at desc");
    expect(MIGRATION).toMatch(/coalesce\([\s\S]{0,240}false\s*\)/);
  });

  it("resolves has_consent as invoker, so it cannot answer about another clinic", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("function has_consent"));
    expect(fn.slice(0, 400)).toContain("security invoker");
  });

  it("keeps the till out of the clinical relationship", () => {
    const read = MIGRATION.slice(MIGRATION.indexOf("create policy consents_read"));
    expect(read.slice(0, 250)).toContain("'owner','reception','therapist'");
    expect(read.slice(0, 250)).not.toContain("accountant");
    expect(ACTIONS).toContain('const CONSENT_ROLES = ["owner", "reception", "therapist"]');
  });
});

describe("a recorded consent is evidence", () => {
  it("permits update only for withdrawal, and no delete at all", () => {
    const cmds = [...MIGRATION.matchAll(/create policy (\w+) on consents for (\w+)/g)].map(
      (m) => m[2]
    );
    expect(new Set(cmds)).toEqual(new Set(["select", "insert", "update"]));
    expect(MIGRATION).not.toMatch(/create policy \w+ on consents for delete/);
  });

  it("makes every column but the withdrawal pair immutable", () => {
    // The update policy that exists for withdrawal would otherwise also allow
    // rewriting the wording, which is the one field whose whole value is that
    // it cannot change after the fact.
    const guard = MIGRATION.slice(MIGRATION.indexOf("function consent_write_guard"));
    for (const col of ["wording", "purpose", "granted_at", "granted_by", "method"]) {
      expect(guard).toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
    expect(guard).toContain("cannot be altered, only withdrawn");
  });

  it("refuses to un-withdraw", () => {
    expect(MIGRATION).toContain("already withdrawn");
  });

  it("requires a withdrawal to name who actioned it", () => {
    expect(MIGRATION).toContain("a withdrawal must record who actioned it");
  });

  it("cannot be attributed to a colleague", () => {
    const insert = MIGRATION.slice(MIGRATION.indexOf("create policy consents_record"));
    expect(insert.slice(0, 300)).toContain("granted_by = auth.uid()");
  });

  it("takes granted_by from the session, never from the caller", () => {
    expect(ACTIONS).toContain("granted_by: ctx.userId");
    expect(ACTIONS).not.toMatch(/granted_by:\s*input\./);
  });

  it("takes no clinic id from the caller", () => {
    expect(ACTIONS).not.toMatch(/clinicId[?]?:\s*string/);
    expect(ACTIONS).toContain("ctx.clinicId");
  });

  it("withdraws only a live consent, so a race loses instead of rewriting", () => {
    expect(ACTIONS).toContain('.is("withdrawn_at", null)');
  });
});

describe("who read what", () => {
  it("logs the patient uuid and nothing else", () => {
    // CLAUDE.md: "No PHI in logs. Log the patient UUID, nothing else." An audit
    // log that quotes the record it protects is a second copy of the thing that
    // needed protecting.
    const table = stripSqlComments(
      MIGRATION.slice(
        MIGRATION.indexOf("create table phi_access_log"),
        MIGRATION.indexOf("create index phi_access_by_patient")
      )
    );
    for (const banned of ["name", "phone", "note", "diagnos", "amount", "email"]) {
      expect(table.toLowerCase(), `phi_access_log must not store ${banned}`).not.toContain(
        banned
      );
    }
  });

  it("is append-only, and the owner cannot prune it either", () => {
    const cmds = [...MIGRATION.matchAll(/create policy \w+ on phi_access_log for (\w+)/g)].map(
      (m) => m[1]
    );
    expect(new Set(cmds)).toEqual(new Set(["select", "insert"]));
  });

  it("shows the log to the owner only", () => {
    const read = MIGRATION.slice(MIGRATION.indexOf("create policy phi_access_read"));
    expect(read.slice(0, 200)).toContain("my_role(clinic_id) = 'owner'");
  });

  it("stops staff logging a read as though a colleague did it", () => {
    const write = MIGRATION.slice(MIGRATION.indexOf("create policy phi_access_write"));
    expect(write.slice(0, 200)).toContain("actor = auth.uid()");
  });

  it("gives the portal a writer that cannot forge a staff read", () => {
    // The portal has no logged-in user, so it cannot satisfy actor = auth.uid().
    // Its writer takes no actor argument at all and always records null.
    const fn = MIGRATION.slice(MIGRATION.indexOf("function log_portal_access"));
    expect(fn.slice(0, 120)).toMatch(/log_portal_access\(p_patient uuid, p_clinic uuid\)/);
    expect(fn).toContain("null, p_patient, 'patient_portal'");
    expect(fn).toContain("security definer");
    // and it verifies the pairing rather than trusting it
    expect(fn).toContain("is distinct from p_clinic");
  });

  it("does not leave the portal writer callable by PUBLIC", () => {
    expect(MIGRATION).toContain("revoke all on function log_portal_access(uuid, uuid) from public");
  });
});

describe("logging never takes a clinical screen down", () => {
  it("swallows its own errors", () => {
    expect(AUDIT).toMatch(/} catch \{/);
    expect(AUDIT).toContain("Deliberately silent");
  });

  it("stays quiet about an unapplied migration", () => {
    // 0010 may not be deployed. That is a deployment state, not an error worth
    // a server-log line on every page view.
    expect(AUDIT).toContain("isMissingObject(error)");
  });

  it("puts no patient id in the console line about logging", () => {
    const logLine = AUDIT.slice(AUDIT.indexOf("console.error"), AUDIT.indexOf("console.error") + 200);
    expect(logLine).not.toContain("patientId");
    expect(logLine).not.toContain("patient_id");
  });

  it("takes no actor argument that could be forged", () => {
    // userId is required, but the row is written through the caller's own
    // session and the policy requires actor = auth.uid() — so a wrong value is
    // rejected by the database rather than trusted.
    expect(AUDIT).toContain("actor: input.userId");
    expect(AUDIT).toContain('from "./supabase/server"');
    expect(AUDIT).not.toContain("adminClient");
  });

  it("is server-only", () => {
    expect(AUDIT).toMatch(/^import "server-only";/m);
  });

  it("de-duplicates, so one screen listing a patient twice writes one line", () => {
    expect(AUDIT).toContain("new Set(input.patientIds)");
  });
});

describe("every surface that shows health data logs the read", () => {
  const surfaces: [string, string][] = [
    ["app/patients/[id]/page.tsx", "patient_record"],
    ["app/clinical/page.tsx", "clinical_day"],
    ["app/clinical/exam/page.tsx", "examination"],
    ["app/receipts/[id]/page.tsx", "receipt"],
  ];

  it("records an access on each one", () => {
    for (const [file, surface] of surfaces) {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src, `${file} does not log a read`).toContain("recordPhiAccess");
      expect(src, `${file} logs the wrong surface`).toContain(`surface: "${surface}"`);
    }
  });

  it("logs the portal read too, through the function that cannot forge one", () => {
    // The patient reading their own record is still a read of health data, and
    // the PDPL does not exempt it.
    expect(PORTAL).toContain('rpc("log_portal_access"');
  });

  it("never awaits the log in a way that could fail the render", () => {
    for (const [file] of surfaces) {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src, `${file} awaits the audit write`).not.toMatch(/await recordPhiAccess/);
      expect(src).toContain("void recordPhiAccess");
    }
  });
});

describe("the panel and the database agree on what counts as consent", () => {
  it("treats the newest row per purpose as the answer, like has_consent does", () => {
    expect(PANEL).toContain("if (!current.has(c.purpose)) current.set(c.purpose, c)");
  });

  it("shows a withdrawn purpose as withdrawn, not as consented", () => {
    expect(PANEL).toContain("const given = row && !row.withdrawnOn;");
  });

  it("asks all four questions rather than one", () => {
    for (const purpose of [
      "treatment",
      "records_storage",
      "whatsapp_messaging",
      "insurance_disclosure",
    ]) {
      expect(PANEL).toContain(`"${purpose}"`);
    }
  });
});
