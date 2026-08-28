import type { ApptStatus } from "@/lib/types";

export type Therapist = {
  id: string;
  name: string;
  defaultSessionMinutes: number;
};

// Flattened server-side, including the clinic-local day the session falls on,
// so the grid never has to reason about timezones in the browser.
export type ScheduledSession = {
  id: string;
  patientId: string;
  patientName: string;
  therapistId: string;
  therapistName: string;
  startsAt: string;
  durationMinutes: number;
  dayISO: string;
  status: ApptStatus;
  hasPackage: boolean;
  price: number;
};
