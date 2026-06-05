import type { ClinicalCaseReviewDetail } from "@/types";

const PLACEHOLDER_SOURCE_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.test",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
]);

const TRUSTED_CLINICAL_SOURCE_HOSTS = new Set([
  "acc.org",
  "acep.org",
  "acpjournals.org",
  "acponline.org",
  "acpjc.org",
  "ada.org",
  "ahajournals.org",
  "annals.org",
  "bmj.com",
  "cdc.gov",
  "diabetes.org",
  "escardio.org",
  "heart.org",
  "idsociety.org",
  "jacc.org",
  "jamanetwork.com",
  "lancet.com",
  "nejm.org",
  "nice.org.uk",
  "nih.gov",
  "professional.diabetes.org",
  "pubmed.ncbi.nlm.nih.gov",
  "sccm.org",
  "thelancet.com",
  "who.int",
]);

const TRUSTED_CLINICAL_SOURCE_SUFFIXES = [".edu", ".gov"];

const DIAGNOSIS_LEAK_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "acute",
  "chronic",
  "class",
  "due",
  "exacerbation",
  "from",
  "in",
  "likely",
  "mild",
  "moderate",
  "of",
  "or",
  "probable",
  "secondary",
  "severe",
  "stage",
  "suspected",
  "syndrome",
  "the",
  "to",
  "type",
  "with",
]);

const DIAGNOSIS_SINGLE_TOKEN_LEAK_TERMS = new Set([
  "anaphylaxis",
  "appendicitis",
  "bacteremia",
  "bronchiolitis",
  "cellulitis",
  "cholangitis",
  "cholecystitis",
  "colitis",
  "diverticulitis",
  "eclampsia",
  "embolism",
  "endocarditis",
  "hemorrhage",
  "infarction",
  "ischemia",
  "ketoacidosis",
  "meningitis",
  "myocarditis",
  "nephrolithiasis",
  "osteomyelitis",
  "pancreatitis",
  "pericarditis",
  "peritonitis",
  "pneumonia",
  "pneumothorax",
  "preeclampsia",
  "pyelonephritis",
  "sepsis",
  "stroke",
  "thrombosis",
  "urosepsis",
]);

const DIAGNOSIS_KOREAN_SINGLE_TOKEN_LEAK_TERMS = [
  "기흉",
  "뇌경색",
  "뇌졸중",
  "담관염",
  "담낭염",
  "수막염",
  "심근경색",
  "심근염",
  "심낭염",
  "신우신염",
  "췌장염",
  "충수염",
  "케톤산증",
  "폐렴",
  "폐색전",
  "폐색전증",
  "패혈증",
  "요로패혈증",
  "아나필락시스",
];

const DIAGNOSIS_LEAK_ALIASES: Record<string, string[]> = {
  "acute coronary syndrome": ["acute coronary syndrome", "acs"],
  "급성 관상동맥 증후군": [
    "급성 관상동맥 증후군",
    "급성관상동맥증후군",
    "관상동맥 증후군",
    "관상동맥증후군",
    "심근경색",
  ],
  "myocardial infarction": ["myocardial infarction", "heart attack"],
  심근경색: ["심근경색", "심근 경색", "급성 관상동맥 증후군", "급성관상동맥증후군"],
  stemi: [
    "stemi",
    "st elevation",
    "st-elevation",
    "myocardial infarction",
    "heart attack",
    "acute coronary syndrome",
    "acs",
  ],
  nstemi: ["nstemi", "non st elevation", "non-st elevation", "myocardial infarction"],
  "septic shock": ["septic shock", "sepsis", "urosepsis"],
  "패혈성 쇼크": ["패혈성 쇼크", "패혈성쇼크", "패혈증", "요로패혈증"],
  "pulmonary embolism": ["pulmonary embolism", "embolism"],
  폐색전증: ["폐색전증", "폐색전"],
  "diabetic ketoacidosis": ["diabetic ketoacidosis", "ketoacidosis", "dka"],
  "당뇨병성 케톤산증": ["당뇨병성 케톤산증", "당뇨병성케톤산증", "케톤산증"],
  "acute ischemic stroke": ["acute ischemic stroke", "ischemic stroke"],
  "급성 허혈성 뇌졸중": [
    "급성 허혈성 뇌졸중",
    "급성허혈성뇌졸중",
    "허혈성 뇌졸중",
    "허혈성뇌졸중",
    "뇌경색",
    "뇌졸중",
  ],
};

const LEARNER_VISIBLE_CASE_TEXT_FIELDS = [
  "title",
  "chief_complaint",
  "history_of_present_illness",
  "past_medical_history",
] as const;

type ReviewQualityGate = {
  name: string;
  label: string;
  applies: (detail: ClinicalCaseReviewDetail) => boolean;
  fieldName: "time_critical_actions" | "contraindication_checks";
  validator: (values: string[]) => boolean;
  issue: string;
};

export type ReviewQualityGateStatus = {
  name: string;
  label: string;
  fieldName: ReviewQualityGate["fieldName"];
  applied: boolean;
  passed: boolean;
  issue: string;
};

