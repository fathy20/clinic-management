import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/strings";

const ROOT = join(import.meta.dirname, "..");
const ACTIONS = readFileSync(join(ROOT, "app/settings/actions.ts"), "utf8");
const ADMIN = readFileSync(join(ROOT, "lib/supabase/admin.ts"), "utf8");

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let gate: unknown;
type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
let calls: Call[];
let authCalls: { method: string; arg?: unknown }[];
let rpcCalls: { fn: string; args: unknown }[];
let createUserResult: { data: unknown; error: unknown };
let ownerCount: number;
let failMembershipInsert: boolean;

function table(name: string) {
  const filters: [string, unknown][] = [];
  const call = (op: string, payload?: unknown) => {
    calls.push({ table: name, op, payload, filters });
    return chain;
  };
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: ownerCount }),
    select: (_c?: string, opts?: { head?: boolean }) => {
      calls.push({ table: name, op: "select", payload: opts, filters });
      return chain;
    },
    insert: (p: unknown) => {
      calls.push({ table: name, op: "insert", payload: p, filters });
      if (name === "memberships" && failMembershipInsert) {
        return Promise.resolve({ error: { message: "membership failed" } });
      }
      return chain;
    },
    update: (p: unknown) => call("update", p),
    upsert: (p: unknown) => call("upsert", p),
    delete: () => call("delete"),
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
  };
  return chain;
}

// The demotion goes through the caller's own session, because demote_member is
// security definer and checks my_role(), which reads auth.uid() — under the
// service key there is no authenticated user and every call would be refused.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { data: ownerCount > 1, error: null };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  requireClinicOwner: async () => gate,
  adminClient: () => ({
    from: table,
    // No rpc here on purpose: an admin-client rpc would mean the demotion was
    // being made with the service key, where auth.uid() is NULL and the
    // function's own owner check cannot run. If the action ever moves back to
    // the admin client, this mock throws rather than quietly passing.
    auth: {
      admin: {
        createUser: async (arg: unknown) => {
          authCalls.push({ method: "createUser", arg });
          return createUserResult;
        },
        deleteUser: async (arg: unknown) => {
          authCalls.push({ method: "deleteUser", arg });
          return { error: null };
        },
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  }),
}));

const OWNER = { ok: true, clinicId: "clinic-A", userId: "user-owner" };

beforeEach(() => {
  gate = OWNER;
  calls = [];
  authCalls = [];
  ownerCount = 2;
  rpcCalls = [];
  failMembershipInsert = false;
  createUserResult = { data: { user: { id: "user-new" } }, error: null };
});

// The clinic is never a parameter. That single property is what stops an owner
// of one clinic reaching another, so it is asserted structurally as well as
// behaviourally.
describe("no team action lets the caller name a clinic", () => {
  it("exports no action taking a clinicId", () => {
    expect(ACTIONS).not.toMatch(/clinicId\s*:\s*string/);
    expect(ACTIONS).not.toMatch(/input\.clinicId/);
  });

  it("starts every action with the owner gate", () => {
    const exported = ACTIONS.match(/export async function \w+/g) ?? [];
    expect(exported.length).toBeGreaterThanOrEqual(6);
    // gate() is the only way to obtain a clinicId in this module
    expect(ACTIONS).toContain("const owner = await gate()");
    expect(ACTIONS).toContain("owner.clinicId");
  });

  it("derives the clinic from the session, inside the gate", () => {
    expect(ADMIN).toContain("requireClinicOwner");
    // reads memberships through the RLS-bound client, not the admin client
    expect(ADMIN).toMatch(/requireClinicOwner[\s\S]*?await createClient\(\)/);
    // The role check is now a comparison on the shared selection rather than
    // a second membership query — see tests/one-clinic.test.ts for why the
    // query had to stop being written twice.
    expect(ADMIN).toMatch(/requireClinicOwner[\s\S]*?membership\.role !== "owner"/);
  });
});

describe("only an owner gets in", () => {
  for (const reason of ["unauthenticated", "not_owner", "unconfigured"] as const) {
    it(`refuses a caller reported as ${reason}`, async () => {
      gate = { ok: false, reason };
      const mod = await import("@/app/settings/actions");
      await expect(
        mod.addStaff({ email: "a@b.c", fullName: "A", role: "reception" })
      ).rejects.toThrow(t("onlyOwners"));
      await expect(mod.removeStaff("user-x")).rejects.toThrow(t("onlyOwners"));
      await expect(mod.listStaff()).rejects.toThrow(t("onlyOwners"));
      expect(authCalls).toEqual([]);
      expect(calls).toEqual([]);
    });
  }
});

