import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activeMembership } from "@/lib/active-clinic";
import type { ClinicRole } from "@/lib/types";

const ROOT = join(import.meta.dirname, "..");

// Postgres returns `order("clinic_id")` ascending; the stub mirrors that so the
// tie-breaking behaviour under test is the real one.
function client(rows: { clinic_id: string; role: ClinicRole }[]) {
  const sorted = [...rows].sort((a, b) => a.clinic_id.localeCompare(b.clinic_id));
  let filtered = sorted;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: string) => {
      if (col === "user_id") filtered = sorted.filter(() => val === "me");
      return chain;
    },
    order: async () => ({ data: filtered, error: null }),
  };
  return { from: () => chain } as never;
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("one answer to which clinic am I looking at", () => {
  it("returns null for someone with no membership", async () => {
    expect(await activeMembership(client([]), "me")).toBeNull();
  });

  it("returns the only clinic for the ordinary single-clinic case", async () => {
    expect(await activeMembership(client([{ clinic_id: A, role: "reception" }]), "me")).toEqual({
      clinicId: A,
      role: "reception",
    });
  });

  it("prefers the clinic they own over a lower uuid they do not", async () => {
    // This is the bug: A sorts first, so the page rendered A while the owner
    // gate behind the form picked B and wrote there. Both are the caller's
    // clinics, so nothing was leaked — the form just edited the clinic that
    // was not on screen.
    const ctx = await activeMembership(
      client([
        { clinic_id: A, role: "therapist" },
        { clinic_id: B, role: "owner" },
      ]),
      "me"
    );
    expect(ctx).toEqual({ clinicId: B, role: "owner" });
  });

  it("falls back to the lowest clinic_id when they own none", async () => {
    const ctx = await activeMembership(
      client([
        { clinic_id: B, role: "accountant" },
        { clinic_id: A, role: "therapist" },
      ]),
      "me"
    );
    expect(ctx).toEqual({ clinicId: A, role: "therapist" });
  });

  it("gives the same answer whatever order the rows arrive in", async () => {
    const rows: { clinic_id: string; role: ClinicRole }[] = [
      { clinic_id: A, role: "therapist" },
      { clinic_id: B, role: "reception" },
    ];
    const forward = await activeMembership(client(rows), "me");
    const reversed = await activeMembership(client([...rows].reverse()), "me");
    expect(forward).toEqual(reversed);
  });

  it("owns exactly one owner among several, and picks it", async () => {
    const C = "33333333-3333-3333-3333-333333333333";
    const ctx = await activeMembership(
      client([
        { clinic_id: A, role: "reception" },
        { clinic_id: B, role: "therapist" },
        { clinic_id: C, role: "owner" },
      ]),
      "me"
    );
    expect(ctx?.clinicId).toBe(C);
  });
});

describe("the settings form and its actions cannot disagree", () => {
  const CONTEXT = readFileSync(join(ROOT, "lib/clinic-context.ts"), "utf8");
  const ADMIN = readFileSync(join(ROOT, "lib/supabase/admin.ts"), "utf8");

  it("both derive the clinic from the shared function", () => {
    expect(CONTEXT).toContain("activeMembership(supabase, user.id)");
    expect(ADMIN).toContain("activeMembership(supabase, user.id)");
  });

  it("neither re-implements the membership query", () => {
    // A second copy of the query is what let the two drift apart, and it drifts
    // again the moment someone adds an ordering to one and not the other.
    for (const [name, src] of [
      ["clinic-context", CONTEXT],
      ["admin", ADMIN],
    ] as const) {
      expect(src, `${name} should not query memberships directly`).not.toMatch(
        /from\("memberships"\)[\s\S]{0,200}\.eq\("user_id"/
      );
    }
  });

  it("keeps the owner gate an owner gate", () => {
    // Sharing the selection must not widen who gets through: the shared
    // function returns whatever role the caller holds there, so the gate has
    // to reject a non-owner explicitly.
    expect(ADMIN).toContain('membership.role !== "owner"');
    expect(ADMIN).toContain('reason: "not_owner"');
  });

  it("takes no clinic id from the caller", () => {
    // The property that makes the owner gate safe is unchanged: there is no
    // argument naming a clinic, so an owner of one cannot name another.
    const gate = ADMIN.slice(ADMIN.indexOf("export async function requireClinicOwner"));
    expect(gate.slice(0, gate.indexOf("{"))).not.toMatch(/clinicId/i);
  });

  it("selects through the RLS-bound client, never the service key", () => {
    const shared = readFileSync(join(ROOT, "lib/active-clinic.ts"), "utf8");
    expect(shared).toMatch(/^import "server-only";/m);
    expect(shared).not.toContain("SUPABASE_SECRET");
    expect(shared).not.toContain("adminClient");
  });
});