const SOURCE_SUPPORT_SCOPE_PATTERNS: Array<{
  label: string;
  patterns: RegExp[];
}> = [
  {
    label: "diagnosis or diagnostic reasoning",
    patterns: [
      /\bdiagnos/,
      /\bdifferential\b/,
      /\bcriteria\b/,
      /\brisk stratification\b/,
      /\bpathway\b/,
    ],
  },
  {
    label: "red flags or severity markers",
    patterns: [
      /\bred flags?\b/,
      /\bhigh[- ]risk\b/,
      /\blife[- ]threatening\b/,
      /\bseverity\b/,
      /\bshock\b/,
      /\bhypoperfusion\b/,
      /\bhemodynamic\b/,
      /\binstability\b/,
      /\borgan dysfunction\b/,
      /\brv strain\b/,
      /\bacidosis\b/,
    ],
  },
  {
    label: "time-critical actions",
    patterns: [
      /\btime[- ]critical\b/,
      /\btiming\b/,
      /\bwithin\b/,
      /\bimmediate/,
      /\burgent/,
      /\bactivation\b/,
      /\bbundle\b/,
      /\breperfusion\b/,
      /\bthrombolysis\b/,
      /\bthrombectomy\b/,
      /\bescalation\b/,
    ],
  },
  {
    label: "contraindication or safety checks",
    patterns: [
      /\bcontraindication/,
      /\bsafety checks?\b/,
      /\ballerg/,
      /\bbleeding\b/,
      /\brenal\b/,
      /\bpregnancy\b/,
      /\bblood pressure\b/,
      /\bpotassium\b/,
      /\bsurgery\b/,
      /\banticoag/,
      /\bcontrast\b/,
      /\bthreshold/,
      /\bbefore\b/,
    ],
  },
];

const SOURCE_SUPPORT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "before",
  "by",
  "case",
  "check",
  "checks",
  "clinical",
  "criteria",
  "features",
  "for",
  "from",
  "in",
  "into",
  "is",
  "markers",
  "of",
  "or",
  "patient",
  "patients",
  "risk",
  "risks",
  "safety",
  "severity",
  "sign",
  "signs",
  "the",
  "therapy",
  "to",
  "with",
]);

const SOURCE_SUPPORT_TOKEN_ALIASES: Record<string, string> = {
  antibiotics: "antibiotic",
  anticoagulation: "anticoagulant",
  anticoagulated: "anticoagulant",
  anticoagulants: "anticoagulant",
  antithrombotics: "antithrombotic",
  cultures: "culture",
  allergies: "allergy",
  fluids: "fluid",
  hypotension: "hypotensive",
  hypoxemia: "hypoxia",
  ischaemic: "ischemic",
  ischemia: "ischemic",
  platelets: "platelet",
  surgical: "surgery",
  thrombolysis: "thrombolytic",
  vasopressors: "vasopressor",
};

const PREGNANCY_SAFETY_TERMS = [
  "pregnancy",
  "pregnant",
  "gestation",
  "gestational",
  "hcg",
  "beta hcg",
  "beta-hcg",
  "임신",
];

const PEDIATRIC_WEIGHT_SAFETY_TERMS = [
  "weight",
  "weight-based",
  "weight based",
  "kg",
  "dose",
  "dosing",
  "mg/kg",
  "ml/kg",
  "units/kg",
  "체중",
];

const RENAL_RISK_TRIGGER_TERMS = [
  "aminoglycoside",
  "antibiotic dosing",
  "antimicrobial dosing",
  "ckd",
  "contrast",
  "creatinine",
  "ct pulmonary angiography",
  "ctpa",
  "egfr",
  "kidney",
  "metformin",
  "renal",
  "vancomycin",
  "조영제",
  "크레아티닌",
  "신장",
  "콩팥",
];

const RENAL_SAFETY_TERMS = [
  "creatinine",
  "egfr",
  "kidney",
  "renal",
  "신장",
  "콩팥",
  "크레아티닌",
];

const HIGH_RISK_THERAPY_TRIGGER_TERMS = [
  "alteplase",
  "anticoagulation",
  "anticoagulant",
  "anticoagulants",
  "antiplatelet",
  "antiplatelets",
  "antithrombotic",
  "antithrombotics",
  "aspirin",
  "heparin",
  "reperfusion",
  "thrombolysis",
  "thrombolytic",
  "tpa",
  "혈전용해",
  "항응고",
  "항혈소판",
  "아스피린",
  "헤파린",
];

const HEMORRHAGE_SAFETY_TERMS = [
  "active bleeding",
  "anticoagulation",
  "anticoagulant",
  "anticoagulants",
  "aortic dissection",
  "bleed",
  "bleeding",
  "blood pressure",
  "bp",
  "dissection",
  "haemorrhage",
  "hemorrhage",
  "intracranial hemorrhage",
  "platelet",
  "platelets",
  "recent surgery",
  "surgery",
  "출혈",
  "두개내출혈",
  "수술",
  "혈소판",
  "혈압",
  "대동맥박리",
  "대동맥 박리",
];

const INFECTION_TREATMENT_TRIGGER_TERMS = [
  "antibiotic",
  "antibiotics",
  "antimicrobial",
  "antimicrobials",
  "bacteremia",
  "empiric antibiotics",
  "sepsis",
  "sepsis bundle",
  "septic",
  "septic shock",
  "source control",
  "urosepsis",
  "감염",
  "균혈증",
  "패혈증",
  "항균제",
  "항생제",
];

