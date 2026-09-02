import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/strings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// A single duck-typed chain object serves both as an intermediate link
// (.eq().limit()...) and as the terminal awaited value (.then(...)), since
// JS only invokes .then when something actually awaits/thens the object —
// plain chaining calls just read the other methods off it and never trigger it.
function makeFakeSupabase(config: {
  errors?: Record<string, { code?: string; message: string }>;
  data?: Record<string, unknown[]>;
} = {}) {
  const calls: { table: string; op: string; args?: unknown[] }[] = [];

  function tableApi(table: string) {
    const resolved = {
      error: config.errors?.[table] ?? null,
      data: config.data?.[table] ?? [],
    };
    const chain: Record<string, unknown> = {
      then: (resolve: (v: typeof resolved) => void) => resolve(resolved),
      insert(data: unknown) {
        calls.push({ table, op: "insert", args: [data] });
        return {
          ...chain,
          select: () => ({
            single: async () => ({ data: { id: "new-id" }, error: null }),
          }),
        };
      },
      update(data: unknown) {
        calls.push({ table, op: "update", args: [data] });
        return chain;
      },
      eq(col: string, val: unknown) {
        calls.push({ table, op: "eq", args: [col, val] });
        return chain;
      },
      ilike(col: string, pattern: string) {
        calls.push({ table, op: "ilike", args: [col, pattern] });
        return chain;
      },
      select() {
        return chain;
      },
      limit() {
        return chain;
      },
      order() {
        return chain;
      },
    };
    return chain;
  }

  return {
    calls,
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-0000-0000-000000000001" } },
        error: null,
      }),
    },
    from(table: string) {
      return tableApi(table);
    },
  };
}

let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase,
}));

describe("takePayment appointment_id linkage", () => {
  beforeEach(() => {
    fakeSupabase = makeFakeSupabase();
  });

  it("drops appointment_id when a package is selected — leaking_sessions only matches plain sessions", async () => {
    const { takePayment } = await import("@/app/reception/actions");
    await takePayment({
      clinicId: "clinic-1",
      patientId: "patient-1",
      packageId: "package-1",
      appointmentId: "appt-1",
      rows: [{ method: "cash", amount: 100 }],
    });

    const insertCall = fakeSupabase.calls.find((c) => c.op === "insert");
    const rows = insertCall!.args![0] as { appointment_id: string | null }[];
    expect(rows[0].appointment_id).toBeNull();
  });

  it("keeps appointment_id when no package is selected", async () => {
    const { takePayment } = await import("@/app/reception/actions");
    await takePayment({
      clinicId: "clinic-1",
      patientId: "patient-1",
      appointmentId: "appt-1",
      rows: [{ method: "cash", amount: 100 }],
    });

    const insertCall = fakeSupabase.calls.find((c) => c.op === "insert");
    const rows = insertCall!.args![0] as { appointment_id: string | null }[];
    expect(rows[0].appointment_id).toBe("appt-1");
  });
});

describe("addWalkIn surfaces the double-booking error in the user's language", () => {
  beforeEach(() => {
    fakeSupabase = makeFakeSupabase({
      errors: { appointments: { code: "23P01", message: "exclusion_violation" } },
    });
  });

  // Asserted against the string table, not a literal, so this keeps working
  // when the UI locale changes.
  it("maps Postgres's exclusion_violation to the friendly message, not the raw error", async () => {
    const { addWalkIn } = await import("@/app/reception/actions");
    await expect(
      addWalkIn({
        clinicId: "clinic-1",
        therapistId: "therapist-1",
        patientId: "patient-1",
        durationMinutes: 45,
      })
    ).rejects.toThrow(t("therapistBusy"));
  });
});

describe("searchPatients escapes ilike wildcards in user input", () => {
  beforeEach(() => {
    fakeSupabase = makeFakeSupabase();
  });

  it("escapes % and _ so they're treated as literal characters, not wildcards", async () => {
    const { searchPatients } = await import("@/app/reception/actions");
    await searchPatients("clinic-1", "50%_off");

    const ilikeCall = fakeSupabase.calls.find((c) => c.op === "ilike");
    expect(ilikeCall!.args![1]).toBe("%50\\%\\_off%");
  });

  it("routes all-digit queries to the phone column, not name", async () => {
    const { searchPatients } = await import("@/app/reception/actions");
    await searchPatients("clinic-1", "0100");

    const ilikeCall = fakeSupabase.calls.find((c) => c.op === "ilike");
    expect(ilikeCall!.args![0]).toBe("phone");
  });
});
