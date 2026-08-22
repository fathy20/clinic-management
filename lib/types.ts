export type ApptStatus = "booked" | "attended" | "no_show" | "cancelled";
export type ClinicRole = "owner" | "reception" | "therapist";

export type Patient = {
  id: string;
  clinic_id: string;
  name: string;
  phone: string;
  birth_date: string | null;
  consent_at: string | null;
  notes: string | null;
  created_at: string;
};

export type Package = {
  id: string;
  clinic_id: string;
  patient_id: string;
  sessions_total: number;
  sessions_used: number;
  price: number;
  expires_at: string | null;
  created_at: string;
};

export type Appointment = {
  id: string;
  clinic_id: string;
  patient_id: string;
  therapist_id: string;
  during: string; // tstzrange, e.g. ["2026-01-01 10:00:00+00","2026-01-01 10:45:00+00")
  status: ApptStatus;
  package_id: string | null;
  price: number;
  created_at: string;
};

export type Payment = {
  id: string;
  clinic_id: string;
  patient_id: string;
  package_id: string | null;
  appointment_id: string | null;
  amount: number;
  method: string;
  paid_at: string;
  taken_by: string;
  group_id: string;
};

export type Refund = {
  id: string;
  clinic_id: string;
  payment_id: string;
  amount: number;
  reason: string;
  refunded_at: string;
  taken_by: string;
};

export type Membership = {
  user_id: string;
  clinic_id: string;
  role: ClinicRole;
  default_session_minutes: number;
};

export type PatientBalance = {
  clinic_id: string;
  patient_id: string;
  amount_owed: number;
};

// One therapist's today column, assembled server-side for the reception page.
export type TherapistScheduleEntry = {
  therapist_id: string;
  therapist_name: string;
  default_session_minutes: number;
  appointments: (Appointment & {
    patient_name: string;
    patient_phone: string;
    amount_owed: number;
  })[];
};