const INFECTION_CULTURE_TERMS = [
  "blood culture",
  "blood cultures",
  "culture",
  "cultures",
  "배양",
  "혈액배양",
  "혈액 배양",
];

const INFECTION_TREATMENT_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "antimicrobial",
  "antimicrobials",
  "source control",
  "항균제",
  "항생제",
  "감염원 조절",
];

const SEPSIS_CONTEXT_TERMS = [
  "sepsis",
  "sepsis bundle",
  "septic",
  "septic shock",
  "urosepsis",
  "패혈증",
];

const SEPSIS_LACTATE_ACTION_TERMS = ["lactate", "젖산"];

const SEPSIS_FLUID_ACTION_TERMS = ["fluid", "fluids", "resuscitation", "수액"];

const SEPSIS_VASOPRESSOR_ACTION_TERMS = [
  "hypotension persists",
  "map",
  "norepinephrine",
  "pressor",
  "pressors",
  "shock",
  "vasopressor",
  "vasopressors",
  "노르에피네프린",
  "승압제",
  "저혈압",
  "혈관수축제",
];

const ANTIMICROBIAL_ALLERGY_SAFETY_TERMS = [
  "allergies",
  "allergy",
  "drug allergy",
  "medication allergy",
  "알레르기",
  "약물 알레르기",
];

const ANTIMICROBIAL_DOSING_SAFETY_TERMS = [
  "creatinine",
  "dose",
  "dosing",
  "egfr",
  "kidney",
  "renal",
  "신장",
  "용량",
  "콩팥",
  "크레아티닌",
];

const ANAPHYLAXIS_CONTEXT_TERMS = [
  "anaphylaxis",
  "anaphylactic",
  "anaphylactic shock",
  "angioedema",
  "urticaria with wheeze",
  "wheeze with hypotension",
  "아나필락시스",
  "혈관부종",
];

const ANAPHYLAXIS_EPINEPHRINE_ACTION_TERMS = [
  "adrenaline",
  "epi",
  "epinephrine",
  "im adrenaline",
  "im epinephrine",
  "intramuscular adrenaline",
  "intramuscular epinephrine",
  "아드레날린",
  "에피네프린",
];

const ANAPHYLAXIS_AIRWAY_ACTION_TERMS = [
  "airway",
  "bronchospasm",
  "intubation",
  "oxygen",
  "stridor",
  "wheeze",
  "기도",
  "기관삽관",
  "산소",
  "천명",
  "호흡",
];

const ANAPHYLAXIS_SHOCK_ACTION_TERMS = [
  "fluid",
  "fluid bolus",
  "hypotension",
  "resuscitation",
  "shock",
  "vasopressor",
  "쇼크",
  "수액",
  "저혈압",
];

const ANAPHYLAXIS_TRIGGER_SAFETY_TERMS = [
  "allergen",
  "allergy",
  "exposure",
  "remove",
  "stop infusion",
  "trigger",
  "노출",
  "알레르겐",
  "중단",
  "항원",
];

const ANAPHYLAXIS_OBSERVATION_SAFETY_TERMS = [
  "biphasic",
  "monitoring",
  "observation",
  "observe",
  "recurrence",
  "rebound",
  "모니터링",
  "이상성",
  "재발",
  "관찰",
];

const DKA_TREATMENT_TRIGGER_TERMS = [
  "anion gap",
  "diabetic ketoacidosis",
  "dka",
  "hyperglycemic crisis",
  "insulin infusion",
  "insulin therapy",
  "ketoacidosis",
  "ketones",
  "케톤산증",
  "인슐린",
];

const DKA_POTASSIUM_ACTION_TERMS = ["k", "potassium", "칼륨"];

const DKA_FLUID_INSULIN_ACTION_TERMS = [
  "fluid",
  "fluids",
  "insulin",
  "수액",
  "인슐린",
];

const DKA_CLOSURE_MONITORING_TERMS = [
  "anion gap",
  "gap closes",
  "gap closure",
  "ketone",
  "ketones",
  "metabolic correction",
  "close the anion gap",
  "음이온차",
  "케톤",
];

const DKA_POTASSIUM_SAFETY_TERMS = ["k", "potassium", "threshold", "칼륨", "역치"];

const DKA_OSMOLAR_SAFETY_TERMS = [
  "cerebral edema",
  "fluid",
  "osmolar",
  "osmolar shift",
  "osmolality",
  "rapid correction",
  "sodium",
  "뇌부종",
  "삼투",
  "수액",
];

const STROKE_CONTEXT_TERMS = [
  "acute ischemic stroke",
  "brain attack",
  "cerebrovascular accident",
  "ischemic stroke",
  "large vessel occlusion",
  "nihss",
  "stroke",
  "stroke pathway",
  "뇌경색",
  "뇌졸중",
];

const STROKE_REPERFUSION_TRIGGER_TERMS = [
  "alteplase",
  "last known normal",
  "last known well",
  "lkn",
  "lkw",
  "reperfusion",
  "thrombectomy",
  "thrombolysis",
  "thrombolytic",
  "tpa",
  "혈전용해",
  "혈전제거",
  "재관류",
];