describe("adding someone", () => {
  it("creates the login and the membership in the caller's own clinic", async () => {
    const { addStaff } = await import("@/app/settings/actions");
    const { password } = await addStaff({
      email: " NEW@Clinic.com ",
      fullName: " Hoda Mostafa ",
      role: "reception",
    });

    expect(password).toHaveLength(16);
    const created = authCalls.find((c) => c.method === "createUser")!.arg as {
      email: string;
      user_metadata: { full_name: string };
    };
    // trimmed and lowercased, so the same person cannot be added twice by case
    expect(created.email).toBe("new@clinic.com");
    expect(created.user_metadata.full_name).toBe("Hoda Mostafa");

    const membership = calls.find(
      (c) => c.table === "memberships" && c.op === "insert"
    )!.payload as { clinic_id: string; role: string };
    expect(membership.clinic_id).toBe("clinic-A");
    expect(membership.role).toBe("reception");
  });

  it("refuses a role that is not one of the four", async () => {
    const { addStaff } = await import("@/app/settings/actions");
    await expect(
      // deliberately bypassing the type to model a forged request
      addStaff({ email: "a@b.c", fullName: "A", role: "platform_admin" as never })
    ).rejects.toThrow("unknown role");
    expect(authCalls).toEqual([]);
  });

  it("says the address is taken instead of leaking the raw error", async () => {
    createUserResult = {
      data: null,
      error: { message: "A user with this email address has already been registered" },
    };
    const { addStaff } = await import("@/app/settings/actions");
    await expect(
      addStaff({ email: "a@b.c", fullName: "A", role: "reception" })
    ).rejects.toThrow(t("emailTaken"));
  });

  it("generates a password with no ambiguous characters", async () => {
    const { addStaff } = await import("@/app/settings/actions");
    const { password } = await addStaff({
      email: "a@b.c",
      fullName: "A",
      role: "therapist",
    });
    // no 0/O/1/l/I — a password read aloud across a reception desk
    expect(password).not.toMatch(/[0O1lI]/);
    expect(password).toMatch(/^[A-Za-z2-9]{16}$/);
  });

  // A login that reaches nothing is worse than no login: it also burns the
  // email address, since Supabase will refuse to create it again.
  it("deletes the auth user if the membership cannot be written", async () => {
    failMembershipInsert = true;
    const { addStaff } = await import("@/app/settings/actions");

    await expect(
      addStaff({ email: "x@y.z", fullName: "X", role: "reception" })
    ).rejects.toThrow("membership failed");

    // The login is rolled back, so the address is not burned and there is no
    // account that signs in and reaches nothing.
    expect(authCalls.map((c) => c.method)).toEqual(["createUser", "deleteUser"]);
    expect(authCalls[1].arg).toBe("user-new");
  });
});

