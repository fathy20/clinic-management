/** PRD §9.2 — six staff roles. A patient is never one of these (FR-IAM-05b). */
export type StaffRole =
  | 'owner'
  | 'branch_manager'
  | 'reception'
  | 'therapist'
  | 'clinical_lead'
  | 'accountant';

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  /** clinic id — null only for platform staff, who can never reach PHI (FR-PLT-10) */
  cid: string | null;
  role: StaffRole | null;
  /** branch scope; null means every branch of the tenant (FR-IAM-09) */
  bid: string | null;
  /** platform staff flag */
  pf: boolean;
}

export interface AuthenticatedPrincipal {
  userId: string;
  clinicId: string | null;
  role: StaffRole | null;
  branchId: string | null;
  isPlatformStaff: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