const STROKE_LAST_KNOWN_NORMAL_TERMS = [
  "last known normal",
  "last known well",
  "lkn",
  "lkw",
  "symptom onset",
  "최종 정상",
  "마지막 정상",
];

const STROKE_BRAIN_IMAGING_TERMS = [
  "brain imaging",
  "ct",
  "head ct",
  "mri",
  "neuroimaging",
  "noncontrast",
  "non-contrast",
  "뇌영상",
  "비조영",
];

const STROKE_REPERFUSION_ACTION_TERMS = [
  "alteplase",
  "eligibility",
  "reperfusion",
  "thrombectomy",
  "thrombolysis",
  "tpa",
  "혈전용해",
  "혈전제거",
  "재관류",
];

const STROKE_HEMORRHAGE_EXCLUSION_TERMS = [
  "bleeding",
  "ct",
  "haemorrhage",
  "hemorrhage",
  "imaging",
  "intracranial hemorrhage",
  "noncontrast",
  "non-contrast",
  "출혈",
  "두개내출혈",
  "비조영",
];

const STROKE_ANTICOAGULANT_SAFETY_TERMS = [
  "anticoagulant",
  "anticoagulation",
  "apixaban",
  "bleeding history",
  "doac",
  "inr",
  "warfarin",
  "항응고",
];

const STROKE_PLATELET_TERMS = ["platelet", "platelets", "혈소판"];

const STROKE_GLUCOSE_TERMS = ["glucose", "hypoglycemia", "혈당"];

const STROKE_BP_TERMS = ["blood pressure", "bp", "hypertension", "혈압"];

const PE_CONTEXT_TERMS = [
  "ct pulmonary angiography",
  "ctpa",
  "d-dimer",
  "dvt",
  "pe",
  "pulmonary embolism",
  "rv strain",
  "right ventricular strain",
  "wells",
  "폐색전",
  "폐색전증",
];

const PE_RISK_STRATIFICATION_TERMS = [
  "massive",
  "risk stratification",
  "risk stratify",
  "submassive",
  "wells",
  "위험도",
];

const PE_HEMODYNAMIC_TERMS = [
  "blood pressure",
  "echo",
  "hemodynamic",
  "hypotension",
  "instability",
  "rv strain",
  "right ventricular",
  "shock",
  "syncope",
  "혈역학",
  "저혈압",
];

const PE_IMAGING_PATHWAY_TERMS = [
  "bedside echo",
  "ct pulmonary angiography",
  "ctpa",
  "echo",
  "imaging",
  "v/q",
  "영상",
  "심초음파",
];

const PE_BLEEDING_SAFETY_TERMS = [
  "bleeding",
  "recent surgery",
  "surgery",
  "thrombolysis",
  "출혈",
  "수술",
];

const PE_RENAL_CONTRAST_SAFETY_TERMS = [
  "contrast",
  "creatinine",
  "egfr",
  "kidney",
  "renal",
  "조영제",
  "크레아티닌",
  "신장",
  "콩팥",
];

const PE_PREGNANCY_SAFETY_TERMS = ["hcg", "pregnancy", "pregnant", "임신"];

const ACS_CONTEXT_TERMS = [
  "acute coronary syndrome",
  "acs",
  "myocardial infarction",
  "nstemi",
  "st-elevation",
  "stemi",
  "심근경색",
  "급성관상동맥",
];

const ACS_ECG_ACTION_TERMS = [
  "12-lead ecg",
  "ecg",
  "electrocardiogram",
  "within 10 minutes",
  "심전도",
];

const ACS_REPERFUSION_ACTION_TERMS = [
  "cath",
  "door-to-balloon",
  "door to balloon",
  "pci",
  "reperfusion",
  "stemi",
  "재관류",
];

const ACS_ANTITHROMBOTIC_ACTION_TERMS = [
  "anticoagulation",
  "antiplatelet",
  "antithrombotic",
  "aspirin",
  "heparin",
  "항응고",
  "항혈소판",
];

const ACS_DISSECTION_SAFETY_TERMS = [
  "aortic dissection",
  "dissection",
  "대동맥박리",
  "대동맥 박리",
];

const ACS_BLEEDING_SAFETY_TERMS = [
  "active bleeding",
  "bleeding",
  "recent surgery",
  "surgery",
  "출혈",
  "수술",
];

const ACS_HEMODYNAMIC_SAFETY_TERMS = [
  "cardiogenic shock",
  "hemodynamic",
  "heart failure",
  "hypotension",
  "instability",
  "pulmonary edema",
  "shock",
  "혈역학",
  "저혈압",
  "폐부종",
];

type SourceAnchoredSafetyField =
  | "clinical_red_flags"
  | "time_critical_actions"
  | "contraindication_checks";

