import type { ApptStatus } from "@/lib/types";

export type Therapist = {
  id: string;
  name: string;
  defaultSessionMinutes: number;
};

// One row of today's board, flattened server-side so the client component
// never has to join anything or know the DB shape.
export type DayRow = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  therapistName: string;
  startsAt: string;
  status: ApptStatus;
  packageId: string | null;
  price: number;
  amountOwed: number;
  noShowRate: number | null;
  packageUsed: number | null;
  packageTotal: number | null;
};
