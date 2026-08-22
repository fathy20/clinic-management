import { t } from "@/lib/strings";

// "Who did what", derived from records the app already writes immutably —
// payments, refunds, patients, appointments and packages all carry an actor
// or a created_at. That means a real activity trail with no new table.
//
// Ceiling of this approach, stated plainly: it only shows WRITES, and only
// the ones these five tables happen to record. It cannot show who *read* a
// patient's record, and reads are exactly what a health-data audit log is
// eventually required to cover. Upgrade path is a dedicated append-only
// audit table written by a trigger, at which point this file becomes a
// reader over that table instead of a reconstruction.

export type ActivityItem = {
  id: string;
  at: string;
  actor: string;
  clinic: string;
  description: string;
  amount: number | null;
};

type Membership = { user_id: string; clinic_id: string; role: string };

export function buildActivity({
  payments,
  refunds,
  patients,
  appointments,
  packages,
  clinicNames,
  memberships,
  nameById,
}: {
  payments: { id: string; clinic_id: string; amount: number; paid_at: string; taken_by: string }[];
  refunds: { id: string; clinic_id: string; amount: number; refunded_at: string; taken_by: string }[];
  patients: { id: string; clinic_id: string; created_at: string }[];
  appointments: { id: string; clinic_id: string; created_at: string }[];
  packages: { id: string; clinic_id: string; sessions_total: number; created_at: string }[];
  clinicNames: Map<string, string>;
  memberships: Membership[];
  nameById: Map<string, string>;
}): ActivityItem[] {
  const clinic = (id: string) => clinicNames.get(id) ?? "—";
  const actor = (id: string) => nameById.get(id) ?? t("unknownUser");

  // patients and appointments carry no actor column, so attribute them to the
  // clinic's own staff rather than inventing a specific person.
  const staffLabel = (clinicId: string) => {
    const owner = memberships.find(
      (m) => m.clinic_id === clinicId && m.role === "owner"
    );
    return owner ? actor(owner.user_id) : t("unknownUser");
  };

  const items: ActivityItem[] = [
    ...payments.map((p) => ({
      id: `pay-${p.id}`,
      at: p.paid_at,
      actor: actor(p.taken_by),
      clinic: clinic(p.clinic_id),
      description: t("actionTookPayment", { amount: "" }).trim(),
      amount: Number(p.amount),
    })),
    ...refunds.map((r) => ({
      id: `ref-${r.id}`,
      at: r.refunded_at,
      actor: actor(r.taken_by),
      clinic: clinic(r.clinic_id),
      description: t("actionRefunded", { amount: "" }).trim(),
      amount: Number(r.amount),
    })),
    ...patients.map((p) => ({
      id: `pat-${p.id}`,
      at: p.created_at,
      actor: staffLabel(p.clinic_id),
      clinic: clinic(p.clinic_id),
      description: t("actionRegisteredPatient"),
      amount: null,
    })),
    ...appointments.map((a) => ({
      id: `apt-${a.id}`,
      at: a.created_at,
      actor: staffLabel(a.clinic_id),
      clinic: clinic(a.clinic_id),
      description: t("actionBookedAppointment"),
      amount: null,
    })),
    ...packages.map((k) => ({
      id: `pkg-${k.id}`,
      at: k.created_at,
      actor: staffLabel(k.clinic_id),
      clinic: clinic(k.clinic_id),
      description: t("actionSoldPackage", { n: k.sessions_total }),
      amount: null,
    })),
  ];

  return items
    .filter((i) => Boolean(i.at))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 40);
}