function isTrustedClinicalSourceHost(hostname: string): boolean {
  const normalized = hostname.replace(/^www\./, "");
  if (TRUSTED_CLINICAL_SOURCE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  return Array.from(TRUSTED_CLINICAL_SOURCE_HOSTS).some(
    (trustedHost) => normalized === trustedHost || normalized.endsWith(`.${trustedHost}`),
  );
}

function tokensForSourceSupport(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();
  const phraseAliases: Array<[string, string[]]> = [
    ["blood pressure", ["blood_pressure", "bp"]],
    ["ct pulmonary angiography", ["ctpa", "contrast", "imaging"]],
    ["door to balloon", ["door_to_balloon", "reperfusion"]],
    ["door-to-balloon", ["door_to_balloon", "reperfusion"]],
    ["heart failure", ["heart_failure", "pulmonary_edema"]],
    ["last known normal", ["last_known_normal", "lkn"]],
    ["mental status", ["mental_status", "confusion"]],
    ["pulmonary edema", ["pulmonary_edema", "heart_failure"]],
    ["right heart strain", ["rv_strain", "strain"]],
    ["right ventricular", ["rv", "rv_strain"]],
  ];
  phraseAliases.forEach(([phrase, aliases]) => {
    if (normalized.includes(phrase)) {
      aliases.forEach((alias) => tokens.add(alias));
    }
  });
  for (const rawToken of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (rawToken.length < 3 && !["bp", "ct", "pe"].includes(rawToken)) {
      continue;
    }
    const token = SOURCE_SUPPORT_TOKEN_ALIASES[rawToken] ?? rawToken;
    if (!SOURCE_SUPPORT_STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function sourceSupportAnchorIssues(
  detail: ClinicalCaseReviewDetail,
  supportTexts: string[],
): string[] {
  const supportTokenSets = supportTexts
    .map((text) => tokensForSourceSupport(text))
    .filter((tokens) => tokens.size > 0);
  if (supportTokenSets.length === 0) return [];

  const coverageFields: Array<[SourceAnchoredSafetyField, string]> = [
    ["clinical_red_flags", "clinical red flags"],
    ["time_critical_actions", "time-critical actions"],
    ["contraindication_checks", "contraindication checks"],
  ];
  const issues: string[] = [];
  coverageFields.forEach(([fieldName, label]) => {
    const items = detail[fieldName];
    items.forEach((item) => {
      const itemText = String(item).trim();
      const itemTokens = tokensForSourceSupport(itemText);
      if (itemTokens.size === 0) return;
      const requiredOverlap = itemTokens.size <= 2 ? 1 : 2;
      const anchored = supportTokenSets.some((supportTokens) => {
        let overlap = 0;
        itemTokens.forEach((token) => {
          if (supportTokens.has(token)) overlap += 1;
        });
        return overlap >= requiredOverlap;
      });
      if (!anchored) {
        issues.push(`Clinical sources must specifically anchor ${label}: ${itemText.slice(0, 120)}`);
      }
    });
  });
  return issues;
}

function requiresPregnancySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const age = detail.patient_demographics.age;
  const sex = String(detail.patient_demographics.sex ?? "").trim().toLowerCase();
  return sex === "female" && typeof age === "number" && age >= 12 && age <= 55;
}

function hasPregnancySafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  return PREGNANCY_SAFETY_TERMS.some((term) => normalizedChecks.includes(term));
}

function isPediatricAge(age: unknown): boolean {
  return typeof age === "number" && age < 18;
}

function hasValidPediatricWeight(detail: ClinicalCaseReviewDetail): boolean {
  const weightKg = detail.patient_demographics.weight_kg;
  return typeof weightKg === "number" && weightKg >= 0.5 && weightKg <= 150;
}

function hasPediatricWeightSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  return PEDIATRIC_WEIGHT_SAFETY_TERMS.some((term) => normalizedChecks.includes(term));
}

function nestedStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => nestedStrings(item));
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => nestedStrings(item));
  }
  return [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDiagnosisText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsDiagnosisTerm(normalizedText: string, term: string): boolean {
  const normalizedTerm = normalizeDiagnosisText(term);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}(?=$|[^a-z0-9])`).test(
    normalizedText,
  );
}

function diagnosisLeakTerms(diagnosis: string): string[] {
  const normalized = normalizeDiagnosisText(diagnosis);
  const terms = new Set<string>();
  Object.entries(DIAGNOSIS_LEAK_ALIASES).forEach(([trigger, aliases]) => {
    if (normalized.includes(trigger)) {
      aliases.forEach((alias) => terms.add(alias));
    }
  });

  const rawTokens = normalized.match(/[a-z0-9]+/g) ?? [];
  const tokens = rawTokens.filter((token) => !DIAGNOSIS_LEAK_STOPWORDS.has(token));
  const acronym = rawTokens
    .filter((token) => !["and", "or", "of", "the"].includes(token))
    .map((token) => token[0])
    .join("");
  if (acronym.length >= 3 && acronym.length <= 6) {
    terms.add(acronym);
  }

  [3, 2].forEach((size) => {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phraseTokens = tokens.slice(index, index + size);
      if (phraseTokens.every((token) => token.length >= 3)) {
        terms.add(phraseTokens.join(" "));
      }
    }
  });

  tokens.forEach((token) => {
    if (DIAGNOSIS_SINGLE_TOKEN_LEAK_TERMS.has(token)) {
      terms.add(token);
    }
  });
  DIAGNOSIS_KOREAN_SINGLE_TOKEN_LEAK_TERMS.forEach((term) => {
    if (normalized.includes(term)) {
      terms.add(term);
    }
  });

  return Array.from(terms).sort((left, right) => right.length - left.length);
}

function learnerVisibleCaseStrings(detail: ClinicalCaseReviewDetail): Array<[string, string]> {
  const strings: Array<[string, string]> = [];
  LEARNER_VISIBLE_CASE_TEXT_FIELDS.forEach((fieldName) => {
    const value = detail[fieldName];
    if (value) {
      strings.push([fieldName, String(value)]);
    }
  });
  nestedStrings(detail.medications).forEach((value) => strings.push(["medications", value]));
  nestedStrings(detail.physical_exam).forEach((value) => strings.push(["physical_exam", value]));
  nestedStrings(detail.initial_labs).forEach((value) => strings.push(["initial_labs", value]));
  return strings;
}

function diagnosisLeakIssues(detail: ClinicalCaseReviewDetail): string[] {
  const terms = diagnosisLeakTerms(String(detail.diagnosis ?? ""));
  if (terms.length === 0) return [];

  const issues: string[] = [];
  learnerVisibleCaseStrings(detail).forEach(([label, text]) => {
    const normalized = normalizeDiagnosisText(text);
    const leakedTerm = terms.find((term) => containsDiagnosisTerm(normalized, term));
    if (leakedTerm) {
      issues.push(`${label} must not reveal the diagnosis term '${leakedTerm}'`);
    }
  });
  return issues;
}

function containsSafetyTerm(text: string, term: string): boolean {
  const normalizedTerm = term.toLowerCase();
  if (normalizedTerm === "contrast") {
    const contrastPattern = /(^|[^a-z0-9])contrast(?=$|[^a-z0-9])/g;
    for (const match of text.matchAll(contrastPattern)) {
      const contrastStart = (match.index ?? 0) + match[1].length;
      const prefix = text.slice(Math.max(0, contrastStart - 4), contrastStart);
      if (prefix !== "non-" && prefix !== "non ") {
        return true;
      }
    }
    return false;
  }
  if (/[^a-z0-9\s-]/.test(normalizedTerm)) {
    return text.includes(normalizedTerm);
  }
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}(?=$|[^a-z0-9])`).test(
    text,
  );
}

function requiresRenalSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.medications),
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return RENAL_RISK_TRIGGER_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasRenalSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  return RENAL_SAFETY_TERMS.some((term) => containsSafetyTerm(normalizedChecks, term));
}

function requiresHemorrhageSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_sources),
  ]
    .join(" ")
    .toLowerCase();
  return HIGH_RISK_THERAPY_TRIGGER_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasHemorrhageSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  return HEMORRHAGE_SAFETY_TERMS.some((term) => containsSafetyTerm(normalizedChecks, term));
}

function requiresInfectionTreatmentSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
  ]
    .join(" ")
    .toLowerCase();
  return INFECTION_TREATMENT_TRIGGER_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasInfectionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCultures = INFECTION_CULTURE_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTreatment = INFECTION_TREATMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCultures && hasTreatment;
}

function hasAntimicrobialSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAllergyCheck = ANTIMICROBIAL_ALLERGY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDosingCheck = ANTIMICROBIAL_DOSING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasAllergyCheck && hasDosingCheck;
}

function requiresAnaphylaxisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.physical_exam),
  ]
    .join(" ")
    .toLowerCase();
  return ANAPHYLAXIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAnaphylaxisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEpinephrine = ANAPHYLAXIS_EPINEPHRINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirway = ANAPHYLAXIS_AIRWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasShockEscalation = ANAPHYLAXIS_SHOCK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasEpinephrine && hasAirway && hasShockEscalation;
}

function hasAnaphylaxisObservationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasTriggerReview = ANAPHYLAXIS_TRIGGER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasObservation = ANAPHYLAXIS_OBSERVATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasTriggerReview && hasObservation;
}

function requiresSepsisResuscitationSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SEPSIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasSepsisResuscitationActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLactate = SEPSIS_LACTATE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluids = SEPSIS_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVasopressorOrShockEscalation = SEPSIS_VASOPRESSOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasLactate && hasFluids && hasVasopressorOrShockEscalation;
}

function requiresDkaTreatmentSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return DKA_TREATMENT_TRIGGER_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasDkaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasPotassium = DKA_POTASSIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidInsulin = DKA_FLUID_INSULIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasClosureMonitoring = DKA_CLOSURE_MONITORING_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasPotassium && hasFluidInsulin && hasClosureMonitoring;
}

function hasDkaContraindicationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPotassiumSafety = DKA_POTASSIUM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOsmolarSafety = DKA_OSMOLAR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasPotassiumSafety && hasOsmolarSafety;
}

function requiresStrokeReperfusionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasStrokeContext = STROKE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasReperfusionContext = STROKE_REPERFUSION_TRIGGER_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasStrokeContext && hasReperfusionContext;
}

function hasStrokeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLastKnownNormal = STROKE_LAST_KNOWN_NORMAL_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBrainImaging = STROKE_BRAIN_IMAGING_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasReperfusionPlanning = STROKE_REPERFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasLastKnownNormal && hasBrainImaging && hasReperfusionPlanning;
}

function hasStrokeContraindicationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHemorrhageExclusion = STROKE_HEMORRHAGE_EXCLUSION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAnticoagulantStatus = STROKE_ANTICOAGULANT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletThreshold = STROKE_PLATELET_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasGlucoseThreshold = STROKE_GLUCOSE_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBpThreshold = STROKE_BP_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHemorrhageExclusion &&
    hasAnticoagulantStatus &&
    hasPlateletThreshold &&
    hasGlucoseThreshold &&
    hasBpThreshold
  );
}

function requiresPeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return PE_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasPeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRiskStratification = PE_RISK_STRATIFICATION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemodynamicAssessment = PE_HEMODYNAMIC_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImagingPathway = PE_IMAGING_PATHWAY_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasRiskStratification && hasHemodynamicAssessment && hasImagingPathway;
}

function hasPeContraindicationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBleedingSafety = PE_BLEEDING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRenalContrastSafety = PE_RENAL_CONTRAST_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPregnancySafety = PE_PREGNANCY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasBleedingSafety && hasRenalContrastSafety && hasPregnancySafety;
}

function requiresAcsSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  if (requiresPeSafetyCheck(detail) || requiresStrokeReperfusionSafetyCheck(detail)) {
    return false;
  }
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAcsTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEcg = ACS_ECG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasReperfusion = ACS_REPERFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntithromboticPlanning = ACS_ANTITHROMBOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasEcg && hasReperfusion && hasAntithromboticPlanning;
}

function hasAcsContraindicationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDissectionExclusion = ACS_DISSECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBleedingSafety = ACS_BLEEDING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHemodynamicEscalation = ACS_HEMODYNAMIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDissectionExclusion && hasBleedingSafety && hasHemodynamicEscalation;
}

function domainSafetyGates(): ReviewQualityGate[] {
  return [
    {
      name: "infection_time_critical_actions",
      label: "Infection cultures and treatment plan",
      applies: requiresInfectionTreatmentSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasInfectionTimeCriticalActions,
      issue:
        "infection time-critical actions must include cultures and antimicrobial or source-control planning",
    },
    {
      name: "infection_antimicrobial_safety",
      label: "Infection antimicrobial safety",
      applies: requiresInfectionTreatmentSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAntimicrobialSafetyCheck,
      issue:
        "antimicrobial allergy and renal dosing safety checks are required for infection therapy",
    },
    {
      name: "sepsis_resuscitation_actions",
      label: "Sepsis resuscitation actions",
      applies: requiresSepsisResuscitationSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSepsisResuscitationActions,
      issue:
        "sepsis time-critical actions must include lactate measurement or reassessment, fluid resuscitation, and vasopressor or shock escalation planning",
    },
    {
      name: "anaphylaxis_time_critical_actions",
      label: "Anaphylaxis immediate treatment",
      applies: requiresAnaphylaxisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAnaphylaxisTimeCriticalActions,
      issue:
        "anaphylaxis time-critical actions must include IM epinephrine, airway or oxygen support, and fluid or shock escalation planning",
    },
    {
      name: "anaphylaxis_observation_safety",
      label: "Anaphylaxis trigger and observation safety",
      applies: requiresAnaphylaxisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAnaphylaxisObservationSafetyCheck,
      issue:
        "anaphylaxis safety checks must include trigger or allergen exposure review and observation for biphasic reaction or recurrence",
    },
    {
      name: "dka_time_critical_actions",
      label: "DKA treatment sequence",
      applies: requiresDkaTreatmentSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDkaTimeCriticalActions,
      issue:
        "DKA time-critical actions must include potassium-before-insulin, fluids/insulin planning, and anion-gap or ketone closure monitoring",
    },
    {
      name: "dka_contraindication_safety",
      label: "DKA insulin safety",
      applies: requiresDkaTreatmentSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDkaContraindicationSafetyCheck,
      issue:
        "DKA safety checks must include potassium threshold and osmolar-shift or cerebral-edema risk before insulin therapy",
    },
    {
      name: "stroke_time_critical_actions",
      label: "Stroke reperfusion timing",
      applies: requiresStrokeReperfusionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasStrokeTimeCriticalActions,
      issue:
        "stroke time-critical actions must include last-known-normal timing, brain imaging, and reperfusion eligibility planning",
    },
    {
      name: "stroke_reperfusion_safety",
      label: "Stroke reperfusion thresholds",
      applies: requiresStrokeReperfusionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasStrokeContraindicationSafetyCheck,
      issue:
        "stroke reperfusion safety checks must include hemorrhage exclusion, anticoagulant status, platelet count, glucose, and blood pressure thresholds",
    },
    {
      name: "pe_time_critical_actions",
      label: "PE risk and imaging pathway",
      applies: requiresPeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPeTimeCriticalActions,
      issue:
        "PE time-critical actions must include risk stratification, hemodynamic or RV-strain assessment, and imaging or bedside-echo pathway",
    },
    {
      name: "pe_contraindication_safety",
      label: "PE anticoagulation and imaging safety",
      applies: requiresPeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPeContraindicationSafetyCheck,
      issue:
        "PE safety checks must include bleeding or recent-surgery risk, renal/contrast safety, and pregnancy status when selecting imaging or anticoagulation",
    },
    {
      name: "acs_time_critical_actions",
      label: "ACS time-critical pathway",
      applies: requiresAcsSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcsTimeCriticalActions,
      issue:
        "ACS time-critical actions must include ECG within 10 minutes, reperfusion pathway, and antithrombotic planning",
    },
    {
      name: "acs_contraindication_safety",
      label: "ACS antithrombotic safety",
      applies: requiresAcsSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcsContraindicationSafetyCheck,
      issue:
        "ACS safety checks must include aortic dissection exclusion, bleeding or recent-surgery risk, and hemodynamic or heart-failure escalation",
    },
  ];
}

