// One flat string table. English is the default; Arabic is kept as a real
// locale rather than deleted, so switching back is a constant change and not
// a rewrite. No i18n library — this is ~150 lines and a library would be
// more code than the thing it replaces.
//
// Locale comes from the environment rather than a hardcoded constant, so
// flipping the whole UI to Arabic is a deploy setting and not a code change.
// NEXT_PUBLIC_ because client components render strings too — a locale is
// not a secret. When per-clinic locale lands, read it from the clinic row
// and thread it through instead.
const RAW = process.env.NEXT_PUBLIC_LOCALE;
export const LOCALE: "en" | "ar" = RAW === "ar" ? "ar" : "en";

export const DIR = LOCALE === "ar" ? "rtl" : "ltr";
export const HTML_LANG = LOCALE;

const en = {
  appName: "Clinic OS",
  appTagline: "Physiotherapy clinic management",

  // auth
  signInTitle: "Clinic OS",
  signInSubtitle: "Sign in to see your clinic's day",
  email: "Email",
  password: "Password",
  signIn: "Sign in",
  badCredentials: "That email and password don't match",
  signOut: "Sign out",

  // shell
  receptionDay: "Reception",
  searchTheDay: "Search the day",
  liveUpdating: "Live",
  darkMode: "Dark mode",
  lightMode: "Light mode",
  notInAnyClinic:
    "This account isn't linked to a clinic yet. Ask the owner to add you.",
  mustSignIn: "You need to sign in first.",

  // roles
  roleOwner: "Owner",
  roleReception: "Reception",
  roleTherapist: "Therapist",
  roleAccountant: "Accountant",
  rolePlatformAdmin: "Platform admin",

  // summary strip
  waiting: "Waiting",
  ofAppointmentsToday: "of {n} today",
  finished: "Finished",
  noShows: "no-shows",
  owedByPatients: "Owed by patients",
  acrossNPatients: "across {n} patients",

  // bands
  bandWaiting: "Waiting",
  bandDone: "Done",
  queueEmpty: "Nobody waiting — the queue is clear",
  noSearchResults: "No one matches that search",
  nobodyFinishedYet: "Nobody has finished yet today",
  filterPlaceholder: "Filter by name or phone",
  addWalkIn: "+ Walk-in",

  // row
  arrived: "Arrived",
  noShow: "No-show",
  didNotAttend: "No-show",
  takePayment: "Take payment",
  refund: "Refund",
  onTime: "On time",
  waitingMinutes: "waiting {n}m",
  dueInMinutes: "in {n}m",
  owesAmount: "owes {amount}",
  missesRate: "misses {n}% of appointments",

  // payment sheet
  paymentTitle: "Take payment",
  due: "due",
  packageOptional: "Package (optional)",
  noPackageSingleSession: "No package — single session",
  packageOf: "Package of {n}",
  sessionsLeft: "{n} left",
  paymentGoesToPackage:
    "This goes against the package, not today's session.",
  method: "Method",
  amount: "Amount",
  cash: "Cash",
  card: "Card",
  wallet: "Mobile wallet",
  addAnotherMethod: "+ Split across another method",
  removeMethod: "Remove this method",
  total: "Total",
  cancel: "Cancel",
  take: "Take",
  enterAnAmount: "Enter an amount above zero",

  // refund sheet
  refundTitle: "Refund",
  payment: "Payment",
  refundAmount: "Amount to refund",
  reason: "Reason",
  reasonPlaceholder: "e.g. session cancelled after payment",
  refundIt: "Refund",
  noPaymentsYet: "No payments recorded for this patient",
  maxRefundableBefore: "At most",
  maxRefundableAfter:
    ". The database itself rejects a refund larger than the payment.",
  pickAPayment: "Pick the payment to refund",
  amountAboveZero: "The amount must be above zero",
  reasonRequired: "Write a reason — it goes on the record",

  // walk-in sheet
  walkInTitle: "Walk-in",
  walkInSubtitle: "Booked from right now",
  existingPatient: "Existing patient?",
  searchByNameOrPhone: "Search by name or phone",
  orNewPatient: "Or a new patient",
  name: "Name",
  phone: "Phone",
  change: "Change",
  consentLabel:
    "The patient consents to their health data being processed. Required by law — health data is sensitive under Egypt's Law 151/2020.",
  therapist: "Therapist",
  noTherapists: "No therapists yet",
  sessionMinutes: "Session length (minutes)",
  underPackage: "Under a package?",
  noSingleSession: "No — single session",
  addToQueue: "Add to queue",
  pickPatientOrEnterNew:
    "Pick an existing patient, or enter a name and phone",
  consentRequired: "The patient must consent to their health data being processed",
  pickTherapist: "Pick a therapist",
  durationAboveZero: "Session length must be above zero",
  therapistBusy: "That therapist is already booked at this time",

  // money rail
  leakingTitle: "Money left on the table",
  leakingSubtitle: "Sessions delivered that nobody paid for",
  nothingLeaking: "Every session is paid for.",
  sessionOn: "Session {date}",
  totalOwed: "Total owed",
  stalePackagesTitle: "Stalled packages",
  stalePackagesSubtitle:
    "Paid for, sessions not being used — the earliest sign a patient is drifting away",
  lastSessionOn: "Last session {date} · {n} left",
  notStartedYet: "not started",

  // platform admin
  adminTitle: "Platform",
  adminSubtitle: "Every clinic on this deployment",
  adminForbidden:
    "This account isn't a platform admin. Nothing here is available to it.",
  adminNotConfigured:
    "No platform admins are configured. Set PLATFORM_ADMIN_EMAILS in the server environment.",
  clinics: "Clinics",
  staff: "Staff",
  patients: "Patients",
  appointments: "Appointments",
  collected: "Collected",
  outstanding: "Outstanding",
  refunded: "Refunded",
  clinicName: "Clinic",
  activity: "Who did what",
  activitySubtitle: "Newest first, across every clinic",
  noActivity: "Nothing has happened yet",
  actionTookPayment: "took a payment of {amount}",
  actionRefunded: "refunded {amount}",
  actionRegisteredPatient: "registered a patient",
  actionBookedAppointment: "booked an appointment",
  actionSoldPackage: "sold a package of {n} sessions",
  phiNotice:
    "Patient names and clinical notes are deliberately not shown here. A platform admin sees how the business is running, not who is being treated for what — see DESIGN.md and SPEC.md for why.",
  backToClinic: "Back to the clinic",
  unknownUser: "unknown",
  noClinics: "No clinics yet",
} as const;

