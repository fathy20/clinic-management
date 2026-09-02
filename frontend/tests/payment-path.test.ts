import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Records every (table, operation) the action touches, without a live DB.
// The invariant we're proving: attendance never writes to payments/packages —
// the debt indicator (patient_balances, a DB view) is what catches an
// attended-but-unpaid session, not application logic.
function makeFakeSupabase() {
  const calls: { table: string; op: string }[] = [];

  function tableApi(table: string) {
    const chain = {
      update(_data: unknown) {
        calls.push({ table, op: "update" });
        return chain;
      },
      insert(_data: unknown) {
        calls.push({ table, op: "insert" });
        return {
          ...chain,
          select: () => ({
            single: async () => ({ data: { id: "new-id" }, error: null }),
          }),
        };
      },
      eq(_col: string, _val: unknown) {
        return Promise.resolve({ error: null });
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

describe("attendance never touches money tables", () => {
  beforeEach(() => {
    fakeSupabase = makeFakeSupabase();
  });

  it("markAttended only updates appointments", async () => {
    const { markAttended } = await import("@/app/reception/actions");
    await markAttended("appt-1");

    expect(fakeSupabase.calls).toEqual([{ table: "appointments", op: "update" }]);
    expect(fakeSupabase.calls.some((c) => c.table === "payments")).toBe(false);
    expect(fakeSupabase.calls.some((c) => c.table === "packages")).toBe(false);
  });

  it("markNoShow only updates appointments", async () => {
    const { markNoShow } = await import("@/app/reception/actions");
    await markNoShow("appt-1");

    expect(fakeSupabase.calls).toEqual([{ table: "appointments", op: "update" }]);
  });

  it("takePayment writes to payments, never to appointments", async () => {
    const { takePayment } = await import("@/app/reception/actions");
    await takePayment({
      clinicId: "clinic-1",
      patientId: "patient-1",
      rows: [{ method: "cash", amount: 100 }],
    });

    expect(fakeSupabase.calls).toEqual([{ table: "payments", op: "insert" }]);
  });

  it("issueRefund writes to refunds, never adjusts the original payment", async () => {
    const { issueRefund } = await import("@/app/reception/actions");
    await issueRefund({
      paymentId: "payment-1",
      amount: 50,
      reason: "test",
    });

    expect(fakeSupabase.calls).toEqual([{ table: "refunds", op: "insert" }]);
  });
});