export function reviewQualityGateStatuses(
  detail: ClinicalCaseReviewDetail | undefined,
): ReviewQualityGateStatus[] {
  if (!detail) return [];
  return domainSafetyGates().map((gate) => {
    const applied = gate.applies(detail);
    return {
      name: gate.name,
      label: gate.label,
      fieldName: gate.fieldName,
      applied,
      passed: !applied || gate.validator(detail[gate.fieldName]),
      issue: gate.issue,
    };
  });
}

export function reviewQualityIssues(detail: ClinicalCaseReviewDetail | undefined): string[] {
  if (!detail) return ["Reviewer-only case detail must load before review."];
  const issues: string[] = [];
  issues.push(...diagnosisLeakIssues(detail));
  if (detail.key_teaching_points.length < 3) {
    issues.push("At least 3 key teaching points are required.");
  }
  if (detail.cognitive_traps.length < 2) {
    issues.push("At least 2 cognitive traps are required.");
  }
  if (isPediatricAge(detail.patient_demographics.age) && !hasValidPediatricWeight(detail)) {
    issues.push("patient_demographics.weight_kg is required for pediatric cases");
  }
  if (detail.clinical_red_flags.length < 2) {
    issues.push("At least 2 clinical red flags are required.");
  }
  if (detail.time_critical_actions.length < 2) {
    issues.push("At least 2 time-critical actions are required.");
  }
  if (detail.contraindication_checks.length < 2) {
    issues.push("At least 2 contraindication checks are required.");
  }
  if (
    requiresPregnancySafetyCheck(detail) &&
    !hasPregnancySafetyCheck(detail.contraindication_checks)
  ) {
    issues.push("pregnancy status safety check is required for reproductive-age female cases");
  }
  if (
    isPediatricAge(detail.patient_demographics.age) &&
    !hasPediatricWeightSafetyCheck(detail.contraindication_checks)
  ) {
    issues.push("weight-based dosing safety check is required for pediatric cases");
  }
  if (requiresRenalSafetyCheck(detail) && !hasRenalSafetyCheck(detail.contraindication_checks)) {
    issues.push(
      "renal function safety check is required for contrast imaging or renally cleared therapy",
    );
  }
  if (
    requiresHemorrhageSafetyCheck(detail) &&
    !hasHemorrhageSafetyCheck(detail.contraindication_checks)
  ) {
    issues.push(
      "bleeding risk safety check is required for thrombolysis or antithrombotic therapy",
    );
  }
  domainSafetyGates().forEach((gate) => {
    if (gate.applies(detail) && !gate.validator(detail[gate.fieldName])) {
      issues.push(gate.issue);
    }
  });
  if (detail.clinical_sources.length < 1) {
    issues.push("At least 1 clinical source is required.");
  }
  const sourceOrganizations = new Set(
    detail.clinical_sources
      .map((source) => source.organization.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    detail.source_provenance.review_status === "clinician_reviewed" &&
    sourceOrganizations.size < 2
  ) {
    issues.push(
      "Clinician-reviewed cases require at least 2 independent clinical source organizations.",
    );
  }
  const supportTexts: string[] = [];
  detail.clinical_sources.forEach((source, index) => {
    const validSupports = source.supports.filter((item) => item.trim());
    if (validSupports.length < 2) {
      issues.push(`Clinical source ${index + 1} must describe at least 2 supported case elements.`);
    }
    supportTexts.push(...validSupports);
    try {
      const url = new URL(source.url);
      const hostname = url.hostname.toLowerCase();
      const isPlaceholder =
        PLACEHOLDER_SOURCE_HOSTS.has(hostname) ||
        hostname.endsWith(".example") ||
        Array.from(PLACEHOLDER_SOURCE_HOSTS).some((host) => hostname.endsWith(`.${host}`));
      if (url.protocol !== "https:") {
        issues.push(`Clinical source ${index + 1} must use a valid HTTPS URL.`);
      }
      if (isPlaceholder) {
        issues.push(`Clinical source ${index + 1} must not use a placeholder source domain.`);
      }
      if (!isPlaceholder && url.protocol === "https:" && !isTrustedClinicalSourceHost(hostname)) {
        issues.push(`Clinical source ${index + 1} must use a reputable clinical source domain.`);
      }
    } catch {
      issues.push(`Clinical source ${index + 1} must use a valid HTTPS URL.`);
    }
  });
  const supportBlob = supportTexts.join(" ").toLowerCase();
  SOURCE_SUPPORT_SCOPE_PATTERNS.forEach(({ label, patterns }) => {
    if (!patterns.some((pattern) => pattern.test(supportBlob))) {
      issues.push(`Clinical sources must include support for ${label}.`);
    }
  });
  issues.push(...sourceSupportAnchorIssues(detail, supportTexts));
  return issues;
}
