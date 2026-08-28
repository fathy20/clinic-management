import type { ApptStatus } from "@/lib/types";

export type MeasureProgress = {
  kind: string;
  firstScore: number;
  latestScore: number;
  maxScore: number;
  /** signed so positive always means better, whichever way the scale runs */
  improvement: number;
  readings: number;
  lowerIsBetter: boolean;
};

export type ClinicalRow = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  therapistName: string;
  startsAt: string;
  status: ApptStatus;
  /** a note exists for THIS visit, not merely for this patient */
  writtenUp: boolean;
  noteCount: number;
  progress: MeasureProgress[];
};