describe("changing a role", () => {
  it("scopes a demotion to the caller's clinic and the named user", async () => {
    const { changeStaffRole } = await import("@/app/settings/actions");
    await changeStaffRole({ userId: "user-2", role: "accountant" });

    // No read-then-write: one call, with the clinic taken from the gate.
    expect(rpcCalls).toEqual([
      {
        fn: "demote_member",
        args: { p_clinic: "clinic-A", p_user: "user-2", p_role: "accountant" },
      },
    ]);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("counts owners inside the write, not in a separate query first", async () => {
    // Counting and then updating is a race: two owners demoting each other at
    // the same moment both read 2, both proceed, and the clinic is left with
    // nobody who can administer it. Only Postgres can settle that, so the
    // count has to be part of the statement that writes.
    const { changeStaffRole } = await import("@/app/settings/actions");
    await changeStaffRole({ userId: "user-2", role: "reception" });
    const countedFirst = calls.some(
      (c) => c.table === "memberships" && c.op === "select"
    );
    expect(countedFirst).toBe(false);
  });

  // A clinic with no owner cannot be administered again without SQL access.
  it("refuses to demote the last owner", async () => {
    ownerCount = 1;
    const { changeStaffRole } = await import("@/app/settings/actions");
    await expect(
      changeStaffRole({ userId: "user-owner", role: "reception" })
    ).rejects.toThrow(t("cannotDemoteLastOwner"));
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("demotes through the caller's session, not the service key", () => {
    // demote_member is security definer and re-checks my_role(). That check
    // reads auth.uid(), which is NULL under the service key — so a demotion
    // made with the admin client is refused for every caller.
    const body = ACTIONS.slice(
      ACTIONS.indexOf("export async function changeStaffRole"),
      ACTIONS.indexOf("export async function removeStaff")
    );
    expect(body).toContain('rls.rpc("demote_member"');
    expect(body).not.toMatch(/adminClient\(\)[\s\S]{0,200}rpc\(/);
  });

  it("pages the auth user list instead of stopping at the first 200", async () => {
    // A single listUsers call silently truncated: past 200 accounts, staff
    // further down showed "—" for an email with nothing to say it was missing.
    expect(ACTIONS).toMatch(/for \(let page = 1/);
    expect(ACTIONS).toContain("page,");
    expect(ACTIONS).toContain("users.length < PER_PAGE");
  });

  it("allows promoting to owner without counting", async () => {
    ownerCount = 1;
    const { changeStaffRole } = await import("@/app/settings/actions");
    await changeStaffRole({ userId: "user-2", role: "owner" });
    expect(calls.some((c) => c.op === "update")).toBe(true);
  });
});

describe("removing someone", () => {
  it("refuses to remove the caller's own access", async () => {
    const { removeStaff } = await import("@/app/settings/actions");
    await expect(removeStaff("user-owner")).rejects.toThrow(t("cannotRemoveSelf"));
    expect(calls).toEqual([]);
  });

  // Deleting the auth user would orphan payments.taken_by, so the financial
  // record would stop resolving to a name.
  it("deletes the membership only, never the login", async () => {
    const { removeStaff } = await import("@/app/settings/actions");
    await removeStaff("user-2");

    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe("memberships");
    expect(del.filters).toEqual([
      ["clinic_id", "clinic-A"],
      ["user_id", "user-2"],
    ]);
    expect(authCalls.some((c) => c.method === "deleteUser")).toBe(false);
  });
});

describe("clinic settings", () => {
  it("rejects a currency that is not a three-letter code", async () => {
    const { updateClinic } = await import("@/app/settings/actions");
    for (const currency of ["EG", "EGPP", "12", ""]) {
      await expect(
        updateClinic({
          name: "N",
          currency,
          timezone: "Africa/Cairo",
          taxRatePercent: 0,
          taxLabel: "",
        })
      ).rejects.toThrow("3-letter");
    }
  });

  // An unknown zone would silently shift every appointment on the schedule.
  it("validates the time zone against the runtime's own database", async () => {
    const { updateClinic } = await import("@/app/settings/actions");
    await expect(
      updateClinic({
        name: "N",
        currency: "EGP",
        timezone: "Mars/Olympus",
        taxRatePercent: 0,
        taxLabel: "",
      })
    ).rejects.toThrow("unknown time zone");
  });

  it("stores the tax rate as a fraction while the form talks percent", async () => {
    const { updateClinic } = await import("@/app/settings/actions");
    await updateClinic({
      name: "Nile Physio",
      currency: "sar",
      timezone: "Asia/Riyadh",
      taxRatePercent: 15,
      taxLabel: "VAT",
    });
    const update = calls.find((c) => c.table === "clinics")!.payload as {
      tax_rate: number;
      currency: string;
    };
    expect(update.tax_rate).toBe(0.15);
    expect(update.currency).toBe("SAR");
  });

  it("refuses a tax rate outside 0-100", async () => {
    const { updateClinic } = await import("@/app/settings/actions");
    for (const pct of [-1, 101]) {
      await expect(
        updateClinic({
          name: "N",
          currency: "EGP",
          timezone: "Africa/Cairo",
          taxRatePercent: pct,
          taxLabel: "",
        })
      ).rejects.toThrow("between 0 and 100");
    }
  });

  it("scopes the update to the caller's clinic", async () => {
    const { updateClinic } = await import("@/app/settings/actions");
    await updateClinic({
      name: "N",
      currency: "EGP",
      timezone: "Africa/Cairo",
      taxRatePercent: 0,
      taxLabel: "",
    });
    expect(calls.find((c) => c.table === "clinics")!.filters).toEqual([
      ["id", "clinic-A"],
    ]);
  });
});

describe("the secret key stays where it belongs", () => {
  it("settings actions never read the key directly", () => {
    expect(ACTIONS).not.toContain("SUPABASE_SECRET_KEY");
    expect(ACTIONS).not.toContain("createSupabaseClient");
  });

  it("the owner gate is separate from the platform-admin gate", () => {
    // Reusing requirePlatformAdmin would grant a clinic owner cross-tenant
    // reach; these are deliberately two different doors.
    expect(ACTIONS).not.toContain("requirePlatformAdmin");
    expect(ADMIN).toContain("export async function requirePlatformAdmin");
    expect(ADMIN).toContain("export async function requireClinicOwner");
  });
});