type Key = keyof typeof en;

const ar: Record<Key, string> = {
  appName: "Clinic OS",
  appTagline: "إدارة عيادات العلاج الطبيعي",

  signInTitle: "Clinic OS",
  signInSubtitle: "سجّل دخولك تشوف يوم العيادة",
  email: "البريد الإلكتروني",
  password: "كلمة السر",
  signIn: "دخول",
  badCredentials: "الإيميل أو كلمة السر غلط",
  signOut: "خروج",

  receptionDay: "الاستقبال",
  searchTheDay: "ابحث في اليوم",
  liveUpdating: "مباشر",
  darkMode: "الوضع الليلي",
  lightMode: "الوضع النهاري",
  notInAnyClinic: "الحساب ده مش مربوط بأي عيادة بعد. كلّم صاحب العيادة يضيفك.",
  mustSignIn: "لازم تسجل الدخول أولاً.",

  roleOwner: "المالك",
  roleReception: "استقبال",
  roleTherapist: "أخصائي",
  roleAccountant: "محاسب",
  rolePlatformAdmin: "أدمن المنصة",

  waiting: "في الانتظار",
  ofAppointmentsToday: "من {n} موعد النهاردة",
  finished: "خلصوا",
  noShows: "غابوا",
  owedByPatients: "مستحق على المرضى",
  acrossNPatients: "على {n} مرضى",

  bandWaiting: "في الانتظار",
  bandDone: "خلصوا",
  queueEmpty: "مفيش حد مستني — الطابور فاضي",
  noSearchResults: "مفيش نتيجة للبحث ده",
  nobodyFinishedYet: "لسه محدش خلص النهاردة",
  filterPlaceholder: "فلتر بالاسم أو التليفون",
  addWalkIn: "+ حالة مفاجئة",

  arrived: "وصل",
  noShow: "غاب",
  didNotAttend: "غاب",
  takePayment: "اقبض",
  refund: "استرجاع",
  onTime: "في الميعاد",
  waitingMinutes: "مستني {n}د",
  dueInMinutes: "بعد {n}د",
  owesAmount: "عليه {amount}",
  missesRate: "يغيب {n}٪ من مواعيده",

  paymentTitle: "قبض فلوس",
  due: "مستحق",
  packageOptional: "الباقة (اختياري)",
  noPackageSingleSession: "بدون باقة — جلسة فردية",
  packageOf: "باقة {n} جلسة",
  sessionsLeft: "فاضل {n}",
  paymentGoesToPackage: "الدفعة هتتحسب على الباقة، مش على جلسة النهاردة.",
  method: "وسيلة الدفع",
  amount: "المبلغ",
  cash: "كاش",
  card: "بطاقة",
  wallet: "محفظة إلكترونية",
  addAnotherMethod: "+ وسيلة دفع تانية (تقسيم المبلغ)",
  removeMethod: "شيل وسيلة الدفع دي",
  total: "الإجمالي",
  cancel: "إلغاء",
  take: "اقبض",
  enterAnAmount: "اكتب مبلغ أكبر من صفر",

  refundTitle: "استرجاع فلوس",
  payment: "الدفعة",
  refundAmount: "المبلغ المسترجع",
  reason: "السبب",
  reasonPlaceholder: "مثلاً: إلغاء جلسة بعد الدفع",
  refundIt: "ارجع الفلوس",
  noPaymentsYet: "مفيش دفعات مسجلة للمريض ده",
  maxRefundableBefore: "أقصى مبلغ",
  maxRefundableAfter: " — الداتابيز نفسها بترفض أي استرجاع أكبر من الدفعة.",
  pickAPayment: "اختار الدفعة المطلوب استرجاعها",
  amountAboveZero: "المبلغ لازم يكون أكبر من صفر",
  reasonRequired: "اكتب سبب الاسترجاع — بيتسجّل في الدفاتر",

  walkInTitle: "حالة مفاجئة",
  walkInSubtitle: "بتتحجز من الوقت الحالي",
  existingPatient: "مريض موجود؟",
  searchByNameOrPhone: "ابحث بالاسم أو رقم التليفون",
  orNewPatient: "أو مريض جديد",
  name: "الاسم",
  phone: "رقم التليفون",
  change: "غيّر",
  consentLabel:
    "المريض موافق على معالجة بياناته الصحية. مطلوب قانونًا — البيانات الصحية بيانات حساسة تحت قانون ١٥١ لسنة ٢٠٢٠.",
  therapist: "الأخصائي",
  noTherapists: "مفيش أخصائيين",
  sessionMinutes: "مدة الجلسة (دقيقة)",
  underPackage: "تحت باقة؟",
  noSingleSession: "لأ — جلسة فردية",
  addToQueue: "ضيفه للطابور",
  pickPatientOrEnterNew: "اختار مريض موجود أو اكتب اسم ورقم مريض جديد",
  consentRequired: "لازم موافقة المريض على معالجة بياناته الصحية",
  pickTherapist: "اختار أخصائي",
  durationAboveZero: "مدة الجلسة لازم تكون أكبر من صفر",
  therapistBusy: "الأخصائي محجوز في الوقت ده",

  leakingTitle: "فلوس سايبة",
  leakingSubtitle: "جلسات اتعملت ومحدش دفع تمنها",
  nothingLeaking: "كل الجلسات مدفوعة.",
  sessionOn: "جلسة {date}",
  totalOwed: "الإجمالي المستحق",
  stalePackagesTitle: "باقات واقفة",
  stalePackagesSubtitle:
    "مدفوعة وجلساتها مش بتتستهلك — أول إشارة إن المريض هيسيب",
  lastSessionOn: "آخر جلسة {date} · فاضل {n}",
  notStartedYet: "لسه مابدأتش",

  adminTitle: "المنصة",
  adminSubtitle: "كل العيادات على النظام",
  adminForbidden: "الحساب ده مش أدمن منصة. مفيش حاجة هنا متاحة له.",
  adminNotConfigured:
    "مفيش أدمن منصة معرّف. حدّد PLATFORM_ADMIN_EMAILS في بيئة السيرفر.",
  clinics: "العيادات",
  staff: "الفريق",
  patients: "المرضى",
  appointments: "المواعيد",
  collected: "المحصّل",
  outstanding: "المستحق",
  refunded: "المسترجع",
  clinicName: "العيادة",
  activity: "مين عمل إيه",
  activitySubtitle: "الأحدث الأول، من كل العيادات",
  noActivity: "لسه مفيش حاجة حصلت",
  actionTookPayment: "قبض {amount}",
  actionRefunded: "رجّع {amount}",
  actionRegisteredPatient: "سجّل مريض",
  actionBookedAppointment: "حجز موعد",
  actionSoldPackage: "باع باقة {n} جلسة",
  phiNotice:
    "أسماء المرضى والملاحظات الإكلينيكية مش معروضة هنا عن قصد. أدمن المنصة يشوف الشغل ماشي إزاي، مش مين بيتعالج من إيه.",
  backToClinic: "رجوع للعيادة",
  unknownUser: "غير معروف",
  noClinics: "مفيش عيادات",
};

const TABLE = LOCALE === "ar" ? ar : en;

export function t(key: Key, vars?: Record<string, string | number>) {
  const raw: string = TABLE[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) =>
    String(vars[k] ?? `{${k}}`)
  );
}
