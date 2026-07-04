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
  "aap.org",
  "australianprescriber.tg.org.au",
  "bmj.com",
  "cdc.gov",
  "diabetes.org",
  "escardio.org",
  "heart.org",
  "idsociety.org",
  "jacc.org",
  "jamanetwork.com",
  "lancet.com",
  "merckmanuals.com",
  "nejm.org",
  "nice.org.uk",
  "nih.gov",
  "poison.org",
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
  fieldName: "time_critical_actions" | "contraindication_checks" | "clinical_red_flags";
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

const SEPSIS_PERFUSION_REASSESSMENT_SAFETY_TERMS = [
  "capillary refill",
  "lactate clearance",
  "perfusion reassessment",
  "repeat lactate",
  "serial lactate",
  "urine output",
];

const SEPSIS_FLUID_REASSESSMENT_SAFETY_TERMS = [
  "dynamic assessment",
  "fluid overload",
  "fluid responsiveness",
  "pulmonary edema",
  "volume overload",
  "volume status",
];

const SEPSIS_VASOPRESSOR_TARGET_SAFETY_TERMS = [
  "map 65",
  "map goal",
  "mean arterial pressure",
  "norepinephrine",
  "vasopressor target",
];

const SEPSIS_SOURCE_CONTROL_SAFETY_TERMS = [
  "abscess drainage",
  "debridement",
  "device removal",
  "drainage",
  "source control",
];

const ADULT_SEPTIC_SHOCK_CONTEXT_TERMS = [
  "septic shock",
  "sepsis-induced hypoperfusion",
  "sepsis induced hypoperfusion",
  "urosepsis with shock",
];

const ADULT_SEPTIC_SHOCK_RISK_TERMS = [
  "altered mental status",
  "hypoperfusion",
  "hypotension",
  "lactate",
  "map",
  "oliguria",
  "organ dysfunction",
  "poor perfusion",
  "vasopressor",
];

const ADULT_SEPTIC_SHOCK_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "culture",
  "cultures",
];

const ADULT_SEPTIC_SHOCK_ANTIMICROBIAL_ACTION_TERMS = [
  "1 hour",
  "broad-spectrum",
  "broad spectrum",
  "empiric antibiotic",
  "empiric antimicrobial",
  "immediate antibiotic",
  "immediate antimicrobial",
  "within 1 hour",
  "within one hour",
];

const ADULT_SEPTIC_SHOCK_LACTATE_ACTION_TERMS = [
  "lactate",
  "repeat lactate",
  "serial lactate",
];

const ADULT_SEPTIC_SHOCK_FLUID_ACTION_TERMS = [
  "30 ml/kg",
  "30 mL/kg",
  "30ml/kg",
  "balanced crystalloid",
  "crystalloid",
  "fluid resuscitation",
];

const ADULT_SEPTIC_SHOCK_VASOPRESSOR_ACTION_TERMS = [
  "map 65",
  "mean arterial pressure",
  "norepinephrine",
  "vasopressor",
  "vasopressors",
];

const ADULT_SEPTIC_SHOCK_SOURCE_ICU_ACTION_TERMS = [
  "critical care",
  "icu",
  "source control",
];

const PEDIATRIC_SEPTIC_SHOCK_CONTEXT_TERMS = [
  "child with septic shock",
  "paediatric septic shock",
  "pediatric sepsis",
  "pediatric septic shock",
  "sepsis-associated organ dysfunction",
  "septic shock in child",
  "septic shock in children",
];

const PEDIATRIC_SEPTIC_SHOCK_RISK_TERMS = [
  "altered mental status",
  "capillary refill",
  "cold shock",
  "delayed capillary refill",
  "hypotension",
  "lactate",
  "oliguria",
  "organ dysfunction",
  "poor perfusion",
  "septic shock",
  "warm shock",
];

const PEDIATRIC_SEPTIC_SHOCK_ANTIBIOTIC_CULTURE_ACTION_TERMS = [
  "antibiotic within 1 hour",
  "antimicrobial within 1 hour",
  "blood culture",
  "broad-spectrum antibiotic",
  "broad-spectrum antimicrobial",
  "culture before antibiotics",
  "within 1 hour",
];

const PEDIATRIC_SEPTIC_SHOCK_FLUID_ACTION_TERMS = [
  "10 ml/kg",
  "10-20 ml/kg",
  "20 ml/kg",
  "balanced crystalloid",
  "fluid bolus",
  "isotonic crystalloid",
  "normal saline",
];

const PEDIATRIC_SEPTIC_SHOCK_REASSESSMENT_ACTION_TERMS = [
  "capillary refill",
  "hepatomegaly",
  "perfusion reassessment",
  "reassess after each bolus",
  "rales",
  "serial reassessment",
  "work of breathing",
];

const PEDIATRIC_SEPTIC_SHOCK_VASOACTIVE_ACTION_TERMS = [
  "epinephrine",
  "inotrope",
  "norepinephrine",
  "peripheral vasoactive",
  "vasoactive",
  "vasopressor",
];

const PEDIATRIC_SEPTIC_SHOCK_ESCALATION_ACTION_TERMS = [
  "critical care",
  "icu",
  "intensive care",
  "picu",
  "transport team",
  "transfer",
];

const PEDIATRIC_SEPTIC_SHOCK_FLUID_OVERLOAD_SAFETY_TERMS = [
  "fluid overload",
  "hepatomegaly",
  "pulmonary edema",
  "rales",
  "respiratory distress",
  "stop fluids",
  "worsening work of breathing",
];

const PEDIATRIC_SEPTIC_SHOCK_VASOACTIVE_ACCESS_SAFETY_TERMS = [
  "central line delay",
  "do not delay vasoactive",
  "intraosseous",
  "io access",
  "peripheral infusion",
  "peripheral vasoactive",
];

const PEDIATRIC_SEPTIC_SHOCK_METABOLIC_SAFETY_TERMS = [
  "calcium",
  "glucose",
  "hypocalcemia",
  "hypoglycemia",
  "ionized calcium",
];

const PEDIATRIC_SEPTIC_SHOCK_STEROID_SOURCE_SAFETY_TERMS = [
  "catecholamine resistant",
  "hydrocortisone",
  "source control",
  "steroid",
  "vasopressor refractory",
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
  "adrenaline auto-injector",
  "adrenaline autoinjector",
  "adrenaline im",
  "auto-injector",
  "autoinjector",
  "epi pen",
  "epinephrine auto-injector",
  "epinephrine autoinjector",
  "epinephrine im",
  "epipen",
  "im adrenaline",
  "im epinephrine",
  "intramuscular adrenaline",
  "intramuscular epinephrine",
  "근육주사 아드레날린",
  "근육주사 에피네프린",
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

const ANAPHYLAXIS_REPEAT_IM_EPINEPHRINE_SAFETY_TERMS = [
  "5 minutes",
  "five minutes",
  "im epinephrine",
  "intramuscular epinephrine",
  "repeat",
  "second dose",
];

const ANAPHYLAXIS_IV_EPINEPHRINE_SAFETY_TERMS = [
  "avoid iv",
  "cardiac arrest",
  "experienced specialist",
  "intravenous adrenaline",
  "intravenous epinephrine",
  "iv adrenaline",
  "iv epinephrine",
];

const ANAPHYLAXIS_ADJUNCT_NOT_FIRST_LINE_TERMS = [
  "adjunct",
  "antihistamine",
  "corticosteroid",
  "do not delay epinephrine",
  "hydrocortisone",
  "not first-line",
  "steroid",
];

const ANAPHYLAXIS_REFRACTORY_ESCALATION_SAFETY_TERMS = [
  "adrenaline infusion",
  "beta-blocker",
  "epinephrine infusion",
  "glucagon",
  "refractory",
  "vasopressor",
];

const EPIGLOTTITIS_DIRECT_CONTEXT_TERMS = [
  "acute epiglottitis",
  "adult epiglottitis",
  "epiglottitis",
  "supraglottitis",
  "급성 후두개염",
  "후두개염",
];

const EPIGLOTTITIS_AIRWAY_CONTEXT_TERMS = [
  "airway obstruction",
  "drooling",
  "muffled voice",
  "odynophagia",
  "severe sore throat",
  "stridor",
  "tripod",
  "삼각 자세",
  "침흘림",
];

const EPIGLOTTITIS_HIGH_SPECIFICITY_CONTEXT_TERMS = [
  "airway obstruction",
  "drooling",
  "muffled voice",
  "odynophagia",
  "severe sore throat",
  "tripod",
  "삼각 자세",
  "침흘림",
];

const EPIGLOTTITIS_AIRWAY_ASSESSMENT_ACTION_TERMS = [
  "airway",
  "airway assessment",
  "airway control",
  "front-of-neck",
  "intubation",
  "surgical airway",
  "tracheostomy",
  "기도",
  "기관삽관",
];

const EPIGLOTTITIS_SPECIALIST_ACTION_TERMS = [
  "anesthesia",
  "anaesthesia",
  "ent",
  "icu",
  "otolaryngology",
  "operating room",
  "어네스",
  "이비인후과",
  "중환자",
];

const EPIGLOTTITIS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "ceftriaxone",
  "cefotaxime",
  "clindamycin",
  "culture",
  "vancomycin",
  "항생제",
  "배양",
];

const EPIGLOTTITIS_MONITORING_ACTION_TERMS = [
  "close monitoring",
  "continuous pulse oximetry",
  "icu",
  "monitor",
  "observation",
  "pulse oximetry",
  "respiratory status",
  "산소포화도",
];

const EPIGLOTTITIS_AGITATION_SAFETY_TERMS = [
  "avoid agitation",
  "avoid unnecessary examination",
  "avoid throat exam",
  "do not agitate",
  "no tongue depressor",
  "sedation",
  "tongue depressor",
  "자극",
];

const EPIGLOTTITIS_AIRWAY_BACKUP_SAFETY_TERMS = [
  "anesthesia backup",
  "ent backup",
  "failed airway",
  "front-of-neck access",
  "surgical airway",
  "tracheostomy",
  "이비인후과",
];

const EPIGLOTTITIS_STEROID_ADJUNCT_SAFETY_TERMS = [
  "corticosteroid",
  "dexamethasone",
  "methylprednisolone",
  "steroid",
  "steroid adjunct",
  "스테로이드",
];

const EPIGLOTTITIS_COMPLICATION_RISK_SAFETY_TERMS = [
  "abscess",
  "airway compromise",
  "diabetes",
  "immunocompromised",
  "rapid deterioration",
  "respiratory failure",
  "sepsis",
  "기도폐쇄",
];

const DEEP_NECK_INFECTION_CONTEXT_TERMS = [
  "deep neck infection",
  "deep neck space infection",
  "deep neck space abscess",
  "floor of mouth cellulitis",
  "ludwig angina",
  "ludwig's angina",
  "parapharyngeal abscess",
  "parapharyngeal infection",
  "retropharyngeal abscess",
  "retropharyngeal infection",
  "submandibular space infection",
  "submental space infection",
  "sublingual space infection",
];

const DEEP_NECK_INFECTION_RISK_TERMS = [
  "airway compromise",
  "airway obstruction",
  "bull neck",
  "dental infection",
  "drooling",
  "dysphagia",
  "floor of mouth swelling",
  "hot potato voice",
  "inability to manage secretions",
  "neck swelling",
  "odontogenic",
  "respiratory distress",
  "stridor",
  "submandibular swelling",
  "tongue elevation",
  "trismus",
  "voice change",
];

const DEEP_NECK_AIRWAY_ACTION_TERMS = [
  "airway",
  "awake fiberoptic",
  "awake fibreoptic",
  "cricothyrotomy",
  "fiberoptic intubation",
  "intubation",
  "nasotracheal",
  "oxygen",
  "secure airway",
  "surgical airway",
  "tracheostomy",
];

const DEEP_NECK_SPECIALIST_ACTION_TERMS = [
  "anesthesia",
  "anaesthesia",
  "ent",
  "icu",
  "intensivist",
  "oral maxillofacial",
  "otolaryngology",
  "omfs",
];

const DEEP_NECK_ANTIBIOTIC_ACTION_TERMS = [
  "ampicillin-sulbactam",
  "anaerobic",
  "antibiotic",
  "broad-spectrum",
  "clindamycin",
  "metronidazole",
  "piperacillin-tazobactam",
  "vancomycin",
];

const DEEP_NECK_IMAGING_SOURCE_ACTION_TERMS = [
  "abscess",
  "blood culture",
  "contrast ct",
  "ct neck",
  "drainage",
  "incision and drainage",
  "source control",
  "tooth extraction",
];

const DEEP_NECK_AIRWAY_FIRST_SAFETY_TERMS = [
  "after airway",
  "airway first",
  "airway secured",
  "before ct",
  "imaging after airway",
  "stable for imaging",
];

const DEEP_NECK_AVOID_AIRWAY_HARM_SAFETY_TERMS = [
  "avoid blind nasotracheal",
  "avoid sedation",
  "avoid supine",
  "cricothyrotomy backup",
  "front-of-neck",
  "surgical airway backup",
  "tracheostomy backup",
];

const DEEP_NECK_MRSA_IMMUNOCOMPROMISED_SAFETY_TERMS = [
  "diabetes",
  "gram-negative",
  "immunocompromised",
  "meropenem",
  "mrsa",
  "piperacillin-tazobactam",
  "vancomycin",
];

const DEEP_NECK_DRAINAGE_COMPLICATION_SAFETY_TERMS = [
  "abscess",
  "airway obstruction",
  "aspiration pneumonia",
  "descending necrotizing mediastinitis",
  "drainage",
  "mediastinitis",
  "no clinical improvement",
  "sepsis",
];

const CROUP_CONTEXT_TERMS = [
  "barky cough",
  "croup",
  "croupy cough",
  "laryngotracheitis",
  "laryngotracheobronchitis",
  "recurrent croup",
  "severe croup",
  "크룹",
];

const CROUP_SEVERITY_RISK_TERMS = [
  "agitation",
  "biphasic stridor",
  "cyanosis",
  "decreased level of consciousness",
  "hypoxia",
  "impending respiratory failure",
  "in-drawing",
  "lethargy",
  "retractions",
  "respiratory distress",
  "stridor at rest",
  "work of breathing",
];

const CROUP_SEVERITY_ASSESSMENT_ACTION_TERMS = [
  "agitation",
  "cyanosis",
  "hypoxia",
  "impending respiratory failure",
  "retractions",
  "severity",
  "stridor at rest",
  "work of breathing",
];

const CROUP_DEXAMETHASONE_ACTION_TERMS = [
  "corticosteroid",
  "dexamethasone",
  "steroid",
  "덱사메타손",
];

const CROUP_EPINEPHRINE_ACTION_TERMS = [
  "adrenaline",
  "epinephrine",
  "nebulized epinephrine",
  "racemic epinephrine",
  "에피네프린",
];

const CROUP_AIRWAY_ESCALATION_ACTION_TERMS = [
  "airway",
  "anaesthesia",
  "anesthesia",
  "ent",
  "icu",
  "intubation",
  "oxygen",
  "picu",
  "respiratory failure",
];

const CROUP_EPINEPHRINE_OBSERVATION_SAFETY_TERMS = [
  "2 to 4 hours",
  "2-4 hours",
  "observation",
  "observe",
  "recurrence",
  "rebound",
  "return of stridor",
];

const CROUP_DIFFERENTIAL_RED_FLAG_SAFETY_TERMS = [
  "anaphylaxis",
  "bacterial tracheitis",
  "drooling",
  "dysphagia",
  "epiglottitis",
  "foreign body",
  "toxic appearance",
];

const CROUP_LOW_VALUE_THERAPY_SAFETY_TERMS = [
  "antibiotic not indicated",
  "antibiotics rarely indicated",
  "avoid antibiotics",
  "avoid beta-agonist",
  "avoid bronchodilator",
  "avoid humidified air",
  "avoid mist",
  "bronchodilators rarely indicated",
  "humidified air not recommended",
];

const CROUP_DISPOSITION_ESCALATION_SAFETY_TERMS = [
  "anesthesia",
  "ent",
  "impending respiratory failure",
  "not sustained",
  "orl",
  "otolaryngology",
  "picu",
  "poor response",
  "return precautions",
];

const FOREIGN_BODY_AIRWAY_CONTEXT_TERMS = [
  "airway foreign body",
  "aspirated food",
  "aspirated foreign body",
  "aspirated nut",
  "aspirated peanut",
  "aspirated toy",
  "bronchial foreign body",
  "choked on",
  "choking episode",
  "foreign body airway obstruction",
  "foreign body aspiration",
  "inhaled foreign body",
  "tracheobronchial foreign body",
];

const FOREIGN_BODY_AIRWAY_RISK_TERMS = [
  "absent breath sounds",
  "asymmetric breath sounds",
  "cannot cough",
  "cannot talk",
  "choking",
  "cyanosis",
  "hypoxia",
  "inability to speak",
  "respiratory distress",
  "stridor",
  "sudden cough",
  "unilateral wheeze",
  "weak cough",
  "wheezing",
  "witnessed aspiration",
];

const FOREIGN_BODY_AIRWAY_ASSESSMENT_ACTION_TERMS = [
  "airway",
  "cannot talk",
  "choking severity",
  "effective cough",
  "oxygen",
  "pulse oximetry",
  "respiratory distress",
  "speak",
  "ventilation",
];

const FOREIGN_BODY_AIRWAY_INFANT_ACTION_TERMS = [
  "5 back blows",
  "back blows",
  "back slaps",
  "chest compressions",
  "chest thrust",
  "infant",
  "under 1",
  "younger than 1",
];

const FOREIGN_BODY_AIRWAY_CHILD_ADULT_ACTION_TERMS = [
  "abdominal thrust",
  "back blows",
  "back slaps",
  "chest thrust",
  "heimlich",
  "older than 1",
];

const FOREIGN_BODY_AIRWAY_BRONCHOSCOPY_ACTION_TERMS = [
  "anesthesia",
  "bronchoscopy",
  "ent",
  "foreign body removal",
  "otolaryngology",
  "pulmonology",
  "rigid bronchoscopy",
];

const FOREIGN_BODY_AIRWAY_NO_BLIND_SWEEP_SAFETY_TERMS = [
  "avoid blind finger",
  "blind finger sweep",
  "do not finger sweep",
  "no blind finger",
  "visible object only",
];

const FOREIGN_BODY_AIRWAY_XRAY_LIMITATION_SAFETY_TERMS = [
  "does not rule out",
  "normal chest x-ray",
  "normal radiograph",
  "normal x-ray",
  "radiolucent",
];

const FOREIGN_BODY_AIRWAY_PARTIAL_OBSTRUCTION_SAFETY_TERMS = [
  "effective cough",
  "encourage cough",
  "encourage coughing",
  "forceful cough",
  "let cough",
  "partial obstruction",
];

const FOREIGN_BODY_AIRWAY_POST_REMOVAL_SAFETY_TERMS = [
  "airway edema",
  "antibiotics not routine",
  "infection",
  "observation",
  "persistent symptoms",
  "post-removal",
  "steroids not routine",
  "stridor",
];

const ORBITAL_CELLULITIS_DIRECT_CONTEXT_TERMS = [
  "orbital cellulitis",
  "postseptal cellulitis",
  "post-septal cellulitis",
  "orbital abscess",
  "안와 봉와직염",
];

const ORBITAL_CELLULITIS_EYE_CONTEXT_TERMS = [
  "chemosis",
  "eye swelling",
  "eyelid swelling",
  "pain with eye movement",
  "proptosis",
  "red swollen eye",
  "안구 돌출",
  "안구운동통",
];

const ORBITAL_CELLULITIS_ORBITAL_SIGNS_CONTEXT_TERMS = [
  "decreased vision",
  "diplopia",
  "ophthalmoplegia",
  "painful eye movement",
  "proptosis",
  "restricted eye movement",
  "vision loss",
  "시력저하",
];

const ORBITAL_CELLULITIS_ORBITAL_ASSESSMENT_ACTION_TERMS = [
  "color vision",
  "extraocular movement",
  "eye movement",
  "iop",
  "ophthalmoplegia",
  "optic nerve",
  "pupil",
  "visual acuity",
  "시력",
];

const ORBITAL_CELLULITIS_IMAGING_ACTION_TERMS = [
  "ct brain",
  "ct orbit",
  "ct orbits",
  "ct sinus",
  "ct sinuses",
  "contrast ct",
  "mri",
  "orbit imaging",
  "sinus imaging",
  "영상",
];

const ORBITAL_CELLULITIS_ANTIBIOTIC_ACTION_TERMS = [
  "ampicillin-sulbactam",
  "antibiotic",
  "broad-spectrum",
  "ceftriaxone",
  "cefotaxime",
  "culture",
  "iv antibiotics",
  "metronidazole",
  "vancomycin",
  "항생제",
];

const ORBITAL_CELLULITIS_SPECIALIST_SOURCE_ACTION_TERMS = [
  "ent",
  "ophthalmology",
  "otolaryngology",
  "surgical drainage",
  "surgery",
  "source control",
  "subperiosteal abscess",
  "안과",
  "이비인후과",
];

const ORBITAL_CELLULITIS_PRESEPTAL_DIFFERENTIATION_SAFETY_TERMS = [
  "not preseptal",
  "ophthalmoplegia",
  "orbital septum",
  "pain with eye movement",
  "postseptal",
  "preseptal",
  "proptosis",
  "vision loss",
  "전중격",
];

const ORBITAL_CELLULITIS_ABSCESS_SURGERY_SAFETY_TERMS = [
  "abscess",
  "drainage",
  "failure to improve",
  "large abscess",
  "surgical drainage",
  "worsening visual acuity",
  "배농",
];

const ORBITAL_CELLULITIS_INTRACRANIAL_SAFETY_TERMS = [
  "brain abscess",
  "cavernous sinus thrombosis",
  "intracranial extension",
  "meningitis",
  "osteomyelitis",
  "sepsis",
  "해면정맥동",
  "두개내",
];

const ORBITAL_CELLULITIS_MONITORING_SAFETY_TERMS = [
  "color vision",
  "daily",
  "iop",
  "optic nerve",
  "pupil",
  "repeat exam",
  "visual acuity",
  "vision",
  "시력",
];

const GI_BLEED_CONTEXT_TERMS = [
  "acute blood loss anemia",
  "gastrointestinal bleeding",
  "gi bleed",
  "hematemesis",
  "hemorrhagic shock",
  "melena",
  "upper gi bleed",
  "variceal bleeding",
  "위장관 출혈",
  "토혈",
  "흑색변",
];

const GI_BLEED_RESUSCITATION_ACTION_TERMS = [
  "fluid",
  "fluid resuscitation",
  "hemodynamic",
  "large bore iv",
  "large-bore iv",
  "resuscitation",
  "shock",
  "two large bore",
  "two large-bore",
  "수액",
  "정맥로",
  "혈역학",
];

const GI_BLEED_BLOOD_PREP_ACTION_TERMS = [
  "blood products",
  "crossmatch",
  "cross-match",
  "massive transfusion",
  "packed rbc",
  "prbc",
  "transfusion",
  "type and cross",
  "type and screen",
  "교차시험",
  "수혈",
  "혈액형",
];

const GI_BLEED_SOURCE_CONTROL_ACTION_TERMS = [
  "endoscopy",
  "gastroenterology",
  "gi consult",
  "hemostasis",
  "source control",
  "urgent endoscopy",
  "내시경",
  "소화기",
  "지혈",
];

const GI_BLEED_REVERSAL_SAFETY_TERMS = [
  "anticoagulant",
  "anticoagulation",
  "antiplatelet",
  "coagulopathy",
  "doac",
  "inr",
  "platelet",
  "reversal",
  "warfarin",
  "와파린",
  "응고",
  "항응고",
  "항혈소판",
  "혈소판",
];

const GI_BLEED_TRANSFUSION_SAFETY_TERMS = [
  "blood type",
  "consent",
  "crossmatch",
  "cross-match",
  "transfusion reaction",
  "type and screen",
  "교차시험",
  "동의",
  "수혈 반응",
  "수혈반응",
  "혈액형",
];

const CNS_INFECTION_CONTEXT_TERMS = [
  "bacterial meningitis",
  "meningitis",
  "수막염",
  "뇌수막염",
  "중추신경계 감염",
];

const CNS_INFECTION_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "culture",
  "cultures",
  "배양",
  "혈액배양",
  "혈액 배양",
];

const CNS_INFECTION_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "antimicrobial",
  "antimicrobials",
  "ceftriaxone",
  "empiric",
  "vancomycin",
  "항균제",
  "항생제",
];

const CNS_INFECTION_NO_DELAY_ACTION_TERMS = [
  "do not delay",
  "immediate",
  "immediately",
  "no delay",
  "not delay",
  "within 1 hour",
  "within one hour",
  "지연",
  "즉시",
];

const CNS_INFECTION_LP_CT_ACTION_TERMS = [
  "ct before lp",
  "head ct",
  "lp",
  "lumbar puncture",
  "neuroimaging",
  "spinal tap",
  "뇌영상",
  "요추천자",
];

const CNS_INFECTION_STEROID_ACTION_TERMS = [
  "dexamethasone",
  "steroid",
  "steroids",
  "덱사메타손",
  "스테로이드",
];

const CNS_INFECTION_ANTIMICROBIAL_SAFETY_TERMS = [
  "allergies",
  "allergy",
  "creatinine",
  "dose",
  "dosing",
  "egfr",
  "kidney",
  "renal",
  "vancomycin",
  "신장",
  "알레르기",
  "용량",
  "콩팥",
  "크레아티닌",
];

const CNS_INFECTION_LP_SAFETY_TERMS = [
  "anticoagulant",
  "coagulopathy",
  "ct before lp",
  "focal neurologic deficit",
  "head ct",
  "increased intracranial pressure",
  "lp contraindication",
  "mass lesion",
  "papilledema",
  "platelet",
  "요추천자",
  "응고",
  "항응고",
  "혈소판",
];

const CNS_INFECTION_STEROID_SAFETY_TERMS = [
  "before antibiotics",
  "before or with antibiotics",
  "dexamethasone",
  "steroid",
  "steroids",
  "덱사메타손",
  "스테로이드",
];

const CNS_INFECTION_DELAY_SAFETY_TERMS = [
  "antibiotics before imaging",
  "antibiotics before neuroimaging",
  "blood cultures then antibiotics",
  "clinically significant delay",
  "do not delay antibiotics",
  "imaging must not delay",
  "lp must not delay",
  "not delay antibiotics",
  "stabilize before imaging",
  "within 1 hour",
  "within one hour",
];

const CNS_INFECTION_CT_BEFORE_LP_INDICATION_SAFETY_TERMS = [
  "abnormal pupillary",
  "altered consciousness",
  "ct before lp",
  "focal neurologic",
  "focal seizure",
  "gcs",
  "immunocompromised",
  "mass lesion",
  "papilledema",
  "raised intracranial pressure",
  "space-occupying lesion",
];

const CNS_INFECTION_LISTERIA_COVERAGE_SAFETY_TERMS = [
  "ampicillin",
  "benzylpenicillin",
  "immunocompromised",
  "listeria",
  "older adult",
  "pregnancy",
  "pregnant",
];

const ENCEPHALITIS_CONTEXT_TERMS = [
  "encephalitis",
  "herpes encephalitis",
  "herpes simplex encephalitis",
  "hsv encephalitis",
  "meningoencephalitis",
];

const ENCEPHALITIS_RISK_TERMS = [
  "altered mental status",
  "aphasia",
  "behavior change",
  "confusion",
  "focal neurologic",
  "fever",
  "new seizure",
  "seizure",
  "temporal lobe",
];

const ENCEPHALITIS_MENTAL_STATUS_RED_FLAG_TERMS = [
  "altered mental",
  "behavior change",
  "confusion",
  "encephalopathy",
  "memory",
  "personality",
  "psychosis",
];

const ENCEPHALITIS_FOCAL_SEIZURE_RED_FLAG_TERMS = [
  "aphasia",
  "focal neurologic",
  "new seizure",
  "seizure",
  "status epilepticus",
  "temporal lobe",
];

const ENCEPHALITIS_ACYCLOVIR_ACTION_TERMS = ["acyclovir", "aciclovir"];

const ENCEPHALITIS_NEUROIMAGING_ACTION_TERMS = [
  "brain mri",
  "ct",
  "mri",
  "neuroimaging",
];

const ENCEPHALITIS_CSF_HSV_ACTION_TERMS = [
  "csf",
  "herpes simplex pcr",
  "hsv pcr",
  "lp",
  "lumbar puncture",
  "pcr",
];

const ENCEPHALITIS_EEG_SEIZURE_ACTION_TERMS = [
  "eeg",
  "nonconvulsive",
  "seizure",
  "status epilepticus",
];

const ENCEPHALITIS_ACYCLOVIR_RENAL_SAFETY_TERMS = [
  "creatinine",
  "hydration",
  "kidney",
  "renal",
  "renal dosing",
];

const ENCEPHALITIS_NO_DELAY_SAFETY_TERMS = [
  "do not delay acyclovir",
  "do not wait",
  "empiric acyclovir",
  "pending diagnostic",
  "pending lp",
  "pending pcr",
];

const ENCEPHALITIS_REPEAT_PCR_SAFETY_TERMS = [
  "3-7 days",
  "3 to 7 days",
  "negative hsv pcr",
  "repeat hsv pcr",
  "repeat pcr",
  "temporal lobe",
];

const ENCEPHALITIS_DIFFERENTIAL_EMPIRIC_SAFETY_TERMS = [
  "bacterial meningitis",
  "ceftriaxone",
  "doxycycline",
  "rickettsial",
  "vancomycin",
];

const IMMUNOCOMPROMISED_ENCEPHALITIS_CONTEXT_TERMS = [
  "aids",
  "chemotherapy",
  "hiv",
  "immunocompromised",
  "immunosuppressed",
  "neutropenia",
  "steroid",
  "transplant",
];

const IMMUNOCOMPROMISED_ENCEPHALITIS_HERPESVIRUS_SAFETY_TERMS = [
  "acyclovir",
  "cmv",
  "cytomegalovirus",
  "foscarnet",
  "ganciclovir",
  "hhv-6",
  "varicella",
  "vzv",
];

const IMMUNOCOMPROMISED_ENCEPHALITIS_OPPORTUNISTIC_SAFETY_TERMS = [
  "amphotericin",
  "ampicillin",
  "cryptococcus",
  "jc virus",
  "listeria",
  "pml",
  "toxoplasma",
  "tuberculosis",
];

const IMMUNOCOMPROMISED_ENCEPHALITIS_HOST_RISK_SAFETY_TERMS = [
  "cd4",
  "hiv",
  "immunosuppression",
  "infectious disease",
  "transplant",
];

const SUICIDE_SELF_HARM_CONTEXT_TERMS = [
  "self harm",
  "self injury",
  "self-harm",
  "self-injury",
  "suicidal ideation",
  "suicide attempt",
  "suicide risk",
  "thinking about killing yourself",
  "thoughts of killing yourself",
  "wanting to die",
  "wants to die",
];

const SUICIDE_SELF_HARM_RISK_TERMS = [
  "access to means",
  "current suicidal thoughts",
  "firearm",
  "gun",
  "hopeless",
  "intent",
  "lethal means",
  "method",
  "overdose",
  "plan",
  "prior attempt",
  "substance use",
  "suicide note",
  "thinking about killing",
];

const SUICIDE_RISK_ASSESSMENT_ACTION_TERMS = [
  "asq",
  "brief suicide safety assessment",
  "intent",
  "plan",
  "suicide risk assessment",
  "suicide safety assessment",
];

const SUICIDE_MEANS_RESTRICTION_ACTION_TERMS = [
  "access to means",
  "firearm",
  "gun",
  "lethal means",
  "medications",
  "remove dangerous items",
  "secure dangerous items",
];

const SUICIDE_OBSERVATION_ESCALATION_ACTION_TERMS = [
  "1:1",
  "cannot be left alone",
  "constant observation",
  "emergency psychiatric evaluation",
  "mental health evaluation",
  "psychiatry",
  "psych consult",
  "sitter",
  "urgent/stat",
];

const SUICIDE_CRISIS_RESOURCE_ACTION_TERMS = [
  "988",
  "crisis",
  "crisis line",
  "lifeline",
  "safety plan",
];

const SUICIDE_PAST_ATTEMPT_SAFETY_TERMS = [
  "past behavior",
  "past self-injury",
  "prior attempt",
  "previous attempt",
  "suicide attempt history",
];

const SUICIDE_SUBSTANCE_MEDICAL_SAFETY_TERMS = [
  "alcohol",
  "intoxication",
  "medical clearance",
  "overdose",
  "substance use",
  "toxicity",
];

const SUICIDE_DISPOSITION_SAFETY_TERMS = [
  "do not discharge",
  "emergency psychiatric evaluation",
  "full mental health",
  "involuntary",
  "psychiatric hold",
  "safe disposition",
  "safety plan",
];

const SUICIDE_SUPPORT_FOLLOWUP_SAFETY_TERMS = [
  "follow-up",
  "mental health referral",
  "resource list",
  "support network",
  "trusted person",
  "warm handoff",
];

const MENINGOCOCCEMIA_CONTEXT_TERMS = [
  "invasive meningococcal disease",
  "meningococcemia",
  "meningococcal disease",
  "meningococcal sepsis",
  "meningococcal septicemia",
  "neisseria meningitidis",
  "purpura fulminans",
  "waterhouse-friderichsen",
];

const MENINGOCOCCEMIA_RISK_TERMS = [
  "adrenal hemorrhage",
  "coagulopathy",
  "dic",
  "disseminated intravascular coagulation",
  "hypotension",
  "lactate",
  "non-blanching rash",
  "nonblanching rash",
  "petechiae",
  "petechial",
  "purpura",
  "rash",
  "sepsis",
  "septic shock",
  "shock",
  "thrombocytopenia",
];

const MENINGOCOCCEMIA_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "culture",
  "cultures",
  "naat",
  "pcr",
  "serogroup",
];

const MENINGOCOCCEMIA_CEPHALOSPORIN_ACTION_TERMS = [
  "cefotaxime",
  "ceftriaxone",
  "cephalosporin",
  "empiric antibiotic",
  "empiric antibiotics",
  "extended-spectrum",
];

const MENINGOCOCCEMIA_SHOCK_ACTION_TERMS = [
  "fluid",
  "fluids",
  "icu",
  "lactate",
  "norepinephrine",
  "sepsis bundle",
  "septic shock",
  "shock",
  "vasopressor",
];

const MENINGOCOCCEMIA_PRECAUTION_ACTION_TERMS = [
  "droplet",
  "infection control",
  "isolation",
  "public health",
  "standard precautions",
];

const MENINGOCOCCEMIA_ANTIBIOTIC_DELAY_SAFETY_TERMS = [
  "do not delay",
  "do-not-delay",
  "immediate antibiotic",
  "not delay antibiotics",
  "prioritize antibiotics",
];

const MENINGOCOCCEMIA_INFECTION_CONTROL_SAFETY_TERMS = [
  "24 hours",
  "droplet",
  "effective therapy",
  "infection control",
  "isolation",
  "mask",
  "standard precautions",
];

const MENINGOCOCCEMIA_CONTACT_PUBLIC_HEALTH_SAFETY_TERMS = [
  "chemoprophylaxis",
  "ciprofloxacin",
  "close contact",
  "contact prophylaxis",
  "household contact",
  "public health",
  "rifampin",
];

const MENINGOCOCCEMIA_COAGULATION_COMPLICATION_SAFETY_TERMS = [
  "adrenal hemorrhage",
  "coagulation",
  "dic",
  "disseminated intravascular coagulation",
  "limb ischemia",
  "platelet",
  "purpura fulminans",
  "waterhouse-friderichsen",
];

const FEBRILE_INFANT_CONTEXT_TERMS = [
  "0-21 days",
  "0-28 days",
  "0-60 days",
  "0-90 days",
  "8-21 days",
  "22-28 days",
  "29-60 days",
  "29-90 days",
  "febrile infant",
  "fever without source",
  "infant fever",
  "neonatal fever",
  "neonate with fever",
  "young infant fever",
];

const FEBRILE_INFANT_RISK_TERMS = [
  "38.0",
  "100.4",
  "bacteremia",
  "fever",
  "hypothermia",
  "ill appearing",
  "invasive bacterial infection",
  "meningitis",
  "serious bacterial infection",
  "sepsis",
];

const FEBRILE_INFANT_AGE_STRATIFICATION_ACTION_TERMS = [
  "0-21",
  "22-28",
  "29-60",
  "29-90",
  "age band",
  "age group",
  "days old",
  "risk stratification",
];

const FEBRILE_INFANT_BLOOD_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
];

const FEBRILE_INFANT_URINE_CULTURE_ACTION_TERMS = [
  "catheterized urine",
  "urinalysis",
  "urine culture",
];

const FEBRILE_INFANT_CSF_CULTURE_ACTION_TERMS = [
  "csf culture",
  "csf studies",
  "lumbar puncture",
  "spinal tap",
];

const FEBRILE_INFANT_INFLAMMATORY_MARKER_ACTION_TERMS = [
  "anc",
  "cbc",
  "crp",
  "inflammatory marker",
  "inflammatory markers",
  "procalcitonin",
];

const FEBRILE_INFANT_ANTIBIOTIC_ACTION_TERMS = [
  "ampicillin",
  "antibiotic",
  "cefotaxime",
  "ceftriaxone",
  "ceftazidime",
  "gentamicin",
];

const FEBRILE_INFANT_HSV_ACTION_TERMS = [
  "acyclovir",
  "altered mental status",
  "csf pleocytosis",
  "hsv",
  "hypothermia",
  "seizure",
  "transaminitis",
  "vesicle",
];

const FEBRILE_INFANT_ANTIBIOTIC_DELAY_SAFETY_TERMS = [
  "do not delay",
  "do-not-delay",
  "do not wait",
  "immediate antibiotic",
  "not delay antibiotics",
];

const FEBRILE_INFANT_CEFTRIAXONE_SAFETY_TERMS = [
  "bilirubin",
  "calcium",
  "ceftriaxone",
  "hyperbilirubinemia",
  "neonate",
  "safety criteria",
];

const FEBRILE_INFANT_DISPOSITION_SAFETY_TERMS = [
  "24 hours",
  "24-36 hours",
  "24-48 hours",
  "admission",
  "admit",
  "culture results",
  "follow-up",
  "hospitalize",
  "observation",
  "reliable follow-up",
];

const FEBRILE_INFANT_LOW_RISK_SAFETY_TERMS = [
  "discharge criteria",
  "follow-up",
  "inflammatory markers",
  "low risk",
  "low-risk",
  "shared decision",
  "urinalysis",
];

const NEONATAL_SEPSIS_CONTEXT_TERMS = [
  "early-onset neonatal infection",
  "early onset neonatal infection",
  "early-onset sepsis",
  "early onset sepsis",
  "gbs",
  "group b strep",
  "group b streptococcus",
  "late-onset neonatal infection",
  "late onset neonatal infection",
  "late-onset sepsis",
  "late onset sepsis",
  "neonatal bacterial infection",
  "neonatal infection",
  "neonatal meningitis",
  "neonatal sepsis",
  "newborn sepsis",
];

const NEONATAL_SEPSIS_NEONATAL_CONTEXT_TERMS = [
  "days old",
  "first month",
  "infant",
  "neonate",
  "neonatal",
  "newborn",
  "preterm",
  "weeks old",
];

const NEONATAL_SEPSIS_MATERNAL_RISK_TERMS = [
  "chorioamnionitis",
  "gbs bacteriuria",
  "gbs colonization",
  "maternal fever",
  "maternal sepsis",
  "prolonged rupture",
  "rupture of membranes",
];

const NEONATAL_SEPSIS_RISK_TERMS = [
  "abdominal distension",
  "altered responsiveness",
  "apnea",
  "apnoea",
  "ashen",
  "bradycardia",
  "bulging fontanelle",
  "cyanosis",
  "fever",
  "feeding difficulty",
  "floppiness",
  "grunting",
  "hypoglycemia",
  "hypothermia",
  "hypoxia",
  "mechanical ventilation",
  "metabolic acidosis",
  "mottled",
  "non-blanching rash",
  "poor feeding",
  "respiratory distress",
  "seizure",
  "shock",
  "tachycardia",
  "temperature abnormality",
  "thrombocytopenia",
];

const NEONATAL_SEPSIS_ASSESSMENT_ACTION_TERMS = [
  "immediate clinical assessment",
  "maternal history",
  "neonatal history",
  "physical examination",
  "vital signs",
];

const NEONATAL_SEPSIS_CULTURE_CRP_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
];

const NEONATAL_SEPSIS_BASELINE_MARKER_ACTION_TERMS = [
  "baseline crp",
  "c-reactive protein",
  "cbc",
  "crp",
];

const NEONATAL_SEPSIS_BETA_LACTAM_ACTION_TERMS = [
  "amoxicillin",
  "ampicillin",
  "benzylpenicillin",
  "penicillin",
];

const NEONATAL_SEPSIS_GRAM_NEGATIVE_ACTION_TERMS = [
  "cefotaxime",
  "gentamicin",
];

const NEONATAL_SEPSIS_LP_ACTION_TERMS = [
  "csf",
  "lumbar puncture",
  "meningitis",
  "spinal tap",
];

const NEONATAL_SEPSIS_STABILIZATION_ACTION_TERMS = [
  "airway",
  "fluid",
  "fluids",
  "glucose",
  "icu",
  "mechanical ventilation",
  "nicu",
  "oxygen",
  "respiratory support",
  "shock",
  "vasopressor",
  "ventilation",
];

const NEONATAL_SEPSIS_ANTIBIOTIC_DELAY_SAFETY_TERMS = [
  "do not delay",
  "do-not-delay",
  "do not wait",
  "not wait for test results",
  "without waiting",
];

const NEONATAL_SEPSIS_LP_CONTRAINDICATION_SAFETY_TERMS = [
  "bleeding risk",
  "raised intracranial pressure",
  "respiratory compromise",
  "shock",
  "stabilize before lumbar puncture",
  "uncontrolled seizure",
  "unprotected airway",
];

const NEONATAL_SEPSIS_GENTAMICIN_SAFETY_TERMS = [
  "creatinine",
  "gentamicin concentration",
  "gentamicin level",
  "renal",
  "trough",
];

const NEONATAL_SEPSIS_DURATION_REASSESSMENT_SAFETY_TERMS = [
  "24 hours",
  "36 hours",
  "48 hours",
  "7 days",
  "blood culture",
  "clinical progress",
  "crp trend",
  "daily review",
  "negative culture",
  "positive culture",
];

const NEONATAL_HSV_CONTEXT_TERMS = [
  "congenital herpes simplex",
  "congenital hsv",
  "disseminated hsv",
  "neonatal herpes",
  "neonatal herpes simplex",
  "neonatal hsv",
  "sem disease",
  "skin eye mouth hsv",
];

const NEONATAL_HSV_NEONATAL_CONTEXT_TERMS = [
  "days old",
  "first month",
  "infant",
  "neonate",
  "neonatal",
  "newborn",
  "up to 6 weeks",
  "weeks old",
];

const NEONATAL_HSV_RISK_TERMS = [
  "abnormal csf",
  "active lesions at delivery",
  "apnea",
  "coagulopathy",
  "conjunctivitis",
  "csf pleocytosis",
  "elevated liver",
  "fever",
  "hepatitis",
  "hypothermia",
  "lethargy",
  "maternal genital herpes",
  "mucocutaneous vesicles",
  "negative bacterial cultures",
  "poor feeding",
  "respiratory distress",
  "seizure",
  "sepsis-like",
  "thrombocytopenia",
  "transaminitis",
  "vesicle",
  "vesicular",
];

const NEONATAL_HSV_ACYCLOVIR_ACTION_TERMS = [
  "20 mg/kg",
  "intravenous acyclovir",
  "iv acyclovir",
  "parenteral acyclovir",
  "systemic acyclovir",
];

const NEONATAL_HSV_SURFACE_LESION_ACTION_TERMS = [
  "anus",
  "conjunctiva",
  "lesion pcr",
  "mouth",
  "mucosal surface",
  "nasopharynx",
  "skin vesicle",
  "surface culture",
  "surface cultures",
  "surface pcr",
  "vesicle culture",
];

const NEONATAL_HSV_CSF_ACTION_TERMS = [
  "csf hsv pcr",
  "lumbar puncture",
];

const NEONATAL_HSV_BLOOD_ALT_ACTION_TERMS = [
  "alt",
  "blood hsv pcr",
  "serum alt",
  "transaminase",
  "whole blood pcr",
];

const NEONATAL_HSV_SEPSIS_COVERAGE_ACTION_TERMS = [
  "ampicillin",
  "blood culture",
  "blood cultures",
  "empiric antibiotics",
  "gentamicin",
  "nicu",
  "sepsis evaluation",
  "supportive care",
];

const NEONATAL_HSV_DURATION_REPEAT_CSF_SAFETY_TERMS = [
  "14 days",
  "21 days",
  "repeat csf pcr",
  "repeat lumbar puncture",
  "suppressive",
  "six months",
];

const NEONATAL_HSV_RENAL_ANC_SAFETY_TERMS = [
  "absolute neutrophil",
  "anc",
  "creatinine",
  "dose adjustment",
  "hydration",
  "neutropenia",
  "renal",
];

const NEONATAL_HSV_OPHTHALMOLOGY_NEURO_SAFETY_TERMS = [
  "audiology",
  "eye exam",
  "head ultrasound",
  "mri",
  "neuroimaging",
  "ophthalmology",
];

const NEONATAL_HSV_EXPERT_EXPOSURE_SAFETY_TERMS = [
  "active lesion",
  "infectious disease",
  "maternal",
  "pediatric infectious disease",
  "scalp electrode",
];

const NEONATAL_HYPERBILIRUBINEMIA_CONTEXT_TERMS = [
  "acute bilirubin encephalopathy",
  "kernicterus",
  "neonatal hyperbilirubinemia",
  "neonatal jaundice",
  "newborn hyperbilirubinemia",
  "newborn jaundice",
  "pathologic jaundice",
  "phototherapy threshold",
  "tsb above phototherapy threshold",
  "신생아 황달",
];

const NEONATAL_HYPERBILIRUBINEMIA_RISK_TERMS = [
  "age in hours",
  "bilirubin",
  "direct bilirubin",
  "exchange transfusion",
  "g6pd",
  "hemolysis",
  "jaundice",
  "phototherapy",
  "total serum bilirubin",
  "transcutaneous bilirubin",
  "tsb",
];

const NEONATAL_HYPERBILIRUBINEMIA_THRESHOLD_ACTION_TERMS = [
  "age in hours",
  "bilirubin threshold",
  "gestational age",
  "hour-specific",
  "neurotoxicity risk",
  "phototherapy threshold",
  "risk factor",
  "total serum bilirubin",
  "transcutaneous bilirubin",
  "tsb",
  "tcb",
];

const NEONATAL_HYPERBILIRUBINEMIA_PHOTOTHERAPY_ACTION_TERMS = [
  "intensive phototherapy",
  "irradiance",
  "led phototherapy",
  "phototherapy",
  "빛치료",
  "광선치료",
];

const NEONATAL_HYPERBILIRUBINEMIA_ESCALATION_ACTION_TERMS = [
  "2 mg/dl below",
  "exchange transfusion",
  "escalation of care",
  "iv hydration",
  "neonatologist",
  "nicu",
  "urgent transfer",
];

const NEONATAL_HYPERBILIRUBINEMIA_LAB_TREND_ACTION_TERMS = [
  "albumin",
  "cbc",
  "complete blood count",
  "dat",
  "direct bilirubin",
  "g6pd",
  "hemolysis",
  "repeat bilirubin",
  "total bilirubin",
  "type and crossmatch",
];

const NEONATAL_HYPERBILIRUBINEMIA_NEUROTOXICITY_SAFETY_TERMS = [
  "albumin",
  "g6pd",
  "hemolysis",
  "isoimmune",
  "neurotoxicity risk",
  "sepsis",
  "significant clinical instability",
];

const NEONATAL_HYPERBILIRUBINEMIA_ACUTE_ENCEPHALOPATHY_SAFETY_TERMS = [
  "acute bilirubin encephalopathy",
  "arching",
  "hypertonia",
  "high-pitched cry",
  "opisthotonos",
  "recurrent apnea",
  "retrocollis",
  "urgent exchange transfusion",
];

const NEONATAL_HYPERBILIRUBINEMIA_DIRECT_BILIRUBIN_SAFETY_TERMS = [
  "cholestasis",
  "conjugated bilirubin",
  "direct bilirubin",
  "do not subtract",
  "expert consult",
  "subtract direct",
];

const NEONATAL_HYPERBILIRUBINEMIA_FOLLOWUP_SAFETY_TERMS = [
  "24-48 hours",
  "daily bilirubin",
  "discharge follow-up",
  "feeding adequacy",
  "follow-up",
  "rebound",
  "repeat bilirubin",
  "weight trajectory",
];

const ABUSIVE_HEAD_TRAUMA_CONTEXT_TERMS = [
  "abusive head trauma",
  "battered child",
  "child physical abuse",
  "inflicted head trauma",
  "non-accidental trauma",
  "nonaccidental trauma",
  "physical abuse",
  "shaken baby",
  "suspected abuse",
  "suspected physical abuse",
];

const ABUSIVE_HEAD_TRAUMA_RISK_TERMS = [
  "apnea",
  "bruising before cruising",
  "bulging fontanelle",
  "frenulum tear",
  "inconsistent history",
  "lethargy",
  "metaphyseal",
  "retinal hemorrhage",
  "rib fracture",
  "seizure",
  "skull fracture",
  "subdural hematoma",
  "ten-4",
  "vomiting",
];

const ABUSIVE_HEAD_TRAUMA_STABILIZATION_ACTION_TERMS = [
  "airway",
  "cerebral perfusion",
  "icp",
  "intracranial pressure",
  "neurosurgery",
  "picu",
  "seizure",
  "stabilization",
];

const ABUSIVE_HEAD_TRAUMA_NEUROIMAGING_ACTION_TERMS = [
  "ct head",
  "head ct",
  "mri brain",
  "mri head",
  "neuroimaging",
  "noncontrast head ct",
];

const ABUSIVE_HEAD_TRAUMA_SKELETAL_SURVEY_ACTION_TERMS = [
  "long bone",
  "rib",
  "skeletal survey",
  "skull",
  "spine",
];

const ABUSIVE_HEAD_TRAUMA_OPHTHALMOLOGY_ACTION_TERMS = [
  "fundoscopic",
  "ophthalmologic",
  "ophthalmology",
  "retinal exam",
  "retinal hemorrhage",
];

const ABUSIVE_HEAD_TRAUMA_PROTECTION_ACTION_TERMS = [
  "child abuse pediatrics",
  "child protective",
  "child welfare",
  "cps",
  "mandated report",
  "mandatory report",
  "safe discharge",
  "social work",
];

const ABUSIVE_HEAD_TRAUMA_HISTORY_SAFETY_TERMS = [
  "developmental",
  "history inconsistent",
  "inconsistent history",
  "mechanism",
  "plausible explanation",
  "revised history",
];

const ABUSIVE_HEAD_TRAUMA_MIMIC_COAG_SAFETY_TERMS = [
  "bone fragility",
  "coagulation",
  "coagulopathy",
  "factor",
  "hematology",
  "metabolic bone",
  "partial thromboplastin time",
  "prothrombin time",
  "ptt",
];

const ABUSIVE_HEAD_TRAUMA_OCCULT_INJURY_SAFETY_TERMS = [
  "abdominal ct",
  "alt",
  "ast",
  "cmp",
  "troponin",
  "urinalysis",
  "visceral injury",
];

const ABUSIVE_HEAD_TRAUMA_REPEAT_SURVEY_SAFETY_TERMS = [
  "10 to 14 days",
  "10-14 days",
  "2 to 3 weeks",
  "2-3 weeks",
  "follow-up skeletal survey",
  "repeat skeletal survey",
];

const ABUSIVE_HEAD_TRAUMA_DISPOSITION_SAFETY_TERMS = [
  "child protective",
  "child welfare",
  "cps",
  "law enforcement",
  "safe home",
  "safe home environment",
  "safe placement",
  "safety plan",
];

const ECTOPIC_PREGNANCY_CONTEXT_TERMS = [
  "ectopic pregnancy",
  "pregnancy of unknown location",
  "pregnant with abdominal pain",
  "pregnant with pelvic pain",
  "pregnant with syncope",
  "pregnant with vaginal bleeding",
  "ruptured ectopic",
  "tubal pregnancy",
  "자궁외임신",
  "자궁외 임신",
];

const ECTOPIC_PREGNANCY_HCG_ACTION_TERMS = [
  "beta hcg",
  "beta-hcg",
  "hcg",
  "pregnancy test",
  "quantitative hcg",
  "β-hcg",
  "임신반응",
  "임신 검사",
];

const ECTOPIC_PREGNANCY_ULTRASOUND_ACTION_TERMS = [
  "pelvic ultrasound",
  "transvaginal ultrasound",
  "tvu",
  "tvus",
  "ultrasound",
  "초음파",
  "질식초음파",
];

const ECTOPIC_PREGNANCY_ESCALATION_ACTION_TERMS = [
  "emergency surgery",
  "gynecology",
  "hemodynamic",
  "ob consult",
  "ob/gyn",
  "obgyn",
  "operative",
  "rupture",
  "surgery",
  "unstable",
  "산부인과",
  "수술",
  "파열",
  "혈역학",
];

const ECTOPIC_PREGNANCY_RH_SAFETY_TERMS = [
  "anti-d",
  "blood type",
  "rh",
  "rhesus",
  "혈액형",
];

const ECTOPIC_PREGNANCY_MTX_LAB_SAFETY_TERMS = [
  "alt",
  "ast",
  "cbc",
  "complete blood count",
  "creatinine",
  "liver function",
  "renal function",
  "간기능",
  "신장",
];

const ECTOPIC_PREGNANCY_MTX_CONTRAINDICATION_SAFETY_TERMS = [
  "alcoholism",
  "anemia",
  "breastfeeding",
  "hepatic disease",
  "immunodeficiency",
  "leukopenia",
  "methotrexate contraindication",
  "peptic ulcer",
  "renal disease",
  "thrombocytopenia",
  "메토트렉세이트 금기",
];

const ECTOPIC_PREGNANCY_HEMODYNAMIC_SAFETY_TERMS = [
  "hemodynamic",
  "hemoperitoneum",
  "hypotension",
  "peritoneal",
  "shock",
  "syncope",
  "unstable",
  "복막",
  "실신",
  "저혈압",
  "혈역학",
];

const POSTPARTUM_HEMORRHAGE_CONTEXT_TERMS = [
  "massive obstetric hemorrhage",
  "post-partum hemorrhage",
  "postpartum haemorrhage",
  "postpartum hemorrhage",
  "pph",
  "retained placenta",
  "uterine atony",
  "산후출혈",
];

const POSTPARTUM_HEMORRHAGE_SEVERE_RISK_TERMS = [
  "boggy uterus",
  "hemorrhage",
  "hypotension",
  "massive bleeding",
  "shock",
  "tachycardia",
  "uterine atony",
  "vaginal bleeding",
];

const POSTPARTUM_HEMORRHAGE_RESUSCITATION_ACTION_TERMS = [
  "blood product",
  "crossmatch",
  "hemorrhage protocol",
  "large-bore",
  "massive transfusion",
  "transfusion",
  "type and screen",
];

const POSTPARTUM_HEMORRHAGE_UTEROTONIC_ACTION_TERMS = [
  "fundal massage",
  "methylergonovine",
  "misoprostol",
  "oxytocin",
  "uterine massage",
  "uterotonic",
];

const POSTPARTUM_HEMORRHAGE_TXA_ACTION_TERMS = ["tranexamic acid", "txa"];

const POSTPARTUM_HEMORRHAGE_SOURCE_ACTION_TERMS = [
  "4 ts",
  "atony",
  "laceration",
  "retained placenta",
  "retained tissue",
  "thrombin",
  "tissue",
  "tone",
  "trauma",
];

const POSTPARTUM_HEMORRHAGE_ESCALATION_ACTION_TERMS = [
  "bakri",
  "balloon tamponade",
  "b-lynch",
  "hysterectomy",
  "obstetric",
  "operating room",
  "surgery",
  "uterine tamponade",
];

const POSTPARTUM_HEMORRHAGE_UTEROTONIC_SAFETY_TERMS = [
  "asthma",
  "carboprost",
  "hypertension",
  "methylergonovine",
  "misoprostol",
  "preeclampsia",
];

const POSTPARTUM_HEMORRHAGE_TXA_SAFETY_TERMS = [
  "3 hours",
  "thromboembolism",
  "tranexamic acid contraindication",
  "txa contraindication",
  "within 3 hours",
];

const POSTPARTUM_HEMORRHAGE_COAG_TRANSFUSION_SAFETY_TERMS = [
  "coagulopathy",
  "fibrinogen",
  "inr",
  "platelet",
  "shock index",
  "viscoelastic",
];

const POSTPARTUM_HEMORRHAGE_RETAINED_TRAUMA_SAFETY_TERMS = [
  "genital tract",
  "laceration",
  "manual removal",
  "retained placenta",
  "retained tissue",
  "rupture",
  "uterine inversion",
];

const POSTPARTUM_HEMORRHAGE_ESCALATION_SAFETY_TERMS = [
  "balloon",
  "interventional radiology",
  "laparotomy",
  "packing",
  "surgical",
  "tamponade",
];

const SEVERE_PREECLAMPSIA_CONTEXT_TERMS = [
  "eclampsia",
  "postpartum preeclampsia",
  "preeclampsia with severe features",
  "severe pre-eclampsia",
  "severe preeclampsia",
  "severe-range blood pressure in pregnancy",
  "severe hypertension in pregnancy",
  "임신중독증",
  "전자간증",
  "자간증",
];

const SEVERE_PREECLAMPSIA_MAGNESIUM_ACTION_TERMS = [
  "magnesium sulfate",
  "mgso4",
  "황산마그네슘",
];

const SEVERE_PREECLAMPSIA_SEIZURE_ACTION_TERMS = [
  "seizure prophylaxis",
  "seizure treatment",
  "seizure prevention",
  "eclampsia",
  "자간증",
];

const SEVERE_PREECLAMPSIA_SEVERE_BP_ACTION_TERMS = [
  "acute severe hypertension",
  "acute severe-range",
  "30 to 60 minutes",
  "within 60 minutes",
  "persistent for 15 minutes",
  "persistent severe hypertension",
  "severe-range",
  "160/110",
  "160 mm hg",
  "110 mm hg",
];

const SEVERE_PREECLAMPSIA_ANTIHYPERTENSIVE_MED_ACTION_TERMS = [
  "hydralazine",
  "labetalol",
  "nifedipine",
  "immediate-release nifedipine",
  "intravenous labetalol",
  "intravenous hydralazine",
  "iv labetalol",
  "iv hydralazine",
];

const SEVERE_PREECLAMPSIA_DELIVERY_ACTION_TERMS = [
  "cesarean",
  "c-section",
  "delivery",
  "delivery planning",
  "expectant management",
  "expedite delivery",
  "induction",
  "분만",
];

const SEVERE_PREECLAMPSIA_DELIVERY_TIMING_TERMS = [
  "34 0/7",
  "34 weeks",
  "34주",
  "after maternal stabilization",
  "after stabilization",
  "expectant management",
  "gestational age",
  "maternal stabilization",
  "maternal-fetal status",
  "once stabilized",
  "stabilize mother",
  "분만 시기",
  "재태연령",
];

const SEVERE_PREECLAMPSIA_ESCALATION_ACTION_TERMS = [
  "consult",
  "critical care",
  "eclampsia",
  "icu",
  "maternal-fetal medicine",
  "obstetric",
  "pulmonary edema",
  "seizure",
  "중환자",
];

const SEVERE_PREECLAMPSIA_MAGNESIUM_RESPIRATORY_SAFETY_TERMS = [
  "respiratory depression",
  "respiratory rate",
  "respiratory status",
  "apnea",
];

const SEVERE_PREECLAMPSIA_MAGNESIUM_REFLEX_SAFETY_TERMS = [
  "deep tendon reflex",
  "magnesium toxicity",
  "reflex",
  "반사",
];

const SEVERE_PREECLAMPSIA_MAGNESIUM_URINE_SAFETY_TERMS = [
  "urine output",
  "urine output < 30",
  "urine output less than 30",
  "소변",
];

const SEVERE_PREECLAMPSIA_MAGNESIUM_ANTIDOTE_SAFETY_TERMS = [
  "calcium gluconate",
  "magnesium antidote",
];

const SEVERE_PREECLAMPSIA_LABETALOL_SAFETY_TERMS = [
  "asthma",
  "bradycardia",
  "cardiomyopathy",
  "heart failure",
];

const SEVERE_PREECLAMPSIA_NIFEDIPINE_SAFETY_TERMS = [
  "hypotension",
  "tachycardia",
];

const SEVERE_PREECLAMPSIA_PLATELET_LAB_SAFETY_TERMS = ["platelet", "혈소판"];

const SEVERE_PREECLAMPSIA_LIVER_LAB_SAFETY_TERMS = [
  "alt",
  "ast",
  "liver",
  "right upper quadrant",
  "transaminase",
  "간",
];

const SEVERE_PREECLAMPSIA_RENAL_LAB_SAFETY_TERMS = [
  "creatinine",
  "proteinuria",
  "renal",
  "urine output",
  "소변",
];

const SEVERE_PREECLAMPSIA_MATERNAL_SEVERE_FEATURE_SAFETY_TERMS = [
  "abruption",
  "headache",
  "hellp",
  "pulmonary edema",
  "right upper quadrant",
  "seizure",
  "visual",
  "폐부종",
];

const SEVERE_PREECLAMPSIA_FETAL_DELIVERY_RISK_SAFETY_TERMS = [
  "delivery risk",
  "fetal",
  "gestational age",
  "maternal-fetal",
  "태아",
];

const SEVERE_PREECLAMPSIA_STEROID_NO_DELAY_SAFETY_TERMS = [
  "do not delay delivery",
  "not delay delivery",
  "without delaying delivery",
  "do not wait for corticosteroid",
  "not wait for corticosteroid",
  "do not wait 48 hours",
];

const SEVERE_PREECLAMPSIA_POSTPARTUM_SAFETY_TERMS = [
  "24 hours postpartum",
  "postpartum magnesium",
  "postpartum monitoring",
  "postpartum warning",
  "follow-up within 7",
  "followup within 7",
  "follow up within 7",
];

const HELLP_CONTEXT_TERMS = [
  "hellp syndrome",
  "hemolysis elevated liver enzymes low platelet",
  "hemolysis elevated liver enzymes low platelets",
];

const HELLP_RISK_TERMS = [
  "bilirubin",
  "epigastric pain",
  "hemolysis",
  "ldh",
  "low platelet",
  "low platelets",
  "nausea",
  "platelet count",
  "right upper quadrant",
  "ruq pain",
  "schistocytes",
  "transaminase",
  "vomiting",
];

const HELLP_CBC_PLATELET_ACTION_TERMS = ["cbc", "platelet"];

const HELLP_LIVER_ENZYME_ACTION_TERMS = ["alt", "ast", "transaminase"];

const HELLP_HEMOLYSIS_ACTION_TERMS = [
  "bilirubin",
  "hemolysis",
  "lactate dehydrogenase",
  "ldh",
  "schistocyte",
  "smear",
];

const HELLP_MAGNESIUM_ACTION_TERMS = ["magnesium sulfate", "mgso4"];

const HELLP_SEIZURE_ACTION_TERMS = ["seizure prophylaxis", "seizure prevention", "eclampsia"];

const HELLP_SEVERE_BP_ACTION_TERMS = [
  "acute severe hypertension",
  "acute severe-range",
  "severe hypertension",
  "severe-range",
  "160/110",
  "160 mm hg",
  "110 mm hg",
];

const HELLP_BP_MED_ACTION_TERMS = [
  "hydralazine",
  "labetalol",
  "nifedipine",
  "immediate-release nifedipine",
  "intravenous hydralazine",
  "intravenous labetalol",
  "iv hydralazine",
  "iv labetalol",
];

const HELLP_DELIVERY_ACTION_TERMS = [
  "cesarean",
  "c-section",
  "delivery",
  "delivery planning",
  "expedite delivery",
  "induction",
];

const HELLP_DELIVERY_TIMING_TERMS = [
  "34 weeks",
  "34주",
  "after maternal stabilization",
  "after stabilization",
  "based on maternal and fetal status",
  "gestational age",
  "maternal stabilization",
  "maternal status",
  "maternal-fetal status",
  "once stabilized",
  "분만 시기",
  "재태연령",
];

const HELLP_DIC_COAG_ACTION_TERMS = [
  "dic",
  "fibrinogen",
  "pt",
  "ptt",
  "coagulation",
  "coagulopathy",
];

const HELLP_HEPATIC_COMPLICATION_ACTION_TERMS = [
  "hepatic imaging",
  "liver rupture",
  "subcapsular hematoma",
  "subcapsular haematoma",
];

const HELLP_DIC_TRIGGER_SAFETY_TERMS = [
  "abnormal bleeding",
  "platelet count less than 50",
  "platelet count under 50",
  "platelet < 50",
  "platelets < 50",
];

const HELLP_DIC_COAG_SAFETY_TERMS = [
  "dic",
  "fibrinogen",
  "prothrombin time",
  "pt",
  "ptt",
  "partial thromboplastin time",
];

const HELLP_PLATELET_VAGINAL_SAFETY_TERMS = [
  "less than 20",
  "platelet count less than 20",
  "platelet < 20",
  "platelets < 20",
  "20k before vaginal",
];

const HELLP_PLATELET_CESAREAN_SAFETY_TERMS = [
  "less than 50",
  "platelet count less than 50",
  "platelet < 50",
  "platelets < 50",
  "50k before cesarean",
  "50k before caesarean",
];

const HELLP_PLATELET_BLEEDING_TRANSFUSION_SAFETY_TERMS = [
  "abnormal bleeding",
  "platelet transfusion",
  "transfusion",
];

const HELLP_REGIONAL_SAFE_PLATELET_SAFETY_TERMS = [
  "platelet count greater than 100",
  "platelet count over 100",
  "platelet > 100",
  "platelets > 100",
];

const HELLP_REGIONAL_AVOID_LOW_PLATELET_SAFETY_TERMS = [
  "avoid regional",
  "avoid neuraxial",
  "avoid epidural",
  "epidural",
  "platelet count less than 50",
  "platelet < 50",
  "regional anesthesia",
  "regional anaesthesia",
];

const HELLP_STEROID_GESTATIONAL_SAFETY_TERMS = [
  "34 weeks",
  "before 34 weeks",
  "less than 34 weeks",
];

const HELLP_STEROID_FETAL_LUNG_SAFETY_TERMS = [
  "betamethasone",
  "corticosteroids",
  "dexamethasone",
  "fetal lung",
];

const HELLP_POSTPARTUM_TIME_SAFETY_TERMS = [
  "24 to 48 hours postpartum",
  "24-48 hours postpartum",
  "48 hours postpartum",
];

const HELLP_POSTPARTUM_MAGNESIUM_SAFETY_TERMS = [
  "magnesium sulfate",
  "postpartum magnesium",
];

const HELLP_POSTPARTUM_LAB_RECOVERY_SAFETY_TERMS = [
  "ldh",
  "platelet recovery",
  "postpartum",
];

const PLACENTAL_ABRUPTION_CONTEXT_TERMS = [
  "abruptio placentae",
  "placental abruption",
  "retroplacental hemorrhage",
  "retroplacental haematoma",
  "retroplacental hematoma",
];

const PLACENTAL_ABRUPTION_RISK_TERMS = [
  "abdominal trauma",
  "concealed hemorrhage",
  "dic",
  "fetal distress",
  "hemorrhagic shock",
  "late pregnancy bleeding",
  "painful bleeding",
  "rigid uterus",
  "uterine hypertonus",
  "uterine pain",
  "uterine tenderness",
  "vaginal bleeding",
];

const PLACENTAL_ABRUPTION_MATERNAL_RESUSCITATION_ACTION_TERMS = [
  "blood product",
  "crossmatch",
  "hemodynamic",
  "iv access",
  "large-bore",
  "maternal stabilization",
  "resuscitation",
  "shock",
  "transfusion",
  "type and cross",
  "type-and-cross",
];

const PLACENTAL_ABRUPTION_FETAL_MONITOR_ACTION_TERMS = [
  "continuous fetal monitoring",
  "fetal heart",
  "fetal monitoring",
  "fetal status",
  "fhr",
  "nonreassuring",
];

const PLACENTAL_ABRUPTION_LAB_ACTION_TERMS = [
  "blood type",
  "coagulation",
  "crossmatch",
  "fibrin split",
  "fibrinogen",
  "platelet",
  "rh",
  "type and screen",
  "type-and-screen",
];

const PLACENTAL_ABRUPTION_DELIVERY_ESCALATION_ACTION_TERMS = [
  "cesarean",
  "c-section",
  "emergency delivery",
  "maternal-fetal medicine",
  "mfm",
  "ob consult",
  "ob team",
  "operative",
  "operative team",
  "prompt cesarean",
  "prompt delivery",
];

const PLACENTAL_ABRUPTION_PREVIA_EXCLUSION_SAFETY_TERMS = [
  "exclude placenta previa",
  "placenta previa",
  "previa",
  "rule out placenta previa",
  "rule out previa",
];

const PLACENTAL_ABRUPTION_PELVIC_EXAM_SAFETY_TERMS = [
  "before pelvic examination",
  "before vaginal examination",
  "pelvic examination",
  "vaginal examination",
];

const PLACENTAL_ABRUPTION_ULTRASOUND_LIMIT_SAFETY_TERMS = [
  "normal ultrasound does not rule out",
  "normal ultrasonography does not rule out",
  "ultrasound does not rule out",
  "ultrasonography does not rule out",
];

const PLACENTAL_ABRUPTION_COAG_LAB_SAFETY_TERMS = [
  "coagulation",
  "dic",
  "fibrin split",
  "fibrinogen",
  "platelet",
  "pt/ptt",
];

const PLACENTAL_ABRUPTION_BLOOD_RH_SAFETY_TERMS = [
  "blood type",
  "kleihauer",
  "kleihauer-betke",
  "rh",
  "rh immune globulin",
  "rho(d)",
];

const PLACENTAL_ABRUPTION_STABILITY_DELIVERY_SAFETY_TERMS = [
  "bleeding continues",
  "delivery criteria",
  "deteriorates",
  "fetal instability",
  "maternal instability",
  "near-term",
  "nonreassuring fetal",
  "prompt cesarean",
  "prompt delivery",
  "term pregnancy",
];

const PLACENTAL_ABRUPTION_SHOCK_DIC_SAFETY_TERMS = [
  "coagulopathy",
  "dic",
  "hemorrhagic shock",
  "low fibrinogen",
  "shock",
];

const PLACENTAL_ABRUPTION_BLOOD_PRODUCT_SAFETY_TERMS = [
  "blood product",
  "cryoprecipitate",
  "massive transfusion",
  "transfusion",
];

const PLACENTA_PREVIA_CONTEXT_TERMS = [
  "low-lying placenta",
  "placenta previa",
  "placenta praevia",
];

const PLACENTA_PREVIA_RISK_TERMS = [
  "antepartum bleeding",
  "hemorrhagic shock",
  "late pregnancy bleeding",
  "nonreassuring fetal",
  "painless bleeding",
  "painless vaginal bleeding",
  "second trimester bleeding",
  "third trimester bleeding",
  "vaginal bleeding",
];

const PLACENTA_PREVIA_ULTRASOUND_ACTION_TERMS = [
  "transvaginal ultrasound",
  "transvaginal ultrasonography",
  "ultrasound",
  "ultrasonography",
];

const PLACENTA_PREVIA_FETAL_MONITOR_ACTION_TERMS = [
  "continuous fetal",
  "fetal heart",
  "fetal monitoring",
  "fetal status",
  "fhr",
  "nonreassuring",
];

const PLACENTA_PREVIA_HEMORRHAGE_ACTION_TERMS = [
  "blood product",
  "crossmatch",
  "hemodynamic",
  "hemorrhage",
  "iv access",
  "large-bore",
  "shock",
  "transfusion",
  "type and screen",
];

const PLACENTA_PREVIA_CESAREAN_ACTION_TERMS = [
  "caesarean",
  "cesarean",
  "c-section",
  "immediate cesarean",
];

const PLACENTA_PREVIA_CESAREAN_TRIGGER_ACTION_TERMS = [
  "fetal status worsens",
  "heavy bleeding",
  "maternal hemodynamic instability",
  "nonreassuring fetal",
  "severe bleeding",
  "uncontrolled bleeding",
  "unstable",
];

const PLACENTA_PREVIA_NO_DIGITAL_EXAM_SAFETY_TERMS = [
  "avoid digital",
  "digital cervical examination",
  "digital exam",
  "do not perform pelvic",
  "no digital",
  "pelvic examination is contraindicated",
];

const PLACENTA_PREVIA_EXCLUDE_BY_ULTRASOUND_SAFETY_TERMS = [
  "exclude placenta previa",
  "rule out placenta previa",
  "ultrasound before pelvic",
  "ultrasonography before pelvic",
];

const PLACENTA_PREVIA_STABLE_CESAREAN_SAFETY_TERMS = [
  "caesarean delivery",
  "cesarean delivery",
  "scheduled cesarean",
];

const PLACENTA_PREVIA_STABLE_TIMING_SAFETY_TERMS = [
  "36 to 37",
  "36-37",
  "36 to 37 6/7",
  "36-37 6/7",
  "36 0/7",
  "37 6/7",
];

const PLACENTA_PREVIA_LUNG_MATURITY_SAFETY_TERMS = [
  "lung maturity is not necessary",
  "lung maturity not necessary",
  "without lung maturity",
];

const PLACENTA_PREVIA_UNSTABLE_DELIVERY_SAFETY_TERMS = [
  "caesarean",
  "cesarean",
  "c-section",
  "immediate cesarean",
];

const PLACENTA_PREVIA_UNSTABLE_TRIGGER_SAFETY_TERMS = [
  "heavy bleeding",
  "maternal hemodynamic instability",
  "mother or fetus is unstable",
  "nonreassuring fetal",
  "severe bleeding",
  "uncontrolled bleeding",
];

const PLACENTA_PREVIA_HOSPITALIZATION_SAFETY_TERMS = [
  "hospitalization",
  "hospitalize",
  "readmission",
  "readmitted",
];

const PLACENTA_PREVIA_ACTIVITY_SAFETY_TERMS = [
  "modified activity",
  "modified rest",
];

const PLACENTA_PREVIA_SEXUAL_ACTIVITY_SAFETY_TERMS = [
  "abstinence",
  "avoidance of sexual activity",
  "avoid sexual activity",
];

const PLACENTA_PREVIA_CORTICOSTEROID_SAFETY_TERMS = [
  "corticosteroid",
  "betamethasone",
];

const PLACENTA_PREVIA_RH_SAFETY_TERMS = [
  "rh-negative",
  "rh immune globulin",
  "rho(d)",
];

const PLACENTA_ACCRETA_CONTEXT_TERMS = [
  "morbidly adherent placenta",
  "placenta accreta",
  "placenta accreta spectrum",
  "placenta increta",
  "placenta percreta",
];

const PLACENTA_ACCRETA_RISK_TERMS = [
  "bladder invasion",
  "cesarean scar",
  "hemorrhage",
  "low-lying placenta",
  "massive hemorrhage",
  "placenta previa",
  "placental lacunae",
  "previous cesarean",
  "prior cesarean",
  "uterine scar",
];

const PLACENTA_ACCRETA_IMAGING_ACTION_TERMS = [
  "doppler",
  "mri",
  "placental lacunae",
  "ultrasound",
  "ultrasonography",
];

const PLACENTA_ACCRETA_MFM_TEAM_ACTION_TERMS = [
  "maternal-fetal",
  "mfm",
  "multidisciplinary",
];

const PLACENTA_ACCRETA_ANESTHESIA_TEAM_ACTION_TERMS = [
  "anaesthesia",
  "anesthesia",
];

const PLACENTA_ACCRETA_SURGICAL_TEAM_ACTION_TERMS = [
  "experienced surgeon",
  "gynecologic oncology",
  "hysterectomy team",
  "pelvic surgeon",
];

const PLACENTA_ACCRETA_ADJUNCT_TEAM_ACTION_TERMS = [
  "critical care",
  "neonatal",
  "nicu",
  "urology",
];

const PLACENTA_ACCRETA_BLOOD_BANK_ACTION_TERMS = [
  "blood bank",
  "hemorrhage protocol",
];

const PLACENTA_ACCRETA_TRANSFUSION_ACTION_TERMS = [
  "blood product",
  "massive transfusion",
  "transfusion",
];

const PLACENTA_ACCRETA_CESAREAN_HYSTERECTOMY_ACTION_TERMS = [
  "caesarean hysterectomy",
  "cesarean hysterectomy",
  "scheduled caesarean",
  "scheduled cesarean",
];

const PLACENTA_ACCRETA_DELIVERY_TIMING_ACTION_TERMS = [
  "34 0/7",
  "34 weeks",
  "35 6/7",
];

const PLACENTA_ACCRETA_REFERRAL_SAFETY_TERMS = [
  "level iii",
  "level iv",
  "maternal care",
  "referral",
  "tertiary",
];

const PLACENTA_ACCRETA_AVOID_REMOVAL_SAFETY_TERMS = [
  "avoid placental removal",
  "do not remove placenta",
  "forced placental removal",
  "manual placental removal",
];

const PLACENTA_ACCRETA_IN_SITU_SAFETY_TERMS = [
  "leave placenta in situ",
  "placenta left in situ",
];

const PLACENTA_ACCRETA_TIMING_SAFETY_TERMS = [
  "34 0/7",
  "34 weeks",
  "35 6/7",
  "before labor",
  "before the onset of labor",
  "before bleeding",
];

const PLACENTA_ACCRETA_CORTICOSTEROID_SAFETY_TERMS = [
  "betamethasone",
  "corticosteroid",
];

const PLACENTA_ACCRETA_BLOOD_BANK_SAFETY_TERMS = [
  "blood bank",
  "hemorrhage checklist",
  "massive transfusion",
];

const PLACENTA_ACCRETA_COAG_SAFETY_TERMS = [
  "coagulation",
  "fibrinogen",
  "platelet",
  "pt",
  "ptt",
];

const PLACENTA_ACCRETA_TXA_SAFETY_TERMS = [
  "tranexamic acid",
  "txa",
];

const PLACENTA_ACCRETA_UROLOGIC_INJURY_SAFETY_TERMS = [
  "bladder",
  "cystectomy",
  "urology",
];

const PLACENTA_ACCRETA_CRITICAL_CARE_SAFETY_TERMS = [
  "critical care",
  "icu",
];

const PLACENTA_ACCRETA_PELVIC_ORGAN_SAFETY_TERMS = [
  "pelvic organ",
  "ureter",
  "vascular",
];

const UMBILICAL_CORD_PROLAPSE_CONTEXT_TERMS = [
  "cord presentation",
  "cord prolapse",
  "funic presentation",
  "prolapsed cord",
  "umbilical cord prolapse",
];

const UMBILICAL_CORD_PROLAPSE_RISK_TERMS = [
  "abnormal fetal heart",
  "bradycardia",
  "breech",
  "fetal distress",
  "high presenting part",
  "membrane rupture",
  "non-cephalic",
  "polyhydramnios",
  "ruptured membranes",
  "unengaged presenting part",
  "variable deceleration",
  "visible cord",
];

const UMBILICAL_CORD_PROLAPSE_FHR_DIAGNOSIS_ACTION_TERMS = [
  "digital vaginal examination",
  "fetal heart",
  "fhr",
  "speculum",
  "vaginal examination",
  "variable deceleration",
];

const UMBILICAL_CORD_PROLAPSE_ASSISTANCE_ACTION_TERMS = [
  "assistance",
  "call for help",
  "emergency theatre",
  "immediate birth",
  "obstetric",
  "operating room",
  "theatre",
];

const UMBILICAL_CORD_PROLAPSE_COMPRESSION_RELIEF_ACTION_TERMS = [
  "bladder filling",
  "bladder distension",
  "elevate presenting part",
  "manual elevation",
  "presenting part elevated",
  "relieve compression",
];

const UMBILICAL_CORD_PROLAPSE_POSITION_ACTION_TERMS = [
  "exaggerated sims",
  "head down",
  "knee-chest",
  "left lateral",
  "trendelenburg",
];

const UMBILICAL_CORD_PROLAPSE_DELIVERY_ACTION_TERMS = [
  "category 1",
  "cesarean",
  "caesarean",
  "emergency birth",
  "operative vaginal",
  "urgent delivery",
  "within 30 minutes",
];

const UMBILICAL_CORD_PROLAPSE_MINIMAL_HANDLING_SAFETY_TERMS = [
  "avoid handling",
  "minimal handling",
];

const UMBILICAL_CORD_PROLAPSE_VASOSPASM_SAFETY_TERMS = [
  "prevent vasospasm",
  "vasospasm",
];

const UMBILICAL_CORD_PROLAPSE_REPLACEMENT_SAFETY_TERMS = [
  "do not replace",
  "manual replacement",
  "not recommended",
  "not rely on manual cord replacement",
];

const UMBILICAL_CORD_PROLAPSE_NO_DELAY_TOCOLYSIS_SAFETY_TERMS = [
  "do not delay",
  "do not delay delivery",
  "must not delay",
  "no unnecessary delay",
  "terbutaline must not delay",
  "tocolysis must not delay",
  "tocolysis while preparing birth",
  "tocolysis while preparing delivery",
];

const UMBILICAL_CORD_PROLAPSE_CESAREAN_MODE_SAFETY_TERMS = [
  "caesarean",
  "cesarean",
];

const UMBILICAL_CORD_PROLAPSE_IMMINENT_VAGINAL_SAFETY_TERMS = [
  "operative vaginal",
  "vaginal birth imminent",
];

const UMBILICAL_CORD_PROLAPSE_CATEGORY1_SAFETY_TERMS = [
  "category 1",
  "category-1",
];

const UMBILICAL_CORD_PROLAPSE_CATEGORY2_SAFETY_TERMS = [
  "category 2",
  "category-2",
];

const UMBILICAL_CORD_PROLAPSE_CONTINUOUS_ASSESSMENT_SAFETY_TERMS = [
  "continuous assessment",
  "continuous fetal",
];

const UMBILICAL_CORD_PROLAPSE_NEONATAL_RESUSCITATION_SAFETY_TERMS = [
  "neonatal resuscitation",
  "newborn resuscitation",
];

const UMBILICAL_CORD_PROLAPSE_CORD_GAS_SAFETY_TERMS = [
  "base excess",
  "cord gas",
  "cord ph",
  "paired cord blood",
];

const VASA_PREVIA_CONTEXT_TERMS = [
  "fetal vessels",
  "unprotected fetal vessels",
  "vasa praevia",
  "vasa previa",
  "velamentous cord",
];

const VASA_PREVIA_RISK_TERMS = [
  "active hemorrhage",
  "fetal bradycardia",
  "fetal hemorrhage",
  "late preterm bleeding",
  "painless bleeding",
  "ruptured membranes",
  "sudden bleeding",
  "vaginal bleeding",
];

const VASA_PREVIA_FETAL_ASSESSMENT_ACTION_TERMS = [
  "continuous fetal",
  "fetal heart",
  "fetal monitoring",
  "fetal status",
];

const VASA_PREVIA_OB_MFM_ACTION_TERMS = [
  "mfm",
  "obstetric",
];

const VASA_PREVIA_ANESTHESIA_BLOOD_ACTION_TERMS = [
  "anaesthesia",
  "anesthesia",
  "blood bank",
];

const VASA_PREVIA_NEONATAL_TEAM_ACTION_TERMS = [
  "neonatal",
];

const VASA_PREVIA_DELIVERY_ACTION_TERMS = [
  "cesarean",
  "caesarean",
];

const VASA_PREVIA_URGENT_BIRTH_ACTION_TERMS = [
  "immediate birth",
  "immediate delivery",
  "urgent birth",
  "urgent delivery",
];

const VASA_PREVIA_NEONATAL_RESUSCITATION_ACTION_TERMS = [
  "neonatal resuscitation",
  "newborn resuscitation",
];

const VASA_PREVIA_NEONATAL_TRANSFUSION_ACTION_TERMS = [
  "packed red",
  "transfusion",
];

const VASA_PREVIA_NO_DELAY_SAFETY_TERMS = [
  "active hemorrhage should not delay delivery",
  "do not delay delivery",
  "delivery should not be delayed",
  "fetal lung maturity testing should not delay delivery",
  "fetal lung maturity testing should not be used when an indication for delivery is present",
  "not delay delivery",
];

const VASA_PREVIA_DELIVERY_TIMING_SAFETY_TERMS = [
  "34 and 37",
  "34-37",
];

const VASA_PREVIA_BEFORE_LABOR_RUPTURE_SAFETY_TERMS = [
  "before labor",
  "before labour",
  "before rupture",
  "before rupture of membranes",
];

const VASA_PREVIA_CESAREAN_SAFETY_TERMS = [
  "cesarean",
  "caesarean",
];

const VASA_PREVIA_STEROID_SAFETY_TERMS = [
  "antenatal corticosteroids",
  "betamethasone",
];

const VASA_PREVIA_STEROID_WINDOW_SAFETY_TERMS = [
  "34 0/7",
  "36 6/7",
  "within 7 days",
];

const VASA_PREVIA_AMNIOTOMY_AVOIDANCE_SAFETY_TERMS = [
  "avoid amniotomy",
  "no amniotomy",
];

const VASA_PREVIA_FETAL_SCALP_AVOIDANCE_SAFETY_TERMS = [
  "avoid fetal scalp",
  "fetal scalp electrode",
];

const VASA_PREVIA_MEMBRANE_LABOR_AVOIDANCE_SAFETY_TERMS = [
  "avoid labor",
  "avoid labour",
  "avoid vaginal delivery",
  "do not rupture membranes",
  "membrane rupture",
];

const VASA_PREVIA_VAGINAL_DELIVERY_AVOIDANCE_SAFETY_TERMS = [
  "avoid vaginal delivery",
  "vaginal delivery",
];

const UTERINE_RUPTURE_CONTEXT_TERMS = [
  "ruptured uterus",
  "uterine rupture",
  "uterine scar dehiscence",
];

const UTERINE_RUPTURE_RISK_TERMS = [
  "fetal bradycardia",
  "hypovolemia",
  "loss of fetal station",
  "myomectomy",
  "previous cesarean",
  "prior cesarean",
  "severe abdominal pain",
  "tolac",
  "vbac",
  "variable decelerations",
];

const UTERINE_RUPTURE_FETAL_ACTION_TERMS = [
  "continuous fetal",
  "fetal bradycardia",
  "fetal heart",
  "fetal monitoring",
];

const UTERINE_RUPTURE_MATERNAL_ACTION_TERMS = [
  "hemodynamic",
  "maternal resuscitation",
  "shock",
];

const UTERINE_RUPTURE_OB_SURGICAL_TEAM_ACTION_TERMS = [
  "obstetric",
  "surgical team",
];

const UTERINE_RUPTURE_ANESTHESIA_ACTION_TERMS = [
  "anaesthesia",
  "anesthesia",
];

const UTERINE_RUPTURE_NEONATAL_ACTION_TERMS = [
  "neonatal",
];

const UTERINE_RUPTURE_BLOOD_BANK_ACTION_TERMS = [
  "blood bank",
];

const UTERINE_RUPTURE_LAPAROTOMY_ACTION_TERMS = [
  "immediate laparotomy",
  "laparotomy",
];

const UTERINE_RUPTURE_CESAREAN_DELIVERY_ACTION_TERMS = [
  "caesarean",
  "cesarean",
  "emergency delivery",
];

const UTERINE_RUPTURE_HEMORRHAGE_PREP_ACTION_TERMS = [
  "crossmatch",
  "hemorrhage",
  "hemorrhage protocol",
];

const UTERINE_RUPTURE_TRANSFUSION_ACTION_TERMS = [
  "massive transfusion",
  "transfusion",
];

const UTERINE_RUPTURE_STOP_LABOR_SAFETY_TERMS = [
  "do not continue labor",
  "stop labor",
  "stop tolac",
  "stop trial of labor",
];

const UTERINE_RUPTURE_STOP_OXYTOCIN_SAFETY_TERMS = [
  "stop oxytocin",
];

const UTERINE_RUPTURE_AVOID_PROSTAGLANDIN_SAFETY_TERMS = [
  "avoid prostaglandin",
  "prostaglandins should not",
];

const UTERINE_RUPTURE_MISOPROSTOL_SAFETY_TERMS = [
  "misoprostol",
];

const UTERINE_RUPTURE_NO_DELAY_SAFETY_TERMS = [
  "do not delay laparotomy",
  "do not wait",
  "imaging must not delay",
  "not delay laparotomy",
  "no imaging delay",
  "without waiting",
];

const UTERINE_RUPTURE_LAPAROTOMY_DIAGNOSIS_SAFETY_TERMS = [
  "diagnosis by laparotomy",
  "immediate laparotomy",
  "laparotomy",
];

const UTERINE_RUPTURE_REPAIR_SAFETY_TERMS = [
  "repair",
  "uterine repair",
];

const UTERINE_RUPTURE_HYSTERECTOMY_SAFETY_TERMS = [
  "hysterectomy",
];

const UTERINE_RUPTURE_BLADDER_INJURY_SAFETY_TERMS = [
  "bladder laceration",
  "bladder",
  "urology",
];

const UTERINE_RUPTURE_HEMORRHAGE_CONTINGENCY_SAFETY_TERMS = [
  "hemorrhage contingencies",
  "hemorrhage contingency",
  "hemorrhage protocol",
  "transfusion",
];

const AMNIOTIC_FLUID_EMBOLISM_CONTEXT_TERMS = [
  "afe",
  "amniotic fluid embolism",
  "anaphylactoid syndrome of pregnancy",
];

const AMNIOTIC_FLUID_EMBOLISM_RISK_TERMS = [
  "cardiac arrest",
  "coagulopathy",
  "cyanosis",
  "dic",
  "dyspnea",
  "hypotension",
  "hypoxia",
  "labor",
  "pulmonary crackles",
  "respiratory failure",
  "tachypnea",
];

const AMNIOTIC_FLUID_EMBOLISM_AIRWAY_ACTION_TERMS = [
  "airway",
  "endotracheal intubation",
  "intubation",
  "oxygen",
  "ventilation",
];

const AMNIOTIC_FLUID_EMBOLISM_CPR_ACTION_TERMS = [
  "cpr",
];

const AMNIOTIC_FLUID_EMBOLISM_HEMODYNAMIC_ACTION_TERMS = [
  "hemodynamic",
  "vasopressor",
];

const AMNIOTIC_FLUID_EMBOLISM_LEFT_DISPLACEMENT_ACTION_TERMS = [
  "lateral tilt",
  "manual uterine displacement",
];

const AMNIOTIC_FLUID_EMBOLISM_OB_ANESTHESIA_TEAM_ACTION_TERMS = [
  "anaesthesia",
  "anesthesia",
  "obstetric",
];

const AMNIOTIC_FLUID_EMBOLISM_CRITICAL_CARE_TEAM_ACTION_TERMS = [
  "critical care",
  "icu",
  "intensive care",
];

const AMNIOTIC_FLUID_EMBOLISM_NEONATAL_TEAM_ACTION_TERMS = [
  "neonatal",
];

const AMNIOTIC_FLUID_EMBOLISM_BLOOD_BANK_TEAM_ACTION_TERMS = [
  "blood bank",
  "multidisciplinary",
];

const AMNIOTIC_FLUID_EMBOLISM_DELIVERY_PROCEDURE_ACTION_TERMS = [
  "caesarean",
  "cesarean",
  "operative delivery",
  "perimortem cesarean",
  "resuscitative hysterotomy",
];

const AMNIOTIC_FLUID_EMBOLISM_DELIVERY_TIMING_ACTION_TERMS = [
  "4 minutes",
  "5 minutes",
];

const AMNIOTIC_FLUID_EMBOLISM_DIC_COAG_ACTION_TERMS = [
  "coagulopathy",
  "dic",
];

const AMNIOTIC_FLUID_EMBOLISM_FIBRINOGEN_REPLACEMENT_ACTION_TERMS = [
  "cryoprecipitate",
  "fibrinogen",
];

const AMNIOTIC_FLUID_EMBOLISM_TRANSFUSION_ACTION_TERMS = [
  "massive transfusion",
  "red blood cell",
  "transfusion",
];

const AMNIOTIC_FLUID_EMBOLISM_FLUID_OVERLOAD_SAFETY_TERMS = [
  "avoid fluid overload",
  "fluid overload should be avoided",
];

const AMNIOTIC_FLUID_EMBOLISM_VASOPRESSOR_SAFETY_TERMS = [
  "vasopressor",
];

const AMNIOTIC_FLUID_EMBOLISM_CLOT_FACTOR_REPLACEMENT_SAFETY_TERMS = [
  "clotting factor",
  "cryoprecipitate",
  "fibrinogen",
];

const AMNIOTIC_FLUID_EMBOLISM_DIC_SAFETY_TERMS = [
  "coagulopathy",
  "dic",
];

const AMNIOTIC_FLUID_EMBOLISM_RFVIITA_SAFETY_TERMS = [
  "factor viia should not be used routinely",
  "not use factor viia routinely",
  "recombinant factor viia should not",
];

const AMNIOTIC_FLUID_EMBOLISM_UTEROTONIC_SAFETY_TERMS = [
  "oxytocin",
  "uterotonic",
];

const AMNIOTIC_FLUID_EMBOLISM_TXA_SAFETY_TERMS = [
  "tranexamic acid",
  "txa",
];

const SHOULDER_DYSTOCIA_CONTEXT_TERMS = [
  "impacted shoulder",
  "shoulder dystocia",
  "turtle sign",
];

const SHOULDER_DYSTOCIA_RISK_TERMS = [
  "brachial plexus",
  "diabetes",
  "gentle traction failed",
  "head delivered",
  "head-to-body",
  "macrosomia",
  "postpartum hemorrhage",
  "prolonged head",
  "turtle sign",
];

const SHOULDER_DYSTOCIA_DECLARATION_ACTION_TERMS = [
  "announce shoulder dystocia",
  "declare shoulder dystocia",
  "shoulder dystocia",
];

const SHOULDER_DYSTOCIA_TEAM_ACTION_TERMS = [
  "additional assistance",
  "anaesthetist",
  "anesthetist",
  "call for help",
  "experienced obstetrician",
  "neonatal resuscitation",
  "neonatologist",
  "obstetrician",
  "pediatrician",
];

const SHOULDER_DYSTOCIA_FIRST_LINE_ACTION_TERMS = [
  "mcroberts",
  "mcroberts manoeuvre",
  "mcroberts maneuver",
];

const SHOULDER_DYSTOCIA_SUPRAPUBIC_ACTION_TERMS = ["suprapubic pressure"];

const SHOULDER_DYSTOCIA_SECOND_LINE_ACTION_TERMS = [
  "all-fours",
  "delivery of posterior arm",
  "gaskin",
  "internal manoeuvre",
  "internal maneuver",
  "internal rotation",
  "posterior arm",
  "rubin",
  "woods screw",
];

const SHOULDER_DYSTOCIA_FUNDAL_PRESSURE_SAFETY_TERMS = [
  "avoid fundal pressure",
  "fundal pressure should not",
  "no fundal pressure",
  "not use fundal pressure",
];

const SHOULDER_DYSTOCIA_EXCESSIVE_TRACTION_SAFETY_TERMS = [
  "avoid downward traction",
  "avoid excessive traction",
  "avoid lateral traction",
  "avoid traction on the fetal head",
  "avoid traction on the head",
  "avoid traction on the neck",
  "avoid aggressive traction",
  "not use downward traction",
];

const SHOULDER_DYSTOCIA_AXIAL_TRACTION_SAFETY_TERMS = [
  "gentle axial traction",
  "routine axial traction",
  "standard axial traction",
];

const SHOULDER_DYSTOCIA_EPISIOTOMY_ACCESS_SAFETY_TERMS = [
  "episiotomy not routinely",
  "if needed for internal access",
  "not always necessary",
  "only for internal access",
];

const SHOULDER_DYSTOCIA_MATERNAL_INJURY_SAFETY_TERMS = [
  "anal sphincter",
  "fourth degree",
  "laceration",
  "maternal injury",
  "perineal tear",
  "postpartum hemorrhage",
  "postpartum haemorrhage",
  "rectal injury",
  "third degree",
  "uterine rupture",
];

const SHOULDER_DYSTOCIA_NEONATAL_INJURY_SAFETY_TERMS = [
  "brachial plexus",
  "clavicle fracture",
  "fracture",
  "humerus fracture",
  "neonatal clinician",
  "neonatal injury",
  "neonatal resuscitation",
];

const SHOULDER_DYSTOCIA_DOCUMENT_INTERVAL_SAFETY_TERMS = [
  "head-to-body",
  "head to body",
];

const SHOULDER_DYSTOCIA_DOCUMENT_TIMING_SAFETY_TERMS = [
  "time from delivery",
  "timing",
  "timer",
];

const SHOULDER_DYSTOCIA_DOCUMENT_MANEUVERS_SAFETY_TERMS = [
  "manoeuvre",
  "maneuver",
  "mcroberts",
  "posterior arm",
  "rubin",
  "woods",
];

const HYPERTENSIVE_EMERGENCY_DIRECT_CONTEXT_TERMS = [
  "hypertensive emergency",
  "hypertensive encephalopathy",
  "hypertensive pulmonary edema",
  "malignant hypertension",
  "severe hypertension with acute kidney injury",
  "severe hypertension with end-organ damage",
  "severe hypertension with organ damage",
  "고혈압 응급",
];

const HYPERTENSIVE_EMERGENCY_BP_CONTEXT_TERMS = [
  "bp 180",
  "bp 200",
  "blood pressure 180",
  "blood pressure 200",
  "dbp 120",
  "sbp 180",
  "sbp 200",
  "severe hypertension",
  "severely elevated blood pressure",
  "수축기 180",
  "혈압 180",
];

const HYPERTENSIVE_EMERGENCY_ORGAN_CONTEXT_TERMS = [
  "acute kidney injury",
  "acute pulmonary edema",
  "aortic dissection",
  "chest pain",
  "encephalopathy",
  "end-organ damage",
  "heart failure",
  "myocardial ischemia",
  "neurologic deficit",
  "papilledema",
  "renal failure",
  "retinal hemorrhage",
  "seizure",
  "target-organ damage",
  "뇌병증",
  "장기 손상",
];

const HYPERTENSIVE_EMERGENCY_BP_CONFIRM_ACTION_TERMS = [
  "blood pressure confirmation",
  "confirm repeat bp",
  "confirm repeat blood pressure",
  "repeat bp",
  "repeat blood pressure",
  "반복 혈압",
];

const HYPERTENSIVE_EMERGENCY_MONITOR_ACTION_TERMS = [
  "arterial line",
  "continuous bp",
  "continuous blood pressure",
  "icu",
  "monitored setting",
  "telemetry",
  "중환자",
];

const HYPERTENSIVE_EMERGENCY_NEURO_OR_EYE_ASSESSMENT_ACTION_TERMS = [
  "ct head",
  "encephalopathy",
  "fundoscopic",
  "neurologic",
  "papilledema",
  "retinal hemorrhage",
  "seizure",
];

const HYPERTENSIVE_EMERGENCY_RENAL_ASSESSMENT_ACTION_TERMS = [
  "aki",
  "creatinine",
  "renal",
  "urinalysis",
];

const HYPERTENSIVE_EMERGENCY_CARDIOPULMONARY_AORTIC_ASSESSMENT_ACTION_TERMS = [
  "aortic dissection",
  "chest x-ray",
  "ecg",
  "myocardial ischemia",
  "pulmonary edema",
  "troponin",
];

const HYPERTENSIVE_EMERGENCY_ORGAN_DAMAGE_LABEL_ACTION_TERMS = [
  "acute target-organ damage",
  "end-organ damage",
  "target-organ damage",
  "장기 손상",
];

const HYPERTENSIVE_EMERGENCY_TITRATABLE_IV_CONTEXT_ACTION_TERMS = [
  "short-acting",
  "titrated infusion",
  "titratable",
  "iv antihypertensive",
  "intravenous antihypertensive",
];

const HYPERTENSIVE_EMERGENCY_IV_MED_ACTION_TERMS = [
  "clevidipine",
  "esmolol",
  "fenoldopam",
  "hydralazine",
  "iv labetalol",
  "nicardipine",
  "nitroglycerin",
  "nitroprusside",
  "정맥",
];

const HYPERTENSIVE_EMERGENCY_MAP_TARGET_ACTION_TERMS = [
  "20 to 25%",
  "20-25%",
  "25%",
  "gradual",
  "map",
  "mean arterial pressure",
];

const HYPERTENSIVE_EMERGENCY_TIME_TARGET_ACTION_TERMS = [
  "1 to 2 hours",
  "first hour",
  "hour or two",
  "첫 1시간",
];

const HYPERTENSIVE_EMERGENCY_URGENCY_DIFFERENTIATION_SAFETY_TERMS = [
  "asymptomatic",
  "markedly elevated",
  "no acute target-organ damage",
  "not emergency",
  "urgency",
  "무증상",
];

const HYPERTENSIVE_EMERGENCY_RAPID_LOWERING_SAFETY_TERMS = [
  "avoid rapid",
  "not abruptly",
  "overcorrection",
  "과교정",
];

const HYPERTENSIVE_EMERGENCY_HYPOPERFUSION_SAFETY_TERMS = [
  "cerebral hypoperfusion",
  "hypoperfusion",
  "hypotension",
];

const HYPERTENSIVE_EMERGENCY_REDUCTION_LIMIT_SAFETY_TERMS = [
  "20 to 25%",
  "20-25%",
  "25%",
  "no more than 25%",
];

const HYPERTENSIVE_EMERGENCY_CONDITION_CONTEXT_SAFETY_TERMS = [
  "aortic dissection",
  "heart failure",
  "ischemic stroke",
  "pregnancy",
  "pulmonary edema",
  "renal failure",
  "stroke",
];

const HYPERTENSIVE_EMERGENCY_MED_CONTRAINDICATION_SAFETY_TERMS = [
  "asthma",
  "azotemia",
  "beta blocker",
  "bradycardia",
  "heart block",
  "high intracranial pressure",
  "myocardial ischemia",
  "nitroprusside toxicity",
  "금기",
];

const HYPERTENSIVE_EMERGENCY_ICU_DISPOSITION_SAFETY_TERMS = [
  "icu",
  "monitored",
  "중환자",
];

const HYPERTENSIVE_EMERGENCY_CONTINUOUS_MONITOR_SAFETY_TERMS = [
  "arterial line",
  "continuous",
  "telemetry",
];

const HYPERTENSIVE_EMERGENCY_TITRATION_REASSESSMENT_SAFETY_TERMS = [
  "reassessment",
  "titration",
  "titrate",
];

const GIANT_CELL_ARTERITIS_DIRECT_CONTEXT_TERMS = [
  "cranial arteritis",
  "gca",
  "giant cell arteritis",
  "temporal arteritis",
  "거대세포동맥염",
  "측두동맥염",
];

const GIANT_CELL_ARTERITIS_HEADACHE_CONTEXT_TERMS = [
  "new headache",
  "scalp tenderness",
  "temporal artery tenderness",
  "temporal headache",
  "temporal pain",
  "두통",
  "측두",
];

const GIANT_CELL_ARTERITIS_ISCHEMIC_CONTEXT_TERMS = [
  "amaurosis fugax",
  "diplopia",
  "jaw claudication",
  "transient vision loss",
  "visual disturbance",
  "vision loss",
  "시력",
  "턱",
];

const GIANT_CELL_ARTERITIS_HIGH_DOSE_STEROID_ACTION_TERMS = [
  "high-dose",
  "immediate high-dose",
  "prednisone 40",
  "prednisone 60",
  "40 to 60 mg",
  "40-60 mg",
];

const GIANT_CELL_ARTERITIS_STEROID_AGENT_ACTION_TERMS = [
  "high-dose prednisone",
  "iv methylprednisolone",
  "methylprednisolone",
  "prednisone",
  "prednisolone",
];

const GIANT_CELL_ARTERITIS_ESR_ACTION_TERMS = [
  "erythrocyte sedimentation rate",
  "esr",
];

const GIANT_CELL_ARTERITIS_CRP_ACTION_TERMS = [
  "c-reactive protein",
  "crp",
];

const GIANT_CELL_ARTERITIS_CBC_PLATELET_ACTION_TERMS = [
  "cbc",
  "platelet",
  "혈소판",
];

const GIANT_CELL_ARTERITIS_BIOPSY_ACTION_TERMS = [
  "biopsy",
  "temporal artery biopsy",
  "생검",
];

const GIANT_CELL_ARTERITIS_ULTRASOUND_ACTION_TERMS = [
  "color doppler",
  "halo sign",
  "temporal artery ultrasound",
  "ultrasound",
  "초음파",
];

const GIANT_CELL_ARTERITIS_URGENT_TIMING_ACTION_TERMS = [
  "emergency",
  "same-day",
  "urgent referral",
  "응급",
];

const GIANT_CELL_ARTERITIS_SPECIALIST_ACTION_TERMS = [
  "ophthalmology",
  "rheumatology",
  "vision loss",
  "visual symptom",
  "안과",
  "류마티스",
];

const GIANT_CELL_ARTERITIS_NO_DELAY_SAFETY_TERMS = [
  "do not delay",
  "do not wait",
  "not delay",
  "지연",
];

const GIANT_CELL_ARTERITIS_DIAGNOSTIC_DELAY_SAFETY_TERMS = [
  "before biopsy",
  "before ultrasound",
  "before labs",
  "before specialist",
  "biopsy",
  "ultrasound",
];

const GIANT_CELL_ARTERITIS_VISUAL_SYMPTOM_SAFETY_TERMS = [
  "amaurosis fugax",
  "diplopia",
  "visual disturbance",
  "vision loss",
  "시력",
];

const GIANT_CELL_ARTERITIS_CRANIAL_ISCHEMIA_SAFETY_TERMS = [
  "cranial ischemia",
  "ischemic",
  "stroke",
];

const GIANT_CELL_ARTERITIS_GLUCOSE_SAFETY_TERMS = [
  "diabetes",
  "glucose",
  "혈당",
];

const GIANT_CELL_ARTERITIS_INFECTION_SAFETY_TERMS = ["infection"];

const GIANT_CELL_ARTERITIS_BONE_SAFETY_TERMS = [
  "bone protection",
  "fracture",
  "osteoporosis",
];

const GIANT_CELL_ARTERITIS_GI_SAFETY_TERMS = ["ppi", "위장"];

const GIANT_CELL_ARTERITIS_TAPER_RELAPSE_SAFETY_TERMS = [
  "relapse",
  "taper",
];

const GIANT_CELL_ARTERITIS_LARGE_VESSEL_SAFETY_TERMS = [
  "large vessel",
  "vascular imaging",
];

const GIANT_CELL_ARTERITIS_STEROID_SPARING_SAFETY_TERMS = [
  "polymyalgia rheumatica",
  "tocilizumab",
  "follow-up",
  "추적",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_DIRECT_CONTEXT_TERMS = [
  "acute angle closure",
  "acute angle-closure glaucoma",
  "acute closed-angle glaucoma",
  "angle closure glaucoma",
  "angle-closure glaucoma",
  "closed-angle glaucoma",
  "급성 폐쇄각 녹내장",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_RED_EYE_CONTEXT_TERMS = [
  "painful red eye",
  "red eye",
  "severe eye pain",
  "안구 통증",
  "충혈",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_ANGLE_CONTEXT_TERMS = [
  "fixed mid-dilated pupil",
  "halos",
  "intraocular pressure",
  "iop",
  "mid-dilated pupil",
  "nausea",
  "shallow anterior chamber",
  "vomiting",
  "안압",
  "동공",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_MEASUREMENT_ACTION_TERMS = [
  "intraocular pressure",
  "iop",
  "tonometry",
  "안압",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_EYE_EXAM_ACTION_TERMS = [
  "anterior chamber",
  "gonioscopy",
  "shallow anterior chamber",
  "slit lamp",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_IMMEDIATE_ACTION_TERMS = [
  "emergency",
  "immediate",
  "immediately",
  "urgent",
  "응급",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_TOPICAL_BETA_BLOCKER_ACTION_TERMS = [
  "beta blocker",
  "timolol",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_TOPICAL_ALPHA_AGONIST_ACTION_TERMS = [
  "apraclonidine",
  "brimonidine",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_ACTION_TERMS = [
  "miotic",
  "pilocarpine",
  "필로카르핀",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_TOPICAL_ADJUNCT_ACTION_TERMS = [
  "dorzolamide",
  "timolol",
  "topical",
  "점안",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_ACETAZOLAMIDE_ACTION_TERMS = [
  "acetazolamide",
  "diamox",
  "아세타졸아마이드",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_OSMOTIC_ACTION_TERMS = [
  "glycerol",
  "isosorbide",
  "mannitol",
  "osmotic",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_OPHTHALMOLOGY_ACTION_TERMS = [
  "ophthalmology",
  "urgent ophthalmology",
  "안과",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_IRIDOTOMY_ACTION_TERMS = [
  "iridectomy",
  "iridotomy",
  "laser peripheral iridotomy",
  "lpi",
  "홍채절개",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_ACETAZOLAMIDE_MED_SAFETY_TERMS = [
  "acetazolamide",
  "acetazolamide allergy",
  "diamox",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_ACETAZOLAMIDE_CONTRA_SAFETY_TERMS = [
  "allergy",
  "renal failure",
  "renal impairment",
  "sulfa allergy",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_BETA_BLOCKER_MED_SAFETY_TERMS = [
  "beta blocker",
  "timolol",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_BETA_BLOCKER_CONTRA_SAFETY_TERMS = [
  "asthma",
  "bradycardia",
  "copd",
  "금기",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_TIMING_SAFETY_TERMS = [
  "avoid pilocarpine",
  "defer pilocarpine",
  "pilocarpine timing",
  "pilocarpine",
  "필로카르핀",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_CONTEXT_SAFETY_TERMS = [
  "corneal edema",
  "high iop",
  "lens-induced",
  "phacomorphic",
  "pupil block",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_ASSESSMENT_SAFETY_TERMS = [
  "bilateral",
  "both eyes",
  "fellow eye",
  "second eye",
  "양안",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_IRIDOTOMY_SAFETY_TERMS = [
  "iridotomy",
  "lpi",
  "prophylactic iridotomy",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_VISUAL_MONITORING_SAFETY_TERMS = [
  "visual acuity",
  "vision loss",
  "시력",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_MONITORING_SAFETY_TERMS = [
  "recheck iop",
  "repeat iop",
  "안압 재측정",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_OPTIC_CORNEAL_MONITORING_SAFETY_TERMS = [
  "corneal edema",
  "optic nerve",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_MYDRIATIC_AVOIDANCE_SAFETY_TERMS = [
  "anticholinergic",
  "avoid mydriatic",
  "dilating drops",
  "mydriatic",
  "pupil dilation",
];

const RETINAL_DETACHMENT_DIRECT_CONTEXT_TERMS = [
  "macula-off retinal detachment",
  "macula-on retinal detachment",
  "retinal detachment",
  "retinal tear",
  "rhegmatogenous retinal detachment",
  "망막박리",
  "망막 열공",
];

const RETINAL_DETACHMENT_SYMPTOM_CONTEXT_TERMS = [
  "curtain",
  "field loss",
  "flashes",
  "floaters",
  "photopsia",
  "shadow",
  "sudden vision loss",
  "veil",
  "visual field defect",
  "visual field loss",
  "광시증",
  "비문증",
  "시야",
  "시력",
];

const RETINAL_DETACHMENT_RISK_CONTEXT_TERMS = [
  "cataract surgery",
  "eye trauma",
  "high myopia",
  "lattice degeneration",
  "posterior vitreous detachment",
  "pvd",
  "severe myopia",
  "vitreous hemorrhage",
  "고도근시",
  "백내장 수술",
  "외상",
];

const RETINAL_DETACHMENT_VISUAL_ACUITY_ACTION_TERMS = [
  "visual acuity",
  "시력",
];

const RETINAL_DETACHMENT_VISUAL_FIELD_ACTION_TERMS = [
  "central vision",
  "peripheral visual field",
  "visual field",
  "시야",
];

const RETINAL_DETACHMENT_PUPIL_RED_REFLEX_ACTION_TERMS = [
  "afferent pupillary defect",
  "apd",
  "pupil",
  "red reflex",
  "relative afferent pupillary defect",
];

const RETINAL_DETACHMENT_DILATED_INDIRECT_EXAM_ACTION_TERMS = [
  "dilated exam",
  "dilated fundus",
  "dilated retinal exam",
  "indirect ophthalmoscopy",
  "ophthalmoscopy",
  "retinal exam",
  "slit lamp",
  "안저",
  "산동",
];

const RETINAL_DETACHMENT_BSCAN_ACTION_TERMS = [
  "b-scan",
  "ocular ultrasound",
  "ultrasound",
  "초음파",
];

const RETINAL_DETACHMENT_URGENT_TIMING_ACTION_TERMS = [
  "emergency department",
  "emergency ophthalmology",
  "same-day",
  "urgent referral",
  "응급",
];

const RETINAL_DETACHMENT_SPECIALIST_ACTION_TERMS = [
  "ophthalmology",
  "retina specialist",
  "retinal surgery",
  "urgent ophthalmology",
  "vitreoretinal",
  "안과",
];

const RETINAL_DETACHMENT_DEFINITIVE_REPAIR_ACTION_TERMS = [
  "cryotherapy",
  "laser retinopexy",
  "pneumatic retinopexy",
  "retinal repair",
  "scleral buckle",
  "vitrectomy",
  "레이저",
];

const RETINAL_DETACHMENT_NO_DELAY_SAFETY_TERMS = [
  "do not delay",
  "not delay",
  "지연",
];

const RETINAL_DETACHMENT_URGENT_OPHTHALMOLOGY_SAFETY_TERMS = [
  "emergency ophthalmology",
  "same day",
  "same-day",
  "urgent ophthalmology",
  "urgent",
  "응급",
  "즉시",
];

const RETINAL_DETACHMENT_MACULA_STATUS_SAFETY_TERMS = [
  "macula",
  "macula off",
  "macula on",
  "macular involvement",
  "황반",
];

const RETINAL_DETACHMENT_CENTRAL_VISUAL_STATUS_SAFETY_TERMS = [
  "central vision",
  "visual field",
  "중심시력",
];

const RETINAL_DETACHMENT_RETINAL_BREAK_DIFFERENTIAL_SAFETY_TERMS = [
  "retinal tear",
  "망막 열공",
];

const RETINAL_DETACHMENT_VITREOUS_DIFFERENTIAL_SAFETY_TERMS = [
  "posterior vitreous detachment",
  "pvd",
  "vitreous hemorrhage",
  "vitreous detachment",
  "감별",
];

const RETINAL_DETACHMENT_RETURN_PRECAUTION_SAFETY_TERMS = [
  "progression",
  "recheck",
  "return precautions",
  "worsening vision",
  "악화",
];

const RETINAL_DETACHMENT_PERIOPERATIVE_PRECAUTION_SAFETY_TERMS = [
  "avoid eye pressure",
  "head position",
  "nothing by mouth",
  "npo",
  "금식",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_DIRECT_CONTEXT_TERMS = [
  "branch retinal artery occlusion",
  "brao",
  "central retinal artery occlusion",
  "crao",
  "retinal artery occlusion",
  "retinal infarction",
  "retinal stroke",
  "눈 중풍",
  "망막동맥폐쇄",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_VISION_CONTEXT_TERMS = [
  "acute monocular vision loss",
  "acute painless vision loss",
  "cherry red spot",
  "monocular blindness",
  "monocular vision loss",
  "painless loss of vision",
  "painless monocular vision loss",
  "sudden blindness",
  "sudden monocular vision loss",
  "sudden painless vision loss",
  "단안",
  "무통",
  "시력소실",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_STROKE_RISK_CONTEXT_TERMS = [
  "atrial fibrillation",
  "carotid",
  "diabetes",
  "embolus",
  "hyperlipidemia",
  "hypertension",
  "stroke",
  "thromboembolic",
  "vascular risk",
  "고혈압",
  "당뇨",
  "색전",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_ONSET_ACTION_TERMS = [
  "last known well",
  "last-known-normal",
  "last-known-well",
  "onset",
  "symptom onset",
  "증상 발생",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_STROKE_ACTIVATION_ACTION_TERMS = [
  "stroke activation",
  "stroke center",
  "stroke code",
  "stroke pathway",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_VISUAL_CONFIRM_ACTION_TERMS = [
  "visual acuity",
  "시력",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_FUNDUS_CONFIRM_ACTION_TERMS = [
  "cherry red spot",
  "dilated fundus",
  "fundus exam",
  "fundus photograph",
  "optic disc",
  "retinal exam",
  "retinal whitening",
  "안저",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_OPHTHALMOLOGY_CONFIRM_ACTION_TERMS = [
  "ophthalmology",
  "retina",
  "안과",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_BRAIN_VASCULAR_ACTION_TERMS = [
  "brain imaging",
  "cta",
  "ct angiography",
  "mra",
  "mri",
  "stroke workup",
  "vascular imaging",
  "혈관",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_CAROTID_ACTION_TERMS = [
  "carotid",
  "carotid doppler",
  "carotid ultrasound",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_CARDIAC_EMBOLIC_ACTION_TERMS = [
  "ecg",
  "echocardiogram",
  "embol",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_REPERFUSION_REVIEW_ACTION_TERMS = [
  "alteplase",
  "fibrinolysis",
  "reperfusion",
  "thrombolysis",
  "thrombolytic",
  "tnk",
  "tpa",
  "혈전용해",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_IOP_LOWERING_ACTION_TERMS = [
  "acetazolamide",
  "anterior chamber paracentesis",
  "hyperbaric oxygen",
  "iop lowering",
  "ocular hypotensive",
  "ocular massage",
  "paracentesis",
  "timolol",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_RETINAL_MIMIC_SAFETY_TERMS = [
  "retinal detachment",
  "vitreous hemorrhage",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_NEURO_MIMIC_SAFETY_TERMS = [
  "acute optic neuropathy",
  "migraine",
  "optic neuritis",
  "감별",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_THROMBOLYSIS_ELIGIBILITY_SAFETY_TERMS = [
  "contraindication",
  "thrombolysis eligibility",
  "금기",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_BLEEDING_RISK_SAFETY_TERMS = [
  "anticoagulant",
  "bleeding",
  "hemorrhage",
  "inr",
  "platelet",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_BP_SURGERY_RISK_SAFETY_TERMS = [
  "blood pressure",
  "recent surgery",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_ANTIPLATELET_STATIN_SAFETY_TERMS = [
  "antiplatelet",
  "statin",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_AFIB_CAROTID_SAFETY_TERMS = [
  "atrial fibrillation",
  "carotid stenosis",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_RISK_FACTOR_SAFETY_TERMS = [
  "risk factor",
  "secondary prevention",
  "stroke prevention",
  "vascular risk",
  "예방",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_ESR_CRP_SAFETY_TERMS = [
  "crp",
  "esr",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_PLATELET_SAFETY_TERMS = [
  "platelet",
  "혈소판",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_GCA_SYMPTOM_SAFETY_TERMS = [
  "gca",
  "giant cell arteritis",
  "jaw claudication",
  "scalp tenderness",
  "temporal arteritis",
  "temporal headache",
  "측두",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_STEROID_SAFETY_TERMS = [
  "high-dose steroid",
  "high-dose systemic corticosteroid",
  "steroid",
];

const OPEN_GLOBE_DIRECT_CONTEXT_TERMS = [
  "globe laceration",
  "globe perforation",
  "globe rupture",
  "intraocular foreign body",
  "open globe",
  "penetrating eye injury",
  "ruptured globe",
  "안구 관통상",
  "안구파열",
];

const OPEN_GLOBE_TRAUMA_CONTEXT_TERMS = [
  "eye trauma",
  "hammering",
  "high-speed metal",
  "metal on metal",
  "projectile",
  "puncture wound",
  "sharp eye injury",
  "vision loss after trauma",
  "외상",
];

const OPEN_GLOBE_SIGN_CONTEXT_TERMS = [
  "aqueous leak",
  "extruded ocular contents",
  "irregular pupil",
  "misshapen pupil",
  "positive seidel",
  "seidel sign",
  "shallow anterior chamber",
  "uveal prolapse",
  "동공",
];

const OPEN_GLOBE_RIGID_SHIELD_ACTION_TERMS = [
  "eye shield",
  "protective shield",
  "rigid shield",
  "보호대",
];

const OPEN_GLOBE_SHIELD_NO_PRESSURE_ACTION_TERMS = [
  "avoid pressure",
  "no pressure",
  "without pressure",
  "압박",
];

const OPEN_GLOBE_SYSTEMIC_IV_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "broad-spectrum antibiotic",
  "iv antibiotics",
  "systemic antibiotic",
  "항생제",
];

const OPEN_GLOBE_VANCOMYCIN_ACTION_TERMS = ["vancomycin"];

const OPEN_GLOBE_GRAM_NEGATIVE_ACTION_TERMS = [
  "ceftazidime",
  "cefazolin",
  "cephalosporin",
  "fluoroquinolone",
  "levofloxacin",
  "moxifloxacin",
];

const OPEN_GLOBE_TETANUS_ACTION_TERMS = [
  "tdap",
  "tetanus",
  "tetanus prophylaxis",
  "tetanus vaccine",
  "파상풍",
];

const OPEN_GLOBE_CT_ORBIT_ACTION_TERMS = [
  "ct orbit",
  "ct orbits",
  "orbital ct",
];

const OPEN_GLOBE_FOREIGN_BODY_IMAGING_ACTION_TERMS = [
  "foreign body",
  "intraocular foreign body",
  "x-ray",
  "영상",
];

const OPEN_GLOBE_URGENT_OPHTHALMOLOGY_ACTION_TERMS = [
  "emergency ophthalmology",
  "ophthalmology",
  "ophthalmologist",
  "urgent ophthalmology",
  "안과",
];

const OPEN_GLOBE_SURGICAL_REPAIR_ACTION_TERMS = [
  "corneal closure",
  "globe closure",
  "globe exploration",
  "globe repair",
  "layered closure",
  "operative repair",
  "primary repair",
  "scleral closure",
  "surgical exploration",
  "surgical repair",
  "wound closure",
  "수술적 봉합",
  "수술적 탐색",
  "안구 봉합",
  "안구 수술",
];

const OPEN_GLOBE_PRESSURE_AVOIDANCE_SAFETY_TERMS = [
  "avoid pressure",
  "do not press",
  "no pressure",
  "pressure patch",
  "압박",
];

const OPEN_GLOBE_PATCH_TONOMETRY_SAFETY_TERMS = [
  "eye patching",
  "not patch",
  "tonometry",
  "안압",
];

const OPEN_GLOBE_ULTRASOUND_MANIPULATION_SAFETY_TERMS = [
  "manipulation",
  "ocular ultrasound",
  "ultrasound",
];

const OPEN_GLOBE_EXTRUSION_SAFETY_TERMS = [
  "extrude ocular contents",
  "extrusion",
  "ocular contents",
];

const OPEN_GLOBE_NPO_SAFETY_TERMS = [
  "nothing by mouth",
  "npo",
  "금식",
];

const OPEN_GLOBE_ANTIEMETIC_SAFETY_TERMS = [
  "antiemetic",
  "nausea",
  "vomiting",
  "구토",
];

const OPEN_GLOBE_ANALGESIA_SAFETY_TERMS = [
  "analgesia",
  "pain control",
];

const OPEN_GLOBE_FOREIGN_BODY_REMOVAL_SAFETY_TERMS = [
  "do not remove",
  "leave in place",
  "remove foreign body",
];

const OPEN_GLOBE_MRI_METALLIC_SAFETY_TERMS = [
  "metallic",
  "mri",
  "금속",
];

const OPEN_GLOBE_TOPICAL_OINTMENT_SAFETY_TERMS = [
  "avoid ointment",
  "avoid topical",
  "ointment",
  "topical antibiotics are avoided",
];

const OPEN_GLOBE_ENDOPHTHALMITIS_SAFETY_TERMS = [
  "endophthalmitis",
  "posttraumatic infection",
  "감염",
  "안내염",
];

const OPEN_GLOBE_INTRAVITREAL_SAFETY_TERMS = ["intravitreal"];

const OPEN_GLOBE_FOLLOWUP_PROGNOSIS_SAFETY_TERMS = [
  "close recheck",
  "recheck",
  "sympathetic ophthalmia",
  "vision prognosis",
];

const ENDOPHTHALMITIS_DIRECT_CONTEXT_TERMS = [
  "acute endophthalmitis",
  "bacterial endophthalmitis",
  "endogenous endophthalmitis",
  "endophthalmitis",
  "exogenous endophthalmitis",
  "post-cataract endophthalmitis",
  "post-injection endophthalmitis",
  "postoperative endophthalmitis",
  "안내염",
];

const ENDOPHTHALMITIS_RISK_CONTEXT_TERMS = [
  "anti-vegf injection",
  "cataract surgery",
  "eye surgery",
  "intravitreal injection",
  "ocular surgery",
  "penetrating trauma",
  "post cataract",
  "postoperative eye infection",
  "recent eye procedure",
  "trabeculectomy",
  "백내장",
  "수술",
];

const ENDOPHTHALMITIS_SYMPTOM_CONTEXT_TERMS = [
  "decreased vision",
  "eye pain",
  "hypopyon",
  "loss of red reflex",
  "photophobia",
  "red eye",
  "severe ocular ache",
  "vitritis",
  "눈 통증",
  "시력저하",
];

const ENDOPHTHALMITIS_URGENT_OPHTHO_ACTION_TERMS = [
  "emergency ophthalmology",
  "ophthalmology",
  "retina",
  "same-day",
  "urgent ophthalmology",
  "urgent referral",
  "vitreoretinal",
  "응급",
  "안과",
];

const ENDOPHTHALMITIS_OCULAR_SAMPLING_ACTION_TERMS = [
  "aqueous culture",
  "aqueous tap",
  "tap and inject",
  "vitreous aspirate",
  "vitreous culture",
  "vitreous tap",
];

const ENDOPHTHALMITIS_MICROBIOLOGY_ACTION_TERMS = [
  "culture",
  "gram stain",
  "배양",
];

const ENDOPHTHALMITIS_INTRAVITREAL_ROUTE_ACTION_TERMS = [
  "intravitreal antibiotic",
  "intravitreal antimicrobials",
  "intravitreal injection",
  "tap and inject",
  "안내 주사",
  "항생제",
];

const ENDOPHTHALMITIS_INTRAVITREAL_VANCOMYCIN_ACTION_TERMS = ["vancomycin"];

const ENDOPHTHALMITIS_INTRAVITREAL_CEFTAZIDIME_ACTION_TERMS = [
  "ceftazidime",
  "cephalosporin",
  "gram-negative",
  "gram negative",
];

const ENDOPHTHALMITIS_ENDOGENOUS_CONTEXT_ACTION_TERMS = [
  "endogenous",
  "systemic infection",
  "sepsis",
];

const ENDOPHTHALMITIS_IV_ANTIMICROBIAL_ACTION_TERMS = [
  "iv antibiotic",
  "iv antimicrobials",
  "intravenous antibiotic",
  "intravenous antimicrobials",
];

const ENDOPHTHALMITIS_BLOOD_URINE_CULTURE_ACTION_TERMS = [
  "blood culture",
  "urine culture",
  "혈액배양",
];

const ENDOPHTHALMITIS_NO_DELAY_SAFETY_TERMS = [
  "do not delay",
  "emergency",
  "not delay",
  "urgent",
  "지연",
];

const ENDOPHTHALMITIS_DIFFERENTIAL_SAFETY_TERMS = [
  "conjunctivitis",
  "not conjunctivitis",
  "uveitis",
];

const ENDOPHTHALMITIS_VITRECTOMY_ACTION_SAFETY_TERMS = [
  "vitrectomy",
  "유리체절제",
];

const ENDOPHTHALMITIS_SEVERE_VISION_SAFETY_TERMS = [
  "count fingers",
  "light perception",
  "poor vision",
  "severe case",
  "vitreous opacity",
];

const ENDOPHTHALMITIS_FUNGAL_CONTEXT_SAFETY_TERMS = [
  "fungal",
  "immunocompromised",
  "intravenous drug",
  "iv drug",
  "voriconazole",
  "진균",
];

const ENDOPHTHALMITIS_STEROID_CONTRAINDICATION_SAFETY_TERMS = [
  "avoid corticosteroid",
  "avoid steroid",
  "contraindicated corticosteroid",
  "contraindicated steroid",
  "corticosteroid contraindicated",
  "steroid contraindicated",
];

const ENDOPHTHALMITIS_VISUAL_MONITORING_SAFETY_TERMS = [
  "visual acuity",
  "daily exam",
];

const ENDOPHTHALMITIS_RESPONSE_CULTURE_MONITORING_SAFETY_TERMS = [
  "culture sensitivity",
  "no improvement",
  "repeat injection",
  "repeat intravitreal",
  "recheck",
  "worsening",
  "추적",
];

const TTP_DIRECT_CONTEXT_TERMS = [
  "acquired ttp",
  "immune ttp",
  "ittp",
  "thrombotic thrombocytopenic purpura",
  "ttp",
  "혈전성 혈소판감소성 자반증",
];

const TTP_MAHA_CONTEXT_TERMS = [
  "hemolysis",
  "hemolytic anemia",
  "maha",
  "microangiopathic",
  "schistocyte",
  "schistocytes",
  "thrombotic microangiopathy",
  "tma",
  "용혈",
];

const TTP_THROMBOCYTOPENIA_CONTEXT_TERMS = [
  "low platelets",
  "platelet count",
  "platelets 10",
  "platelets 20",
  "platelets 30",
  "severe thrombocytopenia",
  "thrombocytopenia",
  "혈소판",
];

const TTP_ORGAN_CONTEXT_TERMS = [
  "acute kidney injury",
  "confusion",
  "fever",
  "neurologic",
  "renal injury",
  "seizure",
  "stroke",
  "신경",
  "신장",
];

const TTP_HEMATOLOGY_ACTION_TERMS = [
  "hematology",
  "haematology",
  "혈액내과",
];

const TTP_PEX_ACTION_TERMS = [
  "plasma exchange",
  "plasma-exchange",
  "plasmapheresis",
  "therapeutic plasma exchange",
  "tpe",
  "혈장교환",
];

const TTP_ADAMTS13_ACTION_TERMS = [
  "adamts13",
];

const TTP_ADAMTS13_BEFORE_TREATMENT_ACTION_TERMS = [
  "before plasma",
  "before plasma exchange",
  "before plasma products",
  "before tpe",
];

const TTP_HEMOLYSIS_LAB_ACTION_TERMS = [
  "bilirubin",
  "blood smear",
  "coombs",
  "direct antiglobulin",
  "haptoglobin",
  "hemolysis labs",
  "ldh",
  "peripheral smear",
  "reticulocyte",
  "schistocyte",
  "schistocytes",
  "혈액도말",
];

const TTP_COAG_RENAL_LAB_ACTION_TERMS = [
  "creatinine",
  "fibrinogen",
  "pt",
  "ptt",
  "renal function",
  "urinalysis",
];

const TTP_STEROID_ACTION_TERMS = [
  "corticosteroid",
  "glucocorticoid",
  "methylprednisolone",
  "prednisone",
  "steroid",
  "스테로이드",
];

const TTP_RITUXIMAB_ACTION_TERMS = [
  "rituximab",
  "immunosuppression",
];

const TTP_CAPLACIZUMAB_ACTION_TERMS = [
  "anti-vwf",
  "anti-von willebrand",
  "caplacizumab",
  "카플라시주맙",
];

const TTP_DO_NOT_WAIT_SAFETY_TERMS = [
  "before adamts13",
  "do not delay",
  "do not wait",
  "not delay",
  "pending adamts13",
  "treat empirically",
  "지연",
];

const TTP_PLATELET_AVOIDANCE_SAFETY_TERMS = [
  "avoid platelet",
  "avoid transfusion",
  "do not transfuse platelets",
  "no platelet transfusion",
];

const TTP_PLATELET_EXCEPTION_SAFETY_TERMS = [
  "life-threatening bleeding",
  "major bleeding",
  "procedure need",
  "transfusion only",
  "urgent procedure",
  "혈소판 수혈",
];

const TTP_TMA_DIFFERENTIAL_SAFETY_TERMS = [
  "ahus",
  "hus",
  "itp",
];

const TTP_COAG_SEPSIS_PREGNANCY_DIFFERENTIAL_SAFETY_TERMS = [
  "dic",
  "disseminated intravascular coagulation",
  "hellp",
  "preeclampsia",
  "sepsis",
  "감별",
];

const TTP_PLATELET_LDH_MONITORING_SAFETY_TERMS = [
  "hemolysis",
  "ldh",
  "platelet count",
  "platelet recovery",
  "혈소판",
];

const TTP_ORGAN_COMPLICATION_MONITORING_SAFETY_TERMS = [
  "aki",
  "bleeding",
  "cardiac",
  "myocardial",
  "neurologic",
  "renal",
  "thrombosis",
];

const TTP_RELAPSE_REFRACTORY_SAFETY_TERMS = [
  "recurrence",
  "refractory",
  "relapse",
  "relapsing",
];

const ACUTE_LIVER_FAILURE_DIRECT_CONTEXT_TERMS = [
  "acute hepatic failure",
  "acute liver failure",
  "alf",
  "fulminant hepatic failure",
  "fulminant liver failure",
  "급성 간부전",
];

const ACUTE_LIVER_FAILURE_INJURY_CONTEXT_TERMS = [
  "acute hepatitis",
  "alt 1000",
  "ast 1000",
  "coagulopathy",
  "inr 1.5",
  "inr 2",
  "marked transaminitis",
  "severe acute liver injury",
  "transaminases",
  "응고장애",
];

const ACUTE_LIVER_FAILURE_ENCEPHALOPATHY_CONTEXT_TERMS = [
  "altered mental status",
  "asterixis",
  "confusion",
  "encephalopathy",
  "hepatic encephalopathy",
  "somnolence",
  "혼돈",
];

const ACUTE_LIVER_FAILURE_ICU_ACTION_TERMS = [
  "icu",
  "intensive care",
  "high-acuity",
  "중환자",
];

const ACUTE_LIVER_FAILURE_TRANSPLANT_CENTER_ACTION_TERMS = [
  "liver transplant",
  "transplant center",
  "transplant service",
  "이식",
];

const ACUTE_LIVER_FAILURE_TRANSFER_EVALUATION_ACTION_TERMS = [
  "early transfer",
  "status 1a",
  "transfer to liver",
  "transfer to transplant",
  "transplant evaluation",
];

const ACUTE_LIVER_FAILURE_NAC_ACTION_TERMS = [
  "acetylcysteine",
  "n-acetylcysteine",
  "nac",
  "엔아세틸시스테인",
];

const ACUTE_LIVER_FAILURE_TOX_WORKUP_ACTION_TERMS = [
  "acetaminophen",
  "toxicology",
];

const ACUTE_LIVER_FAILURE_VIRAL_WORKUP_ACTION_TERMS = [
  "hepatitis serologies",
  "hsv",
  "viral hepatitis",
];

const ACUTE_LIVER_FAILURE_AUTOIMMUNE_METABOLIC_WORKUP_ACTION_TERMS = [
  "autoimmune",
  "ceruloplasmin",
  "wilson",
  "원인",
];

const ACUTE_LIVER_FAILURE_COAG_MONITORING_ACTION_TERMS = [
  "inr",
  "pt",
  "prothrombin",
];

const ACUTE_LIVER_FAILURE_AMMONIA_MONITORING_ACTION_TERMS = [
  "ammonia",
];

const ACUTE_LIVER_FAILURE_GLUCOSE_MONITORING_ACTION_TERMS = [
  "glucose",
  "혈당",
];

const ACUTE_LIVER_FAILURE_PERFUSION_MONITORING_ACTION_TERMS = [
  "lactate",
  "ph",
];

const ACUTE_LIVER_FAILURE_RENAL_MONITORING_ACTION_TERMS = [
  "creatinine",
  "renal",
];

const ACUTE_LIVER_FAILURE_NEURO_MONITORING_ACTION_TERMS = [
  "encephalopathy",
  "neurologic",
  "west haven",
];

const ACUTE_LIVER_FAILURE_ICP_CEREBRAL_EDEMA_SAFETY_TERMS = [
  "cerebral edema",
  "intracranial pressure",
  "뇌부종",
];

const ACUTE_LIVER_FAILURE_CEREBRAL_EDEMA_INTERVENTION_SAFETY_TERMS = [
  "head elevation",
  "hypertonic saline",
  "mannitol",
  "seizure",
];

const ACUTE_LIVER_FAILURE_COAGULOPATHY_AVOID_SAFETY_TERMS = [
  "avoid ffp",
  "avoid fresh frozen plasma",
  "avoid routine correction",
  "do not correct inr",
  "no routine ffp",
  "no routine plasma",
  "응고 보정 회피",
];

const ACUTE_LIVER_FAILURE_COAGULOPATHY_EXCEPTION_SAFETY_TERMS = [
  "bleeding",
  "hemorrhage",
  "invasive procedure",
  "procedure",
  "procedural bleeding",
  "시술",
  "출혈",
];

const ACUTE_LIVER_FAILURE_GLUCOSE_MONITORING_SAFETY_TERMS = [
  "glucose",
  "monitor glucose",
  "혈당",
];

const ACUTE_LIVER_FAILURE_DEXTROSE_HYPOGLYCEMIA_SAFETY_TERMS = [
  "dextrose",
  "hypoglycemia",
  "저혈당",
];

const ACUTE_LIVER_FAILURE_PROGNOSIS_CRITERIA_SAFETY_TERMS = [
  "king's college",
  "kings college",
  "meld",
  "transplant criteria",
  "transplant-free",
];

const ACUTE_LIVER_FAILURE_TRANSFER_LISTING_SAFETY_TERMS = [
  "early transplant",
  "listing",
  "status 1a",
  "transplant center",
  "전원",
];

const ACUTE_LIVER_FAILURE_INFECTION_SAFETY_TERMS = [
  "antibiotic",
  "culture",
  "infection",
  "sepsis",
];

const ACUTE_LIVER_FAILURE_HEMODYNAMIC_RENAL_SAFETY_TERMS = [
  "fluid overload",
  "hemodynamic",
  "renal failure",
  "vasopressor",
];

const NEUTROPENIC_FEVER_CONTEXT_TERMS = [
  "absolute neutrophil count",
  "anc below 500",
  "febrile neutropenia",
  "neutropenic fever",
  "neutropenic sepsis",
  "neutropenic patient with fever",
  "post-chemotherapy fever",
  "호중구감소",
  "호중구감소증",
];

const NEUTROPENIC_FEVER_ANC_ACTION_TERMS = [
  "absolute neutrophil",
  "anc",
  "cbc",
  "full blood count",
  "neutrophil count",
  "백혈구",
  "호중구",
];

const NEUTROPENIC_FEVER_BLOOD_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
];

const NEUTROPENIC_FEVER_CENTRAL_LINE_CULTURE_ACTION_TERMS = [
  "central line culture",
  "central line",
  "each lumen",
  "lumen",
];

const NEUTROPENIC_FEVER_PERIPHERAL_CULTURE_ACTION_TERMS = [
  "peripheral culture",
  "peripheral vein",
  "peripheral",
];

const NEUTROPENIC_FEVER_SOURCE_CULTURE_ACTION_TERMS = [
  "culture",
  "cultures",
  "source",
  "urinalysis",
  "배양",
];

const NEUTROPENIC_FEVER_ANTIPSEUDOMONAL_ACTION_TERMS = [
  "anti-pseudomonal",
  "antipseudomonal",
  "cefepime",
  "ceftazidime",
  "meropenem",
  "piperacillin",
  "tazobactam",
  "항녹농균",
];

const NEUTROPENIC_FEVER_ANTIBIOTIC_TIMING_ACTION_TERMS = [
  "immediate",
  "immediately",
  "within 1 hour",
  "1 hour",
  "one hour",
  "즉시",
];

const NEUTROPENIC_FEVER_ADMISSION_ESCALATION_ACTION_TERMS = [
  "admit",
  "hospital",
  "inpatient",
  "icu",
  "sepsis",
  "입원",
];

const NEUTROPENIC_FEVER_ONCOLOGY_ESCALATION_ACTION_TERMS = [
  "hematology",
  "oncology",
  "혈액",
  "종양",
];

const NEUTROPENIC_FEVER_RISK_SCORE_ACTION_TERMS = [
  "cisne",
  "mascc",
  "risk score",
  "risk stratification",
];

const NEUTROPENIC_FEVER_ALLERGY_SAFETY_TERMS = [
  "allergy",
  "hypersensitivity",
];

const NEUTROPENIC_FEVER_RENAL_HEPATIC_DOSING_SAFETY_TERMS = [
  "creatinine",
  "hepatic",
  "kidney",
  "liver",
  "renal",
  "toxicity",
  "간",
  "신장",
];

const NEUTROPENIC_FEVER_LOCAL_RESISTANCE_SAFETY_TERMS = [
  "antibiogram",
  "local microbiology",
  "resistant",
];

const NEUTROPENIC_FEVER_VANCOMYCIN_NOT_ROUTINE_SAFETY_TERMS = [
  "not routine vancomycin",
  "not standard vancomycin",
  "routine vancomycin not",
  "vancomycin not recommended",
  "vancomycin not routine",
];

const NEUTROPENIC_FEVER_VANCOMYCIN_INDICATION_SAFETY_TERMS = [
  "catheter",
  "central line",
  "gram-positive",
  "mrsa",
  "pneumonia",
  "skin",
  "soft tissue",
  "vancomycin",
  "중심정맥",
];

const NEUTROPENIC_FEVER_RISK_SCORE_SAFETY_TERMS = [
  "cisne",
  "high risk",
  "low risk",
  "mascc",
  "risk score",
];

const NEUTROPENIC_FEVER_OUTPATIENT_CRITERIA_SAFETY_TERMS = [
  "comorbidity",
  "discharge",
  "outpatient",
  "social",
  "퇴원",
];

const NEUTROPENIC_FEVER_RETURN_PRECAUTION_SAFETY_TERMS = [
  "readmission",
  "return precautions",
  "worsening",
];

const NEUTROPENIC_FEVER_PERSISTENT_FEVER_SAFETY_TERMS = [
  "4-7 days",
  "4 to 7 days",
  "persistent fever",
  "recurrent fever",
];

const NEUTROPENIC_FEVER_ANTIFUNGAL_REASSESSMENT_SAFETY_TERMS = [
  "antifungal",
  "fungal",
  "invasive fungal",
];

const NEUTROPENIC_FEVER_CLINICAL_MICRO_REASSESSMENT_SAFETY_TERMS = [
  "deterioration",
  "microbiologic",
  "reassess",
  "reassessment",
  "resistant",
  "재평가",
];

const OBSTRUCTIVE_PYELONEPHRITIS_COMBINED_CONTEXT_TERMS = [
  "infected obstructing stone",
  "infected obstructive uropathy",
  "infected ureteral stone",
  "obstructed infected kidney",
  "obstructive pyelonephritis",
  "pyelonephritis with obstruction",
  "septic obstructive uropathy",
  "stone sepsis",
  "urosepsis with hydronephrosis",
  "폐쇄성 신우신염",
];

const OBSTRUCTIVE_PYELONEPHRITIS_INFECTION_CONTEXT_TERMS = [
  "fever",
  "infected",
  "pyelonephritis",
  "rigor",
  "sepsis",
  "septic shock",
  "urinary tract infection",
  "uti",
  "urosepsis",
  "발열",
  "신우신염",
];

const OBSTRUCTIVE_PYELONEPHRITIS_OBSTRUCTION_CONTEXT_TERMS = [
  "anuria",
  "hydronephrosis",
  "obstructed",
  "obstructing",
  "obstruction",
  "obstructive uropathy",
  "stone",
  "ureteral stone",
  "urolithiasis",
  "수신증",
  "요로결석",
  "요로폐색",
];

const OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "broad-spectrum",
  "cefepime",
  "ceftriaxone",
  "empiric",
  "immediate antibiotics",
  "piperacillin",
  "항생제",
];

const OBSTRUCTIVE_PYELONEPHRITIS_URINE_CULTURE_ACTION_TERMS = [
  "urine culture",
  "urine sample",
  "urine specimen",
  "urinary culture",
  "소변 배양",
  "요 배양",
];

const OBSTRUCTIVE_PYELONEPHRITIS_BLOOD_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "blood sample",
  "blood specimen",
  "혈액 배양",
];

const OBSTRUCTIVE_PYELONEPHRITIS_IMAGING_ACTION_TERMS = [
  "ct",
  "computed tomography",
  "ultrasound",
  "초음파",
];

const OBSTRUCTIVE_PYELONEPHRITIS_OBSTRUCTION_ACTION_TERMS = [
  "hydronephrosis",
  "obstruction",
  "obstructive",
  "stone",
  "ureteral stone",
  "urolithiasis",
  "수신증",
  "요로결석",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_URGENCY_ACTION_TERMS = [
  "decompression",
  "drainage",
  "source control",
  "urgent",
  "배액",
  "응급",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_ROUTE_ACTION_TERMS = [
  "double-j stent",
  "double j stent",
  "jj stent",
  "nephrostomy",
  "nephrostomy catheter",
  "nephrostomy tube",
  "pcn",
  "percutaneous drainage",
  "percutaneous nephrostomy",
  "retrograde stent",
  "retrograde ureteral stent",
  "ureteral stent",
  "ureteral stenting",
  "경피 신루",
  "경피적 신루",
  "신루관",
  "요관 스텐트",
];

const OBSTRUCTIVE_PYELONEPHRITIS_SEPSIS_SUPPORT_ACTION_TERMS = [
  "fluid",
  "icu",
  "lactate",
  "septic shock",
  "shock",
  "vasopressor",
  "쇼크",
  "수액",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DELAY_INTENT_SAFETY_TERMS = [
  "defer",
  "delay",
  "postpone",
  "wait",
  "지연",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DEFINITIVE_STONE_SAFETY_TERMS = [
  "definitive stone",
  "lithotripsy",
  "stone removal",
  "ureteroscopy",
  "쇄석술",
  "요관경",
];

const OBSTRUCTIVE_PYELONEPHRITIS_INFECTION_RESOLUTION_SAFETY_TERMS = [
  "infection resolves",
  "sepsis resolves",
  "until infection",
  "until sepsis",
  "감염 조절",
  "패혈증 조절",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_REVIEW_SAFETY_TERMS = [
  "decompression",
  "drainage option",
  "drainage options",
  "review drainage",
  "source control",
  "배액",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_ROUTE_SAFETY_TERMS = [
  "nephrostomy",
  "pcn",
  "percutaneous nephrostomy",
  "retrograde stent",
  "stent",
  "ureteral stent",
  "신루",
  "스텐트",
];

const OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_INTENT_SAFETY_TERMS = [
  "adjust",
  "reassess",
  "re-evaluate",
  "re-evaluation",
  "재평가",
];

const OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_DATA_SAFETY_TERMS = [
  "antibiogram",
  "culture result",
  "renal dosing",
  "resistance",
  "susceptibility",
  "urine culture",
  "배양",
];

const OBSTRUCTIVE_PYELONEPHRITIS_COMPLICATION_RISK_SAFETY_TERMS = [
  "acute kidney injury",
  "aki",
  "anuria",
  "immunocompromised",
  "pregnancy",
  "renal failure",
  "septic shock",
  "solitary kidney",
  "urosepsis",
  "무뇨",
];

const SEVERE_HYPOGLYCEMIA_CONTEXT_TERMS = [
  "blood glucose 40",
  "blood glucose 50",
  "glucose 40",
  "glucose 50",
  "hypoglycemic emergency",
  "hypoglycemic seizure",
  "insulin overdose",
  "insulin shock",
  "low blood glucose",
  "severe hypoglycemia",
  "sulfonylurea overdose",
  "저혈당",
];

const SEVERE_HYPOGLYCEMIA_GLUCOSE_CHECK_ACTION_TERMS = [
  "bedside glucose",
  "blood glucose",
  "fingerstick",
  "glucose check",
  "point-of-care glucose",
  "poc glucose",
  "혈당",
];

const SEVERE_HYPOGLYCEMIA_RESCUE_TREATMENT_ACTION_TERMS = [
  "d10",
  "d50",
  "dasiglucagon",
  "dextrose",
  "glucose gel",
  "glucose tablet",
  "glucose tablets",
  "glucagon",
  "iv dextrose",
  "oral glucose",
  "parenteral glucose",
  "sucrose",
  "포도당",
];

const SEVERE_HYPOGLYCEMIA_RECHECK_ACTION_TERMS = [
  "15 minutes",
  "glucose recheck",
  "recheck",
  "repeat blood glucose",
  "repeat glucose",
  "재측정",
];

const SEVERE_HYPOGLYCEMIA_SUSTAINED_GLUCOSE_ACTION_TERMS = [
  "complex carbohydrate",
  "continuous dextrose",
  "dextrose infusion",
  "feeding",
  "meal",
  "protein",
  "snack",
];

const SEVERE_HYPOGLYCEMIA_PROLONGED_RISK_ACTION_TERMS = [
  "altered mental status",
  "long-acting insulin",
  "renal failure",
  "seizure",
  "sulfonylurea",
];

const SEVERE_HYPOGLYCEMIA_ESCALATION_ACTION_TERMS = [
  "admit",
  "continuous dextrose",
  "dextrose infusion",
  "hospitalize",
  "observation",
  "prolonged monitoring",
  "입원",
];

const SEVERE_HYPOGLYCEMIA_ROUTE_AIRWAY_SAFETY_TERMS = [
  "airway",
  "aspiration",
  "consciousness",
  "npo",
  "seizure",
  "swallow",
  "unconscious",
  "기도",
];

const SEVERE_HYPOGLYCEMIA_RECURRENCE_RISK_SAFETY_TERMS = [
  "long-acting insulin",
  "rebound",
  "recurrent",
  "sulfonylurea",
  "재발",
];

const SEVERE_HYPOGLYCEMIA_RECURRENCE_MONITORING_SAFETY_TERMS = [
  "admit",
  "continuous dextrose",
  "dextrose infusion",
  "hospitalize",
  "observation",
  "prolonged monitoring",
];

const SEVERE_HYPOGLYCEMIA_OCTREOTIDE_SAFETY_TERMS = ["octreotide"];

const SEVERE_HYPOGLYCEMIA_CAUSE_RISK_SAFETY_TERMS = [
  "adrenal",
  "alcohol",
  "hepatic",
  "kidney",
  "liver",
  "renal",
  "sepsis",
  "간",
  "신장",
];

const SEVERE_HYPOGLYCEMIA_DISCHARGE_PREVENTION_SAFETY_TERMS = [
  "cgm",
  "dose adjustment",
  "driving",
  "education",
  "glucagon prescription",
  "meal access",
  "return precautions",
  "safe discharge",
  "교육",
];

const INSULIN_SULFONYLUREA_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "glibenclamide overdose",
  "glibenclamide poisoning",
  "gliclazide overdose",
  "glimepiride overdose",
  "glipizide overdose",
  "glyburide overdose",
  "insulin overdose",
  "insulin poisoning",
  "insulin toxicity",
  "sulfonylurea overdose",
  "sulfonylurea poisoning",
  "sulfonylurea toxicity",
];

const INSULIN_SULFONYLUREA_TOXICITY_DRUG_CONTEXT_TERMS = [
  "glibenclamide",
  "gliclazide",
  "glimepiride",
  "glipizide",
  "glyburide",
  "insulin",
  "sulfonylurea",
];

const SULFONYLUREA_TOXICITY_CONTEXT_TERMS = [
  "glibenclamide",
  "gliclazide",
  "glimepiride",
  "glipizide",
  "glyburide",
  "sulfonylurea",
];

const INSULIN_SULFONYLUREA_TOXICITY_RISK_CONTEXT_TERMS = [
  "blood glucose 28",
  "blood glucose 32",
  "blood glucose 40",
  "blood glucose 50",
  "coma",
  "low blood glucose",
  "overdose",
  "poisoning",
  "recurrent hypoglycemia",
  "seizure",
];

const INSULIN_SULFONYLUREA_TOXICITY_GLUCOSE_MONITOR_ACTION_TERMS = [
  "15 minutes",
  "blood glucose",
  "bsl",
  "every 15",
  "fingerstick",
  "glucose monitoring",
  "hourly",
  "point-of-care glucose",
  "poc glucose",
  "serial glucose",
];

const INSULIN_SULFONYLUREA_TOXICITY_DEXTROSE_RESCUE_ACTION_TERMS = [
  "d50",
  "dextrose bolus",
  "iv dextrose",
  "iv glucose",
  "glucose IV",
];

const INSULIN_SULFONYLUREA_TOXICITY_DEXTROSE_INFUSION_ACTION_TERMS = [
  "continuous dextrose",
  "continuous glucose",
  "d10",
  "dextrose drip",
  "dextrose infusion",
  "glucose infusion",
];

const INSULIN_SULFONYLUREA_TOXICITY_NUTRITION_ACTION_TERMS = [
  "complex carbohydrate",
  "eat",
  "feeding",
  "meal",
  "nutrition",
  "oral carbohydrate",
];

const INSULIN_SULFONYLUREA_TOXICITY_ESCALATION_ACTION_TERMS = [
  "admit",
  "hdu",
  "icu",
  "poison center",
  "poison control",
  "toxicologist",
];

const SULFONYLUREA_TOXICITY_OCTREOTIDE_ACTION_TERMS = ["octreotide"];

const INSULIN_SULFONYLUREA_TOXICITY_ELECTROLYTE_ACTION_TERMS = [
  "electrolyte",
  "euc",
  "magnesium",
  "phosphate",
  "potassium",
];

const INSULIN_SULFONYLUREA_TOXICITY_RECURRENCE_RISK_SAFETY_TERMS = [
  "delayed",
  "extended release",
  "long-acting",
  "recurrent",
];

const INSULIN_SULFONYLUREA_TOXICITY_OBSERVATION_DURATION_SAFETY_TERMS = [
  "12 hours",
  "6 hours",
  "euglycemia",
  "euglycaemia",
  "observation",
  "stopping dextrose",
];

const INSULIN_SULFONYLUREA_TOXICITY_DEXTROSE_SAFETY_TERMS = [
  "central line",
  "d10",
  "d25",
  "d50",
  "dextrose infusion",
  "high concentration",
  "hyponatremia",
  "taper",
  "wean",
];

const INSULIN_SULFONYLUREA_TOXICITY_POTASSIUM_ELECTROLYTE_SAFETY_TERMS = [
  "electrolyte",
  "low-to-normal",
  "magnesium",
  "phosphate",
  "potassium",
];

const INSULIN_SULFONYLUREA_TOXICITY_RISK_GROUP_SAFETY_TERMS = [
  "child",
  "elderly",
  "hepatic",
  "liver",
  "non-diabetic",
  "one tablet",
  "renal",
];

const INSULIN_SULFONYLUREA_TOXICITY_DISPOSITION_SAFETY_TERMS = [
  "admission",
  "endocrine",
  "hdu",
  "icu",
  "medical clearance",
  "normal diet",
  "octreotide discontinuation",
  "therapeutic dosing",
];

const INSULIN_SULFONYLUREA_TOXICITY_DISPOSITION_STABILITY_SAFETY_TERMS = [
  "euglycemia",
  "euglycaemia",
  "medical clearance",
  "normal diet",
  "octreotide discontinuation",
  "stopping dextrose",
];

const MALIGNANT_HYPERTHERMIA_CONTEXT_TERMS = [
  "malignant hyperthermia",
  "mh crisis",
  "malignant hyperthermia crisis",
  "anesthesia hyperthermia",
  "succinylcholine hyperthermia",
  "volatile anesthetic hyperthermia",
  "악성고열",
  "악성 고열",
];

const MALIGNANT_HYPERTHERMIA_TRIGGER_STOP_ACTION_TERMS = [
  "discontinue volatile",
  "halt procedure",
  "non-triggering",
  "stop succinylcholine",
  "stop triggering",
  "triggering agent",
  "volatile agent",
];

const MALIGNANT_HYPERTHERMIA_OXYGEN_ACTION_TERMS = [
  "100% oxygen",
  "high-flow oxygen",
  "hyperventilate",
  "hyperventilation",
  "oxygen",
  "산소",
];

const MALIGNANT_HYPERTHERMIA_DANTROLENE_AGENT_ACTION_TERMS = [
  "dantrium",
  "dantrolene",
  "revonto",
  "ryanodex",
  "단트롤렌",
];

const MALIGNANT_HYPERTHERMIA_DANTROLENE_DOSE_ACTION_TERMS = [
  "2.5 mg/kg",
  "2.5mg/kg",
  "large-bore iv",
  "repeat",
  "repeat dose",
  "repeated",
  "rapidly",
  "반복",
];

const MALIGNANT_HYPERTHERMIA_COOLING_ACTION_TERMS = [
  "active cooling",
  "cold saline",
  "cool",
  "cooling",
  "ice",
  "temperature",
  "냉각",
];

const MALIGNANT_HYPERTHERMIA_ESCALATION_ACTION_TERMS = [
  "call for help",
  "hotline",
  "icu",
  "intensive care",
  "mh cart",
  "mhaus",
  "urine output",
  "중환자",
];

const MALIGNANT_HYPERTHERMIA_HYPERKALEMIA_SAFETY_TERMS = [
  "calcium",
  "hyperkalemia",
  "potassium",
  "칼륨",
];

const MALIGNANT_HYPERTHERMIA_ACIDOSIS_SAFETY_TERMS = [
  "acidosis",
  "bicarbonate",
  "arrhythmia",
  "blood gas",
];

const MALIGNANT_HYPERTHERMIA_RHABDOMYOLYSIS_SAFETY_TERMS = [
  "ck",
  "creatine kinase",
  "myoglobin",
  "rhabdomyolysis",
  "횡문근",
];

const MALIGNANT_HYPERTHERMIA_CORE_MONITORING_SAFETY_TERMS = [
  "core temperature",
  "etco2",
  "end-tidal",
];

const MALIGNANT_HYPERTHERMIA_URINE_MONITORING_SAFETY_TERMS = [
  "myoglobin",
  "urine output",
  "urine-output",
  "소변",
];

const MALIGNANT_HYPERTHERMIA_DANTROLENE_REPEAT_SAFETY_TERMS = [
  "dantrolene",
  "dose",
  "recrudescence",
  "repeat dose",
  "단트롤렌",
];

const MALIGNANT_HYPERTHERMIA_DANTROLENE_INTERACTION_SAFETY_TERMS = [
  "calcium channel blocker",
  "interaction",
];

const MALIGNANT_HYPERTHERMIA_COOLING_ENDPOINT_SAFETY_TERMS = [
  "<38",
  "38 c",
  "38°c",
  "cooling endpoint",
  "stop cooling",
  "temperature below 38",
];

const MALIGNANT_HYPERTHERMIA_POSTCRISIS_OBSERVATION_SAFETY_TERMS = [
  "24 hours",
  "icu",
  "intensive care",
  "pacu",
  "post anesthesia care",
];

const MALIGNANT_HYPERTHERMIA_TRIGGER_PREVENTION_SAFETY_TERMS = [
  "family history",
  "genetic",
  "medical alert",
  "non-triggering anesthesia",
  "ryr1",
  "susceptible",
  "trigger-free",
  "유전",
];

const THYROID_STORM_CONTEXT_TERMS = [
  "thyroid crisis",
  "thyroid storm",
  "thyrotoxic crisis",
  "thyrotoxic storm",
  "갑상샘폭풍",
  "갑상선 폭풍",
  "갑상샘 위기",
];

const THYROID_STORM_BETA_BLOCKER_ACTION_TERMS = [
  "beta blocker",
  "beta-blocker",
  "esmolol",
  "propranolol",
  "베타차단",
];

const THYROID_STORM_THIONAMIDE_ACTION_TERMS = [
  "antithyroid",
  "methimazole",
  "propylthiouracil",
  "ptu",
  "thionamide",
  "항갑상샘",
  "항갑상선",
];

const THYROID_STORM_IODINE_ACTION_TERMS = [
  "iodide",
  "iodine",
  "lugol",
  "potassium iodide",
  "sski",
  "요오드",
];

const THYROID_STORM_STEROID_ACTION_TERMS = [
  "dexamethasone",
  "glucocorticoid",
  "hydrocortisone",
  "steroid",
  "스테로이드",
];

const THYROID_STORM_SUPPORTIVE_ACTION_TERMS = [
  "acetaminophen",
  "cooling",
  "cooling blanket",
  "iv fluid",
  "iv fluids",
  "oxygen",
  "supportive care",
  "냉각",
];

const THYROID_STORM_ICU_MONITORING_ACTION_TERMS = [
  "cardiac monitoring",
  "icu",
  "intensive care",
  "telemetry",
];

const THYROID_STORM_SEQUENCE_SAFETY_TERMS = [
  "after thionamide",
  "after methimazole",
  "after ptu",
  "before iodine",
  "iodine after",
  "iodide after",
  "one hour after",
  "thionamide before",
  "요오드 전",
];

const THYROID_STORM_ONE_HOUR_SEQUENCE_SAFETY_TERMS = ["1 hour", "one hour", "60 minutes"];

const THYROID_STORM_BETA_BLOCKER_SAFETY_TERMS = [
  "asthma",
  "bronchospasm",
  "decompensated heart failure",
  "heart failure",
  "hypotension",
  "shock",
  "천식",
  "심부전",
];

const THYROID_STORM_BETA_BLOCKER_ALTERNATIVE_SAFETY_TERMS = [
  "atenolol",
  "cardioselective",
  "diltiazem",
  "esmolol",
  "metoprolol",
];

const THYROID_STORM_THIONAMIDE_TOXICITY_SAFETY_TERMS = [
  "agranulocytosis",
  "cbc",
  "hepatotoxicity",
  "liver",
  "ptu",
  "transaminase",
  "간",
];

const THYROID_STORM_PREGNANCY_SAFETY_TERMS = [
  "pregnancy",
  "pregnant",
  "임신",
];

const THYROID_STORM_PRECIPITANT_SAFETY_TERMS = [
  "infection",
  "mi",
  "precipitant",
  "pulmonary embolism",
  "thyroidectomy",
  "trigger",
  "감염",
];

const THYROID_STORM_CARDIAC_MONITORING_SAFETY_TERMS = [
  "arrhythmia",
  "atrial fibrillation",
  "cardiac monitoring",
  "icu",
  "telemetry",
];

const THYROID_STORM_ASPIRIN_AVOIDANCE_SAFETY_TERMS = [
  "acetaminophen",
  "avoid aspirin",
  "avoid salicylate",
  "no aspirin",
  "salicylate",
];

const MYXEDEMA_COMA_DIRECT_CONTEXT_TERMS = [
  "hypothyroid crisis",
  "myxedema coma",
  "myxedema crisis",
  "myxoedema coma",
  "myxoedema crisis",
  "점액수종 혼수",
];

const MYXEDEMA_COMA_HYPOTHYROID_CONTEXT_TERMS = [
  "hypothyroidism",
  "hypothyroid",
  "levothyroxine nonadherence",
  "severe hypothyroidism",
  "갑상샘저하",
  "갑상선저하",
];

const MYXEDEMA_COMA_DECOMPENSATION_CONTEXT_TERMS = [
  "altered mental status",
  "bradycardia",
  "coma",
  "confusion",
  "hypothermia",
  "hypoventilation",
  "hyponatremia",
  "obtundation",
  "혼돈",
  "저체온",
];

const MYXEDEMA_COMA_ICU_ACTION_TERMS = [
  "icu",
  "intensive care",
  "중환자",
];

const MYXEDEMA_COMA_AIRWAY_VENTILATION_ACTION_TERMS = [
  "airway",
  "arterial blood gas",
  "hypercapnia",
  "mechanical ventilation",
  "oxygen",
  "respiratory support",
  "ventilation",
  "기도",
];

const MYXEDEMA_COMA_HEMODYNAMIC_ACTION_TERMS = [
  "fluid resuscitation",
  "hypotension",
  "shock",
  "vasopressor",
];

const MYXEDEMA_COMA_STEROID_ACTION_TERMS = [
  "cortisol",
  "glucocorticoid",
  "hydrocortisone",
  "steroid",
  "스테로이드",
];

const MYXEDEMA_COMA_THYROID_HORMONE_ACTION_TERMS = [
  "intravenous levothyroxine",
  "intravenous liothyronine",
  "intravenous t3",
  "intravenous t4",
  "iv levothyroxine",
  "iv liothyronine",
  "iv t3",
  "iv t4",
  "정맥 갑상샘호르몬",
  "정맥 갑상선호르몬",
];

const MYXEDEMA_COMA_THYROID_LAB_ACTION_TERMS = [
  "free t4",
  "thyroid function",
  "tsh",
];

const MYXEDEMA_COMA_INFECTION_WORKUP_ACTION_TERMS = [
  "antibiotic",
  "blood culture",
  "chest x-ray",
  "culture",
  "infection",
  "pneumonia",
  "sepsis",
  "urine culture",
  "감염",
];

const MYXEDEMA_COMA_CORTISOL_ACTION_TERMS = ["cortisol"];

const MYXEDEMA_COMA_STEROID_SEQUENCE_SAFETY_TERMS = [
  "adrenal crisis",
  "adrenal insufficiency",
  "before thyroid",
  "cortisol",
  "hydrocortisone",
  "prior to thyroid",
  "steroid",
  "부신",
];

const MYXEDEMA_COMA_REWARMING_SAFETY_TERMS = [
  "aggressive rewarming",
  "blanket",
  "hypothermia",
  "passive rewarming",
  "rewarming",
  "temperature",
  "warming",
  "저체온",
];

const MYXEDEMA_COMA_HYPONATREMIA_SAFETY_TERMS = [
  "hyponatremia",
  "sodium",
  "나트륨",
];

const MYXEDEMA_COMA_GLUCOSE_SAFETY_TERMS = [
  "glucose",
  "hypoglycemia",
  "혈당",
];

const MYXEDEMA_COMA_RESPIRATORY_SAFETY_TERMS = [
  "arterial blood gas",
  "hypercapnia",
  "hypoxemia",
  "oxygen",
  "ventilation",
];

const MYXEDEMA_COMA_CARDIAC_DOSING_SAFETY_TERMS = [
  "arrhythmia",
  "cardiac",
  "coronary",
  "elderly",
  "ischemia",
  "lower dose",
  "myocardial infarction",
  "telemetry",
  "심장",
];

const SEVERE_HYPOTHERMIA_CONTEXT_TERMS = [
  "accidental hypothermia",
  "avalanche burial",
  "cold exposure",
  "cold immersion",
  "core temperature 27",
  "core temperature 28",
  "exposure hypothermia",
  "severe hypothermia",
  "temperature 27",
  "temperature 28",
  "저체온증",
];

const SEVERE_HYPOTHERMIA_RISK_TERMS = [
  "asystole",
  "bradycardia",
  "cardiac arrest",
  "coma",
  "confusion",
  "hypotension",
  "osborn",
  "ventricular fibrillation",
  "vf",
];

const SEVERE_HYPOTHERMIA_CORE_TEMP_ACTION_TERMS = [
  "core temperature",
  "esophageal",
  "low-reading",
  "rectal",
];

const SEVERE_HYPOTHERMIA_GENTLE_ABC_ACTION_TERMS = [
  "airway",
  "gentle handling",
  "insulation",
  "oxygen",
  "remove wet clothing",
  "ventilation",
];

const SEVERE_HYPOTHERMIA_ACTIVE_REWARMING_ACTION_TERMS = [
  "active core rewarming",
  "active external rewarming",
  "active rewarming",
  "core rewarming",
  "forced air",
];

const SEVERE_HYPOTHERMIA_CORE_REWARMING_MODALITY_ACTION_TERMS = [
  "cardiopulmonary bypass",
  "ecmo",
  "ecls",
  "extracorporeal",
  "heated humidified oxygen",
  "heated oxygen",
  "heated lavage",
  "heated infusion",
  "warm iv fluid",
  "warmed iv fluid",
];

const SEVERE_HYPOTHERMIA_FLUID_PERFUSION_ACTION_TERMS = [
  "fluid resuscitation",
  "heated infusion",
  "hypovolemia",
  "perfusion",
  "warm iv fluid",
  "warmed iv fluid",
];

const SEVERE_HYPOTHERMIA_ECG_ACTION_TERMS = [
  "ecg",
  "ekg",
  "j wave",
  "osborn",
];

const SEVERE_HYPOTHERMIA_METABOLIC_LAB_ACTION_TERMS = [
  "abg",
  "arterial blood gas",
  "electrolyte",
  "glucose",
  "hypoglycemia",
  "potassium",
];

const SEVERE_HYPOTHERMIA_SECONDARY_CAUSE_ACTION_TERMS = [
  "cortisol",
  "free thyroxine",
  "hypothyroidism",
  "intoxication",
  "myxedema",
  "sepsis",
  "trauma",
  "toxin",
  "tsh",
];

const SEVERE_HYPOTHERMIA_ARREST_ESCALATION_ACTION_TERMS = [
  "cardiac arrest",
  "cpr",
  "defibrillation",
  "ecmo",
  "ecls",
  "extracorporeal",
  "va-ecmo",
];

const SEVERE_HYPOTHERMIA_AFTERDROP_SAFETY_TERMS = [
  "afterdrop",
  "extremities",
  "gentle handling",
  "rewarming collapse",
  "thorax",
];

const SEVERE_HYPOTHERMIA_ACLS_TEMP_SAFETY_TERMS = [
  "30 c",
  "30°c",
  "acls medications",
  "defer defibrillation",
  "epinephrine",
  "vasopressor",
];

const SEVERE_HYPOTHERMIA_PERFUSING_RHYTHM_SAFETY_TERMS = [
  "bradycardia expected",
  "cpr",
  "perfusing rhythm",
  "pulse check",
  "ultrasound",
];

const SEVERE_HYPOTHERMIA_ECMO_TERMINATION_SAFETY_TERMS = [
  "ecmo",
  "ecls",
  "extracorporeal",
  "hyperkalemia",
  "potassium > 12",
  "rewarm before termination",
];

const SEVERE_HYPOTHERMIA_SECONDARY_CAUSE_SAFETY_TERMS = [
  "hypoglycemia",
  "myxedema",
  "sepsis",
  "trauma",
  "toxin",
];

const DROWNING_CONTEXT_TERMS = [
  "drowning",
  "immersion injury",
  "near drowning",
  "submersion",
  "submersion injury",
  "water aspiration",
];

const DROWNING_RESPIRATORY_RISK_TERMS = [
  "aspiration",
  "hypoxemia",
  "hypoxia",
  "respiratory compromise",
  "respiratory impairment",
  "submerged",
];

const DROWNING_AIRWAY_BREATHING_ACTION_TERMS = [
  "airway",
  "bag-valve",
  "breathing",
  "intubation",
  "rescue breath",
  "ventilation",
];

const DROWNING_OXYGENATION_ACTION_TERMS = [
  "high-flow oxygen",
  "oxygen",
  "oxygenation",
  "spo2",
  "supplemental oxygen",
];

const DROWNING_CIRCULATION_RESUSCITATION_ACTION_TERMS = [
  "cardiac monitoring",
  "circulation",
  "cpr",
  "hypotension",
  "iv access",
  "pulse",
  "resuscitation",
];

const DROWNING_RESPIRATORY_MONITORING_ACTION_TERMS = [
  "pulse oximetry",
  "respiratory exam",
  "spo2",
];

const DROWNING_INDICATED_RESPIRATORY_WORKUP_ACTION_TERMS = [
  "abg",
  "chest x-ray",
  "lung exam",
  "persistent hypoxemia",
  "progressive respiratory",
];

const DROWNING_WET_CLOTHING_ACTION_TERMS = [
  "remove wet clothes",
  "remove wet clothing",
];

const DROWNING_REWARMING_ACTION_TERMS = [
  "core temperature",
  "normothermia",
  "warming",
];

const DROWNING_TRAUMA_CSPINE_ACTION_TERMS = [
  "c-spine",
  "cervical spine",
  "diving",
  "head trauma",
  "trauma",
];

const DROWNING_OBSERVATION_ACTION_TERMS = [
  "8 hours",
  "observation",
];

const DROWNING_ESCALATION_ACTION_TERMS = [
  "admission",
  "assisted ventilation",
  "icu",
  "ongoing hypoxia",
  "transfer",
];

const DROWNING_ANTIBIOTIC_STEROID_AVOIDANCE_SAFETY_TERMS = [
  "avoid",
  "avoid routine",
  "no prophylactic",
  "no routine",
  "not prophylactic",
  "not routine",
  "without prophylactic",
];

const DROWNING_ANTIBIOTIC_STEROID_TARGET_SAFETY_TERMS = [
  "antibiotic",
  "antibiotics",
  "corticosteroid",
  "corticosteroids",
  "steroid",
  "steroids",
];

const DROWNING_INFECTION_INDICATION_SAFETY_TERMS = [
  "clinical evidence of infection",
  "contamination",
  "gross contamination",
  "infection",
  "sepsis",
];

const DROWNING_OBSERVATION_DURATION_SAFETY_TERMS = [
  "8 hours",
  "4 to 8 hours",
  "observation",
];

const DROWNING_DISCHARGE_STABILITY_SAFETY_TERMS = [
  "asymptomatic",
  "discharge",
  "normal respiratory",
  "return precautions",
  "stable",
];

const DROWNING_DISCHARGE_OXYGEN_SAFETY_TERMS = [
  "95%",
  "spo2 >=95",
  "spo2 >=",
];

const DROWNING_OXYGEN_TARGET_SAFETY_TERMS = [
  "90%",
  "92%",
  "96%",
  "avoid hyperoxia",
  "high-flow oxygen",
  "hyperoxia",
];

const DROWNING_CSPINE_TARGETING_SAFETY_TERMS = [
  "cervical spine",
  "c-spine",
  "diving",
  "fall",
  "head trauma",
  "not delay airway",
  "only for trauma",
  "routine immobilization",
];

const DROWNING_DELAYED_RESPIRATORY_SAFETY_TERMS = [
  "ards",
  "delayed pulmonary edema",
  "increased respiratory effort",
  "pulmonary edema",
  "respiratory deterioration",
];

const DROWNING_UNDERLYING_CAUSE_SAFETY_TERMS = [
  "arrhythmia",
  "hypoglycemia",
  "intoxication",
  "long qt",
  "seizure",
];

const DROWNING_ASPIRATION_SAFETY_TERMS = [
  "aspiration",
  "lateral decubitus",
  "prevent aspiration",
  "recovery position",
  "vomiting",
];

const HEAT_STROKE_CONTEXT_TERMS = [
  "classic heat stroke",
  "exertional heat stroke",
  "heat stroke",
  "heatstroke",
  "hyperthermia with altered mental status",
  "열사병",
];

const HEAT_STROKE_CORE_TEMP_ACTION_TERMS = [
  "core temperature",
  "esophageal",
  "rectal",
  "rectal temperature",
  "temperature probe",
  "bladder",
  "심부체온",
  "직장체온",
];

const HEAT_STROKE_RAPID_COOLING_ACTION_TERMS = [
  "cool first",
  "aggressive cooling",
  "immediate cooling",
  "rapid cooling",
  "within 30 minutes",
];

const HEAT_STROKE_COOLING_MODALITY_ACTION_TERMS = [
  "cold water immersion",
  "cool water immersion",
  "evaporative cooling",
  "fan",
  "ice bath",
  "ice water immersion",
  "spray",
  "whole-body cooling",
  "냉각",
];

const HEAT_STROKE_AIRWAY_BREATHING_ACTION_TERMS = [
  "airway",
  "breathing",
  "intubation",
  "oxygen",
  "ventilation",
];

const HEAT_STROKE_CIRCULATION_ACTION_TERMS = [
  "blood pressure",
  "circulation",
  "hemodynamic",
  "hypotension",
  "resuscitation",
];

const HEAT_STROKE_IV_FLUID_ACTION_TERMS = [
  "isotonic saline",
  "iv fluid",
  "iv fluids",
  "normal saline",
  "saline",
  "수액",
];

const HEAT_STROKE_ESCALATION_ACTION_TERMS = [
  "critical care",
  "ems",
  "icu",
  "organ failure",
  "transfer",
  "중환자",
];

const HEAT_STROKE_OVERCOOLING_SAFETY_TERMS = [
  "38",
  "39",
  "cooling endpoint",
  "core temperature",
  "hypothermia",
  "rectal temperature",
  "stop cooling",
  "target temperature",
  "저체온",
];

const HEAT_STROKE_ORGAN_INJURY_SAFETY_TERMS = [
  "aki",
  "ck",
  "coagulation",
  "creatine kinase",
  "dic",
  "electrolyte",
  "liver",
  "renal",
  "rhabdomyolysis",
  "횡문근",
  "신장",
];

const HEAT_STROKE_ANTIPYRETIC_AVOIDANCE_SAFETY_TERMS = [
  "avoid",
  "not recommended",
  "not use",
  "not useful",
  "no role",
  "without antipyretic",
];

const HEAT_STROKE_ANTIPYRETIC_TARGET_SAFETY_TERMS = [
  "acetaminophen",
  "antipyretic",
  "dantrolene",
  "nsaid",
  "해열제",
];

const HEAT_STROKE_DIFFERENTIAL_SAFETY_TERMS = [
  "malignant hyperthermia",
  "meningitis",
  "neuroleptic malignant",
  "sepsis",
  "serotonin syndrome",
  "stimulant",
  "감염",
];

const SEROTONIN_SYNDROME_DIRECT_CONTEXT_TERMS = [
  "serotonin syndrome",
  "serotonin toxicity",
  "serotonergic syndrome",
  "serotonergic toxicity",
  "세로토닌 증후군",
];

const SEROTONIN_SYNDROME_EXPOSURE_CONTEXT_TERMS = [
  "dextromethorphan",
  "fentanyl",
  "linezolid",
  "maoi",
  "mdma",
  "meperidine",
  "serotonergic",
  "snri",
  "ssri",
  "tramadol",
  "triptan",
];

const SEROTONIN_SYNDROME_NEUROMUSCULAR_CONTEXT_TERMS = [
  "clonus",
  "hyperreflexia",
  "myoclonus",
  "ocular clonus",
  "rigidity",
  "tremor",
  "클로누스",
];

const SEROTONIN_SYNDROME_AUTONOMIC_MENTAL_CONTEXT_TERMS = [
  "agitation",
  "altered mental status",
  "diaphoresis",
  "diarrhea",
  "hyperthermia",
  "hypertension",
  "tachycardia",
  "혼돈",
];

const SEROTONIN_SYNDROME_STOP_AGENT_ACTION_TERMS = [
  "discontinue",
  "hold serotonergic",
  "remove offending",
  "stop serotonergic",
  "withdraw serotonergic",
  "중단",
];

const SEROTONIN_SYNDROME_OXYGEN_ACTION_TERMS = [
  "oxygen",
  "oxygen saturation",
  "spo2",
  "산소",
];

const SEROTONIN_SYNDROME_IV_FLUID_ACTION_TERMS = [
  "crystalloid",
  "iv fluid",
  "iv fluids",
  "volume depletion",
  "수액",
];

const SEROTONIN_SYNDROME_MONITORING_ACTION_TERMS = [
  "autonomic instability",
  "blood pressure",
  "cardiac monitoring",
  "supportive care",
  "vital signs",
];

const SEROTONIN_SYNDROME_BENZODIAZEPINE_ACTION_TERMS = [
  "benzodiazepine",
  "chemical sedation",
  "diazepam",
  "lorazepam",
  "midazolam",
  "sedation",
  "벤조",
];

const SEROTONIN_SYNDROME_COOLING_ACTION_TERMS = [
  "active cooling",
  "cooling",
  "external cooling",
  "hyperthermia",
  "temperature",
  "냉각",
];

const SEROTONIN_SYNDROME_CYPROHEPTADINE_ACTION_TERMS = [
  "cyproheptadine",
];

const SEROTONIN_SYNDROME_TOXICOLOGY_ACTION_TERMS = [
  "poison center",
  "toxicologist",
  "toxicology",
];

const SEROTONIN_SYNDROME_SEVERE_ESCALATION_ACTION_TERMS = [
  "icu",
  "intubation",
  "nondepolarizing",
  "paralysis",
  "중환자",
];

const SEROTONIN_SYNDROME_DIFFERENTIAL_SAFETY_TERMS = [
  "anticholinergic",
  "malignant hyperthermia",
  "neuroleptic malignant",
  "nms",
  "sepsis",
  "sympathomimetic",
  "감별",
];

const SEROTONIN_SYNDROME_HUNTER_DIAGNOSTIC_SAFETY_TERMS = [
  "hunter",
  "spontaneous clonus",
  "inducible clonus",
  "ocular clonus",
  "tremor and hyperreflexia",
  "hyperreflexia and clonus",
  "hypertonia and temperature",
  "neuromuscular excitation",
  "neuromuscular hyperactivity",
];

const SEROTONIN_SYNDROME_EXPOSURE_TIMING_SAFETY_TERMS = [
  "6 to 24",
  "dose change",
  "drug interaction",
  "medication-change",
  "medication change",
  "new serotonergic",
  "recent serotonergic",
  "serotonergic exposure",
  "serotonergic medication history",
  "within 24",
];

const SEROTONIN_SYNDROME_RESTRAINT_ANTIPYRETIC_AVOIDANCE_SAFETY_TERMS = [
  "avoid",
  "no physical restraint",
  "not use",
  "without restraint",
];

const SEROTONIN_SYNDROME_RESTRAINT_ANTIPYRETIC_TARGET_SAFETY_TERMS = [
  "acetaminophen",
  "antipyretic",
  "physical restraint",
  "restraint",
  "해열제",
];

const SEROTONIN_SYNDROME_SEVERE_HYPERTHERMIA_SAFETY_TERMS = [
  "41",
  "intubation",
  "mechanical ventilation",
  "neuromuscular blockade",
  "nondepolarizing",
  "paralysis",
  "severe hyperthermia",
  "삽관",
];

const SEROTONIN_SYNDROME_COMPLICATION_MONITORING_SAFETY_TERMS = [
  "aki",
  "ck",
  "creatine kinase",
  "electrolyte",
  "renal",
  "rhabdomyolysis",
  "seizure",
  "횡문근",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_DIRECT_CONTEXT_TERMS = [
  "nms",
  "neuroleptic malignant syndrome",
  "neuroleptic malignant",
  "malignant neuroleptic syndrome",
  "신경이완제 악성 증후군",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_EXPOSURE_CONTEXT_TERMS = [
  "antipsychotic",
  "dopamine antagonist",
  "dopamine withdrawal",
  "haloperidol",
  "metoclopramide",
  "neuroleptic",
  "olanzapine",
  "risperidone",
  "withdrawal of dopaminergic",
  "항정신병",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_RIGIDITY_CONTEXT_TERMS = [
  "lead pipe",
  "muscle rigidity",
  "rigidity",
  "severe rigidity",
  "stiffness",
  "강직",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_AUTONOMIC_MENTAL_CONTEXT_TERMS = [
  "altered mental status",
  "autonomic instability",
  "diaphoresis",
  "fever",
  "hyperthermia",
  "labile blood pressure",
  "tachycardia",
  "혼돈",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_STOP_AGENT_ACTION_TERMS = [
  "discontinue antipsychotic",
  "discontinue dopamine antagonist",
  "hold antipsychotic",
  "hold neuroleptic",
  "remove offending",
  "stop antipsychotic",
  "stop dopamine antagonist",
  "stop neuroleptic",
  "중단",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_ICU_ACTION_TERMS = [
  "icu",
  "intensive care",
  "중환자",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_MONITORING_ACTION_TERMS = [
  "cardiac monitoring",
  "close monitoring",
  "vital signs",
  "telemetry",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_IV_FLUID_ACTION_TERMS = [
  "iv fluid",
  "iv fluids",
  "volume deficit",
  "hydration",
  "수액",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_ELECTROLYTE_ACTION_TERMS = [
  "electrolyte",
  "hyperkalemia",
  "metabolic acidosis",
  "acidosis",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_CARDIORESPIRATORY_ACTION_TERMS = [
  "cardiac dysrhythmia",
  "cardiac monitoring",
  "mechanical ventilation",
  "respiratory failure",
  "ventilatory support",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_SUPPORTIVE_ACTION_TERMS = [
  "supportive care",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_COOLING_ACTION_TERMS = [
  "active cooling",
  "aggressive cooling",
  "cooling",
  "hyperthermia",
  "temperature",
  "냉각",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_MEDICATION_ACTION_TERMS = [
  "amantadine",
  "bromocriptine",
  "dantrolene",
  "dopamine agonist",
  "단트롤렌",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_CK_RHABDO_ACTION_TERMS = [
  "ck",
  "creatine kinase",
  "rhabdomyolysis",
  "횡문근",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_RENAL_MYOGLOBIN_ACTION_TERMS = [
  "aki",
  "myoglobin",
  "myoglobinuria",
  "renal",
  "rhabdomyolysis",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_DIFFERENTIAL_SAFETY_TERMS = [
  "cns infection",
  "heat stroke",
  "malignant hyperthermia",
  "meningitis",
  "serotonin syndrome",
  "sympathomimetic",
  "감별",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_EXPOSURE_DIFFERENTIATION_SAFETY_TERMS = [
  "antipsychotic exposure",
  "dopamine agonist withdrawal",
  "dopamine-antagonist exposure",
  "dopamine antagonist exposure",
  "dopaminergic withdrawal",
  "dose increase",
  "neuroleptic exposure",
  "parenteral",
  "rapid dose",
  "within 72",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_RIGIDITY_REFLEX_SAFETY_TERMS = [
  "decreased-reflex",
  "decreased reflex",
  "hyporeflexia",
  "lead pipe",
  "not clonus",
  "over days",
  "rather than clonus",
  "reduced reflex",
  "slower onset",
  "versus clonus",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_RESTART_SAFETY_TERMS = [
  "avoid rechallenge",
  "lower potency",
  "restart",
  "rechallenge",
  "reintroduce",
  "wait",
  "재시작",
];

const NEUROLEPTIC_MALIGNANT_SYNDROME_MEDICATION_SAFETY_TERMS = [
  "amantadine",
  "bromocriptine",
  "dantrolene",
  "ect",
  "electroconvulsive",
  "liver",
  "psychosis",
  "단트롤렌",
];

const CAUDA_EQUINA_CONTEXT_TERMS = [
  "back pain with urinary retention",
  "bladder dysfunction with sciatica",
  "bowel bladder dysfunction",
  "cauda equina",
  "cauda equina compression",
  "cauda equina syndrome",
  "saddle anesthesia",
  "saddle anaesthesia",
  "마미증후군",
  "마미 증후군",
];

const CAUDA_EQUINA_MRI_MODALITY_TERMS = [
  "magnetic resonance",
  "magnetic resonance imaging",
  "mri",
  "자기공명",
];

const CAUDA_EQUINA_MRI_URGENCY_TERMS = [
  "emergency",
  "immediate",
  "immediately",
  "stat",
  "urgent",
  "urgently",
  "긴급",
  "응급",
  "즉시",
];

const CAUDA_EQUINA_MRI_REGION_TERMS = [
  "cauda equina",
  "lumbar",
  "lumbosacral",
  "spinal",
  "spine",
  "마미",
  "요추",
  "척추",
];

const CAUDA_EQUINA_BLADDER_DYSFUNCTION_ACTION_TERMS = [
  "bladder dysfunction",
  "bowel/bladder",
  "bowel bladder",
  "incontinence",
  "urinary retention",
  "voiding",
  "배뇨",
  "요정체",
];

const CAUDA_EQUINA_PVR_ACTION_TERMS = [
  "bladder scan",
  "palpable bladder",
  "post-void residual",
  "postvoid residual",
  "pvr",
];

const CAUDA_EQUINA_SADDLE_SENSORY_ACTION_TERMS = [
  "perianal",
  "perineal",
  "perineum",
  "s2",
  "s3",
  "s4",
  "s5",
  "saddle anesthesia",
  "saddle anaesthesia",
  "회음부",
];

const CAUDA_EQUINA_ANAL_TONE_REFLEX_ACTION_TERMS = [
  "anal reflex",
  "anal tone",
  "bulbocavernosus",
  "rectal tone",
  "항문긴장도",
];

const CAUDA_EQUINA_LOWER_LIMB_NEURO_ACTION_TERMS = [
  "areflexia",
  "leg weakness",
  "lower extremity weakness",
  "lower limb weakness",
  "motor deficit",
  "reflex",
  "sensation",
  "sensory deficit",
  "strength",
  "하지",
];

const CAUDA_EQUINA_SPINE_CONSULT_ACTION_TERMS = [
  "neurosurgery",
  "orthopaedic spine",
  "orthopedic spine",
  "spinal surgeon",
  "spine consult",
  "spine surgeon",
  "spine surgery",
  "신경외과",
  "척추",
];

const CAUDA_EQUINA_DECOMPRESSION_ACTION_TERMS = [
  "decompression",
  "discectomy",
  "laminectomy",
  "surgical decompression",
  "감압",
];

const CAUDA_EQUINA_RED_FLAG_SAFETY_TERMS = [
  "bowel",
  "bladder",
  "progressive neurologic",
  "saddle anesthesia",
  "saddle anaesthesia",
  "sexual dysfunction",
  "urinary retention",
  "배변",
  "배뇨",
  "회음부",
];

const CAUDA_EQUINA_DELAY_SAFETY_TERMS = [
  "do not delay",
  "emergency pathway",
  "not discharge",
  "not outpatient",
  "not physical therapy",
  "urgent referral",
  "urgent transfer",
  "지연",
  "응급",
];

const CAUDA_EQUINA_COMPRESSIVE_CAUSE_SAFETY_TERMS = [
  "cancer",
  "epidural abscess",
  "infection",
  "malignancy",
  "spinal stenosis",
  "trauma",
  "tumor",
  "감염",
  "암",
  "외상",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_CONTEXT_TERMS = [
  "malignant spinal cord compression",
  "metastatic cord compression",
  "metastatic spinal cord compression",
  "mscc",
  "spinal metastases with cord compression",
  "spinal metastasis with cord compression",
  "spine metastases with neurologic deficit",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_CANCER_TERMS = [
  "breast cancer",
  "cancer",
  "known malignancy",
  "lung cancer",
  "malignancy",
  "metastatic cancer",
  "metastatic disease",
  "multiple myeloma",
  "myeloma",
  "prostate cancer",
  "spinal metastases",
  "spinal metastasis",
  "tumor",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_NEURO_RISK_TERMS = [
  "bladder dysfunction",
  "bowel dysfunction",
  "difficulty walking",
  "gait disturbance",
  "limb weakness",
  "numbness",
  "paraesthesia",
  "paresthesia",
  "radicular pain",
  "sensory loss",
  "weakness",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_CONTACT_ACTION_TERMS = [
  "call",
  "contact",
  "consult",
  "discuss",
  "liaise",
  "notify",
  "refer",
  "transfer",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_COORDINATOR_ROLE_TERMS = [
  "acute oncology",
  "mscc coordinator",
  "mscc service",
  "on-call oncology",
  "oncology registrar",
  "spinal surgeon",
  "spine surgeon",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_MRI_MODALITY_TERMS = [
  "magnetic resonance",
  "magnetic resonance imaging",
  "mri",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_MRI_URGENCY_TERMS = [
  "24 hours",
  "as soon as possible",
  "immediate",
  "immediately",
  "urgent",
  "urgently",
  "within 24",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_MRI_REGION_TERMS = [
  "spinal",
  "spine",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_MRI_WHOLE_SPINE_TERMS = [
  "entire spine",
  "spinal axis",
  "whole spine",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_SPECIFIC_TERMS = [
  "dexamethasone",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_DOSE_TERMS = [
  "16 mg",
  "16mg",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_CLASS_TERMS = [
  "equivalent parenteral",
  "equivalent steroid",
  "dexamethasone",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_IMMOBILIZATION_ACTION_TERMS = [
  "brace",
  "bracing",
  "external spinal support",
  "immobilisation",
  "immobilization",
  "orthosis",
  "spinal precautions",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STABILITY_ASSESSMENT_ACTION_TERMS = [
  "sins",
  "spinal instability",
  "spinal instability neoplastic score",
  "spinal stability",
  "spine stability",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_MDT_PLAN_ACTION_TERMS = [
  "appropriate specialists",
  "mscc mdt",
  "mscc multidisciplinary",
  "mscc review",
  "mscc service",
  "multidisciplinary",
  "oncologist",
  "spinal surgeon",
  "spine surgeon",
  "treatment plan",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_DEFINITIVE_ACTION_TERMS = [
  "decompression",
  "radiotherapy within 24",
  "spinal surgery",
  "surgical decompression",
  "surgical stabilisation",
  "surgical stabilization",
  "urgent radiotherapy",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_NEURO_MONITORING_SAFETY_TERMS = [
  "neurologic monitoring",
  "neurological monitoring",
  "serial neurologic",
  "serial neurological",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_BLADDER_BOWEL_MONITORING_SAFETY_TERMS = [
  "bladder",
  "bowel",
  "worsening weakness",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_GLUCOSE_SAFETY_TERMS = [
  "blood glucose",
  "glucose",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_GI_SAFETY_TERMS = [
  "ppi",
  "proton pump inhibitor",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_TAPER_STOP_SAFETY_TERMS = [
  "dexamethasone taper",
  "discontinue dexamethasone",
  "steroid taper",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_CT_IF_MRI_CONTRAINDICATED_TERMS = [
  "ct if mri contraindicated",
  "ct when mri contraindicated",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_PLAIN_XRAY_AVOIDANCE_TERMS = [
  "do not use x-ray",
  "no plain x-ray",
  "not plain x-ray",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_STABILITY_SAFETY_TERMS = [
  "sins",
  "spinal instability neoplastic score",
  "spinal stability",
];

const METASTATIC_SPINAL_CORD_COMPRESSION_TREATMENT_REVIEW_SAFETY_TERMS = [
  "prognosis",
  "radiotherapy within 24 hours",
  "surgical suitability",
  "tokuhashi",
];

const OPEN_FRACTURE_CONTEXT_TERMS = [
  "compound fracture",
  "gustilo",
  "open fracture",
  "open long bone fracture",
  "open tibia fracture",
  "open tibial fracture",
];

const OPEN_FRACTURE_RISK_TERMS = [
  "bone protruding",
  "contaminated",
  "crush",
  "devascularized limb",
  "dirt",
  "exposed bone",
  "farm injury",
  "fracture wound",
  "high-energy",
  "soil",
  "vascular injury",
];

const OPEN_FRACTURE_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "cefazolin",
  "cefuroxime",
  "cephalosporin",
  "gentamicin",
  "iv antibiotics",
  "piperacillin-tazobactam",
  "prophylactic intravenous antibiotics",
];

const OPEN_FRACTURE_DRESSING_ACTION_TERMS = [
  "cover wound",
  "do not irrigate",
  "occlusive dressing",
  "saline-soaked dressing",
  "sterile dressing",
  "wet dressing",
];

const OPEN_FRACTURE_NEUROVASCULAR_ACTION_TERMS = [
  "circulation",
  "motor",
  "neurovascular",
  "pulse",
  "sensation",
  "sensory",
  "vascular injury",
];

const OPEN_FRACTURE_ORTHOPLASTIC_ACTION_TERMS = [
  "debridement",
  "fixation",
  "orthopedic",
  "orthopaedic",
  "orthoplastic",
  "plastic surgery",
  "soft tissue cover",
  "wound excision",
];

const OPEN_FRACTURE_TETANUS_SAFETY_TERMS = [
  "tdap",
  "tetanus",
  "tetanus immune globulin",
  "tig",
  "vaccination",
  "vaccine",
];

const OPEN_FRACTURE_ED_IRRIGATION_SAFETY_TERMS = [
  "do not irrigate",
  "no ed irrigation",
  "saline-soaked dressing",
  "avoid irrigation",
  "before wound excision",
];

const OPEN_FRACTURE_TIMING_TRANSFER_SAFETY_TERMS = [
  "12 hours",
  "24 hours",
  "72 hours",
  "highly contaminated",
  "immediate wound excision",
  "major trauma centre",
  "orthoplastic centre",
  "soft tissue cover",
  "transfer",
  "wound excision",
];

const OPEN_FRACTURE_VASCULAR_COMPARTMENT_SAFETY_TERMS = [
  "compartment syndrome",
  "continued blood loss",
  "devascularized",
  "expanding hematoma",
  "expanding haematoma",
  "hard signs",
  "neurovascular",
  "serial assessment",
  "vascular injury",
];

const ACUTE_COMPARTMENT_SYNDROME_CONTEXT_TERMS = [
  "acute compartment syndrome",
  "compartment syndrome",
  "구획증후군",
  "급성 구획증후군",
];

const ACUTE_COMPARTMENT_SYNDROME_RISK_CONTEXT_TERMS = [
  "burn",
  "cast",
  "crush",
  "fracture",
  "high-energy injury",
  "limb injury",
  "reperfusion",
  "splint",
  "tight dressing",
  "tibial fracture",
  "vascular injury",
  "골절",
  "압궤",
  "화상",
];

const ACUTE_COMPARTMENT_SYNDROME_SYMPTOM_CONTEXT_TERMS = [
  "firm compartment",
  "pain on passive stretch",
  "pain out of proportion",
  "passive stretch",
  "severe limb pain",
  "tense compartment",
  "worsening pain",
  "수동 신전",
  "심한 통증",
];

const ACUTE_COMPARTMENT_SYNDROME_EXAM_ACTION_TERMS = [
  "capillary refill",
  "neurovascular",
  "pain on passive stretch",
  "pain out of proportion",
  "passive stretch",
  "pulse",
  "serial exam",
  "tense compartment",
  "신경혈관",
  "수동 신전",
];

const ACUTE_COMPARTMENT_SYNDROME_PRESSURE_ACTION_TERMS = [
  "compartment pressure",
  "delta pressure",
  "diastolic",
  "intracompartmental pressure",
  "pressure measurement",
  "pressure monitoring",
  "압력",
];

const ACUTE_COMPARTMENT_SYNDROME_SURGICAL_TEAM_ACTION_TERMS = [
  "orthopedic",
  "orthopaedic",
  "orthopedics",
  "orthopaedics",
  "surgeon",
  "surgery",
  "surgery consult",
  "surgical consult",
  "trauma surgery",
  "정형외과",
];

const ACUTE_COMPARTMENT_SYNDROME_DECOMPRESSION_ACTION_TERMS = [
  "compartment release",
  "complete decompression",
  "fasciotomy",
  "operative decompression",
  "surgical decompression",
  "urgent decompression",
  "근막절개",
];

const ACUTE_COMPARTMENT_SYNDROME_TEMPORIZE_ACTION_TERMS = [
  "blood pressure",
  "bivalve",
  "cast removal",
  "dressing release",
  "heart level",
  "hypotension",
  "remove cast",
  "remove dressing",
  "splint removal",
  "압박 해제",
  "혈압",
];

const ACUTE_COMPARTMENT_SYNDROME_DELAY_SAFETY_TERMS = [
  "do not delay",
  "emergent",
  "immediate",
  "within 1 hour",
  "urgent",
  "지연",
  "응급",
];

const ACUTE_COMPARTMENT_SYNDROME_MASKING_SAFETY_TERMS = [
  "analgesia",
  "consciousness",
  "regional anesthesia",
  "sedation",
  "serial reassessment",
  "unable to assess",
  "무통",
  "진정",
];

const ACUTE_COMPARTMENT_SYNDROME_COMPLICATION_SAFETY_TERMS = [
  "acute kidney injury",
  "aki",
  "hyperkalemia",
  "ischemia",
  "limb loss",
  "muscle necrosis",
  "nerve injury",
  "renal failure",
  "rhabdomyolysis",
  "괴사",
  "신부전",
];

const ACUTE_COMPARTMENT_SYNDROME_CAUSE_SAFETY_TERMS = [
  "burn",
  "cast",
  "crush",
  "fracture",
  "reperfusion",
  "tight dressing",
  "vascular injury",
  "골절",
  "압궤",
  "화상",
];

const ACUTE_LIMB_ISCHEMIA_CONTEXT_TERMS = [
  "6 ps",
  "acute arterial occlusion",
  "acute limb ischemia",
  "acute limb ischaemia",
  "cold pulseless limb",
  "limb ischemia",
  "limb ischaemia",
  "pain pallor pulselessness",
  "pulseless cold limb",
  "six ps",
  "threatened limb",
  "급성 사지 허혈",
  "사지 허혈",
];

const ACUTE_LIMB_ISCHEMIA_VIABILITY_ACTION_TERMS = [
  "6 ps",
  "capillary refill",
  "doppler",
  "limb viability",
  "motor deficit",
  "pulse",
  "rutherford",
  "sensory deficit",
  "six ps",
  "도플러",
  "맥박",
];

const ACUTE_LIMB_ISCHEMIA_HEPARIN_ACTION_TERMS = [
  "anticoagulation",
  "heparin",
  "heparin infusion",
  "iv heparin",
  "unfractionated heparin",
  "항응고",
  "헤파린",
];

const ACUTE_LIMB_ISCHEMIA_REVASCULARIZATION_ACTION_TERMS = [
  "bypass",
  "catheter-directed thrombolysis",
  "embolectomy",
  "endovascular",
  "revascularization",
  "revascularisation",
  "thrombectomy",
  "재관류",
];

const ACUTE_LIMB_ISCHEMIA_BLEEDING_SAFETY_TERMS = [
  "active bleeding",
  "anticoagulation",
  "bleeding",
  "contraindication",
  "heparin",
  "intracranial hemorrhage",
  "platelet",
  "recent surgery",
  "thrombolysis",
  "출혈",
  "혈소판",
];

const ACUTE_LIMB_ISCHEMIA_IRREVERSIBLE_COMPARTMENT_SAFETY_TERMS = [
  "compartment syndrome",
  "fasciotomy",
  "irreversible",
  "muscle necrosis",
  "nonviable",
  "paralysis",
  "reperfusion injury",
  "rutherford iii",
  "구획증후군",
];

const ACUTE_LIMB_ISCHEMIA_SOURCE_DIFFERENTIAL_SAFETY_TERMS = [
  "aneurysm",
  "atrial fibrillation",
  "cardiac embol",
  "embol",
  "popliteal aneurysm",
  "thrombosis",
  "trauma",
  "vascular access",
  "심방세동",
  "색전",
  "혈전",
];

const TESTICULAR_TORSION_CONTEXT_TERMS = [
  "acute scrotal pain",
  "acute testicular pain",
  "high-riding testis",
  "painful testicle",
  "scrotal pain",
  "testicular torsion",
  "torsion of the testis",
  "twisted spermatic cord",
  "고환염전",
  "고환 염전",
  "급성 음낭통",
];

const TESTICULAR_TORSION_ASSESSMENT_ACTION_TERMS = [
  "absent cremasteric",
  "cremasteric reflex",
  "doppler",
  "high clinical suspicion",
  "high-riding",
  "horizontal lie",
  "nausea",
  "scrotal ultrasound",
  "ultrasound",
  "초음파",
];

const TESTICULAR_TORSION_UROLOGY_SURGERY_ACTION_TERMS = [
  "bilateral orchiopexy",
  "contralateral fixation",
  "emergent scrotal exploration",
  "emergent surgical exploration",
  "orchiopexy",
  "operative exploration",
  "scrotal exploration",
  "surgical exploration",
  "testicular fixation",
  "urgent scrotal exploration",
  "urgent surgical exploration",
  "고환 고정",
  "고환고정술",
  "수술적 탐색",
  "음낭 탐색",
];

const TESTICULAR_TORSION_DELAY_ACTION_TERMS = [
  "do not delay",
  "immediate",
  "not delay",
  "not postpone",
  "time critical",
  "urgent",
  "지연",
  "즉시",
];

const TESTICULAR_TORSION_SALVAGE_SAFETY_TERMS = [
  "4 hour",
  "6 hour",
  "8 hour",
  "ischemia",
  "orchiectomy",
  "salvage",
  "time from onset",
  "viability",
  "허혈",
];

const TESTICULAR_TORSION_MANUAL_DETORSION_SAFETY_TERMS = [
  "manual detorsion",
  "not definitive",
  "not delay",
  "orchiopexy",
  "surgery still required",
  "untwist",
  "수기 정복",
];

const TESTICULAR_TORSION_BILATERAL_FIXATION_SAFETY_TERMS = [
  "bilateral",
  "contralateral",
  "fertility",
  "orchiectomy",
  "orchiopexy",
  "testicular loss",
  "불임",
];

const TESTICULAR_TORSION_DIFFERENTIAL_SAFETY_TERMS = [
  "appendage torsion",
  "epididymitis",
  "hernia",
  "hydrocele",
  "orchitis",
  "trauma",
  "varicocele",
  "감별",
];

const OVARIAN_TORSION_CONTEXT_TERMS = [
  "adnexal torsion",
  "acute pelvic pain with adnexal mass",
  "intermittent unilateral pelvic pain",
  "ovarian torsion",
  "torsion of the ovary",
  "torsed ovary",
  "난소염전",
  "난소 염전",
];

const OVARIAN_TORSION_PREGNANCY_ACTION_TERMS = [
  "beta hcg",
  "beta-hcg",
  "hcg",
  "pregnancy test",
  "quantitative hcg",
  "β-hcg",
  "임신",
];

const OVARIAN_TORSION_ULTRASOUND_ACTION_TERMS = [
  "doppler",
  "pelvic ultrasound",
  "transvaginal ultrasound",
  "tvu",
  "tvus",
  "ultrasound",
  "초음파",
];

const OVARIAN_TORSION_SPECIALIST_ACTION_TERMS = [
  "gyn consult",
  "gynecologist",
  "gynecology",
  "ob/gyn",
  "obgyn",
  "urgent gyn",
  "urgent gynecology",
  "산부인과",
];

const OVARIAN_TORSION_DEFINITIVE_SURGERY_ACTION_TERMS = [
  "adnexal detorsion",
  "cystectomy",
  "diagnostic laparoscopy",
  "direct visualization",
  "detorsion",
  "laparoscopic detorsion",
  "laparoscopy",
  "oophoropexy",
  "ovarian detorsion",
  "ovarian salvage",
  "salpingo-oophorectomy",
  "surgical detorsion",
  "난소 보존",
  "난소 풀기",
  "난소염전 수술",
  "복강경",
];

const OVARIAN_TORSION_DOPPLER_DELAY_SAFETY_TERMS = [
  "do not delay",
  "doppler flow",
  "normal doppler",
  "not delay",
  "not rule out",
  "timely intervention",
  "지연",
];

const OVARIAN_TORSION_PRESERVATION_SAFETY_TERMS = [
  "cystectomy",
  "detorsion",
  "fertility",
  "oophorectomy",
  "ovarian function",
  "ovarian preservation",
  "preserve",
  "난소 보존",
];

const OVARIAN_TORSION_DIFFERENTIAL_SAFETY_TERMS = [
  "appendicitis",
  "ectopic",
  "hemorrhagic cyst",
  "ovarian cyst",
  "pid",
  "pregnancy",
  "ruptured cyst",
  "tubo-ovarian abscess",
  "감별",
];

const SPINAL_EPIDURAL_ABSCESS_CONTEXT_TERMS = [
  "discitis with epidural abscess",
  "epidural abscess",
  "infectious cord compression",
  "spinal abscess",
  "spinal epidural abscess",
  "spinal infection with neurologic deficit",
  "vertebral osteomyelitis with epidural extension",
  "척추 경막외 농양",
];

const SPINAL_EPIDURAL_ABSCESS_BACK_PAIN_RED_FLAG_TERMS = [
  "atraumatic back pain",
  "back pain",
  "radicular pain",
];

const SPINAL_EPIDURAL_ABSCESS_FEVER_TENDERNESS_RED_FLAG_TERMS = [
  "fever",
  "focal spine tenderness",
  "percussion tenderness",
  "spine tenderness",
];

const SPINAL_EPIDURAL_ABSCESS_NEURO_RED_FLAG_TERMS = [
  "bladder",
  "bowel",
  "neurologic deficit",
  "saddle anesthesia",
  "sensory",
  "weakness",
];

const SPINAL_EPIDURAL_ABSCESS_INFECTION_RISK_RED_FLAG_TERMS = [
  "bacteremia",
  "diabetes",
  "immunosuppression",
  "iv drug",
  "ivdu",
  "recent infection",
  "recent spinal procedure",
  "sepsis",
];

const SPINAL_EPIDURAL_ABSCESS_MRI_MODALITY_TERMS = [
  "magnetic resonance",
  "magnetic resonance imaging",
  "mri",
  "자기공명",
];

const SPINAL_EPIDURAL_ABSCESS_MRI_URGENCY_TERMS = [
  "emergency",
  "immediate",
  "immediately",
  "stat",
  "urgent",
  "urgently",
  "응급",
  "즉시",
];

const SPINAL_EPIDURAL_ABSCESS_MRI_REGION_TERMS = [
  "epidural abscess",
  "spinal",
  "spine",
  "whole spine",
  "척추",
];

const SPINAL_EPIDURAL_ABSCESS_MRI_CONTRAST_TERMS = [
  "contrast mri",
  "gadolinium",
];

const SPINAL_EPIDURAL_ABSCESS_BLOOD_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "two sets",
  "2 sets",
  "혈액배양",
];

const SPINAL_EPIDURAL_ABSCESS_INFLAMMATORY_MARKER_ACTION_TERMS = [
  "crp",
  "esr",
];

const SPINAL_EPIDURAL_ABSCESS_SOURCE_CULTURE_ACTION_TERMS = [
  "aspiration",
  "biopsy",
  "culture",
  "cultures",
  "intraoperative",
  "source culture",
  "배양",
];

const SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_BASE_TERMS = [
  "antibiotic",
  "antibiotics",
  "항생제",
];

const SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_SPECIFIC_TERMS = [
  "cefepime",
  "ceftriaxone",
  "ceftazidime",
  "meropenem",
  "piperacillin-tazobactam",
  "vancomycin",
];

const SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_URGENCY_TERMS = [
  "empiric",
  "empirical",
  "immediate",
  "immediately",
  "iv",
  "urgent",
  "urgently",
];

const SPINAL_EPIDURAL_ABSCESS_SURGERY_ACTION_TERMS = [
  "abscess drainage",
  "decompressive laminectomy",
  "drain epidural abscess",
  "drain the abscess",
  "epidural abscess drainage",
  "evacuate epidural abscess",
  "laminectomy",
  "operative decompression",
  "operative drainage",
  "surgical drainage",
  "surgical decompression",
  "surgical evacuation",
  "수술 배농",
  "수술적 감압",
];

const SPINAL_EPIDURAL_ABSCESS_SPINE_SURGERY_CONSULT_ACTION_TERMS = [
  "neurosurgery",
  "spine surgery",
  "spine surgeon",
  "surgical consult",
  "신경외과",
];

const SPINAL_EPIDURAL_ABSCESS_SERIAL_NEURO_SAFETY_TERMS = [
  "neurologic",
  "neurological",
  "serial exam",
  "serial neurologic",
  "serial neurological",
  "신경",
];

const SPINAL_EPIDURAL_ABSCESS_NEURO_DEFICIT_SAFETY_TERMS = [
  "bowel",
  "bladder",
  "paralysis",
  "weakness",
];

const SPINAL_EPIDURAL_ABSCESS_SEPSIS_SAFETY_TERMS = [
  "hemodynamic",
  "sepsis",
  "septic shock",
  "unstable",
  "패혈증",
];

const SPINAL_EPIDURAL_ABSCESS_BACTEREMIA_SOURCE_SAFETY_TERMS = [
  "bacteremia",
  "endocarditis",
  "source",
  "staphylococcus",
  "감염원",
];

const SPINAL_EPIDURAL_ABSCESS_HOST_PROCEDURE_RISK_SAFETY_TERMS = [
  "diabetes",
  "immunosuppression",
  "iv drug",
  "ivdu",
  "recent spinal procedure",
];

const SPINAL_EPIDURAL_ABSCESS_CULTURE_BEFORE_ANTIBIOTIC_SAFETY_TERMS = [
  "after blood cultures",
  "blood culture",
  "culture before",
  "배양",
];

const SPINAL_EPIDURAL_ABSCESS_BIOPSY_STABLE_SAFETY_TERMS = [
  "biopsy",
  "aspiration",
  "stable",
];

const SPINAL_EPIDURAL_ABSCESS_DO_NOT_DELAY_ANTIBIOTIC_SAFETY_TERMS = [
  "do not delay",
  "empiric antibiotics",
  "neurologic compromise",
  "unstable",
];

const SPINAL_EPIDURAL_ABSCESS_LP_AVOIDANCE_SAFETY_TERMS = [
  "avoid lumbar puncture",
  "avoid lp",
  "contraindicated",
  "cord herniation",
  "do not perform lp",
  "lumbar puncture",
  "lp",
];

const SPINAL_EPIDURAL_ABSCESS_DRAINAGE_DECOMPRESSION_SAFETY_TERMS = [
  "bowel",
  "bladder",
  "decompression",
  "drainage",
  "immediate drainage",
  "neurologic compromise",
  "neurosurgery",
  "paresis",
  "surgical drain",
  "weakness",
];

const SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_COVERAGE_SAFETY_TERMS = [
  "anaerobe",
  "cefepime",
  "ceftazidime",
  "ceftriaxone",
  "gram-negative",
  "meropenem",
  "mrsa",
  "staphylococcus",
  "vancomycin",
];

const SEPTIC_ARTHRITIS_CONTEXT_TERMS = [
  "acute septic arthritis",
  "bacterial arthritis",
  "hot swollen joint",
  "native joint septic arthritis",
  "septic arthritis",
  "septic joint",
  "septic monoarthritis",
  "화농성 관절염",
];

const SEPTIC_ARTHRITIS_ARTHROCENTESIS_PROCEDURE_TERMS = [
  "arthrocentesis",
  "joint aspiration",
  "synovial aspiration",
  "관절천자",
];

const SEPTIC_ARTHRITIS_ARTHROCENTESIS_GENERIC_PROCEDURE_TERMS = [
  "aspiration",
  "tap",
];

const SEPTIC_ARTHRITIS_ARTHROCENTESIS_TARGET_TERMS = [
  "joint",
  "synovial",
  "관절",
];

const SEPTIC_ARTHRITIS_ARTHROCENTESIS_URGENCY_TERMS = [
  "immediate",
  "immediately",
  "rapid",
  "urgent",
  "urgently",
  "즉시",
  "긴급",
];

const SEPTIC_ARTHRITIS_SYNOVIAL_STUDY_ACTION_TERMS = [
  "cell count",
  "crystal",
  "culture",
  "gram stain",
  "leukocyte",
  "microscopy",
  "synovial",
  "wbc",
  "배양",
];

const SEPTIC_ARTHRITIS_BLOOD_CULTURE_LAB_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "crp",
  "esr",
  "inflammatory marker",
  "leukocytosis",
  "배양",
  "혈액배양",
];

const SEPTIC_ARTHRITIS_ANTIBIOTIC_BASE_TERMS = [
  "antibiotic",
  "antibiotics",
  "항생제",
];

const SEPTIC_ARTHRITIS_ANTIBIOTIC_SPECIFIC_TERMS = [
  "cefazolin",
  "ceftriaxone",
  "ceftazidime",
  "cefepime",
  "clindamycin",
  "nafcillin",
  "vancomycin",
];

const SEPTIC_ARTHRITIS_ANTIBIOTIC_URGENCY_TERMS = [
  "empiric",
  "empirical",
  "immediate",
  "immediately",
  "iv",
  "urgent",
  "urgently",
];

const SEPTIC_ARTHRITIS_ORTHO_TEAM_ACTION_TERMS = [
  "orthopaedic",
  "orthopaedics",
  "orthopedic",
  "orthopedics",
  "ortho",
  "정형외과",
];

const SEPTIC_ARTHRITIS_JOINT_DRAINAGE_ACTION_TERMS = [
  "arthroscopic irrigation",
  "arthroscopic lavage",
  "arthroscopy",
  "arthrotomy",
  "irrigation and debridement",
  "joint drainage",
  "open revision",
  "repeat aspiration",
  "repeated aspiration",
  "serial aspiration",
  "surgical drainage",
  "surgical washout",
  "washout",
  "관절 세척",
  "관절 배액",
  "수술적 배액",
];

const SEPTIC_ARTHRITIS_CRYSTAL_LIMITATION_SAFETY_TERMS = [
  "crystal",
  "crystals do not exclude",
  "gout",
  "not exclude",
  "pseudogout",
  "still possible",
  "통풍",
];

const SEPTIC_ARTHRITIS_ANTIBIOTIC_TIMING_SAFETY_TERMS = [
  "after aspiration",
  "after blood cultures",
  "before antibiotics",
  "culture before",
  "do not delay",
  "empiric antibiotics",
  "sepsis",
  "unstable",
  "배양",
];

const SEPTIC_ARTHRITIS_PATHOGEN_RISK_SAFETY_TERMS = [
  "gonococcal",
  "gram-negative",
  "immunocompromised",
  "ivdu",
  "mrsa",
  "staphylococcus",
  "vancomycin",
  "임질",
];

const SEPTIC_ARTHRITIS_COMPLICATION_SOURCE_SAFETY_TERMS = [
  "bacteremia",
  "endocarditis",
  "osteomyelitis",
  "prosthetic joint",
  "sepsis",
  "source",
  "surgery",
  "패혈증",
];

const UPPER_GI_BLEED_CONTEXT_TERMS = [
  "coffee ground emesis",
  "esophageal variceal bleeding",
  "hematemesis",
  "melena",
  "nonvariceal upper gi bleeding",
  "peptic ulcer bleeding",
  "upper gastrointestinal bleeding",
  "upper gi bleed",
  "upper gi bleeding",
  "variceal bleeding",
  "토혈",
  "흑색변",
];

const UPPER_GI_BLEED_RESUSCITATION_INTERVENTION_TERMS = [
  "hemodynamic",
  "iv access",
  "large-bore",
  "massive transfusion",
  "resuscitation",
  "shock",
  "two large bore",
  "수액",
  "쇼크",
];

const UPPER_GI_BLEED_LAB_ACTION_TERMS = [
  "cbc",
  "hemoglobin",
  "inr",
];

const UPPER_GI_BLEED_BLOOD_PRODUCT_ACTION_TERMS = [
  "crossmatch",
  "packed red blood",
  "prbc",
  "restrictive transfusion",
  "transfusion",
  "type and screen",
  "수혈",
];

const UPPER_GI_BLEED_ENDOSCOPY_PROCEDURE_TERMS = [
  "endoscopy",
  "egd",
  "내시경",
];

const UPPER_GI_BLEED_ENDOSCOPY_URGENCY_TERMS = [
  "early",
  "urgent",
  "within 24 hours",
  "24 hours",
];

const UPPER_GI_BLEED_ENDOSCOPY_SOURCE_CONTROL_TERMS = [
  "endoscopic hemostasis",
  "gastroenterology",
  "gi consult",
];

const UPPER_GI_BLEED_ACID_SUPPRESSION_ACTION_TERMS = [
  "ppi",
  "proton pump",
];

const UPPER_GI_BLEED_VARICEAL_VASOACTIVE_ACTION_TERMS = [
  "octreotide",
  "somatostatin",
  "terlipressin",
  "vasoactive",
];

const UPPER_GI_BLEED_VARICEAL_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "ceftriaxone",
  "항생제",
];

const UPPER_GI_BLEED_AIRWAY_ASPIRATION_SAFETY_TERMS = [
  "airway",
  "altered mental status",
  "aspiration",
  "active hematemesis",
  "intubation",
  "vomiting blood",
  "기도",
];

const UPPER_GI_BLEED_ANTITHROMBOTIC_REVERSAL_SAFETY_TERMS = [
  "anticoagulant",
  "antiplatelet",
  "coagulopathy",
  "doac",
  "inr",
  "platelet",
  "reversal",
  "warfarin",
  "항응고",
];

const UPPER_GI_BLEED_VARICEAL_RESCUE_SAFETY_TERMS = [
  "balloon tamponade",
  "cirrhosis",
  "portal hypertension",
  "rescue",
  "stent",
  "tips",
  "variceal",
  "정맥류",
];

const UPPER_GI_BLEED_REBLEED_DISPOSITION_SAFETY_TERMS = [
  "icu",
  "rebleeding",
  "repeat endoscopy",
  "risk stratification",
  "shock",
  "unstable",
  "혈역학",
];

const UPPER_GI_BLEED_RISK_SCORING_SAFETY_TERMS = [
  "blatchford",
  "gbs",
  "glasgow-blatchford",
  "low risk",
  "risk score",
  "risk stratification",
  "rockall",
];

const UPPER_GI_BLEED_ENDOSCOPY_TIMING_SAFETY_TERMS = [
  "immediate endoscopy",
  "immediately after resuscitation",
  "resuscitation before endoscopy",
  "severe bleeding",
  "unstable",
  "within 24 hours",
];

const UPPER_GI_BLEED_COAGULATION_PRODUCT_SAFETY_TERMS = [
  "active bleeding",
  "clotting",
  "coagulation",
  "fresh frozen plasma",
  "ffp",
  "pcc",
  "platelet",
  "prothrombin complex concentrate",
  "warfarin",
];

const UPPER_GI_BLEED_PPI_TIMING_SAFETY_TERMS = [
  "acid suppression before endoscopy",
  "do not offer acid suppression",
  "non-variceal",
  "ppi after endoscopy",
  "proton pump inhibitor after endoscopy",
  "stigmata",
];

const UPPER_GI_BLEED_VARICEAL_DEFINITIVE_SAFETY_TERMS = [
  "antibiotic",
  "band ligation",
  "cyanoacrylate",
  "terlipressin",
  "tips",
  "transjugular intrahepatic portosystemic shunt",
  "variceal",
];

const ACUTE_CHOLECYSTITIS_CONTEXT_TERMS = [
  "acalculous cholecystitis",
  "acute cholecystitis",
  "emphysematous cholecystitis",
  "gangrenous cholecystitis",
  "perforated cholecystitis",
  "suppurative cholecystitis",
  "급성 담낭염",
];

const ACUTE_CHOLECYSTITIS_SEVERITY_ACTION_TERMS = [
  "asa",
  "cci",
  "charlson",
  "grade",
  "organ dysfunction",
  "severity",
  "tokyo",
  "중증도",
];

const ACUTE_CHOLECYSTITIS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "broad-spectrum",
  "ceftriaxone",
  "piperacillin",
  "항생제",
];

const ACUTE_CHOLECYSTITIS_CULTURE_ACTION_TERMS = [
  "bile culture",
  "blood culture",
  "culture",
  "배양",
];

const ACUTE_CHOLECYSTITIS_IMAGING_MODALITY_TERMS = [
  "ct",
  "hidascan",
  "ruq ultrasound",
  "ultrasound",
  "초음파",
];

const ACUTE_CHOLECYSTITIS_IMAGING_GALLBLADDER_TERMS = [
  "gallbladder",
  "gallbladder wall",
  "gallstone",
  "murphy",
  "pericholecystic",
  "right upper quadrant",
  "ruq",
  "sonographic",
];

const ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_SPECIFIC_TERMS = [
  "cholecystectomy",
  "cholecystostomy",
  "gallbladder drainage",
  "lap-c",
  "ptgbd",
  "담낭절제",
];

const ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_GENERIC_TERMS = [
  "drainage",
  "laparoscopic",
  "percutaneous",
];

const ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_TARGET_TERMS = [
  "cholecystitis",
  "gallbladder",
  "source control",
  "surgery",
];

const ACUTE_CHOLECYSTITIS_HIGH_RISK_DRAINAGE_SAFETY_TERMS = [
  "asa-ps",
  "charlson",
  "cholecystostomy",
  "drainage",
  "gallbladder drainage",
  "high risk",
  "percutaneous",
  "ptgbd",
];

const ACUTE_CHOLECYSTITIS_COMPLICATION_SAFETY_TERMS = [
  "emphysematous",
  "gangrenous",
  "perforation",
  "peritonitis",
  "sepsis",
  "shock",
  "심한",
];

const ACUTE_CHOLECYSTITIS_BILE_DUCT_SAFETY_TERMS = [
  "bile duct injury",
  "bile leak",
  "bail-out",
  "common bile duct",
  "critical view",
  "subtotal cholecystectomy",
  "conversion",
  "cvs",
];

const ACUTE_CHOLECYSTITIS_DIFFERENTIAL_SAFETY_TERMS = [
  "cholangitis",
  "choledocholithiasis",
  "gallstone pancreatitis",
  "hepatitis",
  "myocardial infarction",
  "pancreatitis",
  "peptic ulcer",
  "감별",
];

const ACUTE_CHOLANGITIS_CONTEXT_TERMS = [
  "acute cholangitis",
  "ascending cholangitis",
  "biliary sepsis",
  "choledocholithiasis with cholangitis",
  "infected biliary obstruction",
  "obstructive cholangitis",
  "suppurative cholangitis",
  "담관염",
];

const ACUTE_CHOLANGITIS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "broad-spectrum",
  "cefepime",
  "ceftriaxone",
  "piperacillin",
  "tazobactam",
  "항생제",
];

const ACUTE_CHOLANGITIS_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "bile culture",
  "배양",
];

const ACUTE_CHOLANGITIS_LAB_ACTION_TERMS = [
  "bilirubin",
  "crp",
  "inflammatory",
  "lft",
  "liver function",
  "wbc",
  "빌리루빈",
];

const ACUTE_CHOLANGITIS_IMAGING_MODALITY_TERMS = [
  "ct",
  "mrcp",
  "ultrasound",
  "초음파",
];

const ACUTE_CHOLANGITIS_OBSTRUCTION_TARGET_TERMS = [
  "biliary dilatation",
  "biliary dilation",
  "common bile duct",
  "obstruction",
  "stone",
  "stricture",
];

const ACUTE_CHOLANGITIS_BILIARY_ACCESS_ACTION_TERMS = [
  "advanced center",
  "endoscopic",
  "endoscopy",
  "ercp",
  "gastroenterology",
  "gi",
  "interventional radiology",
  "ivr",
  "percutaneous transhepatic",
  "ptbd",
  "transfer",
  "전원",
];

const ACUTE_CHOLANGITIS_DRAINAGE_ROUTE_SPECIFIC_TERMS = [
  "bile duct drainage",
  "bile duct stent",
  "biliary decompression",
  "biliary drainage",
  "biliary stent",
  "common bile duct drainage",
  "endoscopic biliary drainage",
  "endoscopic nasobiliary drainage",
  "nasobiliary",
  "percutaneous transhepatic biliary drainage",
  "percutaneous transhepatic",
  "ptbd",
  "담도 배액",
];

const ACUTE_CHOLANGITIS_DRAINAGE_ROUTE_GENERIC_TERMS = [
  "ercp",
];

const ACUTE_CHOLANGITIS_DRAINAGE_TARGET_TERMS = [
  "biliary",
  "decompression",
  "drainage",
  "stent",
];

const ACUTE_CHOLANGITIS_ORGAN_SUPPORT_ACTION_TERMS = [
  "circulatory",
  "fluid",
  "icu",
  "organ support",
  "respiratory",
  "sepsis",
  "shock",
  "vasopressor",
  "중환자",
  "쇼크",
];

const ACUTE_CHOLANGITIS_SEVERITY_SAFETY_TERMS = [
  "acute dyspnea",
  "dic",
  "disturbance of consciousness",
  "organ dysfunction",
  "renal dysfunction",
  "severity",
  "shock",
  "tokyo",
  "의식",
  "장기부전",
];

const ACUTE_CHOLANGITIS_DRAINAGE_TIMING_SAFETY_TERMS = [
  "48 hours",
  "advanced center",
  "do not delay",
  "early drainage",
  "emergency biliary drainage",
  "transfer",
  "within 24",
  "within 48",
  "지연",
];

const ACUTE_CHOLANGITIS_PROCEDURE_RISK_SAFETY_TERMS = [
  "altered anatomy",
  "anticoagulant",
  "coagulopathy",
  "failed ercp",
  "pancreatitis",
  "percutaneous drainage",
  "ptbd",
  "sphincterotomy",
  "항응고",
];

const ACUTE_CHOLANGITIS_DIFFERENTIAL_SOURCE_SAFETY_TERMS = [
  "acute cholecystitis",
  "bile culture",
  "cholecystitis",
  "gallstone pancreatitis",
  "malignant obstruction",
  "pancreatitis",
  "source control",
  "stone",
  "감별",
];

const ACUTE_PANCREATITIS_CONTEXT_TERMS = [
  "acute pancreatitis",
  "biliary pancreatitis",
  "gallstone pancreatitis",
  "necrotizing pancreatitis",
  "pancreatic necrosis",
  "severe pancreatitis",
  "췌장염",
];

const ACUTE_PANCREATITIS_FLUID_ACTION_TERMS = [
  "crystalloid",
  "fluid",
  "fluids",
  "goal-directed",
  "lactated ringer",
  "lr",
  "resuscitation",
  "수액",
];

const ACUTE_PANCREATITIS_ANALGESIA_SUPPORT_ACTION_TERMS = [
  "analgesia",
  "antiemetic",
  "nausea",
  "opioid",
  "pain control",
  "통증",
];

const ACUTE_PANCREATITIS_DIAGNOSTIC_ETIOLOGY_ACTION_TERMS = [
  "alt",
  "calcium",
  "gallstone",
  "lft",
  "lipase",
  "triglyceride",
  "ultrasound",
  "췌장효소",
];

const ACUTE_PANCREATITIS_SEVERITY_ORGAN_ACTION_TERMS = [
  "bun",
  "hematocrit",
  "icu",
  "organ failure",
  "oxygen",
  "renal",
  "severity",
  "shock",
  "장기부전",
];

const ACUTE_PANCREATITIS_ERCP_ACTION_TERMS = [
  "biliary drainage",
  "biliary decompression",
  "endoscopic retrograde",
  "ercp",
];

const ACUTE_PANCREATITIS_ERCP_INDICATION_TERMS = [
  "biliary obstruction",
  "cholangitis",
  "common bile duct obstruction",
  "jaundice",
  "담관염",
];

const ACUTE_PANCREATITIS_ERCP_NONROUTINE_TERMS = [
  "avoid routine",
  "no routine",
  "not indicated",
  "not routine",
  "only when",
  "without cholangitis",
];

const ACUTE_PANCREATITIS_ANTIBIOTIC_AVOIDANCE_TERMS = [
  "avoid prophylactic antibiotics",
  "no prophylactic antibiotics",
  "not use prophylactic antibiotics",
  "prophylactic antibiotics are not",
];

const ACUTE_PANCREATITIS_ANTIBIOTIC_INFECTION_TERMS = [
  "extrapancreatic infection",
  "infected necrosis",
  "infected pancreatic necrosis",
  "reserve antibiotics",
];

const ACUTE_PANCREATITIS_ENTERAL_NUTRITION_TERMS = [
  "enteral",
  "feeding as tolerated",
  "ng tube",
  "nasoenteric",
  "oral feeding",
];

const ACUTE_PANCREATITIS_PARENTERAL_LIMIT_TERMS = [
  "avoid parenteral",
  "avoid tpn",
  "enteral nutrition is not possible",
  "unless enteral",
];

const ACUTE_PANCREATITIS_NECROSIS_TARGET_TERMS = [
  "infected necrosis",
  "infected pancreatic necrosis",
  "walled-off necrosis",
];

const ACUTE_PANCREATITIS_NECROSIS_TIMING_TERMS = [
  "4 weeks",
  "delayed",
  "postpone",
  "walled-off",
];

const ACUTE_PANCREATITIS_NECROSIS_STEP_UP_TERMS = [
  "drainage",
  "percutaneous",
  "step-up",
  "step up",
];

const SMALL_BOWEL_OBSTRUCTION_CONTEXT_TERMS = [
  "adhesive small bowel obstruction",
  "bowel obstruction with vomiting",
  "closed-loop bowel obstruction",
  "closed-loop obstruction",
  "high-grade small bowel obstruction",
  "sbo",
  "small bowel obstruction",
  "strangulating obstruction",
  "장폐색",
];

const SMALL_BOWEL_OBSTRUCTION_NPO_NG_ACTION_TERMS = [
  "bowel rest",
  "decompression",
  "ng tube",
  "nil per os",
  "npo",
  "nasogastric",
  "suction",
  "금식",
];

const SMALL_BOWEL_OBSTRUCTION_FLUID_ELECTROLYTE_ACTION_TERMS = [
  "crystalloid",
  "dehydration",
  "electrolyte",
  "fluid",
  "fluids",
  "potassium",
  "urine output",
  "수액",
  "전해질",
];

const SMALL_BOWEL_OBSTRUCTION_CT_TRANSITION_ACTION_TERMS = [
  "closed-loop",
  "ct",
  "ct abdomen",
  "free fluid",
  "ischemia",
  "strangulation",
  "transition point",
  "복부 ct",
];

const SMALL_BOWEL_OBSTRUCTION_SURGERY_ACTION_TERMS = [
  "exploration",
  "laparotomy",
  "operative",
  "surgery",
  "surgical consult",
  "surgeon",
  "외과",
];

const SMALL_BOWEL_OBSTRUCTION_STRANGULATION_SAFETY_TERMS = [
  "acidosis",
  "closed-loop",
  "continuous pain",
  "fever",
  "ischemia",
  "lactate",
  "leukocytosis",
  "peritonitis",
  "strangulation",
  "복막염",
];

const SMALL_BOWEL_OBSTRUCTION_NONOPERATIVE_LIMITS_SAFETY_TERMS = [
  "72 hours",
  "complete obstruction",
  "conservative",
  "failure to resolve",
  "gastrografin",
  "nonoperative",
  "serial exam",
  "water-soluble contrast",
  "관찰",
];

const SMALL_BOWEL_OBSTRUCTION_PERFORATION_SEPSIS_SAFETY_TERMS = [
  "antibiotic",
  "broad-spectrum",
  "free air",
  "gangrene",
  "infarction",
  "perforation",
  "sepsis",
  "항생제",
];

const SMALL_BOWEL_OBSTRUCTION_ASPIRATION_ETIOLOGY_SAFETY_TERMS = [
  "adhesion",
  "aspiration",
  "hernia",
  "incarcerated hernia",
  "malignancy",
  "tumor",
  "volvulus",
  "vomiting",
  "흡인",
];

const PEDIATRIC_MIDGUT_VOLVULUS_CONTEXT_TERMS = [
  "intestinal malrotation",
  "ladd",
  "malrotation",
  "malrotation with volvulus",
  "midgut volvulus",
  "suspected malrotation",
];

const PEDIATRIC_MIDGUT_VOLVULUS_INFANT_TERMS = [
  "infant",
  "neonate",
  "neonatal",
  "newborn",
  "young infant",
];

const PEDIATRIC_MIDGUT_VOLVULUS_BILIOUS_RISK_TERMS = [
  "bilious emesis",
  "bilious vomiting",
  "bowel obstruction",
  "green emesis",
  "green vomiting",
  "intestinal obstruction",
];

const PEDIATRIC_MIDGUT_VOLVULUS_SEVERITY_TERMS = [
  "abdominal distension",
  "acidosis",
  "bloody stool",
  "bowel ischemia",
  "bowel necrosis",
  "dehydration",
  "lactate",
  "peritonitis",
  "shock",
];

const PEDIATRIC_MIDGUT_VOLVULUS_UGI_ACTION_TERMS = [
  "duodenal jejunal",
  "fluoroscopy",
  "ligament of treitz",
  "upper gi",
  "ugi",
];

const PEDIATRIC_MIDGUT_VOLVULUS_SURGERY_SPECIALIST_ACTION_TERMS = [
  "pediatric surgery",
  "pediatric surgeon",
  "surgery consult",
  "surgical consult",
  "surgeon",
  "소아외과",
];

const PEDIATRIC_MIDGUT_VOLVULUS_OPERATIVE_ACTION_TERMS = [
  "bowel detorsion",
  "bowel resection",
  "counterclockwise detorsion",
  "divide ladd",
  "exploratory laparotomy",
  "ladd",
  "ladd procedure",
  "ladd's",
  "laparotomy",
  "operative exploration",
  "surgical exploration",
  "volvulus detorsion",
  "장염전 정복",
  "장 회전 정복",
  "래드 술식",
  "복강경 탐색",
  "수술적 탐색",
];

const PEDIATRIC_MIDGUT_VOLVULUS_RESUSCITATION_ACTION_TERMS = [
  "decompression",
  "fluid",
  "fluids",
  "iv access",
  "nasogastric",
  "ng tube",
  "npo",
  "orogastric",
  "resuscitation",
];

const PEDIATRIC_MIDGUT_VOLVULUS_ISCHEMIA_ACTION_TERMS = [
  "abdominal exam",
  "acidosis",
  "bowel ischemia",
  "bowel necrosis",
  "lactate",
  "peritonitis",
  "shock",
  "serial exam",
];

const PEDIATRIC_MIDGUT_VOLVULUS_REFLUX_REASSURANCE_SAFETY_TERMS = [
  "do not reassure",
  "do not treat as reflux",
  "not benign reflux",
  "not gastroenteritis",
  "not reflux",
];

const PEDIATRIC_MIDGUT_VOLVULUS_NORMAL_XRAY_SAFETY_TERMS = [
  "does not exclude",
  "normal abdominal radiograph",
  "normal radiograph",
  "normal x-ray",
  "not exclude",
];

const PEDIATRIC_MIDGUT_VOLVULUS_IMAGING_LIMITATION_SAFETY_TERMS = [
  "contrast enema",
  "equivocal ugi",
  "false negative",
  "less direct",
  "smv/sma",
  "whirlpool",
];

const PEDIATRIC_MIDGUT_VOLVULUS_DELAY_SAFETY_TERMS = [
  "bowel ischemia",
  "bowel necrosis",
  "do not delay",
  "emergent surgery",
  "urgent surgery",
];

const PEDIATRIC_MIDGUT_VOLVULUS_METABOLIC_ASPIRATION_SAFETY_TERMS = [
  "aspiration",
  "dehydration",
  "electrolyte",
  "glucose",
  "hypoglycemia",
];

const NECROTIZING_ENTEROCOLITIS_CONTEXT_TERMS = [
  "nec",
  "necrotising enterocolitis",
  "necrotizing enterocolitis",
  "suspected nec",
];

const NECROTIZING_ENTEROCOLITIS_NEONATAL_CONTEXT_TERMS = [
  "extremely low birth weight",
  "infant",
  "low birth weight",
  "neonate",
  "neonatal",
  "newborn",
  "premature",
  "preterm",
  "very low birth weight",
];

const NECROTIZING_ENTEROCOLITIS_RISK_TERMS = [
  "abdominal discoloration",
  "abdominal distension",
  "abdominal distention",
  "bloody stool",
  "bilious emesis",
  "bilious gastric residual",
  "bilious vomiting",
  "feeding intolerance",
  "hematochezia",
  "ileus",
  "pneumatosis",
  "portal venous gas",
];

const NECROTIZING_ENTEROCOLITIS_FEEDING_STOP_ACTION_TERMS = [
  "bowel rest",
  "feedings stopped",
  "nil per os",
  "npo",
  "stop enteral feeds",
  "stop feeds",
  "withhold feeds",
];

const NECROTIZING_ENTEROCOLITIS_DECOMPRESSION_ACTION_TERMS = [
  "decompression",
  "gastric decompression",
  "nasogastric",
  "ng tube",
  "og tube",
  "orogastric",
  "suction",
];

const NECROTIZING_ENTEROCOLITIS_SUPPORT_ACTION_TERMS = [
  "crystalloid",
  "fluid",
  "fluids",
  "nicu",
  "parenteral nutrition",
  "pn",
  "resuscitation",
  "tpn",
];

const NECROTIZING_ENTEROCOLITIS_ANTIBIOTIC_ACTION_TERMS = [
  "ampicillin",
  "antibiotic",
  "broad-spectrum",
  "gentamicin",
  "metronidazole",
  "piperacillin",
  "tazobactam",
];

const NECROTIZING_ENTEROCOLITIS_MONITORING_ACTION_TERMS = [
  "abdominal radiograph",
  "abdominal x-ray",
  "blood culture",
  "cbc",
  "complete blood count",
  "platelet",
  "serial abdominal",
  "serial exam",
  "serial x-ray",
];

const NECROTIZING_ENTEROCOLITIS_SURGERY_SAFETY_TERMS = [
  "neonatal surgery",
  "pediatric surgery",
  "surgery consult",
  "surgical consult",
  "surgeon",
];

const NECROTIZING_ENTEROCOLITIS_PERFORATION_SAFETY_TERMS = [
  "free air",
  "intestinal perforation",
  "perforation",
  "peritonitis",
  "pneumoperitoneum",
  "portal venous gas",
];

const NECROTIZING_ENTEROCOLITIS_WORSENING_SAFETY_TERMS = [
  "acidosis",
  "blood gas",
  "clinical deterioration",
  "lactate",
  "shock",
  "thrombocytopenia",
  "worsening",
];

const NECROTIZING_ENTEROCOLITIS_ISOLATION_SAFETY_TERMS = [
  "cluster",
  "contact precautions",
  "infection control",
  "isolation",
  "outbreak",
];

const NECROTIZING_ENTEROCOLITIS_COMPLICATION_FOLLOWUP_SAFETY_TERMS = [
  "intestinal failure",
  "parenteral nutrition",
  "short bowel",
  "stricture",
  "trophic feeds",
];

const ACUTE_APPENDICITIS_CONTEXT_TERMS = [
  "acute appendicitis",
  "appendiceal abscess",
  "appendicitis",
  "perforated appendicitis",
  "right lower quadrant pain with anorexia",
  "rlq pain migrating",
  "충수염",
];

const ACUTE_APPENDICITIS_RISK_IMAGING_ACTION_TERMS = [
  "aas",
  "adult appendicitis score",
  "air score",
  "alvarado",
  "clinical score",
  "ct",
  "imaging",
  "mri",
  "risk score",
  "ultrasound",
  "초음파",
];

const ACUTE_APPENDICITIS_SURGERY_TEAM_ACTION_TERMS = [
  "acute care surgery",
  "general surgery",
  "surgeon",
  "surgery",
  "surgical consult",
  "외과",
];

const ACUTE_APPENDICITIS_APPENDICECTOMY_ACTION_TERMS = [
  "appendectomy",
  "appendiceal source control",
  "appendicectomy",
  "laparoscopic appendectomy",
  "laparoscopic appendicectomy",
  "laparoscopic surgery",
  "laparoscopy",
  "operative appendectomy",
  "충수절제",
  "충수절제술",
];

const ACUTE_APPENDICITIS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "broad-spectrum",
  "ceftriaxone",
  "cefoxitin",
  "metronidazole",
  "perioperative",
  "piperacillin",
  "preoperative",
  "항생제",
];

const ACUTE_APPENDICITIS_COMPLICATION_ACTION_TERMS = [
  "abscess",
  "complicated",
  "drainage",
  "perforation",
  "peritonitis",
  "phlegmon",
  "sepsis",
  "source control",
  "복막염",
];

const ACUTE_APPENDICITIS_NONOPERATIVE_SELECTION_SAFETY_TERMS = [
  "antibiotics-first",
  "appendicolith",
  "recurrence",
  "selected",
  "shared decision",
  "uncomplicated",
  "nonoperative",
  "비수술",
];

const ACUTE_APPENDICITIS_SOURCE_CONTROL_SAFETY_TERMS = [
  "2-3 days",
  "abscess drainage",
  "complicated",
  "drainage",
  "percutaneous",
  "postoperative antibiotic",
  "short course",
  "source control",
];

const ACUTE_APPENDICITIS_SPECIAL_POPULATION_DIFFERENTIAL_SAFETY_TERMS = [
  "ectopic",
  "gynecologic",
  "immunocompromised",
  "older",
  "pediatric",
  "pregnancy",
  "renal colic",
  "terminal ileitis",
  "임신",
];

const ACUTE_APPENDICITIS_PERITONITIS_SEPSIS_SAFETY_TERMS = [
  "diffuse peritonitis",
  "generalized peritonitis",
  "perforation",
  "peritonitis",
  "rupture",
  "sepsis",
  "shock",
  "복막염",
];

const ACUTE_MESENTERIC_ISCHEMIA_CONTEXT_TERMS = [
  "acute bowel ischemia",
  "acute intestinal ischemia",
  "acute mesenteric ischemia",
  "bowel infarction",
  "bowel ischemia",
  "intestinal ischemia",
  "mesenteric ischemia",
  "pain out of proportion",
  "sma embolus",
  "sma thrombosis",
  "장간막 허혈",
];

const ACUTE_MESENTERIC_ISCHEMIA_CTA_ACTION_TERMS = [
  "cta",
  "ct angiography",
  "ct mesenteric angiography",
  "mesenteric angiography",
  "multidetector ct",
  "복부 ct",
];

const ACUTE_MESENTERIC_ISCHEMIA_RESUSCITATION_ACTION_TERMS = [
  "fluid",
  "fluids",
  "lactate",
  "metabolic acidosis",
  "resuscitation",
  "shock",
  "수액",
  "젖산",
];

const ACUTE_MESENTERIC_ISCHEMIA_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "broad-spectrum",
  "empiric",
  "piperacillin",
  "tazobactam",
  "항생제",
];

const ACUTE_MESENTERIC_ISCHEMIA_ANTICOAGULATION_ACTION_TERMS = [
  "anticoagulation",
  "full-dose anticoagulation",
  "heparin",
  "therapeutic anticoagulation",
  "unfractionated heparin",
  "항응고",
];

const ACUTE_MESENTERIC_ISCHEMIA_SURGERY_TEAM_ACTION_TERMS = [
  "acute care surgery",
  "general surgery",
  "interventional radiology",
  "surgeon",
  "surgical consult",
  "vascular surgery",
  "vascular surgeon",
  "혈관외과",
];

const ACUTE_MESENTERIC_ISCHEMIA_REVASCULARIZATION_SOURCE_CONTROL_ACTION_TERMS = [
  "bowel resection",
  "damage control laparotomy",
  "embolectomy",
  "endovascular intervention",
  "endovascular revascularization",
  "endovascular therapy",
  "exploratory laparotomy",
  "ischemic bowel resection",
  "laparotomy",
  "mesenteric revascularization",
  "necrotic bowel resection",
  "revascularisation",
  "revascularization",
  "sma bypass",
  "sma stent",
  "sma thrombectomy",
  "thrombectomy",
  "thrombolysis",
  "장 절제",
  "재관류",
];

const ACUTE_MESENTERIC_ISCHEMIA_ANTICOAGULATION_SAFETY_TERMS = [
  "anticoagulation",
  "bleeding",
  "heparin",
  "intracranial hemorrhage",
  "platelet",
  "recent surgery",
  "출혈",
  "헤파린",
];

const ACUTE_MESENTERIC_ISCHEMIA_BOWEL_VIABILITY_SAFETY_TERMS = [
  "bowel viability",
  "damage control",
  "necrotic bowel",
  "peritonitis",
  "re-look",
  "second look",
  "short bowel",
  "viability",
  "복막염",
];

const ACUTE_MESENTERIC_ISCHEMIA_CAUSE_TYPE_SAFETY_TERMS = [
  "atrial fibrillation",
  "embol",
  "low-flow",
  "nomas",
  "nonocclusive",
  "sma",
  "thrombosis",
  "venous thrombosis",
  "심방세동",
  "혈전",
];

const ACUTE_MESENTERIC_ISCHEMIA_LACTATE_LIMITATION_SAFETY_TERMS = [
  "do not delay",
  "lactate",
  "normal lactate",
  "not exclude",
  "not rule out",
  "pain out of proportion",
  "젖산",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_CONTEXT_TERMS = [
  "fournier gangrene",
  "fournier's gangrene",
  "gas gangrene",
  "nec fasc",
  "necrotising fasciitis",
  "necrotizing fasciitis",
  "necrotizing soft tissue infection",
  "necrotizing soft-tissue infection",
  "nsti",
  "괴사성 근막염",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_RED_FLAG_TERMS = [
  "anesthesia",
  "bullae",
  "crepitus",
  "decreased sensation",
  "dusky",
  "ecchymosis",
  "pain out of proportion",
  "profound pain",
  "rapidly progressive",
  "skin necrosis",
  "systemic toxicity",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_SURGERY_TEAM_ACTION_TERMS = [
  "acute care surgery",
  "general surgery",
  "surgery",
  "surgical consult",
  "surgeon",
  "수술",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_DEBRIDEMENT_ACTION_TERMS = [
  "debridement",
  "excision of necrotic tissue",
  "fascial exploration",
  "fasciotomy",
  "necrotic tissue excision",
  "operative debridement",
  "operative exploration",
  "serial debridement",
  "surgical debridement",
  "surgical exploration",
  "wide excision",
  "괴사조직 절제",
  "수술적 변연절제",
  "수술적 탐색",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "broad-spectrum",
  "carbapenem",
  "clindamycin",
  "linezolid",
  "piperacillin",
  "tazobactam",
  "vancomycin",
  "항생제",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_BROAD_COVERAGE_ACTION_TERMS = [
  "anaerobe",
  "anaerobic",
  "carbapenem",
  "cefepime",
  "gram-negative",
  "meropenem",
  "metronidazole",
  "mrsa",
  "piperacillin",
  "tazobactam",
  "vancomycin",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_RESUSCITATION_ACTION_TERMS = [
  "fluid",
  "fluids",
  "icu",
  "lactate",
  "resuscitation",
  "sepsis",
  "shock",
  "vasopressor",
  "수액",
  "패혈증",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_DELAY_ACTION_TERMS = [
  "do not delay",
  "immediate",
  "not delay",
  "not postpone",
  "source control",
  "time critical",
  "urgent",
  "지연",
  "즉시",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_TOXIN_SAFETY_TERMS = [
  "clindamycin",
  "gas gangrene",
  "group a strep",
  "linezolid",
  "strep",
  "streptococcal",
  "toxin",
  "독소",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_REPEAT_SOURCE_SAFETY_TERMS = [
  "24",
  "48",
  "debridement",
  "repeat",
  "re-look",
  "second look",
  "source control",
  "재수술",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_DIAGNOSTIC_LIMITATION_SAFETY_TERMS = [
  "ct should not delay",
  "do not delay",
  "imaging",
  "lrinec",
  "not exclude",
  "not rule out",
  "surgical exploration",
  "지연",
];

const NECROTIZING_SOFT_TISSUE_INFECTION_ORGAN_RISK_SAFETY_TERMS = [
  "aki",
  "amputation",
  "coagulopathy",
  "diabetes",
  "immunocompromised",
  "organ failure",
  "renal",
  "shock",
  "괴사",
  "절단",
];

const FOURNIER_GAS_GANGRENE_CONTEXT_TERMS = [
  "clostridial",
  "clostridium",
  "fournier",
  "gas gangrene",
  "genital",
  "myonecrosis",
  "perianal",
  "perineal",
  "perineum",
  "scrotal",
  "vulvar",
];

const FOURNIER_GAS_GANGRENE_PENICILLIN_SAFETY_TERMS = ["penicillin", "piperacillin"];

const FOURNIER_GAS_GANGRENE_PROTEIN_SYNTHESIS_SAFETY_TERMS = [
  "clindamycin",
  "linezolid",
  "protein synthesis",
  "toxin",
];

const FOURNIER_GAS_GANGRENE_SOURCE_TEAM_SAFETY_TERMS = [
  "colorectal",
  "debridement",
  "fecal",
  "foreign body",
  "perianal",
  "perineal",
  "scrotal",
  "source control",
  "urology",
  "urinary",
];

const FOURNIER_GAS_GANGRENE_HBO_DELAY_SAFETY_TERMS = [
  "debridement first",
  "do not delay",
  "hbo",
  "hyperbaric",
  "not delay",
  "not recommended",
  "resuscitation first",
  "surgery first",
];

const RUPTURED_AAA_CONTEXT_TERMS = [
  "abdominal aortic aneurysm rupture",
  "pulsatile abdominal mass",
  "ruptured abdominal aortic aneurysm",
  "ruptured aaa",
  "symptomatic abdominal aortic aneurysm",
  "symptomatic aaa",
  "대동맥류 파열",
  "복부 대동맥류",
];

const RUPTURED_AAA_VASCULAR_TEAM_ACTION_TERMS = [
  "regional vascular service",
  "urgent vascular",
  "vascular surgery",
  "vascular surgeon",
  "vascular team",
  "혈관외과",
];

const RUPTURED_AAA_REPAIR_ACTION_TERMS = [
  "aneurysm repair",
  "endovascular aneurysm repair",
  "endovascular repair",
  "evar",
  "open repair",
  "open surgical repair",
  "operative aneurysm repair",
  "operative repair",
  "standard evar",
  "stent graft",
  "대동맥류 수복",
  "동맥류 수복",
];

const RUPTURED_AAA_HEMODYNAMIC_ACTION_TERMS = [
  "controlled resuscitation",
  "hypotensive resuscitation",
  "permissive hypotension",
  "restrictive fluid",
  "systolic",
  "target blood pressure",
  "저혈압",
];

const RUPTURED_AAA_BLOOD_ACTION_TERMS = [
  "blood product",
  "crossmatch",
  "large-bore",
  "massive transfusion",
  "packed rbc",
  "prbc",
  "type and cross",
  "type and screen",
  "수혈",
];

const RUPTURED_AAA_IMAGING_ACTION_TERMS = [
  "bedside ultrasound",
  "ct angiography",
  "cta",
  "not delay",
  "unstable",
  "ultrasound",
  "초음파",
];

const RUPTURED_AAA_TRANSFER_DELAY_SAFETY_TERMS = [
  "do not delay",
  "door-to-intervention",
  "immediate repair",
  "not delay",
  "transfer",
  "unstable",
  "urgent vascular",
  "전원",
  "지연",
];

const RUPTURED_AAA_ANTITHROMBOTIC_SAFETY_TERMS = [
  "anticoagulation",
  "antiplatelet",
  "bleeding",
  "hemorrhage",
  "thrombolysis",
  "출혈",
  "항응고",
];

const RUPTURED_AAA_SHOCK_COMPLICATION_SAFETY_TERMS = [
  "abdominal compartment",
  "cardiac arrest",
  "coagulopathy",
  "hypothermia",
  "renal",
  "shock",
  "triad",
  "응고",
  "쇼크",
];

const RUPTURED_AAA_REGIONAL_TRANSFER_SAFETY_TERMS = [
  "30 minutes",
  "immediate bedside ultrasound",
  "regional vascular service",
  "same day",
  "transfer",
  "vascular service",
];

const RUPTURED_AAA_REPAIR_SELECTION_SAFETY_TERMS = [
  "complex evar",
  "evar",
  "open repair",
  "repair suitability",
  "risk assessment tool",
  "standard evar",
];

const RUPTURED_AAA_ANESTHESIA_PERIOP_SAFETY_TERMS = [
  "abdominal compartment syndrome",
  "anaesthetic",
  "anaesthesia",
  "anesthesia",
  "local anaesthetic",
  "local anesthetic",
  "perioperative",
];

const RUPTURED_AAA_TRANSFER_RESUSCITATION_SAFETY_TERMS = [
  "permissive hypotension",
  "restrictive approach",
  "restrictive fluid",
  "systolic blood pressure",
  "transfer",
  "volume resuscitation",
];

const SUBARACHNOID_HEMORRHAGE_CONTEXT_TERMS = [
  "aneurysmal sah",
  "sentinel headache",
  "subarachnoid haemorrhage",
  "subarachnoid hemorrhage",
  "sudden worst headache",
  "thunderclap headache",
  "worst headache of life",
  "지주막하 출혈",
  "지주막하출혈",
];

const SUBARACHNOID_HEMORRHAGE_CT_ACTION_TERMS = [
  "ct head",
  "head ct",
  "non contrast ct",
  "non-contrast ct",
  "noncontrast ct",
  "뇌 ct",
  "두부 ct",
];

const SUBARACHNOID_HEMORRHAGE_LP_CTA_ACTION_TERMS = [
  "ct angiography",
  "cta",
  "lumbar puncture",
  "lp",
  "xanthochromia",
  "요추천자",
  "혈관조영",
];

const SUBARACHNOID_HEMORRHAGE_NEURO_ACTION_TERMS = [
  "neurocritical",
  "neurosurgery",
  "neurosurgical",
  "transfer",
  "중환자",
  "신경외과",
  "전원",
];

const SUBARACHNOID_HEMORRHAGE_BP_NIMODIPINE_ACTION_TERMS = [
  "blood pressure",
  "bp",
  "labetalol",
  "nicardipine",
  "nimodipine",
  "sbp",
  "혈압",
  "니모디핀",
];

const SUBARACHNOID_HEMORRHAGE_ANTICOAG_REVERSAL_SAFETY_TERMS = [
  "anticoagulant",
  "anticoagulation",
  "coagulopathy",
  "doac",
  "inr",
  "platelet",
  "reversal",
  "warfarin",
  "응고",
  "항응고",
  "혈소판",
];

const SUBARACHNOID_HEMORRHAGE_REBLEED_BP_SAFETY_TERMS = [
  "blood pressure",
  "bp",
  "hypertension",
  "rebleed",
  "rebleeding",
  "secure aneurysm",
  "unsecured aneurysm",
  "재출혈",
  "혈압",
];

const SUBARACHNOID_HEMORRHAGE_COMPLICATION_SAFETY_TERMS = [
  "delayed cerebral ischemia",
  "evd",
  "hydrocephalus",
  "icu",
  "neurocritical",
  "seizure",
  "vasospasm",
  "수두증",
  "혈관연축",
];

const SUBARACHNOID_HEMORRHAGE_DIAGNOSTIC_TIMING_SAFETY_TERMS = [
  "12 hours",
  "6 hours",
  "ct negative",
  "do not routinely offer lumbar puncture",
  "lumbar puncture",
  "specialist neuroradiologist",
  "xanthochromia",
];

const SUBARACHNOID_HEMORRHAGE_ANEURYSM_IMAGING_SAFETY_TERMS = [
  "ct angiography",
  "cta",
  "dsa",
  "digital subtraction angiography",
  "mra",
  "without delay",
];

const SUBARACHNOID_HEMORRHAGE_SECURE_ANEURYSM_SAFETY_TERMS = [
  "24 hours",
  "aneurysm treatment",
  "clipping",
  "coiling",
  "earliest opportunity",
  "endovascular",
  "secure aneurysm",
];

const SUBARACHNOID_HEMORRHAGE_NIMODIPINE_ROUTE_SAFETY_TERMS = [
  "enteral",
  "hypotension",
  "intravenous nimodipine",
  "iv nimodipine",
  "nimodipine",
  "specialist advice",
];

const SUBARACHNOID_HEMORRHAGE_HYDROCEPHALUS_DCI_SAFETY_TERMS = [
  "csf diversion",
  "csf drainage",
  "delayed cerebral ischemia",
  "euvolaemia",
  "hydrocephalus",
  "transcranial doppler",
  "tcd",
  "vasopressor",
];

const INTRACEREBRAL_HEMORRHAGE_CONTEXT_TERMS = [
  "basal ganglia hemorrhage",
  "brain hemorrhage",
  "cerebral haemorrhage",
  "cerebral hemorrhage",
  "doac-associated ich",
  "hemorrhagic stroke",
  "intracerebral haemorrhage",
  "intracerebral hemorrhage",
  "intraparenchymal haemorrhage",
  "intraparenchymal hemorrhage",
  "lobar hemorrhage",
  "warfarin-associated ich",
  "뇌내 출혈",
  "뇌내출혈",
  "출혈성 뇌졸중",
];

const INTRACEREBRAL_HEMORRHAGE_RISK_TERMS = [
  "altered mental status",
  "anticoagulant",
  "anticoagulation",
  "aphasia",
  "ataxia",
  "headache",
  "hemiparesis",
  "hypertension",
  "intraventricular",
  "neurologic deficit",
  "seizure",
  "vomiting",
  "weakness",
];

const INTRACEREBRAL_HEMORRHAGE_CT_ACTION_TERMS = [
  "ct head",
  "head ct",
  "non contrast ct",
  "non-contrast ct",
  "noncontrast ct",
  "repeat ct",
  "뇌 ct",
  "두부 ct",
];

const INTRACEREBRAL_HEMORRHAGE_BP_ACTION_TERMS = [
  "blood pressure",
  "bp",
  "clevidipine",
  "labetalol",
  "nicardipine",
  "sbp",
  "systolic",
  "혈압",
];

const INTRACEREBRAL_HEMORRHAGE_COAG_REVERSAL_ACTION_TERMS = [
  "4-factor pcc",
  "andexanet",
  "anticoagulant",
  "coagulopathy",
  "doac",
  "factor xa",
  "idarucizumab",
  "inr",
  "pcc",
  "prothrombin complex",
  "reversal",
  "vitamin k",
  "warfarin",
  "항응고",
  "역전",
];

const INTRACEREBRAL_HEMORRHAGE_NEURO_ICP_ACTION_TERMS = [
  "evd",
  "external ventricular",
  "hydrocephalus",
  "hypertonic saline",
  "icu",
  "intracranial pressure",
  "mannitol",
  "neurocritical",
  "neurosurgery",
  "신경외과",
  "중환자",
];

const INTRACEREBRAL_HEMORRHAGE_BP_SAFETY_TERMS = [
  "avoid hypotension",
  "bp variability",
  "cerebral perfusion",
  "excessive lowering",
  "smooth",
  "target range",
  "too rapid",
  "저혈압",
];

const INTRACEREBRAL_HEMORRHAGE_REVERSAL_SAFETY_TERMS = [
  "4-factor pcc",
  "andexanet",
  "antiplatelet",
  "doac",
  "factor xa",
  "idarucizumab",
  "platelet transfusion",
  "pcc",
  "thrombotic",
  "vitamin k",
  "warfarin",
];

const INTRACEREBRAL_HEMORRHAGE_VTE_RESTART_SAFETY_TERMS = [
  "anticoagulation restart",
  "dvt",
  "heparin timing",
  "intermittent pneumatic",
  "mechanical prophylaxis",
  "restart anticoagulation",
  "thrombosis",
  "venous thromboembolism",
  "vte",
];

const INTRACEREBRAL_HEMORRHAGE_COMPLICATION_SAFETY_TERMS = [
  "cerebellar",
  "evd",
  "external ventricular",
  "hematoma expansion",
  "herniation",
  "hydrocephalus",
  "intraventricular",
  "mass effect",
  "seizure",
];

const INTRACEREBRAL_HEMORRHAGE_BP_TARGET_EXCLUSION_SAFETY_TERMS = [
  "130",
  "140",
  "150",
  "200",
  "220",
  "60 mmhg",
  "bp reduction greater than 60",
  "glasgow coma scale",
  "gcs",
  "massive hematoma",
  "mild to moderate",
  "structural cause",
];

const INTRACEREBRAL_HEMORRHAGE_WARFARIN_SPECIFIC_REVERSAL_TERMS = [
  "4-factor pcc",
  "four-factor pcc",
  "intravenous vitamin k",
  "iv vitamin k",
  "pcc",
  "prothrombin complex concentrate",
  "vitamin k",
  "warfarin",
];

const INTRACEREBRAL_HEMORRHAGE_DOAC_SPECIFIC_REVERSAL_TERMS = [
  "andexanet",
  "apixaban",
  "dabigatran",
  "doac",
  "factor xa",
  "idarucizumab",
  "pcc",
  "rivaroxaban",
];

const INTRACEREBRAL_HEMORRHAGE_VTE_PE_RESPONSE_SAFETY_TERMS = [
  "clinically evident proximal dvt",
  "ivc filter",
  "low-molecular-weight heparin",
  "lmwh",
  "proximal dvt",
  "pulmonary embolism",
  "unfractionated heparin",
  "ufh",
  "venous thromboembolism",
];

const BB_CCB_OVERDOSE_DIRECT_CONTEXT_TERMS = [
  "beta blocker overdose",
  "beta-blocker overdose",
  "beta blocker toxicity",
  "beta-blocker toxicity",
  "calcium channel blocker overdose",
  "calcium-channel blocker overdose",
  "calcium channel blocker toxicity",
  "ccb overdose",
  "ccb toxicity",
  "cardioactive drug overdose",
  "심장약 과다복용",
];

const BB_CCB_OVERDOSE_DRUG_CONTEXT_TERMS = [
  "amlodipine",
  "atenolol",
  "beta blocker",
  "beta-blocker",
  "calcium channel blocker",
  "calcium-channel blocker",
  "carvedilol",
  "diltiazem",
  "metoprolol",
  "propranolol",
  "verapamil",
];

const BB_CCB_OVERDOSE_SHOCK_CONTEXT_TERMS = [
  "av block",
  "bradycardia",
  "cardiogenic shock",
  "hypotension",
  "junctional rhythm",
  "shock",
  "wide qrs",
  "서맥",
  "쇼크",
];

const BB_CCB_OVERDOSE_ECG_MONITOR_ACTION_TERMS = [
  "cardiac monitoring",
  "ecg",
  "ekg",
  "telemetry",
  "vital signs",
  "심전도",
];

const BB_CCB_OVERDOSE_CALCIUM_GLUCAGON_ATROPINE_ACTION_TERMS = [
  "atropine",
  "calcium chloride",
  "calcium gluconate",
  "glucagon",
  "칼슘",
  "글루카곤",
];

const BB_CCB_OVERDOSE_HIE_PATHWAY_ACTION_TERMS = [
  "euglycemia",
  "euglycaemia",
  "hie",
  "hiet",
  "high-dose insulin",
  "high dose insulin",
  "hyperinsulinemia",
  "hyperinsulinaemia",
];

const BB_CCB_OVERDOSE_INSULIN_ACTION_TERMS = [
  "insulin",
  "인슐린",
];

const BB_CCB_OVERDOSE_VASOPRESSOR_ACTION_TERMS = [
  "epinephrine",
  "inotrope",
  "norepinephrine",
  "shock",
  "vasopressor",
  "승압제",
];

const BB_CCB_OVERDOSE_ESCALATION_ACTION_TERMS = [
  "ecmo",
  "intra-aortic balloon",
  "lipid emulsion",
  "mechanical circulatory",
  "pacing",
  "poison center",
  "toxicologist",
  "체외순환",
];

const BB_CCB_OVERDOSE_HIE_MONITORING_SAFETY_TERMS = [
  "dextrose",
  "glucose",
  "hypoglycemia",
  "potassium",
  "serum glucose",
  "혈당",
  "칼륨",
];

const BB_CCB_OVERDOSE_AIRWAY_SEIZURE_QRS_SAFETY_TERMS = [
  "airway",
  "benzodiazepine",
  "intubation",
  "qrs",
  "seizure",
  "sodium bicarbonate",
  "wide qrs",
  "기도",
];

const BB_CCB_OVERDOSE_DECONTAMINATION_SAFETY_TERMS = [
  "activated charcoal",
  "bowel irrigation",
  "decontamination",
  "extended release",
  "sustained release",
  "whole bowel",
  "서방형",
];

const BB_CCB_OVERDOSE_ESCALATION_SAFETY_TERMS = [
  "ecmo",
  "fat overload",
  "lipid emulsion",
  "pancreatitis",
  "pacing",
  "vasopressor",
  "체외순환",
];

const DIGOXIN_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "cardiac glycoside poisoning",
  "cardiac glycoside toxicity",
  "digoxin overdose",
  "digoxin poisoning",
  "digoxin toxicity",
  "digitalis poisoning",
  "digitalis toxicity",
  "foxglove ingestion",
  "디곡신",
];

const DIGOXIN_TOXICITY_DRUG_CONTEXT_TERMS = [
  "digibind",
  "digifab",
  "digoxin",
  "digitalis",
  "foxglove",
];

const DIGOXIN_TOXICITY_RISK_CONTEXT_TERMS = [
  "av block",
  "bidirectional ventricular tachycardia",
  "bradycardia",
  "cardiac arrest",
  "confusion",
  "hyperkalemia",
  "junctional tachycardia",
  "nausea",
  "renal impairment",
  "ventricular arrhythmia",
  "ventricular ectopy",
  "visual halos",
  "vomiting",
  "yellow vision",
  "서맥",
];

const DIGOXIN_TOXICITY_ECG_MONITOR_ACTION_TERMS = [
  "cardiac monitoring",
  "ecg",
  "ekg",
  "electrocardiogram",
  "rhythm monitoring",
  "telemetry",
  "심전도",
];

const DIGOXIN_TOXICITY_LEVEL_ACTION_TERMS = [
  "6 hours",
  "six hours",
  "digoxin concentration",
  "digoxin level",
  "post-distribution",
  "serum digoxin",
  "therapeutic drug",
  "혈중 디곡신",
];

const DIGOXIN_TOXICITY_ELECTROLYTE_RENAL_ACTION_TERMS = [
  "creatinine",
  "electrolyte",
  "hypomagnesemia",
  "kidney",
  "magnesium",
  "potassium",
  "renal",
  "칼륨",
];

const DIGOXIN_TOXICITY_FAB_ACTION_TERMS = [
  "anti-digoxin fab",
  "digibind",
  "digifab",
  "digoxin immune fab",
  "digoxin-specific antibody",
  "digoxin-specific antibody fragment",
  "digoxin-specific fab",
  "면역 fab",
];

const DIGOXIN_TOXICITY_TOX_ARRHYTHMIA_ACTION_TERMS = [
  "atropine",
  "lidocaine",
  "lignocaine",
  "magnesium",
  "poison center",
  "toxicologist",
  "toxicology",
  "독성",
];

const DIGOXIN_TOXICITY_POTASSIUM_SAFETY_TERMS = [
  "hypokalemia",
  "hypokalaemia",
  "magnesium",
  "potassium",
  "serum potassium",
  "칼륨",
];

const DIGOXIN_TOXICITY_REBOUND_RENAL_SAFETY_TERMS = [
  "rebound",
  "recurrent toxicity",
  "renal failure",
  "renal impairment",
  "renal dysfunction",
  "repeat monitoring",
  "재발",
];

const DIGOXIN_TOXICITY_POST_FAB_LEVEL_SAFETY_TERMS = [
  "free digoxin",
  "post-fab",
  "serum digoxin",
  "total digoxin",
  "unbound digoxin",
  "unreliable",
  "혈중 디곡신",
];

const DIGOXIN_TOXICITY_CALCIUM_CARDIOVERSION_SAFETY_TERMS = [
  "avoid calcium",
  "avoid cardioversion",
  "calcium",
  "cardioversion",
  "defibrillation",
  "low-energy",
  "pacing",
  "칼슘",
];

const DIGOXIN_TOXICITY_DECONTAMINATION_SAFETY_TERMS = [
  "activated charcoal",
  "charcoal",
  "decontamination",
  "early ingestion",
  "within 2 hours",
  "within two hours",
  "활성탄",
];

const TCA_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "amitriptyline overdose",
  "amitriptyline toxicity",
  "tca overdose",
  "tca poisoning",
  "tca toxicity",
  "tricyclic antidepressant overdose",
  "tricyclic antidepressant poisoning",
  "tricyclic antidepressant toxicity",
  "tricyclic overdose",
  "tricyclic toxicity",
  "삼환계",
];

const TCA_TOXICITY_DRUG_CONTEXT_TERMS = [
  "amitriptyline",
  "amoxapine",
  "clomipramine",
  "desipramine",
  "doxepin",
  "imipramine",
  "nortriptyline",
  "protriptyline",
  "trimipramine",
  "tricyclic",
];

const TCA_TOXICITY_RISK_CONTEXT_TERMS = [
  "anticholinergic",
  "arrhythmia",
  "cardiac arrest",
  "coma",
  "hypotension",
  "qrs",
  "seizure",
  "sodium channel blockade",
  "ventricular dysrhythmia",
  "wide qrs",
  "경련",
  "저혈압",
];

const TCA_TOXICITY_ECG_QRS_ACTION_TERMS = [
  "12-lead",
  "av r",
  "avr",
  "cardiac monitoring",
  "ecg",
  "ekg",
  "qrs",
  "telemetry",
  "심전도",
];

const TCA_TOXICITY_BICARB_ACTION_TERMS = [
  "alkalinization",
  "bicarbonate",
  "sodium bicarbonate",
  "sodium bicarb",
  "중탄산",
];

const TCA_TOXICITY_AIRWAY_ACIDOSIS_ACTION_TERMS = [
  "abc",
  "acidosis",
  "airway",
  "arterial ph",
  "blood gas",
  "icu",
  "intubation",
  "ph",
  "ventilation",
  "기도",
];

const TCA_TOXICITY_SEIZURE_BENZO_ACTION_TERMS = [
  "benzodiazepine",
  "diazepam",
  "lorazepam",
  "midazolam",
  "seizure",
  "경련",
];

const TCA_TOXICITY_HYPOTENSION_ESCALATION_ACTION_TERMS = [
  "fluid",
  "fluids",
  "intralipid",
  "lipid emulsion",
  "norepinephrine",
  "poison center",
  "toxicologist",
  "toxicology",
  "vasopressor",
  "승압제",
];

const TCA_TOXICITY_DECONTAMINATION_SAFETY_TERMS = [
  "activated charcoal",
  "airway protected",
  "charcoal",
  "decontamination",
  "ipecac",
  "within 2 hours",
  "within two hours",
  "활성탄",
];

const TCA_TOXICITY_AVOIDANCE_SAFETY_TERMS = [
  "anti-dysrhythmic",
  "antiarrhythmic",
  "class 1a",
  "class 1c",
  "class 3",
  "class ia",
  "class ic",
  "class iii",
  "flumazenil",
  "physostigmine",
  "avoid",
];

const TCA_TOXICITY_PH_SODIUM_SAFETY_TERMS = [
  "alkalemia",
  "alkalosis",
  "hypernatremia",
  "ph 7.5",
  "ph 7.55",
  "serum ph",
  "sodium",
];

const TCA_TOXICITY_OBSERVATION_SAFETY_TERMS = [
  "24 hours",
  "6 hours",
  "continuous monitoring",
  "icu",
  "observation",
  "repeat ecg",
  "repeat ekg",
  "serial ecg",
];

const TCA_TOXICITY_DIALYSIS_LEVEL_SAFETY_TERMS = [
  "dialysis",
  "drug level",
  "hemoperfusion",
  "not effective",
  "serum level",
  "tca level",
  "toxicity correlation",
];

const ORGANOPHOSPHATE_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "acetylcholinesterase inhibitor poisoning",
  "cholinergic crisis",
  "cholinergic toxidrome",
  "nerve agent poisoning",
  "organophosphate exposure",
  "organophosphate poisoning",
  "organophosphate toxicity",
  "organophosphorus poisoning",
  "organophosphorus toxicity",
  "pesticide poisoning",
  "유기인산",
];

const ORGANOPHOSPHATE_TOXICITY_EXPOSURE_CONTEXT_TERMS = [
  "chlorpyrifos",
  "diazinon",
  "dichlorvos",
  "insecticide",
  "malathion",
  "nerve agent",
  "organophosphate",
  "organophosphorus",
  "parathion",
  "pesticide",
  "sarin",
];

const ORGANOPHOSPHATE_TOXICITY_CHOLINERGIC_CONTEXT_TERMS = [
  "bronchorrhea",
  "bronchospasm",
  "diaphoresis",
  "fasciculation",
  "fasciculations",
  "lacrimation",
  "miosis",
  "pinpoint pupils",
  "salivation",
  "secretions",
  "seizure",
  "wheezing",
  "기관지분비",
];

const ORGANOPHOSPHATE_TOXICITY_PPE_DECON_ACTION_TERMS = [
  "clothing removal",
  "decontamination",
  "personal protective equipment",
  "ppe",
  "soap and water",
  "wash",
  "보호구",
];

const ORGANOPHOSPHATE_TOXICITY_AIRWAY_SECRETION_ACTION_TERMS = [
  "airway",
  "bronchorrhea",
  "bronchospasm",
  "intubation",
  "oxygen",
  "respiratory failure",
  "secretions",
  "ventilation",
  "기도",
];

const ORGANOPHOSPHATE_TOXICITY_ATROPINE_ACTION_TERMS = [
  "atropine",
  "atropinization",
  "bronchoconstriction",
  "dry secretions",
  "doubling",
  "secretions clear",
  "아트로핀",
];

const ORGANOPHOSPHATE_TOXICITY_PRALIDOXIME_ACTION_TERMS = [
  "2-pam",
  "aging",
  "oxime",
  "pralidoxime",
  "reactivation",
  "프랄리독심",
];

const ORGANOPHOSPHATE_TOXICITY_SEIZURE_ICU_ACTION_TERMS = [
  "benzodiazepine",
  "cardiac monitoring",
  "diazepam",
  "icu",
  "lorazepam",
  "midazolam",
  "poison center",
  "seizure",
  "toxicologist",
  "toxicology",
];

const ORGANOPHOSPHATE_TOXICITY_SUCCINYLCHOLINE_SAFETY_TERMS = [
  "avoid succinylcholine",
  "prolonged paralysis",
  "succinylcholine",
  "석시닐콜린",
];

const ORGANOPHOSPHATE_TOXICITY_LAB_DIAGNOSIS_SAFETY_TERMS = [
  "ache",
  "arterial blood gas",
  "bche",
  "butyrylcholinesterase",
  "cholinesterase",
  "do not wait",
  "rbc ache",
  "treat before",
];

const ORGANOPHOSPHATE_TOXICITY_PRALIDOXIME_ORDER_SAFETY_TERMS = [
  "after atropine",
  "atropine before",
  "cardiac arrest",
  "infusion",
  "pralidoxime",
  "rapid administration",
  "slow infusion",
];

const ORGANOPHOSPHATE_TOXICITY_MONITORING_SAFETY_TERMS = [
  "48 hours",
  "icu",
  "intermediate syndrome",
  "negative inspiratory force",
  "recurring",
  "respiratory failure",
  "tidal volume",
  "ventilatory support",
];

const ORGANOPHOSPHATE_TOXICITY_DECON_DELAY_SAFETY_TERMS = [
  "bodily secretions",
  "clothing",
  "decontamination",
  "do not delay",
  "ppe",
  "soap and water",
  "vomit",
];

const GUILLAIN_BARRE_DIRECT_CONTEXT_TERMS = [
  "acute inflammatory demyelinating polyradiculoneuropathy",
  "acute motor axonal neuropathy",
  "aidp",
  "gbs",
  "guillain barre",
  "guillain-barré",
  "guillain-barre",
  "miller fisher",
  "polyradiculoneuropathy",
];

const GUILLAIN_BARRE_NEURO_RISK_TERMS = [
  "areflexia",
  "ascending weakness",
  "autonomic instability",
  "bulbar weakness",
  "dysautonomia",
  "facial weakness",
  "hyporeflexia",
  "nonambulatory",
  "rapid progression",
  "respiratory muscle weakness",
  "unable to walk",
];

const GUILLAIN_BARRE_ADMISSION_NEURO_ACTION_TERMS = [
  "admit",
  "hospital",
  "hospitalize",
  "lumbar puncture",
  "nerve conduction",
  "neurology",
  "ncs",
];

const GUILLAIN_BARRE_RESPIRATORY_MONITOR_ACTION_TERMS = [
  "fvc",
  "forced vital capacity",
  "mep",
  "mip",
  "negative inspiratory force",
  "nif",
  "respiratory monitoring",
  "serial vital capacity",
  "vital capacity",
];

const GUILLAIN_BARRE_IMMUNOTHERAPY_ACTION_TERMS = [
  "intravenous immunoglobulin",
  "ivig",
  "plasma exchange",
  "plasmapheresis",
  "plex",
];

const GUILLAIN_BARRE_ICU_AIRWAY_ACTION_TERMS = [
  "airway",
  "bulbar",
  "icu",
  "intubation",
  "mechanical ventilation",
  "respiratory failure",
  "ventilation",
];

const GUILLAIN_BARRE_STEROID_AVOIDANCE_SAFETY_TERMS = [
  "avoid corticosteroid",
  "avoid glucocorticoid",
  "corticosteroids not recommended",
  "glucocorticoids not recommended",
  "no corticosteroids",
  "steroids not recommended",
];

const GUILLAIN_BARRE_SEQUENTIAL_THERAPY_SAFETY_TERMS = [
  "avoid combining",
  "avoid sequential",
  "combination not beneficial",
  "do not combine",
  "ivig and plasma exchange",
  "monotherapy",
  "sequential therapy not recommended",
];

const GUILLAIN_BARRE_AUTONOMIC_SAFETY_TERMS = [
  "arrhythmia",
  "blood pressure",
  "bradycardia",
  "cardiac monitoring",
  "dysautonomia",
  "ecg",
  "telemetry",
];

const GUILLAIN_BARRE_SUPPORTIVE_SAFETY_TERMS = [
  "aspiration",
  "bowel",
  "dvt",
  "pain control",
  "pressure injury",
  "rehabilitation",
  "skin breakdown",
  "swallow",
  "venous thrombosis",
  "vte",
];

const MYASTHENIC_CRISIS_DIRECT_CONTEXT_TERMS = [
  "acetylcholine receptor antibody",
  "achr antibody",
  "musk antibody",
  "myasthenia gravis",
  "myasthenic crisis",
  "myasthenic exacerbation",
  "neuromuscular junction disorder",
];

const MYASTHENIC_CRISIS_RISK_TERMS = [
  "bulbar weakness",
  "difficulty counting",
  "diplopia",
  "dysarthria",
  "dysphagia",
  "dyspnea",
  "facial weakness",
  "hypophonia",
  "neck flexor weakness",
  "ptosis",
  "respiratory distress",
  "respiratory failure",
  "weak cough",
];

const MYASTHENIC_CRISIS_RESPIRATORY_ACTION_TERMS = [
  "fvc",
  "negative inspiratory force",
  "nif",
  "peak expiratory flow",
  "pef",
  "respiratory function",
  "serial vital capacity",
  "vc",
  "vital capacity",
];

const MYASTHENIC_CRISIS_AIRWAY_ICU_ACTION_TERMS = [
  "airway",
  "elective intubation",
  "icu",
  "intensive care",
  "intubation",
  "mechanical ventilation",
  "ventilation",
];

const MYASTHENIC_CRISIS_IMMUNOTHERAPY_ACTION_TERMS = [
  "intravenous immunoglobulin",
  "ivig",
  "plex",
  "plasma exchange",
  "plasmapheresis",
];

const MYASTHENIC_CRISIS_PRECIPITANT_ACTION_TERMS = [
  "aspiration",
  "infection",
  "medication",
  "precipitant",
  "pneumonia",
  "pregnancy",
  "surgery",
  "trigger",
];

const MYASTHENIC_CRISIS_MEDICATION_AVOIDANCE_SAFETY_TERMS = [
  "aminoglycoside",
  "beta blocker",
  "calcium channel blocker",
  "ciprofloxacin",
  "erythromycin",
  "fluoroquinolone",
  "gentamicin",
  "macrolide",
  "magnesium",
  "phenytoin",
  "procainamide",
  "quinidine",
  "quinolone",
  "streptomycin",
];

const MYASTHENIC_CRISIS_ACETYLCHOLINESTERASE_SAFETY_TERMS = [
  "acetylcholinesterase inhibitor",
  "cholinergic crisis",
  "discontinue pyridostigmine",
  "excessive secretions",
  "hold pyridostigmine",
  "lower pyridostigmine",
  "pulmonary secretions",
  "pyridostigmine",
];

const MYASTHENIC_CRISIS_STEROID_MONITORING_SAFETY_TERMS = [
  "bulbar symptoms",
  "hospital setting",
  "monitor respiratory function",
  "prednisone",
  "respiratory monitoring",
  "steroid",
  "worsening",
];

const MYASTHENIC_CRISIS_NIV_INTUBATION_SAFETY_TERMS = [
  "aspiration",
  "bipap",
  "bulbar weakness",
  "hypercapnia",
  "nif",
  "niv",
  "noninvasive ventilation",
  "pcO2",
  "tachypnea",
  "work of breathing",
];

const MYASTHENIC_CRISIS_PARALYTIC_SAFETY_TERMS = [
  "neuromuscular blocker",
  "nondepolarizing",
  "paralytic",
  "reduced dose",
  "succinylcholine",
  "vecuronium",
];

const BOTULISM_DIRECT_CONTEXT_TERMS = [
  "botulinum toxin",
  "botulism",
  "clostridium botulinum",
  "foodborne botulism",
  "infant botulism",
  "wound botulism",
];

const BOTULISM_RISK_TERMS = [
  "blurred vision",
  "cranial nerve palsy",
  "descending flaccid paralysis",
  "diplopia",
  "dysphagia",
  "flaccid paralysis",
  "ocular palsy",
  "poor feeding",
  "ptosis",
  "respiratory distress",
  "respiratory failure",
  "slurred speech",
  "weak cry",
  "weakness",
];

const BOTULISM_PUBLIC_HEALTH_ACTION_TERMS = [
  "babybig",
  "cdc",
  "clinical botulism service",
  "health department",
  "infant botulism treatment",
  "public health",
  "state health",
];

const BOTULISM_ANTITOXIN_ACTION_TERMS = [
  "babybig",
  "botulism immune globulin",
  "botulinum antitoxin heptavalent",
  "heptavalent",
  "heptavalent botulism antitoxin",
  "human botulism immune globulin",
];

const BOTULISM_RESPIRATORY_ACTION_TERMS = [
  "icu",
  "intensive care",
  "mechanical ventilation",
  "respiratory function",
  "respiratory monitoring",
  "ventilator",
  "ventilatory support",
];

const BOTULISM_SPECIMEN_SOURCE_ACTION_TERMS = [
  "food sample",
  "serum",
  "source",
  "specimen",
  "stool",
  "toxin testing",
  "wound",
];

const BOTULISM_NO_WAIT_LAB_SAFETY_TERMS = [
  "do not wait",
  "lab confirmation",
  "laboratory confirmation",
  "not delay",
  "treat empirically",
];

const BOTULISM_INFANT_ANTITOXIN_SAFETY_TERMS = [
  "babybig",
  "botulism immune globulin",
  "heptavalent",
  "human botulism immune globulin",
  "infant",
];

const BOTULISM_WOUND_SOURCE_SAFETY_TERMS = [
  "antibiotic",
  "debridement",
  "source control",
  "surgical",
  "wound botulism",
];

const BOTULISM_SUPPORTIVE_COMPLICATION_SAFETY_TERMS = [
  "bladder",
  "bowel",
  "communication",
  "dry eyes",
  "dry mouth",
  "dvt",
  "pressure ulcers",
  "rehabilitation",
  "secretions",
  "urinary tract infection",
];

const TICK_PARALYSIS_DIRECT_CONTEXT_TERMS = [
  "paralysis tick",
  "tick neurotoxin",
  "tick paralysis",
];

const TICK_PARALYSIS_RISK_TERMS = [
  "acute ataxia",
  "areflexia",
  "ascending paralysis",
  "ascending weakness",
  "ataxia",
  "facial palsy",
  "flaccid paralysis",
  "ophthalmoplegia",
  "respiratory failure",
  "tick attached",
  "weakness",
];

const TICK_PARALYSIS_SEARCH_ACTION_TERMS = [
  "axilla",
  "behind the ears",
  "full skin exam",
  "hairline",
  "interdigital",
  "perineum",
  "scalp",
  "skin search",
  "tick search",
];

const TICK_PARALYSIS_REMOVAL_ACTION_TERMS = [
  "complete tick removal",
  "fine forceps",
  "remove tick",
  "remove the tick",
  "steady traction",
  "tick removal",
];

const TICK_PARALYSIS_RESPIRATORY_ACTION_TERMS = [
  "abg",
  "blood gas",
  "intubation",
  "mechanical ventilation",
  "pulmonary function",
  "respiratory monitoring",
  "respiratory support",
];

const TICK_PARALYSIS_DIFFERENTIAL_ACTION_TERMS = [
  "botulism",
  "guillain-barre",
  "guillain barre",
  "miller fisher",
  "myasthenia",
  "spinal cord",
];

const TICK_PARALYSIS_IVIG_PLEX_SAFETY_TERMS = [
  "immune globulin not helpful",
  "ivig not helpful",
  "plasmapheresis not helpful",
  "plex not helpful",
  "unnecessary ivig",
  "unnecessary plasmapheresis",
];

const TICK_PARALYSIS_MOUTHPARTS_SAFETY_TERMS = [
  "avoid leaving mouthparts",
  "embedded mouthparts",
  "mouth parts",
  "mouthparts",
  "remove entire tick",
];

const TICK_PARALYSIS_OBSERVATION_SAFETY_TERMS = [
  "australian tick",
  "inpatient observation",
  "ixodes holocyclus",
  "respiratory compromise",
  "worsen after removal",
  "24 to 48 hours",
];

const TICK_PARALYSIS_INFECTION_SAFETY_TERMS = [
  "ehrlichiosis",
  "fever",
  "lyme",
  "rash",
  "rickettsial",
  "rocky mountain spotted fever",
  "tick-borne infection",
];

const MYOCARDITIS_DIRECT_CONTEXT_TERMS = [
  "acute myocarditis",
  "fulminant myocarditis",
  "inflammatory cardiomyopathy",
  "myocarditis",
  "myopericarditis",
  "viral myocarditis",
];

const MYOCARDITIS_RISK_TERMS = [
  "arrhythmia",
  "cardiac arrest",
  "cardiogenic shock",
  "chest pain",
  "dyspnea",
  "heart block",
  "heart failure",
  "palpitations",
  "reduced ejection fraction",
  "st elevation",
  "syncope",
  "troponin",
  "ventricular tachycardia",
];

const MYOCARDITIS_ECG_TROPONIN_ACTION_TERMS = [
  "12-lead ecg",
  "cardiac markers",
  "ecg",
  "ekg",
  "st segment",
  "troponin",
];

const MYOCARDITIS_ECHO_IMAGING_ACTION_TERMS = [
  "cardiac mri",
  "echocardiogram",
  "echo",
  "ejection fraction",
  "tte",
];

const MYOCARDITIS_ADMISSION_ACTION_TERMS = [
  "admit",
  "hospital",
  "hospitalization",
  "hospitalize",
];

const MYOCARDITIS_MONITORING_ACTION_TERMS = [
  "arrhythmia monitoring",
  "cardiology",
  "decompensation monitoring",
  "monitoring",
  "telemetry",
];

const MYOCARDITIS_SHOCK_ARRHYTHMIA_ACTION_TERMS = [
  "defibrillation",
  "ecmo",
  "icu",
  "impella",
  "inotrope",
  "mechanical circulatory support",
  "vasopressor",
  "ventricular arrhythmia",
];

const MYOCARDITIS_ACTIVITY_RESTRICTION_SAFETY_TERMS = [
  "avoid exercise",
  "avoid stress testing",
  "exercise restriction",
  "no sports",
  "physical activity limited",
  "return to play",
];

const MYOCARDITIS_NSAID_CARDIOTOXIC_SAFETY_TERMS = [
  "avoid cardiotoxic",
  "avoid cardiotoxic drugs",
  "avoid nsaid",
  "avoid nsaids",
  "avoid nonsteroidal anti-inflammatory",
  "cardiotoxic drugs",
  "no nsaid",
  "no nsaids",
  "nsaid avoidance",
  "nsaids avoidance",
];

const MYOCARDITIS_CORONARY_EXCLUSION_SAFETY_TERMS = [
  "cardiac catheterization",
  "coronary cta",
  "coronary ct angiogram",
  "coronary disease",
  "exclude acs",
  "rule out acs",
];

const MYOCARDITIS_BIOPSY_TERTIARY_SAFETY_TERMS = [
  "biopsy",
  "cardiac mri",
  "cardiac transplant",
  "endomyocardial biopsy",
  "high-degree av block",
  "mechanical assist",
  "tertiary care",
  "worsening",
];

const MYOCARDITIS_FOLLOWUP_MONITORING_SAFETY_TERMS = [
  "arrhythmia monitoring",
  "follow-up echo",
  "repeat echocardiogram",
  "repeat echo",
  "wearable defibrillator",
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

const DKA_POTASSIUM_BEFORE_INSULIN_ACTION_TERMS = [
  "after potassium assessment",
  "check potassium before insulin",
  "defer insulin",
  "delay insulin",
  "following potassium assessment",
  "hold insulin if potassium",
  "insulin after potassium",
  "insulin should be deferred",
  "k before insulin",
  "k below 3.5",
  "k < 3.5",
  "k <3.5",
  "potassium assessment before insulin",
  "potassium before insulin",
  "potassium below 3.5",
  "potassium below safe threshold before insulin",
  "potassium threshold before insulin",
  "replace potassium before insulin",
];

const DKA_FLUID_ACTION_TERMS = [
  "fluid",
  "fluids",
  "crystalloid",
  "isotonic",
  "saline",
  "수액",
];

const DKA_INSULIN_ACTION_TERMS = [
  "continuous insulin infusion",
  "fixed rate insulin",
  "fixed-rate insulin",
  "insulin infusion",
  "intravenous insulin",
  "iv insulin",
  "regular insulin infusion",
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

const DKA_BICARBONATE_SAFETY_TERMS = [
  "avoid routine bicarbonate",
  "bicarbonate",
  "ph <7.0",
  "ph below 7.0",
  "ph less than 7.0",
  "severe acidosis",
];

const DKA_PHOSPHATE_SAFETY_TERMS = [
  "cardiac",
  "hypophosphatemia",
  "phosphate",
  "respiratory",
];

const DKA_DEXTROSE_ADDITION_TERMS = [
  "200-250",
  "250 mg/dl",
  "dextrose",
  "glucose reaches",
  "glucose falls",
];

const DKA_INSULIN_CONTINUATION_TERMS = [
  "continue insulin",
  "continued insulin",
  "insulin until",
  "ongoing insulin",
];

const DKA_KETOACIDOSIS_RESOLUTION_ENDPOINT_TERMS = [
  "anion gap closure",
  "dka resolution",
  "ketone clearance",
  "ketone resolution",
  "ketoacidosis resolution",
];

const DKA_BASAL_SUBCUTANEOUS_INSULIN_TERMS = [
  "basal insulin",
  "long-acting insulin",
  "subcutaneous insulin",
];

const DKA_IV_TO_SC_OVERLAP_TIMING_TERMS = [
  "1-2 h",
  "1-2 hour",
  "before stopping iv insulin",
  "before stopping intravenous insulin",
  "overlap",
  "transition",
];

const DKA_TRANSITION_READINESS_TERMS = [
  "anion gap closure",
  "dka resolution",
  "eating",
  "ketone clearance",
  "ketone resolution",
  "oral intake",
];

const DKA_PRECIPITANT_SAFETY_TERMS = [
  "infection",
  "medication contributor",
  "medication contributors",
  "missed insulin",
  "myocardial infarction",
  "precipitant",
  "sglt2",
  "stroke",
];

const PEDIATRIC_DKA_CONTEXT_TERMS = [
  "adolescent with dka",
  "child with dka",
  "childhood dka",
  "new onset type 1 diabetes",
  "paediatric diabetic ketoacidosis",
  "paediatric dka",
  "pediatric diabetic ketoacidosis",
  "pediatric dka",
  "소아 dka",
  "소아 당뇨병성 케톤산증",
];

const PEDIATRIC_DKA_RISK_TERMS = [
  "abdominal pain",
  "acidosis",
  "altered mental status",
  "anion gap",
  "beta-hydroxybutyrate",
  "bicarbonate",
  "cerebral edema",
  "cerebral injury",
  "dehydration",
  "headache",
  "hyperglycemia",
  "hypokalemia",
  "hypophosphatemia",
  "ketone",
  "ketones",
  "kussmaul",
  "ph",
  "shock",
  "vomiting",
];

const PEDIATRIC_DKA_SEVERITY_ACTION_TERMS = [
  "anion gap",
  "beta-hydroxybutyrate",
  "bicarbonate",
  "corrected sodium",
  "dehydration",
  "ketone",
  "mental status",
  "ph",
  "severity",
  "weight",
];

const PEDIATRIC_DKA_FLUID_ACTION_TERMS = [
  "0.9% saline",
  "balanced crystalloid",
  "deficit",
  "fluid bolus",
  "isotonic fluid",
  "maintenance",
  "normal saline",
  "shock bolus",
];

const PEDIATRIC_DKA_INSULIN_ACTION_TERMS = [
  "0.05 units/kg",
  "0.1 units/kg",
  "after fluids",
  "after potassium",
  "insulin infusion",
  "no insulin bolus",
  "without bolus",
];

const PEDIATRIC_DKA_ELECTROLYTE_ACTION_TERMS = [
  "corrected sodium",
  "electrolyte",
  "hypokalemia",
  "phosphate",
  "potassium",
  "serial potassium",
  "serial sodium",
];

const PEDIATRIC_DKA_NEURO_ESCALATION_ACTION_TERMS = [
  "3% saline",
  "cerebral edema",
  "cerebral injury",
  "hypertonic saline",
  "icu",
  "mannitol",
  "neuro checks",
  "neurologic checks",
  "picu",
];

const PEDIATRIC_DKA_BICARB_SAFETY_TERMS = [
  "active cardiopulmonary resuscitation",
  "avoid bicarbonate",
  "bicarbonate only",
  "cardiac compromise",
  "life-threatening hyperkalemia",
  "no bicarbonate",
  "symptomatic hyperkalemia",
];

const PEDIATRIC_DKA_CEREBRAL_INJURY_SAFETY_TERMS = [
  "3% saline",
  "altered mental status",
  "bradycardia",
  "cerebral edema",
  "cerebral injury",
  "head elevation",
  "headache",
  "hypertonic saline",
  "hypertension",
  "mannitol",
  "neuro checks",
  "neurologic",
];

const PEDIATRIC_DKA_HYPOGLYCEMIA_ELECTROLYTE_SAFETY_TERMS = [
  "corrected sodium",
  "dextrose",
  "glucose fall",
  "hypoglycemia",
  "hypokalemia",
  "hypophosphatemia",
  "phosphate",
  "potassium",
];

const PEDIATRIC_DKA_DISPOSITION_TRANSITION_SAFETY_TERMS = [
  "anion gap closure",
  "endocrinology",
  "icu",
  "ketone clearance",
  "pediatric endocrinology",
  "picu",
  "resolution",
  "subcutaneous insulin",
  "tolerating oral",
  "transition",
];

const HHS_CONTEXT_TERMS = [
  "hhs with",
  "hhns",
  "honk",
  "hyperglycemic hyperosmolar",
  "hyperosmolar hyperglycemic",
  "hyperosmolar hyperglycaemic",
  "hyperosmolar nonketotic",
  "hyperosmolar state",
  "suspected hhs",
];

const HHS_HYPEROSMOLAR_RISK_TERMS = [
  "altered mental status",
  "coma",
  "confusion",
  "dehydration",
  "glucose >600",
  "glucose 600",
  "hyperglycemia",
  "hyperosmolality",
  "osmolality >320",
  "osmolality 320",
  "seizure",
];

const HHS_FLUID_PERFUSION_ACTION_TERMS = [
  "crystalloid",
  "fluid",
  "fluids",
  "isotonic saline",
  "normal saline",
  "perfusion",
  "ringer",
  "volume",
];

const HHS_OSMOLALITY_SODIUM_ACTION_TERMS = [
  "effective osmolality",
  "osmolality",
  "osmolar",
  "sodium",
];

const HHS_GLUCOSE_KETONE_ACIDBASE_ACTION_TERMS = [
  "beta-hydroxybutyrate",
  "blood gas",
  "bicarbonate",
  "glucose",
  "ketone",
  "ph",
];

const HHS_INSULIN_POTASSIUM_ACTION_TERMS = [
  "0.05",
  "insulin",
  "potassium",
  "defer insulin",
];

const HHS_PRECIPITANT_ESCALATION_ACTION_TERMS = [
  "culture",
  "infection",
  "icu",
  "myocardial infarction",
  "precipitant",
  "sepsis",
  "stroke",
];

const HHS_OSMOLAR_CORRECTION_SAFETY_TERMS = [
  "3 and 8",
  "cerebral edema",
  "glucose fall",
  "no more than 10",
  "osmolality",
  "rapid correction",
  "sodium",
];

const HHS_INSULIN_TIMING_SAFETY_TERMS = [
  "0.05",
  "defer insulin",
  "fluids first",
  "glucose stops falling",
  "insulin after fluids",
  "osmotic shift",
];

const HHS_POTASSIUM_RENAL_FLUID_SAFETY_TERMS = [
  "cardiac failure",
  "ckd",
  "defer insulin",
  "frailty",
  "kidney",
  "potassium",
  "renal",
];

const HHS_THROMBOSIS_PRECIPITANT_SAFETY_TERMS = [
  "infection",
  "mi",
  "myocardial infarction",
  "precipitant",
  "stroke",
  "thrombosis",
  "vte",
];

const HHS_RESOLUTION_DISPOSITION_SAFETY_TERMS = [
  "cognitive status",
  "euglycemia",
  "icu",
  "osmolality below 300",
  "urine output",
];

const HYPONATREMIA_CONTEXT_TERMS = [
  "acute hyponatremia",
  "hyponatremic seizure",
  "low sodium with seizure",
  "na 112",
  "na 115",
  "severe hyponatremia",
  "sodium 112",
  "sodium 115",
  "symptomatic hyponatremia",
  "저나트륨혈증",
];

const HYPONATREMIA_SEVERE_RISK_TERMS = [
  "altered mental status",
  "brain edema",
  "cerebral edema",
  "coma",
  "confusion",
  "obtundation",
  "seizure",
  "somnolence",
];

const HYPONATREMIA_SODIUM_OSM_ACTION_TERMS = [
  "hypotonic",
  "osmolality",
  "osmolar",
  "serum sodium",
  "sodium",
];

const HYPONATREMIA_HYPERTONIC_ACTION_TERMS = [
  "3 percent",
  "3%",
  "hypertonic saline",
  "hypertonic sodium chloride",
  "sodium chloride bolus",
  "고장성 식염수",
];

const HYPONATREMIA_NEURO_ESCALATION_ACTION_TERMS = [
  "airway",
  "coma",
  "high dependency",
  "icu",
  "intubation",
  "neurologic",
  "seizure",
];

const HYPONATREMIA_MONITORING_ACTION_TERMS = [
  "correction",
  "every 2",
  "frequent sodium",
  "q2",
  "repeat sodium",
  "serial sodium",
];

const HYPONATREMIA_CAUSE_EVALUATION_ACTION_TERMS = [
  "adrenal",
  "diuretic",
  "siadh",
  "thyroid",
  "urine osmolality",
  "urine sodium",
  "volume status",
];

const HYPONATREMIA_CORRECTION_LIMIT_SAFETY_TERMS = [
  "6-8",
  "6 to 8",
  "8 mmol",
  "10 mmol",
  "24 hours",
  "no more than 8",
  "no more than 10",
  "ods",
  "osmotic demyelination",
];

const HYPONATREMIA_HIGH_RISK_SAFETY_TERMS = [
  "alcohol",
  "chronic",
  "hypokalemia",
  "liver disease",
  "malnutrition",
  "unknown duration",
];

const HYPONATREMIA_OVERCORRECTION_RESCUE_SAFETY_TERMS = [
  "d5w",
  "ddavp",
  "desmopressin",
  "hypotonic fluid",
  "overcorrection",
  "relowering",
];

const HYPONATREMIA_VOLUME_CAUSE_SAFETY_TERMS = [
  "euvolemic",
  "fluid restriction",
  "hypervolemic",
  "hypovolemic",
  "normal saline",
  "offending medication",
  "stop thiazide",
];

const HYPONATREMIA_DISPOSITION_MONITORING_SAFETY_TERMS = [
  "close monitoring",
  "frequent sodium",
  "high dependency",
  "icu",
  "q2",
  "serial sodium",
];

const RHABDOMYOLYSIS_CONTEXT_TERMS = [
  "crush syndrome",
  "exertional rhabdomyolysis",
  "rhabdomyolysis",
  "rhabdo",
  "suspected rhabdomyolysis",
  "traumatic rhabdomyolysis",
  "횡문근융해",
];

const RHABDOMYOLYSIS_SEVERE_RISK_TERMS = [
  "aki",
  "ck 5000",
  "ck >5000",
  "cola-colored urine",
  "creatine kinase",
  "crush injury",
  "dark urine",
  "hyperkalemia",
  "myoglobinuria",
  "tea-colored urine",
];

const RHABDOMYOLYSIS_CK_MYOGLOBIN_ACTION_TERMS = [
  "ck",
  "cPK",
  "creatine kinase",
  "myoglobin",
  "myoglobinuria",
  "urinalysis",
];

const RHABDOMYOLYSIS_FLUID_ACTION_TERMS = [
  "crystalloid",
  "fluid",
  "hydration",
  "isotonic saline",
  "iv fluids",
  "lactated ringer",
  "normal saline",
];

const RHABDOMYOLYSIS_URINE_MONITORING_ACTION_TERMS = [
  "foley",
  "hourly urine",
  "monitor urine",
  "urine output",
  "urine-output",
];

const RHABDOMYOLYSIS_URINE_OUTPUT_TARGET_ACTION_TERMS = [
  "1 to 3 ml/kg/hour",
  "1-3 ml/kg/hour",
  "200 ml/h",
  "200 ml/hour",
  "200 ml/hr",
  "200 to 300",
  "200-300",
  "300 ml/h",
  "300 ml/hour",
  "300 ml/hr",
  "target urine output",
  "urine output goal",
  "urine output target",
];

const RHABDOMYOLYSIS_ELECTROLYTE_ECG_ACTION_TERMS = [
  "calcium",
  "ecg",
  "electrolyte",
  "hyperkalemia",
  "phosphate",
  "potassium",
];

const RHABDOMYOLYSIS_CAUSE_COMPLICATION_ACTION_TERMS = [
  "compartment",
  "crush",
  "dic",
  "offending agent",
  "remove stimulus",
  "stop statin",
  "trauma",
];

const RHABDOMYOLYSIS_VOLUME_RENAL_SAFETY_TERMS = [
  "aki",
  "fluid overload",
  "renal",
  "volume overload",
];

const RHABDOMYOLYSIS_BICARB_MANNITOL_SAFETY_TERMS = [
  "alkalinization",
  "bicarbonate",
  "mannitol",
  "oliguria",
  "ph 7.5",
  "urine ph",
];

const RHABDOMYOLYSIS_DIALYSIS_SAFETY_TERMS = [
  "anuric",
  "dialysis",
  "hemodialysis",
  "refractory hyperkalemia",
  "severe acidosis",
  "uremia",
];

const RHABDOMYOLYSIS_CALCIUM_ELECTROLYTE_SAFETY_TERMS = [
  "calcium caution",
  "hypercalcemia",
  "hyperkalemia",
  "hypocalcemia",
  "potassium",
];

const RHABDOMYOLYSIS_COMPARTMENT_DIC_SAFETY_TERMS = [
  "compartment syndrome",
  "dic",
  "fasciotomy",
  "neurovascular",
  "platelet",
  "pt",
];

const HYPERCALCEMIA_CONTEXT_TERMS = [
  "calcium 14",
  "calcium >14",
  "ca 14",
  "ca >14",
  "corrected calcium",
  "hypercalcemic crisis",
  "hypercalcemia",
  "hypercalcaemia",
  "ionized calcium",
  "malignancy-associated hypercalcemia",
  "severe hypercalcemia",
  "symptomatic hypercalcemia",
  "고칼슘혈증",
];

const HYPERCALCEMIA_SEVERE_RISK_TERMS = [
  "aki",
  "arrhythmia",
  "coma",
  "confusion",
  "dehydration",
  "delirium",
  "kidney injury",
  "qt shortening",
  "renal failure",
  "stupor",
];

const HYPERCALCEMIA_CALCIUM_CONFIRMATION_ACTION_TERMS = [
  "albumin",
  "corrected calcium",
  "ionized calcium",
  "repeat calcium",
  "serum calcium",
];

const HYPERCALCEMIA_ECG_RENAL_ACTION_TERMS = [
  "bun",
  "creatinine",
  "ecg",
  "ekg",
  "kidney",
  "renal",
  "short qt",
];

const HYPERCALCEMIA_SALINE_ACTION_TERMS = [
  "0.9% saline",
  "fluid",
  "hydration",
  "isotonic saline",
  "normal saline",
  "saline",
];

const HYPERCALCEMIA_CALCITONIN_ACTION_TERMS = [
  "calcitonin",
];

const HYPERCALCEMIA_ANTIRESORPTIVE_ACTION_TERMS = [
  "bisphosphonate",
  "denosumab",
  "pamidronate",
  "zoledronic",
  "zoledronate",
];

const HYPERCALCEMIA_CAUSE_DIALYSIS_ACTION_TERMS = [
  "dialysis",
  "malignancy",
  "pth",
  "pthrp",
  "vitamin d",
];

const HYPERCALCEMIA_FLUID_SAFETY_TERMS = [
  "cardiac",
  "heart failure",
  "renal",
  "volume overload",
];

const HYPERCALCEMIA_LOOP_DIURETIC_SAFETY_TERMS = [
  "after rehydration",
  "avoid volume depletion",
  "furosemide",
  "loop diuretic",
  "urine output",
];

const HYPERCALCEMIA_RENAL_ANTIRESORPTIVE_SAFETY_TERMS = [
  "denosumab",
  "hypocalcemia",
  "renal impairment",
  "severe renal",
  "vitamin d",
];

const HYPERCALCEMIA_OFFENDING_AGENT_SAFETY_TERMS = [
  "calcium supplement",
  "lithium",
  "thiazide",
  "vitamin a",
  "vitamin d",
];

const HYPERCALCEMIA_REFRACTORY_DIALYSIS_SAFETY_TERMS = [
  "dialysis",
  "hemodialysis",
  "refractory",
  "renal insufficiency",
  "renal failure",
];

const HYPOCALCEMIA_CONTEXT_TERMS = [
  "acute hypocalcemia",
  "calcium 6",
  "ca 6",
  "corrected calcium 6",
  "hypocalcaemia",
  "hypocalcemia",
  "hypocalcemic crisis",
  "hypocalcemic tetany",
  "ionized calcium 0.",
  "low calcium",
  "post-thyroidectomy hypocalcemia",
  "severe hypocalcemia",
  "symptomatic hypocalcemia",
  "저칼슘혈증",
];

const HYPOCALCEMIA_SEVERE_RISK_TERMS = [
  "arrhythmia",
  "carpopedal spasm",
  "chvostek",
  "laryngospasm",
  "paresthesia",
  "prolonged qt",
  "qt prolongation",
  "seizure",
  "tetany",
  "trousseau",
];

const HYPOCALCEMIA_CALCIUM_CONFIRMATION_ACTION_TERMS = [
  "albumin",
  "corrected calcium",
  "ionized calcium",
  "repeat calcium",
  "serum calcium",
];

const HYPOCALCEMIA_ECG_MONITOR_ACTION_TERMS = [
  "cardiac monitor",
  "ecg",
  "ekg",
  "prolonged qt",
  "qt",
  "telemetry",
];

const HYPOCALCEMIA_IV_CALCIUM_ACTION_TERMS = [
  "calcium chloride",
  "calcium gluconate",
  "iv calcium",
  "intravenous calcium",
];

const HYPOCALCEMIA_INFUSION_MONITOR_ACTION_TERMS = [
  "calcium infusion",
  "continuous infusion",
  "drip",
  "repeat bolus",
  "serial ionized",
];

const HYPOCALCEMIA_MAGNESIUM_CAUSE_ACTION_TERMS = [
  "alkaline phosphatase",
  "magnesium",
  "phosphate",
  "pth",
  "renal",
  "vitamin d",
];

const HYPOCALCEMIA_DIGOXIN_ECG_SAFETY_TERMS = [
  "continuous ecg",
  "digoxin",
  "hypokalemia",
  "slowly",
  "slow infusion",
];

const HYPOCALCEMIA_EXTRAVASATION_SAFETY_TERMS = [
  "calcium chloride",
  "central line",
  "extravasation",
  "local irritation",
  "soft tissue",
];

const HYPOCALCEMIA_PHOSPHATE_PRODUCT_SAFETY_TERMS = [
  "calcium-phosphate",
  "ca x phosphate",
  "hyperphosphatemia",
  "phosphate",
  "soft tissue calcification",
];

const HYPOCALCEMIA_MAGNESIUM_REPLETION_SAFETY_TERMS = [
  "hypomagnesemia",
  "magnesium repletion",
  "magnesium sulfate",
  "pth resistance",
  "replete magnesium",
];

const HYPOCALCEMIA_TRANSITION_SAFETY_TERMS = [
  "calcitriol",
  "oral calcium",
  "vitamin d",
  "transition",
];

const TUMOR_LYSIS_CONTEXT_TERMS = [
  "burkitt",
  "high-grade lymphoma",
  "leukemia induction",
  "tumor lysis",
  "tumor lysis syndrome",
  "tumour lysis",
  "tumour lysis syndrome",
  "tls",
  "venetoclax",
  "종양용해",
];

const TUMOR_LYSIS_RISK_TERMS = [
  "aki",
  "all",
  "aml",
  "acute leukemia",
  "arrhythmia",
  "bulky disease",
  "hyperkalemia",
  "hyperphosphatemia",
  "hyperuricemia",
  "hypocalcemia",
  "ldh",
  "oliguria",
  "seizure",
  "uric acid",
];

const TUMOR_LYSIS_LAB_MONITOR_ACTION_TERMS = [
  "calcium",
  "creatinine",
  "electrolyte",
  "phosphate",
  "potassium",
  "q4",
  "q6",
  "uric acid",
];

const TUMOR_LYSIS_HYDRATION_ACTION_TERMS = [
  "aggressive hydration",
  "crystalloid",
  "fluid",
  "hydration",
  "iv fluids",
  "urine output",
];

const TUMOR_LYSIS_URATE_ACTION_TERMS = [
  "allopurinol",
  "febuxostat",
  "hypouricemic",
  "rasburicase",
  "urate",
  "uric acid lowering",
];

const TUMOR_LYSIS_ECG_ELECTROLYTE_ACTION_TERMS = [
  "calcium gluconate",
  "ecg",
  "hyperkalemia",
  "hyperphosphatemia",
  "insulin",
  "phosphate binder",
  "telemetry",
];

const TUMOR_LYSIS_RENAL_ESCALATION_ACTION_TERMS = [
  "crrt",
  "dialysis",
  "hemodialysis",
  "nephrology",
  "renal replacement",
];

const TUMOR_LYSIS_RASBURICASE_G6PD_SAFETY_TERMS = [
  "g6pd",
  "glucose-6-phosphate",
  "glucose 6 phosphate",
];

const TUMOR_LYSIS_RASBURICASE_ADVERSE_SAFETY_TERMS = [
  "hemolytic",
  "hemolysis",
  "methemoglobinemia",
  "methemoglobin",
];

const TUMOR_LYSIS_ALKALINIZATION_SAFETY_TERMS = [
  "avoid alkalinization",
  "avoid bicarbonate",
  "calcium phosphate",
  "sodium bicarbonate",
  "urine alkalinization",
];

const TUMOR_LYSIS_FLUID_SAFETY_TERMS = [
  "cardiac",
  "fluid overload",
  "heart failure",
  "hypovolemia",
  "obstructive uropathy",
  "renal",
];

const TUMOR_LYSIS_ALLOPURINOL_SAFETY_TERMS = [
  "allopurinol",
  "azathioprine",
  "hla-b*58:01",
  "renal adjustment",
  "xanthine",
];

const TUMOR_LYSIS_CALCIUM_PHOSPHATE_SAFETY_TERMS = [
  "calcium phosphate",
  "calcium-phosphate",
  "hyperphosphatemia",
  "symptomatic hypocalcemia",
];

const TUMOR_LYSIS_DIALYSIS_SAFETY_TERMS = [
  "anuria",
  "crrt",
  "dialysis",
  "fluid overload",
  "persistent hyperkalemia",
  "renal replacement",
];

const HYPERKALEMIA_CONTEXT_TERMS = [
  "ecg changes from hyperkalemia",
  "hyperkalemic emergency",
  "hyperkalemic urgency",
  "k 6.5",
  "k 7",
  "k+ 6.5",
  "k+ 7",
  "peaked t waves",
  "severe hyperkalemia",
  "sine wave",
  "wide qrs",
  "고칼륨혈증",
  "넓은 qrs",
  "뾰족 t파",
];

const HYPERKALEMIA_CALCIUM_ACTION_TERMS = [
  "10% calcium",
  "calcium chloride",
  "calcium gluconate",
  "iv calcium",
  "칼슘",
];

const HYPERKALEMIA_INSULIN_SHIFT_ACTION_TERMS = [
  "insulin",
  "인슐린",
];

const HYPERKALEMIA_GLUCOSE_COTHERAPY_ACTION_TERMS = [
  "d10",
  "d50",
  "dextrose",
  "glucose",
  "포도당",
];

const HYPERKALEMIA_REMOVAL_ACTION_TERMS = [
  "dialysis",
  "diuretic",
  "furosemide",
  "hemodialysis",
  "potassium binder",
  "sodium zirconium",
  "칼륨 제거",
  "투석",
];

const HYPERKALEMIA_ECG_MONITORING_SAFETY_TERMS = [
  "arrhythmia",
  "cardiac monitor",
  "ecg",
  "repeat potassium",
  "telemetry",
  "심전도",
  "재검",
];

const HYPERKALEMIA_GLUCOSE_SAFETY_TERMS = [
  "blood glucose",
  "dextrose",
  "glucose",
  "hypoglycemia",
  "포도당",
  "저혈당",
  "혈당",
];

const HYPERKALEMIA_RECURRENCE_SAFETY_TERMS = [
  "ace inhibitor",
  "arb",
  "dialysis",
  "kidney",
  "medication review",
  "potassium supplement",
  "renal",
  "spironolactone",
  "신장",
  "투석",
];

const STATUS_EPILEPTICUS_CONTEXT_TERMS = [
  "convulsive status epilepticus",
  "continuous seizure",
  "ongoing seizure",
  "prolonged seizure",
  "refractory status epilepticus",
  "status epilepticus",
  "status seizure",
  "발작지속",
  "지속 발작",
];

const STATUS_EPILEPTICUS_AIRWAY_ACTION_TERMS = [
  "airway",
  "breathing",
  "intubation",
  "oxygen",
  "suction",
  "기도",
  "산소",
  "삽관",
];

const STATUS_EPILEPTICUS_BENZO_ACTION_TERMS = [
  "benzodiazepine",
  "diazepam",
  "lorazepam",
  "midazolam",
  "벤조디아제핀",
  "로라제팜",
  "미다졸람",
];

const STATUS_EPILEPTICUS_SECOND_LINE_PATHWAY_ACTION_TERMS = [
  "antiseizure loading",
  "anti-seizure loading",
  "antiepileptic loading",
  "anti-epileptic loading",
  "load antiseizure",
  "load anti-seizure",
  "load antiepileptic",
  "load anti-epileptic",
  "fosphenytoin",
  "levetiracetam",
  "loading dose",
  "second-line",
  "항경련제",
];

const STATUS_EPILEPTICUS_SECOND_LINE_MEDICATION_ACTION_TERMS = [
  "fosphenytoin",
  "levetiracetam",
  "phenobarbital",
  "phenytoin",
  "valproic acid",
  "valproate sodium",
  "valproate",
];

const STATUS_EPILEPTICUS_REFRACTORY_ACTION_TERMS = [
  "anesthetic infusion",
  "continuous eeg",
  "icu",
  "neurology",
  "propofol",
  "refractory",
  "midazolam infusion",
  "뇌파",
  "중환자",
];

const STATUS_EPILEPTICUS_GLUCOSE_SAFETY_TERMS = [
  "bedside glucose",
  "blood glucose",
  "dextrose",
  "glucose",
  "hypoglycemia",
  "저혈당",
  "혈당",
];

const STATUS_EPILEPTICUS_RESPIRATORY_SAFETY_TERMS = [
  "airway",
  "aspiration",
  "oxygen saturation",
  "respiratory depression",
  "ventilation",
  "기도",
  "호흡억제",
];

const STATUS_EPILEPTICUS_ASM_SAFETY_TERMS = [
  "dose",
  "dosing",
  "ecg",
  "hepatic",
  "hypotension",
  "liver",
  "pregnancy",
  "renal",
  "valproate",
  "weight",
  "간기능",
  "신장",
  "용량",
  "임신",
  "체중",
];

const SEVERE_ALCOHOL_WITHDRAWAL_CONTEXT_TERMS = [
  "alcohol withdrawal",
  "alcohol withdrawal seizure",
  "benzodiazepine-resistant alcohol withdrawal",
  "delirium tremens",
  "refractory alcohol withdrawal",
  "severe alcohol withdrawal",
  "withdrawal delirium",
  "금단 섬망",
  "알코올 금단",
];

const SEVERE_ALCOHOL_WITHDRAWAL_RISK_TERMS = [
  "agitation",
  "autonomic instability",
  "confusion",
  "delirium",
  "diaphoresis",
  "fever",
  "hallucination",
  "hypertension",
  "prior delirium tremens",
  "prior withdrawal seizure",
  "seizure",
  "tachycardia",
  "tremor",
];

const SEVERE_ALCOHOL_WITHDRAWAL_ASSESSMENT_ACTION_TERMS = [
  "ciwa",
  "last drink",
  "rass",
  "severity",
  "telemetry",
  "vital signs",
  "withdrawal history",
];

const SEVERE_ALCOHOL_WITHDRAWAL_BENZO_ACTION_TERMS = [
  "benzodiazepine",
  "chlordiazepoxide",
  "diazepam",
  "lorazepam",
  "midazolam",
  "벤조디아제핀",
  "로라제팜",
];

const SEVERE_ALCOHOL_WITHDRAWAL_THIAMINE_ACTION_TERMS = [
  "thiamine",
  "티아민",
];

const SEVERE_ALCOHOL_WITHDRAWAL_ELECTROLYTE_ACTION_TERMS = [
  "electrolyte",
  "hypokalemia",
  "hypomagnesemia",
  "hypophosphatemia",
  "magnesium",
  "phosphate",
  "potassium",
  "마그네슘",
  "전해질",
];

const SEVERE_ALCOHOL_WITHDRAWAL_ESCALATION_ACTION_TERMS = [
  "airway",
  "continuous infusion",
  "dexmedetomidine",
  "icu",
  "intubation",
  "phenobarbital",
  "propofol",
  "refractory",
  "중환자",
];

const SEVERE_ALCOHOL_WITHDRAWAL_RESPIRATORY_SEDATION_SAFETY_TERMS = [
  "airway",
  "aspiration",
  "intubation",
  "oversedation",
  "pulse oximetry",
  "rass",
  "respiratory depression",
  "호흡억제",
];

const SEVERE_ALCOHOL_WITHDRAWAL_DIFFERENTIAL_SAFETY_TERMS = [
  "co-ingestion",
  "coingestion",
  "head trauma",
  "hypoglycemia",
  "hyponatremia",
  "intracranial hemorrhage",
  "meningitis",
  "sepsis",
  "toxic alcohol",
  "감별",
];

const SEVERE_ALCOHOL_WITHDRAWAL_HEPATIC_MED_SAFETY_TERMS = [
  "chlordiazepoxide",
  "cirrhosis",
  "drug interaction",
  "hepatic",
  "liver disease",
  "lorazepam",
  "oxazepam",
  "phenobarbital",
  "간질환",
];

const SEVERE_ALCOHOL_WITHDRAWAL_DISPOSITION_SAFETY_TERMS = [
  "admission",
  "delirium tremens",
  "icu",
  "prior delirium tremens",
  "refractory",
  "unstable vital",
  "withdrawal seizure",
  "입원",
  "중환자",
];

const ADRENAL_CRISIS_CONTEXT_TERMS = [
  "acute adrenal insufficiency",
  "addisonian crisis",
  "adrenal crisis",
  "adrenal insufficiency with hypotension",
  "adrenal insufficiency with shock",
  "steroid-dependent with shock",
  "부신 위기",
  "부신기능부전",
];

const ADRENAL_CRISIS_STEROID_ACTION_TERMS = [
  "100 mg hydrocortisone",
  "hydrocortisone 100 mg",
  "hydrocortisone im",
  "hydrocortisone iv",
  "hydrocortisone sodium succinate",
  "hydrocortisone stress dose",
  "im hydrocortisone",
  "intramuscular hydrocortisone",
  "intravenous hydrocortisone",
  "iv hydrocortisone",
  "parenteral hydrocortisone",
  "parenteral steroid",
  "solu-cortef",
  "stress dose hydrocortisone",
  "stress dose steroid",
  "stress-dose hydrocortisone",
  "stress-dose steroid",
  "iv 하이드로코르티손",
  "im 하이드로코르티손",
  "근육 하이드로코르티손",
  "정맥 하이드로코르티손",
  "스트레스 용량 하이드로코르티손",
  "하이드로코르티손 근육",
  "하이드로코르티손 정맥",
];

const ADRENAL_CRISIS_FLUID_GLUCOSE_ACTION_TERMS = [
  "0.9% saline",
  "dextrose",
  "fluid resuscitation",
  "glucose",
  "isotonic saline",
  "normal saline",
  "saline",
  "수액",
  "생리식염수",
  "포도당",
];

const ADRENAL_CRISIS_MONITORING_ACTION_TERMS = [
  "blood pressure",
  "electrolyte",
  "glucose",
  "hemodynamic",
  "hypoglycemia",
  "potassium",
  "sodium",
  "shock",
  "전해질",
  "혈당",
  "혈압",
];

const ADRENAL_CRISIS_DO_NOT_DELAY_SAFETY_TERMS = [
  "before cortisol",
  "cortisol",
  "do not delay",
  "draw cortisol",
  "immediate hydrocortisone",
  "not delay",
  "지연",
  "코르티솔",
];

const ADRENAL_CRISIS_MONITORING_SAFETY_TERMS = [
  "blood pressure",
  "electrolyte",
  "glucose",
  "hypoglycemia",
  "hyponatremia",
  "potassium",
  "sodium",
  "혈당",
  "혈압",
  "전해질",
];

const ADRENAL_CRISIS_PRECIPITANT_SAFETY_TERMS = [
  "infection",
  "missed steroid",
  "precipitant",
  "sepsis",
  "steroid withdrawal",
  "stress dosing",
  "trigger",
  "감염",
  "유발",
  "중단",
];

const BUTTON_BATTERY_CONTEXT_TERMS = [
  "battery ingestion",
  "button battery",
  "button-battery",
  "button cell",
  "button-cell",
  "coin cell",
  "coin-cell",
  "disc battery",
  "disk battery",
  "double-rim",
  "foreign body ingestion with halo",
  "halo effect",
  "lithium coin cell",
  "step-off",
  "버튼 배터리",
];

const BUTTON_BATTERY_XRAY_ACTION_TERMS = [
  "abdomen",
  "ap and lateral",
  "double-rim",
  "esophagus",
  "halo",
  "lateral view",
  "neck",
  "radiograph",
  "step-off",
  "x-ray",
  "xray",
];

const BUTTON_BATTERY_POISON_NPO_ACTION_TERMS = [
  "800-498-8666",
  "battery hotline",
  "do not induce vomiting",
  "nothing by mouth",
  "npo",
  "poison center",
  "poison control",
];

const BUTTON_BATTERY_HONEY_SUCRALFATE_ACTION_TERMS = [
  "10 ml",
  "carafate",
  "every 10 minutes",
  "honey",
  "q10",
  "sucralfate",
];

const BUTTON_BATTERY_REMOVAL_ACTION_TERMS = [
  "battery removal",
  "endoscopic removal",
  "endoscopy",
  "ent",
  "esophageal battery",
  "gastroenterology",
  "gi",
  "immediate removal",
  "remove battery",
  "surgery",
  "urgent removal",
];

const BUTTON_BATTERY_NO_DELAY_SAFETY_TERMS = [
  "2 hours",
  "do not delay",
  "eaten recently",
  "not delay",
  "not substitute",
  "recent eating",
  "sedation",
];

const BUTTON_BATTERY_ESOPHAGEAL_INJURY_SAFETY_TERMS = [
  "aorta",
  "exsanguination",
  "fistula",
  "large vessel",
  "mediastinitis",
  "mucosal injury",
  "perforation",
  "sentinel bleed",
  "stricture",
  "tracheoesophageal fistula",
  "vocal cord paralysis",
];

const BUTTON_BATTERY_LOCATION_DISPOSITION_SAFETY_TERMS = [
  "10-14 days",
  "15 mm",
  "20 mm",
  "admit",
  "beyond esophagus",
  "large button battery",
  "magnet",
  "observe",
  "passage",
  "repeat radiograph",
  "stomach",
  "stool",
];

const BUTTON_BATTERY_AVOIDANCE_SAFETY_TERMS = [
  "avoid blind removal",
  "avoid ipecac",
  "balloon catheter",
  "chelation",
  "do not induce vomiting",
  "induced vomiting",
  "laxative",
  "magnet",
  "mercury testing",
  "polyethylene glycol",
];

const ACETAMINOPHEN_TOXICITY_CONTEXT_TERMS = [
  "acetaminophen overdose",
  "acetaminophen poisoning",
  "acetaminophen toxicity",
  "apap overdose",
  "apap poisoning",
  "paracetamol overdose",
  "paracetamol poisoning",
  "tylenol overdose",
  "아세트아미노펜",
];

const ACETAMINOPHEN_LEVEL_NOMOGRAM_ACTION_TERMS = [
  "4 hour",
  "4-hour",
  "acetaminophen concentration",
  "acetaminophen level",
  "apap level",
  "nomogram",
  "paracetamol concentration",
  "paracetamol level",
  "rumack",
];

const ACETAMINOPHEN_NAC_ACTION_TERMS = [
  "acetylcysteine",
  "n-acetylcysteine",
  "nac",
  "엔아세틸시스테인",
];

const ACETAMINOPHEN_HEPATIC_TOX_ACTION_TERMS = [
  "alt",
  "ast",
  "bilirubin",
  "hepatic function",
  "inr",
  "lft",
  "liver function",
  "prothrombin",
  "pt",
  "transaminase",
  "간기능",
  "간 효소",
];

const ACETAMINOPHEN_TIMING_FORMULATION_SAFETY_TERMS = [
  "co-ingestion",
  "coingestion",
  "extended release",
  "extended-release",
  "repeated supratherapeutic",
  "staggered",
  "time of ingestion",
  "unknown time",
  "복용 시간",
  "서방",
];

const ACETAMINOPHEN_NAC_SAFETY_TERMS = [
  "anaphylactoid",
  "dose",
  "dosing",
  "infusion",
  "weight",
  "용량",
  "체중",
];

const ACETAMINOPHEN_HEPATIC_FAILURE_SAFETY_TERMS = [
  "acidosis",
  "alt",
  "ast",
  "encephalopathy",
  "hepatic failure",
  "hypoglycemia",
  "inr",
  "liver failure",
  "transplant",
  "간부전",
  "저혈당",
];

const VALPROATE_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "divalproex overdose",
  "valproate intoxication",
  "valproate overdose",
  "valproate poisoning",
  "valproate toxicity",
  "valproic acid overdose",
  "valproic acid poisoning",
  "valproic acid toxicity",
  "발프로산 중독",
];

const VALPROATE_TOXICITY_DRUG_CONTEXT_TERMS = [
  "depakote",
  "divalproex",
  "sodium valproate",
  "valproate",
  "valproic acid",
  "발프로산",
];

const VALPROATE_TOXICITY_RISK_CONTEXT_TERMS = [
  "cerebral edema",
  "coma",
  "encephalopathy",
  "hepatic injury",
  "hyperammonemia",
  "metabolic acidosis",
  "overdose",
  "respiratory depression",
  "seizure",
  "somnolence",
];

const VALPROATE_TOXICITY_LEVEL_ACTION_TERMS = [
  "repeat valproate",
  "serial valproate",
  "serum valproate",
  "total valproate",
  "valproate concentration",
];

const VALPROATE_TOXICITY_AMMONIA_FREE_ACTION_TERMS = [
  "ammonia",
  "free valproate",
  "unbound valproate",
];

const VALPROATE_TOXICITY_ORGAN_LAB_ACTION_TERMS = [
  "acetaminophen",
  "cbc",
  "co-ingestant",
  "coingestant",
  "cmp",
  "electrolyte",
  "glucose",
  "lft",
  "liver function",
  "pregnancy",
  "salicylate",
];

const VALPROATE_TOXICITY_STABILIZATION_ACTION_TERMS = [
  "airway",
  "benzodiazepine",
  "breathing",
  "circulation",
  "intubation",
  "iv fluids",
  "mechanical ventilation",
  "vasopressor",
];

const VALPROATE_TOXICITY_DECONTAMINATION_ACTION_TERMS = [
  "activated charcoal",
  "charcoal",
  "enteric-coated",
  "extended-release",
  "gastric lavage",
  "lavage",
];

const VALPROATE_TOXICITY_CARNITINE_ACTION_TERMS = [
  "carnitine",
  "l-carnitine",
  "levocarnitine",
];

const VALPROATE_TOXICITY_TOXICOLOGY_ESCALATION_ACTION_TERMS = [
  "poison center",
  "poison control",
  "toxicologist",
];

const VALPROATE_TOXICITY_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "ectr",
  "extracorporeal removal",
  "extracorporeal treatment",
  "haemodialysis",
  "hemodialysis",
];

const VALPROATE_TOXICITY_DIALYSIS_INDICATION_SAFETY_TERMS = [
  "1300",
  "cerebral edema",
  "dialysis indication",
  "ectr",
  "hemodialysis indication",
  "ph < 7.10",
  "severe acidosis",
  "shock",
  "valproate concentration",
];

const VALPROATE_TOXICITY_CARNITINE_AMMONIA_SAFETY_TERMS = [
  "100 mg/kg",
  "50 mg/kg",
  "ammonia",
  "carnitine",
  "l-carnitine",
  "levocarnitine",
];

const VALPROATE_TOXICITY_FREE_LEVEL_SAFETY_TERMS = [
  "free level",
  "hypoalbuminemia",
  "low albumin",
  "normal total",
  "protein binding",
  "unbound level",
];

const VALPROATE_TOXICITY_FORMULATION_AIRWAY_SAFETY_TERMS = [
  "airway",
  "charcoal",
  "enteric-coated",
  "extended-release",
  "swallow",
  "within 2 hours",
];

const VALPROATE_TOXICITY_COMPLICATION_REPRODUCTIVE_SAFETY_TERMS = [
  "cerebral edema",
  "hepatotoxicity",
  "pancreatitis",
  "pregnancy",
  "teratogen",
  "thrombocytopenia",
];

const THEOPHYLLINE_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "aminophylline overdose",
  "aminophylline poisoning",
  "methylxanthine poisoning",
  "methylxanthine toxicity",
  "theophylline overdose",
  "theophylline poisoning",
  "theophylline toxicity",
  "테오필린 중독",
];

const THEOPHYLLINE_TOXICITY_DRUG_CONTEXT_TERMS = [
  "aminophylline",
  "methylxanthine",
  "theobromine",
  "theophylline",
  "테오필린",
];

const THEOPHYLLINE_TOXICITY_RISK_CONTEXT_TERMS = [
  "arrhythmia",
  "dysrhythmia",
  "hyperglycemia",
  "hypokalemia",
  "overdose",
  "seizure",
  "tachyarrhythmia",
  "tachycardia",
  "toxic level",
  "vomiting",
];

const THEOPHYLLINE_TOXICITY_SERUM_LEVEL_ACTION_TERMS = [
  "serum theophylline",
  "theophylline level",
  "theophylline serum",
];

const THEOPHYLLINE_TOXICITY_ECG_ACTION_TERMS = [
  "cardiac monitoring",
  "ecg",
  "ekg",
];

const THEOPHYLLINE_TOXICITY_METABOLIC_LAB_ACTION_TERMS = [
  "calcium",
  "cmp",
  "electrolyte",
  "glucose",
  "hyperglycemia",
  "hypokalemia",
  "metabolic acidosis",
  "potassium",
];

const THEOPHYLLINE_TOXICITY_COIN_ORGAN_LAB_ACTION_TERMS = [
  "acetaminophen",
  "ck",
  "creatine kinase",
  "iron",
  "lft",
  "salicylate",
];

const THEOPHYLLINE_TOXICITY_ABC_HEMODYNAMIC_ACTION_TERMS = [
  "airway",
  "breathing",
  "circulation",
  "hemodynamic monitoring",
  "intubation",
  "iv fluids",
  "norepinephrine",
  "phenylephrine",
  "vasopressor",
];

const THEOPHYLLINE_TOXICITY_DECONTAMINATION_ACTION_TERMS = [
  "activated charcoal",
  "charcoal",
  "mdac",
  "multiple-dose activated charcoal",
  "multidose charcoal",
  "nasogastric",
];

const THEOPHYLLINE_TOXICITY_SEIZURE_ACTION_TERMS = [
  "benzodiazepine",
  "diazepam",
  "lorazepam",
  "midazolam",
  "phenobarbital",
  "propofol",
  "seizure",
];

const THEOPHYLLINE_TOXICITY_TOXICOLOGY_ESCALATION_ACTION_TERMS = [
  "poison center",
  "poison control",
  "toxicologist",
];

const THEOPHYLLINE_TOXICITY_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "ectr",
  "extracorporeal removal",
  "extracorporeal treatment",
  "haemodialysis",
  "hemodialysis",
  "hemoperfusion",
];

const THEOPHYLLINE_TOXICITY_DIALYSIS_INDICATION_SAFETY_TERMS = [
  "acute exposure",
  "chronic exposure",
  "clinical deterioration",
  "ectr",
  "greater than 100",
  "greater than 50",
  "greater than 60",
  "rising level",
  "seizure",
  "shock",
  "theophylline level",
];

const THEOPHYLLINE_TOXICITY_ARRHYTHMIA_SHOCK_SAFETY_TERMS = [
  "acls",
  "arrhythmia",
  "beta antagonist",
  "dysrhythmia",
  "life-threatening dysrhythmia",
  "norepinephrine",
  "phenylephrine",
  "toxicologist",
];

const THEOPHYLLINE_TOXICITY_ELECTROLYTE_METABOLIC_SAFETY_TERMS = [
  "ck",
  "hypercalcemia",
  "hyperglycemia",
  "hypokalemia",
  "metabolic acidosis",
  "potassium",
  "rhabdomyolysis",
];

const THEOPHYLLINE_TOXICITY_DECON_ECTR_SAFETY_TERMS = [
  "airway",
  "contraindication",
  "emesis not recommended",
  "gastric lavage not recommended",
  "mdac",
  "multiple-dose activated charcoal",
  "during ectr",
  "whole bowel irrigation",
];

const THEOPHYLLINE_TOXICITY_INTERACTION_CHRONIC_SAFETY_TERMS = [
  "cimetidine",
  "ciprofloxacin",
  "clearance",
  "chf",
  "cirrhosis",
  "erythromycin",
  "fluoroquinolone",
  "smoking",
  "viral illness",
];

const TOXIC_ALCOHOL_CONTEXT_TERMS = [
  "antifreeze ingestion",
  "ethylene glycol",
  "methanol",
  "toxic alcohol",
  "washer fluid ingestion",
  "windshield washer fluid",
  "부동액",
  "메탄올",
];

const TOXIC_ALCOHOL_OSMOL_GAP_ACTION_TERMS = [
  "measured serum osmolality",
  "osmol gap",
  "osmolal gap",
  "osmolar gap",
  "serum osmolality",
];

const TOXIC_ALCOHOL_LEVEL_ACTION_TERMS = [
  "ethylene glycol concentration",
  "ethylene glycol level",
  "methanol concentration",
  "methanol level",
  "toxic alcohol concentration",
  "toxic alcohol level",
];

const TOXIC_ALCOHOL_ANION_GAP_ACTION_TERMS = [
  "anion gap",
  "음이온차",
];

const TOXIC_ALCOHOL_ANTIDOTE_ACTION_TERMS = [
  "adh blockade",
  "adh inhibitor",
  "alcohol dehydrogenase blockade",
  "alcohol dehydrogenase inhibitor",
  "ethanol antidote",
  "ethanol blockade",
  "fomepizole",
  "포메피졸",
];

const TOXIC_ALCOHOL_TOXICOLOGY_ESCALATION_ACTION_TERMS = [
  "poison center",
  "poison control",
  "toxicologist",
];

const TOXIC_ALCOHOL_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "ectr",
  "extracorporeal removal",
  "extracorporeal treatment",
  "haemodialysis",
  "hemodialysis",
  "혈액투석",
];

const TOXIC_ALCOHOL_ACIDOSIS_SUPPORT_ACTION_TERMS = [
  "acidosis",
  "bicarbonate",
  "blood gas",
  "ph",
  "sodium bicarbonate",
  "중탄산",
  "산증",
];

const TOXIC_ALCOHOL_DIALYSIS_INDICATION_SAFETY_TERMS = [
  "anion gap",
  "coma",
  "dialysis indication",
  "hemodialysis indication",
  "kidney failure",
  "renal failure",
  "seizure",
  "severe acidosis",
  "visual",
  "투석",
  "시력",
];

const TOXIC_ALCOHOL_ORGAN_INJURY_SAFETY_TERMS = [
  "calcium oxalate",
  "hypocalcemia",
  "kidney",
  "optic",
  "renal",
  "urine",
  "vision",
  "visual",
  "신장",
  "시력",
];

const TOXIC_ALCOHOL_COINGESTION_DIFFERENTIAL_SAFETY_TERMS = [
  "alcoholic ketoacidosis",
  "co-ingestion",
  "coingestion",
  "diabetic ketoacidosis",
  "ethanol",
  "isopropanol",
  "lactic acidosis",
  "late presentation",
  "salicylate",
  "동반",
];

const TOXIC_ALCOHOL_EMPIRIC_ANTIDOTE_SAFETY_TERMS = [
  "awaiting confirmation",
  "do not wait",
  "do-not-wait",
  "empiric antidote",
  "empiric fomepizole",
  "high suspicion",
  "immediate fomepizole",
  "levels unavailable",
  "suspected ingestion",
];

const TOXIC_ALCOHOL_COFACTOR_SAFETY_TERMS = [
  "folate",
  "folic acid",
  "folinic acid",
  "pyridoxine",
  "thiamine",
  "vitamin b6",
];

const LITHIUM_TOXICITY_DIRECT_CONTEXT_TERMS = [
  "lithium intoxication",
  "lithium overdose",
  "lithium poisoning",
  "lithium toxicity",
  "리튬 중독",
];

const LITHIUM_TOXICITY_DRUG_CONTEXT_TERMS = [
  "lithium",
  "lithium carbonate",
  "lithium citrate",
  "리튬",
];

const LITHIUM_TOXICITY_RISK_CONTEXT_TERMS = [
  "aki",
  "ataxia",
  "confusion",
  "dehydration",
  "elevated lithium",
  "hyperreflexia",
  "lithium level",
  "renal failure",
  "seizure",
  "tremor",
];

const LITHIUM_TOXICITY_LEVEL_MONITORING_ACTION_TERMS = [
  "6 hours",
  "lithium concentration",
  "lithium level",
  "repeat level",
  "serial level",
  "serum lithium",
];

const LITHIUM_TOXICITY_RENAL_CARDIAC_ACTION_TERMS = [
  "bun",
  "cardiac monitoring",
  "creatinine",
  "ecg",
  "electrolyte",
  "renal function",
  "sodium",
  "urine output",
];

const LITHIUM_TOXICITY_VOLUME_STOP_ACTION_TERMS = [
  "dehydration",
  "hold lithium",
  "isotonic saline",
  "iv fluids",
  "normal saline",
  "stop lithium",
  "volume depletion",
];

const LITHIUM_TOXICITY_WBI_ACTION_TERMS = [
  "massive ingestion",
  "sustained release",
  "sustained-release",
  "whole bowel irrigation",
  "whole-bowel irrigation",
];

const LITHIUM_TOXICITY_CHARCOAL_LIMITATION_ACTION_TERMS = [
  "activated charcoal not effective",
  "charcoal ineffective",
  "charcoal not effective",
  "co-ingestant",
  "coingestant",
  "unknown co-ingestant",
];

const LITHIUM_TOXICITY_TOXICOLOGY_ESCALATION_ACTION_TERMS = [
  "poison center",
  "poison control",
  "toxicologist",
];

const LITHIUM_TOXICITY_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "ectr",
  "extracorporeal removal",
  "extracorporeal treatment",
  "haemodialysis",
  "hemodialysis",
];

const LITHIUM_TOXICITY_DIALYSIS_INDICATION_SAFETY_TERMS = [
  "36 hours",
  "confusion",
  "decreased level of consciousness",
  "dialysis indication",
  "dysrhythmia",
  "ectr",
  "impaired kidney",
  "kidney function",
  "level > 5",
  "li > 4",
  "renal failure",
  "seizure",
];

const LITHIUM_TOXICITY_REBOUND_CESSATION_SAFETY_TERMS = [
  "12 hours",
  "clinical improvement",
  "level < 1.0",
  "rebound",
  "repeat level",
  "serial level",
  "subsequent ectr",
];

const LITHIUM_TOXICITY_PRECIPITANT_SAFETY_TERMS = [
  "ace inhibitor",
  "arb",
  "dehydration",
  "diuretic",
  "low sodium",
  "nephrogenic diabetes insipidus",
  "nsaid",
  "renal insufficiency",
  "sodium depletion",
  "thiazide",
  "volume depletion",
];

const LITHIUM_TOXICITY_DISPOSITION_CLINICAL_SAFETY_TERMS = [
  "admit",
  "asymptomatic",
  "clinical status",
  "icu",
  "less than 1.5",
  "moderate",
  "severe",
  "signs do not conform",
  "symptomatic despite normal",
];

const SALICYLATE_TOXICITY_CONTEXT_TERMS = [
  "aspirin overdose",
  "aspirin poisoning",
  "aspirin toxicity",
  "methyl salicylate",
  "oil of wintergreen",
  "salicylate overdose",
  "salicylate poisoning",
  "salicylate toxicity",
  "살리실산",
  "아스피린",
];

const SALICYLATE_LEVEL_ACTION_TERMS = [
  "repeat level",
  "salicylate concentration",
  "salicylate level",
  "serial level",
  "살리실산 농도",
];

const SALICYLATE_ACID_BASE_ACTION_TERMS = [
  "abg",
  "anion gap",
  "blood gas",
  "electrolyte",
  "vbg",
];

const SALICYLATE_DECONTAMINATION_ACTION_TERMS = [
  "activated charcoal",
  "charcoal",
  "multidose charcoal",
  "multiple-dose charcoal",
  "활성탄",
];

const SALICYLATE_ALKALINIZATION_ACTION_TERMS = [
  "alkaline diuresis",
  "alkalinization",
  "bicarbonate",
  "potassium",
  "sodium bicarbonate",
  "urine ph",
  "urinary alkalinization",
  "중탄산",
];

const SALICYLATE_TOXICOLOGY_ESCALATION_ACTION_TERMS = [
  "poison center",
  "poison control",
  "toxicologist",
];

const SALICYLATE_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "ectr",
  "extracorporeal removal",
  "extracorporeal treatment",
  "haemodialysis",
  "hemodialysis",
  "혈액투석",
];

const SALICYLATE_DIALYSIS_INDICATION_SAFETY_TERMS = [
  "acidemia",
  "altered mental status",
  "high level",
  "kidney failure",
  "pulmonary edema",
  "renal failure",
  "seizure",
  "severe acidosis",
  "very high",
  "투석",
];

const SALICYLATE_INTUBATION_PH_SAFETY_TERMS = [
  "bicarbonate bolus",
  "hyperventilation",
  "intubation",
  "mechanical ventilation",
  "ph",
  "respiratory alkalosis",
  "ventilator",
  "삽관",
];

const SALICYLATE_ALKALINIZATION_TARGET_SAFETY_TERMS = [
  "serum ph",
  "urine output",
  "urine ph",
  "urine ph 7.5",
  "urine ph 7.5 to 8",
  "urinary ph",
  "urinary ph 7.5",
  "urinary ph 7.5 to 8",
];

const SALICYLATE_ELECTROLYTE_GLUCOSE_SAFETY_TERMS = [
  "cerebral edema",
  "glucose",
  "hypoglycemia",
  "hypokalemia",
  "potassium",
  "pulmonary edema",
  "temperature",
  "전해질",
  "칼륨",
  "혈당",
];

const CARBON_MONOXIDE_CONTEXT_TERMS = [
  "carbon monoxide poisoning",
  "carbon monoxide toxicity",
  "carboxyhemoglobin",
  "co poisoning",
  "generator exhaust",
  "smoke inhalation with headache",
  "일산화탄소",
];

const CARBON_MONOXIDE_REMOVAL_OXYGEN_ACTION_TERMS = [
  "100% oxygen",
  "high flow oxygen",
  "high-flow oxygen",
  "non-rebreather",
  "oxygen",
  "remove from source",
  "source removal",
  "산소",
];

const CARBON_MONOXIDE_COHB_DIAGNOSTIC_ACTION_TERMS = [
  "carboxyhemoglobin",
  "co-oximetry",
  "cohb",
  "venous blood gas",
  "vbg",
  "혈중 일산화탄소",
];

const CARBON_MONOXIDE_HYPERBARIC_ACTION_TERMS = [
  "hyperbaric",
  "hbo",
  "hbot",
  "poison center",
  "poison control",
  "toxicologist",
  "고압산소",
];

const CARBON_MONOXIDE_CARDIAC_NEURO_ACTION_TERMS = [
  "altered mental status",
  "cardiac",
  "ecg",
  "lactate",
  "neurologic",
  "seizure",
  "syncope",
  "troponin",
  "의식",
  "심전도",
];

const CARBON_MONOXIDE_PULSE_OX_SAFETY_TERMS = [
  "false normal",
  "falsely normal",
  "normal pulse ox",
  "normal pulse oximetry",
  "pulse ox",
  "pulse oximetry",
  "spo2",
  "산소포화도",
];

const CARBON_MONOXIDE_HBO_CRITERIA_SAFETY_TERMS = [
  "acidosis",
  "cardiac ischemia",
  "carboxyhemoglobin",
  "cohb",
  "hyperbaric",
  "loss of consciousness",
  "neurologic",
  "pregnancy",
  "syncope",
  "임신",
];

const CARBON_MONOXIDE_COHB_LIMITATION_SAFETY_TERMS = [
  "clinical symptoms",
  "cohb level limitation",
  "cohb levels do not correlate",
  "history of exposure",
  "not correlate",
  "room air for several hours",
  "time elapsed",
];

const CARBON_MONOXIDE_PREGNANCY_TEST_SAFETY_TERMS = [
  "childbearing age",
  "fetal",
  "pregnancy test",
  "pregnant women",
  "임신 검사",
  "태아",
];

const CARBON_MONOXIDE_COMPLICATION_SAFETY_TERMS = [
  "arrhythmia",
  "cardiac",
  "delayed neurologic",
  "ecg",
  "lactate",
  "metabolic acidosis",
  "myocardial",
  "neurocognitive",
  "troponin",
  "심근",
  "신경",
];

const CARBON_MONOXIDE_CYANIDE_SMOKE_SAFETY_TERMS = [
  "burn",
  "cyanide",
  "hydroxocobalamin",
  "lactate",
  "smoke inhalation",
  "화재",
  "시안화",
];

const CYANIDE_POISONING_CONTEXT_TERMS = [
  "acetonitrile",
  "cyanide poisoning",
  "cyanide toxicity",
  "hydrogen cyanide",
  "smoke inhalation with lactic acidosis",
  "smoke inhalation with shock",
  "시안화",
];

const CYANIDE_REMOVAL_OXYGEN_SUPPORT_ACTION_TERMS = [
  "100% oxygen",
  "circulatory support",
  "high-flow oxygen",
  "oxygen",
  "remove from source",
  "respiratory support",
  "source removal",
  "산소",
];

const CYANIDE_HYDROXOCOBALAMIN_ACTION_TERMS = [
  "cyanokit",
  "hydroxocobalamin",
  "하이드록소코발라민",
];

const CYANIDE_LACTATE_ACIDOSIS_ACTION_TERMS = [
  "abg",
  "anion gap",
  "blood gas",
  "lactate",
  "metabolic acidosis",
  "ph",
  "vbg",
  "젖산",
  "산증",
];

const CYANIDE_POISON_ESCALATION_ACTION_TERMS = [
  "burn center",
  "icu",
  "poison center",
  "poison control",
  "toxicologist",
  "중환자",
];

const CYANIDE_DO_NOT_WAIT_LEVEL_SAFETY_TERMS = [
  "cyanide level",
  "do not delay",
  "do not wait",
  "empiric",
  "not delay",
  "지연",
];

const CYANIDE_SMOKE_CO_NITRITE_SAFETY_TERMS = [
  "carbon monoxide",
  "co poisoning",
  "carboxyhemoglobin",
  "cohb",
  "nitrite",
  "smoke inhalation",
  "시안화",
  "일산화탄소",
];

const CYANIDE_SHOCK_NEURO_SAFETY_TERMS = [
  "altered mental status",
  "cardiac arrest",
  "coma",
  "hypotension",
  "seizure",
  "shock",
  "syncope",
  "의식",
  "쇼크",
];

const CYANIDE_LACTATE_TRIGGER_SAFETY_TERMS = [
  "enclosed-space fire",
  "lactate > 8",
  "lactate > 10",
  "lactate above 8",
  "lactate above 10",
  "severe lactic acidosis",
  "smoke inhalation with lactate",
];

const CYANIDE_HYDROXOCOBALAMIN_EFFECT_SAFETY_TERMS = [
  "blood pressure",
  "chromaturia",
  "dialysis",
  "hypertension",
  "lab interference",
  "red urine",
  "혈압",
];

const SNAKEBITE_CONTEXT_TERMS = [
  "copperhead",
  "cottonmouth",
  "elapid",
  "pit viper",
  "rattlesnake",
  "snake bite",
  "snake envenomation",
  "snakebite",
  "snakebite envenomation",
];

const SNAKEBITE_ENVENOMATION_RISK_TERMS = [
  "bleeding",
  "coagulopathy",
  "dyspnea",
  "ecchymosis",
  "hypotension",
  "necrosis",
  "paresthesias",
  "progressive swelling",
  "respiratory depression",
  "respiratory paralysis",
  "systemic symptoms",
  "thrombocytopenia",
];

const SNAKEBITE_FIELD_IMMOBILIZATION_ACTION_TERMS = [
  "heart level",
  "immobilize",
  "loosely",
  "rapid transport",
  "remove constricting",
  "remove rings",
  "remove watches",
];

const SNAKEBITE_SERIAL_EXAM_LAB_ACTION_TERMS = [
  "cbc",
  "circumference",
  "coagulation",
  "fibrinogen",
  "inr",
  "mark swelling",
  "platelet",
  "pt",
  "repeat exam",
  "serial",
];

const SNAKEBITE_ANTIVENOM_ACTION_TERMS = [
  "administer antivenin",
  "administer antivenom",
  "anavip",
  "antivenom infusion",
  "crofab",
  "crotalidae immune f(ab')2",
  "crotalidae polyvalent immune fab",
  "fab antivenom",
  "fab2 antivenom",
  "give antivenin",
  "give antivenom",
  "infuse antivenin",
  "infuse antivenom",
  "initiate antivenin",
  "initiate antivenom",
  "start antivenin",
  "start antivenom",
];

const SNAKEBITE_POISON_ESCALATION_ACTION_TERMS = [
  "consult",
  "icu",
  "poison center",
  "poison control",
  "toxicologist",
  "toxicology",
  "transfer",
];

const SNAKEBITE_RESPIRATORY_NEURO_ACTION_TERMS = [
  "airway",
  "neuro",
  "neurologic",
  "oxygen",
  "respiratory",
  "ventilation",
];

const SNAKEBITE_HARMFUL_FIRST_AID_SAFETY_TERMS = [
  "electric shock",
  "ice",
  "incision",
  "suction",
  "tourniquet",
];

const SNAKEBITE_OBSERVATION_DISPOSITION_SAFETY_TERMS = [
  "8 hours",
  "disposition",
  "longer",
  "observation",
  "serial monitoring",
];

const SNAKEBITE_COAGULOPATHY_SAFETY_TERMS = [
  "bleeding",
  "coagulopathy",
  "defibrination",
  "fibrinogen",
  "inr",
  "platelet",
  "pt",
];

const SNAKEBITE_ANTIVENOM_REACTION_SAFETY_TERMS = [
  "hypersensitivity",
  "premedication",
  "reaction",
  "serum sickness",
];

const SNAKEBITE_COMPARTMENT_FASCIOTOMY_SAFETY_TERMS = [
  "antivenom first",
  "compartment",
  "fasciotomy",
  "pressure",
  "surgical consult",
];

const MAJOR_BURN_CONTEXT_TERMS = [
  "burn injury",
  "chemical burn",
  "deep partial-thickness burn",
  "electrical burn",
  "flame burn",
  "full-thickness burn",
  "major burn",
  "partial-thickness burn",
  "scald burn",
  "thermal burn",
];

const MAJOR_BURN_SEVERITY_TERMS = [
  "10% tbsa",
  "20% tbsa",
  "carbonaceous sputum",
  "circumferential",
  "deep partial",
  "eschar",
  "full thickness",
  "full-thickness",
  "hypovolemic shock",
  "inhalation injury",
  "large burn",
  "perioral burns",
  "shock",
  "singed nasal hairs",
];

const MAJOR_BURN_AIRWAY_ACTION_TERMS = [
  "100% oxygen",
  "airway",
  "early intubation",
  "intubation",
  "smoke inhalation",
  "ventilation",
];

const MAJOR_BURN_STOP_IRRIGATION_ACTION_TERMS = [
  "brush off",
  "chemical",
  "cool",
  "extinguish",
  "flush",
  "irrigate",
  "remove clothing",
  "smoldering",
];

const MAJOR_BURN_TBSA_DEPTH_ACTION_TERMS = [
  "depth",
  "full thickness",
  "full-thickness",
  "lund-browder",
  "partial thickness",
  "partial-thickness",
  "rule of nines",
  "tbsa",
];

const MAJOR_BURN_FLUID_URINE_ACTION_TERMS = [
  "14 gauge",
  "16 gauge",
  "fluid resuscitation",
  "iv fluid",
  "lactated ringer",
  "large-bore",
  "parkland",
  "urine output",
];

const MAJOR_BURN_CENTER_ACTION_TERMS = [
  "burn center",
  "burn specialist",
  "consult",
  "referral",
  "transfer",
];

const MAJOR_BURN_HYPOTHERMIA_SAFETY_TERMS = [
  "dry",
  "hypothermia",
  "temperature",
  "warm",
  "warming",
];

const MAJOR_BURN_FLUID_TITRATION_SAFETY_TERMS = [
  "0.5 ml/kg/hr",
  "1.0 ml/kg/hour",
  "compartment syndrome",
  "fluid overload",
  "heart failure",
  "hourly",
  "urine output",
];

const MAJOR_BURN_ESCHAROTOMY_SAFETY_TERMS = [
  "circumferential",
  "compartment pressure",
  "eschar",
  "escharotomy",
  "perfusion",
  "ventilation restriction",
];

const MAJOR_BURN_TETANUS_SAFETY_TERMS = [
  "tdap",
  "tetanus",
];

const MAJOR_BURN_ANTIBIOTIC_STEWARDSHIP_SAFETY_TERMS = [
  "avoid prophylactic",
  "no prophylactic",
  "not prophylactic",
  "prophylactic systemic antibiotic",
  "systemic antibiotics only",
  "topical antimicrobial",
];

const SJS_TEN_CONTEXT_TERMS = [
  "epidermal necrolysis",
  "sjs",
  "sjs/ten",
  "stevens johnson",
  "stevens-johnson",
  "toxic epidermal necrolysis",
];

const SJS_TEN_RISK_TERMS = [
  "allopurinol",
  "blister",
  "carbamazepine",
  "conjunctivitis",
  "desquamation",
  "epidermal detachment",
  "lamotrigine",
  "mucosal",
  "nikolsky",
  "phenytoin",
  "skin pain",
  "skin sloughing",
  "sulfonamide",
  "targetoid",
];

const SJS_TEN_CULPRIT_DRUG_ACTION_TERMS = [
  "culprit drug",
  "discontinue",
  "offending drug",
  "stop medication",
  "stop the drug",
  "withdraw",
];

const SJS_TEN_ADMISSION_ESCALATION_ACTION_TERMS = [
  "burn center",
  "burn unit",
  "dermatology",
  "hospital admission",
  "icu",
  "intensive care",
];

const SJS_TEN_BSA_SCORTEN_ACTION_TERMS = [
  "abcd-10",
  "body surface area",
  "bsa",
  "epidermal detachment",
  "scorten",
  "skin detachment",
];

const SJS_TEN_SUPPORTIVE_CARE_ACTION_TERMS = [
  "fluid replacement",
  "fluid resuscitation",
  "nutritional support",
  "pain control",
  "pain relief",
  "temperature",
  "warm room",
];

const SJS_TEN_MUCOSAL_EYE_ACTION_TERMS = [
  "eye care",
  "mucosal",
  "ophthalmology",
  "ophthalmologist",
  "oral care",
];

const SJS_TEN_WOUND_INFECTION_SAFETY_TERMS = [
  "avoid adhesive",
  "bacterial culture",
  "infection monitoring",
  "infection surveillance",
  "non-adherent",
  "reverse isolation",
  "sterile handling",
  "swab",
  "wound care",
];

const SJS_TEN_ANTIBIOTIC_STEWARDSHIP_SAFETY_TERMS = [
  "avoid prophylactic antibiotic",
  "no prophylactic antibiotic",
  "not prophylactic antibiotic",
  "prophylactic antibiotics are not recommended",
  "systemic antibiotics only if infection",
];

const SJS_TEN_AIRWAY_ORGAN_SAFETY_TERMS = [
  "acute respiratory distress",
  "airway",
  "ards",
  "intubation",
  "kidney",
  "liver",
  "organ failure",
  "pneumonia",
  "respiratory distress",
];

const SJS_TEN_MEDICATION_RECHALLENGE_SAFETY_TERMS = [
  "avoid related medicines",
  "avoid structurally related",
  "cross-reaction",
  "do not rechallenge",
  "drug allergy",
  "recurrence",
  "rechallenge",
];

const SJS_TEN_ADJUNCT_RISK_SAFETY_TERMS = [
  "ciclosporin",
  "cyclosporine",
  "infection risk",
  "ivig",
  "renal impairment",
  "steroid",
  "thalidomide",
];

const DRESS_CONTEXT_TERMS = [
  "dihs",
  "dress syndrome",
  "drug hypersensitivity syndrome",
  "drug induced hypersensitivity syndrome",
  "drug reaction with eosinophilia",
  "eosinophilia and systemic symptoms",
];

const DRESS_RISK_TERMS = [
  "allopurinol",
  "atypical lymphocyte",
  "carbamazepine",
  "dapsone",
  "eosinophilia",
  "facial edema",
  "facial swelling",
  "fever",
  "hepatitis",
  "lamotrigine",
  "lymphadenopathy",
  "morbilliform",
  "phenytoin",
  "sulfonamide",
  "vancomycin",
];

const DRESS_CULPRIT_DRUG_ACTION_TERMS = [
  "all suspect medicines",
  "culprit drug",
  "discontinue",
  "offending drug",
  "stop medication",
  "stop the drug",
  "withdraw",
];

const DRESS_LAB_ORGAN_ACTION_TERMS = [
  "blood count",
  "cbc",
  "coagulation",
  "eosinophil",
  "lft",
  "liver function",
  "renal function",
];

const DRESS_DIAGNOSTIC_SEVERITY_ACTION_TERMS = [
  "drug timeline",
  "hospitalisation",
  "hospitalization",
  "regiscar",
  "skin biopsy",
  "temporal association",
];

const DRESS_CARDIOPULMONARY_ACTION_TERMS = [
  "chest x-ray",
  "ecg",
  "echocardiogram",
  "myocarditis",
  "pneumonitis",
  "troponin",
];

const DRESS_SUPPORTIVE_STEROID_ACTION_TERMS = [
  "corticosteroid",
  "electrolytes",
  "fluid",
  "prednisone",
  "slow taper",
  "supportive care",
  "warm environment",
];

const DRESS_SEVERE_ORGAN_SAFETY_TERMS = [
  "acute liver failure",
  "fulminant myocarditis",
  "haemophagocytosis",
  "hemophagocytosis",
  "multiorgan failure",
];

const DRESS_STEROID_TAPER_RELAPSE_SAFETY_TERMS = [
  "relapse",
  "slow taper",
  "steroid taper",
  "withdraw very slowly",
];

const DRESS_VIRAL_AUTOIMMUNE_SAFETY_TERMS = [
  "autoimmune",
  "cmv",
  "ebv",
  "hhv-6",
  "human herpesvirus",
  "thyroid",
  "viral serology",
];

const DRESS_RECHALLENGE_CROSS_REACTION_SAFETY_TERMS = [
  "avoid all three",
  "avoid causative",
  "avoid rechallenge",
  "cross-reaction",
  "drug allergy",
  "first-degree relatives",
  "rechallenge",
];

const DRESS_ALTERNATIVE_IMMUNOMODULATOR_SAFETY_TERMS = [
  "ciclosporin",
  "cyclophosphamide",
  "cyclosporine",
  "ivig",
  "mycophenolate",
  "plasmapheresis",
  "rituximab",
];

const SSSS_CONTEXT_TERMS = [
  "ritter disease",
  "ritter's disease",
  "scalded skin syndrome",
  "ssss",
  "staphylococcal scalded skin",
];

const SSSS_RISK_TERMS = [
  "blister",
  "bullae",
  "desquamation",
  "epidermal detachment",
  "exfoliative toxin",
  "exotoxin",
  "flaccid bullae",
  "nikolsky",
  "skin sloughing",
  "staphylococcus aureus",
];

const SSSS_DIAGNOSTIC_SOURCE_ACTION_TERMS = [
  "blood culture",
  "conjunctiva",
  "nasopharynx",
  "source of infection",
  "skin biopsy",
  "skin swab",
  "staph aureus",
  "swab",
];

const SSSS_ADMISSION_ESCALATION_ACTION_TERMS = [
  "burn unit",
  "dermatology",
  "hospitalisation",
  "hospitalization",
  "icu",
  "intensive care",
];

const SSSS_ANTISTAPH_ANTIBIOTIC_ACTION_TERMS = [
  "anti-staphylococcal",
  "cefazolin",
  "flucloxacillin",
  "iv antibiotic",
  "nafcillin",
  "oxacillin",
  "vancomycin",
];

const SSSS_FLUID_TEMP_ACTION_TERMS = [
  "dehydration",
  "electrolyte",
  "fluid",
  "hypothermia",
  "temperature",
];

const SSSS_WOUND_PAIN_ACTION_TERMS = [
  "burn dressing",
  "emollient",
  "nonadherent dressing",
  "pain control",
  "pain relief",
  "petroleum jelly",
  "wound care",
];

const SSSS_MRSA_VANCOMYCIN_SAFETY_TERMS = [
  "healthcare exposure",
  "mrsa",
  "skilled nursing",
  "vancomycin",
];

const SSSS_MEDICATION_HARM_SAFETY_TERMS = [
  "avoid ibuprofen",
  "avoid nsaid",
  "avoid silver sulfadiazine",
  "clindamycin resistance",
  "clindamycin monotherapy",
  "kidney impairment",
  "silver sulfadiazine",
];

const SSSS_DIFFERENTIAL_SAFETY_TERMS = [
  "agep",
  "bullous impetigo",
  "mucosa",
  "sjs/ten",
  "stevens-johnson",
  "toxic epidermal necrolysis",
];

const SSSS_COMPLICATION_MONITORING_SAFETY_TERMS = [
  "dehydration",
  "electrolyte imbalance",
  "hypothermia",
  "pneumonia",
  "renal failure",
  "sepsis",
];

const SSSS_CARRIER_OUTBREAK_SAFETY_TERMS = [
  "carrier",
  "decolonization",
  "hand washing",
  "nursery outbreak",
  "outbreak",
  "staph aureus carrier",
];

const TOXIC_SHOCK_CONTEXT_TERMS = [
  "group a strep toxic shock",
  "menstrual toxic shock",
  "staphylococcal toxic shock",
  "streptococcal toxic shock",
  "toxic shock syndrome",
];

const TOXIC_SHOCK_RISK_TERMS = [
  "ards",
  "desquamation",
  "erythroderma",
  "hypotension",
  "multi-organ failure",
  "multiorgan failure",
  "necrotizing fasciitis",
  "organ failure",
  "rash",
  "septic shock",
  "shock",
  "staphylococcus aureus",
  "streptococcus pyogenes",
  "tampon",
];

const TOXIC_SHOCK_RESUSCITATION_ACTION_TERMS = [
  "fluid resuscitation",
  "hemodialysis",
  "hospitalization",
  "icu",
  "intensive care",
  "organ support",
  "renal replacement",
  "vasopressor",
  "ventilation",
];

const TOXIC_SHOCK_CULTURE_SOURCE_ACTION_TERMS = [
  "blood culture",
  "culture",
  "ct",
  "mri",
  "nose",
  "soft tissue imaging",
  "throat",
  "vagina",
  "wound",
];

const TOXIC_SHOCK_TOXIN_ANTIBIOTIC_ACTION_TERMS = [
  "beta-lactam",
  "ceftaroline",
  "clindamycin",
  "daptomycin",
  "linezolid",
  "penicillin",
  "toxin suppression",
  "vancomycin",
];

const TOXIC_SHOCK_SOURCE_CONTROL_ACTION_TERMS = [
  "debridement",
  "device removal",
  "drainage",
  "foreign body",
  "irrigation",
  "remove tampon",
  "source control",
  "surgery",
];

const TOXIC_SHOCK_ORGAN_MONITORING_ACTION_TERMS = [
  "cardiopulmonary",
  "coagulation",
  "ck",
  "hepatic",
  "liver",
  "platelet",
  "renal",
];

const TOXIC_SHOCK_GAS_REGIMEN_SAFETY_TERMS = [
  "clindamycin",
  "group a strep",
  "penicillin",
  "streptococcal",
];

const TOXIC_SHOCK_STAPH_MRSA_SAFETY_TERMS = [
  "mssa",
  "mrsa",
  "nafcillin",
  "oxacillin",
  "staphylococcal",
  "vancomycin",
];

const TOXIC_SHOCK_IVIG_SEVERE_SAFETY_TERMS = [
  "iv immune globulin",
  "ivig",
  "refractory shock",
  "severe",
];

const TOXIC_SHOCK_DIFFERENTIAL_SAFETY_TERMS = [
  "kawasaki",
  "leptospirosis",
  "meningococcemia",
  "rocky mountain spotted fever",
  "scarlet fever",
  "ssss",
  "staphylococcal scalded skin",
  "stevens-johnson",
];

const TOXIC_SHOCK_RECURRENCE_PREVENTION_SAFETY_TERMS = [
  "avoid hyperabsorbent tampon",
  "chlorhexidine",
  "menstrual cup",
  "mupirocin",
  "recurrence",
  "tampon",
];

const TOXIC_SHOCK_CONTACT_PROPHYLAXIS_SAFETY_TERMS = [
  "household contact",
  "not routinely recommend",
  "prophylaxis",
  "screening",
  "standard infection control",
];

const METHEMOGLOBINEMIA_CONTEXT_TERMS = [
  "acquired methemoglobinemia",
  "methemoglobin",
  "methemoglobinemia",
  "methemoglobinaemia",
];

const METHEMOGLOBINEMIA_RISK_TERMS = [
  "85%",
  "aniline",
  "benzocaine",
  "chocolate brown blood",
  "cyanosis",
  "dapsone",
  "hypoxemia refractory",
  "nitrite",
  "nitrate",
  "oxidizing agent",
  "pulse oximetry",
  "refractory hypoxemia",
  "saturation gap",
];

const METHEMOGLOBINEMIA_OXYGEN_SUPPORT_ACTION_TERMS = [
  "100% oxygen",
  "airway",
  "high-flow oxygen",
  "oxygen",
  "respiratory support",
  "ventilation",
];

const METHEMOGLOBINEMIA_SOURCE_REMOVAL_ACTION_TERMS = [
  "benzocaine",
  "dapsone",
  "discontinue",
  "nitrite",
  "nitrate",
  "offending agent",
  "remove",
  "stop",
];

const METHEMOGLOBINEMIA_COOX_LEVEL_ACTION_TERMS = [
  "abg",
  "blood gas",
  "co-oximetry",
  "methemoglobin level",
  "methb",
  "vbg",
];

const METHEMOGLOBINEMIA_METHYLENE_BLUE_ACTION_TERMS = [
  "methylene blue",
];

const METHEMOGLOBINEMIA_TOX_ESCALATION_ACTION_TERMS = [
  "icu",
  "poison center",
  "poison control",
  "toxicologist",
  "toxicology",
];

const METHEMOGLOBINEMIA_PULSE_OX_GAP_SAFETY_TERMS = [
  "85%",
  "calculated sao2",
  "pulse ox unreliable",
  "pulse oximetry unreliable",
  "saturation gap",
  "spo2 unreliable",
];

const METHEMOGLOBINEMIA_G6PD_HEMOLYSIS_SAFETY_TERMS = [
  "g6pd",
  "hemolysis",
  "hemolytic",
];

const METHEMOGLOBINEMIA_METHYLENE_INTERACTION_SAFETY_TERMS = [
  "linezolid",
  "maoi",
  "serotonergic medication",
  "ssri",
];

const METHEMOGLOBINEMIA_TREATMENT_THRESHOLD_SAFETY_TERMS = [
  "20% to 30%",
  "20 to 30",
  "altered mental status",
  "cardiac ischemia",
  "end-organ damage",
  "level exceeds 20",
  "level exceeds 30",
  "methemoglobin > 20",
  "methemoglobin > 30",
  "symptomatic",
];

const METHEMOGLOBINEMIA_REPEAT_DOSE_SAFETY_TERMS = [
  "30 to 60 minutes",
  "remain above treatment threshold",
  "repeat dose",
  "second dose",
  "symptoms persist",
  "treatment refractoriness",
];

const METHEMOGLOBINEMIA_REBOUND_MONITORING_SAFETY_TERMS = [
  "dapsone",
  "rebound",
  "repeat co-oximetry",
  "serial co-oximetry",
  "serial methemoglobin",
];

const METHEMOGLOBINEMIA_ALTERNATIVE_THERAPY_SAFETY_TERMS = [
  "ascorbic acid",
  "exchange transfusion",
  "hyperbaric oxygen",
  "refractory",
];

const CAUSTIC_INGESTION_CONTEXT_TERMS = [
  "acid ingestion",
  "alkali ingestion",
  "caustic ingestion",
  "caustic injury",
  "corrosive ingestion",
  "drain cleaner ingestion",
  "lye ingestion",
];

const CAUSTIC_INGESTION_SEVERITY_TERMS = [
  "abdominal pain",
  "airway edema",
  "chest pain",
  "drooling",
  "dysphagia",
  "hematemesis",
  "mediastinitis",
  "odynophagia",
  "oral edema",
  "perforation",
  "peritonitis",
  "respiratory distress",
  "stridor",
  "vocal changes",
  "vomiting",
];

const CAUSTIC_AIRWAY_STABILIZATION_ACTION_TERMS = [
  "abc",
  "airway",
  "breathing",
  "circulation",
  "intubation",
  "resuscitation",
  "stabilize",
  "ventilation",
];

const CAUSTIC_EXPOSURE_HISTORY_ACTION_TERMS = [
  "5 ws",
  "amount",
  "co-ingestion",
  "concentration",
  "intentional",
  "intentionality",
  "product",
  "substance",
  "time",
  "what",
  "when",
];

const CAUSTIC_ENDOSCOPY_ACTION_TERMS = [
  "egd",
  "endoscopic",
  "endoscopy",
  "gastroenterology",
  "gi consult",
  "upper endoscopy",
];

const CAUSTIC_CT_PERFORATION_ACTION_TERMS = [
  "computed tomography",
  "ct",
  "mediastinitis",
  "perforation",
  "peritonitis",
  "surgical abdomen",
];

const CAUSTIC_ESCALATION_ACTION_TERMS = [
  "poison center",
  "poison control",
  "surgery",
  "surgical consult",
  "toxicologist",
  "toxicology",
];

const CAUSTIC_EMESIS_NEUTRALIZATION_SAFETY_TERMS = [
  "activated charcoal",
  "charcoal",
  "dilution",
  "emesis",
  "induced vomiting",
  "neutralization",
  "neutralize",
  "vomiting",
];

const CAUSTIC_BLIND_TUBE_SAFETY_TERMS = [
  "blind nasogastric",
  "blind ng",
  "nasogastric",
  "ng tube",
  "orogastric",
];

const CAUSTIC_ENDOSCOPY_TIMING_SAFETY_TERMS = [
  "12 hours",
  "24 hours",
  "48 hours",
  "early endoscopy",
  "endoscopy timing",
  "perforation contraindication",
];

const CAUSTIC_STEROID_ANTIBIOTIC_SAFETY_TERMS = [
  "antibiotics only",
  "corticosteroid",
  "infection",
  "perforation",
  "steroid",
];

const CAUSTIC_LONG_TERM_COMPLICATION_SAFETY_TERMS = [
  "carcinoma",
  "dysphagia follow-up",
  "esophageal cancer",
  "stricture",
  "surveillance",
];

const OPIOID_TOXICITY_CONTEXT_TERMS = [
  "fentanyl overdose",
  "heroin overdose",
  "methadone overdose",
  "opiate overdose",
  "opiate toxicity",
  "opioid overdose",
  "opioid poisoning",
  "opioid toxicity",
  "opioid-induced respiratory depression",
  "naloxone",
  "narcan",
  "마약성 진통제",
  "오피오이드",
];

const OPIOID_AIRWAY_VENTILATION_ACTION_TERMS = [
  "airway",
  "bag-valve",
  "bag valve",
  "bvm",
  "intubation",
  "oxygen",
  "positive pressure",
  "respiratory support",
  "ventilation",
  "기도",
  "산소",
  "환기",
];

const OPIOID_NALOXONE_ACTION_TERMS = [
  "naloxone",
  "narcan",
  "opioid antagonist",
  "날록손",
];

const OPIOID_RECURRENT_DEPRESSION_ACTION_TERMS = [
  "capnography",
  "continuous monitoring",
  "infusion",
  "long-acting",
  "methadone",
  "observation",
  "observe",
  "pulse oximetry",
  "recurrent",
  "repeat dose",
  "repeat naloxone",
  "renarcotization",
  "respiratory depression",
  "재호흡억제",
  "재투여",
];

const OPIOID_LONG_ACTING_REBOUND_SAFETY_TERMS = [
  "extended release",
  "extended-release",
  "fentanyl",
  "long-acting",
  "methadone",
  "observation",
  "rebound",
  "recurrent",
  "renarcotization",
  "sustained release",
  "서방",
  "재호흡억제",
];

const OPIOID_COINGESTION_DIFFERENTIAL_SAFETY_TERMS = [
  "alcohol",
  "benzodiazepine",
  "co-ingestion",
  "coingestion",
  "glucose",
  "hypoglycemia",
  "sedative",
  "trauma",
  "벤조디아제핀",
  "혈당",
];

const OPIOID_NALOXONE_ADVERSE_SAFETY_TERMS = [
  "acute withdrawal",
  "aspiration",
  "pulmonary edema",
  "titrate",
  "titration",
  "withdrawal",
  "금단",
  "폐부종",
];

const SICKLE_SPLENIC_SEQUESTRATION_CONTEXT_TERMS = [
  "acute splenic sequestration",
  "sickle cell splenic sequestration",
  "sickle splenic sequestration",
  "splenic sequestration",
  "splenic sequestration crisis",
  "splenomegaly with acute anemia",
];

const SICKLE_SPLENIC_SEQUESTRATION_RISK_TERMS = [
  "baseline hemoglobin",
  "falling hemoglobin",
  "hemoglobin 2 g/dl below baseline",
  "hypovolemic shock",
  "left upper quadrant",
  "pallor",
  "rapidly enlarging spleen",
  "reticulocyte",
  "severe anemia",
  "shock",
  "splenomegaly",
  "tachycardia",
];

const SICKLE_SPLENIC_SEQUESTRATION_ASSESSMENT_ACTION_TERMS = [
  "baseline hemoglobin",
  "cbc",
  "hemoglobin",
  "palpate spleen",
  "reticulocyte",
  "spleen size",
  "type and crossmatch",
];

const SICKLE_SPLENIC_SEQUESTRATION_RESUSCITATION_ACTION_TERMS = [
  "fluid bolus",
  "hypovolemia",
  "iv fluid",
  "resuscitation",
  "shock",
];

const SICKLE_SPLENIC_SEQUESTRATION_TRANSFUSION_ACTION_TERMS = [
  "packed red blood",
  "packed red blood cell",
  "packed rbcs",
  "prbc",
  "red blood cell transfusion",
  "red cell transfusion",
  "simple transfusion",
];

const SICKLE_SPLENIC_SEQUESTRATION_EXPERT_ACTION_TERMS = [
  "hematology",
  "sickle cell expert",
  "sickle cell specialist",
];

const SICKLE_SPLENIC_SEQUESTRATION_OVERTRANSFUSION_SAFETY_TERMS = [
  "avoid over-transfusion",
  "avoid overtransfusion",
  "hemoglobin 8",
  "hyperviscosity",
  "over-transfusion",
  "overtransfusion",
];

const SICKLE_SPLENIC_SEQUESTRATION_DIFFERENTIAL_SAFETY_TERMS = [
  "acute chest syndrome",
  "aplastic",
  "delayed hemolytic transfusion reaction",
  "infection",
  "sepsis",
];

const SICKLE_SPLENIC_SEQUESTRATION_RECURRENCE_SAFETY_TERMS = [
  "parent education",
  "recurrence",
  "recurrent sequestration",
  "spleen size",
  "splenectomy",
];

const SICKLE_SPLENIC_SEQUESTRATION_MONITORING_SAFETY_TERMS = [
  "hemoglobin",
  "rebound",
  "recheck",
  "serial cbc",
  "vital signs",
];

const SICKLE_STROKE_CONTEXT_TERMS = [
  "acute stroke in sickle cell",
  "cerebrovascular accident in sickle cell",
  "sickle cell acute stroke",
  "sickle cell disease with stroke",
  "sickle cell stroke",
  "sickle stroke",
  "stroke in sickle cell",
];

const SICKLE_STROKE_RISK_TERMS = [
  "altered level of consciousness",
  "altered mental status",
  "aphasia",
  "focal neurologic",
  "hemiparesis",
  "paralysis",
  "seizure",
  "severe headache",
  "speech problem",
  "tia",
  "transient ischemic attack",
  "weakness",
];

const SICKLE_STROKE_NEURO_ACTION_TERMS = [
  "neurologic consultation",
  "neurology",
  "stroke consult",
  "stroke team",
];

const SICKLE_STROKE_IMAGING_ACTION_TERMS = [
  "ct",
  "head ct",
  "magnetic resonance angiography",
  "mra",
  "mri",
  "neuroimaging",
  "urgent head",
];

const SICKLE_STROKE_TRANSFUSION_ACTION_TERMS = [
  "exchange transfusion",
  "erythrocytapheresis",
  "packed red blood cell",
  "packed rbcs",
  "prbc",
  "red blood cell transfusion",
  "red cell exchange",
  "red cell transfusion",
  "simple transfusion",
];

const SICKLE_STROKE_EXPERT_ACTION_TERMS = [
  "apheresis",
  "hematology",
  "sickle cell expert",
  "sickle cell specialist",
];

const SICKLE_STROKE_HYPERVISCOSITY_SAFETY_TERMS = [
  "avoid hemoglobin above 10",
  "avoid transfusing above 10",
  "hemoglobin above 10",
  "hyperviscosity",
  "target hemoglobin above 10",
];

const SICKLE_STROKE_BLOOD_BANK_SAFETY_TERMS = [
  "alloimmunization",
  "antigen matching",
  "blood bank",
  "c antigen",
  "e antigen",
  "k antigen",
  "sickle-negative",
  "transfusion history",
];

const SICKLE_STROKE_SECONDARY_PREVENTION_SAFETY_TERMS = [
  "chronic transfusion",
  "monthly exchange",
  "monthly simple",
  "monthly transfusion",
  "secondary prevention",
  "stroke recurrence",
];

const SICKLE_STROKE_MIMIC_HEMORRHAGE_SAFETY_TERMS = [
  "hemorrhagic stroke",
  "intracranial hemorrhage",
  "mimic",
  "seizure",
  "tia",
  "transient ischemic attack",
];

const ACUTE_CHEST_SYNDROME_CONTEXT_TERMS = [
  "acute chest syndrome",
  "sickle acute chest",
  "sickle cell acute chest",
  "sickle cell disease",
  "sickle cell anemia",
  "sickle cell anaemia",
  "sickle crisis with chest",
  "hbss",
  "sickle cell",
  "겸상적혈구",
];

const ACUTE_CHEST_SYNDROME_RISK_TERMS = [
  "new infiltrate",
  "pulmonary infiltrate",
  "hypoxemia",
  "hypoxia",
  "chest pain",
  "cough",
  "fever",
  "tachypnea",
  "wheezing",
  "dyspnea",
  "low spo2",
  "multilobar",
  "vaso-occlusive",
  "pain crisis",
];

const ACUTE_CHEST_SYNDROME_EXPLICIT_CONTEXT_TERMS = [
  "acute chest syndrome",
  "sickle acute chest",
  "sickle cell acute chest",
];

const ACUTE_CHEST_SYNDROME_PULMONARY_RISK_TERMS = [
  "new infiltrate",
  "pulmonary infiltrate",
  "hypoxemia",
  "hypoxia",
  "chest pain",
  "cough",
  "tachypnea",
  "wheezing",
  "dyspnea",
  "low spo2",
  "multilobar",
];

const ACUTE_CHEST_SYNDROME_CXR_LAB_ACTION_TERMS = [
  "blood culture",
  "cbc",
  "chest x-ray",
  "chest xray",
  "ct chest",
  "cxr",
  "new infiltrate",
  "reticulocyte",
  "sputum culture",
];

const ACUTE_CHEST_SYNDROME_OXYGEN_ACTION_TERMS = [
  "co-oximetry",
  "hypoxemia",
  "oxygen",
  "pao2",
  "pulse oximetry",
  "spo2",
];

const ACUTE_CHEST_SYNDROME_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "azithromycin",
  "ceftriaxone",
  "cefotaxime",
  "fluoroquinolone",
  "macrolide",
  "vancomycin",
];

const ACUTE_CHEST_SYNDROME_SPIROMETRY_PAIN_ACTION_TERMS = [
  "analgesia",
  "every 2 hours",
  "incentive spirometry",
  "ketorolac",
  "opioid",
  "pain control",
  "pca",
  "q2",
  "spirometry",
];

const ACUTE_CHEST_SYNDROME_TRANSFUSION_ACTION_TERMS = [
  "blood transfusion",
  "exchange transfusion",
  "packed red blood",
  "packed red blood cell",
  "prbc",
  "red blood cell transfusion",
  "red cell transfusion",
  "simple transfusion",
];

const ACUTE_CHEST_SYNDROME_RESPIRATORY_ESCALATION_ACTION_TERMS = [
  "bipap",
  "ecmo",
  "icu",
  "intubation",
  "multilobar",
  "respiratory failure",
  "worsening hypoxemia",
];

const ACUTE_CHEST_SYNDROME_FLUID_OPIOID_SAFETY_TERMS = [
  "avoid overhydration",
  "fluid overload",
  "hydration status",
  "hypoventilation",
  "opioid",
  "oversedation",
  "pulmonary edema",
];

const ACUTE_CHEST_SYNDROME_TRANSFUSION_SAFETY_TERMS = [
  "exchange transfusion",
  "hematology",
  "hbs <30",
  "hemoglobin 10",
  "hct 30",
  "hyperviscosity",
  "sickle hemoglobin",
];

const ACUTE_CHEST_SYNDROME_BRONCHODILATOR_STEROID_SAFETY_TERMS = [
  "asthma",
  "bronchodilator",
  "bronchospasm",
  "readmission",
  "rebound",
  "steroid",
  "vaso-occlusive",
];

const ACUTE_CHEST_SYNDROME_DIFFERENTIAL_SAFETY_TERMS = [
  "acute coronary",
  "ards",
  "empyema",
  "myocardial infarction",
  "pneumonia",
  "pneumothorax",
  "pulmonary embolism",
];

const ACUTE_CHEST_SYNDROME_DISPOSITION_SAFETY_TERMS = [
  "baseline oxygen",
  "hematology",
  "icu",
  "multilobar",
  "respiratory failure",
  "severe hypoxemia",
  "worsening radiographic",
];

const SEVERE_ASTHMA_CONTEXT_TERMS = [
  "acute asthma exacerbation",
  "asthma attack",
  "asthma exacerbation",
  "life-threatening asthma",
  "near-fatal asthma",
  "severe asthma",
  "severe bronchospasm",
  "status asthmaticus",
  "천식 발작",
  "천식 악화",
  "중증 천식",
];

const SEVERE_ASTHMA_OXYGEN_VENTILATION_ACTION_TERMS = [
  "airway",
  "hypoxemia",
  "hypoxia",
  "intubation",
  "oxygen",
  "respiratory failure",
  "ventilation",
  "기도",
  "산소",
  "저산소",
  "환기",
];

const SEVERE_ASTHMA_SABA_ACTION_TERMS = [
  "albuterol",
  "beta-agonist",
  "bronchodilator",
  "continuous nebulization",
  "levalbuterol",
  "saba",
  "salbutamol",
  "short-acting beta",
  "네뷸",
  "살부타몰",
];

const SEVERE_ASTHMA_IPRATROPIUM_ACTION_TERMS = [
  "anticholinergic",
  "ipratropium",
  "이프라트로피움",
];

const SEVERE_ASTHMA_STEROID_ACTION_TERMS = [
  "corticosteroid",
  "dexamethasone",
  "glucocorticoid",
  "methylprednisolone",
  "prednisone",
  "steroid",
  "스테로이드",
];

const SEVERE_ASTHMA_ESCALATION_ACTION_TERMS = [
  "heliox",
  "icu",
  "intubation escalation",
  "intubation readiness",
  "iv magnesium",
  "magnesium",
  "mechanical ventilation escalation",
  "noninvasive ventilation",
  "niv",
  "picu",
  "마그네슘",
  "삽관 준비",
  "중환자",
];

const SEVERE_ASTHMA_RESPONSE_MONITORING_SAFETY_TERMS = [
  "fev1",
  "peak flow",
  "pef",
  "pulse oximetry",
  "reassessment",
  "response",
  "serial",
  "work of breathing",
  "산소포화도",
  "재평가",
];

const SEVERE_ASTHMA_RESPIRATORY_FAILURE_SAFETY_TERMS = [
  "altered mental status",
  "co2",
  "drowsiness",
  "fatigue",
  "hypercapnia",
  "intubation",
  "respiratory failure",
  "silent chest",
  "ventilation",
  "의식",
  "호흡부전",
];

const SEVERE_ASTHMA_TREATMENT_ADVERSE_SAFETY_TERMS = [
  "arrhythmia",
  "hypokalemia",
  "lactic acidosis",
  "potassium",
  "tachycardia",
  "theophylline",
  "trigger",
  "전해질",
  "저칼륨",
];

const SEVERE_ASTHMA_VENTILATION_CONTEXT_TERMS = [
  "auto-peep",
  "hypercapnia",
  "intubated",
  "intubation",
  "mechanical ventilation",
  "near-fatal asthma",
  "positive pressure",
  "respiratory acidosis",
  "respiratory failure",
  "status asthmaticus",
  "ventilator",
];

const SEVERE_ASTHMA_VENTILATION_STRATEGY_SAFETY_TERMS = [
  "low minute ventilation",
  "low respiratory rate",
  "permissive hypercapnia",
  "prolonged expiratory",
  "prolonged expiration",
  "reduce respiratory rate",
];

const SEVERE_ASTHMA_AUTO_PEEP_MONITORING_SAFETY_TERMS = [
  "air trapping",
  "auto-peep",
  "dynamic hyperinflation",
  "expiratory flow",
  "intrinsic peep",
  "plateau pressure",
];

const SEVERE_ASTHMA_BAROTRAUMA_HEMODYNAMIC_SAFETY_TERMS = [
  "barotrauma",
  "hemodynamic",
  "hypotension",
  "obstructive shock",
  "pneumomediastinum",
  "pneumothorax",
  "shock",
];

const SEVERE_ASTHMA_SEDATION_SYNCHRONY_SAFETY_TERMS = [
  "ketamine",
  "neuromuscular blockade",
  "paralysis",
  "sedation",
  "ventilator asynchrony",
];

const SEVERE_CAP_CONTEXT_TERMS = [
  "cap with hypoxemia",
  "cap with respiratory failure",
  "community-acquired pneumonia with hypoxemia",
  "community-acquired pneumonia with sepsis",
  "pneumonia with hypoxemia",
  "pneumonia with respiratory failure",
  "pneumonia with sepsis",
  "severe cap",
  "severe community-acquired pneumonia",
  "severe pneumonia",
  "중증 폐렴",
];

const SEVERE_CAP_OXYGEN_VENTILATION_ACTION_TERMS = [
  "airway",
  "high-flow nasal cannula",
  "hfnc",
  "hypoxemia",
  "intubation",
  "oxygen",
  "respiratory failure",
  "ventilation",
  "산소",
  "저산소",
];

const SEVERE_CAP_DIAGNOSTIC_CULTURE_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "chest x-ray",
  "chest radiograph",
  "legionella",
  "respiratory culture",
  "sputum culture",
  "urinary antigen",
  "배양",
];

const SEVERE_CAP_EMPIRIC_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "azithromycin",
  "beta-lactam",
  "ceftriaxone",
  "cefotaxime",
  "ceftaroline",
  "levofloxacin",
  "macrolide",
  "moxifloxacin",
  "항생제",
];

const SEVERE_CAP_SEPSIS_ESCALATION_ACTION_TERMS = [
  "icu",
  "lactate",
  "sepsis",
  "septic shock",
  "shock",
  "vasopressor",
  "중환자",
  "쇼크",
];

const SEVERE_CAP_MRSA_PSEUDOMONAS_SAFETY_TERMS = [
  "90 days",
  "de-escalation",
  "mrsa",
  "pseudomonas",
  "recent hospitalization",
  "respiratory isolation",
  "risk factor",
  "vancomycin",
];

const SEVERE_CAP_SEVERITY_DISPOSITION_SAFETY_TERMS = [
  "curb-65",
  "hypotension",
  "icu",
  "major criteria",
  "minor criteria",
  "psi",
  "severity",
  "shock",
];

const SEVERE_CAP_EFFUSION_EMPYEMA_SAFETY_TERMS = [
  "drainage",
  "empyema",
  "loculated",
  "parapneumonic effusion",
  "pleural effusion",
  "thoracentesis",
  "흉수",
];

const SEVERE_CAP_VIRAL_ASPIRATION_DIFFERENTIAL_SAFETY_TERMS = [
  "aspiration",
  "covid",
  "influenza",
  "lung abscess",
  "pulmonary embolism",
  "viral",
  "virus",
  "흡인",
];

const SEVERE_CAP_PROCALCITONIN_TERMS = [
  "procalcitonin",
];

const SEVERE_CAP_ANTIBIOTIC_NONWITHHOLD_TERMS = [
  "do not withhold",
  "not withhold",
  "should not withhold",
];

const SEVERE_CAP_INITIAL_ANTIBIOTIC_TERMS = [
  "empiric antibiotic",
  "initial antibacterial",
  "initial empiric antibiotics",
  "initial empiric antibiotic",
];

const SEVERE_CAP_CORTICOSTEROID_CLASS_TERMS = [
  "corticosteroid",
  "steroid",
  "스테로이드",
];

const SEVERE_CAP_CORTICOSTEROID_AVOIDANCE_TERMS = [
  "avoid routine",
  "avoid routinely",
  "no routine",
  "not routinely",
  "not routine",
];

const SEVERE_CAP_CORTICOSTEROID_EXCEPTION_TERMS = [
  "refractory septic shock",
  "septic shock",
  "separate indication",
];

const SEVERE_CAP_INFLUENZA_TERMS = [
  "influenza",
];

const SEVERE_CAP_ANTIVIRAL_TERMS = [
  "antiviral",
  "oseltamivir",
  "tamiflu",
  "항바이러스",
];

const SEVERE_CAP_DURATION_MINIMUM_TERMS = [
  "5 days",
  "at least 5 days",
  "minimum 5",
];

const SEVERE_CAP_STABILITY_TERMS = [
  "clinical stability",
  "normal mentation",
  "oxygen saturation",
  "respiratory rate",
  "vital sign",
];

const SEVERE_CAP_DURATION_TERMS = [
  "antibiotic duration",
  "duration",
  "treatment duration",
  "치료 기간",
];

const COPD_EXACERBATION_CONTEXT_TERMS = [
  "acute exacerbation of copd",
  "aecopd",
  "chronic bronchitis exacerbation",
  "chronic obstructive pulmonary disease exacerbation",
  "copd exacerbation",
  "copd flare",
  "emphysema exacerbation",
  "hypercapnic copd",
  "만성폐쇄성폐질환",
];

const COPD_CONTROLLED_OXYGEN_ACTION_TERMS = [
  "controlled oxygen",
  "oxygen target",
  "target saturation",
  "venturi",
  "산소",
];

const COPD_OXYGEN_TARGET_ACTION_TERMS = [
  "88",
  "92",
  "spo2",
];

const COPD_ABG_ACTION_TERMS = [
  "abg",
  "arterial blood gas",
  "blood gas",
];

const COPD_BRONCHODILATOR_ACTION_TERMS = [
  "albuterol",
  "bronchodilator",
  "ipratropium",
  "saba",
  "salbutamol",
  "sama",
  "short-acting anticholinergic",
  "short-acting beta",
  "이프라트로피움",
  "기관지확장",
];

const COPD_STEROID_ACTION_TERMS = [
  "corticosteroid",
  "glucocorticoid",
  "methylprednisolone",
  "prednisone",
  "steroid",
  "스테로이드",
];

const COPD_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "항생제",
];

const COPD_ANTIBIOTIC_CRITERIA_ACTION_TERMS = [
  "infection",
  "pneumonia",
  "purulent sputum",
  "sputum color",
  "sputum colour",
  "sputum volume",
  "sputum purulence",
  "감염",
];

const COPD_NIV_ACTION_TERMS = [
  "bipap",
  "niv",
  "noninvasive ventilation",
  "non-invasive ventilation",
  "비침습",
];

const COPD_VENTILATORY_FAILURE_ACTION_TERMS = [
  "hypercapnia",
  "intubation",
  "respiratory acidosis",
  "respiratory failure",
  "기계환기",
  "삽관",
];

const COPD_OXYGEN_TARGET_SAFETY_TERMS = [
  "88",
  "92",
  "controlled oxygen",
  "oxygen target",
  "target saturation",
  "venturi",
];

const COPD_CO2_RETENTION_SAFETY_TERMS = [
  "co2",
  "hypercapnia",
  "oxygen-induced",
  "paco2",
  "이산화탄소",
];

const COPD_ABG_SAFETY_TERMS = [
  "abg",
  "arterial blood gas",
  "ph",
  "동맥혈",
];

const COPD_NIV_SAFETY_TERMS = [
  "bipap",
  "niv",
  "noninvasive ventilation",
  "비침습",
];

const COPD_NIV_ACIDOSIS_SAFETY_TERMS = [
  "hypercapnic acidosis",
  "ph",
  "respiratory acidosis",
];

const COPD_NIV_FAILURE_INTUBATION_SAFETY_TERMS = [
  "altered mental status",
  "fatigue",
  "intubation",
  "respiratory failure",
  "의식",
  "삽관",
  "호흡부전",
];

const COPD_COMORBID_DIFFERENTIAL_SAFETY_TERMS = [
  "acute heart failure",
  "arrhythmia",
  "bronchiectasis",
  "pneumonia",
  "pneumothorax",
  "pulmonary embolism",
  "trigger",
  "감별",
  "폐렴",
];

const COPD_TREATMENT_ADVERSE_SAFETY_TERMS = [
  "arrhythmia",
  "glucose",
  "hyperglycemia",
  "hypokalemia",
  "potassium",
  "steroid",
  "tachycardia",
  "전해질",
  "혈당",
];

const ACUTE_HEART_FAILURE_CONTEXT_TERMS = [
  "acute decompensated heart failure",
  "acute heart failure",
  "acute pulmonary edema",
  "cardiogenic pulmonary edema",
  "decompensated heart failure",
  "flash pulmonary edema",
  "heart failure exacerbation",
  "hypertensive pulmonary edema",
  "pulmonary oedema",
  "심부전",
  "폐부종",
];

const ACUTE_HF_OXYGEN_ACTION_TERMS = [
  "hypoxemia",
  "oxygen",
  "산소",
];

const ACUTE_HF_NIV_ACTION_TERMS = [
  "bipap",
  "cpap",
  "niv",
  "noninvasive ventilation",
  "non-invasive ventilation",
  "positive pressure",
  "양압",
];

const ACUTE_HF_RESPIRATORY_FAILURE_ACTION_TERMS = [
  "intubation",
  "pulmonary edema",
  "pulmonary oedema",
  "respiratory failure",
  "severe dyspnea",
  "ventilation",
  "환기",
];

const ACUTE_HF_DIURETIC_ACTION_TERMS = [
  "bumetanide",
  "diuretic",
  "furosemide",
  "loop diuretic",
  "torsemide",
  "이뇨",
];

const ACUTE_HF_DECONGESTION_ACTION_TERMS = [
  "congestion",
  "decongestion",
  "pulmonary edema",
  "pulmonary oedema",
];

const ACUTE_HF_VASODILATOR_ACTION_TERMS = [
  "afterload",
  "nitroglycerin",
  "nitrate",
  "vasodilator",
  "혈관확장",
];

const ACUTE_HF_BP_CONTEXT_ACTION_TERMS = [
  "blood pressure",
  "hypertensive",
  "pressure allows",
  "혈압",
];

const ACUTE_HF_SHOCK_ACTION_TERMS = [
  "cardiogenic shock",
  "shock",
  "쇼크",
];

const ACUTE_HF_ESCALATION_ACTION_TERMS = [
  "icu",
  "inotrope",
  "intubation",
  "mechanical ventilation",
  "pressor",
  "respiratory failure",
  "vasopressor",
  "기계환기",
  "삽관",
  "중환자",
];

const ACUTE_HF_BP_MONITORING_SAFETY_TERMS = [
  "blood pressure",
  "blood pressure monitoring",
  "close blood pressure",
  "혈압",
];

const ACUTE_HF_HYPOTENSION_SAFETY_TERMS = [
  "hypotension",
  "저혈압",
];

const ACUTE_HF_VASODILATOR_SAFETY_TERMS = [
  "nitrate",
  "nitroglycerin",
  "vasodilator",
];

const ACUTE_HF_VASODILATOR_CONTRAINDICATION_SAFETY_TERMS = [
  "aortic stenosis",
  "pde5",
  "right ventricular infarct",
  "sildenafil",
];

const ACUTE_HF_RENAL_MONITORING_SAFETY_TERMS = [
  "creatinine",
  "kidney",
  "renal",
  "신장",
];

const ACUTE_HF_DIURESIS_OUTPUT_SAFETY_TERMS = [
  "diuresis",
  "urine output",
];

const ACUTE_HF_ELECTROLYTE_SAFETY_TERMS = [
  "electrolyte",
  "hypokalemia",
  "magnesium",
  "potassium",
  "전해질",
];

const ACUTE_HF_TRIGGER_REVIEW_SAFETY_TERMS = [
  "trigger",
  "triggers",
  "감별",
];

const ACUTE_HF_TRIGGER_CONDITION_SAFETY_TERMS = [
  "acute coronary syndrome",
  "arrhythmia",
  "infection",
  "ischemia",
  "medication nonadherence",
  "myocardial infarction",
  "pulmonary embolism",
  "valvular",
  "감염",
  "부정맥",
  "심근경색",
];

const ACUTE_HF_SHOCK_PERFUSION_SAFETY_TERMS = [
  "altered mental status",
  "hypoperfusion",
  "lactate",
  "저관류",
];

const ACUTE_HF_SHOCK_STATE_SAFETY_TERMS = [
  "cardiogenic shock",
  "hypotension",
  "shock",
  "쇼크",
];

const ACUTE_HF_RESPIRATORY_ESCALATION_SAFETY_TERMS = [
  "intubation",
  "respiratory failure",
  "호흡부전",
];

const ACUTE_HF_NITRATE_LEVEL_CARE_SAFETY_TERMS = [
  "blood pressure monitoring",
  "close blood pressure",
  "do not routinely offer nitrates",
  "iv nitrate",
  "level 2 care",
  "nitrate",
  "severe hypertension",
  "vasodilator",
  "혈압 모니터",
];

const ACUTE_HF_INOTROPE_VASOPRESSOR_SAFETY_TERMS = [
  "cardiac care unit",
  "cardiogenic shock",
  "dobutamine",
  "high dependency",
  "inotrope",
  "level 2 care",
  "norepinephrine",
  "potentially reversible",
  "vasopressor",
  "강심제",
];

const ACUTE_HF_MCS_ADVANCED_TEAM_SAFETY_TERMS = [
  "advanced heart failure",
  "ecmo",
  "impella",
  "mechanical circulatory support",
  "mcs",
  "specialist heart failure team",
  "transplant",
  "ventricular assist",
  "전문 심부전",
];

const ACUTE_HF_BETA_BLOCKER_STABILIZATION_SAFETY_TERMS = [
  "av block",
  "beta blocker",
  "bradycardia",
  "heart rate less than 50",
  "restart after stabilization",
  "shock",
  "stabilized",
  "베타차단제",
];

const DUCTAL_DEPENDENT_CHD_CONTEXT_TERMS = [
  "critical congenital heart disease",
  "critical coarctation",
  "critical pulmonary stenosis",
  "cyanotic congenital heart disease",
  "duct-dependent congenital heart disease",
  "ductal dependent congenital heart disease",
  "ductal-dependent congenital heart disease",
  "ductal-dependent lesion",
  "ductus-dependent congenital heart disease",
  "hypoplastic left heart syndrome",
  "neonatal cyanosis",
  "neonatal shock",
  "newborn cyanosis",
  "newborn shock",
  "pulmonary atresia",
  "transposition of the great arteries",
];

const DUCTAL_DEPENDENT_CHD_RISK_TERMS = [
  "cyanosis",
  "differential saturation",
  "failed pulse oximetry screen",
  "hypoxemia",
  "murmur",
  "poor feeding",
  "preductal",
  "postductal",
  "shock",
  "weak femoral pulses",
];

const DUCTAL_DEPENDENT_CHD_PGE_DRUG_ACTION_TERMS = [
  "alprostadil",
  "pge1",
  "prostaglandin",
  "prostaglandin e1",
];

const DUCTAL_DEPENDENT_CHD_PGE_URGENCY_ACTION_TERMS = [
  "ductal patency",
  "immediately",
  "infusion",
  "maintain ductal",
  "start",
];

const DUCTAL_DEPENDENT_CHD_PULSE_OX_ACTION_TERMS = [
  "preductal",
  "postductal",
  "pulse oximetry",
];

const DUCTAL_DEPENDENT_CHD_HEMODYNAMIC_ACTION_TERMS = [
  "blood gas",
  "four extremity blood pressure",
  "lactate",
];

const DUCTAL_DEPENDENT_CHD_CARDIAC_DIAGNOSTIC_ACTION_TERMS = [
  "chest x-ray",
  "echocardiogram",
  "echo",
  "ecg",
];

const DUCTAL_DEPENDENT_CHD_CARDIAC_ESCALATION_ACTION_TERMS = [
  "cardiac intensive care",
  "cardiology",
  "pediatric cardiology",
];

const DUCTAL_DEPENDENT_CHD_NEONATAL_ESCALATION_ACTION_TERMS = [
  "neonatologist",
  "nicu",
];

const DUCTAL_DEPENDENT_CHD_ACCESS_TRANSFER_ACTION_TERMS = [
  "transfer",
  "umbilical venous catheter",
  "uvc",
];

const DUCTAL_DEPENDENT_CHD_AIRWAY_SUPPORT_ACTION_TERMS = [
  "airway",
  "intubation",
  "mechanical ventilation",
];

const DUCTAL_DEPENDENT_CHD_METABOLIC_SUPPORT_ACTION_TERMS = [
  "glucose",
  "hypoglycemia",
  "metabolic acidosis",
  "thermoregulation",
  "vascular access",
];

const DUCTAL_DEPENDENT_CHD_OXYGEN_JUDICIOUS_SAFETY_TERMS = [
  "avoid excess supplemental oxygen",
  "judicious oxygen",
  "supplemental oxygen should be used judiciously",
  "withhold oxygen",
];

const DUCTAL_DEPENDENT_CHD_OXYGEN_PHYSIOLOGY_SAFETY_TERMS = [
  "ductal steal",
  "lower pulmonary vascular resistance",
  "judicious oxygen",
  "pulmonary vascular resistance",
  "supplemental oxygen",
];

const DUCTAL_DEPENDENT_CHD_PGE_DRUG_SAFETY_TERMS = [
  "alprostadil",
  "pge1",
  "prostaglandin",
  "prostaglandin e1",
];

const DUCTAL_DEPENDENT_CHD_PGE_APNEA_SAFETY_TERMS = [
  "apnea",
  "intubation",
  "respiratory depression",
];

const DUCTAL_DEPENDENT_CHD_PGE_HEMODYNAMIC_SAFETY_TERMS = [
  "fever",
  "hypotension",
];

const DUCTAL_DEPENDENT_CHD_SEPSIS_DIFFERENTIAL_SAFETY_TERMS = [
  "sepsis",
];

const DUCTAL_DEPENDENT_CHD_LESION_DIFFERENTIAL_SAFETY_TERMS = [
  "ductal-dependent",
  "hypoplastic left heart",
  "pulmonary atresia",
  "transposition",
];

const DUCTAL_DEPENDENT_CHD_TRANSFER_NO_DELAY_SAFETY_TERMS = [
  "do not delay",
  "not delay",
];

const DUCTAL_DEPENDENT_CHD_CARDIAC_TRANSFER_SAFETY_TERMS = [
  "neonatology",
  "pediatric cardiac",
  "pediatric cardiology",
  "transport",
  "transfer",
];

const CARDIAC_TAMPONADE_CONTEXT_TERMS = [
  "beck triad",
  "beck's triad",
  "cardiac tamponade",
  "pericardial tamponade",
  "pericardial effusion with shock",
  "pulsus paradoxus",
  "tamponade physiology",
  "심장눌림증",
  "심낭압전",
];

const CARDIAC_TAMPONADE_ECHO_ACTION_TERMS = [
  "bedside echo",
  "bedside ultrasound",
  "cardiac pocus",
  "echocardiography",
  "echo",
  "e-fast",
  "efast",
  "extended fast",
  "focused cardiac ultrasound",
  "pericardial ultrasound",
  "심초음파",
];

const CARDIAC_TAMPONADE_DRAINAGE_ACTION_TERMS = [
  "pericardiocentesis",
  "pericardial drainage",
  "pericardial window",
  "pericardiotomy",
  "subxiphoid",
  "심낭천자",
  "심낭 배액",
];

const CARDIAC_TAMPONADE_SPECIALIST_ACTION_TERMS = [
  "cardiology",
  "cardiothoracic",
  "ct surgery",
  "emergency surgery",
  "trauma surgery",
  "thoracic surgery",
  "흉부외과",
  "심장내과",
];

const CARDIAC_TAMPONADE_HEMODYNAMIC_ACTION_TERMS = [
  "blood pressure",
  "fluid bolus",
  "hemodynamic",
  "hypotension",
  "pressor",
  "shock",
  "vasopressor",
  "수액",
  "쇼크",
  "혈압",
];

const CARDIAC_TAMPONADE_NO_DELAY_SAFETY_TERMS = [
  "do not delay",
  "do not delay drainage",
  "do not delay pericardiocentesis",
  "do not wait",
  "immediate drainage",
  "no ct delay",
  "urgent drainage",
  "urgent pericardiocentesis",
  "without waiting",
  "지연",
];

const CARDIAC_TAMPONADE_ANTICOAG_REVERSAL_SAFETY_TERMS = [
  "anticoagulant",
  "anticoagulation",
  "bleeding",
  "coagulopathy",
  "doac",
  "inr",
  "platelet",
  "reversal",
  "thrombolysis",
  "warfarin",
  "출혈",
  "항응고",
];

const CARDIAC_TAMPONADE_CAUSE_COMPLICATION_SAFETY_TERMS = [
  "aortic dissection",
  "iatrogenic",
  "malignancy",
  "myocardial infarction",
  "myocardial rupture",
  "renal failure",
  "trauma",
  "uremia",
  "감별",
  "외상",
];

const CARDIAC_TAMPONADE_VENTILATION_PRELOAD_SAFETY_TERMS = [
  "avoid diuresis",
  "avoid diuretics",
  "avoid intubation",
  "avoid mechanical ventilation",
  "avoid positive pressure",
  "avoid positive-pressure",
  "do not intubate",
  "intubation only if necessary",
  "minimize positive pressure",
  "positive pressure ventilation should be avoided",
  "positive-pressure mechanical ventilation should be avoided",
  "preload optimization",
  "preserve preload",
  "양압환기 피",
  "삽관 피",
];

const UNSTABLE_TACHYARRHYTHMIA_CONTEXT_TERMS = [
  "af with rvr",
  "atrial fibrillation with rapid ventricular response",
  "monomorphic vt",
  "polymorphic vt",
  "supraventricular tachycardia with instability",
  "svt with instability",
  "unstable tachyarrhythmia",
  "unstable tachycardia",
  "ventricular tachycardia",
  "vt with pulse",
  "wide complex tachycardia",
  "wide-complex tachycardia",
  "불안정 빈맥",
  "심실빈맥",
];

const UNSTABLE_TACHYARRHYTHMIA_RISK_TERMS = [
  "altered mental status",
  "chest pain",
  "heart failure",
  "hypoperfusion",
  "hypotension",
  "ischemia",
  "pulmonary edema",
  "shock",
  "syncope",
  "weak pulse",
];

const UNSTABLE_TACHYARRHYTHMIA_MONITOR_ACTION_TERMS = [
  "12-lead ecg",
  "cardiac monitor",
  "defibrillator pads",
  "ecg",
  "ekg",
  "iv access",
  "monitor",
  "telemetry",
  "심전도",
];

const UNSTABLE_TACHYARRHYTHMIA_PULSE_INSTABILITY_ACTION_TERMS = [
  "altered mental status",
  "chest pain",
  "hypotension",
  "instability",
  "ischemia",
  "pulse check",
  "pulmonary edema",
  "shock",
  "unstable",
  "맥박",
  "불안정",
];

const UNSTABLE_TACHYARRHYTHMIA_CARDIOVERSION_ACTION_TERMS = [
  "immediate cardioversion",
  "immediate synchronized cardioversion",
  "immediate synchronized shock",
  "prompt cardioversion",
  "prompt synchronized cardioversion",
  "synchronized cardioversion",
  "synchronized shock",
  "synchronised cardioversion",
  "sync mode",
  "urgent synchronized cardioversion",
  "동기화",
  "전기적 심율동전환",
];

const UNSTABLE_TACHYARRHYTHMIA_REVERSIBLE_CAUSE_ACTION_TERMS = [
  "calcium",
  "electrolyte",
  "hypokalemia",
  "hypoxia",
  "ischemia",
  "magnesium",
  "potassium",
  "qtc",
  "torsades",
  "전해질",
];

const UNSTABLE_TACHYARRHYTHMIA_ESCALATION_ACTION_TERMS = [
  "acls",
  "cardiology",
  "defibrillation",
  "expert consultation",
  "icu",
  "pulseless",
  "전문가",
  "중환자",
];

const UNSTABLE_TACHYARRHYTHMIA_SEDATION_NO_DELAY_SAFETY_TERMS = [
  "do not delay",
  "do not delay cardioversion",
  "do not delay shock",
  "if feasible without delay",
  "sedation if feasible",
  "sedation if it does not delay",
  "sedation without delaying",
  "without delaying cardioversion",
  "without delaying shock",
  "지연 없이",
];

const UNSTABLE_TACHYARRHYTHMIA_SYNC_UNSYNC_SAFETY_TERMS = [
  "defibrillation if pulseless",
  "synchronized cardioversion",
  "synchronized shock",
  "synchronized versus unsynchronized",
  "synchronized vs unsynchronized",
  "unsynchronized defibrillation if pulseless",
  "unsynchronized if pulseless",
  "unsynchronized shock if pulseless",
  "unsynchronized shock for polymorphic",
  "sync mode",
  "동기화",
];

const UNSTABLE_TACHYARRHYTHMIA_WIDE_IRREGULAR_SAFETY_TERMS = [
  "av nodal blocker",
  "beta blocker",
  "diltiazem",
  "digoxin",
  "irregular wide",
  "pre-excitation",
  "preexcited",
  "verapamil",
  "wpw",
];

const UNSTABLE_TACHYARRHYTHMIA_ANTIARRHYTHMIC_SAFETY_TERMS = [
  "amiodarone",
  "hypotension",
  "magnesium",
  "procainamide",
  "prolonged qt",
  "qtc",
  "sotalol",
  "torsades",
];

const UNSTABLE_TACHYARRHYTHMIA_CAUSE_DISPOSITION_SAFETY_TERMS = [
  "acute coronary syndrome",
  "electrolyte",
  "hypoxia",
  "ischemia",
  "magnesium",
  "potassium",
  "thyroid",
  "toxin",
];

const SYMPTOMATIC_BRADYCARDIA_CONTEXT_TERMS = [
  "bradycardia with hypotension",
  "complete heart block",
  "high grade av block",
  "high-grade av block",
  "mobitz ii",
  "second-degree type ii",
  "symptomatic bradycardia",
  "third degree av block",
  "third-degree av block",
  "unstable bradycardia",
  "완전 방실 차단",
  "증상성 서맥",
];

const SYMPTOMATIC_BRADYCARDIA_RISK_TERMS = [
  "acute heart failure",
  "altered mental status",
  "chest pain",
  "heart block",
  "hypoperfusion",
  "hypotension",
  "ischemia",
  "shock",
  "syncope",
  "weak pulse",
];

const SYMPTOMATIC_BRADYCARDIA_MONITOR_ACTION_TERMS = [
  "12-lead ecg",
  "cardiac monitor",
  "ecg",
  "ekg",
  "iv access",
  "monitor",
  "oxygen",
  "telemetry",
  "심전도",
];

const SYMPTOMATIC_BRADYCARDIA_INSTABILITY_ACTION_TERMS = [
  "acute heart failure",
  "altered mental status",
  "chest pain",
  "hypoperfusion",
  "hypotension",
  "ischemia",
  "pulse check",
  "shock",
  "unstable",
  "불안정",
  "저혈압",
];

const SYMPTOMATIC_BRADYCARDIA_ATROPINE_ACTION_TERMS = ["atropine", "아트로핀"];

const SYMPTOMATIC_BRADYCARDIA_PACING_ACTION_TERMS = [
  "pacing",
  "transcutaneous pacing",
  "transvenous pacing",
  "tcp",
  "temporary pacemaker",
  "박동조율",
];

const SYMPTOMATIC_BRADYCARDIA_CHRONOTROPE_ACTION_TERMS = [
  "dopamine",
  "epinephrine",
  "chronotropic",
  "드파민",
  "에피네프린",
];

const SYMPTOMATIC_BRADYCARDIA_REVERSIBLE_CAUSE_ACTION_TERMS = [
  "acute coronary syndrome",
  "beta blocker",
  "calcium channel blocker",
  "digoxin",
  "electrolyte",
  "hyperkalemia",
  "hypoxia",
  "inferior mi",
  "potassium",
  "toxin",
];

const SYMPTOMATIC_BRADYCARDIA_NO_DELAY_PACING_SAFETY_TERMS = [
  "do not delay pacing",
  "do not delay transcutaneous pacing",
  "immediate pacing",
  "immediate transcutaneous pacing",
  "pacing while atropine",
  "prepare pacing while atropine",
  "urgent pacing",
  "urgent transcutaneous pacing",
  "지연 없이 박동조율",
];

const SYMPTOMATIC_BRADYCARDIA_ATROPINE_REFERENCE_SAFETY_TERMS = [
  "atropine",
  "아트로핀",
];

const SYMPTOMATIC_BRADYCARDIA_ATROPINE_LIMIT_SAFETY_TERMS = [
  "heart transplant",
  "high-grade av block",
  "ineffective",
  "may be ineffective",
  "mobitz ii",
  "third-degree",
  "transplanted",
];

const SYMPTOMATIC_BRADYCARDIA_PACING_CAPTURE_SAFETY_TERMS = [
  "capture",
  "confirm capture",
  "electrical and mechanical capture",
  "electrical capture",
  "mechanical capture",
];

const SYMPTOMATIC_BRADYCARDIA_PACING_COMFORT_SAFETY_TERMS = [
  "analgesia",
  "analgesia when feasible",
  "sedation",
  "sedation or analgesia",
  "sedation when feasible",
  "진정",
];

const SYMPTOMATIC_BRADYCARDIA_PACING_ROUTE_SAFETY_TERMS = [
  "transcutaneous pacing",
  "transvenous pacing",
  "temporary pacemaker",
];

const SYMPTOMATIC_BRADYCARDIA_CHRONOTROPE_AGENT_SAFETY_TERMS = [
  "dopamine",
  "epinephrine",
  "드파민",
  "에피네프린",
];

const SYMPTOMATIC_BRADYCARDIA_CHRONOTROPE_ADVERSE_SAFETY_TERMS = [
  "arrhythmia",
  "extravasation",
  "ischemia",
  "tachyarrhythmia",
];

const SYMPTOMATIC_BRADYCARDIA_CAUSE_DISPOSITION_SAFETY_TERMS = [
  "acute coronary syndrome",
  "cardiology",
  "electrolyte",
  "hyperkalemia",
  "hypothermia",
  "hypoxia",
  "pacemaker",
  "toxin",
];

const TENSION_PNEUMOTHORAX_CONTEXT_TERMS = [
  "tension pneumothorax",
  "tension physiology",
  "traumatic pneumothorax with shock",
  "unstable pneumothorax",
  "긴장성 기흉",
];

const TENSION_PNEUMOTHORAX_DECOMPRESSION_ACTION_TERMS = [
  "chest decompression",
  "finger thoracostomy",
  "immediate chest decompression",
  "immediate finger thoracostomy",
  "immediate needle decompression",
  "immediate needle thoracostomy",
  "needle decompression",
  "needle thoracostomy",
  "urgent finger thoracostomy",
  "urgent needle decompression",
  "감압",
  "흉강천자",
];

const TENSION_PNEUMOTHORAX_CHEST_TUBE_ACTION_TERMS = [
  "chest drain",
  "chest tube",
  "tube thoracostomy",
  "thoracostomy tube",
  "흉관",
];

const TENSION_PNEUMOTHORAX_AIRWAY_OXYGEN_ACTION_TERMS = [
  "airway",
  "bag-valve",
  "bvm",
  "oxygen",
  "respiratory failure",
  "ventilation",
  "기도",
  "산소",
  "환기",
];

const TENSION_PNEUMOTHORAX_REASSESSMENT_ACTION_TERMS = [
  "breath sounds",
  "hemodynamic",
  "imaging after",
  "lung sliding",
  "reassessment",
  "repeat exam",
  "ultrasound",
  "vital signs",
  "재평가",
];

const TENSION_PNEUMOTHORAX_NO_DELAY_SAFETY_TERMS = [
  "do not delay decompression",
  "do not delay needle decompression",
  "do not delay thoracostomy",
  "immediate decompression",
  "immediate needle decompression",
  "no imaging delay",
  "without waiting for imaging",
  "x-ray should not delay",
  "ct should not delay",
  "영상 지연 없이",
];

const TENSION_PNEUMOTHORAX_SITE_SAFETY_TERMS = [
  "4th intercostal",
  "5th intercostal",
  "anterior axillary",
  "axillary",
  "intercostal site",
  "midaxillary",
  "midclavicular",
  "second intercostal",
  "위치",
];

const TENSION_PNEUMOTHORAX_TECHNIQUE_SAFETY_TERMS = [
  "above the rib",
  "angiocatheter",
  "large-bore",
  "long angiocatheter",
  "sterile",
  "technique",
  "카테터",
];

const TENSION_PNEUMOTHORAX_RECURRENCE_FAILURE_SAFETY_TERMS = [
  "catheter failure",
  "chest tube patency",
  "persistent air leak",
  "recurrent",
  "reexpansion",
  "repeat decompression",
  "specialty consultation",
  "tube position",
  "재발",
];

const TENSION_PNEUMOTHORAX_DIFFERENTIAL_SAFETY_TERMS = [
  "cardiac tamponade",
  "hemothorax",
  "massive hemothorax",
  "obstructive shock",
  "pulmonary embolism",
  "sudden cardiovascular collapse",
  "감별",
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
  "fibrinolysis",
  "mechanical thrombectomy",
  "tenecteplase",
  "thrombectomy",
  "thrombolysis",
  "thrombolytic",
  "tnk",
  "tpa",
  "혈전용해",
  "혈전제거",
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

const STROKE_VASCULAR_IMAGING_SAFETY_TERMS = [
  "cta",
  "ct angiography",
  "ct perfusion",
  "mra",
  "mr angiography",
  "mr perfusion",
  "perfusion",
  "vascular imaging",
];

const STROKE_THROMBECTOMY_OCCLUSION_SAFETY_TERMS = [
  "large vessel occlusion",
  "lvo",
];

const STROKE_THROMBECTOMY_SELECTION_DETAIL_SAFETY_TERMS = [
  "24 hours",
  "6 hours",
  "aspects",
  "modified rankin",
  "mrs",
  "nihss",
  "salvageable",
];

const STROKE_SERVICE_MONITORING_SAFETY_TERMS = [
  "complication",
  "follow-up imaging",
  "post-thrombolysis",
  "re-imaging",
  "stroke physician",
  "stroke service",
  "stroke unit",
  "thrombolysis protocol",
];

const STROKE_ANTIPLATELET_TIMING_SAFETY_TERMS = [
  "anticoagulation",
  "antiplatelet",
  "aspirin",
  "delay antiplatelet",
  "enteral",
  "rectal",
  "swallow route",
];

const STROKE_HOMEOSTASIS_SWALLOW_SAFETY_TERMS = [
  "blood glucose",
  "dysphagia",
  "glucose",
  "oxygen",
  "oxygen saturation",
  "spo2",
  "swallow",
  "temperature",
];

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

const PE_ANTICOAGULATION_OR_REPERFUSION_ACTION_TERMS = [
  "apixaban",
  "continuous ufh infusion",
  "dabigatran",
  "dalteparin",
  "direct oral anticoagulant",
  "direct-acting oral anticoagulant",
  "doac",
  "edoxaban",
  "enoxaparin",
  "fondaparinux",
  "heparin",
  "heparin infusion",
  "interim therapeutic anticoagulation",
  "low molecular weight heparin",
  "lmwh",
  "rivaroxaban",
  "systemic thrombolysis",
  "therapeutic anticoagulation",
  "thrombolysis",
  "unfractionated heparin",
  "ufh infusion",
  "ufh",
  "치료적 항응고",
  "항응고 치료",
  "헤파린",
  "혈전용해",
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

const PE_ANTICOAGULATION_INITIATION_SAFETY_TERMS = [
  "anticoagulation",
  "anticoagulant",
  "contraindication",
  "heparin",
  "lmwh",
  "unfractionated",
  "항응고",
];

const PE_SYSTEMIC_THROMBOLYSIS_REVIEW_SAFETY_TERMS = [
  "alteplase",
  "systemic thrombolysis",
  "thrombolysis indication",
  "thrombolytic",
  "혈전용해",
];

const PE_SYSTEMIC_THROMBOLYSIS_HIGH_RISK_SAFETY_TERMS = [
  "cardiac arrest",
  "hemodynamic instability",
  "high-risk pe",
  "hypotension",
  "obstructive shock",
  "persistent hypotension",
  "shock",
];

const PE_CATHETER_SURGICAL_BACKUP_SAFETY_TERMS = [
  "catheter directed",
  "catheter-directed",
  "catheter embolectomy",
  "catheter intervention",
  "catheter-directed thrombolysis",
  "contraindication to thrombolysis",
  "embolectomy",
  "failed thrombolysis",
  "surgical embolectomy",
  "thrombolysis contraindicated",
  "thrombolysis failure",
];

const PE_UNSTABLE_IMAGING_SAFETY_TERMS = [
  "bedside echo",
  "bedside ultrasound",
  "ctpa delay",
  "do not delay",
  "hemodynamically unstable",
  "hypotension",
  "shock",
  "unstable",
  "불안정",
];

const PE_ALTERNATIVE_IMAGING_SAFETY_TERMS = [
  "compression ultrasound",
  "contrast allergy",
  "duplex ultrasound",
  "pregnancy",
  "renal",
  "v/q",
  "ventilation perfusion",
  "대체 영상",
];

const PE_PERT_DISPOSITION_SAFETY_TERMS = [
  "critical care",
  "icu",
  "intensive care",
  "pert",
  "pulmonary embolism response team",
  "specialist",
  "transfer",
  "중환자",
];

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
  "cath lab",
  "cardiac catheterization",
  "door-to-balloon",
  "door to balloon",
  "fibrinolysis",
  "primary pci",
  "pci",
  "reperfusion",
  "thrombolysis",
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

const ACS_NITRATE_SAFETY_TERMS = [
  "inferior infarct",
  "inferior mi",
  "nitroglycerin",
  "nitrate",
  "pde5",
  "right ventricular",
  "rv infarct",
  "sildenafil",
];

const ACS_OXYGEN_SAFETY_TERMS = [
  "avoid routine oxygen",
  "hypoxia",
  "low spo2",
  "oxygen only",
  "oxygen saturation",
  "spo2",
];

const ACS_BETA_BLOCKER_SAFETY_TERMS = [
  "av block",
  "beta blocker",
  "beta-blocker",
  "bradycardia",
  "bronchospasm",
  "heart failure",
  "shock",
];

const ACS_REPERFUSION_TIMING_SAFETY_TERMS = [
  "door to balloon",
  "door-to-balloon",
  "door-to-needle",
  "fibrinolysis contraindication",
  "pci 90",
  "transfer 120",
];

const AORTIC_DISSECTION_CONTEXT_TERMS = [
  "acute aortic syndrome",
  "aortic dissection",
  "ascending aortic dissection",
  "stanford type a",
  "stanford type b",
  "type a dissection",
  "type b dissection",
  "대동맥박리",
  "대동맥 박리",
];

const AORTIC_DISSECTION_IMAGING_ACTION_TERMS = [
  "ct angiography",
  "cta",
  "mra",
  "tee",
  "transesophageal echo",
  "transesophageal echocardiography",
  "대동맥 조영",
  "식도초음파",
  "조영 ct",
];

const AORTIC_DISSECTION_ANTI_IMPULSE_ACTION_TERMS = [
  "anti-impulse",
  "beta blocker",
  "beta-blocker",
  "blood pressure",
  "esmolol",
  "heart rate",
  "impulse",
  "labetalol",
  "pain control",
  "sbp",
  "베타차단제",
  "심박",
  "진통",
  "혈압",
];

const AORTIC_DISSECTION_SURGICAL_TEAM_ACTION_TERMS = [
  "aortic team",
  "cardiac surgery",
  "cardiothoracic",
  "cardiothoracic surgery",
  "transfer",
  "vascular surgery",
  "대동맥팀",
  "심장외과",
  "전원",
  "혈관외과",
];

const AORTIC_DISSECTION_REPAIR_PATHWAY_ACTION_TERMS = [
  "aortic replacement",
  "aortic repair",
  "ascending aortic repair",
  "bentall",
  "complicated type b tevar",
  "endovascular repair",
  "endovascular stent",
  "emergent open repair",
  "intimal tear excision",
  "open aortic repair",
  "open repair",
  "operative repair",
  "surgical repair",
  "tevar",
  "thoracic endovascular aortic repair",
  "urgent surgical repair",
  "대동맥 수복",
  "응급 수술",
];

const AORTIC_DISSECTION_ANTITHROMBOTIC_SAFETY_TERMS = [
  "anticoagulation",
  "anticoagulant",
  "antiplatelet",
  "avoid thrombolysis",
  "heparin",
  "thrombolysis",
  "thrombolytic",
  "항응고",
  "항혈소판",
  "혈전용해",
];

const AORTIC_DISSECTION_VASODILATOR_SAFETY_TERMS = [
  "beta blocker before vasodilator",
  "beta-blocker before vasodilator",
  "esmolol",
  "heart rate",
  "reflex tachycardia",
  "vasodilator",
  "베타차단제",
  "혈관확장제",
];

const AORTIC_DISSECTION_COMPLICATION_SAFETY_TERMS = [
  "aortic regurgitation",
  "branch vessel",
  "malperfusion",
  "neurologic deficit",
  "pericardial effusion",
  "pulse deficit",
  "rupture",
  "tamponade",
  "대동맥판막",
  "맥박",
  "심낭",
  "장기허혈",
  "파열",
];

const AORTIC_DISSECTION_MONITORING_ACCESS_SAFETY_TERMS = [
  "arterial line",
  "central venous",
  "continuous bp",
  "continuous blood pressure",
  "foley",
  "monitoring",
  "telemetry",
  "urine output",
  "동맥라인",
  "소변량",
];

const AORTIC_DISSECTION_ANALGESIA_SAFETY_TERMS = [
  "analgesia",
  "morphine",
  "opioid",
  "pain control",
  "sympathetic tone",
  "진통",
];

const AORTIC_DISSECTION_TARGET_SAFETY_TERMS = [
  "100-120",
  "100 to 120",
  "heart rate 60",
  "heart rate target",
  "hr 60",
  "sbp 100",
  "sbp target",
  "systolic blood pressure",
  "목표 혈압",
  "목표 심박",
];

const AORTIC_DISSECTION_DEFINITIVE_PATHWAY_SAFETY_TERMS = [
  "complicated type b",
  "endovascular",
  "open surgery",
  "surgical emergency",
  "tevar",
  "urgent surgical",
  "응급 수술",
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

function hasAnaphylaxisMedicationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRepeatImEpinephrine = ANAPHYLAXIS_REPEAT_IM_EPINEPHRINE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasIvEpinephrineSafety = ANAPHYLAXIS_IV_EPINEPHRINE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAdjunctNotFirstLine = ANAPHYLAXIS_ADJUNCT_NOT_FIRST_LINE_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRefractoryEscalation = ANAPHYLAXIS_REFRACTORY_ESCALATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasRepeatImEpinephrine &&
    hasIvEpinephrineSafety &&
    hasAdjunctNotFirstLine &&
    hasRefractoryEscalation
  );
}

function requiresEpiglottitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const diagnosisText = String(detail.diagnosis ?? "").toLowerCase();
  const hasDirectDiagnosis = EPIGLOTTITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(diagnosisText, term),
  );
  const hasDirectContext = EPIGLOTTITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasAirwayContext = EPIGLOTTITIS_AIRWAY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasHighSpecificityContext = EPIGLOTTITIS_HIGH_SPECIFICITY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasCroupContext = CROUP_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return (
    hasDirectDiagnosis ||
    (hasDirectContext && !hasCroupContext) ||
    (hasAirwayContext && hasHighSpecificityContext && !hasCroupContext)
  );
}

function hasEpiglottitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirwayPlan = EPIGLOTTITIS_AIRWAY_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialistEscalation = EPIGLOTTITIS_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotics = EPIGLOTTITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = EPIGLOTTITIS_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAirwayPlan && hasSpecialistEscalation && hasAntibiotics && hasMonitoring;
}

function hasEpiglottitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAgitationSafety = EPIGLOTTITIS_AGITATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAirwayBackup = EPIGLOTTITIS_AIRWAY_BACKUP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidAdjunct = EPIGLOTTITIS_STEROID_ADJUNCT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationRisk = EPIGLOTTITIS_COMPLICATION_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasAgitationSafety && hasAirwayBackup && hasSteroidAdjunct && hasComplicationRisk;
}

function requiresDeepNeckInfectionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = DEEP_NECK_INFECTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = DEEP_NECK_INFECTION_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasDeepNeckInfectionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirway = DEEP_NECK_AIRWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialist = DEEP_NECK_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotics = DEEP_NECK_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImagingSource = DEEP_NECK_IMAGING_SOURCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAirway && hasSpecialist && hasAntibiotics && hasImagingSource;
}

function hasDeepNeckInfectionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAirwayFirst = DEEP_NECK_AIRWAY_FIRST_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAvoidAirwayHarm = DEEP_NECK_AVOID_AIRWAY_HARM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMrsaImmunocompromised = DEEP_NECK_MRSA_IMMUNOCOMPROMISED_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDrainageComplication = DEEP_NECK_DRAINAGE_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasAirwayFirst && hasAvoidAirwayHarm && hasMrsaImmunocompromised && hasDrainageComplication;
}

function requiresCroupSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = CROUP_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasSeverityRisk = CROUP_SEVERITY_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasSeverityRisk;
}

function hasCroupTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSeverityAssessment = CROUP_SEVERITY_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDexamethasone = CROUP_DEXAMETHASONE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEpinephrine = CROUP_EPINEPHRINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwayEscalation = CROUP_AIRWAY_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasSeverityAssessment && hasDexamethasone && hasEpinephrine && hasAirwayEscalation;
}

function hasCroupTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasObservation = CROUP_EPINEPHRINE_OBSERVATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialRedFlags = CROUP_DIFFERENTIAL_RED_FLAG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLowValueTherapySafety = CROUP_LOW_VALUE_THERAPY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionEscalation = CROUP_DISPOSITION_ESCALATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasObservation &&
    hasDifferentialRedFlags &&
    hasLowValueTherapySafety &&
    hasDispositionEscalation
  );
}

function requiresForeignBodyAirwaySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = FOREIGN_BODY_AIRWAY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = FOREIGN_BODY_AIRWAY_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasForeignBodyAirwayTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAssessment = FOREIGN_BODY_AIRWAY_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInfantManeuvers = FOREIGN_BODY_AIRWAY_INFANT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasChildAdultManeuvers = FOREIGN_BODY_AIRWAY_CHILD_ADULT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBronchoscopyEscalation = FOREIGN_BODY_AIRWAY_BRONCHOSCOPY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAssessment && hasInfantManeuvers && hasChildAdultManeuvers && hasBronchoscopyEscalation;
}

function hasForeignBodyAirwayTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoBlindSweep = FOREIGN_BODY_AIRWAY_NO_BLIND_SWEEP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasXrayLimitation = FOREIGN_BODY_AIRWAY_XRAY_LIMITATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPartialObstruction = FOREIGN_BODY_AIRWAY_PARTIAL_OBSTRUCTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostRemoval = FOREIGN_BODY_AIRWAY_POST_REMOVAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasNoBlindSweep && hasXrayLimitation && hasPartialObstruction && hasPostRemoval;
}

function requiresOrbitalCellulitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = ORBITAL_CELLULITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasEyeContext = ORBITAL_CELLULITIS_EYE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasOrbitalSigns = ORBITAL_CELLULITIS_ORBITAL_SIGNS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasEyeContext && hasOrbitalSigns);
}

function hasOrbitalCellulitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOrbitalAssessment = ORBITAL_CELLULITIS_ORBITAL_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImaging = ORBITAL_CELLULITIS_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotics = ORBITAL_CELLULITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialistSourceControl = ORBITAL_CELLULITIS_SPECIALIST_SOURCE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return hasOrbitalAssessment && hasImaging && hasAntibiotics && hasSpecialistSourceControl;
}

function hasOrbitalCellulitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPreseptalDifferentiation =
    ORBITAL_CELLULITIS_PRESEPTAL_DIFFERENTIATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAbscessSurgery = ORBITAL_CELLULITIS_ABSCESS_SURGERY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasIntracranialSafety = ORBITAL_CELLULITIS_INTRACRANIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMonitoring = ORBITAL_CELLULITIS_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasPreseptalDifferentiation && hasAbscessSurgery && hasIntracranialSafety && hasMonitoring;
}

function requiresGiBleedSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.physical_exam),
  ]
    .join(" ")
    .toLowerCase();
  return GI_BLEED_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasGiBleedTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasResuscitation = GI_BLEED_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodPrep = GI_BLEED_BLOOD_PREP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceControl = GI_BLEED_SOURCE_CONTROL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasResuscitation && hasBloodPrep && hasSourceControl;
}

function hasGiBleedTransfusionReversalSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasReversalReview = GI_BLEED_REVERSAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransfusionSafety = GI_BLEED_TRANSFUSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasReversalReview && hasTransfusionSafety;
}

function requiresCnsInfectionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return CNS_INFECTION_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasCnsInfectionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCultures = CNS_INFECTION_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotics = CNS_INFECTION_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNoDelay = CNS_INFECTION_NO_DELAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLpOrCtPathway = CNS_INFECTION_LP_CT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSteroidTiming = CNS_INFECTION_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCultures && hasAntibiotics && hasNoDelay && hasLpOrCtPathway && hasSteroidTiming;
}

function hasCnsInfectionLpSteroidSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntimicrobialSafety = CNS_INFECTION_ANTIMICROBIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLpSafety = CNS_INFECTION_LP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidTiming = CNS_INFECTION_STEROID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasAntimicrobialSafety && hasLpSafety && hasSteroidTiming;
}

function hasCnsInfectionDelayCoverageSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDelaySafety = CNS_INFECTION_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCtBeforeLpIndication = CNS_INFECTION_CT_BEFORE_LP_INDICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasListeriaCoverage = CNS_INFECTION_LISTERIA_COVERAGE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDelaySafety && hasCtBeforeLpIndication && hasListeriaCoverage;
}

function requiresEncephalitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = ENCEPHALITIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = ENCEPHALITIS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function requiresImmunocompromisedEncephalitisSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
  if (!requiresEncephalitisSafetyCheck(detail)) {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return IMMUNOCOMPROMISED_ENCEPHALITIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasEncephalitisRedFlags(redFlags: string[]): boolean {
  const normalizedRedFlags = redFlags.join(" ").toLowerCase();
  const hasMentalStatus = ENCEPHALITIS_MENTAL_STATUS_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
  const hasFocalSeizure = ENCEPHALITIS_FOCAL_SEIZURE_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
  return hasMentalStatus && hasFocalSeizure;
}

function hasEncephalitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAcyclovir = ENCEPHALITIS_ACYCLOVIR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroimaging = ENCEPHALITIS_NEUROIMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCsfHsv = ENCEPHALITIS_CSF_HSV_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEegSeizure = ENCEPHALITIS_EEG_SEIZURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAcyclovir && hasNeuroimaging && hasCsfHsv && hasEegSeizure;
}

function hasEncephalitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAcyclovirRenalSafety = ENCEPHALITIS_ACYCLOVIR_RENAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNoDelaySafety = ENCEPHALITIS_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRepeatPcrSafety = ENCEPHALITIS_REPEAT_PCR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialEmpiricSafety = ENCEPHALITIS_DIFFERENTIAL_EMPIRIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAcyclovirRenalSafety &&
    hasNoDelaySafety &&
    hasRepeatPcrSafety &&
    hasDifferentialEmpiricSafety
  );
}

function hasImmunocompromisedEncephalitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHerpesvirusSafety = IMMUNOCOMPROMISED_ENCEPHALITIS_HERPESVIRUS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasOpportunisticSafety =
    IMMUNOCOMPROMISED_ENCEPHALITIS_OPPORTUNISTIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasHostRiskSafety = IMMUNOCOMPROMISED_ENCEPHALITIS_HOST_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasHerpesvirusSafety && hasOpportunisticSafety && hasHostRiskSafety;
}

function requiresSuicideSelfHarmSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SUICIDE_SELF_HARM_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = SUICIDE_SELF_HARM_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasSuicideSelfHarmTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRiskAssessment = SUICIDE_RISK_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMeansRestriction = SUICIDE_MEANS_RESTRICTION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasObservationEscalation = SUICIDE_OBSERVATION_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCrisisResource = SUICIDE_CRISIS_RESOURCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasRiskAssessment && hasMeansRestriction && hasObservationEscalation && hasCrisisResource;
}

function hasSuicideSelfHarmTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPastAttemptReview = SUICIDE_PAST_ATTEMPT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSubstanceMedicalReview = SUICIDE_SUBSTANCE_MEDICAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionSafety = SUICIDE_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSupportFollowup = SUICIDE_SUPPORT_FOLLOWUP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPastAttemptReview &&
    hasSubstanceMedicalReview &&
    hasDispositionSafety &&
    hasSupportFollowup
  );
}

function requiresMeningococcemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = MENINGOCOCCEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = MENINGOCOCCEMIA_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasMeningococcemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCulture = MENINGOCOCCEMIA_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCephalosporin = MENINGOCOCCEMIA_CEPHALOSPORIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasShockResuscitation = MENINGOCOCCEMIA_SHOCK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPrecautions = MENINGOCOCCEMIA_PRECAUTION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCulture && hasCephalosporin && hasShockResuscitation && hasPrecautions;
}

function hasMeningococcemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntibioticDelaySafety = MENINGOCOCCEMIA_ANTIBIOTIC_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfectionControl = MENINGOCOCCEMIA_INFECTION_CONTROL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasContactPublicHealth = MENINGOCOCCEMIA_CONTACT_PUBLIC_HEALTH_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagulationComplication =
    MENINGOCOCCEMIA_COAGULATION_COMPLICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasAntibioticDelaySafety &&
    hasInfectionControl &&
    hasContactPublicHealth &&
    hasCoagulationComplication
  );
}

function requiresFebrileInfantSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    detail.patient_demographics?.age === 0 ? "infant neonate" : "",
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = FEBRILE_INFANT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = FEBRILE_INFANT_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasFebrileInfantTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAgeStratification = FEBRILE_INFANT_AGE_STRATIFICATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodCulture = FEBRILE_INFANT_BLOOD_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrineCulture = FEBRILE_INFANT_URINE_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCsfPathway = FEBRILE_INFANT_CSF_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInflammatoryMarkers = FEBRILE_INFANT_INFLAMMATORY_MARKER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotics = FEBRILE_INFANT_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHsvReview = FEBRILE_INFANT_HSV_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAgeStratification &&
    hasBloodCulture &&
    hasUrineCulture &&
    hasCsfPathway &&
    hasInflammatoryMarkers &&
    hasAntibiotics &&
    hasHsvReview
  );
}

function hasFebrileInfantTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntibioticDelaySafety = FEBRILE_INFANT_ANTIBIOTIC_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCeftriaxoneSafety = FEBRILE_INFANT_CEFTRIAXONE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionSafety = FEBRILE_INFANT_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLowRiskFollowup = FEBRILE_INFANT_LOW_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAntibioticDelaySafety &&
    hasCeftriaxoneSafety &&
    hasDispositionSafety &&
    hasLowRiskFollowup
  );
}

function requiresNeonatalSepsisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    detail.patient_demographics?.age === 0 ? "infant neonate" : "",
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = NEONATAL_SEPSIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasNeonatalContext = NEONATAL_SEPSIS_NEONATAL_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = NEONATAL_SEPSIS_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasMaternalRisk = NEONATAL_SEPSIS_MATERNAL_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasNeonatalContext && (hasRisk || hasMaternalRisk);
}

function hasNeonatalSepsisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAssessment = NEONATAL_SEPSIS_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodCulture = NEONATAL_SEPSIS_CULTURE_CRP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBaselineMarker = NEONATAL_SEPSIS_BASELINE_MARKER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBetaLactam = NEONATAL_SEPSIS_BETA_LACTAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasGramNegativeCoverage = NEONATAL_SEPSIS_GRAM_NEGATIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLpPathway = NEONATAL_SEPSIS_LP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasStabilization = NEONATAL_SEPSIS_STABILIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAssessment &&
    hasBloodCulture &&
    hasBaselineMarker &&
    hasBetaLactam &&
    hasGramNegativeCoverage &&
    hasLpPathway &&
    hasStabilization
  );
}

function hasNeonatalSepsisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntibioticDelaySafety = NEONATAL_SEPSIS_ANTIBIOTIC_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLpContraindicationSafety = NEONATAL_SEPSIS_LP_CONTRAINDICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasGentamicinSafety = NEONATAL_SEPSIS_GENTAMICIN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDurationReassessmentSafety =
    NEONATAL_SEPSIS_DURATION_REASSESSMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasAntibioticDelaySafety &&
    hasLpContraindicationSafety &&
    hasGentamicinSafety &&
    hasDurationReassessmentSafety
  );
}

function requiresNeonatalHsvSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    detail.patient_demographics?.age === 0 ? "infant neonate" : "",
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = NEONATAL_HSV_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasNeonatalContext = NEONATAL_HSV_NEONATAL_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = NEONATAL_HSV_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasNeonatalContext && hasRisk;
}

function hasNeonatalHsvTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAcyclovir = NEONATAL_HSV_ACYCLOVIR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurfaceLesionTesting = NEONATAL_HSV_SURFACE_LESION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCsfTesting = NEONATAL_HSV_CSF_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodAltTesting = NEONATAL_HSV_BLOOD_ALT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSepsisCoverage = NEONATAL_HSV_SEPSIS_COVERAGE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAcyclovir &&
    hasSurfaceLesionTesting &&
    hasCsfTesting &&
    hasBloodAltTesting &&
    hasSepsisCoverage
  );
}

function hasNeonatalHsvTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDurationRepeatCsf = NEONATAL_HSV_DURATION_REPEAT_CSF_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRenalAncSafety = NEONATAL_HSV_RENAL_ANC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOphthalmologyNeuroSafety = NEONATAL_HSV_OPHTHALMOLOGY_NEURO_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasExpertExposureSafety = NEONATAL_HSV_EXPERT_EXPOSURE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDurationRepeatCsf &&
    hasRenalAncSafety &&
    hasOphthalmologyNeuroSafety &&
    hasExpertExposureSafety
  );
}

function requiresNeonatalHyperbilirubinemiaSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = NEONATAL_HYPERBILIRUBINEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = NEONATAL_HYPERBILIRUBINEMIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasNeonatalHyperbilirubinemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasThresholdAssessment = NEONATAL_HYPERBILIRUBINEMIA_THRESHOLD_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasPhototherapy = NEONATAL_HYPERBILIRUBINEMIA_PHOTOTHERAPY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = NEONATAL_HYPERBILIRUBINEMIA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLabTrend = NEONATAL_HYPERBILIRUBINEMIA_LAB_TREND_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasThresholdAssessment && hasPhototherapy && hasEscalation && hasLabTrend;
}

function hasNeonatalHyperbilirubinemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNeurotoxicityRiskSafety =
    NEONATAL_HYPERBILIRUBINEMIA_NEUROTOXICITY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAcuteEncephalopathySafety =
    NEONATAL_HYPERBILIRUBINEMIA_ACUTE_ENCEPHALOPATHY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDirectBilirubinSafety =
    NEONATAL_HYPERBILIRUBINEMIA_DIRECT_BILIRUBIN_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasFollowupSafety = NEONATAL_HYPERBILIRUBINEMIA_FOLLOWUP_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNeurotoxicityRiskSafety &&
    hasAcuteEncephalopathySafety &&
    hasDirectBilirubinSafety &&
    hasFollowupSafety
  );
}

function requiresAbusiveHeadTraumaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = ABUSIVE_HEAD_TRAUMA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = ABUSIVE_HEAD_TRAUMA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasAbusiveHeadTraumaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasStabilization = ABUSIVE_HEAD_TRAUMA_STABILIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroimaging = ABUSIVE_HEAD_TRAUMA_NEUROIMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSkeletalSurvey = ABUSIVE_HEAD_TRAUMA_SKELETAL_SURVEY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOphthalmology = ABUSIVE_HEAD_TRAUMA_OPHTHALMOLOGY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasProtection = ABUSIVE_HEAD_TRAUMA_PROTECTION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasStabilization &&
    hasNeuroimaging &&
    hasSkeletalSurvey &&
    hasOphthalmology &&
    hasProtection
  );
}

function hasAbusiveHeadTraumaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHistorySafety = ABUSIVE_HEAD_TRAUMA_HISTORY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMimicCoagSafety = ABUSIVE_HEAD_TRAUMA_MIMIC_COAG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOccultInjurySafety = ABUSIVE_HEAD_TRAUMA_OCCULT_INJURY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRepeatSurveySafety = ABUSIVE_HEAD_TRAUMA_REPEAT_SURVEY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionSafety = ABUSIVE_HEAD_TRAUMA_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHistorySafety &&
    hasMimicCoagSafety &&
    hasOccultInjurySafety &&
    hasRepeatSurveySafety &&
    hasDispositionSafety
  );
}

function requiresEctopicPregnancySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ECTOPIC_PREGNANCY_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasEctopicPregnancyTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasHcg = ECTOPIC_PREGNANCY_HCG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUltrasound = ECTOPIC_PREGNANCY_ULTRASOUND_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = ECTOPIC_PREGNANCY_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasHcg && hasUltrasound && hasEscalation;
}

function hasEctopicPregnancyTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRhSafety = ECTOPIC_PREGNANCY_RH_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMtxLabSafety = ECTOPIC_PREGNANCY_MTX_LAB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMtxContraindicationSafety =
    ECTOPIC_PREGNANCY_MTX_CONTRAINDICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasHemodynamicSafety = ECTOPIC_PREGNANCY_HEMODYNAMIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasRhSafety && hasMtxLabSafety && hasMtxContraindicationSafety && hasHemodynamicSafety;
}

function requiresPostpartumHemorrhageSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.time_critical_actions),
  ]
    .join(" ")
    .toLowerCase();

  const hasPphContext = POSTPARTUM_HEMORRHAGE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasSevereRisk = POSTPARTUM_HEMORRHAGE_SEVERE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasPphContext && hasSevereRisk;
}

function hasPostpartumHemorrhageTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasResuscitation = POSTPARTUM_HEMORRHAGE_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUterotonic = POSTPARTUM_HEMORRHAGE_UTEROTONIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTxa = POSTPARTUM_HEMORRHAGE_TXA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceControl = POSTPARTUM_HEMORRHAGE_SOURCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = POSTPARTUM_HEMORRHAGE_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasResuscitation && hasUterotonic && hasTxa && hasSourceControl && hasEscalation;
}

function hasPostpartumHemorrhageTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasUterotonicSafety = POSTPARTUM_HEMORRHAGE_UTEROTONIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTxaSafety = POSTPARTUM_HEMORRHAGE_TXA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagTransfusionSafety = POSTPARTUM_HEMORRHAGE_COAG_TRANSFUSION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRetainedTraumaSafety = POSTPARTUM_HEMORRHAGE_RETAINED_TRAUMA_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEscalationSafety = POSTPARTUM_HEMORRHAGE_ESCALATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasUterotonicSafety &&
    hasTxaSafety &&
    hasCoagTransfusionSafety &&
    hasRetainedTraumaSafety &&
    hasEscalationSafety
  );
}

function requiresPlacentalAbruptionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = PLACENTAL_ABRUPTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = PLACENTAL_ABRUPTION_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasPlacentalAbruptionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMaternalResuscitation =
    PLACENTAL_ABRUPTION_MATERNAL_RESUSCITATION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasFetalMonitoring = PLACENTAL_ABRUPTION_FETAL_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLabs = PLACENTAL_ABRUPTION_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryEscalation = PLACENTAL_ABRUPTION_DELIVERY_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return hasMaternalResuscitation && hasFetalMonitoring && hasLabs && hasDeliveryEscalation;
}

function hasPlacentalAbruptionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPreviaExclusionSafety =
    PLACENTAL_ABRUPTION_PREVIA_EXCLUSION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasPelvicExamSafety = PLACENTAL_ABRUPTION_PELVIC_EXAM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUltrasoundLimitSafety = PLACENTAL_ABRUPTION_ULTRASOUND_LIMIT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagLabSafety = PLACENTAL_ABRUPTION_COAG_LAB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBloodRhSafety = PLACENTAL_ABRUPTION_BLOOD_RH_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasStabilityDeliverySafety =
    PLACENTAL_ABRUPTION_STABILITY_DELIVERY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasShockDicSafety = PLACENTAL_ABRUPTION_SHOCK_DIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBloodProductSafety = PLACENTAL_ABRUPTION_BLOOD_PRODUCT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPreviaExclusionSafety &&
    hasPelvicExamSafety &&
    hasUltrasoundLimitSafety &&
    hasCoagLabSafety &&
    hasBloodRhSafety &&
    hasStabilityDeliverySafety &&
    hasShockDicSafety &&
    hasBloodProductSafety
  );
}

function requiresPlacentaPreviaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = PLACENTA_PREVIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = PLACENTA_PREVIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasPlacentaPreviaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasUltrasound = PLACENTA_PREVIA_ULTRASOUND_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFetalMonitoring = PLACENTA_PREVIA_FETAL_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemorrhage = PLACENTA_PREVIA_HEMORRHAGE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCesarean = PLACENTA_PREVIA_CESAREAN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCesareanTrigger = PLACENTA_PREVIA_CESAREAN_TRIGGER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasUltrasound && hasFetalMonitoring && hasHemorrhage && hasCesarean && hasCesareanTrigger
  );
}

function hasPlacentaPreviaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDigitalExamSafety = PLACENTA_PREVIA_NO_DIGITAL_EXAM_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasExcludeByUltrasoundSafety =
    PLACENTA_PREVIA_EXCLUDE_BY_ULTRASOUND_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasStableCesareanSafety = PLACENTA_PREVIA_STABLE_CESAREAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasStableTimingSafety = PLACENTA_PREVIA_STABLE_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLungMaturitySafety = PLACENTA_PREVIA_LUNG_MATURITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUnstableDeliverySafety = PLACENTA_PREVIA_UNSTABLE_DELIVERY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasUnstableTriggerSafety = PLACENTA_PREVIA_UNSTABLE_TRIGGER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHospitalizationSafety = PLACENTA_PREVIA_HOSPITALIZATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasActivitySafety = PLACENTA_PREVIA_ACTIVITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSexualActivitySafety = PLACENTA_PREVIA_SEXUAL_ACTIVITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCorticosteroidSafety = PLACENTA_PREVIA_CORTICOSTEROID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRhSafety = PLACENTA_PREVIA_RH_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNoDigitalExamSafety &&
    hasExcludeByUltrasoundSafety &&
    hasStableCesareanSafety &&
    hasStableTimingSafety &&
    hasLungMaturitySafety &&
    hasUnstableDeliverySafety &&
    hasUnstableTriggerSafety &&
    hasHospitalizationSafety &&
    hasActivitySafety &&
    hasSexualActivitySafety &&
    hasCorticosteroidSafety &&
    hasRhSafety
  );
}

function requiresPlacentaAccretaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = PLACENTA_ACCRETA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = PLACENTA_ACCRETA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasPlacentaAccretaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasImaging = PLACENTA_ACCRETA_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMfmTeam = PLACENTA_ACCRETA_MFM_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnesthesiaTeam = PLACENTA_ACCRETA_ANESTHESIA_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgicalTeam = PLACENTA_ACCRETA_SURGICAL_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdjunctTeam = PLACENTA_ACCRETA_ADJUNCT_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodBank = PLACENTA_ACCRETA_BLOOD_BANK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTransfusion = PLACENTA_ACCRETA_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCesareanHysterectomy = PLACENTA_ACCRETA_CESAREAN_HYSTERECTOMY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryTiming = PLACENTA_ACCRETA_DELIVERY_TIMING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasImaging &&
    hasMfmTeam &&
    hasAnesthesiaTeam &&
    hasSurgicalTeam &&
    hasAdjunctTeam &&
    hasBloodBank &&
    hasTransfusion &&
    hasCesareanHysterectomy &&
    hasDeliveryTiming
  );
}

function hasPlacentaAccretaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasReferralSafety = PLACENTA_ACCRETA_REFERRAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAvoidRemovalSafety = PLACENTA_ACCRETA_AVOID_REMOVAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInSituSafety = PLACENTA_ACCRETA_IN_SITU_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTimingSafety = PLACENTA_ACCRETA_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCorticosteroidSafety = PLACENTA_ACCRETA_CORTICOSTEROID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBloodBankSafety = PLACENTA_ACCRETA_BLOOD_BANK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagSafety = PLACENTA_ACCRETA_COAG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTxaSafety = PLACENTA_ACCRETA_TXA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUrologicInjurySafety = PLACENTA_ACCRETA_UROLOGIC_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCriticalCareSafety = PLACENTA_ACCRETA_CRITICAL_CARE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPelvicOrganSafety = PLACENTA_ACCRETA_PELVIC_ORGAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasReferralSafety &&
    hasAvoidRemovalSafety &&
    hasInSituSafety &&
    hasTimingSafety &&
    hasCorticosteroidSafety &&
    hasBloodBankSafety &&
    hasCoagSafety &&
    hasTxaSafety &&
    hasUrologicInjurySafety &&
    hasCriticalCareSafety &&
    hasPelvicOrganSafety
  );
}

function requiresUmbilicalCordProlapseSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = UMBILICAL_CORD_PROLAPSE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = UMBILICAL_CORD_PROLAPSE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasUmbilicalCordProlapseTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFhrDiagnosis = UMBILICAL_CORD_PROLAPSE_FHR_DIAGNOSIS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAssistance = UMBILICAL_CORD_PROLAPSE_ASSISTANCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCompressionRelief = UMBILICAL_CORD_PROLAPSE_COMPRESSION_RELIEF_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasPositioning = UMBILICAL_CORD_PROLAPSE_POSITION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDelivery = UMBILICAL_CORD_PROLAPSE_DELIVERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasFhrDiagnosis && hasAssistance && hasCompressionRelief && hasPositioning && hasDelivery;
}

function hasUmbilicalCordProlapseTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMinimalHandlingSafety = UMBILICAL_CORD_PROLAPSE_MINIMAL_HANDLING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVasospasmSafety = UMBILICAL_CORD_PROLAPSE_VASOSPASM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReplacementSafety = UMBILICAL_CORD_PROLAPSE_REPLACEMENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNoDelayTocolysisSafety =
    UMBILICAL_CORD_PROLAPSE_NO_DELAY_TOCOLYSIS_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCesareanModeSafety = UMBILICAL_CORD_PROLAPSE_CESAREAN_MODE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasImminentVaginalSafety =
    UMBILICAL_CORD_PROLAPSE_IMMINENT_VAGINAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCategory1Safety = UMBILICAL_CORD_PROLAPSE_CATEGORY1_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCategory2Safety = UMBILICAL_CORD_PROLAPSE_CATEGORY2_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasContinuousAssessmentSafety =
    UMBILICAL_CORD_PROLAPSE_CONTINUOUS_ASSESSMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasNeonatalResuscitationSafety =
    UMBILICAL_CORD_PROLAPSE_NEONATAL_RESUSCITATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCordGasSafety = UMBILICAL_CORD_PROLAPSE_CORD_GAS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasMinimalHandlingSafety &&
    hasVasospasmSafety &&
    hasReplacementSafety &&
    hasNoDelayTocolysisSafety &&
    hasCesareanModeSafety &&
    hasImminentVaginalSafety &&
    hasCategory1Safety &&
    hasCategory2Safety &&
    hasContinuousAssessmentSafety &&
    hasNeonatalResuscitationSafety &&
    hasCordGasSafety
  );
}

function requiresVasaPreviaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = VASA_PREVIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = VASA_PREVIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasVasaPreviaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFetalAssessment = VASA_PREVIA_FETAL_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasObMfm = VASA_PREVIA_OB_MFM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnesthesiaBlood = VASA_PREVIA_ANESTHESIA_BLOOD_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeonatalTeam = VASA_PREVIA_NEONATAL_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDelivery = VASA_PREVIA_DELIVERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrgentBirth = VASA_PREVIA_URGENT_BIRTH_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeonatalResuscitation = VASA_PREVIA_NEONATAL_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeonatalTransfusion = VASA_PREVIA_NEONATAL_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasFetalAssessment &&
    hasObMfm &&
    hasAnesthesiaBlood &&
    hasNeonatalTeam &&
    hasDelivery &&
    hasUrgentBirth &&
    hasNeonatalResuscitation &&
    hasNeonatalTransfusion
  );
}

function hasVasaPreviaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelaySafety = VASA_PREVIA_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDeliveryTimingSafety = VASA_PREVIA_DELIVERY_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBeforeLaborRuptureSafety = VASA_PREVIA_BEFORE_LABOR_RUPTURE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCesareanSafety = VASA_PREVIA_CESAREAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidSafety = VASA_PREVIA_STEROID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidWindowSafety = VASA_PREVIA_STEROID_WINDOW_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAmniotomyAvoidanceSafety = VASA_PREVIA_AMNIOTOMY_AVOIDANCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasFetalScalpAvoidanceSafety = VASA_PREVIA_FETAL_SCALP_AVOIDANCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMembraneLaborAvoidanceSafety = VASA_PREVIA_MEMBRANE_LABOR_AVOIDANCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVaginalDeliveryAvoidanceSafety =
    VASA_PREVIA_VAGINAL_DELIVERY_AVOIDANCE_SAFETY_TERMS.some(
      (term) => containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasNoDelaySafety &&
    hasDeliveryTimingSafety &&
    hasBeforeLaborRuptureSafety &&
    hasCesareanSafety &&
    hasSteroidSafety &&
    hasSteroidWindowSafety &&
    hasAmniotomyAvoidanceSafety &&
    hasFetalScalpAvoidanceSafety &&
    hasMembraneLaborAvoidanceSafety &&
    hasVaginalDeliveryAvoidanceSafety
  );
}

function requiresUterineRuptureSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = UTERINE_RUPTURE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = UTERINE_RUPTURE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasUterineRuptureTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFetalAssessment = UTERINE_RUPTURE_FETAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMaternalAssessment = UTERINE_RUPTURE_MATERNAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasObSurgicalTeam = UTERINE_RUPTURE_OB_SURGICAL_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnesthesia = UTERINE_RUPTURE_ANESTHESIA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeonatal = UTERINE_RUPTURE_NEONATAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodBank = UTERINE_RUPTURE_BLOOD_BANK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLaparotomy = UTERINE_RUPTURE_LAPAROTOMY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCesareanDelivery = UTERINE_RUPTURE_CESAREAN_DELIVERY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasHemorrhagePrep = UTERINE_RUPTURE_HEMORRHAGE_PREP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTransfusion = UTERINE_RUPTURE_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasFetalAssessment &&
    hasMaternalAssessment &&
    hasObSurgicalTeam &&
    hasAnesthesia &&
    hasNeonatal &&
    hasBloodBank &&
    hasLaparotomy &&
    hasCesareanDelivery &&
    hasHemorrhagePrep &&
    hasTransfusion
  );
}

function hasUterineRuptureTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasStopLaborSafety = UTERINE_RUPTURE_STOP_LABOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasStopOxytocinSafety = UTERINE_RUPTURE_STOP_OXYTOCIN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAvoidProstaglandinSafety = UTERINE_RUPTURE_AVOID_PROSTAGLANDIN_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMisoprostolSafety = UTERINE_RUPTURE_MISOPROSTOL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNoDelaySafety = UTERINE_RUPTURE_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLaparotomyDiagnosisSafety = UTERINE_RUPTURE_LAPAROTOMY_DIAGNOSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRepairSafety = UTERINE_RUPTURE_REPAIR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHysterectomySafety = UTERINE_RUPTURE_HYSTERECTOMY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBladderInjurySafety = UTERINE_RUPTURE_BLADDER_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHemorrhageContingencySafety =
    UTERINE_RUPTURE_HEMORRHAGE_CONTINGENCY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasStopLaborSafety &&
    hasStopOxytocinSafety &&
    hasAvoidProstaglandinSafety &&
    hasMisoprostolSafety &&
    hasNoDelaySafety &&
    hasLaparotomyDiagnosisSafety &&
    hasRepairSafety &&
    hasHysterectomySafety &&
    hasBladderInjurySafety &&
    hasHemorrhageContingencySafety
  );
}

function requiresAmnioticFluidEmbolismSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = AMNIOTIC_FLUID_EMBOLISM_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = AMNIOTIC_FLUID_EMBOLISM_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasAmnioticFluidEmbolismTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirway = AMNIOTIC_FLUID_EMBOLISM_AIRWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCpr = AMNIOTIC_FLUID_EMBOLISM_CPR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemodynamic = AMNIOTIC_FLUID_EMBOLISM_HEMODYNAMIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLeftDisplacement = AMNIOTIC_FLUID_EMBOLISM_LEFT_DISPLACEMENT_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasObAnesthesiaTeam = AMNIOTIC_FLUID_EMBOLISM_OB_ANESTHESIA_TEAM_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCriticalCareTeam =
    AMNIOTIC_FLUID_EMBOLISM_CRITICAL_CARE_TEAM_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasNeonatalTeam = AMNIOTIC_FLUID_EMBOLISM_NEONATAL_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodBankTeam = AMNIOTIC_FLUID_EMBOLISM_BLOOD_BANK_TEAM_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryProcedure =
    AMNIOTIC_FLUID_EMBOLISM_DELIVERY_PROCEDURE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasDeliveryTiming = AMNIOTIC_FLUID_EMBOLISM_DELIVERY_TIMING_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDicCoag = AMNIOTIC_FLUID_EMBOLISM_DIC_COAG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFibrinogenReplacement =
    AMNIOTIC_FLUID_EMBOLISM_FIBRINOGEN_REPLACEMENT_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasTransfusion = AMNIOTIC_FLUID_EMBOLISM_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAirway &&
    hasCpr &&
    hasHemodynamic &&
    hasLeftDisplacement &&
    hasObAnesthesiaTeam &&
    hasCriticalCareTeam &&
    hasNeonatalTeam &&
    hasBloodBankTeam &&
    hasDeliveryProcedure &&
    hasDeliveryTiming &&
    hasDicCoag &&
    hasFibrinogenReplacement &&
    hasTransfusion
  );
}

function hasAmnioticFluidEmbolismTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasFluidOverloadSafety = AMNIOTIC_FLUID_EMBOLISM_FLUID_OVERLOAD_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVasopressorSafety = AMNIOTIC_FLUID_EMBOLISM_VASOPRESSOR_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasClotFactorReplacementSafety =
    AMNIOTIC_FLUID_EMBOLISM_CLOT_FACTOR_REPLACEMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDicSafety = AMNIOTIC_FLUID_EMBOLISM_DIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRfviiaSafety = AMNIOTIC_FLUID_EMBOLISM_RFVIITA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUterotonicSafety = AMNIOTIC_FLUID_EMBOLISM_UTEROTONIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTxaSafety = AMNIOTIC_FLUID_EMBOLISM_TXA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasFluidOverloadSafety &&
    hasVasopressorSafety &&
    hasClotFactorReplacementSafety &&
    hasDicSafety &&
    hasRfviiaSafety &&
    hasUterotonicSafety &&
    hasTxaSafety
  );
}

function requiresShoulderDystociaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SHOULDER_DYSTOCIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = SHOULDER_DYSTOCIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasShoulderDystociaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasDeclaration = SHOULDER_DYSTOCIA_DECLARATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTeamSupport = SHOULDER_DYSTOCIA_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFirstLine = SHOULDER_DYSTOCIA_FIRST_LINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSuprapubic = SHOULDER_DYSTOCIA_SUPRAPUBIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSecondLine = SHOULDER_DYSTOCIA_SECOND_LINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasDeclaration && hasTeamSupport && hasFirstLine && hasSuprapubic && hasSecondLine;
}

function hasShoulderDystociaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasFundalPressureSafety = SHOULDER_DYSTOCIA_FUNDAL_PRESSURE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasExcessiveTractionSafety = SHOULDER_DYSTOCIA_EXCESSIVE_TRACTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAxialTractionSafety = SHOULDER_DYSTOCIA_AXIAL_TRACTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEpisiotomyAccessSafety = SHOULDER_DYSTOCIA_EPISIOTOMY_ACCESS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMaternalInjurySafety = SHOULDER_DYSTOCIA_MATERNAL_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNeonatalInjurySafety = SHOULDER_DYSTOCIA_NEONATAL_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDocumentIntervalSafety = SHOULDER_DYSTOCIA_DOCUMENT_INTERVAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDocumentTimingSafety = SHOULDER_DYSTOCIA_DOCUMENT_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDocumentManeuversSafety = SHOULDER_DYSTOCIA_DOCUMENT_MANEUVERS_SAFETY_TERMS.some(
    (term) =>
      containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasFundalPressureSafety &&
    hasExcessiveTractionSafety &&
    hasAxialTractionSafety &&
    hasEpisiotomyAccessSafety &&
    hasMaternalInjurySafety &&
    hasNeonatalInjurySafety &&
    hasDocumentIntervalSafety &&
    hasDocumentTimingSafety &&
    hasDocumentManeuversSafety
  );
}

function requiresSeverePreeclampsiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SEVERE_PREECLAMPSIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasSeverePreeclampsiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMagnesium = SEVERE_PREECLAMPSIA_MAGNESIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSeizureContext = SEVERE_PREECLAMPSIA_SEIZURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSevereBpContext = SEVERE_PREECLAMPSIA_SEVERE_BP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntihypertensiveMed = SEVERE_PREECLAMPSIA_ANTIHYPERTENSIVE_MED_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryAction = SEVERE_PREECLAMPSIA_DELIVERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryTiming = SEVERE_PREECLAMPSIA_DELIVERY_TIMING_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = SEVERE_PREECLAMPSIA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasMagnesium &&
    hasSeizureContext &&
    hasSevereBpContext &&
    hasAntihypertensiveMed &&
    hasDeliveryAction &&
    hasDeliveryTiming &&
    hasEscalation
  );
}

function hasSeverePreeclampsiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMagnesiumRespiratorySafety = SEVERE_PREECLAMPSIA_MAGNESIUM_RESPIRATORY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMagnesiumReflexSafety = SEVERE_PREECLAMPSIA_MAGNESIUM_REFLEX_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMagnesiumUrineSafety = SEVERE_PREECLAMPSIA_MAGNESIUM_URINE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMagnesiumAntidoteSafety = SEVERE_PREECLAMPSIA_MAGNESIUM_ANTIDOTE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasLabetalolSafety = SEVERE_PREECLAMPSIA_LABETALOL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNifedipineSafety = SEVERE_PREECLAMPSIA_NIFEDIPINE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletLabSafety = SEVERE_PREECLAMPSIA_PLATELET_LAB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLiverLabSafety = SEVERE_PREECLAMPSIA_LIVER_LAB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRenalLabSafety = SEVERE_PREECLAMPSIA_RENAL_LAB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMaternalSevereFeatureSafety = SEVERE_PREECLAMPSIA_MATERNAL_SEVERE_FEATURE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasFetalDeliveryRiskSafety = SEVERE_PREECLAMPSIA_FETAL_DELIVERY_RISK_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidNoDelaySafety = SEVERE_PREECLAMPSIA_STEROID_NO_DELAY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostpartumSafety = SEVERE_PREECLAMPSIA_POSTPARTUM_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasMagnesiumRespiratorySafety &&
    hasMagnesiumReflexSafety &&
    hasMagnesiumUrineSafety &&
    hasMagnesiumAntidoteSafety &&
    hasLabetalolSafety &&
    hasNifedipineSafety &&
    hasPlateletLabSafety &&
    hasLiverLabSafety &&
    hasRenalLabSafety &&
    hasMaternalSevereFeatureSafety &&
    hasFetalDeliveryRiskSafety &&
    hasSteroidNoDelaySafety &&
    hasPostpartumSafety
  );
}

function requiresHellpSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = HELLP_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasRisk = HELLP_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasHellpTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCbcPlatelet = HELLP_CBC_PLATELET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLiverEnzyme = HELLP_LIVER_ENZYME_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemolysis = HELLP_HEMOLYSIS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMagnesium = HELLP_MAGNESIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSeizureContext = HELLP_SEIZURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSevereBp = HELLP_SEVERE_BP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBpMed = HELLP_BP_MED_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryAction = HELLP_DELIVERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryTiming = HELLP_DELIVERY_TIMING_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDicCoag = HELLP_DIC_COAG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHepaticComplication = HELLP_HEPATIC_COMPLICATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCbcPlatelet &&
    hasLiverEnzyme &&
    hasHemolysis &&
    hasMagnesium &&
    hasSeizureContext &&
    hasSevereBp &&
    hasBpMed &&
    hasDeliveryAction &&
    hasDeliveryTiming &&
    hasDicCoag &&
    hasHepaticComplication
  );
}

function hasHellpTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDicTriggerSafety = HELLP_DIC_TRIGGER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDicCoagSafety = HELLP_DIC_COAG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletVaginalSafety = HELLP_PLATELET_VAGINAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletCesareanSafety = HELLP_PLATELET_CESAREAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletBleedingTransfusionSafety =
    HELLP_PLATELET_BLEEDING_TRANSFUSION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRegionalSafePlateletSafety = HELLP_REGIONAL_SAFE_PLATELET_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRegionalAvoidLowPlateletSafety = HELLP_REGIONAL_AVOID_LOW_PLATELET_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidGestationalSafety = HELLP_STEROID_GESTATIONAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidFetalLungSafety = HELLP_STEROID_FETAL_LUNG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostpartumTimeSafety = HELLP_POSTPARTUM_TIME_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostpartumMagnesiumSafety = HELLP_POSTPARTUM_MAGNESIUM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostpartumLabRecoverySafety = HELLP_POSTPARTUM_LAB_RECOVERY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDicTriggerSafety &&
    hasDicCoagSafety &&
    hasPlateletVaginalSafety &&
    hasPlateletCesareanSafety &&
    hasPlateletBleedingTransfusionSafety &&
    hasRegionalSafePlateletSafety &&
    hasRegionalAvoidLowPlateletSafety &&
    hasSteroidGestationalSafety &&
    hasSteroidFetalLungSafety &&
    hasPostpartumTimeSafety &&
    hasPostpartumMagnesiumSafety &&
    hasPostpartumLabRecoverySafety
  );
}

function requiresHypertensiveEmergencySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = HYPERTENSIVE_EMERGENCY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSevereBpContext = HYPERTENSIVE_EMERGENCY_BP_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasOrganDamageContext = HYPERTENSIVE_EMERGENCY_ORGAN_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasSevereBpContext && hasOrganDamageContext);
}

function hasHypertensiveEmergencyTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasBpConfirmation = HYPERTENSIVE_EMERGENCY_BP_CONFIRM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = HYPERTENSIVE_EMERGENCY_MONITOR_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroOrEyeAssessment = HYPERTENSIVE_EMERGENCY_NEURO_OR_EYE_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRenalAssessment = HYPERTENSIVE_EMERGENCY_RENAL_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiopulmonaryAorticAssessment =
    HYPERTENSIVE_EMERGENCY_CARDIOPULMONARY_AORTIC_ASSESSMENT_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasOrganDamageLabel = HYPERTENSIVE_EMERGENCY_ORGAN_DAMAGE_LABEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTitratableIvContext =
    HYPERTENSIVE_EMERGENCY_TITRATABLE_IV_CONTEXT_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasIvMed = HYPERTENSIVE_EMERGENCY_IV_MED_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMapTarget = HYPERTENSIVE_EMERGENCY_MAP_TARGET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTimeTarget = HYPERTENSIVE_EMERGENCY_TIME_TARGET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasBpConfirmation &&
    hasMonitoring &&
    hasOrganDamageLabel &&
    hasNeuroOrEyeAssessment &&
    hasRenalAssessment &&
    hasCardiopulmonaryAorticAssessment &&
    hasTitratableIvContext &&
    hasIvMed &&
    hasMapTarget &&
    hasTimeTarget
  );
}

function hasHypertensiveEmergencyTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasUrgencyDifferentiation =
    HYPERTENSIVE_EMERGENCY_URGENCY_DIFFERENTIATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRapidLoweringSafety = HYPERTENSIVE_EMERGENCY_RAPID_LOWERING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHypoperfusionSafety = HYPERTENSIVE_EMERGENCY_HYPOPERFUSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReductionLimitSafety = HYPERTENSIVE_EMERGENCY_REDUCTION_LIMIT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasConditionContextSafety = HYPERTENSIVE_EMERGENCY_CONDITION_CONTEXT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMedContraindicationSafety =
    HYPERTENSIVE_EMERGENCY_MED_CONTRAINDICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasIcuDispositionSafety = HYPERTENSIVE_EMERGENCY_ICU_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasContinuousMonitorSafety = HYPERTENSIVE_EMERGENCY_CONTINUOUS_MONITOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTitrationReassessmentSafety =
    HYPERTENSIVE_EMERGENCY_TITRATION_REASSESSMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasUrgencyDifferentiation &&
    hasRapidLoweringSafety &&
    hasHypoperfusionSafety &&
    hasReductionLimitSafety &&
    hasConditionContextSafety &&
    hasMedContraindicationSafety &&
    hasIcuDispositionSafety &&
    hasContinuousMonitorSafety &&
    hasTitrationReassessmentSafety
  );
}

function requiresGiantCellArteritisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = GIANT_CELL_ARTERITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasHeadacheContext = GIANT_CELL_ARTERITIS_HEADACHE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasIschemicContext = GIANT_CELL_ARTERITIS_ISCHEMIC_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasHeadacheContext && hasIschemicContext);
}

function hasGiantCellArteritisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasHighDoseSteroid = GIANT_CELL_ARTERITIS_HIGH_DOSE_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSteroidAgent = GIANT_CELL_ARTERITIS_STEROID_AGENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEsr = GIANT_CELL_ARTERITIS_ESR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCrp = GIANT_CELL_ARTERITIS_CRP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCbcPlatelet = GIANT_CELL_ARTERITIS_CBC_PLATELET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBiopsy = GIANT_CELL_ARTERITIS_BIOPSY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUltrasound = GIANT_CELL_ARTERITIS_ULTRASOUND_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrgentTiming = GIANT_CELL_ARTERITIS_URGENT_TIMING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialist = GIANT_CELL_ARTERITIS_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasHighDoseSteroid &&
    hasSteroidAgent &&
    hasEsr &&
    hasCrp &&
    hasCbcPlatelet &&
    (hasBiopsy || hasUltrasound) &&
    hasUrgentTiming &&
    hasSpecialist
  );
}

function hasGiantCellArteritisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelay = GIANT_CELL_ARTERITIS_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDiagnosticDelay = GIANT_CELL_ARTERITIS_DIAGNOSTIC_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVisualSymptomSafety = GIANT_CELL_ARTERITIS_VISUAL_SYMPTOM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCranialIschemiaSafety = GIANT_CELL_ARTERITIS_CRANIAL_ISCHEMIA_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasGlucoseSafety = GIANT_CELL_ARTERITIS_GLUCOSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfectionSafety = GIANT_CELL_ARTERITIS_INFECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBoneSafety = GIANT_CELL_ARTERITIS_BONE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasGiSafety = GIANT_CELL_ARTERITIS_GI_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTaperRelapseSafety = GIANT_CELL_ARTERITIS_TAPER_RELAPSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLargeVesselSafety = GIANT_CELL_ARTERITIS_LARGE_VESSEL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidSparingSafety = GIANT_CELL_ARTERITIS_STEROID_SPARING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNoDelay &&
    hasDiagnosticDelay &&
    hasVisualSymptomSafety &&
    hasCranialIschemiaSafety &&
    hasGlucoseSafety &&
    hasInfectionSafety &&
    hasBoneSafety &&
    hasGiSafety &&
    hasTaperRelapseSafety &&
    hasLargeVesselSafety &&
    hasSteroidSparingSafety
  );
}

function requiresAcuteAngleClosureGlaucomaSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = ACUTE_ANGLE_CLOSURE_GLAUCOMA_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRedEyeContext = ACUTE_ANGLE_CLOSURE_GLAUCOMA_RED_EYE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasAngleContext = ACUTE_ANGLE_CLOSURE_GLAUCOMA_ANGLE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasRedEyeContext && hasAngleContext);
}

function hasAcuteAngleClosureGlaucomaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasIopMeasurement =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_MEASUREMENT_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasEyeExam = ACUTE_ANGLE_CLOSURE_GLAUCOMA_EYE_EXAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImmediateTreatment = ACUTE_ANGLE_CLOSURE_GLAUCOMA_IMMEDIATE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTopicalBetaBlocker =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_TOPICAL_BETA_BLOCKER_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasTopicalAlphaAgonist =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_TOPICAL_ALPHA_AGONIST_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasPilocarpine = ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTopicalContext = ACUTE_ANGLE_CLOSURE_GLAUCOMA_TOPICAL_ADJUNCT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAcetazolamide = ACUTE_ANGLE_CLOSURE_GLAUCOMA_ACETAZOLAMIDE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOsmoticEscalation = ACUTE_ANGLE_CLOSURE_GLAUCOMA_OSMOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOphthalmology = ACUTE_ANGLE_CLOSURE_GLAUCOMA_OPHTHALMOLOGY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIridotomy = ACUTE_ANGLE_CLOSURE_GLAUCOMA_IRIDOTOMY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasIopMeasurement &&
    hasEyeExam &&
    hasImmediateTreatment &&
    hasTopicalBetaBlocker &&
    hasTopicalAlphaAgonist &&
    hasPilocarpine &&
    hasTopicalContext &&
    hasAcetazolamide &&
    hasOsmoticEscalation &&
    hasOphthalmology &&
    hasIridotomy
  );
}

function hasAcuteAngleClosureGlaucomaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAcetazolamideMedSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_ACETAZOLAMIDE_MED_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAcetazolamideContraSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_ACETAZOLAMIDE_CONTRA_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasBetaBlockerMedSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_BETA_BLOCKER_MED_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasBetaBlockerContraSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_BETA_BLOCKER_CONTRA_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasPilocarpineTimingSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_TIMING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasPilocarpineContextSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_CONTEXT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasFellowEyeAssessmentSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_ASSESSMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasFellowEyeIridotomySafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_IRIDOTOMY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasVisualMonitoringSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_VISUAL_MONITORING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasIopMonitoringSafety = ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasOpticCornealMonitoringSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_OPTIC_CORNEAL_MONITORING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasMydriaticAvoidanceSafety =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_MYDRIATIC_AVOIDANCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasAcetazolamideMedSafety &&
    hasAcetazolamideContraSafety &&
    hasBetaBlockerMedSafety &&
    hasBetaBlockerContraSafety &&
    hasPilocarpineTimingSafety &&
    hasPilocarpineContextSafety &&
    hasFellowEyeAssessmentSafety &&
    hasFellowEyeIridotomySafety &&
    hasVisualMonitoringSafety &&
    hasIopMonitoringSafety &&
    hasOpticCornealMonitoringSafety &&
    hasMydriaticAvoidanceSafety
  );
}

function requiresRetinalDetachmentSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = RETINAL_DETACHMENT_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSymptomContext = RETINAL_DETACHMENT_SYMPTOM_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = RETINAL_DETACHMENT_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasSymptomContext && hasRiskContext);
}

function hasRetinalDetachmentTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasVisualAcuity = RETINAL_DETACHMENT_VISUAL_ACUITY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVisualField = RETINAL_DETACHMENT_VISUAL_FIELD_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPupilRedReflex = RETINAL_DETACHMENT_PUPIL_RED_REFLEX_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDilatedIndirectExam = RETINAL_DETACHMENT_DILATED_INDIRECT_EXAM_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasBscan = RETINAL_DETACHMENT_BSCAN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrgentTiming = RETINAL_DETACHMENT_URGENT_TIMING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialist = RETINAL_DETACHMENT_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDefinitiveRepair = RETINAL_DETACHMENT_DEFINITIVE_REPAIR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasVisualAcuity &&
    hasVisualField &&
    hasPupilRedReflex &&
    hasDilatedIndirectExam &&
    hasBscan &&
    hasUrgentTiming &&
    hasSpecialist &&
    hasDefinitiveRepair
  );
}

function hasRetinalDetachmentTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelaySafety = RETINAL_DETACHMENT_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUrgentOphthalmologySafety = RETINAL_DETACHMENT_URGENT_OPHTHALMOLOGY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMaculaStatusSafety = RETINAL_DETACHMENT_MACULA_STATUS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCentralVisualStatusSafety = RETINAL_DETACHMENT_CENTRAL_VISUAL_STATUS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRetinalBreakDifferentialSafety =
    RETINAL_DETACHMENT_RETINAL_BREAK_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasVitreousDifferentialSafety =
    RETINAL_DETACHMENT_VITREOUS_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasReturnPrecautionSafety = RETINAL_DETACHMENT_RETURN_PRECAUTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPerioperativePrecautionSafety =
    RETINAL_DETACHMENT_PERIOPERATIVE_PRECAUTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasNoDelaySafety &&
    hasUrgentOphthalmologySafety &&
    hasMaculaStatusSafety &&
    hasCentralVisualStatusSafety &&
    hasRetinalBreakDifferentialSafety &&
    hasVitreousDifferentialSafety &&
    hasReturnPrecautionSafety &&
    hasPerioperativePrecautionSafety
  );
}

function requiresCentralRetinalArteryOcclusionSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = CENTRAL_RETINAL_ARTERY_OCCLUSION_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasVisionContext = CENTRAL_RETINAL_ARTERY_OCCLUSION_VISION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasStrokeRiskContext = CENTRAL_RETINAL_ARTERY_OCCLUSION_STROKE_RISK_CONTEXT_TERMS.some(
    (term) => containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasVisionContext && hasStrokeRiskContext);
}

function hasCentralRetinalArteryOcclusionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOnset = CENTRAL_RETINAL_ARTERY_OCCLUSION_ONSET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasStrokeActivation = CENTRAL_RETINAL_ARTERY_OCCLUSION_STROKE_ACTIVATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasVisualConfirmation =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_VISUAL_CONFIRM_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasFundusConfirmation = CENTRAL_RETINAL_ARTERY_OCCLUSION_FUNDUS_CONFIRM_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasOphthalmologyConfirmation =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_OPHTHALMOLOGY_CONFIRM_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasBrainVascular = CENTRAL_RETINAL_ARTERY_OCCLUSION_BRAIN_VASCULAR_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCarotid = CENTRAL_RETINAL_ARTERY_OCCLUSION_CAROTID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiacEmbolic = CENTRAL_RETINAL_ARTERY_OCCLUSION_CARDIAC_EMBOLIC_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasReperfusionReview =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_REPERFUSION_REVIEW_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasIopLowering = CENTRAL_RETINAL_ARTERY_OCCLUSION_IOP_LOWERING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasOnset &&
    hasStrokeActivation &&
    hasVisualConfirmation &&
    hasFundusConfirmation &&
    hasOphthalmologyConfirmation &&
    hasBrainVascular &&
    hasCarotid &&
    hasCardiacEmbolic &&
    hasReperfusionReview &&
    hasIopLowering
  );
}

function hasCentralRetinalArteryOcclusionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRetinalMimicSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_RETINAL_MIMIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNeuroMimicSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_NEURO_MIMIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasThrombolysisEligibilitySafety =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_THROMBOLYSIS_ELIGIBILITY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasBleedingRiskSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_BLEEDING_RISK_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasBpSurgeryRiskSafety =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_BP_SURGERY_RISK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntiplateletStatinSafety =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_ANTIPLATELET_STATIN_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAfibCarotidSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_AFIB_CAROTID_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRiskFactorSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_RISK_FACTOR_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEsrCrpSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_ESR_CRP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_PLATELET_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasGcaSymptomSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_GCA_SYMPTOM_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_STEROID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasRetinalMimicSafety &&
    hasNeuroMimicSafety &&
    hasThrombolysisEligibilitySafety &&
    hasBleedingRiskSafety &&
    hasBpSurgeryRiskSafety &&
    hasAntiplateletStatinSafety &&
    hasAfibCarotidSafety &&
    hasRiskFactorSafety &&
    hasEsrCrpSafety &&
    hasPlateletSafety &&
    hasGcaSymptomSafety &&
    hasSteroidSafety
  );
}

function requiresOpenGlobeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = OPEN_GLOBE_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasTraumaContext = OPEN_GLOBE_TRAUMA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSignContext = OPEN_GLOBE_SIGN_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasTraumaContext && hasSignContext);
}

function hasOpenGlobeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRigidShield = OPEN_GLOBE_RIGID_SHIELD_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasShieldNoPressure = OPEN_GLOBE_SHIELD_NO_PRESSURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSystemicIvAntibiotic = OPEN_GLOBE_SYSTEMIC_IV_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVancomycin = OPEN_GLOBE_VANCOMYCIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasGramNegativeCoverage = OPEN_GLOBE_GRAM_NEGATIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTetanus = OPEN_GLOBE_TETANUS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCtOrbit = OPEN_GLOBE_CT_ORBIT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasForeignBodyImaging = OPEN_GLOBE_FOREIGN_BODY_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOphthalmology = OPEN_GLOBE_URGENT_OPHTHALMOLOGY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgicalRepair = OPEN_GLOBE_SURGICAL_REPAIR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasRigidShield &&
    hasShieldNoPressure &&
    hasSystemicIvAntibiotic &&
    hasVancomycin &&
    hasGramNegativeCoverage &&
    hasTetanus &&
    hasCtOrbit &&
    hasForeignBodyImaging &&
    hasOphthalmology &&
    hasSurgicalRepair
  );
}

function hasOpenGlobeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPressureAvoidance = OPEN_GLOBE_PRESSURE_AVOIDANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPatchTonometryAvoidance = OPEN_GLOBE_PATCH_TONOMETRY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUltrasoundManipulationAvoidance = OPEN_GLOBE_ULTRASOUND_MANIPULATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasExtrusionSafety = OPEN_GLOBE_EXTRUSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNpoSafety = OPEN_GLOBE_NPO_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntiemeticSafety = OPEN_GLOBE_ANTIEMETIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAnalgesiaSafety = OPEN_GLOBE_ANALGESIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasForeignBodyRemovalSafety = OPEN_GLOBE_FOREIGN_BODY_REMOVAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMriMetallicSafety = OPEN_GLOBE_MRI_METALLIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTopicalOintmentSafety = OPEN_GLOBE_TOPICAL_OINTMENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEndophthalmitisSafety = OPEN_GLOBE_ENDOPHTHALMITIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasIntravitrealSafety = OPEN_GLOBE_INTRAVITREAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFollowupPrognosisSafety = OPEN_GLOBE_FOLLOWUP_PROGNOSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPressureAvoidance &&
    hasPatchTonometryAvoidance &&
    hasUltrasoundManipulationAvoidance &&
    hasExtrusionSafety &&
    hasNpoSafety &&
    hasAntiemeticSafety &&
    hasAnalgesiaSafety &&
    hasForeignBodyRemovalSafety &&
    hasMriMetallicSafety &&
    hasTopicalOintmentSafety &&
    hasEndophthalmitisSafety &&
    hasIntravitrealSafety &&
    hasFollowupPrognosisSafety
  );
}

function requiresEndophthalmitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = ENDOPHTHALMITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = ENDOPHTHALMITIS_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSymptomContext = ENDOPHTHALMITIS_SYMPTOM_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasRiskContext && hasSymptomContext);
}

function hasEndophthalmitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasUrgentOphtho = ENDOPHTHALMITIS_URGENT_OPHTHO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOcularSampling = ENDOPHTHALMITIS_OCULAR_SAMPLING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMicrobiology = ENDOPHTHALMITIS_MICROBIOLOGY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIntravitrealRoute = ENDOPHTHALMITIS_INTRAVITREAL_ROUTE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasVancomycin = ENDOPHTHALMITIS_INTRAVITREAL_VANCOMYCIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCeftazidime = ENDOPHTHALMITIS_INTRAVITREAL_CEFTAZIDIME_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEndogenousContext = ENDOPHTHALMITIS_ENDOGENOUS_CONTEXT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIvAntimicrobial = ENDOPHTHALMITIS_IV_ANTIMICROBIAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodUrineCulture = ENDOPHTHALMITIS_BLOOD_URINE_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasUrgentOphtho &&
    hasOcularSampling &&
    hasMicrobiology &&
    hasIntravitrealRoute &&
    hasVancomycin &&
    hasCeftazidime &&
    hasEndogenousContext &&
    hasIvAntimicrobial &&
    hasBloodUrineCulture
  );
}

function hasEndophthalmitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelay = ENDOPHTHALMITIS_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferential = ENDOPHTHALMITIS_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVitrectomyAction = ENDOPHTHALMITIS_VITRECTOMY_ACTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSevereVision = ENDOPHTHALMITIS_SEVERE_VISION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFungalContext = ENDOPHTHALMITIS_FUNGAL_CONTEXT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidContraindication = ENDOPHTHALMITIS_STEROID_CONTRAINDICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVisualMonitoring = ENDOPHTHALMITIS_VISUAL_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasResponseMonitoring = ENDOPHTHALMITIS_RESPONSE_CULTURE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNoDelay &&
    hasDifferential &&
    hasVitrectomyAction &&
    hasSevereVision &&
    hasFungalContext &&
    hasSteroidContraindication &&
    hasVisualMonitoring &&
    hasResponseMonitoring
  );
}

function requiresTtpSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = TTP_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasMahaContext = TTP_MAHA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasThrombocytopeniaContext = TTP_THROMBOCYTOPENIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasOrganContext = TTP_ORGAN_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasMahaContext && hasThrombocytopeniaContext && hasOrganContext);
}

function hasTtpTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasHematology = TTP_HEMATOLOGY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPex = TTP_PEX_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdamts13 = TTP_ADAMTS13_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdamts13BeforeTreatment = TTP_ADAMTS13_BEFORE_TREATMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemolysisLabs = TTP_HEMOLYSIS_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCoagRenalLabs = TTP_COAG_RENAL_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSteroid = TTP_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRituximab = TTP_RITUXIMAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCaplacizumab = TTP_CAPLACIZUMAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasHematology &&
    hasPex &&
    hasAdamts13 &&
    hasAdamts13BeforeTreatment &&
    hasHemolysisLabs &&
    hasCoagRenalLabs &&
    hasSteroid &&
    hasRituximab &&
    hasCaplacizumab
  );
}

function hasTtpTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDoNotWait = TTP_DO_NOT_WAIT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletAvoidance = TTP_PLATELET_AVOIDANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletException = TTP_PLATELET_EXCEPTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTmaDifferential = TTP_TMA_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagSepsisPregnancyDifferential = TTP_COAG_SEPSIS_PREGNANCY_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPlateletLdhMonitoring = TTP_PLATELET_LDH_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOrganComplicationMonitoring = TTP_ORGAN_COMPLICATION_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRelapseRefractorySafety = TTP_RELAPSE_REFRACTORY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDoNotWait &&
    hasPlateletAvoidance &&
    hasPlateletException &&
    hasTmaDifferential &&
    hasCoagSepsisPregnancyDifferential &&
    hasPlateletLdhMonitoring &&
    hasOrganComplicationMonitoring &&
    hasRelapseRefractorySafety
  );
}

function requiresAcuteLiverFailureSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = ACUTE_LIVER_FAILURE_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasInjuryContext = ACUTE_LIVER_FAILURE_INJURY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasEncephalopathyContext = ACUTE_LIVER_FAILURE_ENCEPHALOPATHY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasInjuryContext && hasEncephalopathyContext);
}

function hasAcuteLiverFailureTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasIcu = ACUTE_LIVER_FAILURE_ICU_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTransplantCenter = ACUTE_LIVER_FAILURE_TRANSPLANT_CENTER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTransferEvaluation = ACUTE_LIVER_FAILURE_TRANSFER_EVALUATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNac = ACUTE_LIVER_FAILURE_NAC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxWorkup = ACUTE_LIVER_FAILURE_TOX_WORKUP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasViralWorkup = ACUTE_LIVER_FAILURE_VIRAL_WORKUP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAutoimmuneMetabolicWorkup = ACUTE_LIVER_FAILURE_AUTOIMMUNE_METABOLIC_WORKUP_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCoagMonitoring = ACUTE_LIVER_FAILURE_COAG_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAmmoniaMonitoring = ACUTE_LIVER_FAILURE_AMMONIA_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasGlucoseMonitoring = ACUTE_LIVER_FAILURE_GLUCOSE_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPerfusionMonitoring = ACUTE_LIVER_FAILURE_PERFUSION_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRenalMonitoring = ACUTE_LIVER_FAILURE_RENAL_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroMonitoring = ACUTE_LIVER_FAILURE_NEURO_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasIcu &&
    hasTransplantCenter &&
    hasTransferEvaluation &&
    hasNac &&
    hasToxWorkup &&
    hasViralWorkup &&
    hasAutoimmuneMetabolicWorkup &&
    hasCoagMonitoring &&
    hasAmmoniaMonitoring &&
    hasGlucoseMonitoring &&
    hasPerfusionMonitoring &&
    hasRenalMonitoring &&
    hasNeuroMonitoring
  );
}

function hasAcuteLiverFailureTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasIcpCerebralEdema = ACUTE_LIVER_FAILURE_ICP_CEREBRAL_EDEMA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCerebralEdemaIntervention = ACUTE_LIVER_FAILURE_CEREBRAL_EDEMA_INTERVENTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagulopathyAvoidSafety =
    ACUTE_LIVER_FAILURE_COAGULOPATHY_AVOID_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCoagulopathyExceptionSafety =
    ACUTE_LIVER_FAILURE_COAGULOPATHY_EXCEPTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasGlucoseMonitoringSafety = ACUTE_LIVER_FAILURE_GLUCOSE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDextroseHypoglycemiaSafety = ACUTE_LIVER_FAILURE_DEXTROSE_HYPOGLYCEMIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPrognosisCriteria = ACUTE_LIVER_FAILURE_PROGNOSIS_CRITERIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransferListing = ACUTE_LIVER_FAILURE_TRANSFER_LISTING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfectionSafety = ACUTE_LIVER_FAILURE_INFECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHemodynamicRenalSafety = ACUTE_LIVER_FAILURE_HEMODYNAMIC_RENAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasIcpCerebralEdema &&
    hasCerebralEdemaIntervention &&
    hasCoagulopathyAvoidSafety &&
    hasCoagulopathyExceptionSafety &&
    hasGlucoseMonitoringSafety &&
    hasDextroseHypoglycemiaSafety &&
    hasPrognosisCriteria &&
    hasTransferListing &&
    hasInfectionSafety &&
    hasHemodynamicRenalSafety
  );
}

function requiresNeutropenicFeverSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return NEUTROPENIC_FEVER_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasNeutropenicFeverTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAncCheck = NEUTROPENIC_FEVER_ANC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodCulture = NEUTROPENIC_FEVER_BLOOD_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCentralLineCulture = NEUTROPENIC_FEVER_CENTRAL_LINE_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPeripheralCulture = NEUTROPENIC_FEVER_PERIPHERAL_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceCulture = NEUTROPENIC_FEVER_SOURCE_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntipseudomonalAntibiotics = NEUTROPENIC_FEVER_ANTIPSEUDOMONAL_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibioticTiming = NEUTROPENIC_FEVER_ANTIBIOTIC_TIMING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdmissionEscalation = NEUTROPENIC_FEVER_ADMISSION_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOncologyEscalation = NEUTROPENIC_FEVER_ONCOLOGY_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRiskScore = NEUTROPENIC_FEVER_RISK_SCORE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAncCheck &&
    hasBloodCulture &&
    hasCentralLineCulture &&
    hasPeripheralCulture &&
    hasSourceCulture &&
    hasAntipseudomonalAntibiotics &&
    hasAntibioticTiming &&
    hasAdmissionEscalation &&
    hasOncologyEscalation &&
    hasRiskScore
  );
}

function hasNeutropenicFeverTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAllergySafety = NEUTROPENIC_FEVER_ALLERGY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRenalHepaticDosingSafety = NEUTROPENIC_FEVER_RENAL_HEPATIC_DOSING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasLocalResistanceSafety = NEUTROPENIC_FEVER_LOCAL_RESISTANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVancomycinNotRoutine = NEUTROPENIC_FEVER_VANCOMYCIN_NOT_ROUTINE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVancomycinIndication = NEUTROPENIC_FEVER_VANCOMYCIN_INDICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRiskScoreSafety = NEUTROPENIC_FEVER_RISK_SCORE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOutpatientCriteriaSafety = NEUTROPENIC_FEVER_OUTPATIENT_CRITERIA_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasReturnPrecautionSafety = NEUTROPENIC_FEVER_RETURN_PRECAUTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPersistentFeverSafety = NEUTROPENIC_FEVER_PERSISTENT_FEVER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntifungalReassessmentSafety = NEUTROPENIC_FEVER_ANTIFUNGAL_REASSESSMENT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasClinicalMicroReassessmentSafety = NEUTROPENIC_FEVER_CLINICAL_MICRO_REASSESSMENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAllergySafety &&
    hasRenalHepaticDosingSafety &&
    hasLocalResistanceSafety &&
    hasVancomycinNotRoutine &&
    hasVancomycinIndication &&
    hasRiskScoreSafety &&
    hasOutpatientCriteriaSafety &&
    hasReturnPrecautionSafety &&
    hasPersistentFeverSafety &&
    hasAntifungalReassessmentSafety &&
    hasClinicalMicroReassessmentSafety
  );
}

function requiresObstructivePyelonephritisSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasCombinedContext = OBSTRUCTIVE_PYELONEPHRITIS_COMBINED_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasInfectionContext = OBSTRUCTIVE_PYELONEPHRITIS_INFECTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasObstructionContext = OBSTRUCTIVE_PYELONEPHRITIS_OBSTRUCTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasCombinedContext || (hasInfectionContext && hasObstructionContext);
}

function hasObstructivePyelonephritisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAntibiotics = OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrineCulture = OBSTRUCTIVE_PYELONEPHRITIS_URINE_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodCulture = OBSTRUCTIVE_PYELONEPHRITIS_BLOOD_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImaging = OBSTRUCTIVE_PYELONEPHRITIS_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasObstructionImaging = OBSTRUCTIVE_PYELONEPHRITIS_OBSTRUCTION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecompressionUrgency =
    OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_URGENCY_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasDecompressionRoute =
    OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_ROUTE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasSepsisSupport = OBSTRUCTIVE_PYELONEPHRITIS_SEPSIS_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAntibiotics &&
    hasUrineCulture &&
    hasBloodCulture &&
    hasImaging &&
    hasObstructionImaging &&
    hasDecompressionUrgency &&
    hasDecompressionRoute &&
    hasSepsisSupport
  );
}

function hasObstructivePyelonephritisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDelayIntent = OBSTRUCTIVE_PYELONEPHRITIS_DELAY_INTENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDefinitiveStoneTreatment =
    OBSTRUCTIVE_PYELONEPHRITIS_DEFINITIVE_STONE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasInfectionResolution =
    OBSTRUCTIVE_PYELONEPHRITIS_INFECTION_RESOLUTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDrainageReview = OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_REVIEW_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDrainageRoute = OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_ROUTE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticReassessmentIntent =
    OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_INTENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntibioticReassessmentData =
    OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_DATA_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasComplicationRiskReview =
    OBSTRUCTIVE_PYELONEPHRITIS_COMPLICATION_RISK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasDelayIntent &&
    hasDefinitiveStoneTreatment &&
    hasInfectionResolution &&
    hasDrainageReview &&
    hasDrainageRoute &&
    hasAntibioticReassessmentIntent &&
    hasAntibioticReassessmentData &&
    hasComplicationRiskReview
  );
}

function requiresSevereHypoglycemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SEVERE_HYPOGLYCEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasSevereHypoglycemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasGlucoseCheck = SEVERE_HYPOGLYCEMIA_GLUCOSE_CHECK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRescueTreatment = SEVERE_HYPOGLYCEMIA_RESCUE_TREATMENT_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasRecheck = SEVERE_HYPOGLYCEMIA_RECHECK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSustainedGlucose = SEVERE_HYPOGLYCEMIA_SUSTAINED_GLUCOSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasProlongedRisk = SEVERE_HYPOGLYCEMIA_PROLONGED_RISK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = SEVERE_HYPOGLYCEMIA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasGlucoseCheck &&
    hasRescueTreatment &&
    hasRecheck &&
    hasSustainedGlucose &&
    hasProlongedRisk &&
    hasEscalation
  );
}

function hasSevereHypoglycemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRouteAirwaySafety = SEVERE_HYPOGLYCEMIA_ROUTE_AIRWAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceRiskSafety = SEVERE_HYPOGLYCEMIA_RECURRENCE_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceMonitoringSafety =
    SEVERE_HYPOGLYCEMIA_RECURRENCE_MONITORING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSulfonylureaRisk = containsSafetyTerm(normalizedChecks, "sulfonylurea");
  const hasOctreotideWhenSulfonylurea =
    !hasSulfonylureaRisk ||
    SEVERE_HYPOGLYCEMIA_OCTREOTIDE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCauseRiskSafety = SEVERE_HYPOGLYCEMIA_CAUSE_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDischargePreventionSafety = SEVERE_HYPOGLYCEMIA_DISCHARGE_PREVENTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasRouteAirwaySafety &&
    hasRecurrenceRiskSafety &&
    hasRecurrenceMonitoringSafety &&
    hasOctreotideWhenSulfonylurea &&
    hasCauseRiskSafety &&
    hasDischargePreventionSafety
  );
}

function insulinSulfonylureaToxicityContextText(
  detail: ClinicalCaseReviewDetail,
): string {
  return [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
}

function requiresInsulinSulfonylureaToxicitySafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
  const riskText = insulinSulfonylureaToxicityContextText(detail);

  const hasDirectContext = INSULIN_SULFONYLUREA_TOXICITY_DIRECT_CONTEXT_TERMS.some(
    (term) => containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = INSULIN_SULFONYLUREA_TOXICITY_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = INSULIN_SULFONYLUREA_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasRiskContext);
}

function requiresSulfonylureaToxicityOctreotideAction(
  detail: ClinicalCaseReviewDetail,
): boolean {
  const riskText = insulinSulfonylureaToxicityContextText(detail);
  const hasSulfonylureaContext = SULFONYLUREA_TOXICITY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = INSULIN_SULFONYLUREA_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasSulfonylureaContext && hasRiskContext;
}

function hasInsulinSulfonylureaToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasGlucoseMonitoring =
    INSULIN_SULFONYLUREA_TOXICITY_GLUCOSE_MONITOR_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasDextroseRescue = INSULIN_SULFONYLUREA_TOXICITY_DEXTROSE_RESCUE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDextroseInfusion = INSULIN_SULFONYLUREA_TOXICITY_DEXTROSE_INFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNutrition = INSULIN_SULFONYLUREA_TOXICITY_NUTRITION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation =
    INSULIN_SULFONYLUREA_TOXICITY_ESCALATION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasElectrolyte = INSULIN_SULFONYLUREA_TOXICITY_ELECTROLYTE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasGlucoseMonitoring &&
    hasDextroseRescue &&
    hasDextroseInfusion &&
    hasNutrition &&
    hasEscalation &&
    hasElectrolyte
  );
}

function hasSulfonylureaToxicityOctreotideAction(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  return SULFONYLUREA_TOXICITY_OCTREOTIDE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
}

function hasInsulinSulfonylureaToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRecurrenceRisk =
    INSULIN_SULFONYLUREA_TOXICITY_RECURRENCE_RISK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasObservationDuration =
    INSULIN_SULFONYLUREA_TOXICITY_OBSERVATION_DURATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDextroseSafety = INSULIN_SULFONYLUREA_TOXICITY_DEXTROSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPotassiumElectrolyteSafety =
    INSULIN_SULFONYLUREA_TOXICITY_POTASSIUM_ELECTROLYTE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRiskGroupSafety =
    INSULIN_SULFONYLUREA_TOXICITY_RISK_GROUP_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDispositionSafety =
    INSULIN_SULFONYLUREA_TOXICITY_DISPOSITION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDispositionStability =
    INSULIN_SULFONYLUREA_TOXICITY_DISPOSITION_STABILITY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasRecurrenceRisk &&
    hasObservationDuration &&
    hasDextroseSafety &&
    hasPotassiumElectrolyteSafety &&
    hasRiskGroupSafety &&
    hasDispositionSafety &&
    hasDispositionStability
  );
}

function requiresMalignantHyperthermiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return MALIGNANT_HYPERTHERMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasMalignantHyperthermiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasTriggerStop = MALIGNANT_HYPERTHERMIA_TRIGGER_STOP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOxygen = MALIGNANT_HYPERTHERMIA_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDantroleneAgent = MALIGNANT_HYPERTHERMIA_DANTROLENE_AGENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDantroleneDose = MALIGNANT_HYPERTHERMIA_DANTROLENE_DOSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCooling = MALIGNANT_HYPERTHERMIA_COOLING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = MALIGNANT_HYPERTHERMIA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasTriggerStop &&
    hasOxygen &&
    hasDantroleneAgent &&
    hasDantroleneDose &&
    hasCooling &&
    hasEscalation
  );
}

function hasMalignantHyperthermiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHyperkalemiaSafety = MALIGNANT_HYPERTHERMIA_HYPERKALEMIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAcidosisSafety = MALIGNANT_HYPERTHERMIA_ACIDOSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRhabdomyolysisSafety = MALIGNANT_HYPERTHERMIA_RHABDOMYOLYSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoreMonitoringSafety = MALIGNANT_HYPERTHERMIA_CORE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUrineMonitoringSafety = MALIGNANT_HYPERTHERMIA_URINE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDantroleneRepeatSafety = MALIGNANT_HYPERTHERMIA_DANTROLENE_REPEAT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDantroleneInteractionSafety =
    MALIGNANT_HYPERTHERMIA_DANTROLENE_INTERACTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCoolingEndpointSafety = MALIGNANT_HYPERTHERMIA_COOLING_ENDPOINT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostcrisisObservationSafety =
    MALIGNANT_HYPERTHERMIA_POSTCRISIS_OBSERVATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasTriggerPreventionSafety = MALIGNANT_HYPERTHERMIA_TRIGGER_PREVENTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHyperkalemiaSafety &&
    hasAcidosisSafety &&
    hasRhabdomyolysisSafety &&
    hasCoreMonitoringSafety &&
    hasUrineMonitoringSafety &&
    hasDantroleneRepeatSafety &&
    hasDantroleneInteractionSafety &&
    hasCoolingEndpointSafety &&
    hasPostcrisisObservationSafety &&
    hasTriggerPreventionSafety
  );
}

function requiresThyroidStormSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return THYROID_STORM_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasThyroidStormTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasBetaBlocker = THYROID_STORM_BETA_BLOCKER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasThionamide = THYROID_STORM_THIONAMIDE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIodine = THYROID_STORM_IODINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSteroid = THYROID_STORM_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSupportive = THYROID_STORM_SUPPORTIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIcuMonitoring = THYROID_STORM_ICU_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasBetaBlocker && hasThionamide && hasIodine && hasSteroid && hasSupportive && hasIcuMonitoring;
}

function hasThyroidStormTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSequenceSafety = THYROID_STORM_SEQUENCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOneHourSequenceSafety = THYROID_STORM_ONE_HOUR_SEQUENCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBetaBlockerSafety = THYROID_STORM_BETA_BLOCKER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBetaBlockerAlternativeSafety = THYROID_STORM_BETA_BLOCKER_ALTERNATIVE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasThionamideToxicitySafety = THYROID_STORM_THIONAMIDE_TOXICITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPregnancySafety = THYROID_STORM_PREGNANCY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPrecipitantSafety = THYROID_STORM_PRECIPITANT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCardiacMonitoringSafety = THYROID_STORM_CARDIAC_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAspirinAvoidanceSafety = THYROID_STORM_ASPIRIN_AVOIDANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSequenceSafety &&
    hasOneHourSequenceSafety &&
    hasBetaBlockerSafety &&
    hasBetaBlockerAlternativeSafety &&
    hasThionamideToxicitySafety &&
    hasPregnancySafety &&
    hasPrecipitantSafety &&
    hasCardiacMonitoringSafety &&
    hasAspirinAvoidanceSafety
  );
}

function requiresMyxedemaComaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = MYXEDEMA_COMA_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasHypothyroidContext = MYXEDEMA_COMA_HYPOTHYROID_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDecompensationContext = MYXEDEMA_COMA_DECOMPENSATION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasHypothyroidContext && hasDecompensationContext);
}

function hasMyxedemaComaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasIcu = MYXEDEMA_COMA_ICU_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwayVentilation = MYXEDEMA_COMA_AIRWAY_VENTILATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemodynamic = MYXEDEMA_COMA_HEMODYNAMIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSteroid = MYXEDEMA_COMA_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasThyroidHormone = MYXEDEMA_COMA_THYROID_HORMONE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasThyroidLabs = MYXEDEMA_COMA_THYROID_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInfectionWorkup = MYXEDEMA_COMA_INFECTION_WORKUP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCortisol = MYXEDEMA_COMA_CORTISOL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasIcu &&
    hasAirwayVentilation &&
    hasHemodynamic &&
    hasSteroid &&
    hasThyroidHormone &&
    hasThyroidLabs &&
    hasInfectionWorkup &&
    hasCortisol
  );
}

function hasMyxedemaComaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSteroidSequence = MYXEDEMA_COMA_STEROID_SEQUENCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRewarmingSafety = MYXEDEMA_COMA_REWARMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHyponatremiaSafety = MYXEDEMA_COMA_HYPONATREMIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasGlucoseSafety = MYXEDEMA_COMA_GLUCOSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRespiratorySafety = MYXEDEMA_COMA_RESPIRATORY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCardiacDosingSafety = MYXEDEMA_COMA_CARDIAC_DOSING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSteroidSequence &&
    hasRewarmingSafety &&
    hasHyponatremiaSafety &&
    hasGlucoseSafety &&
    hasRespiratorySafety &&
    hasCardiacDosingSafety
  );
}

function requiresSevereHypothermiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.time_critical_actions),
  ]
    .join(" ")
    .toLowerCase();

  const hasContext = SEVERE_HYPOTHERMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasSevereRisk = SEVERE_HYPOTHERMIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasSevereRisk;
}

function hasSevereHypothermiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCoreTemp = SEVERE_HYPOTHERMIA_CORE_TEMP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasGentleAbc = SEVERE_HYPOTHERMIA_GENTLE_ABC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasActiveRewarming = SEVERE_HYPOTHERMIA_ACTIVE_REWARMING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCoreRewarmingModality = SEVERE_HYPOTHERMIA_CORE_REWARMING_MODALITY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidPerfusion = SEVERE_HYPOTHERMIA_FLUID_PERFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEcg = SEVERE_HYPOTHERMIA_ECG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMetabolicLabs = SEVERE_HYPOTHERMIA_METABOLIC_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSecondaryCause = SEVERE_HYPOTHERMIA_SECONDARY_CAUSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasArrestEscalation = SEVERE_HYPOTHERMIA_ARREST_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCoreTemp &&
    hasGentleAbc &&
    hasActiveRewarming &&
    hasCoreRewarmingModality &&
    hasFluidPerfusion &&
    hasEcg &&
    hasMetabolicLabs &&
    hasSecondaryCause &&
    hasArrestEscalation
  );
}

function hasSevereHypothermiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAfterdropSafety = SEVERE_HYPOTHERMIA_AFTERDROP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAclsTempSafety = SEVERE_HYPOTHERMIA_ACLS_TEMP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPerfusingRhythmSafety = SEVERE_HYPOTHERMIA_PERFUSING_RHYTHM_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEcmoTerminationSafety = SEVERE_HYPOTHERMIA_ECMO_TERMINATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSecondaryCauseSafety = SEVERE_HYPOTHERMIA_SECONDARY_CAUSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAfterdropSafety &&
    hasAclsTempSafety &&
    hasPerfusingRhythmSafety &&
    hasEcmoTerminationSafety &&
    hasSecondaryCauseSafety
  );
}

function requiresDrowningSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasContext = DROWNING_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasRespiratoryRisk = DROWNING_RESPIRATORY_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRespiratoryRisk;
}

function hasDrowningTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirwayBreathing = DROWNING_AIRWAY_BREATHING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOxygenation = DROWNING_OXYGENATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCirculationResuscitation = DROWNING_CIRCULATION_RESUSCITATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratoryMonitoring = DROWNING_RESPIRATORY_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIndicatedRespiratoryWorkup = DROWNING_INDICATED_RESPIRATORY_WORKUP_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasWetClothing = DROWNING_WET_CLOTHING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTemperatureStabilization = DROWNING_REWARMING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTraumaCspineReview = DROWNING_TRAUMA_CSPINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasObservation = DROWNING_OBSERVATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = DROWNING_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAirwayBreathing &&
    hasOxygenation &&
    hasCirculationResuscitation &&
    hasRespiratoryMonitoring &&
    hasIndicatedRespiratoryWorkup &&
    hasWetClothing &&
    hasTemperatureStabilization &&
    hasTraumaCspineReview &&
    hasObservation &&
    hasEscalation
  );
}

function hasDrowningTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntibioticSteroidAvoidance =
    DROWNING_ANTIBIOTIC_STEROID_AVOIDANCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntibioticSteroidTarget = DROWNING_ANTIBIOTIC_STEROID_TARGET_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfectionIndication = DROWNING_INFECTION_INDICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasObservationDurationSafety = DROWNING_OBSERVATION_DURATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDischargeStabilitySafety = DROWNING_DISCHARGE_STABILITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDischargeOxygenSafety = DROWNING_DISCHARGE_OXYGEN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOxygenTargetSafety = DROWNING_OXYGEN_TARGET_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCspineTargetingSafety = DROWNING_CSPINE_TARGETING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDelayedRespiratorySafety = DROWNING_DELAYED_RESPIRATORY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasUnderlyingCauseSafety = DROWNING_UNDERLYING_CAUSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAspirationSafety = DROWNING_ASPIRATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAntibioticSteroidAvoidance &&
    hasAntibioticSteroidTarget &&
    hasInfectionIndication &&
    hasObservationDurationSafety &&
    hasDischargeStabilitySafety &&
    hasDischargeOxygenSafety &&
    hasOxygenTargetSafety &&
    hasCspineTargetingSafety &&
    hasDelayedRespiratorySafety &&
    hasUnderlyingCauseSafety &&
    hasAspirationSafety
  );
}

function requiresHeatStrokeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return HEAT_STROKE_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasHeatStrokeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCoreTemp = HEAT_STROKE_CORE_TEMP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRapidCooling = HEAT_STROKE_RAPID_COOLING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCoolingModality = HEAT_STROKE_COOLING_MODALITY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwayBreathing = HEAT_STROKE_AIRWAY_BREATHING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCirculation = HEAT_STROKE_CIRCULATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIvFluid = HEAT_STROKE_IV_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = HEAT_STROKE_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCoreTemp &&
    hasRapidCooling &&
    hasCoolingModality &&
    hasAirwayBreathing &&
    hasCirculation &&
    hasIvFluid &&
    hasEscalation
  );
}

function hasHeatStrokeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOvercoolingSafety = HEAT_STROKE_OVERCOOLING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOrganInjurySafety = HEAT_STROKE_ORGAN_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntipyreticAvoidanceSafety =
    HEAT_STROKE_ANTIPYRETIC_AVOIDANCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntipyreticTargetSafety = HEAT_STROKE_ANTIPYRETIC_TARGET_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = HEAT_STROKE_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOvercoolingSafety &&
    hasOrganInjurySafety &&
    hasAntipyreticAvoidanceSafety &&
    hasAntipyreticTargetSafety &&
    hasDifferentialSafety
  );
}

function requiresSerotoninSyndromeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = SEROTONIN_SYNDROME_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasExposureContext = SEROTONIN_SYNDROME_EXPOSURE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasNeuromuscularContext = SEROTONIN_SYNDROME_NEUROMUSCULAR_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasAutonomicMentalContext = SEROTONIN_SYNDROME_AUTONOMIC_MENTAL_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasExposureContext && hasNeuromuscularContext && hasAutonomicMentalContext);
}

function hasSerotoninSyndromeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasStopAgent = SEROTONIN_SYNDROME_STOP_AGENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOxygen = SEROTONIN_SYNDROME_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIvFluid = SEROTONIN_SYNDROME_IV_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = SEROTONIN_SYNDROME_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBenzodiazepine = SEROTONIN_SYNDROME_BENZODIAZEPINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCooling = SEROTONIN_SYNDROME_COOLING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCyproheptadine = SEROTONIN_SYNDROME_CYPROHEPTADINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicology = SEROTONIN_SYNDROME_TOXICOLOGY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSevereEscalation = SEROTONIN_SYNDROME_SEVERE_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasStopAgent &&
    hasOxygen &&
    hasIvFluid &&
    hasMonitoring &&
    hasBenzodiazepine &&
    hasCooling &&
    hasCyproheptadine &&
    hasToxicology &&
    hasSevereEscalation
  );
}

function hasSerotoninSyndromeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDifferentialSafety = SEROTONIN_SYNDROME_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHunterDiagnosticSafety = SEROTONIN_SYNDROME_HUNTER_DIAGNOSTIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasExposureTimingSafety = SEROTONIN_SYNDROME_EXPOSURE_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRestraintAntipyreticAvoidance =
    SEROTONIN_SYNDROME_RESTRAINT_ANTIPYRETIC_AVOIDANCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRestraintAntipyreticTarget =
    SEROTONIN_SYNDROME_RESTRAINT_ANTIPYRETIC_TARGET_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSevereHyperthermiaSafety = SEROTONIN_SYNDROME_SEVERE_HYPERTHERMIA_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationMonitoring = SEROTONIN_SYNDROME_COMPLICATION_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDifferentialSafety &&
    hasHunterDiagnosticSafety &&
    hasExposureTimingSafety &&
    hasRestraintAntipyreticAvoidance &&
    hasRestraintAntipyreticTarget &&
    hasSevereHyperthermiaSafety &&
    hasComplicationMonitoring
  );
}

function requiresNeurolepticMalignantSyndromeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = NEUROLEPTIC_MALIGNANT_SYNDROME_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasExposureContext = NEUROLEPTIC_MALIGNANT_SYNDROME_EXPOSURE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRigidityContext = NEUROLEPTIC_MALIGNANT_SYNDROME_RIGIDITY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasAutonomicMentalContext = NEUROLEPTIC_MALIGNANT_SYNDROME_AUTONOMIC_MENTAL_CONTEXT_TERMS.some(
    (term) => containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasExposureContext && hasRigidityContext && hasAutonomicMentalContext);
}

function hasNeurolepticMalignantSyndromeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasStopAgent = NEUROLEPTIC_MALIGNANT_SYNDROME_STOP_AGENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIcu = NEUROLEPTIC_MALIGNANT_SYNDROME_ICU_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = NEUROLEPTIC_MALIGNANT_SYNDROME_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIvFluid = NEUROLEPTIC_MALIGNANT_SYNDROME_IV_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasElectrolyte = NEUROLEPTIC_MALIGNANT_SYNDROME_ELECTROLYTE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiorespiratory = NEUROLEPTIC_MALIGNANT_SYNDROME_CARDIORESPIRATORY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasSupportive = NEUROLEPTIC_MALIGNANT_SYNDROME_SUPPORTIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCooling = NEUROLEPTIC_MALIGNANT_SYNDROME_COOLING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMedication = NEUROLEPTIC_MALIGNANT_SYNDROME_MEDICATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCkRhabdo = NEUROLEPTIC_MALIGNANT_SYNDROME_CK_RHABDO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRenalMyoglobin = NEUROLEPTIC_MALIGNANT_SYNDROME_RENAL_MYOGLOBIN_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasStopAgent &&
    hasIcu &&
    hasMonitoring &&
    hasIvFluid &&
    hasElectrolyte &&
    hasCardiorespiratory &&
    hasSupportive &&
    hasCooling &&
    hasMedication &&
    hasCkRhabdo &&
    hasRenalMyoglobin
  );
}

function hasNeurolepticMalignantSyndromeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDifferentialSafety = NEUROLEPTIC_MALIGNANT_SYNDROME_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasExposureDifferentiationSafety =
    NEUROLEPTIC_MALIGNANT_SYNDROME_EXPOSURE_DIFFERENTIATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRigidityReflexSafety = NEUROLEPTIC_MALIGNANT_SYNDROME_RIGIDITY_REFLEX_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRestartSafety = NEUROLEPTIC_MALIGNANT_SYNDROME_RESTART_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMedicationSafety = NEUROLEPTIC_MALIGNANT_SYNDROME_MEDICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDifferentialSafety &&
    hasExposureDifferentiationSafety &&
    hasRigidityReflexSafety &&
    hasRestartSafety &&
    hasMedicationSafety
  );
}

function requiresCaudaEquinaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return CAUDA_EQUINA_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasCaudaEquinaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMri = hasCaudaEquinaEmergencyMriAction(actions);
  const hasBladderDysfunctionAssessment = CAUDA_EQUINA_BLADDER_DYSFUNCTION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasPvrAssessment = CAUDA_EQUINA_PVR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSaddleSensoryExam = CAUDA_EQUINA_SADDLE_SENSORY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnalToneOrReflexExam = CAUDA_EQUINA_ANAL_TONE_REFLEX_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLowerLimbNeuroExam = CAUDA_EQUINA_LOWER_LIMB_NEURO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpineConsult = CAUDA_EQUINA_SPINE_CONSULT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecompressionPlan = CAUDA_EQUINA_DECOMPRESSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasMri &&
    hasBladderDysfunctionAssessment &&
    hasPvrAssessment &&
    hasSaddleSensoryExam &&
    hasAnalToneOrReflexExam &&
    hasLowerLimbNeuroExam &&
    hasSpineConsult &&
    hasDecompressionPlan
  );
}

function hasCaudaEquinaEmergencyMriAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasModality = CAUDA_EQUINA_MRI_MODALITY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = CAUDA_EQUINA_MRI_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasRegion = CAUDA_EQUINA_MRI_REGION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasModality && hasUrgency && hasRegion;
  });
}

function hasCaudaEquinaDelaySafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRedFlagSafety = CAUDA_EQUINA_RED_FLAG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDelaySafety = CAUDA_EQUINA_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCompressiveCauseSafety = CAUDA_EQUINA_COMPRESSIVE_CAUSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasRedFlagSafety && hasDelaySafety && hasCompressiveCauseSafety;
}

function requiresMetastaticSpinalCordCompressionSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = METASTATIC_SPINAL_CORD_COMPRESSION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasCancerContext = METASTATIC_SPINAL_CORD_COMPRESSION_CANCER_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasNeuroRisk = METASTATIC_SPINAL_CORD_COMPRESSION_NEURO_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext || (hasCancerContext && hasNeuroRisk);
}

function hasMetastaticSpinalCordCompressionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasContactAction = METASTATIC_SPINAL_CORD_COMPRESSION_CONTACT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCoordinatorRole = METASTATIC_SPINAL_CORD_COMPRESSION_COORDINATOR_ROLE_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasMri = hasMetastaticSpinalCordCompressionUrgentMriAction(actions);
  const hasSteroid = hasMetastaticSpinalCordCompressionSteroidAction(actions);
  const hasImmobilization = METASTATIC_SPINAL_CORD_COMPRESSION_IMMOBILIZATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasStabilityAssessment =
    METASTATIC_SPINAL_CORD_COMPRESSION_STABILITY_ASSESSMENT_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasMdtPlan = METASTATIC_SPINAL_CORD_COMPRESSION_MDT_PLAN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDefinitivePlan = METASTATIC_SPINAL_CORD_COMPRESSION_DEFINITIVE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasContactAction &&
    hasCoordinatorRole &&
    hasMri &&
    hasSteroid &&
    hasImmobilization &&
    hasStabilityAssessment &&
    hasMdtPlan &&
    hasDefinitivePlan
  );
}

function hasMetastaticSpinalCordCompressionUrgentMriAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasModality = METASTATIC_SPINAL_CORD_COMPRESSION_MRI_MODALITY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = METASTATIC_SPINAL_CORD_COMPRESSION_MRI_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasRegion = METASTATIC_SPINAL_CORD_COMPRESSION_MRI_REGION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasWholeSpine = METASTATIC_SPINAL_CORD_COMPRESSION_MRI_WHOLE_SPINE_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasModality && hasUrgency && hasRegion && hasWholeSpine;
  });
}

function hasMetastaticSpinalCordCompressionSteroidAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasSpecificSteroid = METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_SPECIFIC_TERMS.some(
      (term) => containsSafetyTerm(normalizedAction, term),
    );
    const hasDose = METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_DOSE_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasSteroidClass = METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_CLASS_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasDose && (hasSpecificSteroid || hasSteroidClass);
  });
}

function hasMetastaticSpinalCordCompressionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNeuroMonitoring =
    METASTATIC_SPINAL_CORD_COMPRESSION_NEURO_MONITORING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasBladderBowelMonitoring =
    METASTATIC_SPINAL_CORD_COMPRESSION_BLADDER_BOWEL_MONITORING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSteroidGlucoseSafety =
    METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_GLUCOSE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSteroidGiSafety = METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_GI_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidTaperStopSafety =
    METASTATIC_SPINAL_CORD_COMPRESSION_STEROID_TAPER_STOP_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCtIfMriContraindicated =
    METASTATIC_SPINAL_CORD_COMPRESSION_CT_IF_MRI_CONTRAINDICATED_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasPlainXrayAvoidance =
    METASTATIC_SPINAL_CORD_COMPRESSION_PLAIN_XRAY_AVOIDANCE_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasStabilitySafety = METASTATIC_SPINAL_CORD_COMPRESSION_STABILITY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTreatmentReviewSafety =
    METASTATIC_SPINAL_CORD_COMPRESSION_TREATMENT_REVIEW_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasNeuroMonitoring &&
    hasBladderBowelMonitoring &&
    hasSteroidGlucoseSafety &&
    hasSteroidGiSafety &&
    hasSteroidTaperStopSafety &&
    hasCtIfMriContraindicated &&
    hasPlainXrayAvoidance &&
    hasStabilitySafety &&
    hasTreatmentReviewSafety
  );
}

function requiresOpenFractureSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = OPEN_FRACTURE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = OPEN_FRACTURE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasOpenFractureTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAntibiotics = OPEN_FRACTURE_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDressing = OPEN_FRACTURE_DRESSING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeurovascular = OPEN_FRACTURE_NEUROVASCULAR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOrthoplastic = OPEN_FRACTURE_ORTHOPLASTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAntibiotics && hasDressing && hasNeurovascular && hasOrthoplastic;
}

function hasOpenFractureTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasTetanus = OPEN_FRACTURE_TETANUS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEdIrrigationSafety = OPEN_FRACTURE_ED_IRRIGATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTimingTransfer = OPEN_FRACTURE_TIMING_TRANSFER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVascularCompartment = OPEN_FRACTURE_VASCULAR_COMPARTMENT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasTetanus && hasEdIrrigationSafety && hasTimingTransfer && hasVascularCompartment;
}

function requiresAcuteCompartmentSyndromeSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = ACUTE_COMPARTMENT_SYNDROME_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = ACUTE_COMPARTMENT_SYNDROME_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSymptomContext = ACUTE_COMPARTMENT_SYNDROME_SYMPTOM_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasRiskContext && hasSymptomContext);
}

function hasAcuteCompartmentSyndromeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLimbExam = ACUTE_COMPARTMENT_SYNDROME_EXAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPressurePathway = ACUTE_COMPARTMENT_SYNDROME_PRESSURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgicalTeam = ACUTE_COMPARTMENT_SYNDROME_SURGICAL_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecompression = ACUTE_COMPARTMENT_SYNDROME_DECOMPRESSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTemporizingRelease = ACUTE_COMPARTMENT_SYNDROME_TEMPORIZE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasLimbExam &&
    hasPressurePathway &&
    hasSurgicalTeam &&
    hasDecompression &&
    hasTemporizingRelease
  );
}

function hasAcuteCompartmentSyndromeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDelaySafety = ACUTE_COMPARTMENT_SYNDROME_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMaskingSafety = ACUTE_COMPARTMENT_SYNDROME_MASKING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationSafety = ACUTE_COMPARTMENT_SYNDROME_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCauseSafety = ACUTE_COMPARTMENT_SYNDROME_CAUSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDelaySafety && hasMaskingSafety && hasComplicationSafety && hasCauseSafety;
}

function requiresAcuteLimbIschemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_LIMB_ISCHEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasAcuteLimbIschemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasViabilityAssessment = ACUTE_LIMB_ISCHEMIA_VIABILITY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHeparin = ACUTE_LIMB_ISCHEMIA_HEPARIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRevascularization = ACUTE_LIMB_ISCHEMIA_REVASCULARIZATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return hasViabilityAssessment && hasHeparin && hasRevascularization;
}

function hasAcuteLimbIschemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBleedingSafety = ACUTE_LIMB_ISCHEMIA_BLEEDING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasIrreversibleCompartmentSafety =
    ACUTE_LIMB_ISCHEMIA_IRREVERSIBLE_COMPARTMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSourceDifferentialSafety = ACUTE_LIMB_ISCHEMIA_SOURCE_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasBleedingSafety && hasIrreversibleCompartmentSafety && hasSourceDifferentialSafety;
}

function requiresTesticularTorsionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return TESTICULAR_TORSION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasTesticularTorsionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAssessment = TESTICULAR_TORSION_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrologySurgery = TESTICULAR_TORSION_UROLOGY_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDelayPrevention = TESTICULAR_TORSION_DELAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAssessment && hasUrologySurgery && hasDelayPrevention;
}

function hasTesticularTorsionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSalvageSafety = TESTICULAR_TORSION_SALVAGE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasManualDetorsionSafety = TESTICULAR_TORSION_MANUAL_DETORSION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasBilateralFixationSafety = TESTICULAR_TORSION_BILATERAL_FIXATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = TESTICULAR_TORSION_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSalvageSafety &&
    hasManualDetorsionSafety &&
    hasBilateralFixationSafety &&
    hasDifferentialSafety
  );
}

function requiresOvarianTorsionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return OVARIAN_TORSION_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasOvarianTorsionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasPregnancyAssessment = OVARIAN_TORSION_PREGNANCY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUltrasoundAssessment = OVARIAN_TORSION_ULTRASOUND_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialistEscalation = OVARIAN_TORSION_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDefinitiveSurgery = OVARIAN_TORSION_DEFINITIVE_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasPregnancyAssessment &&
    hasUltrasoundAssessment &&
    hasSpecialistEscalation &&
    hasDefinitiveSurgery
  );
}

function hasOvarianTorsionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDopplerDelaySafety = OVARIAN_TORSION_DOPPLER_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPreservationSafety = OVARIAN_TORSION_PRESERVATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = OVARIAN_TORSION_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDopplerDelaySafety && hasPreservationSafety && hasDifferentialSafety;
}

function requiresSpinalEpiduralAbscessSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SPINAL_EPIDURAL_ABSCESS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasSpinalEpiduralAbscessRedFlags(redFlags: string[]): boolean {
  const normalizedRedFlags = redFlags.join(" ").toLowerCase();
  const hasBackPain = SPINAL_EPIDURAL_ABSCESS_BACK_PAIN_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
  const hasFeverTenderness = SPINAL_EPIDURAL_ABSCESS_FEVER_TENDERNESS_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
  const hasNeuroDeficit = SPINAL_EPIDURAL_ABSCESS_NEURO_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
  const hasInfectionRisk = SPINAL_EPIDURAL_ABSCESS_INFECTION_RISK_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
  return hasBackPain && hasFeverTenderness && hasNeuroDeficit && hasInfectionRisk;
}

function hasSpinalEpiduralAbscessTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMri = hasSpinalEpiduralAbscessUrgentMriAction(actions);
  const hasBloodCultures = SPINAL_EPIDURAL_ABSCESS_BLOOD_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInflammatoryMarkers = SPINAL_EPIDURAL_ABSCESS_INFLAMMATORY_MARKER_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceCulture = SPINAL_EPIDURAL_ABSCESS_SOURCE_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = hasSpinalEpiduralAbscessEmpiricAntibioticAction(actions);
  const hasSpineSurgeryConsult = SPINAL_EPIDURAL_ABSCESS_SPINE_SURGERY_CONSULT_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgery = SPINAL_EPIDURAL_ABSCESS_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasMri &&
    hasBloodCultures &&
    hasInflammatoryMarkers &&
    hasSourceCulture &&
    hasAntibiotic &&
    hasSpineSurgeryConsult &&
    hasSurgery
  );
}

function hasSpinalEpiduralAbscessUrgentMriAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasModality = SPINAL_EPIDURAL_ABSCESS_MRI_MODALITY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = SPINAL_EPIDURAL_ABSCESS_MRI_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasRegion = SPINAL_EPIDURAL_ABSCESS_MRI_REGION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasContrast = SPINAL_EPIDURAL_ABSCESS_MRI_CONTRAST_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasModality && hasUrgency && hasRegion && hasContrast;
  });
}

function hasSpinalEpiduralAbscessEmpiricAntibioticAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasBaseAntibiotic = SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_BASE_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasSpecificAntibiotic = SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_SPECIFIC_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasBaseAntibiotic && hasSpecificAntibiotic && hasUrgency;
  });
}

function hasSpinalEpiduralAbscessTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSerialNeuroSafety = SPINAL_EPIDURAL_ABSCESS_SERIAL_NEURO_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasNeuroDeficitSafety = SPINAL_EPIDURAL_ABSCESS_NEURO_DEFICIT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSepsisSafety = SPINAL_EPIDURAL_ABSCESS_SEPSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBacteremiaSourceSafety =
    SPINAL_EPIDURAL_ABSCESS_BACTEREMIA_SOURCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasHostProcedureRiskSafety =
    SPINAL_EPIDURAL_ABSCESS_HOST_PROCEDURE_RISK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCultureBeforeAntibioticSafety =
    SPINAL_EPIDURAL_ABSCESS_CULTURE_BEFORE_ANTIBIOTIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasBiopsyStableSafety = SPINAL_EPIDURAL_ABSCESS_BIOPSY_STABLE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDoNotDelayAntibioticSafety =
    SPINAL_EPIDURAL_ABSCESS_DO_NOT_DELAY_ANTIBIOTIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasSerialNeuroSafety &&
    hasNeuroDeficitSafety &&
    hasSepsisSafety &&
    hasBacteremiaSourceSafety &&
    hasHostProcedureRiskSafety &&
    hasCultureBeforeAntibioticSafety &&
    hasBiopsyStableSafety &&
    hasDoNotDelayAntibioticSafety
  );
}

function hasSpinalEpiduralAbscessLpDrainageAntibioticSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasLpAvoidance = SPINAL_EPIDURAL_ABSCESS_LP_AVOIDANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDrainageDecompression =
    SPINAL_EPIDURAL_ABSCESS_DRAINAGE_DECOMPRESSION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntibioticCoverage =
    SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_COVERAGE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return hasLpAvoidance && hasDrainageDecompression && hasAntibioticCoverage;
}

function requiresSepticArthritisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SEPTIC_ARTHRITIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasSepticArthritisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasArthrocentesis = hasSepticArthritisUrgentArthrocentesisAction(actions);
  const hasSynovialStudies = SEPTIC_ARTHRITIS_SYNOVIAL_STUDY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodCultureLab = SEPTIC_ARTHRITIS_BLOOD_CULTURE_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = hasSepticArthritisEmpiricAntibioticAction(actions);
  const hasOrthoTeam = SEPTIC_ARTHRITIS_ORTHO_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasJointDrainage = SEPTIC_ARTHRITIS_JOINT_DRAINAGE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasArthrocentesis &&
    hasSynovialStudies &&
    hasBloodCultureLab &&
    hasAntibiotic &&
    hasOrthoTeam &&
    hasJointDrainage
  );
}

function hasSepticArthritisUrgentArthrocentesisAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasSpecificProcedure = SEPTIC_ARTHRITIS_ARTHROCENTESIS_PROCEDURE_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasGenericProcedure =
      SEPTIC_ARTHRITIS_ARTHROCENTESIS_GENERIC_PROCEDURE_TERMS.some((term) =>
        containsSafetyTerm(normalizedAction, term),
      );
    const hasTarget = SEPTIC_ARTHRITIS_ARTHROCENTESIS_TARGET_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = SEPTIC_ARTHRITIS_ARTHROCENTESIS_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasUrgency && (hasSpecificProcedure || (hasGenericProcedure && hasTarget));
  });
}

function hasSepticArthritisEmpiricAntibioticAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasBaseAntibiotic = SEPTIC_ARTHRITIS_ANTIBIOTIC_BASE_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasSpecificAntibiotic = SEPTIC_ARTHRITIS_ANTIBIOTIC_SPECIFIC_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = SEPTIC_ARTHRITIS_ANTIBIOTIC_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasSpecificAntibiotic || (hasBaseAntibiotic && hasUrgency);
  });
}

function hasSepticArthritisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasCrystalLimitation = SEPTIC_ARTHRITIS_CRYSTAL_LIMITATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticTiming = SEPTIC_ARTHRITIS_ANTIBIOTIC_TIMING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPathogenRisk = SEPTIC_ARTHRITIS_PATHOGEN_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationSource = SEPTIC_ARTHRITIS_COMPLICATION_SOURCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasCrystalLimitation &&
    hasAntibioticTiming &&
    hasPathogenRisk &&
    hasComplicationSource
  );
}

function requiresUpperGiBleedSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return UPPER_GI_BLEED_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasUpperGiBleedTimeCriticalActions(actions: string[]): boolean {
  const hasResuscitation = hasUpperGiBleedResuscitationAction(actions);
  const hasTransfusionLab = hasUpperGiBleedTransfusionLabAction(actions);
  const hasEndoscopy = hasUpperGiBleedEndoscopyAction(actions);
  const hasPpiVaricealAction = hasUpperGiBleedMedicationAction(actions);
  return hasResuscitation && hasTransfusionLab && hasEndoscopy && hasPpiVaricealAction;
}

function hasUpperGiBleedResuscitationAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    return UPPER_GI_BLEED_RESUSCITATION_INTERVENTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
  });
}

function hasUpperGiBleedTransfusionLabAction(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLab = UPPER_GI_BLEED_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodProduct = UPPER_GI_BLEED_BLOOD_PRODUCT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasLab && hasBloodProduct;
}

function hasUpperGiBleedEndoscopyAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasProcedure = UPPER_GI_BLEED_ENDOSCOPY_PROCEDURE_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasUrgency = UPPER_GI_BLEED_ENDOSCOPY_URGENCY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasSourceControl = UPPER_GI_BLEED_ENDOSCOPY_SOURCE_CONTROL_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasProcedure && (hasUrgency || hasSourceControl);
  });
}

function hasUpperGiBleedMedicationAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasAcidSuppression = UPPER_GI_BLEED_ACID_SUPPRESSION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasVaricealVasoactive = UPPER_GI_BLEED_VARICEAL_VASOACTIVE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasVaricealAntibiotic = UPPER_GI_BLEED_VARICEAL_ANTIBIOTIC_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasAcidSuppression || (hasVaricealVasoactive && hasVaricealAntibiotic);
  });
}

function hasUpperGiBleedTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAirwayAspirationSafety = UPPER_GI_BLEED_AIRWAY_ASPIRATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntithromboticReversalSafety =
    UPPER_GI_BLEED_ANTITHROMBOTIC_REVERSAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasVaricealRescueSafety = UPPER_GI_BLEED_VARICEAL_RESCUE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRebleedDispositionSafety =
    UPPER_GI_BLEED_REBLEED_DISPOSITION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasAirwayAspirationSafety &&
    hasAntithromboticReversalSafety &&
    hasVaricealRescueSafety &&
    hasRebleedDispositionSafety
  );
}

function hasUpperGiBleedRiskEndoscopyMedicationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRiskScoring = UPPER_GI_BLEED_RISK_SCORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEndoscopyTiming = UPPER_GI_BLEED_ENDOSCOPY_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagulationProductSafety = UPPER_GI_BLEED_COAGULATION_PRODUCT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPpiTimingSafety = UPPER_GI_BLEED_PPI_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVaricealDefinitiveSafety = UPPER_GI_BLEED_VARICEAL_DEFINITIVE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasRiskScoring &&
    hasEndoscopyTiming &&
    hasCoagulationProductSafety &&
    hasPpiTimingSafety &&
    hasVaricealDefinitiveSafety
  );
}

function requiresAcuteCholecystitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
    detail.coach_guidance,
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_CHOLECYSTITIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasAcuteCholecystitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSeverity = ACUTE_CHOLECYSTITIS_SEVERITY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibioticCulture = hasAcuteCholecystitisAntibioticCultureAction(actions);
  const hasImaging = hasAcuteCholecystitisImagingAction(actions);
  const hasSourceControl = hasAcuteCholecystitisSourceControlAction(actions);
  return hasSeverity && hasAntibioticCulture && hasImaging && hasSourceControl;
}

function hasAcuteCholecystitisAntibioticCultureAction(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAntibiotic = ACUTE_CHOLECYSTITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCulture = ACUTE_CHOLECYSTITIS_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAntibiotic && hasCulture;
}

function hasAcuteCholecystitisImagingAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasModality = ACUTE_CHOLECYSTITIS_IMAGING_MODALITY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasGallbladderContext = ACUTE_CHOLECYSTITIS_IMAGING_GALLBLADDER_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasModality && hasGallbladderContext;
  });
}

function hasAcuteCholecystitisSourceControlAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasSpecificSourceControl = ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_SPECIFIC_TERMS.some(
      (term) => containsSafetyTerm(normalizedAction, term),
    );
    const hasGenericSourceControl = ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_GENERIC_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasTarget = ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_TARGET_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasSpecificSourceControl || (hasGenericSourceControl && hasTarget);
  });
}

function hasAcuteCholecystitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHighRiskDrainage = ACUTE_CHOLECYSTITIS_HIGH_RISK_DRAINAGE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplication = ACUTE_CHOLECYSTITIS_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBileDuctSafety = ACUTE_CHOLECYSTITIS_BILE_DUCT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferential = ACUTE_CHOLECYSTITIS_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasHighRiskDrainage && hasComplication && hasBileDuctSafety && hasDifferential;
}

function requiresAcuteCholangitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_CHOLANGITIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAcuteCholangitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAntibioticSupport = hasAcuteCholangitisAntibioticAction(actions);
  const hasCultureLab = hasAcuteCholangitisCultureLabAction(actions);
  const hasImagingObstruction = hasAcuteCholangitisImagingObstructionAction(actions);
  const hasBiliaryAccess = ACUTE_CHOLANGITIS_BILIARY_ACCESS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDrainageRoute = hasAcuteCholangitisDrainageRouteAction(actions);
  const hasOrganSupport = ACUTE_CHOLANGITIS_ORGAN_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAntibioticSupport &&
    hasCultureLab &&
    hasImagingObstruction &&
    hasBiliaryAccess &&
    hasDrainageRoute &&
    hasOrganSupport
  );
}

function hasAcuteCholangitisAntibioticAction(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  return ACUTE_CHOLANGITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
}

function hasAcuteCholangitisCultureLabAction(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCulture = ACUTE_CHOLANGITIS_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLab = ACUTE_CHOLANGITIS_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCulture && hasLab;
}

function hasAcuteCholangitisImagingObstructionAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasModality = ACUTE_CHOLANGITIS_IMAGING_MODALITY_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasObstructionTarget = ACUTE_CHOLANGITIS_OBSTRUCTION_TARGET_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasModality && hasObstructionTarget;
  });
}

function hasAcuteCholangitisDrainageRouteAction(actions: string[]): boolean {
  return actions.some((action) => {
    const normalizedAction = String(action).toLowerCase();
    const hasSpecificRoute = ACUTE_CHOLANGITIS_DRAINAGE_ROUTE_SPECIFIC_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasGenericRoute = ACUTE_CHOLANGITIS_DRAINAGE_ROUTE_GENERIC_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    const hasTarget = ACUTE_CHOLANGITIS_DRAINAGE_TARGET_TERMS.some((term) =>
      containsSafetyTerm(normalizedAction, term),
    );
    return hasSpecificRoute || (hasGenericRoute && hasTarget);
  });
}

function hasAcuteCholangitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSeveritySafety = ACUTE_CHOLANGITIS_SEVERITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDrainageTimingSafety = ACUTE_CHOLANGITIS_DRAINAGE_TIMING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasProcedureRiskSafety = ACUTE_CHOLANGITIS_PROCEDURE_RISK_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSourceSafety = ACUTE_CHOLANGITIS_DIFFERENTIAL_SOURCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSeveritySafety &&
    hasDrainageTimingSafety &&
    hasProcedureRiskSafety &&
    hasDifferentialSourceSafety
  );
}

function requiresAcutePancreatitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_PANCREATITIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAcutePancreatitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFluid = ACUTE_PANCREATITIS_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnalgesiaSupport = ACUTE_PANCREATITIS_ANALGESIA_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDiagnosticEtiology = ACUTE_PANCREATITIS_DIAGNOSTIC_ETIOLOGY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasSeverityOrgan = ACUTE_PANCREATITIS_SEVERITY_ORGAN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasFluid && hasAnalgesiaSupport && hasDiagnosticEtiology && hasSeverityOrgan;
}

function hasAcutePancreatitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasErcpAction = ACUTE_PANCREATITIS_ERCP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasErcpIndication = ACUTE_PANCREATITIS_ERCP_INDICATION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasErcpNonroutineLimit = ACUTE_PANCREATITIS_ERCP_NONROUTINE_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticAvoidance = ACUTE_PANCREATITIS_ANTIBIOTIC_AVOIDANCE_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticInfectionLimit = ACUTE_PANCREATITIS_ANTIBIOTIC_INFECTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEnteralNutrition = ACUTE_PANCREATITIS_ENTERAL_NUTRITION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasParenteralLimit = ACUTE_PANCREATITIS_PARENTERAL_LIMIT_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNecrosisTarget = ACUTE_PANCREATITIS_NECROSIS_TARGET_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNecrosisTiming = ACUTE_PANCREATITIS_NECROSIS_TIMING_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNecrosisStepUp = ACUTE_PANCREATITIS_NECROSIS_STEP_UP_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasErcpAction &&
    hasErcpIndication &&
    hasErcpNonroutineLimit &&
    hasAntibioticAvoidance &&
    hasAntibioticInfectionLimit &&
    hasEnteralNutrition &&
    hasParenteralLimit &&
    hasNecrosisTarget &&
    hasNecrosisTiming &&
    hasNecrosisStepUp
  );
}

function requiresSmallBowelObstructionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SMALL_BOWEL_OBSTRUCTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasSmallBowelObstructionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasNpoNg = SMALL_BOWEL_OBSTRUCTION_NPO_NG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidElectrolyte = SMALL_BOWEL_OBSTRUCTION_FLUID_ELECTROLYTE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCtTransition = SMALL_BOWEL_OBSTRUCTION_CT_TRANSITION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgery = SMALL_BOWEL_OBSTRUCTION_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasNpoNg && hasFluidElectrolyte && hasCtTransition && hasSurgery;
}

function hasSmallBowelObstructionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasStrangulationSafety = SMALL_BOWEL_OBSTRUCTION_STRANGULATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasNonoperativeLimits = SMALL_BOWEL_OBSTRUCTION_NONOPERATIVE_LIMITS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPerforationSepsis = SMALL_BOWEL_OBSTRUCTION_PERFORATION_SEPSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAspirationEtiology =
    SMALL_BOWEL_OBSTRUCTION_ASPIRATION_ETIOLOGY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasStrangulationSafety &&
    hasNonoperativeLimits &&
    hasPerforationSepsis &&
    hasAspirationEtiology
  );
}

function requiresPediatricMidgutVolvulusSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = PEDIATRIC_MIDGUT_VOLVULUS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasInfantContext = PEDIATRIC_MIDGUT_VOLVULUS_INFANT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasBiliousRisk = PEDIATRIC_MIDGUT_VOLVULUS_BILIOUS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSeverity = PEDIATRIC_MIDGUT_VOLVULUS_SEVERITY_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasBiliousRisk && (hasInfantContext || hasSeverity);
}

function hasPediatricMidgutVolvulusTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasUgi = PEDIATRIC_MIDGUT_VOLVULUS_UGI_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgerySpecialist = PEDIATRIC_MIDGUT_VOLVULUS_SURGERY_SPECIALIST_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasOperativeCorrection = PEDIATRIC_MIDGUT_VOLVULUS_OPERATIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasResuscitation = PEDIATRIC_MIDGUT_VOLVULUS_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIschemiaMonitoring = PEDIATRIC_MIDGUT_VOLVULUS_ISCHEMIA_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasUgi &&
    hasSurgerySpecialist &&
    hasOperativeCorrection &&
    hasResuscitation &&
    hasIschemiaMonitoring
  );
}

function hasPediatricMidgutVolvulusTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRefluxReassuranceSafety =
    PEDIATRIC_MIDGUT_VOLVULUS_REFLUX_REASSURANCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasNormalXraySafety = PEDIATRIC_MIDGUT_VOLVULUS_NORMAL_XRAY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasImagingLimitationSafety =
    PEDIATRIC_MIDGUT_VOLVULUS_IMAGING_LIMITATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDelaySafety = PEDIATRIC_MIDGUT_VOLVULUS_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMetabolicAspirationSafety =
    PEDIATRIC_MIDGUT_VOLVULUS_METABOLIC_ASPIRATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasRefluxReassuranceSafety &&
    hasNormalXraySafety &&
    hasImagingLimitationSafety &&
    hasDelaySafety &&
    hasMetabolicAspirationSafety
  );
}

function requiresNecrotizingEnterocolitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = NECROTIZING_ENTEROCOLITIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasNeonatalContext = NECROTIZING_ENTEROCOLITIS_NEONATAL_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = NECROTIZING_ENTEROCOLITIS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasNeonatalContext && hasRisk;
}

function hasNecrotizingEnterocolitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFeedingStop = NECROTIZING_ENTEROCOLITIS_FEEDING_STOP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecompression = NECROTIZING_ENTEROCOLITIS_DECOMPRESSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSupport = NECROTIZING_ENTEROCOLITIS_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotics = NECROTIZING_ENTEROCOLITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = NECROTIZING_ENTEROCOLITIS_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasFeedingStop && hasDecompression && hasSupport && hasAntibiotics && hasMonitoring;
}

function hasNecrotizingEnterocolitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSurgerySafety = NECROTIZING_ENTEROCOLITIS_SURGERY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPerforationSafety = NECROTIZING_ENTEROCOLITIS_PERFORATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasWorseningSafety = NECROTIZING_ENTEROCOLITIS_WORSENING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasIsolationSafety = NECROTIZING_ENTEROCOLITIS_ISOLATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationFollowup =
    NECROTIZING_ENTEROCOLITIS_COMPLICATION_FOLLOWUP_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasSurgerySafety &&
    hasPerforationSafety &&
    hasWorseningSafety &&
    hasIsolationSafety &&
    hasComplicationFollowup
  );
}

function requiresAcuteAppendicitisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
    detail.coach_guidance,
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_APPENDICITIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAcuteAppendicitisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRiskImaging = ACUTE_APPENDICITIS_RISK_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgeryTeam = ACUTE_APPENDICITIS_SURGERY_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAppendectomyPathway = ACUTE_APPENDICITIS_APPENDICECTOMY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = ACUTE_APPENDICITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasComplicationAssessment = ACUTE_APPENDICITIS_COMPLICATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasRiskImaging &&
    hasSurgeryTeam &&
    hasAppendectomyPathway &&
    hasAntibiotic &&
    hasComplicationAssessment
  );
}

function hasAcuteAppendicitisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNonoperativeSelection =
    ACUTE_APPENDICITIS_NONOPERATIVE_SELECTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSourceControl = ACUTE_APPENDICITIS_SOURCE_CONTROL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSpecialPopulationDifferential =
    ACUTE_APPENDICITIS_SPECIAL_POPULATION_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasPeritonitisSepsis = ACUTE_APPENDICITIS_PERITONITIS_SEPSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNonoperativeSelection &&
    hasSourceControl &&
    hasSpecialPopulationDifferential &&
    hasPeritonitisSepsis
  );
}

function requiresAcuteMesentericIschemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_MESENTERIC_ISCHEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasAcuteMesentericIschemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCta = ACUTE_MESENTERIC_ISCHEMIA_CTA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasResuscitation = ACUTE_MESENTERIC_ISCHEMIA_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = ACUTE_MESENTERIC_ISCHEMIA_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnticoagulation = ACUTE_MESENTERIC_ISCHEMIA_ANTICOAGULATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgeryTeam = ACUTE_MESENTERIC_ISCHEMIA_SURGERY_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRevascularizationSourceControl =
    ACUTE_MESENTERIC_ISCHEMIA_REVASCULARIZATION_SOURCE_CONTROL_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  return (
    hasCta &&
    hasResuscitation &&
    hasAntibiotic &&
    hasAnticoagulation &&
    hasSurgeryTeam &&
    hasRevascularizationSourceControl
  );
}

function hasAcuteMesentericIschemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAnticoagulationSafety = ACUTE_MESENTERIC_ISCHEMIA_ANTICOAGULATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasBowelViabilitySafety =
    ACUTE_MESENTERIC_ISCHEMIA_BOWEL_VIABILITY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCauseTypeSafety = ACUTE_MESENTERIC_ISCHEMIA_CAUSE_TYPE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLactateLimitationSafety =
    ACUTE_MESENTERIC_ISCHEMIA_LACTATE_LIMITATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasAnticoagulationSafety &&
    hasBowelViabilitySafety &&
    hasCauseTypeSafety &&
    hasLactateLimitationSafety
  );
}

function requiresNecrotizingSoftTissueInfectionSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return NECROTIZING_SOFT_TISSUE_INFECTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function requiresFournierGasGangreneSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  if (!requiresNecrotizingSoftTissueInfectionSafetyCheck(detail)) {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return FOURNIER_GAS_GANGRENE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasNecrotizingSoftTissueInfectionRedFlags(redFlags: string[]): boolean {
  const normalizedRedFlags = redFlags.join(" ").toLowerCase();
  return NECROTIZING_SOFT_TISSUE_INFECTION_RED_FLAG_TERMS.some((term) =>
    containsSafetyTerm(normalizedRedFlags, term),
  );
}

function hasNecrotizingSoftTissueInfectionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSurgeryTeam = NECROTIZING_SOFT_TISSUE_INFECTION_SURGERY_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDebridement = NECROTIZING_SOFT_TISSUE_INFECTION_DEBRIDEMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = NECROTIZING_SOFT_TISSUE_INFECTION_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBroadCoverage = NECROTIZING_SOFT_TISSUE_INFECTION_BROAD_COVERAGE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasResuscitation = NECROTIZING_SOFT_TISSUE_INFECTION_RESUSCITATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDelayPrevention = NECROTIZING_SOFT_TISSUE_INFECTION_DELAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasSurgeryTeam &&
    hasDebridement &&
    hasAntibiotic &&
    hasBroadCoverage &&
    hasResuscitation &&
    hasDelayPrevention
  );
}

function hasNecrotizingSoftTissueInfectionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasToxinSafety = NECROTIZING_SOFT_TISSUE_INFECTION_TOXIN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRepeatSourceSafety = NECROTIZING_SOFT_TISSUE_INFECTION_REPEAT_SOURCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDiagnosticLimitationSafety =
    NECROTIZING_SOFT_TISSUE_INFECTION_DIAGNOSTIC_LIMITATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasOrganRiskSafety = NECROTIZING_SOFT_TISSUE_INFECTION_ORGAN_RISK_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasToxinSafety &&
    hasRepeatSourceSafety &&
    hasDiagnosticLimitationSafety &&
    hasOrganRiskSafety
  );
}

function hasFournierGasGangreneTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPenicillinSafety = FOURNIER_GAS_GANGRENE_PENICILLIN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasProteinSynthesisSafety = FOURNIER_GAS_GANGRENE_PROTEIN_SYNTHESIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSourceTeamSafety = FOURNIER_GAS_GANGRENE_SOURCE_TEAM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHboDelaySafety = FOURNIER_GAS_GANGRENE_HBO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPenicillinSafety &&
    hasProteinSynthesisSafety &&
    hasSourceTeamSafety &&
    hasHboDelaySafety
  );
}

function requiresRupturedAaaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return RUPTURED_AAA_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasRupturedAaaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasVascularTeam = RUPTURED_AAA_VASCULAR_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRepairAction = RUPTURED_AAA_REPAIR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemodynamicAction = RUPTURED_AAA_HEMODYNAMIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodAction = RUPTURED_AAA_BLOOD_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImagingAction = RUPTURED_AAA_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasVascularTeam &&
    hasRepairAction &&
    hasHemodynamicAction &&
    hasBloodAction &&
    hasImagingAction
  );
}

function hasRupturedAaaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasTransferDelaySafety = RUPTURED_AAA_TRANSFER_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntithromboticSafety = RUPTURED_AAA_ANTITHROMBOTIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasShockComplicationSafety = RUPTURED_AAA_SHOCK_COMPLICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasTransferDelaySafety && hasAntithromboticSafety && hasShockComplicationSafety;
}

function hasRupturedAaaAdvancedTransferRepairSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRegionalTransfer = RUPTURED_AAA_REGIONAL_TRANSFER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRepairSelection = RUPTURED_AAA_REPAIR_SELECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAnesthesiaPeriop = RUPTURED_AAA_ANESTHESIA_PERIOP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransferResuscitation = RUPTURED_AAA_TRANSFER_RESUSCITATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasRegionalTransfer &&
    hasRepairSelection &&
    hasAnesthesiaPeriop &&
    hasTransferResuscitation
  );
}

function requiresSubarachnoidHemorrhageSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SUBARACHNOID_HEMORRHAGE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasSubarachnoidHemorrhageTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCtAction = SUBARACHNOID_HEMORRHAGE_CT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLpOrCtaAction = SUBARACHNOID_HEMORRHAGE_LP_CTA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroAction = SUBARACHNOID_HEMORRHAGE_NEURO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBpOrNimodipineAction =
    SUBARACHNOID_HEMORRHAGE_BP_NIMODIPINE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  return hasCtAction && hasLpOrCtaAction && hasNeuroAction && hasBpOrNimodipineAction;
}

function hasSubarachnoidHemorrhageTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAnticoagReversalSafety =
    SUBARACHNOID_HEMORRHAGE_ANTICOAG_REVERSAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRebleedBpSafety = SUBARACHNOID_HEMORRHAGE_REBLEED_BP_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationSafety = SUBARACHNOID_HEMORRHAGE_COMPLICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasAnticoagReversalSafety && hasRebleedBpSafety && hasComplicationSafety;
}

function hasSubarachnoidHemorrhageAdvancedAneurysmComplicationSafetyCheck(
  checks: string[],
): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDiagnosticTiming = SUBARACHNOID_HEMORRHAGE_DIAGNOSTIC_TIMING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAneurysmImaging = SUBARACHNOID_HEMORRHAGE_ANEURYSM_IMAGING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSecureAneurysm = SUBARACHNOID_HEMORRHAGE_SECURE_ANEURYSM_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasNimodipineRoute = SUBARACHNOID_HEMORRHAGE_NIMODIPINE_ROUTE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasHydrocephalusDci =
    SUBARACHNOID_HEMORRHAGE_HYDROCEPHALUS_DCI_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasDiagnosticTiming &&
    hasAneurysmImaging &&
    hasSecureAneurysm &&
    hasNimodipineRoute &&
    hasHydrocephalusDci
  );
}

function requiresIntracerebralHemorrhageSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = INTRACEREBRAL_HEMORRHAGE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = INTRACEREBRAL_HEMORRHAGE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasIntracerebralHemorrhageTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCtAction = INTRACEREBRAL_HEMORRHAGE_CT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBpAction = INTRACEREBRAL_HEMORRHAGE_BP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCoagReversalAction = INTRACEREBRAL_HEMORRHAGE_COAG_REVERSAL_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroIcuOrIcpAction = INTRACEREBRAL_HEMORRHAGE_NEURO_ICP_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return hasCtAction && hasBpAction && hasCoagReversalAction && hasNeuroIcuOrIcpAction;
}

function hasIntracerebralHemorrhageTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBpSafety = INTRACEREBRAL_HEMORRHAGE_BP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReversalSafety = INTRACEREBRAL_HEMORRHAGE_REVERSAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVteRestartSafety = INTRACEREBRAL_HEMORRHAGE_VTE_RESTART_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationSafety = INTRACEREBRAL_HEMORRHAGE_COMPLICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasBpSafety && hasReversalSafety && hasVteRestartSafety && hasComplicationSafety;
}

function hasIntracerebralHemorrhageAdvancedBpReversalVteSafetyCheck(
  checks: string[],
): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBpTargetExclusion = INTRACEREBRAL_HEMORRHAGE_BP_TARGET_EXCLUSION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasWarfarinReversal =
    INTRACEREBRAL_HEMORRHAGE_WARFARIN_SPECIFIC_REVERSAL_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDoacReversal = INTRACEREBRAL_HEMORRHAGE_DOAC_SPECIFIC_REVERSAL_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVtePeResponse = INTRACEREBRAL_HEMORRHAGE_VTE_PE_RESPONSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasBpTargetExclusion && hasWarfarinReversal && hasDoacReversal && hasVtePeResponse;
}

function requiresBbCcbOverdoseSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = BB_CCB_OVERDOSE_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = BB_CCB_OVERDOSE_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasShockContext = BB_CCB_OVERDOSE_SHOCK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasShockContext);
}

function hasBbCcbOverdoseTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEcgMonitoring = BB_CCB_OVERDOSE_ECG_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCalciumGlucagonAtropine =
    BB_CCB_OVERDOSE_CALCIUM_GLUCAGON_ATROPINE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasHiePathway = BB_CCB_OVERDOSE_HIE_PATHWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInsulin = BB_CCB_OVERDOSE_INSULIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVasopressor = BB_CCB_OVERDOSE_VASOPRESSOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = BB_CCB_OVERDOSE_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasEcgMonitoring &&
    hasCalciumGlucagonAtropine &&
    hasHiePathway &&
    hasInsulin &&
    hasVasopressor &&
    hasEscalation
  );
}

function hasBbCcbOverdoseTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHieMonitoring = BB_CCB_OVERDOSE_HIE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAirwaySeizureQrsSafety = BB_CCB_OVERDOSE_AIRWAY_SEIZURE_QRS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDecontaminationSafety = BB_CCB_OVERDOSE_DECONTAMINATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEscalationSafety = BB_CCB_OVERDOSE_ESCALATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHieMonitoring &&
    hasAirwaySeizureQrsSafety &&
    hasDecontaminationSafety &&
    hasEscalationSafety
  );
}

function requiresDigoxinToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = DIGOXIN_TOXICITY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = DIGOXIN_TOXICITY_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = DIGOXIN_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasRiskContext);
}

function hasDigoxinToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEcgMonitoring = DIGOXIN_TOXICITY_ECG_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLevelTiming = DIGOXIN_TOXICITY_LEVEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasElectrolyteRenal = DIGOXIN_TOXICITY_ELECTROLYTE_RENAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFab = DIGOXIN_TOXICITY_FAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxOrArrhythmiaSupport = DIGOXIN_TOXICITY_TOX_ARRHYTHMIA_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasEcgMonitoring &&
    hasLevelTiming &&
    hasElectrolyteRenal &&
    hasFab &&
    hasToxOrArrhythmiaSupport
  );
}

function hasDigoxinToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPotassiumSafety = DIGOXIN_TOXICITY_POTASSIUM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReboundRenalSafety = DIGOXIN_TOXICITY_REBOUND_RENAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPostFabLevelSafety = DIGOXIN_TOXICITY_POST_FAB_LEVEL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCalciumCardioversionSafety =
    DIGOXIN_TOXICITY_CALCIUM_CARDIOVERSION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDecontaminationSafety = DIGOXIN_TOXICITY_DECONTAMINATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPotassiumSafety &&
    hasReboundRenalSafety &&
    hasPostFabLevelSafety &&
    hasCalciumCardioversionSafety &&
    hasDecontaminationSafety
  );
}

function requiresTcaToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = TCA_TOXICITY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = TCA_TOXICITY_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = TCA_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasRiskContext);
}

function hasTcaToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEcgQrs = TCA_TOXICITY_ECG_QRS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBicarbonate = TCA_TOXICITY_BICARB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwayAcidosisSupport = TCA_TOXICITY_AIRWAY_ACIDOSIS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSeizureBenzo = TCA_TOXICITY_SEIZURE_BENZO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHypotensionEscalation = TCA_TOXICITY_HYPOTENSION_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasEcgQrs &&
    hasBicarbonate &&
    hasAirwayAcidosisSupport &&
    hasSeizureBenzo &&
    hasHypotensionEscalation
  );
}

function hasTcaToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDecontaminationSafety = TCA_TOXICITY_DECONTAMINATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAvoidanceSafety = TCA_TOXICITY_AVOIDANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPhSodiumSafety = TCA_TOXICITY_PH_SODIUM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasObservationSafety = TCA_TOXICITY_OBSERVATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDialysisLevelSafety = TCA_TOXICITY_DIALYSIS_LEVEL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDecontaminationSafety &&
    hasAvoidanceSafety &&
    hasPhSodiumSafety &&
    hasObservationSafety &&
    hasDialysisLevelSafety
  );
}

function requiresOrganophosphateToxicitySafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = ORGANOPHOSPHATE_TOXICITY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasExposureContext = ORGANOPHOSPHATE_TOXICITY_EXPOSURE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasCholinergicContext = ORGANOPHOSPHATE_TOXICITY_CHOLINERGIC_CONTEXT_TERMS.some(
    (term) => containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasExposureContext && hasCholinergicContext);
}

function hasOrganophosphateToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasPpeDecon = ORGANOPHOSPHATE_TOXICITY_PPE_DECON_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwaySecretionSupport =
    ORGANOPHOSPHATE_TOXICITY_AIRWAY_SECRETION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasAtropine = ORGANOPHOSPHATE_TOXICITY_ATROPINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPralidoxime = ORGANOPHOSPHATE_TOXICITY_PRALIDOXIME_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSeizureIcuEscalation = ORGANOPHOSPHATE_TOXICITY_SEIZURE_ICU_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasPpeDecon &&
    hasAirwaySecretionSupport &&
    hasAtropine &&
    hasPralidoxime &&
    hasSeizureIcuEscalation
  );
}

function hasOrganophosphateToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSuccinylcholineSafety =
    ORGANOPHOSPHATE_TOXICITY_SUCCINYLCHOLINE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasLabDiagnosisSafety = ORGANOPHOSPHATE_TOXICITY_LAB_DIAGNOSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPralidoximeOrderSafety =
    ORGANOPHOSPHATE_TOXICITY_PRALIDOXIME_ORDER_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasMonitoringSafety = ORGANOPHOSPHATE_TOXICITY_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDeconDelaySafety = ORGANOPHOSPHATE_TOXICITY_DECON_DELAY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSuccinylcholineSafety &&
    hasLabDiagnosisSafety &&
    hasPralidoximeOrderSafety &&
    hasMonitoringSafety &&
    hasDeconDelaySafety
  );
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

function hasSepsisResuscitationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPerfusionReassessment = SEPSIS_PERFUSION_REASSESSMENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFluidReassessment = SEPSIS_FLUID_REASSESSMENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVasopressorTarget = SEPSIS_VASOPRESSOR_TARGET_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSourceControl = SEPSIS_SOURCE_CONTROL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPerfusionReassessment &&
    hasFluidReassessment &&
    hasVasopressorTarget &&
    hasSourceControl
  );
}

function requiresAdultSepticShockBundleSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  if (isPediatricAge(detail.patient_demographics.age)) {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = ADULT_SEPTIC_SHOCK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = ADULT_SEPTIC_SHOCK_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasAdultSepticShockBundleActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCultures = ADULT_SEPTIC_SHOCK_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntimicrobials = ADULT_SEPTIC_SHOCK_ANTIMICROBIAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLactate = ADULT_SEPTIC_SHOCK_LACTATE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluids = ADULT_SEPTIC_SHOCK_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVasopressor = ADULT_SEPTIC_SHOCK_VASOPRESSOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceOrIcu = ADULT_SEPTIC_SHOCK_SOURCE_ICU_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCultures &&
    hasAntimicrobials &&
    hasLactate &&
    hasFluids &&
    hasVasopressor &&
    hasSourceOrIcu
  );
}

function requiresPediatricSepticShockSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  if (!isPediatricAge(detail.patient_demographics.age)) {
    return false;
  }
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.physical_exam),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = PEDIATRIC_SEPTIC_SHOCK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasGenericSepsis = SEPSIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = PEDIATRIC_SEPTIC_SHOCK_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return (hasContext || hasGenericSepsis) && hasRisk;
}

function hasPediatricSepticShockTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAntibioticsAndCultures =
    PEDIATRIC_SEPTIC_SHOCK_ANTIBIOTIC_CULTURE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasFluidBolus = PEDIATRIC_SEPTIC_SHOCK_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasReassessment = PEDIATRIC_SEPTIC_SHOCK_REASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVasoactive = PEDIATRIC_SEPTIC_SHOCK_VASOACTIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = PEDIATRIC_SEPTIC_SHOCK_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAntibioticsAndCultures &&
    hasFluidBolus &&
    hasReassessment &&
    hasVasoactive &&
    hasEscalation
  );
}

function hasPediatricSepticShockTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasFluidOverloadSafety = PEDIATRIC_SEPTIC_SHOCK_FLUID_OVERLOAD_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVasoactiveAccessSafety =
    PEDIATRIC_SEPTIC_SHOCK_VASOACTIVE_ACCESS_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasMetabolicSafety = PEDIATRIC_SEPTIC_SHOCK_METABOLIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidOrSourceSafety = PEDIATRIC_SEPTIC_SHOCK_STEROID_SOURCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasFluidOverloadSafety &&
    hasVasoactiveAccessSafety &&
    hasMetabolicSafety &&
    hasSteroidOrSourceSafety
  );
}

function requiresGuillainBarreSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = GUILLAIN_BARRE_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasNeuroRisk = GUILLAIN_BARRE_NEURO_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasNeuroRisk;
}

function hasGuillainBarreTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAdmissionNeurology = GUILLAIN_BARRE_ADMISSION_NEURO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratoryMonitoring = GUILLAIN_BARRE_RESPIRATORY_MONITOR_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasImmunotherapy = GUILLAIN_BARRE_IMMUNOTHERAPY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIcuAirwayEscalation = GUILLAIN_BARRE_ICU_AIRWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAdmissionNeurology &&
    hasRespiratoryMonitoring &&
    hasImmunotherapy &&
    hasIcuAirwayEscalation
  );
}

function hasGuillainBarreTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSteroidAvoidance = GUILLAIN_BARRE_STEROID_AVOIDANCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSequentialTherapySafety = GUILLAIN_BARRE_SEQUENTIAL_THERAPY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAutonomicSafety = GUILLAIN_BARRE_AUTONOMIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSupportiveSafety = GUILLAIN_BARRE_SUPPORTIVE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSteroidAvoidance &&
    hasSequentialTherapySafety &&
    hasAutonomicSafety &&
    hasSupportiveSafety
  );
}

function requiresMyasthenicCrisisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = MYASTHENIC_CRISIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = MYASTHENIC_CRISIS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasMyasthenicCrisisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRespiratoryMonitoring = MYASTHENIC_CRISIS_RESPIRATORY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwayIcu = MYASTHENIC_CRISIS_AIRWAY_ICU_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImmunotherapy = MYASTHENIC_CRISIS_IMMUNOTHERAPY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPrecipitantReview = MYASTHENIC_CRISIS_PRECIPITANT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasRespiratoryMonitoring && hasAirwayIcu && hasImmunotherapy && hasPrecipitantReview;
}

function hasMyasthenicCrisisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMedicationAvoidance = MYASTHENIC_CRISIS_MEDICATION_AVOIDANCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAcheiSafety = MYASTHENIC_CRISIS_ACETYLCHOLINESTERASE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidMonitoring = MYASTHENIC_CRISIS_STEROID_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasNivIntubationSafety = MYASTHENIC_CRISIS_NIV_INTUBATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasParalyticSafety = MYASTHENIC_CRISIS_PARALYTIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasMedicationAvoidance &&
    hasAcheiSafety &&
    hasSteroidMonitoring &&
    hasNivIntubationSafety &&
    hasParalyticSafety
  );
}

function requiresBotulismSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = BOTULISM_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = BOTULISM_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasBotulismTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasPublicHealth = BOTULISM_PUBLIC_HEALTH_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntitoxin = BOTULISM_ANTITOXIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratorySupport = BOTULISM_RESPIRATORY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecimenSource = BOTULISM_SPECIMEN_SOURCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasPublicHealth && hasAntitoxin && hasRespiratorySupport && hasSpecimenSource;
}

function hasBotulismTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoWaitLab = BOTULISM_NO_WAIT_LAB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfantAntitoxin = BOTULISM_INFANT_ANTITOXIN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasWoundSource = BOTULISM_WOUND_SOURCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSupportiveComplication = BOTULISM_SUPPORTIVE_COMPLICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasNoWaitLab && hasInfantAntitoxin && hasWoundSource && hasSupportiveComplication;
}

function requiresTickParalysisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = TICK_PARALYSIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = TICK_PARALYSIS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasTickParalysisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasTickSearch = TICK_PARALYSIS_SEARCH_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTickRemoval = TICK_PARALYSIS_REMOVAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratorySupport = TICK_PARALYSIS_RESPIRATORY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDifferentialReview = TICK_PARALYSIS_DIFFERENTIAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasTickSearch && hasTickRemoval && hasRespiratorySupport && hasDifferentialReview;
}

function hasTickParalysisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasIvigPlexSafety = TICK_PARALYSIS_IVIG_PLEX_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMouthpartsSafety = TICK_PARALYSIS_MOUTHPARTS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasObservationSafety = TICK_PARALYSIS_OBSERVATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfectionSafety = TICK_PARALYSIS_INFECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasIvigPlexSafety && hasMouthpartsSafety && hasObservationSafety && hasInfectionSafety;
}

function requiresMyocarditisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = MYOCARDITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = MYOCARDITIS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasMyocarditisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEcgTroponin = MYOCARDITIS_ECG_TROPONIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEchoImaging = MYOCARDITIS_ECHO_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdmission = MYOCARDITIS_ADMISSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = MYOCARDITIS_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasShockArrhythmia = MYOCARDITIS_SHOCK_ARRHYTHMIA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasEcgTroponin && hasEchoImaging && hasAdmission && hasMonitoring && hasShockArrhythmia;
}

function hasMyocarditisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasActivityRestriction = MYOCARDITIS_ACTIVITY_RESTRICTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasNsaidCardiotoxic = MYOCARDITIS_NSAID_CARDIOTOXIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoronaryExclusion = MYOCARDITIS_CORONARY_EXCLUSION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasBiopsyTertiary = MYOCARDITIS_BIOPSY_TERTIARY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFollowupMonitoring = MYOCARDITIS_FOLLOWUP_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasActivityRestriction &&
    hasNsaidCardiotoxic &&
    hasCoronaryExclusion &&
    hasBiopsyTertiary &&
    hasFollowupMonitoring
  );
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
  const hasPotassiumBeforeInsulin = DKA_POTASSIUM_BEFORE_INSULIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluid = DKA_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInsulin = DKA_INSULIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasClosureMonitoring = DKA_CLOSURE_MONITORING_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasPotassiumBeforeInsulin && hasFluid && hasInsulin && hasClosureMonitoring;
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

function hasDkaAdvancedInsulinTransitionSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBicarbonateSafety = DKA_BICARBONATE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPhosphateSafety = DKA_PHOSPHATE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDextroseAddition = DKA_DEXTROSE_ADDITION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInsulinContinuation = DKA_INSULIN_CONTINUATION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasResolutionEndpoint = DKA_KETOACIDOSIS_RESOLUTION_ENDPOINT_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBasalSubcutaneousInsulin = DKA_BASAL_SUBCUTANEOUS_INSULIN_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasIvToScOverlapTiming = DKA_IV_TO_SC_OVERLAP_TIMING_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransitionReadiness = DKA_TRANSITION_READINESS_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPrecipitantReview = DKA_PRECIPITANT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasBicarbonateSafety &&
    hasPhosphateSafety &&
    hasDextroseAddition &&
    hasInsulinContinuation &&
    hasResolutionEndpoint &&
    hasBasalSubcutaneousInsulin &&
    hasIvToScOverlapTiming &&
    hasTransitionReadiness &&
    hasPrecipitantReview
  );
}

function requiresPediatricDkaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
  ]
    .join(" ")
    .toLowerCase();
  let hasContext = PEDIATRIC_DKA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  if (!hasContext) {
    hasContext =
      isPediatricAge(detail.patient_demographics.age) &&
      DKA_TREATMENT_TRIGGER_TERMS.some((term) => containsSafetyTerm(riskText, term));
  }
  const hasRisk = PEDIATRIC_DKA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasPediatricDkaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSeverityAssessment = PEDIATRIC_DKA_SEVERITY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidPlan = PEDIATRIC_DKA_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInsulinPlan = PEDIATRIC_DKA_INSULIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasElectrolytePlan = PEDIATRIC_DKA_ELECTROLYTE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroEscalation = PEDIATRIC_DKA_NEURO_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasSeverityAssessment &&
    hasFluidPlan &&
    hasInsulinPlan &&
    hasElectrolytePlan &&
    hasNeuroEscalation
  );
}

function hasPediatricDkaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBicarbonateSafety = PEDIATRIC_DKA_BICARB_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCerebralInjurySafety = PEDIATRIC_DKA_CEREBRAL_INJURY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasHypoglycemiaElectrolyteSafety =
    PEDIATRIC_DKA_HYPOGLYCEMIA_ELECTROLYTE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDispositionTransitionSafety =
    PEDIATRIC_DKA_DISPOSITION_TRANSITION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasBicarbonateSafety &&
    hasCerebralInjurySafety &&
    hasHypoglycemiaElectrolyteSafety &&
    hasDispositionTransitionSafety
  );
}

function requiresHhsSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasHhsContext = HHS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasHyperosmolarRisk = HHS_HYPEROSMOLAR_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasHhsContext && hasHyperosmolarRisk;
}

function hasHhsTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFluidPerfusion = HHS_FLUID_PERFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOsmolalitySodium = HHS_OSMOLALITY_SODIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasGlucoseKetoneAcidbase = HHS_GLUCOSE_KETONE_ACIDBASE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasInsulinPotassium = HHS_INSULIN_POTASSIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPrecipitantEscalation = HHS_PRECIPITANT_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasFluidPerfusion &&
    hasOsmolalitySodium &&
    hasGlucoseKetoneAcidbase &&
    hasInsulinPotassium &&
    hasPrecipitantEscalation
  );
}

function hasHhsTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOsmolarCorrectionSafety = HHS_OSMOLAR_CORRECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInsulinTimingSafety = HHS_INSULIN_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPotassiumRenalFluidSafety = HHS_POTASSIUM_RENAL_FLUID_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasThrombosisPrecipitantSafety = HHS_THROMBOSIS_PRECIPITANT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasResolutionDispositionSafety = HHS_RESOLUTION_DISPOSITION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOsmolarCorrectionSafety &&
    hasInsulinTimingSafety &&
    hasPotassiumRenalFluidSafety &&
    hasThrombosisPrecipitantSafety &&
    hasResolutionDispositionSafety
  );
}

function requiresHyponatremiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasHyponatremiaContext = HYPONATREMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSevereRisk = HYPONATREMIA_SEVERE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasHyponatremiaContext && hasSevereRisk;
}

function hasHyponatremiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSodiumOsm = HYPONATREMIA_SODIUM_OSM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHypertonic = HYPONATREMIA_HYPERTONIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroEscalation = HYPONATREMIA_NEURO_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = HYPONATREMIA_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCauseEvaluation = HYPONATREMIA_CAUSE_EVALUATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasSodiumOsm &&
    hasHypertonic &&
    hasNeuroEscalation &&
    hasMonitoring &&
    hasCauseEvaluation
  );
}

function hasHyponatremiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasCorrectionLimit = HYPONATREMIA_CORRECTION_LIMIT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHighRiskReview = HYPONATREMIA_HIGH_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOvercorrectionRescue = HYPONATREMIA_OVERCORRECTION_RESCUE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVolumeCauseSafety = HYPONATREMIA_VOLUME_CAUSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionMonitoring = HYPONATREMIA_DISPOSITION_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasCorrectionLimit &&
    hasHighRiskReview &&
    hasOvercorrectionRescue &&
    hasVolumeCauseSafety &&
    hasDispositionMonitoring
  );
}

function requiresRhabdomyolysisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
  ]
    .join(" ")
    .toLowerCase();

  const hasRhabdomyolysisContext = RHABDOMYOLYSIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasSevereRisk = RHABDOMYOLYSIS_SEVERE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasRhabdomyolysisContext && hasSevereRisk;
}

function hasRhabdomyolysisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCkMyoglobin = RHABDOMYOLYSIS_CK_MYOGLOBIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluid = RHABDOMYOLYSIS_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrineMonitoring = RHABDOMYOLYSIS_URINE_MONITORING_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasUrineOutputTarget = RHABDOMYOLYSIS_URINE_OUTPUT_TARGET_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasElectrolyteEcg = RHABDOMYOLYSIS_ELECTROLYTE_ECG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCauseComplication = RHABDOMYOLYSIS_CAUSE_COMPLICATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCkMyoglobin &&
    hasFluid &&
    hasUrineMonitoring &&
    hasUrineOutputTarget &&
    hasElectrolyteEcg &&
    hasCauseComplication
  );
}

function hasRhabdomyolysisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasVolumeRenalSafety = RHABDOMYOLYSIS_VOLUME_RENAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBicarbMannitolSafety = RHABDOMYOLYSIS_BICARB_MANNITOL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDialysisSafety = RHABDOMYOLYSIS_DIALYSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCalciumElectrolyteSafety = RHABDOMYOLYSIS_CALCIUM_ELECTROLYTE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCompartmentDicSafety = RHABDOMYOLYSIS_COMPARTMENT_DIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasVolumeRenalSafety &&
    hasBicarbMannitolSafety &&
    hasDialysisSafety &&
    hasCalciumElectrolyteSafety &&
    hasCompartmentDicSafety
  );
}

function requiresHypercalcemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.key_teaching_points),
  ]
    .join(" ")
    .toLowerCase();

  const hasHypercalcemiaContext = HYPERCALCEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasSevereRisk = HYPERCALCEMIA_SEVERE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasHypercalcemiaContext && hasSevereRisk;
}

function hasHypercalcemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCalciumConfirmation = HYPERCALCEMIA_CALCIUM_CONFIRMATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasEcgRenal = HYPERCALCEMIA_ECG_RENAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSaline = HYPERCALCEMIA_SALINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCalcitonin = HYPERCALCEMIA_CALCITONIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntiresorptive = HYPERCALCEMIA_ANTIRESORPTIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCauseDialysis = HYPERCALCEMIA_CAUSE_DIALYSIS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCalciumConfirmation &&
    hasEcgRenal &&
    hasSaline &&
    hasCalcitonin &&
    hasAntiresorptive &&
    hasCauseDialysis
  );
}

function hasHypercalcemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasFluidSafety = HYPERCALCEMIA_FLUID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLoopDiureticSafety = HYPERCALCEMIA_LOOP_DIURETIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRenalAntiresorptiveSafety = HYPERCALCEMIA_RENAL_ANTIRESORPTIVE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasOffendingAgentSafety = HYPERCALCEMIA_OFFENDING_AGENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRefractoryDialysisSafety = HYPERCALCEMIA_REFRACTORY_DIALYSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasFluidSafety &&
    hasLoopDiureticSafety &&
    hasRenalAntiresorptiveSafety &&
    hasOffendingAgentSafety &&
    hasRefractoryDialysisSafety
  );
}

function requiresHypocalcemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.key_teaching_points),
  ]
    .join(" ")
    .toLowerCase();

  const hasHypocalcemiaContext = HYPOCALCEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasSevereRisk = HYPOCALCEMIA_SEVERE_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasHypocalcemiaContext && hasSevereRisk;
}

function hasHypocalcemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCalciumConfirmation = HYPOCALCEMIA_CALCIUM_CONFIRMATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasEcgMonitoring = HYPOCALCEMIA_ECG_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIvCalcium = HYPOCALCEMIA_IV_CALCIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInfusionMonitoring = HYPOCALCEMIA_INFUSION_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMagnesiumCause = HYPOCALCEMIA_MAGNESIUM_CAUSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCalciumConfirmation &&
    hasEcgMonitoring &&
    hasIvCalcium &&
    hasInfusionMonitoring &&
    hasMagnesiumCause
  );
}

function hasHypocalcemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDigoxinEcgSafety = HYPOCALCEMIA_DIGOXIN_ECG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasExtravasationSafety = HYPOCALCEMIA_EXTRAVASATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPhosphateProductSafety = HYPOCALCEMIA_PHOSPHATE_PRODUCT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMagnesiumRepletionSafety = HYPOCALCEMIA_MAGNESIUM_REPLETION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransitionSafety = HYPOCALCEMIA_TRANSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDigoxinEcgSafety &&
    hasExtravasationSafety &&
    hasPhosphateProductSafety &&
    hasMagnesiumRepletionSafety &&
    hasTransitionSafety
  );
}

function requiresTumorLysisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.initial_labs),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.key_teaching_points),
  ]
    .join(" ")
    .toLowerCase();

  const hasTlsContext = TUMOR_LYSIS_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasSevereRisk = TUMOR_LYSIS_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasTlsContext && hasSevereRisk;
}

function hasTumorLysisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLabMonitoring = TUMOR_LYSIS_LAB_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHydration = TUMOR_LYSIS_HYDRATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrate = TUMOR_LYSIS_URATE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEcgElectrolyte = TUMOR_LYSIS_ECG_ELECTROLYTE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRenalEscalation = TUMOR_LYSIS_RENAL_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasLabMonitoring && hasHydration && hasUrate && hasEcgElectrolyte && hasRenalEscalation;
}

function hasTumorLysisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRasburicaseG6pdSafety = TUMOR_LYSIS_RASBURICASE_G6PD_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRasburicaseAdverseSafety = TUMOR_LYSIS_RASBURICASE_ADVERSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAlkalinizationSafety = TUMOR_LYSIS_ALKALINIZATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFluidSafety = TUMOR_LYSIS_FLUID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAllopurinolSafety = TUMOR_LYSIS_ALLOPURINOL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCalciumPhosphateSafety = TUMOR_LYSIS_CALCIUM_PHOSPHATE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasDialysisSafety = TUMOR_LYSIS_DIALYSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasRasburicaseG6pdSafety &&
    hasRasburicaseAdverseSafety &&
    hasAlkalinizationSafety &&
    hasFluidSafety &&
    hasAllopurinolSafety &&
    hasCalciumPhosphateSafety &&
    hasDialysisSafety
  );
}

function requiresHyperkalemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return HYPERKALEMIA_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasHyperkalemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCalcium = HYPERKALEMIA_CALCIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInsulinShift = HYPERKALEMIA_INSULIN_SHIFT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasGlucoseCotherapy = HYPERKALEMIA_GLUCOSE_COTHERAPY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRemoval = HYPERKALEMIA_REMOVAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCalcium && hasInsulinShift && hasGlucoseCotherapy && hasRemoval;
}

function hasHyperkalemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasEcgMonitoring = HYPERKALEMIA_ECG_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasGlucoseSafety = HYPERKALEMIA_GLUCOSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceReview = HYPERKALEMIA_RECURRENCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasEcgMonitoring && hasGlucoseSafety && hasRecurrenceReview;
}

function requiresStatusEpilepticusSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return STATUS_EPILEPTICUS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasStatusEpilepticusTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirway = STATUS_EPILEPTICUS_AIRWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBenzo = STATUS_EPILEPTICUS_BENZO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSecondLinePathway = STATUS_EPILEPTICUS_SECOND_LINE_PATHWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSecondLineMedication = STATUS_EPILEPTICUS_SECOND_LINE_MEDICATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRefractoryEscalation = STATUS_EPILEPTICUS_REFRACTORY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAirway &&
    hasBenzo &&
    hasSecondLinePathway &&
    hasSecondLineMedication &&
    hasRefractoryEscalation
  );
}

function hasStatusEpilepticusTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasGlucoseSafety = STATUS_EPILEPTICUS_GLUCOSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRespiratorySafety = STATUS_EPILEPTICUS_RESPIRATORY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAsmSafety = STATUS_EPILEPTICUS_ASM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasGlucoseSafety && hasRespiratorySafety && hasAsmSafety;
}

function requiresSevereAlcoholWithdrawalSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SEVERE_ALCOHOL_WITHDRAWAL_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSevereRisk = SEVERE_ALCOHOL_WITHDRAWAL_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasSevereRisk;
}

function hasSevereAlcoholWithdrawalTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAssessment = SEVERE_ALCOHOL_WITHDRAWAL_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBenzo = SEVERE_ALCOHOL_WITHDRAWAL_BENZO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasThiamine = SEVERE_ALCOHOL_WITHDRAWAL_THIAMINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasElectrolyte = SEVERE_ALCOHOL_WITHDRAWAL_ELECTROLYTE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = SEVERE_ALCOHOL_WITHDRAWAL_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAssessment && hasBenzo && hasThiamine && hasElectrolyte && hasEscalation;
}

function hasSevereAlcoholWithdrawalTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRespiratorySedation =
    SEVERE_ALCOHOL_WITHDRAWAL_RESPIRATORY_SEDATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDifferential = SEVERE_ALCOHOL_WITHDRAWAL_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHepaticMedSafety = SEVERE_ALCOHOL_WITHDRAWAL_HEPATIC_MED_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDisposition = SEVERE_ALCOHOL_WITHDRAWAL_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasRespiratorySedation && hasDifferential && hasHepaticMedSafety && hasDisposition;
}

function requiresAdrenalCrisisSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ADRENAL_CRISIS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAdrenalCrisisTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSteroid = ADRENAL_CRISIS_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidOrGlucose = ADRENAL_CRISIS_FLUID_GLUCOSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMonitoring = ADRENAL_CRISIS_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasSteroid && hasFluidOrGlucose && hasMonitoring;
}

function hasAdrenalCrisisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDoNotDelaySafety = ADRENAL_CRISIS_DO_NOT_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMonitoringSafety = ADRENAL_CRISIS_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPrecipitantReview = ADRENAL_CRISIS_PRECIPITANT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDoNotDelaySafety && hasMonitoringSafety && hasPrecipitantReview;
}

function requiresButtonBatterySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return BUTTON_BATTERY_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasButtonBatteryTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasXray = BUTTON_BATTERY_XRAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPoisonNpo = BUTTON_BATTERY_POISON_NPO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHoneyOrSucralfate = BUTTON_BATTERY_HONEY_SUCRALFATE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRemoval = BUTTON_BATTERY_REMOVAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasXray && hasPoisonNpo && hasHoneyOrSucralfate && hasRemoval;
}

function hasButtonBatteryTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelaySafety = BUTTON_BATTERY_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEsophagealInjurySafety = BUTTON_BATTERY_ESOPHAGEAL_INJURY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasLocationDispositionSafety = BUTTON_BATTERY_LOCATION_DISPOSITION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAvoidanceSafety = BUTTON_BATTERY_AVOIDANCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNoDelaySafety &&
    hasEsophagealInjurySafety &&
    hasLocationDispositionSafety &&
    hasAvoidanceSafety
  );
}

function requiresAcetaminophenToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACETAMINOPHEN_TOXICITY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasAcetaminophenToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLevelNomogram = ACETAMINOPHEN_LEVEL_NOMOGRAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNac = ACETAMINOPHEN_NAC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHepaticMonitoring = ACETAMINOPHEN_HEPATIC_TOX_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasLevelNomogram && hasNac && hasHepaticMonitoring;
}

function hasAcetaminophenToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasTimingOrFormulationSafety = ACETAMINOPHEN_TIMING_FORMULATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasNacSafety = ACETAMINOPHEN_NAC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHepaticFailureSafety = ACETAMINOPHEN_HEPATIC_FAILURE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasTimingOrFormulationSafety && hasNacSafety && hasHepaticFailureSafety;
}

function requiresValproateToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = VALPROATE_TOXICITY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = VALPROATE_TOXICITY_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = VALPROATE_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasRiskContext);
}

function hasValproateToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasValproateLevel = VALPROATE_TOXICITY_LEVEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAmmoniaOrFreeLevel = VALPROATE_TOXICITY_AMMONIA_FREE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOrganLab = VALPROATE_TOXICITY_ORGAN_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasStabilization = VALPROATE_TOXICITY_STABILIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecontamination = VALPROATE_TOXICITY_DECONTAMINATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCarnitine = VALPROATE_TOXICITY_CARNITINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicologyEscalation = VALPROATE_TOXICITY_TOXICOLOGY_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDialysisEscalation = VALPROATE_TOXICITY_DIALYSIS_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasValproateLevel &&
    hasAmmoniaOrFreeLevel &&
    hasOrganLab &&
    hasStabilization &&
    hasDecontamination &&
    hasCarnitine &&
    hasToxicologyEscalation &&
    hasDialysisEscalation
  );
}

function hasValproateToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDialysisIndicationSafety =
    VALPROATE_TOXICITY_DIALYSIS_INDICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCarnitineAmmoniaSafety =
    VALPROATE_TOXICITY_CARNITINE_AMMONIA_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasFreeLevelSafety = VALPROATE_TOXICITY_FREE_LEVEL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFormulationAirwaySafety =
    VALPROATE_TOXICITY_FORMULATION_AIRWAY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasComplicationReproductiveSafety =
    VALPROATE_TOXICITY_COMPLICATION_REPRODUCTIVE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasDialysisIndicationSafety &&
    hasCarnitineAmmoniaSafety &&
    hasFreeLevelSafety &&
    hasFormulationAirwaySafety &&
    hasComplicationReproductiveSafety
  );
}

function requiresTheophyllineToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = THEOPHYLLINE_TOXICITY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = THEOPHYLLINE_TOXICITY_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = THEOPHYLLINE_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasRiskContext);
}

function hasTheophyllineToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSerumLevel = THEOPHYLLINE_TOXICITY_SERUM_LEVEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEcg = THEOPHYLLINE_TOXICITY_ECG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMetabolicLab = THEOPHYLLINE_TOXICITY_METABOLIC_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCoinOrOrganLab = THEOPHYLLINE_TOXICITY_COIN_ORGAN_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAbcHemodynamic = THEOPHYLLINE_TOXICITY_ABC_HEMODYNAMIC_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDecontamination = THEOPHYLLINE_TOXICITY_DECONTAMINATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasSeizure = THEOPHYLLINE_TOXICITY_SEIZURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicologyEscalation =
    THEOPHYLLINE_TOXICITY_TOXICOLOGY_ESCALATION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasDialysisEscalation =
    THEOPHYLLINE_TOXICITY_DIALYSIS_ESCALATION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasSerumLevel &&
    hasEcg &&
    hasMetabolicLab &&
    hasCoinOrOrganLab &&
    hasAbcHemodynamic &&
    hasDecontamination &&
    hasSeizure &&
    hasToxicologyEscalation &&
    hasDialysisEscalation
  );
}

function hasTheophyllineToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDialysisIndicationSafety =
    THEOPHYLLINE_TOXICITY_DIALYSIS_INDICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasArrhythmiaShockSafety =
    THEOPHYLLINE_TOXICITY_ARRHYTHMIA_SHOCK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasElectrolyteMetabolicSafety =
    THEOPHYLLINE_TOXICITY_ELECTROLYTE_METABOLIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDeconEctrSafety = THEOPHYLLINE_TOXICITY_DECON_ECTR_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasInteractionChronicSafety =
    THEOPHYLLINE_TOXICITY_INTERACTION_CHRONIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasDialysisIndicationSafety &&
    hasArrhythmiaShockSafety &&
    hasElectrolyteMetabolicSafety &&
    hasDeconEctrSafety &&
    hasInteractionChronicSafety
  );
}

function requiresToxicAlcoholSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return TOXIC_ALCOHOL_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasToxicAlcoholTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOsmolGapAction = TOXIC_ALCOHOL_OSMOL_GAP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicAlcoholLevelAction = TOXIC_ALCOHOL_LEVEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAnionGapAction = TOXIC_ALCOHOL_ANION_GAP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntidoteAction = TOXIC_ALCOHOL_ANTIDOTE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicologyEscalation = TOXIC_ALCOHOL_TOXICOLOGY_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDialysisEscalation = TOXIC_ALCOHOL_DIALYSIS_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasAcidosisSupport = TOXIC_ALCOHOL_ACIDOSIS_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasOsmolGapAction &&
    hasToxicAlcoholLevelAction &&
    hasAnionGapAction &&
    hasAntidoteAction &&
    hasToxicologyEscalation &&
    hasDialysisEscalation &&
    hasAcidosisSupport
  );
}

function hasToxicAlcoholTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDialysisIndicationSafety = TOXIC_ALCOHOL_DIALYSIS_INDICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasOrganInjurySafety = TOXIC_ALCOHOL_ORGAN_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoingestionDifferentialSafety =
    TOXIC_ALCOHOL_COINGESTION_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasEmpiricAntidoteSafety = TOXIC_ALCOHOL_EMPIRIC_ANTIDOTE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCofactorSafety = TOXIC_ALCOHOL_COFACTOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDialysisIndicationSafety &&
    hasOrganInjurySafety &&
    hasCoingestionDifferentialSafety &&
    hasEmpiricAntidoteSafety &&
    hasCofactorSafety
  );
}

function requiresLithiumToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();

  const hasDirectContext = LITHIUM_TOXICITY_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasDrugContext = LITHIUM_TOXICITY_DRUG_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRiskContext = LITHIUM_TOXICITY_RISK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || (hasDrugContext && hasRiskContext);
}

function hasLithiumToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasLevelMonitoring = LITHIUM_TOXICITY_LEVEL_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRenalCardiacMonitoring = LITHIUM_TOXICITY_RENAL_CARDIAC_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasVolumeStopManagement = LITHIUM_TOXICITY_VOLUME_STOP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasWbiPlanning = LITHIUM_TOXICITY_WBI_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCharcoalLimitation = LITHIUM_TOXICITY_CHARCOAL_LIMITATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicologyEscalation = LITHIUM_TOXICITY_TOXICOLOGY_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDialysisEscalation = LITHIUM_TOXICITY_DIALYSIS_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasLevelMonitoring &&
    hasRenalCardiacMonitoring &&
    hasVolumeStopManagement &&
    hasWbiPlanning &&
    hasCharcoalLimitation &&
    hasToxicologyEscalation &&
    hasDialysisEscalation
  );
}

function hasLithiumToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDialysisIndicationSafety =
    LITHIUM_TOXICITY_DIALYSIS_INDICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasReboundCessationSafety =
    LITHIUM_TOXICITY_REBOUND_CESSATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasPrecipitantSafety = LITHIUM_TOXICITY_PRECIPITANT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionClinicalSafety =
    LITHIUM_TOXICITY_DISPOSITION_CLINICAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasDialysisIndicationSafety &&
    hasReboundCessationSafety &&
    hasPrecipitantSafety &&
    hasDispositionClinicalSafety
  );
}

function requiresSalicylateToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SALICYLATE_TOXICITY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasSalicylateToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSalicylateLevelAction = SALICYLATE_LEVEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAcidBaseAction = SALICYLATE_ACID_BASE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecontaminationAction = SALICYLATE_DECONTAMINATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAlkalinizationAction = SALICYLATE_ALKALINIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxicologyEscalation = SALICYLATE_TOXICOLOGY_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDialysisEscalation = SALICYLATE_DIALYSIS_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasSalicylateLevelAction &&
    hasAcidBaseAction &&
    hasDecontaminationAction &&
    hasAlkalinizationAction &&
    hasToxicologyEscalation &&
    hasDialysisEscalation
  );
}

function hasSalicylateToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDialysisIndicationSafety = SALICYLATE_DIALYSIS_INDICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasIntubationPhSafety = SALICYLATE_INTUBATION_PH_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAlkalinizationTargetSafety = SALICYLATE_ALKALINIZATION_TARGET_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasElectrolyteGlucoseSafety = SALICYLATE_ELECTROLYTE_GLUCOSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDialysisIndicationSafety &&
    hasIntubationPhSafety &&
    hasAlkalinizationTargetSafety &&
    hasElectrolyteGlucoseSafety
  );
}

function requiresCarbonMonoxidePoisoningSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return CARBON_MONOXIDE_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasCarbonMonoxidePoisoningTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRemovalOxygenAction = CARBON_MONOXIDE_REMOVAL_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCohbDiagnosticAction = CARBON_MONOXIDE_COHB_DIAGNOSTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHyperbaricAction = CARBON_MONOXIDE_HYPERBARIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiacNeuroAction = CARBON_MONOXIDE_CARDIAC_NEURO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasRemovalOxygenAction &&
    hasCohbDiagnosticAction &&
    hasHyperbaricAction &&
    hasCardiacNeuroAction
  );
}

function hasCarbonMonoxidePoisoningTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPulseOxSafety = CARBON_MONOXIDE_PULSE_OX_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHboCriteriaSafety = CARBON_MONOXIDE_HBO_CRITERIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCohbLimitationSafety = CARBON_MONOXIDE_COHB_LIMITATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPregnancyTestSafety = CARBON_MONOXIDE_PREGNANCY_TEST_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationSafety = CARBON_MONOXIDE_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCyanideSmokeSafety = CARBON_MONOXIDE_CYANIDE_SMOKE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPulseOxSafety &&
    hasHboCriteriaSafety &&
    hasCohbLimitationSafety &&
    hasPregnancyTestSafety &&
    hasComplicationSafety &&
    hasCyanideSmokeSafety
  );
}

function requiresCyanidePoisoningSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return CYANIDE_POISONING_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasCyanidePoisoningTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasRemovalOxygenSupport = CYANIDE_REMOVAL_OXYGEN_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntidoteAction = CYANIDE_HYDROXOCOBALAMIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLactateAcidosisAction = CYANIDE_LACTATE_ACIDOSIS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPoisonEscalation = CYANIDE_POISON_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasRemovalOxygenSupport &&
    hasAntidoteAction &&
    hasLactateAcidosisAction &&
    hasPoisonEscalation
  );
}

function hasCyanidePoisoningTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDoNotWaitLevelSafety = CYANIDE_DO_NOT_WAIT_LEVEL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSmokeCoNitriteSafety = CYANIDE_SMOKE_CO_NITRITE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasShockNeuroSafety = CYANIDE_SHOCK_NEURO_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLactateTriggerSafety = CYANIDE_LACTATE_TRIGGER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHydroxocobalaminEffectSafety = CYANIDE_HYDROXOCOBALAMIN_EFFECT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDoNotWaitLevelSafety &&
    hasSmokeCoNitriteSafety &&
    hasShockNeuroSafety &&
    hasLactateTriggerSafety &&
    hasHydroxocobalaminEffectSafety
  );
}

function requiresSnakebiteEnvenomationSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SNAKEBITE_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasEnvenomationRisk = SNAKEBITE_ENVENOMATION_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasEnvenomationRisk;
}

function hasSnakebiteEnvenomationTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasFieldImmobilization = SNAKEBITE_FIELD_IMMOBILIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSerialExamLab = SNAKEBITE_SERIAL_EXAM_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntivenomAction = SNAKEBITE_ANTIVENOM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPoisonEscalation = SNAKEBITE_POISON_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratoryNeuro = SNAKEBITE_RESPIRATORY_NEURO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasFieldImmobilization &&
    hasSerialExamLab &&
    hasAntivenomAction &&
    hasPoisonEscalation &&
    hasRespiratoryNeuro
  );
}

function hasSnakebiteEnvenomationTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHarmfulFirstAidSafety = SNAKEBITE_HARMFUL_FIRST_AID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasObservationDisposition = SNAKEBITE_OBSERVATION_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoagulopathySafety = SNAKEBITE_COAGULOPATHY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntivenomReactionSafety = SNAKEBITE_ANTIVENOM_REACTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCompartmentFasciotomySafety = SNAKEBITE_COMPARTMENT_FASCIOTOMY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHarmfulFirstAidSafety &&
    hasObservationDisposition &&
    hasCoagulopathySafety &&
    hasAntivenomReactionSafety &&
    hasCompartmentFasciotomySafety
  );
}

function requiresMajorBurnSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = MAJOR_BURN_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasMajorBurnRisk = MAJOR_BURN_SEVERITY_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasMajorBurnRisk;
}

function hasMajorBurnTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirwayAction = MAJOR_BURN_AIRWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasStopIrrigationAction = MAJOR_BURN_STOP_IRRIGATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTbsaDepthAction = MAJOR_BURN_TBSA_DEPTH_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidUrineAction = MAJOR_BURN_FLUID_URINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBurnCenterAction = MAJOR_BURN_CENTER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAirwayAction &&
    hasStopIrrigationAction &&
    hasTbsaDepthAction &&
    hasFluidUrineAction &&
    hasBurnCenterAction
  );
}

function hasMajorBurnTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHypothermiaSafety = MAJOR_BURN_HYPOTHERMIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFluidTitrationSafety = MAJOR_BURN_FLUID_TITRATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEscharotomySafety = MAJOR_BURN_ESCHAROTOMY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTetanusSafety = MAJOR_BURN_TETANUS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticStewardship = MAJOR_BURN_ANTIBIOTIC_STEWARDSHIP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHypothermiaSafety &&
    hasFluidTitrationSafety &&
    hasEscharotomySafety &&
    hasTetanusSafety &&
    hasAntibioticStewardship
  );
}

function requiresSjsTenSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SJS_TEN_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasRisk = SJS_TEN_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasSjsTenTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCulpritDrugAction = SJS_TEN_CULPRIT_DRUG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdmissionEscalation = SJS_TEN_ADMISSION_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBsaScorten = SJS_TEN_BSA_SCORTEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSupportiveCare = SJS_TEN_SUPPORTIVE_CARE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMucosalEye = SJS_TEN_MUCOSAL_EYE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCulpritDrugAction &&
    hasAdmissionEscalation &&
    hasBsaScorten &&
    hasSupportiveCare &&
    hasMucosalEye
  );
}

function hasSjsTenTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasWoundInfectionSafety = SJS_TEN_WOUND_INFECTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticStewardship = SJS_TEN_ANTIBIOTIC_STEWARDSHIP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAirwayOrganSafety = SJS_TEN_AIRWAY_ORGAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMedicationRechallenge = SJS_TEN_MEDICATION_RECHALLENGE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAdjunctRiskSafety = SJS_TEN_ADJUNCT_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasWoundInfectionSafety &&
    hasAntibioticStewardship &&
    hasAirwayOrganSafety &&
    hasMedicationRechallenge &&
    hasAdjunctRiskSafety
  );
}

function requiresDressSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = DRESS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasRisk = DRESS_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasDressTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCulpritDrugAction = DRESS_CULPRIT_DRUG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLabOrganAction = DRESS_LAB_ORGAN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDiagnosticSeverityAction = DRESS_DIAGNOSTIC_SEVERITY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiopulmonaryAction = DRESS_CARDIOPULMONARY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSupportiveSteroidAction = DRESS_SUPPORTIVE_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasCulpritDrugAction &&
    hasLabOrganAction &&
    hasDiagnosticSeverityAction &&
    hasCardiopulmonaryAction &&
    hasSupportiveSteroidAction
  );
}

function hasDressTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSevereOrganSafety = DRESS_SEVERE_ORGAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidTaperRelapseSafety = DRESS_STEROID_TAPER_RELAPSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasViralAutoimmuneSafety = DRESS_VIRAL_AUTOIMMUNE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRechallengeCrossReactionSafety = DRESS_RECHALLENGE_CROSS_REACTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAlternativeImmunomodulatorSafety = DRESS_ALTERNATIVE_IMMUNOMODULATOR_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasSevereOrganSafety &&
    hasSteroidTaperRelapseSafety &&
    hasViralAutoimmuneSafety &&
    hasRechallengeCrossReactionSafety &&
    hasAlternativeImmunomodulatorSafety
  );
}

function requiresSsssSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SSSS_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
  const hasRisk = SSSS_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasSsssTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasDiagnosticSource = SSSS_DIAGNOSTIC_SOURCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAdmissionEscalation = SSSS_ADMISSION_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntistaphAntibiotic = SSSS_ANTISTAPH_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasFluidTemp = SSSS_FLUID_TEMP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasWoundPain = SSSS_WOUND_PAIN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasDiagnosticSource &&
    hasAdmissionEscalation &&
    hasAntistaphAntibiotic &&
    hasFluidTemp &&
    hasWoundPain
  );
}

function hasSsssTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMrsaVancomycinSafety = SSSS_MRSA_VANCOMYCIN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMedicationHarmSafety = SSSS_MEDICATION_HARM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = SSSS_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationMonitoring = SSSS_COMPLICATION_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCarrierOutbreakSafety = SSSS_CARRIER_OUTBREAK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasMrsaVancomycinSafety &&
    hasMedicationHarmSafety &&
    hasDifferentialSafety &&
    hasComplicationMonitoring &&
    hasCarrierOutbreakSafety
  );
}

function requiresToxicShockSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = TOXIC_SHOCK_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = TOXIC_SHOCK_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasToxicShockTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasResuscitation = TOXIC_SHOCK_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCultureSource = TOXIC_SHOCK_CULTURE_SOURCE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxinAntibiotic = TOXIC_SHOCK_TOXIN_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceControl = TOXIC_SHOCK_SOURCE_CONTROL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOrganMonitoring = TOXIC_SHOCK_ORGAN_MONITORING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasResuscitation &&
    hasCultureSource &&
    hasToxinAntibiotic &&
    hasSourceControl &&
    hasOrganMonitoring
  );
}

function hasToxicShockTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasGasRegimenSafety = TOXIC_SHOCK_GAS_REGIMEN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasStaphMrsaSafety = TOXIC_SHOCK_STAPH_MRSA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasIvigSevereSafety = TOXIC_SHOCK_IVIG_SEVERE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = TOXIC_SHOCK_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrencePreventionSafety = TOXIC_SHOCK_RECURRENCE_PREVENTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasContactProphylaxisSafety = TOXIC_SHOCK_CONTACT_PROPHYLAXIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasGasRegimenSafety &&
    hasStaphMrsaSafety &&
    hasIvigSevereSafety &&
    hasDifferentialSafety &&
    hasRecurrencePreventionSafety &&
    hasContactProphylaxisSafety
  );
}

function requiresMethemoglobinemiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = METHEMOGLOBINEMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasMethemoglobinemiaRisk = METHEMOGLOBINEMIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasMethemoglobinemiaRisk;
}

function hasMethemoglobinemiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOxygenSupport = METHEMOGLOBINEMIA_OXYGEN_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceRemoval = METHEMOGLOBINEMIA_SOURCE_REMOVAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCooxLevel = METHEMOGLOBINEMIA_COOX_LEVEL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMethyleneBlue = METHEMOGLOBINEMIA_METHYLENE_BLUE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasToxEscalation = METHEMOGLOBINEMIA_TOX_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasOxygenSupport &&
    hasSourceRemoval &&
    hasCooxLevel &&
    hasMethyleneBlue &&
    hasToxEscalation
  );
}

function hasMethemoglobinemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasPulseOxGapSafety = METHEMOGLOBINEMIA_PULSE_OX_GAP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasG6pdHemolysisSafety = METHEMOGLOBINEMIA_G6PD_HEMOLYSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMethyleneInteractionSafety = METHEMOGLOBINEMIA_METHYLENE_INTERACTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTreatmentThresholdSafety = METHEMOGLOBINEMIA_TREATMENT_THRESHOLD_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRepeatDoseSafety = METHEMOGLOBINEMIA_REPEAT_DOSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReboundMonitoringSafety = METHEMOGLOBINEMIA_REBOUND_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAlternativeTherapySafety = METHEMOGLOBINEMIA_ALTERNATIVE_THERAPY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasPulseOxGapSafety &&
    hasG6pdHemolysisSafety &&
    hasMethyleneInteractionSafety &&
    hasTreatmentThresholdSafety &&
    hasRepeatDoseSafety &&
    hasReboundMonitoringSafety &&
    hasAlternativeTherapySafety
  );
}

function requiresCausticIngestionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = CAUSTIC_INGESTION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasSeverity = CAUSTIC_INGESTION_SEVERITY_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasSeverity;
}

function hasCausticIngestionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirwayStabilization = CAUSTIC_AIRWAY_STABILIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasExposureHistory = CAUSTIC_EXPOSURE_HISTORY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEndoscopy = CAUSTIC_ENDOSCOPY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCtPerforation = CAUSTIC_CT_PERFORATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = CAUSTIC_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAirwayStabilization &&
    hasExposureHistory &&
    hasEndoscopy &&
    hasCtPerforation &&
    hasEscalation
  );
}

function hasCausticIngestionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasEmesisNeutralizationSafety = CAUSTIC_EMESIS_NEUTRALIZATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBlindTubeSafety = CAUSTIC_BLIND_TUBE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEndoscopyTimingSafety = CAUSTIC_ENDOSCOPY_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidAntibioticSafety = CAUSTIC_STEROID_ANTIBIOTIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLongTermComplicationSafety = CAUSTIC_LONG_TERM_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasEmesisNeutralizationSafety &&
    hasBlindTubeSafety &&
    hasEndoscopyTimingSafety &&
    hasSteroidAntibioticSafety &&
    hasLongTermComplicationSafety
  );
}

function requiresOpioidToxicitySafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return OPIOID_TOXICITY_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasOpioidToxicityTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAirwayVentilation = OPIOID_AIRWAY_VENTILATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNaloxone = OPIOID_NALOXONE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRecurrentDepressionMonitoring = OPIOID_RECURRENT_DEPRESSION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return hasAirwayVentilation && hasNaloxone && hasRecurrentDepressionMonitoring;
}

function hasOpioidToxicityTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasLongActingReboundSafety = OPIOID_LONG_ACTING_REBOUND_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCoingestionOrDifferentialSafety =
    OPIOID_COINGESTION_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasNaloxoneAdverseSafety = OPIOID_NALOXONE_ADVERSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasLongActingReboundSafety && hasCoingestionOrDifferentialSafety && hasNaloxoneAdverseSafety;
}

function requiresSickleSplenicSequestrationSafetyCheck(
  detail: ClinicalCaseReviewDetail,
): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SICKLE_SPLENIC_SEQUESTRATION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = SICKLE_SPLENIC_SEQUESTRATION_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasSickleSplenicSequestrationTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAssessment = SICKLE_SPLENIC_SEQUESTRATION_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasResuscitation = SICKLE_SPLENIC_SEQUESTRATION_RESUSCITATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasTransfusion = SICKLE_SPLENIC_SEQUESTRATION_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasExpert = SICKLE_SPLENIC_SEQUESTRATION_EXPERT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAssessment && hasResuscitation && hasTransfusion && hasExpert;
}

function hasSickleSplenicSequestrationTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOvertransfusionSafety =
    SICKLE_SPLENIC_SEQUESTRATION_OVERTRANSFUSION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDifferentialSafety = SICKLE_SPLENIC_SEQUESTRATION_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceSafety = SICKLE_SPLENIC_SEQUESTRATION_RECURRENCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasMonitoringSafety = SICKLE_SPLENIC_SEQUESTRATION_MONITORING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOvertransfusionSafety && hasDifferentialSafety && hasRecurrenceSafety && hasMonitoringSafety
  );
}

function requiresSickleStrokeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SICKLE_STROKE_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = SICKLE_STROKE_RISK_TERMS.some((term) => containsSafetyTerm(riskText, term));
  return hasContext && hasRisk;
}

function hasSickleStrokeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasNeuroConsult = SICKLE_STROKE_NEURO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroimaging = SICKLE_STROKE_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTransfusion = SICKLE_STROKE_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasExpert = SICKLE_STROKE_EXPERT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasNeuroConsult && hasNeuroimaging && hasTransfusion && hasExpert;
}

function hasSickleStrokeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasHyperviscositySafety = SICKLE_STROKE_HYPERVISCOSITY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBloodBankSafety = SICKLE_STROKE_BLOOD_BANK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSecondaryPrevention = SICKLE_STROKE_SECONDARY_PREVENTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMimicOrHemorrhageSafety = SICKLE_STROKE_MIMIC_HEMORRHAGE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasHyperviscositySafety &&
    hasBloodBankSafety &&
    hasSecondaryPrevention &&
    hasMimicOrHemorrhageSafety
  );
}

function requiresAcuteChestSyndromeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const directContext = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
  ]
    .join(" ")
    .toLowerCase();
  const riskText = [
    directContext,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = ACUTE_CHEST_SYNDROME_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasExplicitContext = ACUTE_CHEST_SYNDROME_EXPLICIT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(directContext, term),
  );
  const hasRisk = ACUTE_CHEST_SYNDROME_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasPulmonaryRisk = ACUTE_CHEST_SYNDROME_PULMONARY_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return (hasExplicitContext && hasRisk) || (hasContext && hasPulmonaryRisk);
}

function hasAcuteChestSyndromeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasCxrOrLabActions = ACUTE_CHEST_SYNDROME_CXR_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOxygenActions = ACUTE_CHEST_SYNDROME_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibioticActions = ACUTE_CHEST_SYNDROME_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpirometryPainActions = ACUTE_CHEST_SYNDROME_SPIROMETRY_PAIN_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasTransfusionActions = ACUTE_CHEST_SYNDROME_TRANSFUSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratoryEscalation =
    ACUTE_CHEST_SYNDROME_RESPIRATORY_ESCALATION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  return (
    hasCxrOrLabActions &&
    hasOxygenActions &&
    hasAntibioticActions &&
    hasSpirometryPainActions &&
    hasTransfusionActions &&
    hasRespiratoryEscalation
  );
}

function hasAcuteChestSyndromeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasFluidOpioidSafety = ACUTE_CHEST_SYNDROME_FLUID_OPIOID_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransfusionSafety = ACUTE_CHEST_SYNDROME_TRANSFUSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBronchodilatorSteroidSafety =
    ACUTE_CHEST_SYNDROME_BRONCHODILATOR_STEROID_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDifferentialSafety = ACUTE_CHEST_SYNDROME_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionSafety = ACUTE_CHEST_SYNDROME_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasFluidOpioidSafety &&
    hasTransfusionSafety &&
    hasBronchodilatorSteroidSafety &&
    hasDifferentialSafety &&
    hasDispositionSafety
  );
}

function requiresSevereAsthmaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SEVERE_ASTHMA_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function requiresSevereAsthmaVentilationSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.clinical_sources),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasAsthmaContext = SEVERE_ASTHMA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasVentilationContext = SEVERE_ASTHMA_VENTILATION_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasAsthmaContext && hasVentilationContext;
}

function hasSevereAsthmaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOxygenOrVentilation = SEVERE_ASTHMA_OXYGEN_VENTILATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSaba = SEVERE_ASTHMA_SABA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIpratropium = SEVERE_ASTHMA_IPRATROPIUM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSystemicSteroid = SEVERE_ASTHMA_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = SEVERE_ASTHMA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasOxygenOrVentilation && hasSaba && hasIpratropium && hasSystemicSteroid && hasEscalation;
}

function hasSevereAsthmaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasResponseMonitoring = SEVERE_ASTHMA_RESPONSE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRespiratoryFailureSafety = SEVERE_ASTHMA_RESPIRATORY_FAILURE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTreatmentAdverseSafety = SEVERE_ASTHMA_TREATMENT_ADVERSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasResponseMonitoring && hasRespiratoryFailureSafety && hasTreatmentAdverseSafety;
}

function hasSevereAsthmaVentilationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasVentilationStrategy = SEVERE_ASTHMA_VENTILATION_STRATEGY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAutoPeepMonitoring = SEVERE_ASTHMA_AUTO_PEEP_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBarotraumaHemodynamicSafety =
    SEVERE_ASTHMA_BAROTRAUMA_HEMODYNAMIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSedationSynchronyPlan = SEVERE_ASTHMA_SEDATION_SYNCHRONY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasVentilationStrategy &&
    hasAutoPeepMonitoring &&
    hasBarotraumaHemodynamicSafety &&
    hasSedationSynchronyPlan
  );
}

function requiresSevereCapSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return SEVERE_CAP_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasSevereCapTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOxygenVentilation = SEVERE_CAP_OXYGEN_VENTILATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDiagnosticCulture = SEVERE_CAP_DIAGNOSTIC_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEmpiricAntibiotic = SEVERE_CAP_EMPIRIC_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSepsisEscalation = SEVERE_CAP_SEPSIS_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasOxygenVentilation && hasDiagnosticCulture && hasEmpiricAntibiotic && hasSepsisEscalation;
}

function hasSevereCapTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMrsaPseudomonasSafety = SEVERE_CAP_MRSA_PSEUDOMONAS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSeverityDispositionSafety = SEVERE_CAP_SEVERITY_DISPOSITION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasEffusionEmpyemaSafety = SEVERE_CAP_EFFUSION_EMPYEMA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasViralAspirationDifferentialSafety =
    SEVERE_CAP_VIRAL_ASPIRATION_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasMrsaPseudomonasSafety &&
    hasSeverityDispositionSafety &&
    hasEffusionEmpyemaSafety &&
    hasViralAspirationDifferentialSafety
  );
}

function hasSevereCapAntibioticStewardshipSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasProcalcitoninMarker = SEVERE_CAP_PROCALCITONIN_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticNonwithhold = SEVERE_CAP_ANTIBIOTIC_NONWITHHOLD_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInitialAntibiotic = SEVERE_CAP_INITIAL_ANTIBIOTIC_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCorticosteroidClass = SEVERE_CAP_CORTICOSTEROID_CLASS_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCorticosteroidAvoidance = SEVERE_CAP_CORTICOSTEROID_AVOIDANCE_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCorticosteroidException = SEVERE_CAP_CORTICOSTEROID_EXCEPTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInfluenza = SEVERE_CAP_INFLUENZA_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntiviral = SEVERE_CAP_ANTIVIRAL_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDuration = SEVERE_CAP_DURATION_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDurationMinimum = SEVERE_CAP_DURATION_MINIMUM_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasClinicalStability = SEVERE_CAP_STABILITY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasProcalcitoninMarker &&
    hasAntibioticNonwithhold &&
    hasInitialAntibiotic &&
    hasCorticosteroidClass &&
    hasCorticosteroidAvoidance &&
    hasCorticosteroidException &&
    hasInfluenza &&
    hasAntiviral &&
    hasDuration &&
    hasDurationMinimum &&
    hasClinicalStability
  );
}

function requiresCopdExacerbationSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return COPD_EXACERBATION_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasCopdExacerbationTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasControlledOxygen = COPD_CONTROLLED_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOxygenTarget = COPD_OXYGEN_TARGET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAbg = COPD_ABG_ACTION_TERMS.some((term) => containsSafetyTerm(normalizedActions, term));
  const hasBronchodilator = COPD_BRONCHODILATOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSystemicSteroid = COPD_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = COPD_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibioticCriteria = COPD_ANTIBIOTIC_CRITERIA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNiv = COPD_NIV_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVentilatoryFailure = COPD_VENTILATORY_FAILURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasControlledOxygen &&
    hasOxygenTarget &&
    hasAbg &&
    hasBronchodilator &&
    hasSystemicSteroid &&
    hasAntibiotic &&
    hasAntibioticCriteria &&
    hasNiv &&
    hasVentilatoryFailure
  );
}

function hasCopdExacerbationTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOxygenTargetSafety = COPD_OXYGEN_TARGET_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCo2RetentionSafety = COPD_CO2_RETENTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAbgSafety = COPD_ABG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNivSafety = COPD_NIV_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNivAcidosisSafety = COPD_NIV_ACIDOSIS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNivFailureIntubationSafety = COPD_NIV_FAILURE_INTUBATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialReview = COPD_COMORBID_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTreatmentAdverseSafety = COPD_TREATMENT_ADVERSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOxygenTargetSafety &&
    hasCo2RetentionSafety &&
    hasAbgSafety &&
    hasNivSafety &&
    hasNivAcidosisSafety &&
    hasNivFailureIntubationSafety &&
    hasDifferentialReview &&
    hasTreatmentAdverseSafety
  );
}

function requiresAcuteHeartFailureSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return ACUTE_HEART_FAILURE_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAcuteHeartFailureTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasOxygen = ACUTE_HF_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNiv = ACUTE_HF_NIV_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRespiratoryFailure = ACUTE_HF_RESPIRATORY_FAILURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDiuretic = ACUTE_HF_DIURETIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecongestion = ACUTE_HF_DECONGESTION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVasodilator = ACUTE_HF_VASODILATOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBpContext = ACUTE_HF_BP_CONTEXT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasShock = ACUTE_HF_SHOCK_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = ACUTE_HF_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasOxygen &&
    hasNiv &&
    hasRespiratoryFailure &&
    hasDiuretic &&
    hasDecongestion &&
    hasVasodilator &&
    hasBpContext &&
    hasShock &&
    hasEscalation
  );
}

function hasAcuteHeartFailureTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBpMonitoring = ACUTE_HF_BP_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHypotensionSafety = ACUTE_HF_HYPOTENSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVasodilatorSafety = ACUTE_HF_VASODILATOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVasodilatorContraindication =
    ACUTE_HF_VASODILATOR_CONTRAINDICATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasRenalMonitoring = ACUTE_HF_RENAL_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDiuresisOutput = ACUTE_HF_DIURESIS_OUTPUT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasElectrolyteSafety = ACUTE_HF_ELECTROLYTE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTriggerReview = ACUTE_HF_TRIGGER_REVIEW_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTriggerCondition = ACUTE_HF_TRIGGER_CONDITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasShockPerfusion = ACUTE_HF_SHOCK_PERFUSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasShockState = ACUTE_HF_SHOCK_STATE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRespiratoryEscalation = ACUTE_HF_RESPIRATORY_ESCALATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasBpMonitoring &&
    hasHypotensionSafety &&
    hasVasodilatorSafety &&
    hasVasodilatorContraindication &&
    hasRenalMonitoring &&
    hasDiuresisOutput &&
    hasElectrolyteSafety &&
    hasTriggerReview &&
    hasTriggerCondition &&
    hasShockPerfusion &&
    hasShockState &&
    hasRespiratoryEscalation
  );
}

function hasAcuteHeartFailureShockEscalationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNitrateLevelCareSafety = ACUTE_HF_NITRATE_LEVEL_CARE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasInotropeVasopressorSafety = ACUTE_HF_INOTROPE_VASOPRESSOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMcsOrAdvancedTeamSafety = ACUTE_HF_MCS_ADVANCED_TEAM_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBetaBlockerStabilizationSafety =
    ACUTE_HF_BETA_BLOCKER_STABILIZATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasNitrateLevelCareSafety &&
    hasInotropeVasopressorSafety &&
    hasMcsOrAdvancedTeamSafety &&
    hasBetaBlockerStabilizationSafety
  );
}

function requiresDuctalDependentChdSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
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
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = DUCTAL_DEPENDENT_CHD_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = DUCTAL_DEPENDENT_CHD_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasDuctalDependentChdTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasPgeDrug = DUCTAL_DEPENDENT_CHD_PGE_DRUG_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPgeUrgency = DUCTAL_DEPENDENT_CHD_PGE_URGENCY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPulseOx = DUCTAL_DEPENDENT_CHD_PULSE_OX_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemodynamicAssessment = DUCTAL_DEPENDENT_CHD_HEMODYNAMIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiacDiagnostic = DUCTAL_DEPENDENT_CHD_CARDIAC_DIAGNOSTIC_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCardiacEscalation = DUCTAL_DEPENDENT_CHD_CARDIAC_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasNeonatalEscalation = DUCTAL_DEPENDENT_CHD_NEONATAL_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasAccessTransfer = DUCTAL_DEPENDENT_CHD_ACCESS_TRANSFER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwaySupport = DUCTAL_DEPENDENT_CHD_AIRWAY_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasMetabolicSupport = DUCTAL_DEPENDENT_CHD_METABOLIC_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasPgeDrug &&
    hasPgeUrgency &&
    hasPulseOx &&
    hasHemodynamicAssessment &&
    hasCardiacDiagnostic &&
    hasCardiacEscalation &&
    hasNeonatalEscalation &&
    hasAccessTransfer &&
    hasAirwaySupport &&
    hasMetabolicSupport
  );
}

function hasDuctalDependentChdTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOxygenJudiciousSafety = DUCTAL_DEPENDENT_CHD_OXYGEN_JUDICIOUS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasOxygenPhysiologySafety = DUCTAL_DEPENDENT_CHD_OXYGEN_PHYSIOLOGY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPgeDrugSafety = DUCTAL_DEPENDENT_CHD_PGE_DRUG_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPgeApneaSafety = DUCTAL_DEPENDENT_CHD_PGE_APNEA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPgeHemodynamicSafety = DUCTAL_DEPENDENT_CHD_PGE_HEMODYNAMIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSepsisDifferentialSafety = DUCTAL_DEPENDENT_CHD_SEPSIS_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasLesionDifferentialSafety = DUCTAL_DEPENDENT_CHD_LESION_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasTransferNoDelaySafety = DUCTAL_DEPENDENT_CHD_TRANSFER_NO_DELAY_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCardiacTransferSafety = DUCTAL_DEPENDENT_CHD_CARDIAC_TRANSFER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOxygenJudiciousSafety &&
    hasOxygenPhysiologySafety &&
    hasPgeDrugSafety &&
    hasPgeApneaSafety &&
    hasPgeHemodynamicSafety &&
    hasSepsisDifferentialSafety &&
    hasLesionDifferentialSafety &&
    hasTransferNoDelaySafety &&
    hasCardiacTransferSafety
  );
}

function requiresCardiacTamponadeSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return CARDIAC_TAMPONADE_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasCardiacTamponadeTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasEchoAction = CARDIAC_TAMPONADE_ECHO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDrainageAction = CARDIAC_TAMPONADE_DRAINAGE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpecialistAction = CARDIAC_TAMPONADE_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasHemodynamicAction = CARDIAC_TAMPONADE_HEMODYNAMIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasEchoAction && hasDrainageAction && hasSpecialistAction && hasHemodynamicAction;
}

function hasCardiacTamponadeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelaySafety = CARDIAC_TAMPONADE_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAnticoagReversalSafety = CARDIAC_TAMPONADE_ANTICOAG_REVERSAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasCauseComplicationSafety = CARDIAC_TAMPONADE_CAUSE_COMPLICATION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasVentilationPreloadSafety =
    CARDIAC_TAMPONADE_VENTILATION_PRELOAD_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasNoDelaySafety &&
    hasAnticoagReversalSafety &&
    hasCauseComplicationSafety &&
    hasVentilationPreloadSafety
  );
}

function requiresUnstableTachyarrhythmiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = UNSTABLE_TACHYARRHYTHMIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = UNSTABLE_TACHYARRHYTHMIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasUnstableTachyarrhythmiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMonitorAction = UNSTABLE_TACHYARRHYTHMIA_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPulseInstabilityAction =
    UNSTABLE_TACHYARRHYTHMIA_PULSE_INSTABILITY_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasCardioversionAction = UNSTABLE_TACHYARRHYTHMIA_CARDIOVERSION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasReversibleCauseAction =
    UNSTABLE_TACHYARRHYTHMIA_REVERSIBLE_CAUSE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasEscalationAction = UNSTABLE_TACHYARRHYTHMIA_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasMonitorAction &&
    hasPulseInstabilityAction &&
    hasCardioversionAction &&
    hasReversibleCauseAction &&
    hasEscalationAction
  );
}

function hasUnstableTachyarrhythmiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSedationNoDelaySafety =
    UNSTABLE_TACHYARRHYTHMIA_SEDATION_NO_DELAY_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasSyncUnsyncSafety = UNSTABLE_TACHYARRHYTHMIA_SYNC_UNSYNC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasWideIrregularSafety =
    UNSTABLE_TACHYARRHYTHMIA_WIDE_IRREGULAR_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntiarrhythmicSafety =
    UNSTABLE_TACHYARRHYTHMIA_ANTIARRHYTHMIC_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCauseDispositionSafety =
    UNSTABLE_TACHYARRHYTHMIA_CAUSE_DISPOSITION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasSedationNoDelaySafety &&
    hasSyncUnsyncSafety &&
    hasWideIrregularSafety &&
    hasAntiarrhythmicSafety &&
    hasCauseDispositionSafety
  );
}

function requiresSymptomaticBradycardiaSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.chief_complaint,
    detail.history_of_present_illness,
    detail.past_medical_history,
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  const hasContext = SYMPTOMATIC_BRADYCARDIA_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasRisk = SYMPTOMATIC_BRADYCARDIA_RISK_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasContext && hasRisk;
}

function hasSymptomaticBradycardiaTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMonitorAction = SYMPTOMATIC_BRADYCARDIA_MONITOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasInstabilityAction = SYMPTOMATIC_BRADYCARDIA_INSTABILITY_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasAtropineAction = SYMPTOMATIC_BRADYCARDIA_ATROPINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPacingAction = SYMPTOMATIC_BRADYCARDIA_PACING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasChronotropeAction = SYMPTOMATIC_BRADYCARDIA_CHRONOTROPE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasReversibleCauseAction =
    SYMPTOMATIC_BRADYCARDIA_REVERSIBLE_CAUSE_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  return (
    hasMonitorAction &&
    hasInstabilityAction &&
    hasAtropineAction &&
    hasPacingAction &&
    hasChronotropeAction &&
    hasReversibleCauseAction
  );
}

function hasSymptomaticBradycardiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelayPacingSafety = SYMPTOMATIC_BRADYCARDIA_NO_DELAY_PACING_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAtropineReferenceSafety =
    SYMPTOMATIC_BRADYCARDIA_ATROPINE_REFERENCE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAtropineLimitSafety = SYMPTOMATIC_BRADYCARDIA_ATROPINE_LIMIT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPacingCaptureSafety = SYMPTOMATIC_BRADYCARDIA_PACING_CAPTURE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPacingComfortSafety = SYMPTOMATIC_BRADYCARDIA_PACING_COMFORT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasPacingRouteSafety = SYMPTOMATIC_BRADYCARDIA_PACING_ROUTE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasChronotropeAgentSafety =
    SYMPTOMATIC_BRADYCARDIA_CHRONOTROPE_AGENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasChronotropeAdverseSafety =
    SYMPTOMATIC_BRADYCARDIA_CHRONOTROPE_ADVERSE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCauseDispositionSafety =
    SYMPTOMATIC_BRADYCARDIA_CAUSE_DISPOSITION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasNoDelayPacingSafety &&
    hasAtropineReferenceSafety &&
    hasAtropineLimitSafety &&
    hasPacingCaptureSafety &&
    hasPacingComfortSafety &&
    hasPacingRouteSafety &&
    hasChronotropeAgentSafety &&
    hasChronotropeAdverseSafety &&
    hasCauseDispositionSafety
  );
}

function requiresTensionPneumothoraxSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return TENSION_PNEUMOTHORAX_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
}

function hasTensionPneumothoraxTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasDecompression = TENSION_PNEUMOTHORAX_DECOMPRESSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasChestTube = TENSION_PNEUMOTHORAX_CHEST_TUBE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAirwayOxygen = TENSION_PNEUMOTHORAX_AIRWAY_OXYGEN_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasReassessment = TENSION_PNEUMOTHORAX_REASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasDecompression && hasChestTube && hasAirwayOxygen && hasReassessment;
}

function hasTensionPneumothoraxTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoDelaySafety = TENSION_PNEUMOTHORAX_NO_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSiteSafety = TENSION_PNEUMOTHORAX_SITE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTechniqueSafety = TENSION_PNEUMOTHORAX_TECHNIQUE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceFailureSafety =
    TENSION_PNEUMOTHORAX_RECURRENCE_FAILURE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDifferentialReview = TENSION_PNEUMOTHORAX_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasNoDelaySafety &&
    hasSiteSafety &&
    hasTechniqueSafety &&
    hasRecurrenceFailureSafety &&
    hasDifferentialReview
  );
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

function hasStrokeAdvancedReperfusionMonitoringSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasVascularImaging = STROKE_VASCULAR_IMAGING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasThrombectomyOcclusion = STROKE_THROMBECTOMY_OCCLUSION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasThrombectomySelectionDetail = STROKE_THROMBECTOMY_SELECTION_DETAIL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasServiceMonitoring = STROKE_SERVICE_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntiplateletTiming = STROKE_ANTIPLATELET_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHomeostasisSwallow = STROKE_HOMEOSTASIS_SWALLOW_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasVascularImaging &&
    hasThrombectomyOcclusion &&
    hasThrombectomySelectionDetail &&
    hasServiceMonitoring &&
    hasAntiplateletTiming &&
    hasHomeostasisSwallow
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
  const hasAnticoagulationOrReperfusion = PE_ANTICOAGULATION_OR_REPERFUSION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasRiskStratification &&
    hasHemodynamicAssessment &&
    hasImagingPathway &&
    hasAnticoagulationOrReperfusion
  );
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

function hasPeReperfusionEscalationSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAnticoagulationPlan = PE_ANTICOAGULATION_INITIATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSystemicThrombolysisReview = PE_SYSTEMIC_THROMBOLYSIS_REVIEW_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSystemicThrombolysisHighRiskTrigger =
    PE_SYSTEMIC_THROMBOLYSIS_HIGH_RISK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasCatheterSurgicalBackup = PE_CATHETER_SURGICAL_BACKUP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasUnstableImagingLogic = PE_UNSTABLE_IMAGING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAlternativeImagingReview = PE_ALTERNATIVE_IMAGING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPertOrDispositionEscalation = PE_PERT_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAnticoagulationPlan &&
    hasSystemicThrombolysisReview &&
    hasSystemicThrombolysisHighRiskTrigger &&
    hasCatheterSurgicalBackup &&
    hasUnstableImagingLogic &&
    hasAlternativeImagingReview &&
    hasPertOrDispositionEscalation
  );
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

function hasAcsMedicationReperfusionSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNitrateSafety = ACS_NITRATE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOxygenSafety = ACS_OXYGEN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBetaBlockerSafety = ACS_BETA_BLOCKER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReperfusionTimingSafety = ACS_REPERFUSION_TIMING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasNitrateSafety && hasOxygenSafety && hasBetaBlockerSafety && hasReperfusionTimingSafety;
}

function requiresAorticDissectionSafetyCheck(detail: ClinicalCaseReviewDetail): boolean {
  const riskText = [
    detail.diagnosis,
    detail.coach_guidance,
    ...nestedStrings(detail.key_teaching_points),
    ...nestedStrings(detail.time_critical_actions),
    ...nestedStrings(detail.clinical_red_flags),
    ...nestedStrings(detail.physical_exam),
    ...nestedStrings(detail.initial_labs),
  ]
    .join(" ")
    .toLowerCase();
  return AORTIC_DISSECTION_CONTEXT_TERMS.some((term) => containsSafetyTerm(riskText, term));
}

function hasAorticDissectionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasAorticImaging = AORTIC_DISSECTION_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntiImpulse = AORTIC_DISSECTION_ANTI_IMPULSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgicalTeam = AORTIC_DISSECTION_SURGICAL_TEAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRepairPathway = AORTIC_DISSECTION_REPAIR_PATHWAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAorticImaging && hasAntiImpulse && hasSurgicalTeam && hasRepairPathway;
}

function hasAorticDissectionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntithromboticSafety = AORTIC_DISSECTION_ANTITHROMBOTIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasImpulseSafety = AORTIC_DISSECTION_VASODILATOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasComplicationScreen = AORTIC_DISSECTION_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasAntithromboticSafety && hasImpulseSafety && hasComplicationScreen;
}

function hasAorticDissectionMonitoringTargetsSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMonitoringAccess = AORTIC_DISSECTION_MONITORING_ACCESS_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAnalgesia = AORTIC_DISSECTION_ANALGESIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntiImpulseTargets = AORTIC_DISSECTION_TARGET_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDefinitivePathway = AORTIC_DISSECTION_DEFINITIVE_PATHWAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasMonitoringAccess && hasAnalgesia && hasAntiImpulseTargets && hasDefinitivePathway
  );
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
      name: "sepsis_resuscitation_safety",
      label: "Sepsis resuscitation safety",
      applies: requiresSepsisResuscitationSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSepsisResuscitationSafetyCheck,
      issue:
        "sepsis safety checks must include perfusion or repeat-lactate reassessment, fluid responsiveness or overload review, MAP or norepinephrine vasopressor target planning, and source-control assessment",
    },
    {
      name: "adult_septic_shock_bundle_actions",
      label: "Adult septic shock bundle actions",
      applies: requiresAdultSepticShockBundleSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAdultSepticShockBundleActions,
      issue:
        "adult septic shock time-critical actions must include blood cultures without delaying treatment, immediate broad-spectrum antimicrobials ideally within 1 hour, lactate measurement or repeat lactate, 30 mL/kg or crystalloid fluid resuscitation, norepinephrine or vasopressor support targeting MAP 65, and source-control or ICU/critical-care escalation",
    },
    {
      name: "pediatric_septic_shock_time_critical_actions",
      label: "Pediatric septic shock emergency actions",
      applies: requiresPediatricSepticShockSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPediatricSepticShockTimeCriticalActions,
      issue:
        "pediatric septic shock time-critical actions must include blood cultures or cultures with broad-spectrum antibiotics within 1 hour, 10-20 mL/kg isotonic or balanced crystalloid boluses, reassessment after each bolus using perfusion or fluid-overload signs, vasoactive or inotrope planning for fluid-refractory shock, and PICU, ICU, transport, or critical-care escalation",
    },
    {
      name: "pediatric_septic_shock_treatment_safety",
      label: "Pediatric septic shock fluid and vasoactive safety",
      applies: requiresPediatricSepticShockSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPediatricSepticShockTreatmentSafetyCheck,
      issue:
        "pediatric septic shock safety checks must include fluid-overload monitoring such as rales, hepatomegaly, pulmonary edema, or worsening work of breathing, avoiding central-line delay by using peripheral or intraosseous vasoactive support when needed, glucose, hypoglycemia, calcium, or ionized-calcium metabolic review, and source control or catecholamine-resistant shock hydrocortisone review",
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
      name: "anaphylaxis_medication_safety",
      label: "Anaphylaxis medication safety",
      applies: requiresAnaphylaxisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAnaphylaxisMedicationSafetyCheck,
      issue:
        "anaphylaxis medication safety checks must include repeat IM epinephrine every 5 minutes or second-dose planning, IV epinephrine restriction to cardiac arrest or experienced specialist infusion settings, antihistamine or corticosteroid adjunct-only review that does not delay epinephrine, and refractory anaphylaxis escalation with epinephrine infusion, vasopressor, glucagon for beta-blocker exposure, or specialist support",
    },
    {
      name: "epiglottitis_time_critical_actions",
      label: "Epiglottitis airway emergency actions",
      applies: requiresEpiglottitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasEpiglottitisTimeCriticalActions,
      issue:
        "epiglottitis time-critical actions must include airway assessment or airway-control planning with intubation, surgical airway, tracheostomy, or front-of-neck access readiness, ENT, otolaryngology, anesthesia, operating-room, ICU, or specialist escalation, empiric IV antibiotics such as ceftriaxone, cefotaxime, vancomycin, clindamycin, cultures, or antibiotic therapy, and close monitoring with ICU, observation, pulse oximetry, respiratory-status, or continuous-monitoring planning",
    },
    {
      name: "epiglottitis_treatment_safety",
      label: "Epiglottitis treatment safety",
      applies: requiresEpiglottitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasEpiglottitisTreatmentSafetyCheck,
      issue:
        "epiglottitis safety checks must include avoiding agitation, unnecessary throat exam, tongue depressor, avoidable procedures, or sedation that could precipitate airway collapse, anesthesia, ENT, failed-airway, surgical-airway, tracheostomy, or front-of-neck backup planning, corticosteroid, dexamethasone, methylprednisolone, or steroid-adjunct consideration, and complication-risk review for rapid deterioration, airway compromise, respiratory failure, abscess, diabetes, immunocompromised state, sepsis, or airway obstruction",
    },
    {
      name: "deep_neck_infection_time_critical_actions",
      label: "Deep neck infection airway and source control",
      applies: requiresDeepNeckInfectionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDeepNeckInfectionTimeCriticalActions,
      issue:
        "deep neck infection time-critical actions must include airway assessment or airway-control planning with oxygen, awake fiberoptic or nasotracheal intubation, surgical airway, cricothyrotomy, tracheostomy, or secure-airway planning, ENT, otolaryngology, anesthesia, oral-maxillofacial surgery, ICU, intensivist, or specialist escalation, IV broad-spectrum antibiotics such as ampicillin-sulbactam, clindamycin, metronidazole, piperacillin-tazobactam, vancomycin, or anaerobic coverage, and CT neck with contrast, blood culture, abscess, drainage, source control, or tooth extraction planning",
    },
    {
      name: "deep_neck_infection_treatment_safety",
      label: "Deep neck infection airway safety",
      applies: requiresDeepNeckInfectionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDeepNeckInfectionTreatmentSafetyCheck,
      issue:
        "deep neck infection safety checks must include airway-first sequencing such as airway secured before CT or imaging only when stable, avoidance of airway harm such as blind nasotracheal intubation, avoidable sedation, supine positioning, or surgical-airway backup planning, MRSA, diabetes, immunocompromised, gram-negative, vancomycin, meropenem, or piperacillin-tazobactam coverage review, and drainage or complication planning for abscess, no clinical improvement, airway obstruction, mediastinitis, descending necrotizing mediastinitis, aspiration pneumonia, or sepsis",
    },
    {
      name: "croup_time_critical_actions",
      label: "Croup steroids, epinephrine, and escalation",
      applies: requiresCroupSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCroupTimeCriticalActions,
      issue:
        "croup time-critical actions must include severity assessment for stridor at rest, work of breathing, hypoxia, cyanosis, or impending respiratory failure, dexamethasone or corticosteroid therapy, nebulized or racemic epinephrine for moderate-to-severe symptoms, and airway, oxygen, ICU, PICU, anesthesia, ENT, or intubation escalation for poor response",
    },
    {
      name: "croup_treatment_safety",
      label: "Croup observation and differential safety",
      applies: requiresCroupSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCroupTreatmentSafetyCheck,
      issue:
        "croup safety checks must include observation for recurrence or return of stridor for 2-4 hours after epinephrine, red-flag differential review for toxic appearance, drooling, dysphagia, epiglottitis, bacterial tracheitis, foreign body, or anaphylaxis, avoidance of routine antibiotics, bronchodilators, humidified air, or mist therapy in typical croup, and disposition or escalation planning for poor or unsustained response, impending respiratory failure, PICU, anesthesia, ENT, ORL, or return precautions",
    },
    {
      name: "foreign_body_airway_time_critical_actions",
      label: "Foreign body airway emergency actions",
      applies: requiresForeignBodyAirwaySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasForeignBodyAirwayTimeCriticalActions,
      issue:
        "foreign body airway obstruction time-critical actions must include airway or choking severity assessment with ability to speak, cough, oxygenation, pulse oximetry, or ventilation review, infant under-1-year back blows or chest thrusts, child or adult back blows, abdominal thrusts, Heimlich, or chest thrust pathway, and ENT, otolaryngology, pulmonology, anesthesia, rigid bronchoscopy, bronchoscopy, or foreign-body removal escalation",
    },
    {
      name: "foreign_body_airway_treatment_safety",
      label: "Foreign body airway treatment safety",
      applies: requiresForeignBodyAirwaySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasForeignBodyAirwayTreatmentSafetyCheck,
      issue:
        "foreign body airway obstruction safety checks must include no blind finger sweep or visible-object-only removal, normal chest x-ray, normal radiograph, radiolucent-object, or imaging does-not-rule-out review, partial-obstruction management with effective or forceful cough and encouraged coughing, and post-removal observation, persistent symptom, airway edema, stridor, infection, or non-routine antibiotic or steroid review",
    },
    {
      name: "orbital_cellulitis_time_critical_actions",
      label: "Orbital cellulitis emergency actions",
      applies: requiresOrbitalCellulitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOrbitalCellulitisTimeCriticalActions,
      issue:
        "orbital cellulitis time-critical actions must include orbital assessment with visual acuity, color vision, pupils, optic nerve, IOP, extraocular movements, eye movements, or ophthalmoplegia review, CT orbit, CT orbits, CT sinus, CT brain, contrast CT, MRI, orbit imaging, or sinus imaging, IV broad-spectrum antibiotics such as ampicillin-sulbactam, ceftriaxone, cefotaxime, vancomycin, metronidazole, cultures, or antibiotic therapy, and urgent ophthalmology, ENT, otolaryngology, source-control, surgery, surgical-drainage, or subperiosteal-abscess planning",
    },
    {
      name: "orbital_cellulitis_treatment_safety",
      label: "Orbital cellulitis treatment safety",
      applies: requiresOrbitalCellulitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOrbitalCellulitisTreatmentSafetyCheck,
      issue:
        "orbital cellulitis safety checks must include distinguishing postseptal orbital cellulitis from preseptal disease using proptosis, ophthalmoplegia, pain with eye movement, vision loss, or orbital septum review, abscess or surgical-drainage review for subperiosteal or orbital abscess, worsening visual acuity, large abscess, failure to improve, or drainage need, intracranial or systemic complication review for cavernous sinus thrombosis, meningitis, brain abscess, intracranial extension, osteomyelitis, sepsis, or death risk, and visual acuity, color vision, pupil, optic nerve, IOP, repeat exam, or daily monitoring",
    },
    {
      name: "gi_bleed_time_critical_actions",
      label: "GI bleed resuscitation and source control",
      applies: requiresGiBleedSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasGiBleedTimeCriticalActions,
      issue:
        "GI bleed time-critical actions must include hemodynamic resuscitation, blood product preparation or transfusion planning, and urgent endoscopy or source-control planning",
    },
    {
      name: "gi_bleed_transfusion_reversal_safety",
      label: "GI bleed transfusion and reversal safety",
      applies: requiresGiBleedSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasGiBleedTransfusionReversalSafetyCheck,
      issue:
        "GI bleed safety checks must include anticoagulant or coagulopathy reversal review and transfusion consent, type, or reaction safeguards",
    },
    {
      name: "cns_infection_time_critical_actions",
      label: "CNS infection immediate pathway",
      applies: requiresCnsInfectionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCnsInfectionTimeCriticalActions,
      issue:
        "CNS infection time-critical actions must include blood cultures, immediate or within-1-hour empiric antibiotics that are not delayed for lumbar puncture, CT, MRI, or neuroimaging, lumbar puncture or CT-before-LP pathway, and dexamethasone timing when bacterial meningitis is possible",
    },
    {
      name: "cns_infection_lp_steroid_safety",
      label: "CNS infection LP and steroid safety",
      applies: requiresCnsInfectionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCnsInfectionLpSteroidSafetyCheck,
      issue:
        "CNS infection safety checks must include antimicrobial allergy or renal dosing review, lumbar puncture contraindications, and dexamethasone timing relative to antibiotics",
    },
    {
      name: "cns_infection_delay_coverage_safety",
      label: "CNS infection delay and coverage safety",
      applies: requiresCnsInfectionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCnsInfectionDelayCoverageSafetyCheck,
      issue:
        "CNS infection safety checks must include antibiotics-before-imaging, blood-cultures-then-antibiotics, LP/imaging-not-to-delay, clinically significant delay, stabilize-before-imaging, or within-1-hour antibiotic planning, CT-before-LP indication review for papilledema, focal neurologic deficit, focal seizure, abnormal pupils, low GCS, altered consciousness, raised intracranial pressure, mass lesion, space-occupying lesion, or immunocompromised status, and Listeria/ampicillin or benzylpenicillin coverage review for older adult, pregnant, or immunocompromised patients",
    },
    {
      name: "encephalitis_time_critical_actions",
      label: "Encephalitis emergency actions",
      applies: requiresEncephalitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasEncephalitisTimeCriticalActions,
      issue:
        "encephalitis time-critical actions must include immediate IV acyclovir, MRI or neuroimaging, lumbar puncture/CSF HSV PCR testing, and EEG or seizure assessment",
    },
    {
      name: "encephalitis_red_flags",
      label: "Encephalitis red flags",
      applies: requiresEncephalitisSafetyCheck,
      fieldName: "clinical_red_flags",
      validator: hasEncephalitisRedFlags,
      issue:
        "encephalitis red flags must include altered mental status, confusion, encephalopathy, behavior/personality change, memory loss, or psychosis plus seizure, status epilepticus, aphasia, focal neurologic findings, or temporal-lobe concern",
    },
    {
      name: "encephalitis_treatment_safety",
      label: "Encephalitis treatment safety",
      applies: requiresEncephalitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasEncephalitisTreatmentSafetyCheck,
      issue:
        "encephalitis safety checks must include acyclovir renal dosing or hydration review, explicit do-not-delay acyclovir planning while LP, imaging, or PCR is pending, repeat HSV PCR or 3-7 day retesting when suspicion remains after a negative PCR, and bacterial meningitis or rickettsial empiric-therapy differential review",
    },
    {
      name: "immunocompromised_encephalitis_treatment_safety",
      label: "Immunocompromised encephalitis treatment safety",
      applies: requiresImmunocompromisedEncephalitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasImmunocompromisedEncephalitisTreatmentSafetyCheck,
      issue:
        "immunocompromised encephalitis safety checks must include herpesvirus coverage or differential review for VZV/varicella, CMV/cytomegalovirus, HHV-6, ganciclovir, foscarnet, or acyclovir, opportunistic pathogen review for Listeria/ampicillin, toxoplasma, cryptococcus/amphotericin, JC virus/PML, or tuberculosis, and host-risk review for HIV/CD4, transplant, immunosuppression, or infectious-disease consultation",
    },
    {
      name: "suicide_self_harm_time_critical_actions",
      label: "Suicide/self-harm immediate safety actions",
      applies: requiresSuicideSelfHarmSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSuicideSelfHarmTimeCriticalActions,
      issue:
        "suicide/self-harm time-critical actions must include structured suicide risk assessment for current thoughts, plan, intent, and access to means, lethal-means restriction or securing medications/firearms/dangerous items, constant observation or urgent mental-health/psychiatric evaluation when current suicidal thoughts or imminent risk is present, and crisis/safety planning such as 988 or crisis resources",
    },
    {
      name: "suicide_self_harm_treatment_safety",
      label: "Suicide/self-harm disposition safety",
      applies: requiresSuicideSelfHarmSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSuicideSelfHarmTreatmentSafetyCheck,
      issue:
        "suicide/self-harm safety checks must include prior attempt or past self-injury review, intoxication, overdose, substance-use, or medical-clearance review, safe disposition with no discharge until emergency psychiatric/full mental-health evaluation, safety plan, or hold criteria are addressed, and support network, trusted person, resource list, referral, or warm follow-up planning",
    },
    {
      name: "meningococcemia_time_critical_actions",
      label: "Meningococcemia immediate antibiotics and isolation",
      applies: requiresMeningococcemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMeningococcemiaTimeCriticalActions,
      issue:
        "meningococcemia time-critical actions must include diagnostic cultures or PCR, immediate ceftriaxone or cefotaxime therapy, sepsis or shock resuscitation, and droplet isolation or public health notification",
    },
    {
      name: "meningococcemia_treatment_safety",
      label: "Meningococcemia precautions and complication safety",
      applies: requiresMeningococcemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMeningococcemiaTreatmentSafetyCheck,
      issue:
        "meningococcemia safety checks must include not delaying antibiotics, droplet precautions until effective therapy, close contact chemoprophylaxis or public health follow-up, and DIC, purpura fulminans, adrenal hemorrhage, or limb ischemia complication monitoring",
    },
    {
      name: "febrile_infant_time_critical_actions",
      label: "Febrile infant age-based workup and treatment",
      applies: requiresFebrileInfantSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasFebrileInfantTimeCriticalActions,
      issue:
        "febrile infant time-critical actions must include age-band risk stratification, blood, urine, and CSF culture pathway, inflammatory markers, empiric age-appropriate antibiotics, and HSV risk assessment or acyclovir planning",
    },
    {
      name: "febrile_infant_treatment_safety",
      label: "Febrile infant antibiotic and disposition safety",
      applies: requiresFebrileInfantSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasFebrileInfantTreatmentSafetyCheck,
      issue:
        "febrile infant safety checks must include not delaying antibiotics in ill-appearing infants, ceftriaxone neonatal safety review, admission or culture-observation criteria, and low-risk discharge or reliable follow-up criteria",
    },
    {
      name: "neonatal_sepsis_time_critical_actions",
      label: "Neonatal sepsis cultures, antibiotics, and stabilization",
      applies: requiresNeonatalSepsisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNeonatalSepsisTimeCriticalActions,
      issue:
        "neonatal sepsis or meningitis time-critical actions must include immediate clinical assessment with maternal/neonatal history, physical examination, or vital signs, blood culture before antibiotics, baseline CRP, C-reactive protein, CBC, or infection marker assessment, empiric neonatal antibiotics with ampicillin, amoxicillin, benzylpenicillin, or penicillin plus gentamicin or cefotaxime, lumbar puncture, CSF, meningitis, or LP pathway planning, and NICU, airway, oxygen, glucose, fluid, shock, vasopressor, or respiratory support stabilization",
    },
    {
      name: "neonatal_sepsis_treatment_safety",
      label: "Neonatal sepsis LP and antibiotic safety",
      applies: requiresNeonatalSepsisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNeonatalSepsisTreatmentSafetyCheck,
      issue:
        "neonatal sepsis or meningitis safety checks must include not delaying antibiotics or not waiting for test results, lumbar puncture contraindication or stabilization review for unprotected airway, respiratory compromise, shock, uncontrolled seizure, bleeding risk, or raised intracranial pressure, gentamicin trough, level, concentration, renal, or creatinine monitoring, and duration or reassessment planning using 36-hour, 48-hour, 7-day, culture, CRP trend, clinical-progress, daily-review, positive-culture, or negative-culture criteria",
    },
    {
      name: "neonatal_hsv_time_critical_actions",
      label: "Neonatal HSV immediate evaluation and acyclovir",
      applies: requiresNeonatalHsvSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNeonatalHsvTimeCriticalActions,
      issue:
        "neonatal HSV time-critical actions must include immediate IV or systemic acyclovir such as 20 mg/kg, HSV surface or lesion testing from mouth, nasopharynx, conjunctiva, anus, skin vesicles, or mucosal surfaces, CSF HSV PCR plus blood HSV PCR or ALT/transaminase evaluation, and concurrent neonatal sepsis evaluation or supportive coverage such as blood cultures, ampicillin/gentamicin, empiric antibiotics, or NICU support",
    },
    {
      name: "neonatal_hsv_treatment_safety",
      label: "Neonatal HSV duration and follow-up safety",
      applies: requiresNeonatalHsvSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNeonatalHsvTreatmentSafetyCheck,
      issue:
        "neonatal HSV safety checks must include treatment duration or repeat-CSF planning such as 14 days for SEM disease, 21 days for CNS/disseminated disease, repeat CSF PCR, lumbar puncture, or suppressive therapy, renal dosing, hydration, creatinine, neutropenia, or ANC monitoring, ophthalmology, eye exam, neuroimaging, MRI, head ultrasound, or audiology assessment, and pediatric infectious disease or maternal exposure review including active lesions or scalp electrode risk",
    },
    {
      name: "neonatal_hyperbilirubinemia_time_critical_actions",
      label: "Neonatal hyperbilirubinemia threshold and escalation actions",
      applies: requiresNeonatalHyperbilirubinemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNeonatalHyperbilirubinemiaTimeCriticalActions,
      issue:
        "neonatal hyperbilirubinemia time-critical actions must include TSB or TcB interpretation by age in hours, gestational age, neurotoxicity risk factors, and phototherapy threshold, intensive phototherapy when indicated, escalation-of-care or exchange transfusion threshold planning with NICU or neonatology transfer, and bilirubin trend plus hemolysis, DAT, G6PD, albumin, CBC, direct bilirubin, or type-and-crossmatch labs",
    },
    {
      name: "neonatal_hyperbilirubinemia_treatment_safety",
      label: "Neonatal hyperbilirubinemia neurotoxicity and follow-up safety",
      applies: requiresNeonatalHyperbilirubinemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNeonatalHyperbilirubinemiaTreatmentSafetyCheck,
      issue:
        "neonatal hyperbilirubinemia safety checks must include neurotoxicity risk factors such as albumin <3, isoimmune hemolysis, G6PD deficiency, sepsis, or clinical instability, acute bilirubin encephalopathy signs requiring urgent exchange transfusion, direct or conjugated bilirubin interpretation without subtracting it from TSB and cholestasis expert review, and rebound bilirubin, feeding, weight, daily bilirubin, or 24-48 hour discharge follow-up planning",
    },
    {
      name: "abusive_head_trauma_time_critical_actions",
      label: "Abusive head trauma imaging, eye exam, and protection actions",
      applies: requiresAbusiveHeadTraumaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAbusiveHeadTraumaTimeCriticalActions,
      issue:
        "abusive head trauma time-critical actions must include airway, seizure, intracranial-pressure, cerebral-perfusion, PICU, neurosurgery, or stabilization planning, CT head, noncontrast head CT, MRI head/brain, or neuroimaging, skeletal survey with skull, spine, ribs, or long-bone imaging, ophthalmology, ophthalmologic, fundoscopic, retinal exam, or retinal-hemorrhage evaluation, and child protective, CPS, child welfare, social work, child-abuse pediatrics, mandated-report, mandatory-report, or safe-discharge escalation",
    },
    {
      name: "abusive_head_trauma_treatment_safety",
      label: "Abusive head trauma mimics, occult injury, and disposition safety",
      applies: requiresAbusiveHeadTraumaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAbusiveHeadTraumaTreatmentSafetyCheck,
      issue:
        "abusive head trauma safety checks must include developmental mechanism plausibility or inconsistent/revised history review, coagulopathy, coagulation, PT/PTT, factor, hematology, metabolic bone, or bone-fragility mimic review, occult abdominal or visceral injury screening with AST, ALT, CMP, troponin, urinalysis, or abdominal CT, repeat or follow-up skeletal survey planning in 10 to 14 days or 2 to 3 weeks, and safe home, safety plan, safe placement, child protective, CPS, child welfare, or law enforcement disposition safeguards",
    },
    {
      name: "ectopic_pregnancy_time_critical_actions",
      label: "Ectopic pregnancy diagnostic escalation",
      applies: requiresEctopicPregnancySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasEctopicPregnancyTimeCriticalActions,
      issue:
        "ectopic pregnancy time-critical actions must include quantitative hCG or pregnancy testing, pelvic or transvaginal ultrasound, and urgent OB/GYN or operative escalation for instability or rupture",
    },
    {
      name: "ectopic_pregnancy_treatment_safety",
      label: "Ectopic pregnancy treatment safety",
      applies: requiresEctopicPregnancySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasEctopicPregnancyTreatmentSafetyCheck,
      issue:
        "ectopic pregnancy safety checks must include Rh status or anti-D planning, methotrexate eligibility labs plus contraindication review, and hemodynamic or rupture risk",
    },
    {
      name: "postpartum_hemorrhage_time_critical_actions",
      label: "Postpartum hemorrhage emergency actions",
      applies: requiresPostpartumHemorrhageSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPostpartumHemorrhageTimeCriticalActions,
      issue:
        "postpartum hemorrhage time-critical actions must include hemorrhage protocol, large-bore access, type-and-screen, crossmatch, transfusion, blood-product, or massive-transfusion resuscitation, uterine massage, fundal massage, oxytocin, uterotonic, methylergonovine, carboprost, or misoprostol therapy, tranexamic acid or TXA, source assessment for 4 Ts, tone, trauma, tissue, thrombin, atony, laceration, retained placenta, or retained tissue, and escalation with OB, operating room, surgery, Bakri, balloon tamponade, B-Lynch, uterine tamponade, or hysterectomy planning",
    },
    {
      name: "postpartum_hemorrhage_treatment_safety",
      label: "Postpartum hemorrhage treatment safety",
      applies: requiresPostpartumHemorrhageSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPostpartumHemorrhageTreatmentSafetyCheck,
      issue:
        "postpartum hemorrhage safety checks must include uterotonic contraindication review such as asthma, hypertension, preeclampsia, methylergonovine, carboprost, or misoprostol, TXA timing or contraindication review including 3-hours, thromboembolism, tranexamic acid, or TXA, coagulopathy, fibrinogen, platelet, INR, shock-index, or viscoelastic transfusion monitoring, retained placenta, retained tissue, manual removal, laceration, genital-tract, uterine inversion, or rupture review, and escalation safety for balloon, tamponade, packing, surgical, laparotomy, or interventional-radiology options",
    },
    {
      name: "placental_abruption_time_critical_actions",
      label: "Placental abruption emergency actions",
      applies: requiresPlacentalAbruptionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPlacentalAbruptionTimeCriticalActions,
      issue:
        "placental abruption time-critical actions must include maternal stabilization or hemorrhage resuscitation with IV access, crossmatch, transfusion, blood products, or hemodynamic support, fetal heart or fetal status monitoring, coagulation, fibrinogen, platelet, Rh, type-and-screen, or crossmatch labs, and prompt delivery, cesarean, OB, MFM, or operative escalation for maternal or fetal instability",
    },
    {
      name: "placental_abruption_treatment_safety",
      label: "Placental abruption treatment safety",
      applies: requiresPlacentalAbruptionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPlacentalAbruptionTreatmentSafetyCheck,
      issue:
        "placental abruption safety checks must include placenta previa exclusion before pelvic examination and recognition that normal ultrasound does not rule out abruption, coagulation, fibrinogen, platelet, blood type, Rh immune globulin, or Kleihauer-Betke assessment, delivery or prompt cesarean criteria for maternal or fetal instability, ongoing bleeding, deterioration, term, or near-term pregnancy, and shock, DIC, coagulopathy, transfusion, blood-product, massive-transfusion, or fibrinogen safeguards",
    },
    {
      name: "placenta_previa_time_critical_actions",
      label: "Placenta previa bleeding actions",
      applies: requiresPlacentaPreviaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPlacentaPreviaTimeCriticalActions,
      issue:
        "placenta previa time-critical actions must include ultrasound or transvaginal ultrasonography diagnosis, fetal heart rate or continuous fetal monitoring, hemorrhage stabilization with large-bore IV, type-and-screen, crossmatch, transfusion, blood products, shock, or hemodynamic support, and cesarean/caesarean, immediate cesarean, delivery, or operative escalation for severe bleeding or nonreassuring fetal status",
    },
    {
      name: "placenta_previa_treatment_safety",
      label: "Placenta previa exam and delivery safety",
      applies: requiresPlacentaPreviaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPlacentaPreviaTreatmentSafetyCheck,
      issue:
        "placenta previa safety checks must include avoiding digital cervical or pelvic examination until placenta previa is excluded by ultrasound, ultrasound or transvaginal ultrasonography before pelvic examination for bleeding after 20 weeks, stable cesarean/caesarean delivery timing at 36 to 37 6/7 weeks without lung maturity documentation, immediate cesarean delivery for severe, uncontrolled, or heavy bleeding, maternal hemodynamic instability, or nonreassuring fetal status, and expectant management safeguards such as hospitalization, modified activity, avoidance of sexual activity, or corticosteroids when early delivery risk is present",
    },
    {
      name: "placenta_accreta_time_critical_actions",
      label: "Placenta accreta planned delivery actions",
      applies: requiresPlacentaAccretaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPlacentaAccretaTimeCriticalActions,
      issue:
        "placenta accreta spectrum time-critical actions must include antenatal ultrasound, ultrasonography, Doppler, MRI, or placental lacunae assessment, multidisciplinary team activation with MFM, maternal-fetal medicine, anesthesia, gynecologic oncology, urology, critical care, neonatal, or experienced surgeons, blood bank, hemorrhage protocol, blood-product, transfusion, or massive-transfusion preparation, and scheduled cesarean/caesarean hysterectomy or planned 34 0/7 to 35 6/7 week delivery",
    },
    {
      name: "placenta_accreta_treatment_safety",
      label: "Placenta accreta hemorrhage and removal safety",
      applies: requiresPlacentaAccretaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPlacentaAccretaTreatmentSafetyCheck,
      issue:
        "placenta accreta spectrum safety checks must include referral to a tertiary, Level III, or Level IV maternal-care center, avoiding forced placental removal by leaving placenta in situ, planned delivery before labor or bleeding at 34 0/7 to 35 6/7 weeks with corticosteroids when indicated, massive-transfusion, blood-bank, hemorrhage-checklist, fibrinogen, platelet, PT/PTT, TXA, or tranexamic-acid safeguards, and bladder, urology, pelvic organ, cystectomy, ICU, or critical-care injury planning",
    },
    {
      name: "umbilical_cord_prolapse_time_critical_actions",
      label: "Umbilical cord prolapse emergency actions",
      applies: requiresUmbilicalCordProlapseSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasUmbilicalCordProlapseTimeCriticalActions,
      issue:
        "umbilical cord prolapse time-critical actions must include fetal heart assessment or speculum/digital vaginal examination, immediate assistance, obstetric, theatre, operating-room, or immediate-birth preparation, presenting-part elevation, manual elevation, bladder filling, bladder distension, or cord-compression relief, knee-chest, left-lateral, head-down, Trendelenburg, or exaggerated Sims positioning, and urgent delivery, category-1 cesarean/caesarean, operative vaginal birth if imminent, or within-30-minute birth planning",
    },
    {
      name: "umbilical_cord_prolapse_treatment_safety",
      label: "Umbilical cord prolapse treatment safety",
      applies: requiresUmbilicalCordProlapseSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasUmbilicalCordProlapseTreatmentSafetyCheck,
      issue:
        "umbilical cord prolapse safety checks must include minimal cord handling, vasospasm prevention, and avoiding or not relying on manual cord replacement, no-delay safeguards for position, bladder filling, tocolysis, or terbutaline while preparing birth, delivery mode review including cesarean/caesarean when vaginal birth is not imminent, category-1 for abnormal fetal heart rate, category-2 only with normal trace and continuous assessment, and neonatal resuscitation plus paired cord blood gas, pH, or base-excess planning",
    },
    {
      name: "vasa_previa_time_critical_actions",
      label: "Vasa previa emergency actions",
      applies: requiresVasaPreviaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasVasaPreviaTimeCriticalActions,
      issue:
        "vasa previa time-critical actions must include fetal heart or continuous fetal-status assessment, obstetric/MFM, anaesthesia/anesthesia, neonatal, or blood-bank escalation, urgent cesarean/caesarean delivery or immediate birth planning, and neonatal resuscitation or transfusion preparation for fetal hemorrhage",
    },
    {
      name: "vasa_previa_treatment_safety",
      label: "Vasa previa delivery safety",
      applies: requiresVasaPreviaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasVasaPreviaTreatmentSafetyCheck,
      issue:
        "vasa previa safety checks must include not delaying delivery for antenatal corticosteroids or fetal lung maturity testing when active hemorrhage or delivery indication is present, stable vasa previa delivery planning at 34-37 weeks or before labor/rupture, antenatal corticosteroid criteria for expectant late preterm management if delivery is likely within 7 days, and avoidance of amniotomy, fetal scalp electrode, membrane rupture, labor, or vaginal delivery when unprotected fetal vessels are at risk",
    },
    {
      name: "uterine_rupture_time_critical_actions",
      label: "Uterine rupture emergency actions",
      applies: requiresUterineRuptureSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasUterineRuptureTimeCriticalActions,
      issue:
        "uterine rupture time-critical actions must include immediate fetal and maternal assessment or resuscitation, obstetric, anaesthesia/anesthesia, neonatal, surgical, or blood-bank activation, emergency laparotomy with cesarean/caesarean delivery planning, and hemorrhage or transfusion preparation",
    },
    {
      name: "uterine_rupture_treatment_safety",
      label: "Uterine rupture labor and operative safety",
      applies: requiresUterineRuptureSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasUterineRuptureTreatmentSafetyCheck,
      issue:
        "uterine rupture safety checks must include stopping labor, TOLAC/VBAC, oxytocin, or trial of labor when rupture is suspected, avoiding prostaglandins such as misoprostol in prior-cesarean vaginal-birth attempts, not delaying laparotomy for imaging when rupture is suspected, and repair, hysterectomy, bladder-laceration, or hemorrhage contingency planning",
    },
    {
      name: "amniotic_fluid_embolism_time_critical_actions",
      label: "Amniotic fluid embolism resuscitation actions",
      applies: requiresAmnioticFluidEmbolismSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAmnioticFluidEmbolismTimeCriticalActions,
      issue:
        "amniotic fluid embolism time-critical actions must include airway and oxygenation support, CPR or hemodynamic support with lateral tilt, manual uterine displacement, or vasopressors, obstetric, anesthesia/anaesthesia, critical-care, ICU, neonatal, or blood-bank team activation, operative delivery, perimortem cesarean/caesarean, or resuscitative hysterotomy timing when arrest persists, and coagulopathy, DIC, transfusion, cryoprecipitate, or fibrinogen replacement planning",
    },
    {
      name: "amniotic_fluid_embolism_treatment_safety",
      label: "Amniotic fluid embolism treatment safety",
      applies: requiresAmnioticFluidEmbolismSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAmnioticFluidEmbolismTreatmentSafetyCheck,
      issue:
        "amniotic fluid embolism safety checks must include avoiding fluid overload or using vasopressors for shock, replacing clotting factors with cryoprecipitate, fibrinogen, or blood products for DIC/coagulopathy, not using recombinant factor VIIa routinely, and hemorrhage planning with oxytocin, uterotonics, tranexamic acid, or TXA as appropriate",
    },
    {
      name: "shoulder_dystocia_time_critical_actions",
      label: "Shoulder dystocia emergency maneuvers",
      applies: requiresShoulderDystociaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasShoulderDystociaTimeCriticalActions,
      issue:
        "shoulder dystocia time-critical actions must include immediate clear shoulder-dystocia declaration and help call with obstetric, anaesthesia/anesthetist, or neonatal resuscitation support, McRoberts manoeuvre/maneuver first, suprapubic pressure, and second-line manoeuvres/maneuvers such as posterior-arm delivery, internal rotation, Rubin, Woods screw, all-fours, or Gaskin if initial measures fail",
    },
    {
      name: "shoulder_dystocia_treatment_safety",
      label: "Shoulder dystocia traction and injury safety",
      applies: requiresShoulderDystociaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasShoulderDystociaTreatmentSafetyCheck,
      issue:
        "shoulder dystocia safety checks must include avoiding fundal pressure and excessive lateral/downward traction with routine axial traction only, episiotomy not routinely required except for internal access, separate maternal and neonatal injury assessment for postpartum hemorrhage, severe perineal tear, brachial plexus injury, fracture, or neonatal clinician review, and documentation of head-to-body interval, timing, and manoeuvres/maneuvers",
    },
    {
      name: "severe_preeclampsia_time_critical_actions",
      label: "Severe preeclampsia emergency actions",
      applies: requiresSeverePreeclampsiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSeverePreeclampsiaTimeCriticalActions,
      issue:
        "severe preeclampsia or eclampsia time-critical actions must include magnesium sulfate seizure prophylaxis or treatment, acute severe-hypertension treatment within 30-60 minutes or after persistent severe-range BP using IV labetalol, IV hydralazine, or immediate-release/oral nifedipine, explicit delivery timing or maternal-fetal stabilization planning, and OB/MFM or critical-care escalation",
    },
    {
      name: "severe_preeclampsia_treatment_safety",
      label: "Severe preeclampsia treatment safety",
      applies: requiresSeverePreeclampsiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSeverePreeclampsiaTreatmentSafetyCheck,
      issue:
        "severe preeclampsia or eclampsia safety checks must include magnesium toxicity monitoring for respiratory status, reflexes, urine output, and calcium gluconate readiness, antihypertensive contraindication review for labetalol and nifedipine, platelet, liver/transaminase, and renal/proteinuria labs, maternal severe features and fetal/delivery-risk monitoring, not delaying delivery to complete corticosteroids when deterioration requires delivery, and postpartum magnesium/monitoring or follow-up safety",
    },
    {
      name: "hellp_time_critical_actions",
      label: "HELLP syndrome emergency actions",
      applies: requiresHellpSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHellpTimeCriticalActions,
      issue:
        "HELLP syndrome time-critical actions must include CBC/platelet, AST/ALT or transaminase, and hemolysis labs such as LDH, bilirubin, or smear, magnesium sulfate seizure prophylaxis, specific severe hypertension treatment with labetalol, hydralazine, or nifedipine, explicit delivery planning with maternal-fetal status or stabilization timing, and both DIC/coagulation assessment and hepatic complication assessment for subcapsular hematoma or liver rupture",
    },
    {
      name: "hellp_treatment_safety",
      label: "HELLP syndrome treatment safety",
      applies: requiresHellpSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHellpTreatmentSafetyCheck,
      issue:
        "HELLP syndrome safety checks must include DIC workup with fibrinogen and PT/PTT when abnormal bleeding or platelet count less than 50k is present, platelet transfusion thresholds around <20k for vaginal delivery, <50k before cesarean delivery, or abnormal bleeding, regional/epidural anesthesia platelet safety with safe and avoid thresholds, corticosteroid/fetal lung maturity planning before 34 weeks, and postpartum magnesium sulfate plus LDH/platelet recovery monitoring for 24 to 48 hours",
    },
    {
      name: "hypertensive_emergency_time_critical_actions",
      label: "Hypertensive emergency actions",
      applies: requiresHypertensiveEmergencySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHypertensiveEmergencyTimeCriticalActions,
      issue:
        "hypertensive emergency time-critical actions must include repeat BP confirmation and monitored-setting/ICU/telemetry/arterial-line monitoring, acute target-organ damage assessment covering neurologic or fundoscopic findings, renal testing, and cardiac/pulmonary-edema/aortic-dissection testing, short-acting titratable IV antihypertensive therapy with a specific agent such as nicardipine, IV labetalol, clevidipine, esmolol, fenoldopam, nitroglycerin, or nitroprusside, and a controlled BP-lowering target such as MAP or mean arterial pressure reduction by about 20-25% over the first 1-2 hours",
    },
    {
      name: "hypertensive_emergency_treatment_safety",
      label: "Hypertensive emergency treatment safety",
      applies: requiresHypertensiveEmergencySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHypertensiveEmergencyTreatmentSafetyCheck,
      issue:
        "hypertensive emergency safety checks must distinguish true emergency with acute target-organ damage from asymptomatic markedly elevated BP or hypertensive urgency, avoid overly rapid BP lowering with hypotension/hypoperfusion and more-than-25% early reduction safeguards, review condition-specific medication choice and drug contraindications for contexts such as aortic dissection, pulmonary edema, stroke, pregnancy, renal failure, heart failure, asthma, bradycardia, beta-blocker use, high intracranial pressure, or azotemia, and include ICU/monitored disposition with continuous BP/arterial-line/telemetry monitoring plus titration or reassessment",
    },
    {
      name: "giant_cell_arteritis_time_critical_actions",
      label: "Giant cell arteritis emergency actions",
      applies: requiresGiantCellArteritisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasGiantCellArteritisTimeCriticalActions,
      issue:
        "giant cell arteritis time-critical actions must include immediate high-dose glucocorticoid/corticosteroid therapy with a specific agent such as prednisone, prednisolone, or IV methylprednisolone, ESR plus CRP plus CBC/platelet testing, temporal artery biopsy or temporal artery ultrasound/color-Doppler/halo-sign diagnostic planning, and urgent/same-day ophthalmology or rheumatology escalation for visual symptoms or vision loss",
    },
    {
      name: "giant_cell_arteritis_treatment_safety",
      label: "Giant cell arteritis treatment safety",
      applies: requiresGiantCellArteritisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasGiantCellArteritisTreatmentSafetyCheck,
      issue:
        "giant cell arteritis safety checks must include explicit do-not-delay steroid planning before biopsy, ultrasound, labs, or specialist review, visual-symptom and cranial-ischemia risk review for amaurosis fugax, diplopia, visual disturbance, vision loss, or stroke, steroid-risk mitigation for glucose/diabetes, infection, osteoporosis/fracture/bone protection, and PPI/GI risk, plus follow-up planning for taper/relapse, large-vessel disease or vascular imaging, and polymyalgia rheumatica or tocilizumab/steroid-sparing therapy",
    },
    {
      name: "acute_angle_closure_glaucoma_time_critical_actions",
      label: "Acute angle-closure glaucoma emergency actions",
      applies: requiresAcuteAngleClosureGlaucomaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteAngleClosureGlaucomaTimeCriticalActions,
      issue:
        "acute angle-closure glaucoma time-critical actions must include IOP/intraocular-pressure measurement with tonometry plus slit-lamp, gonioscopy, or anterior-chamber assessment, immediate or urgent treatment, topical timolol/beta-blocker plus brimonidine or apraclonidine and pilocarpine/miotic therapy, systemic acetazolamide/Diamox plus osmotic-agent escalation such as mannitol, glycerol, or isosorbide, and urgent ophthalmology with laser peripheral iridotomy, LPI, iridotomy, or iridectomy definitive planning",
    },
    {
      name: "acute_angle_closure_glaucoma_treatment_safety",
      label: "Acute angle-closure glaucoma treatment safety",
      applies: requiresAcuteAngleClosureGlaucomaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteAngleClosureGlaucomaTreatmentSafetyCheck,
      issue:
        "acute angle-closure glaucoma safety checks must include medication contraindication review for acetazolamide/Diamox with sulfa allergy or renal failure/impairment and timolol/beta-blocker with asthma, COPD, or bradycardia, pilocarpine timing or avoidance review for high IOP, corneal edema, lens-induced or phacomorphic angle closure, or pupil block, fellow-eye/bilateral assessment plus prophylactic iridotomy planning, visual-acuity/vision-loss, repeat-IOP/recheck-IOP, and optic-nerve/corneal-edema monitoring, and avoidance of mydriatic, pupil-dilating, or anticholinergic triggers",
    },
    {
      name: "retinal_detachment_time_critical_actions",
      label: "Retinal detachment emergency actions",
      applies: requiresRetinalDetachmentSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasRetinalDetachmentTimeCriticalActions,
      issue:
        "retinal detachment time-critical actions must include visual acuity plus visual-field or central/peripheral-vision assessment and pupil/APD/red-reflex review, dilated retinal exam or indirect ophthalmoscopy plus B-scan/ocular ultrasound when the view is limited, same-day/urgent/emergency timing with ophthalmology, retina specialist, or vitreoretinal escalation, and specific definitive repair planning such as laser retinopexy, cryotherapy, pneumatic retinopexy, scleral buckle, vitrectomy, or retinal repair",
    },
    {
      name: "retinal_detachment_treatment_safety",
      label: "Retinal detachment treatment safety",
      applies: requiresRetinalDetachmentSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasRetinalDetachmentTreatmentSafetyCheck,
      issue:
        "retinal detachment safety checks must include explicit do-not-delay language plus same-day/urgent/emergency ophthalmology planning, macula-on/off or macular-involvement status plus central vision or visual-field review, differential review for retinal tear plus posterior vitreous detachment/PVD or vitreous hemorrhage, and precautions for worsening vision/progression/recheck/return plus perioperative NPO, head positioning, or avoiding eye pressure",
    },
    {
      name: "central_retinal_artery_occlusion_time_critical_actions",
      label: "Central retinal artery occlusion emergency actions",
      applies: requiresCentralRetinalArteryOcclusionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCentralRetinalArteryOcclusionTimeCriticalActions,
      issue:
        "central retinal artery occlusion time-critical actions must include symptom-onset or last-known-well timing plus stroke-code, stroke-center, or stroke-pathway activation, ophthalmic confirmation with visual acuity plus fundus/cherry-red-spot/retinal-whitening/optic-disc assessment and ophthalmology/retina involvement, brain or vascular imaging plus carotid evaluation plus ECG/echocardiogram or embolic-source assessment, reperfusion eligibility review with alteplase, tPA, TNK, thrombolysis, fibrinolysis, or thrombolytic planning, and acute IOP-lowering or retinal-perfusion support such as timolol, acetazolamide, ocular massage, anterior-chamber paracentesis, or hyperbaric oxygen",
    },
    {
      name: "central_retinal_artery_occlusion_treatment_safety",
      label: "Central retinal artery occlusion treatment safety",
      applies: requiresCentralRetinalArteryOcclusionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCentralRetinalArteryOcclusionTreatmentSafetyCheck,
      issue:
        "central retinal artery occlusion safety checks must include mimic review for retinal detachment/vitreous hemorrhage plus optic neuropathy, optic neuritis, or migraine, thrombolysis eligibility and contraindication review covering bleeding/hemorrhage/anticoagulant/INR/platelet risk plus blood pressure or recent surgery, secondary stroke prevention with antiplatelet/statin, atrial-fibrillation/carotid-stenosis evaluation, and vascular risk-factor control, and arteritic CRAO screening with ESR/CRP plus platelet count, GCA symptoms such as jaw claudication, scalp tenderness, or temporal headache, and high-dose steroid planning when arteritic disease is suspected",
    },
    {
      name: "open_globe_time_critical_actions",
      label: "Open globe emergency actions",
      applies: requiresOpenGlobeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOpenGlobeTimeCriticalActions,
      issue:
        "open globe time-critical actions must include rigid eye shield, protective shield, or eye-shield placement with explicit no-pressure handling, systemic/IV antibiotic coverage including vancomycin plus ceftazidime/cefazolin/cephalosporin or a fluoroquinolone, tetanus planning, CT orbit/orbital CT plus foreign-body or intraocular-foreign-body imaging, urgent ophthalmology or ophthalmologist escalation, and specific globe exploration, surgical repair, operative repair, closure, or globe repair planning",
    },
    {
      name: "open_globe_treatment_safety",
      label: "Open globe treatment safety",
      applies: requiresOpenGlobeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOpenGlobeTreatmentSafetyCheck,
      issue:
        "open globe safety checks must include avoiding pressure plus eye patching/tonometry avoidance and ocular-ultrasound/manipulation avoidance because ocular contents can extrude, NPO plus antiemetic and analgesia/pain-control planning, intraocular foreign-body precautions with do-not-remove/leave-in-place and metallic foreign body/MRI avoidance review, topical-antibiotic or ointment avoidance, and posttraumatic endophthalmitis/infection, intravitreal-antibiotic, sympathetic-ophthalmia, vision-prognosis, or close-follow-up monitoring",
    },
    {
      name: "endophthalmitis_time_critical_actions",
      label: "Endophthalmitis emergency actions",
      applies: requiresEndophthalmitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasEndophthalmitisTimeCriticalActions,
      issue:
        "endophthalmitis time-critical actions must include emergency, same-day, urgent ophthalmology, retina, vitreoretinal, or urgent-referral escalation, ocular sampling with aqueous tap, vitreous tap, vitreous aspirate, or tap-and-inject plus gram stain/culture microbiology, intravitreal antibiotic or antimicrobial route with both vancomycin and ceftazidime or gram-negative cephalosporin coverage, and endogenous/systemic infection evaluation with IV antibiotics or IV antimicrobials plus blood or urine cultures",
    },
    {
      name: "endophthalmitis_treatment_safety",
      label: "Endophthalmitis treatment safety",
      applies: requiresEndophthalmitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasEndophthalmitisTreatmentSafetyCheck,
      issue:
        "endophthalmitis safety checks must include explicit do-not-delay or emergency review and differentiation from conjunctivitis or uveitis, vitrectomy review tied to severe vision findings such as light perception, count-fingers, poor vision, severe disease, or vitreous opacity, fungal/immunocompromised/IV-drug/voriconazole context plus explicit steroid or corticosteroid contraindication, and monitoring for visual acuity or daily exam plus culture sensitivity, repeat intravitreal injection, no improvement, worsening, or recheck response",
    },
    {
      name: "ttp_time_critical_actions",
      label: "TTP emergency actions",
      applies: requiresTtpSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTtpTimeCriticalActions,
      issue:
        "TTP time-critical actions must include urgent hematology plus therapeutic plasma exchange, plasma exchange, plasmapheresis, or TPE planning, ADAMTS13 sampling before plasma products or plasma exchange, hemolysis labs such as LDH, haptoglobin, bilirubin, reticulocyte count, peripheral smear, blood smear, or schistocytes plus PT/PTT/fibrinogen and renal/urinalysis assessment, corticosteroid, glucocorticoid, methylprednisolone, prednisone, or steroid therapy, rituximab or immunosuppression planning, and caplacizumab or anti-VWF consideration",
    },
    {
      name: "ttp_treatment_safety",
      label: "TTP treatment safety",
      applies: requiresTtpSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTtpTreatmentSafetyCheck,
      issue:
        "TTP safety checks must include explicit do-not-wait, do-not-delay, pending-ADAMTS13, before-ADAMTS13, or empiric-treatment planning, platelet transfusion avoidance plus explicit life-threatening bleeding or urgent-procedure exception, differential review for TMA mimics such as HUS, aHUS, or ITP plus DIC, sepsis, HELLP, or preeclampsia, monitoring for platelet count/recovery, LDH, or hemolysis plus renal, neurologic, cardiac, bleeding, thrombosis, or organ complications, and relapse/refractory recurrence planning",
    },
    {
      name: "acute_liver_failure_time_critical_actions",
      label: "Acute liver failure emergency actions",
      applies: requiresAcuteLiverFailureSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteLiverFailureTimeCriticalActions,
      issue:
        "acute liver failure time-critical actions must include ICU, intensive-care, or high-acuity monitoring planning, liver-transplant, transplant-center, or transplant-service involvement plus early-transfer, transplant-evaluation, or Status 1A planning, N-acetylcysteine, NAC, or acetylcysteine therapy, etiology workup covering acetaminophen/toxicology, viral hepatitis/hepatitis serologies/HSV, and Wilson/ceruloplasmin or autoimmune causes, and serial monitoring of INR/PT or prothrombin time, ammonia, glucose, lactate or pH, renal function or creatinine, and neurologic/encephalopathy status",
    },
    {
      name: "acute_liver_failure_treatment_safety",
      label: "Acute liver failure treatment safety",
      applies: requiresAcuteLiverFailureSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteLiverFailureTreatmentSafetyCheck,
      issue:
        "acute liver failure safety checks must include cerebral-edema or intracranial-pressure planning plus head elevation, seizure monitoring, mannitol, or hypertonic saline intervention, coagulopathy safety including avoiding routine FFP or correction unless bleeding or procedure need is present, glucose monitoring plus hypoglycemia/dextrose support, prognosis review using King's College, MELD, transplant criteria, or transplant-free survival plus Status 1A/listing/early-transplant-center transfer, infection/sepsis surveillance with cultures or antibiotics, and hemodynamic, vasopressor, fluid-overload, or renal-failure monitoring",
    },
    {
      name: "neutropenic_fever_time_critical_actions",
      label: "Febrile neutropenia emergency actions",
      applies: requiresNeutropenicFeverSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNeutropenicFeverTimeCriticalActions,
      issue:
        "febrile neutropenia time-critical actions must include ANC or CBC confirmation, blood cultures with peripheral and central-line or lumen cultures plus source/urine cultures when indicated, immediate empiric antipseudomonal antibiotics such as cefepime, piperacillin-tazobactam, meropenem, imipenem, or ceftazidime within 1 hour, and admission/sepsis escalation plus oncology or hematology involvement with MASCC, CISNE, or risk-score stratification",
    },
    {
      name: "neutropenic_fever_treatment_safety",
      label: "Febrile neutropenia treatment safety",
      applies: requiresNeutropenicFeverSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNeutropenicFeverTreatmentSafetyCheck,
      issue:
        "febrile neutropenia safety checks must include antibiotic allergy plus renal/hepatic dosing and toxicity review, local antibiogram or resistance review, vancomycin-not-routine stewardship plus specific vancomycin indications such as catheter infection, skin/soft-tissue infection, pneumonia, MRSA, resistant gram-positive organism, or hemodynamic instability, validated MASCC/CISNE risk and outpatient/discharge/social eligibility with return precautions or readmission plan, and persistent or recurrent fever after 4-7 days with antifungal/fungal-risk plus clinical/microbiologic reassessment",
    },
    {
      name: "obstructive_pyelonephritis_time_critical_actions",
      label: "Obstructive pyelonephritis emergency actions",
      applies: requiresObstructivePyelonephritisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasObstructivePyelonephritisTimeCriticalActions,
      issue:
        "obstructive pyelonephritis time-critical actions must include immediate broad-spectrum antibiotics, both urine and blood cultures, CT or ultrasound plus obstruction, hydronephrosis, stone, or ureteral-stone findings, urgent decompression/source control using a specific route such as ureteral stent, ureteral stenting, percutaneous drainage, percutaneous nephrostomy, PCN, or nephrostomy catheter, and sepsis support with fluids, lactate, shock, vasopressor, ICU, or septic-shock monitoring",
    },
    {
      name: "obstructive_pyelonephritis_treatment_safety",
      label: "Obstructive pyelonephritis treatment safety",
      applies: requiresObstructivePyelonephritisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasObstructivePyelonephritisTreatmentSafetyCheck,
      issue:
        "obstructive pyelonephritis safety checks must include delayed definitive stone removal, ureteroscopy, or lithotripsy until infection or sepsis resolves, drainage option review with a specific ureteral stent or percutaneous nephrostomy route, antibiotic reassessment or adjustment using culture result, antibiogram, susceptibility, resistance, or renal dosing data, and complication risk review for anuria, AKI, renal failure, solitary kidney, pregnancy, immunocompromised state, urosepsis, or septic shock",
    },
    {
      name: "severe_hypoglycemia_time_critical_actions",
      label: "Severe hypoglycemia emergency actions",
      applies: requiresSevereHypoglycemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSevereHypoglycemiaTimeCriticalActions,
      issue:
        "severe hypoglycemia time-critical actions must include bedside or point-of-care glucose confirmation, a specific immediate rescue treatment such as oral glucose, glucose tablets, IV dextrose/D50/D10, glucagon, or dasiglucagon rather than generic sugar/carbohydrate language, repeat glucose checks, sustained carbohydrate feeding or dextrose infusion to prevent recurrence, prolonged-risk recognition for long-acting insulin, sulfonylurea, seizure, renal failure, or persistent altered mental status, and admission, observation, prolonged monitoring, or continuous dextrose-infusion escalation",
    },
    {
      name: "severe_hypoglycemia_treatment_safety",
      label: "Severe hypoglycemia treatment safety",
      applies: requiresSevereHypoglycemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereHypoglycemiaTreatmentSafetyCheck,
      issue:
        "severe hypoglycemia safety checks must include airway or swallow route safety, recurrent hypoglycemia risk from sulfonylurea, long-acting insulin, rebound, or recurrent episodes, observation, prolonged monitoring, admission, or dextrose-infusion planning, octreotide planning when sulfonylurea risk is present, renal, hepatic, alcohol, sepsis, or adrenal cause review, and discharge prevention such as education, dose adjustment, meal access, or glucagon planning",
    },
    {
      name: "insulin_sulfonylurea_toxicity_time_critical_actions",
      label: "Insulin or sulfonylurea toxicity glucose rescue",
      applies: requiresInsulinSulfonylureaToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasInsulinSulfonylureaToxicityTimeCriticalActions,
      issue:
        "insulin or sulfonylurea toxicity time-critical actions must include serial or frequent glucose monitoring, immediate IV dextrose or glucose bolus rescue, continuous dextrose/glucose infusion for recurrent or prolonged hypoglycemia, complex carbohydrate, meal, feeding, or nutrition once safe, poison-center, toxicologist, ICU, HDU, or admission escalation, and potassium, magnesium, phosphate, EUC, or electrolyte monitoring",
    },
    {
      name: "sulfonylurea_toxicity_octreotide_time_critical_action",
      label: "Sulfonylurea toxicity octreotide plan",
      applies: requiresSulfonylureaToxicityOctreotideAction,
      fieldName: "time_critical_actions",
      validator: hasSulfonylureaToxicityOctreotideAction,
      issue:
        "sulfonylurea toxicity time-critical actions must include octreotide for recurrent or persistent hypoglycemia; admission, ICU/HDU care, poison-center, or toxicologist escalation alone is not an octreotide plan",
    },
    {
      name: "insulin_sulfonylurea_toxicity_treatment_safety",
      label: "Insulin or sulfonylurea recurrent hypoglycemia safety",
      applies: requiresInsulinSulfonylureaToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasInsulinSulfonylureaToxicityTreatmentSafetyCheck,
      issue:
        "insulin or sulfonylurea toxicity safety checks must include recurrent or delayed hypoglycemia risk from long-acting or extended-release exposure, observation duration such as 6-hour, 12-hour, euglycemia, or post-dextrose stopping monitoring, high-dose or concentrated dextrose safety with central-line, D10, D25, D50, hyponatremia, tapering, or weaning review, potassium, magnesium, phosphate, low-to-normal, or other electrolyte monitoring, high-risk patient review for child, elderly, non-diabetic, one-tablet, renal, hepatic, or liver risk, and disposition review for admission, ICU, HDU, endocrine review, or therapeutic dosing cause plus stability criteria such as normal diet, sustained euglycemia, medical clearance, octreotide discontinuation, or stopping dextrose",
    },
    {
      name: "malignant_hyperthermia_time_critical_actions",
      label: "Malignant hyperthermia emergency actions",
      applies: requiresMalignantHyperthermiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMalignantHyperthermiaTimeCriticalActions,
      issue:
        "malignant hyperthermia time-critical actions must include stopping triggering anesthetics or succinylcholine with non-triggering anesthesia, high-flow 100% oxygen or hyperventilation, immediate IV dantrolene with 2.5 mg/kg, rapid, or repeat-dose planning, active cooling, and MH cart, hotline, ICU, or urine-output escalation",
    },
    {
      name: "malignant_hyperthermia_treatment_safety",
      label: "Malignant hyperthermia treatment safety",
      applies: requiresMalignantHyperthermiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMalignantHyperthermiaTreatmentSafetyCheck,
      issue:
        "malignant hyperthermia safety checks must include hyperkalemia/potassium treatment review, acidosis/blood-gas or arrhythmia review, rhabdomyolysis/CK/myoglobin monitoring, core temperature or ETCO2 monitoring, urine-output or myoglobinuria monitoring, dantrolene repeat-dose or recrudescence planning, calcium-channel blocker interaction avoidance, cooling endpoint such as stopping cooling near 38 C, post-crisis PACU/ICU observation for at least 24 hours, and trigger-free anesthesia or susceptibility prevention planning",
    },
    {
      name: "thyroid_storm_time_critical_actions",
      label: "Thyroid storm emergency actions",
      applies: requiresThyroidStormSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasThyroidStormTimeCriticalActions,
      issue:
        "thyroid storm time-critical actions must include beta-blockade or rate control with a specific beta-blocker such as propranolol or esmolol, thionamide antithyroid therapy such as PTU or methimazole, iodine or iodide therapy such as Lugol solution or SSKI, glucocorticoid therapy such as hydrocortisone or dexamethasone, supportive care with cooling, IV fluids, oxygen, or acetaminophen, and ICU, telemetry, or cardiac monitoring",
    },
    {
      name: "thyroid_storm_treatment_safety",
      label: "Thyroid storm treatment safety",
      applies: requiresThyroidStormSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasThyroidStormTreatmentSafetyCheck,
      issue:
        "thyroid storm safety checks must include thionamide-before-iodine sequencing with iodine delayed about one hour, beta-blocker contraindication review for asthma, bronchospasm, decompensated heart failure, hypotension, or shock plus diltiazem, esmolol, metoprolol, atenolol, or cardioselective alternative planning, thionamide toxicity review for CBC/agranulocytosis plus liver/transaminase/PTU hepatotoxicity, pregnancy safety, precipitant search for infection, MI, pulmonary embolism, thyroidectomy, or other trigger, arrhythmia/atrial-fibrillation plus ICU, telemetry, or cardiac monitoring, and aspirin/salicylate avoidance with acetaminophen-based fever control",
    },
    {
      name: "myxedema_coma_time_critical_actions",
      label: "Myxedema coma emergency actions",
      applies: requiresMyxedemaComaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMyxedemaComaTimeCriticalActions,
      issue:
        "myxedema coma time-critical actions must include ICU or intensive-care admission, airway/oxygen/ABG/hypercapnia or mechanical-ventilation support, hypotension/shock fluid or vasopressor hemodynamic planning, stress-dose hydrocortisone, steroid, glucocorticoid, or cortisol coverage, IV levothyroxine, IV liothyronine, or IV thyroid-hormone therapy, thyroid labs such as TSH and free T4, infection/precipitant workup with cultures, chest x-ray, pneumonia, sepsis, or empiric antibiotics, and cortisol assessment",
    },
    {
      name: "myxedema_coma_treatment_safety",
      label: "Myxedema coma treatment safety",
      applies: requiresMyxedemaComaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMyxedemaComaTreatmentSafetyCheck,
      issue:
        "myxedema coma safety checks must include adrenal-insufficiency or hydrocortisone-before-thyroid-hormone sequencing, passive rewarming or avoidance of aggressive rewarming for hypothermia, hyponatremia/sodium monitoring, hypoglycemia/glucose monitoring, oxygen, hypoxemia, hypercapnia, arterial-blood-gas, or ventilation monitoring, and elderly, coronary, ischemia, arrhythmia, telemetry, or lower-dose thyroid-hormone cardiac safety",
    },
    {
      name: "severe_hypothermia_time_critical_actions",
      label: "Severe hypothermia rewarming actions",
      applies: requiresSevereHypothermiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSevereHypothermiaTimeCriticalActions,
      issue:
        "severe hypothermia time-critical actions must include core temperature measurement with rectal, esophageal, or low-reading thermometer/probe, gentle handling, wet-clothing removal, insulation, airway, oxygen, or ventilation support, active external or active core rewarming such as forced air, specific core-rewarming modality planning with heated humidified oxygen, warm IV fluid, heated infusion/lavage, ECMO, ECLS, cardiopulmonary bypass, or extracorporeal rewarming, fluid resuscitation or perfusion support, ECG/Osborn assessment, glucose/electrolyte/potassium/ABG labs, secondary-cause review for trauma, toxin, intoxication, sepsis, myxedema/hypothyroidism, TSH, free thyroxine, or cortisol, and cardiac-arrest escalation with CPR, defibrillation, ECMO, ECLS, VA-ECMO, or extracorporeal support",
    },
    {
      name: "severe_hypothermia_treatment_safety",
      label: "Severe hypothermia arrest safety",
      applies: requiresSevereHypothermiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereHypothermiaTreatmentSafetyCheck,
      issue:
        "severe hypothermia safety checks must include afterdrop or rewarming-collapse prevention with gentle handling, thorax-focused warming, or avoiding extremity-first rewarming, temperature-dependent ACLS review for 30 C, deferred repeated defibrillation, epinephrine, vasopressor, or ACLS medications, perfusing-rhythm safety with pulse check, ultrasound, bradycardia-expected, CPR avoidance, or CPR only for nonperfusing rhythm, ECMO, ECLS, extracorporeal rewarming, rewarm-before-termination, hyperkalemia, or potassium >12 review, and secondary-cause review for hypoglycemia, myxedema, sepsis, trauma, or toxin exposure",
    },
    {
      name: "drowning_time_critical_actions",
      label: "Drowning oxygenation and observation actions",
      applies: requiresDrowningSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDrowningTimeCriticalActions,
      issue:
        "drowning time-critical actions must include airway/breathing support such as rescue breaths, bag-valve ventilation, intubation, or ventilation, oxygenation with supplemental or high-flow oxygen and SpO2 monitoring, circulation/resuscitation with pulse, CPR, cardiac monitoring, IV access, hypotension, or resuscitation planning, respiratory monitoring with SpO2, pulse oximetry, or respiratory exam, indicated respiratory workup with lung exam, ABG, chest x-ray, persistent hypoxemia, or progressive respiratory symptoms, wet-clothing removal, rewarming or normothermia/core temperature stabilization, trauma or cervical-spine review for diving, head trauma, or C-spine risk, observation such as 4-8 hours, and escalation/admission/ICU/transfer/assisted ventilation planning for ongoing hypoxia",
    },
    {
      name: "drowning_treatment_safety",
      label: "Drowning delayed respiratory safety",
      applies: requiresDrowningSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDrowningTreatmentSafetyCheck,
      issue:
        "drowning safety checks must include avoidance of routine prophylactic antibiotics or corticosteroids unless clinical infection, sepsis, or gross contamination is present, observation duration such as 4-8 hours, discharge stability criteria with asymptomatic/stable status, normal respiratory exam, return precautions, and SpO2 >=95%, oxygen safety with SpO2 90/92-96%, high-flow oxygen, or avoidance of hyperoxia, targeted cervical-spine immobilization only for diving/fall/head trauma/C-spine risk without delaying airway care, delayed respiratory deterioration, pulmonary-edema, ARDS, or increased-work-of-breathing monitoring, underlying-cause review for seizure, hypoglycemia, arrhythmia, long-QT, or intoxication, and aspiration prevention with recovery position, lateral decubitus, vomiting, or aspiration precautions",
    },
    {
      name: "heat_stroke_time_critical_actions",
      label: "Heat stroke emergency actions",
      applies: requiresHeatStrokeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHeatStrokeTimeCriticalActions,
      issue:
        "heat stroke time-critical actions must include rectal, esophageal, bladder, or core temperature-probe confirmation, immediate rapid or aggressive cooling with a goal such as within 30 minutes, specific cooling modality such as cold/ice-water immersion, cool-water immersion, evaporative cooling, spray/fan, ice bath, or whole-body cooling, airway/breathing support with oxygen, ventilation, or intubation as needed, circulation/hemodynamic support for hypotension or resuscitation, isotonic saline/normal saline/IV-fluid replacement, and EMS, ICU, transfer, critical-care, or organ-failure escalation",
    },
    {
      name: "heat_stroke_treatment_safety",
      label: "Heat stroke treatment safety",
      applies: requiresHeatStrokeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHeatStrokeTreatmentSafetyCheck,
      issue:
        "heat stroke safety checks must include cooling endpoint or overcooling prevention, rhabdomyolysis, renal, liver, electrolyte, or coagulation monitoring, avoidance of antipyretic-centered management, and sepsis, malignant hyperthermia, serotonin syndrome, or other dangerous hyperthermia differential review",
    },
    {
      name: "serotonin_syndrome_time_critical_actions",
      label: "Serotonin syndrome emergency actions",
      applies: requiresSerotoninSyndromeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSerotoninSyndromeTimeCriticalActions,
      issue:
        "serotonin syndrome time-critical actions must include stopping serotonergic or offending agents, oxygen or SpO2 support with goal saturation such as >=94%, IV fluids/crystalloids for volume depletion, vital-sign/cardiac monitoring and autonomic-instability management, benzodiazepine or chemical sedation, active/external cooling or hyperthermia control, cyproheptadine consideration, poison-center/toxicology consultation, and ICU, intubation, or nondepolarizing paralysis escalation for severe disease",
    },
    {
      name: "serotonin_syndrome_treatment_safety",
      label: "Serotonin syndrome treatment safety",
      applies: requiresSerotoninSyndromeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSerotoninSyndromeTreatmentSafetyCheck,
      issue:
        "serotonin syndrome safety checks must include differential review for NMS, malignant hyperthermia, anticholinergic, sympathomimetic, or sepsis mimics, Hunter-style diagnostic confirmation using clonus, hyperreflexia, hypertonia, or neuromuscular excitation, recent serotonergic exposure or medication-change timing, avoidance of physical-restraint or antipyretic-centered management, severe-hyperthermia planning for intubation, mechanical ventilation, neuromuscular blockade, nondepolarizing paralysis, or temperature above 41 C, and monitoring for rhabdomyolysis, CK, renal injury, electrolytes, seizure, or AKI",
    },
    {
      name: "neuroleptic_malignant_syndrome_time_critical_actions",
      label: "Neuroleptic malignant syndrome emergency actions",
      applies: requiresNeurolepticMalignantSyndromeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNeurolepticMalignantSyndromeTimeCriticalActions,
      issue:
        "neuroleptic malignant syndrome time-critical actions must include stopping dopamine-antagonist, neuroleptic, or antipsychotic agents, ICU or intensive-care admission, close vital-sign/cardiac/telemetry monitoring and supportive care, IV fluids or hydration for volume deficit, electrolyte/hyperkalemia/metabolic-acidosis correction, cardiorespiratory support for cardiac dysrhythmia, respiratory failure, mechanical ventilation, or ventilatory support, active cooling or hyperthermia control, bromocriptine, amantadine, dantrolene, or dopamine-agonist therapy consideration, CK/creatine-kinase and rhabdomyolysis monitoring, and renal/AKI/myoglobinuria complication monitoring",
    },
    {
      name: "neuroleptic_malignant_syndrome_treatment_safety",
      label: "Neuroleptic malignant syndrome treatment safety",
      applies: requiresNeurolepticMalignantSyndromeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNeurolepticMalignantSyndromeTreatmentSafetyCheck,
      issue:
        "neuroleptic malignant syndrome safety checks must include differential review for serotonin syndrome, malignant hyperthermia, heat stroke, CNS infection, meningitis, or sympathomimetic mimics, dopamine-antagonist exposure, antipsychotic exposure, or dopamine-agonist withdrawal timing, lead-pipe rigidity, decreased-reflex, slower-onset, or clonus/hyperreflexia distinction from serotonin syndrome, antipsychotic rechallenge or restart prevention with waiting, lower-potency, or avoid-rechallenge planning, and bromocriptine, amantadine, dantrolene, ECT, liver, or psychosis medication-safety review",
    },
    {
      name: "cauda_equina_time_critical_actions",
      label: "Cauda equina MRI and escalation",
      applies: requiresCaudaEquinaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCaudaEquinaTimeCriticalActions,
      issue:
        "cauda equina time-critical actions must include emergency lumbar MRI or lumbosacral MRI, bladder dysfunction or urinary retention assessment plus bladder scan/post-void residual PVR, saddle/perianal sensory exam, anal/rectal tone or bulbocavernosus/anal reflex, lower-limb motor/sensory/reflex exam, urgent neurosurgery/orthopedic-spine consultation, and surgical decompression planning",
    },
    {
      name: "cauda_equina_delay_safety",
      label: "Cauda equina delay prevention",
      applies: requiresCaudaEquinaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCaudaEquinaDelaySafetyCheck,
      issue:
        "cauda equina safety checks must document bladder, bowel, saddle, sexual, or progressive neurologic red flags, avoid delayed outpatient or conservative low-back-pain management, and review spinal infection, malignancy, trauma, stenosis, or other compressive causes",
    },
    {
      name: "metastatic_spinal_cord_compression_time_critical_actions",
      label: "Metastatic spinal cord compression emergency actions",
      applies: requiresMetastaticSpinalCordCompressionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMetastaticSpinalCordCompressionTimeCriticalActions,
      issue:
        "metastatic spinal cord compression time-critical actions must include immediate MSCC coordinator, acute oncology, MSCC service, or spine surgeon contact, urgent MRI spine with whole-spine imaging within 24 hours, dexamethasone 16 mg or equivalent parenteral steroid planning for neurologic signs, immobilization or external spinal-support precautions plus spinal-stability assessment, and MSCC MDT treatment planning with urgent surgical decompression, stabilization, or radiotherapy within 24 hours",
    },
    {
      name: "metastatic_spinal_cord_compression_treatment_safety",
      label: "Metastatic spinal cord compression treatment safety",
      applies: requiresMetastaticSpinalCordCompressionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMetastaticSpinalCordCompressionTreatmentSafetyCheck,
      issue:
        "metastatic spinal cord compression safety checks must include serial neurologic monitoring plus bladder, bowel, or worsening-weakness surveillance, steroid safety with glucose monitoring, PPI protection, taper or discontinuation if MSCC is ruled out, imaging safeguards such as CT if MRI is contraindicated and not using plain x-ray to rule out MSCC, and spinal stability or SINS assessment plus prognosis, Tokuhashi, surgical suitability, or radiotherapy-within-24-hours treatment review",
    },
    {
      name: "open_fracture_time_critical_actions",
      label: "Open fracture antibiotics and orthoplastic actions",
      applies: requiresOpenFractureSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOpenFractureTimeCriticalActions,
      issue:
        "open fracture time-critical actions must include immediate prophylactic IV antibiotics such as cefazolin, cefuroxime, cephalosporin, gentamicin, or broad-spectrum antibiotics, saline-soaked, sterile, wet, or occlusive dressing or covered wound with no ED irrigation, neurovascular assessment with pulse, motor, sensory, circulation, or vascular-injury review, and urgent orthopedic, orthopaedic, plastic-surgery, orthoplastic, wound-excision, debridement, fixation, or soft-tissue-cover planning",
    },
    {
      name: "open_fracture_treatment_safety",
      label: "Open fracture tetanus and debridement safety",
      applies: requiresOpenFractureSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOpenFractureTreatmentSafetyCheck,
      issue:
        "open fracture safety checks must include tetanus vaccination, Tdap, TIG, tetanus immune globulin, or immunization review, avoidance of ED irrigation before wound excision with saline-soaked or occlusive dressing, debridement or wound-excision timing and transfer planning such as immediate highly-contaminated wound excision, 12-hour high-energy, 24-hour other open-fracture, 72-hour soft-tissue cover, major trauma centre, or orthoplastic centre review, and vascular or compartment monitoring with hard signs, continued blood loss, expanding hematoma, devascularized limb, neurovascular serial assessment, or compartment syndrome",
    },
    {
      name: "acute_compartment_syndrome_time_critical_actions",
      label: "Acute compartment syndrome emergency actions",
      applies: requiresAcuteCompartmentSyndromeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteCompartmentSyndromeTimeCriticalActions,
      issue:
        "acute compartment syndrome time-critical actions must include pain-out-of-proportion, passive-stretch, tense-compartment, pulse, capillary-refill, neurovascular, or serial limb exam, intracompartmental pressure, compartment pressure, delta pressure, diastolic pressure, pressure measurement, or pressure monitoring when diagnosis is uncertain, urgent orthopedic, orthopaedic, surgery, surgeon, or trauma-surgery consultation, specific fasciotomy, compartment release, complete decompression, surgical decompression, operative decompression, or urgent decompression planning, and temporizing removal or release of cast, splint, dressing, or circumferential compression with heart-level limb positioning and blood-pressure support",
    },
    {
      name: "acute_compartment_syndrome_treatment_safety",
      label: "Acute compartment syndrome treatment safety",
      applies: requiresAcuteCompartmentSyndromeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteCompartmentSyndromeTreatmentSafetyCheck,
      issue:
        "acute compartment syndrome safety checks must include explicit do-not-delay, emergent, immediate, urgent, or within-1-hour surgery planning, assessment of regional anesthesia, sedation, analgesia, consciousness, unable-to-assess status, or serial reassessment because symptoms can be masked, complication review for ischemia, muscle necrosis, nerve injury, limb loss, rhabdomyolysis, hyperkalemia, AKI, or renal failure, and cause review for fracture, crush injury, burn, cast, tight dressing, vascular injury, or reperfusion",
    },
    {
      name: "acute_limb_ischemia_time_critical_actions",
      label: "Acute limb ischemia emergency actions",
      applies: requiresAcuteLimbIschemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteLimbIschemiaTimeCriticalActions,
      issue:
        "acute limb ischemia time-critical actions must include pulse, Doppler, motor, sensory, 6 Ps, or Rutherford limb viability assessment, immediate IV unfractionated heparin or anticoagulation planning, and urgent vascular surgery, endovascular, thrombolysis, thrombectomy, embolectomy, bypass, or revascularization escalation",
    },
    {
      name: "acute_limb_ischemia_treatment_safety",
      label: "Acute limb ischemia treatment safety",
      applies: requiresAcuteLimbIschemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteLimbIschemiaTreatmentSafetyCheck,
      issue:
        "acute limb ischemia safety checks must include heparin, thrombolysis, bleeding, platelet, recent-surgery, or other anticoagulation contraindication review, irreversible limb, Rutherford III, compartment-syndrome, fasciotomy, or reperfusion-injury monitoring, and embolic, thrombotic, aneurysm, atrial-fibrillation, trauma, or vascular-access cause review",
    },
    {
      name: "testicular_torsion_time_critical_actions",
      label: "Testicular torsion emergency actions",
      applies: requiresTesticularTorsionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTesticularTorsionTimeCriticalActions,
      issue:
        "testicular torsion time-critical actions must include acute scrotal assessment with high-clinical-suspicion, cremasteric, high-riding, Doppler, or ultrasound pathway, immediate scrotal or surgical exploration, orchiopexy, or testicular fixation, and explicit imaging-not-to-delay or immediate time-critical management",
    },
    {
      name: "testicular_torsion_treatment_safety",
      label: "Testicular torsion treatment safety",
      applies: requiresTesticularTorsionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTesticularTorsionTreatmentSafetyCheck,
      issue:
        "testicular torsion safety checks must include ischemia, 4-to-8-hour salvage, viability, orchiectomy, or time-from-onset risk, manual detorsion as non-definitive or not delaying surgery, bilateral or contralateral orchiopexy, fertility, or testicular loss planning, and epididymitis, torsion of appendage, hernia, trauma, or other acute-scrotum differential review",
    },
    {
      name: "ovarian_torsion_time_critical_actions",
      label: "Ovarian torsion emergency actions",
      applies: requiresOvarianTorsionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOvarianTorsionTimeCriticalActions,
      issue:
        "ovarian or adnexal torsion time-critical actions must include pregnancy testing or quantitative hCG, pelvic or transvaginal ultrasound with Doppler assessment, urgent OB/GYN or gynecology escalation, and specific diagnostic laparoscopy, detorsion, ovarian salvage, cystectomy, or salpingo-oophorectomy planning",
    },
    {
      name: "ovarian_torsion_treatment_safety",
      label: "Ovarian torsion treatment safety",
      applies: requiresOvarianTorsionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOvarianTorsionTreatmentSafetyCheck,
      issue:
        "ovarian or adnexal torsion safety checks must include normal Doppler flow not ruling out torsion or imaging not delaying timely intervention, ovarian preservation, detorsion, cystectomy, fertility, or oophorectomy-limitation planning, and ectopic pregnancy, appendicitis, PID, ruptured cyst, tubo-ovarian abscess, or other acute-pelvic-pain differential review",
    },
    {
      name: "spinal_epidural_abscess_time_critical_actions",
      label: "Spinal epidural abscess emergency actions",
      applies: requiresSpinalEpiduralAbscessSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSpinalEpiduralAbscessTimeCriticalActions,
      issue:
        "spinal epidural abscess time-critical actions must include urgent gadolinium or contrast MRI spine or whole-spine imaging, two sets of blood cultures, ESR and CRP, source culture, biopsy, aspiration, or intraoperative microbiology workup, empiric IV antibiotics with vancomycin, ceftriaxone, cefepime, ceftazidime, meropenem, or equivalent coverage when neurologic compromise or sepsis is present, immediate neurosurgery or spine-surgery consultation, and surgical drainage, surgical decompression, laminectomy, operative drainage, or epidural-abscess evacuation",
    },
    {
      name: "spinal_epidural_abscess_red_flags",
      label: "Spinal epidural abscess red flags",
      applies: requiresSpinalEpiduralAbscessSafetyCheck,
      fieldName: "clinical_red_flags",
      validator: hasSpinalEpiduralAbscessRedFlags,
      issue:
        "spinal epidural abscess red flags must include atraumatic back pain or radicular pain plus fever, focal spine tenderness, or percussion tenderness, plus neurologic deficit, weakness, sensory change, saddle anesthesia, or bowel/bladder dysfunction, and infection risk such as sepsis, bacteremia, diabetes, IVDU, immunosuppression, recent infection, or recent spinal procedure",
    },
    {
      name: "spinal_epidural_abscess_treatment_safety",
      label: "Spinal epidural abscess treatment safety",
      applies: requiresSpinalEpiduralAbscessSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSpinalEpiduralAbscessTreatmentSafetyCheck,
      issue:
        "spinal epidural abscess safety checks must include serial neurologic exams, neurologic deficit or bowel/bladder dysfunction monitoring, sepsis or hemodynamic-instability monitoring, bacteremia, endocarditis, staphylococcal, or source-risk review, diabetes, IVDU, immunosuppression, or recent spinal procedure review, blood-culture-before-antibiotics planning, biopsy or aspiration planning when stable, and do-not-delay empiric antibiotics planning for unstable patient, sepsis, or neurologic compromise",
    },
    {
      name: "spinal_epidural_abscess_lp_drainage_antibiotic_safety",
      label: "Spinal epidural abscess LP, drainage, and antibiotic safety",
      applies: requiresSpinalEpiduralAbscessSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSpinalEpiduralAbscessLpDrainageAntibioticSafetyCheck,
      issue:
        "spinal epidural abscess safety checks must include avoiding lumbar puncture/LP or noting LP contraindication and cord-herniation risk, immediate neurosurgery, surgical drainage, decompression, or drainage planning for neurologic compromise, weakness, paresis, or bowel/bladder dysfunction, and empiric antibiotic coverage for staphylococcus/MRSA plus anaerobe, gram-negative, vancomycin, ceftriaxone, cefepime, ceftazidime, or meropenem risk",
    },
    {
      name: "septic_arthritis_time_critical_actions",
      label: "Septic arthritis aspiration and drainage",
      applies: requiresSepticArthritisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSepticArthritisTimeCriticalActions,
      issue:
        "septic arthritis time-critical actions must include urgent arthrocentesis, joint aspiration, tap, synovial fluid, or synovial aspiration, synovial WBC, leukocyte, cell count, Gram stain, culture, microscopy, or crystal studies, blood cultures, CRP, ESR, leukocytosis, or inflammatory marker assessment, empiric antibiotics such as vancomycin or ceftriaxone, orthopedic or orthopaedic surgery escalation, and specific arthroscopic lavage, arthroscopic irrigation, arthroscopy, arthrotomy, joint drainage, irrigation and debridement, surgical drainage, surgical washout, open revision, or repeated/serial aspiration source-control planning",
    },
    {
      name: "septic_arthritis_treatment_safety",
      label: "Septic arthritis treatment safety",
      applies: requiresSepticArthritisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSepticArthritisTreatmentSafetyCheck,
      issue:
        "septic arthritis safety checks must include gout, pseudogout, crystals, not-exclude, crystals-do-not-exclude, or still-possible review, antibiotic timing with aspiration or blood cultures before antibiotics while not delaying empiric antibiotics in sepsis or unstable patients, pathogen risk review for MRSA, Staphylococcus, gonococcal, Gram-negative, IVDU, immunocompromised, vancomycin, or ceftriaxone coverage, and complication or source review for bacteremia, endocarditis, osteomyelitis, prosthetic joint, sepsis, source, or surgery",
    },
    {
      name: "upper_gi_bleed_time_critical_actions",
      label: "Upper GI bleed resuscitation and endoscopy",
      applies: requiresUpperGiBleedSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasUpperGiBleedTimeCriticalActions,
      issue:
        "upper GI bleeding time-critical actions must include hemodynamic resuscitation with large-bore IV access, shock, or massive transfusion planning, CBC, hemoglobin, INR, type and screen, crossmatch, PRBC, restrictive transfusion, or transfusion assessment, early endoscopy, EGD, endoscopic hemostasis, gastroenterology, GI consult, or within-24-hours endoscopy planning, and PPI, proton pump inhibitor, octreotide, terlipressin, somatostatin, vasoactive therapy, ceftriaxone, or antibiotic planning for ulcer or suspected variceal bleeding",
    },
    {
      name: "upper_gi_bleed_treatment_safety",
      label: "Upper GI bleed airway and reversal safety",
      applies: requiresUpperGiBleedSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasUpperGiBleedTreatmentSafetyCheck,
      issue:
        "upper GI bleeding safety checks must include airway, aspiration, active hematemesis, vomiting blood, intubation, or altered mental status planning, anticoagulant, antiplatelet, warfarin, DOAC, INR, platelet, coagulopathy, or reversal review, variceal, cirrhosis, portal hypertension, TIPS, balloon tamponade, stent, or rescue therapy review, and rebleeding, repeat endoscopy, ICU, unstable, shock, or risk-stratification disposition monitoring",
    },
    {
      name: "upper_gi_bleed_risk_endoscopy_medication_safety",
      label: "Upper GI bleed risk and medication safety",
      applies: requiresUpperGiBleedSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasUpperGiBleedRiskEndoscopyMedicationSafetyCheck,
      issue:
        "upper GI bleeding risk, endoscopy, and medication safety checks must include Blatchford or Rockall risk scoring or low-risk disposition, immediate-after-resuscitation or within-24-hours endoscopy timing, platelet, FFP, PCC, warfarin, active-bleeding, or coagulation product review, PPI or acid-suppression timing around endoscopy for suspected non-variceal bleeding, and variceal terlipressin, antibiotic, band ligation, cyanoacrylate, or TIPS planning",
    },
    {
      name: "acute_cholecystitis_time_critical_actions",
      label: "Acute cholecystitis source control",
      applies: requiresAcuteCholecystitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteCholecystitisTimeCriticalActions,
      issue:
        "acute cholecystitis time-critical actions must include Tokyo, severity, grade, organ dysfunction, Charlson, CCI, ASA, or ASA-PS risk assessment, broad-spectrum antibiotics plus blood culture, bile culture, ceftriaxone, piperacillin, or culture planning, RUQ ultrasound, CT, HIDA scan, sonographic Murphy, gallbladder wall, or pericholecystic imaging assessment, and early laparoscopic cholecystectomy, Lap-C, cholecystectomy, gallbladder drainage, cholecystostomy, PTGBD, percutaneous, or drainage source-control planning",
    },
    {
      name: "acute_cholecystitis_treatment_safety",
      label: "Acute cholecystitis severity and bile-duct safety",
      applies: requiresAcuteCholecystitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteCholecystitisTreatmentSafetyCheck,
      issue:
        "acute cholecystitis safety checks must include high-risk surgery or drainage planning for ASA-PS, Charlson, high risk, percutaneous gallbladder drainage, PTGBD, or cholecystostomy, complication review for emphysematous, gangrenous, perforation, peritonitis, sepsis, or shock, bile-duct injury prevention with critical view of safety, CVS, bail-out, subtotal cholecystectomy, conversion, bile leak, or common bile duct review, and differential review for cholangitis, choledocholithiasis, gallstone pancreatitis, pancreatitis, hepatitis, peptic ulcer, or myocardial infarction",
    },
    {
      name: "acute_cholangitis_time_critical_actions",
      label: "Acute cholangitis antibiotics and drainage",
      applies: requiresAcuteCholangitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteCholangitisTimeCriticalActions,
      issue:
        "acute cholangitis time-critical actions must include immediate broad-spectrum antibiotics and supportive care, blood culture, bile culture, WBC, CRP, bilirubin, LFT, or liver function assessment, ultrasound, CT, MRCP, biliary dilation, common bile duct, stone, stricture, or obstruction imaging, gastroenterology, endoscopy, ERCP, interventional radiology, PTBD, percutaneous transhepatic, transfer, or advanced-center access planning, specific ERCP, endoscopic biliary drainage, endoscopic nasobiliary drainage, biliary decompression, biliary stent, PTBD, or percutaneous transhepatic biliary drainage route planning, and sepsis, shock, fluid, vasopressor, respiratory, circulatory, organ-support, or ICU escalation",
    },
    {
      name: "acute_cholangitis_treatment_safety",
      label: "Acute cholangitis severity and drainage safety",
      applies: requiresAcuteCholangitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteCholangitisTreatmentSafetyCheck,
      issue:
        "acute cholangitis safety checks must include Tokyo severity or organ dysfunction review for shock, disturbance of consciousness, acute dyspnea, renal dysfunction, DIC, or severe disease, early or emergency biliary drainage timing with do-not-delay, within-24 or within-48-hours, transfer, or advanced-center planning, ERCP procedure-risk review for anticoagulant, coagulopathy, sphincterotomy, pancreatitis, failed ERCP, altered anatomy, PTBD, or percutaneous drainage alternatives, and source-control or differential review for cholecystitis, pancreatitis, gallstone pancreatitis, malignant obstruction, stone, or bile culture",
    },
    {
      name: "acute_pancreatitis_time_critical_actions",
      label: "Acute pancreatitis fluids and severity",
      applies: requiresAcutePancreatitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcutePancreatitisTimeCriticalActions,
      issue:
        "acute pancreatitis time-critical actions must include early goal-directed crystalloid or lactated Ringer fluid resuscitation, analgesia, antiemetic, nausea, opioid, or pain-control support, lipase, ALT, LFT, ultrasound, gallstone, triglyceride, or calcium etiology assessment, and BUN, hematocrit, severity, oxygen, shock, renal, organ-failure, or ICU monitoring",
    },
    {
      name: "acute_pancreatitis_treatment_safety",
      label: "Acute pancreatitis ERCP, antibiotics, and nutrition",
      applies: requiresAcutePancreatitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcutePancreatitisTreatmentSafetyCheck,
      issue:
        "acute pancreatitis safety checks must include ERCP or biliary obstruction review for cholangitis, jaundice, no-cholangitis, or without-cholangitis scenarios, avoidance of prophylactic antibiotics in sterile necrosis with antibiotic use reserved for infected necrosis or extrapancreatic infection, oral or enteral feeding, NG tube, TPN, parenteral, or nutrition planning, and infected necrosis, walled-off necrosis, delayed drainage, 4-week, or step-up procedure timing review",
    },
    {
      name: "small_bowel_obstruction_time_critical_actions",
      label: "Small bowel obstruction emergency actions",
      applies: requiresSmallBowelObstructionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSmallBowelObstructionTimeCriticalActions,
      issue:
        "small bowel obstruction time-critical actions must include bowel rest, NPO, nil per os, NG tube, nasogastric suction, or decompression planning, IV crystalloid, fluid, dehydration, electrolyte, potassium, or urine output resuscitation, CT abdomen, transition point, closed-loop, free fluid, ischemia, or strangulation assessment, and urgent surgery, surgeon, surgical consult, operative, exploration, or laparotomy escalation",
    },
    {
      name: "small_bowel_obstruction_treatment_safety",
      label: "Small bowel obstruction strangulation safety",
      applies: requiresSmallBowelObstructionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSmallBowelObstructionTreatmentSafetyCheck,
      issue:
        "small bowel obstruction safety checks must include strangulation or ischemia red-flag review for peritonitis, continuous pain, fever, leukocytosis, acidosis, lactate, or closed-loop obstruction, nonoperative management limits with serial exams, water-soluble contrast or Gastrografin, complete obstruction, failure to resolve, conservative management, or 72-hour reassessment, perforation, free air, infarction, gangrene, sepsis, broad-spectrum antibiotics, or antibiotic planning, and aspiration or etiology review for vomiting, adhesions, hernia, incarcerated hernia, volvulus, tumor, or malignancy",
    },
    {
      name: "pediatric_midgut_volvulus_time_critical_actions",
      label: "Pediatric midgut volvulus imaging and surgery actions",
      applies: requiresPediatricMidgutVolvulusSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPediatricMidgutVolvulusTimeCriticalActions,
      issue:
        "pediatric midgut volvulus time-critical actions must include urgent fluoroscopy upper GI, UGI, duodenal-jejunal junction, or ligament-of-Treitz imaging to evaluate malrotation, immediate pediatric surgery or pediatric surgeon escalation, specific Ladd procedure, operative exploration, laparotomy, bowel or volvulus detorsion, or bowel-resection planning, NPO, IV fluids, resuscitation, NG tube, nasogastric, or orogastric decompression planning, and bowel ischemia, bowel necrosis, lactate, acidosis, peritonitis, shock, serial abdominal exam, or complication monitoring",
    },
    {
      name: "pediatric_midgut_volvulus_treatment_safety",
      label: "Pediatric midgut volvulus delay and imaging-limit safety",
      applies: requiresPediatricMidgutVolvulusSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPediatricMidgutVolvulusTreatmentSafetyCheck,
      issue:
        "pediatric midgut volvulus safety checks must include avoiding reassurance or treatment as benign reflux or gastroenteritis, recognition that a normal abdominal radiograph or x-ray does not exclude malrotation, imaging-limitation review for false negative, equivocal UGI, SMV/SMA, whirlpool, contrast enema, or less-direct imaging findings, do-not-delay urgent surgery or bowel ischemia/necrosis escalation, and aspiration, dehydration, electrolyte, glucose, or hypoglycemia safeguards",
    },
    {
      name: "necrotizing_enterocolitis_time_critical_actions",
      label: "Necrotizing enterocolitis emergency actions",
      applies: requiresNecrotizingEnterocolitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNecrotizingEnterocolitisTimeCriticalActions,
      issue:
        "necrotizing enterocolitis time-critical actions must include immediate feeding cessation, bowel rest, NPO, or stopping enteral feeds, gastric decompression with NG/OG tube, nasogastric, or suction, IV fluid resuscitation, NICU support, parenteral nutrition, PN, or TPN planning, broad-spectrum antibiotics such as ampicillin/gentamicin, piperacillin-tazobactam, or anaerobic coverage, and serial abdominal radiographs, CBC/platelets, blood culture, blood gas, or serial abdominal exam monitoring",
    },
    {
      name: "necrotizing_enterocolitis_treatment_safety",
      label: "Necrotizing enterocolitis surgery and complication safety",
      applies: requiresNecrotizingEnterocolitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNecrotizingEnterocolitisTreatmentSafetyCheck,
      issue:
        "necrotizing enterocolitis safety checks must include early pediatric or neonatal surgery consultation, perforation, pneumoperitoneum, free air, peritonitis, or portal venous gas surgery triggers, worsening acidosis, thrombocytopenia, blood gas, shock, lactate, or clinical deterioration despite support, isolation, infection-control, cluster, or outbreak precautions, and stricture, short bowel, intestinal failure, parenteral nutrition, or trophic-feed follow-up planning",
    },
    {
      name: "acute_appendicitis_time_critical_actions",
      label: "Acute appendicitis diagnostics and surgery",
      applies: requiresAcuteAppendicitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteAppendicitisTimeCriticalActions,
      issue:
        "acute appendicitis time-critical actions must include clinical risk score, Alvarado, AIR score, Adult Appendicitis Score, ultrasound, CT, MRI, or imaging assessment, urgent surgery, surgeon, acute-care surgery, or surgical consultation escalation, specific appendectomy, appendicectomy, laparoscopic appendectomy, laparoscopy, or appendiceal source-control pathway, perioperative, preoperative, broad-spectrum, ceftriaxone, metronidazole, cefoxitin, piperacillin, or antibiotic planning, and complicated appendicitis assessment for perforation, peritonitis, abscess, phlegmon, drainage, sepsis, or source control",
    },
    {
      name: "acute_appendicitis_treatment_safety",
      label: "Acute appendicitis nonoperative and source-control safety",
      applies: requiresAcuteAppendicitisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteAppendicitisTreatmentSafetyCheck,
      issue:
        "acute appendicitis safety checks must include nonoperative selection limits for uncomplicated disease, appendicolith, antibiotics-first, selected patients, shared decision, or recurrence risk, complicated appendicitis source-control or antibiotic safety for abscess drainage, percutaneous drainage, postoperative antibiotic short course, 2-3 days, or source control, special population or differential review for pregnancy, pediatric, older, immunocompromised, gynecologic, ectopic, terminal ileitis, or renal colic scenarios, and peritonitis, perforation, rupture, sepsis, shock, diffuse, or generalized peritonitis escalation",
    },
    {
      name: "acute_mesenteric_ischemia_time_critical_actions",
      label: "Acute mesenteric ischemia emergency actions",
      applies: requiresAcuteMesentericIschemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteMesentericIschemiaTimeCriticalActions,
      issue:
        "acute mesenteric ischemia time-critical actions must include CTA or CT angiography, resuscitation with lactate, acidosis, shock, or fluid monitoring, early broad-spectrum antibiotics, therapeutic heparin or anticoagulation, urgent surgery, vascular surgery, interventional radiology, surgeon, or surgical consultation escalation, and specific revascularization, endovascular intervention, embolectomy, laparotomy, thrombectomy, thrombolysis, SMA bypass or stent, or bowel-resection source-control planning",
    },
    {
      name: "acute_mesenteric_ischemia_treatment_safety",
      label: "Acute mesenteric ischemia treatment safety",
      applies: requiresAcuteMesentericIschemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteMesentericIschemiaTreatmentSafetyCheck,
      issue:
        "acute mesenteric ischemia safety checks must include heparin or anticoagulation bleeding contraindication review, bowel viability, necrosis, peritonitis, damage-control, second-look, or short-bowel planning, embolic, thrombotic, SMA, venous, atrial-fibrillation, low-flow, or nonocclusive cause review, and lactate limitation or do-not-delay CTA/intervention safety",
    },
    {
      name: "necrotizing_soft_tissue_infection_time_critical_actions",
      label: "Necrotizing soft tissue infection emergency actions",
      applies: requiresNecrotizingSoftTissueInfectionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNecrotizingSoftTissueInfectionTimeCriticalActions,
      issue:
        "necrotizing soft tissue infection time-critical actions must include immediate surgery, surgeon, acute-care surgery, or surgical consultation escalation, specific surgical exploration, operative debridement, fascial exploration, fasciotomy, wide excision, or necrotic-tissue excision, broad-spectrum empiric antibiotics with MRSA, gram-negative, anaerobic, vancomycin, piperacillin-tazobactam, carbapenem, cefepime, or metronidazole coverage, sepsis, shock, lactate, ICU, vasopressor, or fluid resuscitation, and explicit do-not-delay source-control or immediate time-critical management",
    },
    {
      name: "necrotizing_soft_tissue_infection_red_flags",
      label: "Necrotizing soft tissue infection red flags",
      applies: requiresNecrotizingSoftTissueInfectionSafetyCheck,
      fieldName: "clinical_red_flags",
      validator: hasNecrotizingSoftTissueInfectionRedFlags,
      issue:
        "necrotizing soft tissue infection red flags must include pain out of proportion, profound pain, rapidly progressive findings, bullae, crepitus, ecchymosis, dusky skin, skin necrosis, decreased sensation/anesthesia, or systemic toxicity",
    },
    {
      name: "necrotizing_soft_tissue_infection_treatment_safety",
      label: "Necrotizing soft tissue infection treatment safety",
      applies: requiresNecrotizingSoftTissueInfectionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNecrotizingSoftTissueInfectionTreatmentSafetyCheck,
      issue:
        "necrotizing soft tissue infection safety checks must include clindamycin, linezolid, group A strep, clostridial gas gangrene, or toxin-suppression planning, repeat, second-look, 24-to-48-hour debridement or source-control reassessment, LRINEC, imaging, or diagnostic testing not delaying surgical exploration, and shock, renal injury, coagulopathy, organ failure, amputation, diabetes, or immunocompromised risk monitoring",
    },
    {
      name: "fournier_gas_gangrene_treatment_safety",
      label: "Fournier or gas gangrene treatment safety",
      applies: requiresFournierGasGangreneSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasFournierGasGangreneTreatmentSafetyCheck,
      issue:
        "Fournier gangrene or clostridial gas gangrene safety checks must include definitive penicillin or piperacillin plus clindamycin, linezolid, protein-synthesis, or toxin-suppression planning, perineal, perianal, scrotal, urinary, fecal, urology, colorectal, foreign-body, debridement, or source-control planning, and hyperbaric oxygen/HBO not-recommended or do-not-delay resuscitation, surgery, or debridement safety",
    },
    {
      name: "ruptured_aaa_time_critical_actions",
      label: "Ruptured AAA emergency actions",
      applies: requiresRupturedAaaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasRupturedAaaTimeCriticalActions,
      issue:
        "ruptured or symptomatic abdominal aortic aneurysm time-critical actions must include immediate vascular surgery, vascular team, vascular surgeon, or regional vascular service escalation, specific EVAR, endovascular aneurysm repair, open surgical repair, operative aneurysm repair, or stent-graft repair planning, permissive hypotension or controlled restrictive resuscitation planning, blood product, crossmatch, large-bore access, or massive transfusion preparation, and bedside ultrasound, CTA, or imaging-not-to-delay strategy",
    },
    {
      name: "ruptured_aaa_treatment_safety",
      label: "Ruptured AAA treatment safety",
      applies: requiresRupturedAaaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasRupturedAaaTreatmentSafetyCheck,
      issue:
        "ruptured or symptomatic abdominal aortic aneurysm safety checks must include unstable-patient transfer, imaging, or repair-not-to-delay planning, bleeding, hemorrhage, anticoagulation, antiplatelet, or thrombolysis avoidance review, and shock, coagulopathy, hypothermia, renal injury, cardiac arrest, or abdominal compartment complication monitoring",
    },
    {
      name: "ruptured_aaa_advanced_transfer_repair_safety",
      label: "Ruptured AAA transfer and repair safety",
      applies: requiresRupturedAaaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasRupturedAaaAdvancedTransferRepairSafetyCheck,
      issue:
        "ruptured or symptomatic abdominal aortic aneurysm advanced safety checks must include immediate bedside ultrasound, regional vascular service, same-day, transfer, 30-minutes, or vascular-service coordination, EVAR, standard EVAR, complex EVAR, open repair, risk-assessment-tool, or repair-suitability review, local anaesthetic/anesthetic, anaesthesia/anesthesia, perioperative, or abdominal-compartment-syndrome planning, and permissive hypotension, restrictive fluid, restrictive approach, volume resuscitation, systolic blood pressure, or transfer resuscitation safeguards",
    },
    {
      name: "subarachnoid_hemorrhage_time_critical_actions",
      label: "Subarachnoid hemorrhage emergency actions",
      applies: requiresSubarachnoidHemorrhageSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSubarachnoidHemorrhageTimeCriticalActions,
      issue:
        "subarachnoid hemorrhage time-critical actions must include urgent non-contrast head CT, lumbar puncture, CTA, or xanthochromia pathway when CT is negative or delayed, neurosurgery, neurocritical care, or specialist transfer escalation, and blood pressure control or nimodipine planning",
    },
    {
      name: "subarachnoid_hemorrhage_treatment_safety",
      label: "Subarachnoid hemorrhage treatment safety",
      applies: requiresSubarachnoidHemorrhageSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSubarachnoidHemorrhageTreatmentSafetyCheck,
      issue:
        "subarachnoid hemorrhage safety checks must include anticoagulant, antiplatelet, INR, platelet, coagulopathy, or reversal review, rebleeding or unsecured-aneurysm blood-pressure safeguards, and hydrocephalus, vasospasm, delayed cerebral ischemia, seizure, EVD, ICU, or neurocritical complication monitoring",
    },
    {
      name: "subarachnoid_hemorrhage_advanced_aneurysm_complication_safety",
      label: "SAH aneurysm and complication safety",
      applies: requiresSubarachnoidHemorrhageSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSubarachnoidHemorrhageAdvancedAneurysmComplicationSafetyCheck,
      issue:
        "subarachnoid hemorrhage advanced safety checks must include 6-hour, 12-hour, CT-negative, specialist-neuroradiologist, lumbar-puncture, xanthochromia, or do-not-routinely-offer-LP diagnostic timing review, CTA, CT angiography, DSA, digital subtraction angiography, MRA, or without-delay aneurysm imaging, coiling, clipping, endovascular, secure-aneurysm, 24-hour, earliest-opportunity, or aneurysm-treatment planning, nimodipine route safety for enteral, IV nimodipine, hypotension, or specialist advice, and hydrocephalus, CSF drainage, CSF diversion, delayed cerebral ischemia, euvolaemia, vasopressor, TCD, or transcranial-Doppler complication management",
    },
    {
      name: "intracerebral_hemorrhage_time_critical_actions",
      label: "Intracerebral hemorrhage emergency actions",
      applies: requiresIntracerebralHemorrhageSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasIntracerebralHemorrhageTimeCriticalActions,
      issue:
        "intracerebral hemorrhage time-critical actions must include urgent noncontrast head CT or repeat imaging, acute blood-pressure control, anticoagulant or coagulopathy reversal planning, and neurocritical, neurosurgical, hydrocephalus, or ICP escalation",
    },
    {
      name: "intracerebral_hemorrhage_treatment_safety",
      label: "Intracerebral hemorrhage treatment safety",
      applies: requiresIntracerebralHemorrhageSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasIntracerebralHemorrhageTreatmentSafetyCheck,
      issue:
        "intracerebral hemorrhage safety checks must include blood-pressure target range or hypotension safeguards, reversal-agent and platelet transfusion cautions, VTE prophylaxis or anticoagulation restart planning, and hematoma expansion, intraventricular hemorrhage, hydrocephalus, seizure, or mass-effect monitoring",
    },
    {
      name: "intracerebral_hemorrhage_advanced_bp_reversal_vte_safety",
      label: "ICH advanced BP reversal and VTE safety",
      applies: requiresIntracerebralHemorrhageSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasIntracerebralHemorrhageAdvancedBpReversalVteSafetyCheck,
      issue:
        "intracerebral hemorrhage advanced safety checks must include SBP 140, 130-150, 200, 220, 60 mmHg, GCS, massive hematoma, structural cause, or mild-to-moderate blood-pressure target and exclusion review, warfarin reversal with PCC or 4-factor PCC plus IV vitamin K, DOAC reversal review for factor Xa, apixaban, rivaroxaban, andexanet, dabigatran, idarucizumab, or PCC, and proximal DVT, pulmonary embolism, IVC filter, unfractionated heparin, LMWH, or venous-thromboembolism response planning",
    },
    {
      name: "bb_ccb_overdose_time_critical_actions",
      label: "BB/CCB overdose emergency actions",
      applies: requiresBbCcbOverdoseSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasBbCcbOverdoseTimeCriticalActions,
      issue:
        "beta-blocker or calcium-channel blocker overdose time-critical actions must include ECG, EKG, telemetry, vital-sign, or cardiac monitoring, calcium, glucagon, or atropine early therapy, high-dose insulin, insulin euglycemia, hyperinsulinemia, HIE, HIET, or euglycemia therapy with explicit insulin administration, vasopressor, inotrope, epinephrine, norepinephrine, or shock support, and poison-center, toxicology, lipid-emulsion, ECMO, mechanical-circulatory-support, intra-aortic balloon, or pacing escalation",
    },
    {
      name: "bb_ccb_overdose_treatment_safety",
      label: "BB/CCB overdose treatment safety",
      applies: requiresBbCcbOverdoseSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasBbCcbOverdoseTreatmentSafetyCheck,
      issue:
        "beta-blocker or calcium-channel blocker overdose safety checks must include glucose, dextrose, hypoglycemia, and potassium monitoring during high-dose insulin euglycemia therapy, airway, intubation, seizure, benzodiazepine, wide-QRS, QRS, or sodium-bicarbonate safety review, activated-charcoal, decontamination, whole-bowel irrigation, sustained-release, or extended-release planning, and lipid-emulsion, pancreatitis, fat-overload, vasopressor, pacing, or ECMO escalation safety",
    },
    {
      name: "digoxin_toxicity_time_critical_actions",
      label: "Digoxin toxicity emergency actions",
      applies: requiresDigoxinToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDigoxinToxicityTimeCriticalActions,
      issue:
        "digoxin toxicity time-critical actions must include ECG, EKG, telemetry, rhythm, or cardiac monitoring, serum digoxin level or post-distribution concentration timing, potassium, magnesium, creatinine, renal, kidney, or electrolyte assessment, digoxin immune Fab, digoxin-specific Fab, digoxin-specific antibody, digoxin-specific antibody fragment, anti-digoxin Fab, DigiFab, or DigiBind planning, and toxicology, poison-center, atropine, lidocaine, lignocaine, or magnesium arrhythmia support",
    },
    {
      name: "digoxin_toxicity_treatment_safety",
      label: "Digoxin toxicity treatment safety",
      applies: requiresDigoxinToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDigoxinToxicityTreatmentSafetyCheck,
      issue:
        "digoxin toxicity safety checks must include potassium, magnesium, hypokalemia, or serum-potassium monitoring during Fab treatment, rebound, recurrent-toxicity, renal-failure, renal-impairment, or repeat-monitoring review, post-Fab total digoxin, serum digoxin, free-digoxin, unbound-digoxin, or unreliable-level interpretation, calcium, cardioversion, defibrillation, low-energy shock, or pacing caution, and activated-charcoal, decontamination, early-ingestion, or within-2-hour review",
    },
    {
      name: "tca_toxicity_time_critical_actions",
      label: "TCA toxicity emergency actions",
      applies: requiresTcaToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTcaToxicityTimeCriticalActions,
      issue:
        "TCA toxicity time-critical actions must include 12-lead ECG, EKG, telemetry, QRS, aVR, or cardiac monitoring, sodium bicarbonate, bicarbonate, sodium-bicarb, or alkalinization therapy, airway, ventilation, intubation, pH, blood-gas, acidosis, ABC, or ICU support, benzodiazepine, lorazepam, midazolam, diazepam, or seizure treatment, and fluids, vasopressor, norepinephrine, toxicology, poison-center, lipid-emulsion, or intralipid escalation",
    },
    {
      name: "tca_toxicity_treatment_safety",
      label: "TCA toxicity treatment safety",
      applies: requiresTcaToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTcaToxicityTreatmentSafetyCheck,
      issue:
        "TCA toxicity safety checks must include activated-charcoal, decontamination, airway-protected, within-2-hour, or ipecac-avoidance review, avoidance of physostigmine, flumazenil, class IA, class IC, class III, antiarrhythmic, or anti-dysrhythmic agents, serum pH, pH 7.5 to 7.55, sodium, hypernatremia, alkalemia, or alkalosis monitoring, continuous monitoring, observation, ICU, serial ECG, repeat ECG, 6-hour, or 24-hour disposition planning, and dialysis, hemoperfusion, serum-level, drug-level, TCA-level, not-effective, or toxicity-correlation review",
    },
    {
      name: "organophosphate_toxicity_time_critical_actions",
      label: "Organophosphate toxicity emergency actions",
      applies: requiresOrganophosphateToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOrganophosphateToxicityTimeCriticalActions,
      issue:
        "organophosphate toxicity time-critical actions must include PPE, personal-protective-equipment, clothing-removal, soap-and-water, wash, or decontamination planning, airway, oxygen, intubation, ventilation, bronchorrhea, bronchospasm, secretions, or respiratory-failure support, atropine, atropinization, doubling doses, bronchoconstriction, secretions-clear, or dry-secretions endpoint, pralidoxime, 2-PAM, oxime, aging, or acetylcholinesterase reactivation planning, and seizure, benzodiazepine, diazepam, lorazepam, midazolam, ICU, cardiac monitoring, poison-center, toxicology, or toxicologist escalation",
    },
    {
      name: "organophosphate_toxicity_treatment_safety",
      label: "Organophosphate toxicity treatment safety",
      applies: requiresOrganophosphateToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOrganophosphateToxicityTreatmentSafetyCheck,
      issue:
        "organophosphate toxicity safety checks must include succinylcholine avoidance or prolonged-paralysis airway safety, cholinesterase, RBC AChE, BuChE, arterial-blood-gas, treat-before-labs, or do-not-wait laboratory safety, atropine-before-pralidoxime, pralidoxime infusion, slow-infusion, rapid-administration, or cardiac-arrest risk review, ICU, 48-hour, recurring, intermediate-syndrome, tidal-volume, negative-inspiratory-force, respiratory-failure, or ventilatory-support monitoring, and decontamination not delaying care plus clothing, PPE, soap-and-water, vomit, or bodily-secretion contamination precautions",
    },
    {
      name: "guillain_barre_time_critical_actions",
      label: "Guillain-Barre respiratory and immunotherapy actions",
      applies: requiresGuillainBarreSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasGuillainBarreTimeCriticalActions,
      issue:
        "Guillain-Barre syndrome time-critical actions must include admission or neurology evaluation with lumbar puncture, nerve conduction study, NCS, hospital, or hospitalization planning, serial respiratory monitoring with FVC, forced vital capacity, vital capacity, NIF, negative inspiratory force, MIP, or MEP, IVIG, intravenous immunoglobulin, plasma exchange, plasmapheresis, or PLEX disease-modifying therapy, and ICU, airway, intubation, mechanical ventilation, respiratory-failure, ventilation, or bulbar escalation",
    },
    {
      name: "guillain_barre_treatment_safety",
      label: "Guillain-Barre treatment safety",
      applies: requiresGuillainBarreSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasGuillainBarreTreatmentSafetyCheck,
      issue:
        "Guillain-Barre syndrome safety checks must include avoidance of corticosteroids or glucocorticoids because steroids are not recommended, avoiding sequential or combined IVIG and plasma exchange unless specifically justified because combination therapy is not beneficial, autonomic monitoring for dysautonomia, blood pressure, bradycardia, arrhythmia, ECG, telemetry, or cardiac monitoring, and supportive safety for venous thrombosis, VTE, DVT, aspiration, swallow, bowel, pain control, rehabilitation, skin breakdown, or pressure injury",
    },
    {
      name: "myasthenic_crisis_time_critical_actions",
      label: "Myasthenic crisis respiratory emergency actions",
      applies: requiresMyasthenicCrisisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMyasthenicCrisisTimeCriticalActions,
      issue:
        "myasthenic crisis time-critical actions must include respiratory function monitoring with vital capacity, VC, FVC, NIF, negative inspiratory force, PEF, peak expiratory flow, or serial vital capacity, ICU, intensive care, airway, elective intubation, intubation, mechanical ventilation, or ventilation support, IVIG, intravenous immunoglobulin, PLEX, plasma exchange, or plasmapheresis disease-modifying therapy, and precipitant review for infection, pneumonia, aspiration, surgery, pregnancy, medication, trigger, or medication discontinuation",
    },
    {
      name: "myasthenic_crisis_treatment_safety",
      label: "Myasthenic crisis treatment safety",
      applies: requiresMyasthenicCrisisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMyasthenicCrisisTreatmentSafetyCheck,
      issue:
        "myasthenic crisis safety checks must include medication avoidance or caution for aminoglycosides, gentamicin, streptomycin, macrolides, erythromycin, fluoroquinolones, quinolones, ciprofloxacin, beta blockers, calcium channel blockers, magnesium, phenytoin, procainamide, or quinidine, acetylcholinesterase inhibitor or pyridostigmine holding/lowering/discontinuation with excessive pulmonary secretion or cholinergic-crisis review, steroid or prednisone initiation only with hospital respiratory monitoring because worsening can occur especially with bulbar symptoms, NIV, BiPAP, hypercapnia, PCO2, tachypnea, work-of-breathing, aspiration, or bulbar-weakness intubation safety, and neuromuscular blocker, paralytic, succinylcholine, vecuronium, nondepolarizing, or reduced-dose airway medication safety",
    },
    {
      name: "botulism_time_critical_actions",
      label: "Botulism antitoxin and ventilatory actions",
      applies: requiresBotulismSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasBotulismTimeCriticalActions,
      issue:
        "botulism time-critical actions must include immediate state health department, public health, CDC Clinical Botulism Service, or Infant Botulism Treatment consultation, specific antitoxin planning with heptavalent botulism antitoxin, botulinum antitoxin heptavalent, BabyBIG, botulism immune globulin, or human botulism immune globulin, respiratory monitoring, respiratory function, ICU, intensive care, mechanical ventilation, ventilator, or ventilatory support, and serum, stool, food sample, wound, specimen, source, or toxin testing coordination",
    },
    {
      name: "botulism_treatment_safety",
      label: "Botulism treatment safety",
      applies: requiresBotulismSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasBotulismTreatmentSafetyCheck,
      issue:
        "botulism safety checks must include not delaying or waiting for laboratory confirmation before empiric treatment, infant-specific antitoxin planning such as BabyBIG or human botulism immune globulin versus heptavalent antitoxin, wound botulism source control with surgical debridement and antibiotic review, and supportive complication prevention for bladder, bowel, urinary tract infection, DVT, pressure ulcers, dry eyes, dry mouth, secretions, communication, or rehabilitation",
    },
    {
      name: "tick_paralysis_time_critical_actions",
      label: "Tick paralysis search and respiratory actions",
      applies: requiresTickParalysisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTickParalysisTimeCriticalActions,
      issue:
        "tick paralysis time-critical actions must include a complete skin and tick search including scalp, behind ears, hairline, axilla, interdigital spaces, or perineum, complete tick removal using fine forceps, steady traction, remove tick, or tick removal, respiratory monitoring or support with pulmonary function testing, ABG, blood gas, intubation, or mechanical ventilation when needed, and differential review for Guillain-Barre, Miller Fisher, botulism, myasthenia, or spinal cord disease",
    },
    {
      name: "tick_paralysis_treatment_safety",
      label: "Tick paralysis treatment safety",
      applies: requiresTickParalysisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTickParalysisTreatmentSafetyCheck,
      issue:
        "tick paralysis safety checks must include avoiding unnecessary IVIG, immune globulin, plasmapheresis, or PLEX because these are not helpful for tick paralysis, removing the entire tick without leaving embedded mouthparts, inpatient observation or 24-48 hour monitoring for respiratory compromise or Ixodes holocyclus/Australian tick worsening after removal, and fever, rash, Lyme, ehrlichiosis, Rocky Mountain spotted fever, rickettsial, or other tick-borne infection review",
    },
    {
      name: "myocarditis_time_critical_actions",
      label: "Myocarditis monitoring and shock actions",
      applies: requiresMyocarditisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMyocarditisTimeCriticalActions,
      issue:
        "myocarditis time-critical actions must include ECG, EKG, 12-lead ECG, ST-segment, troponin, or cardiac-marker assessment, echocardiogram, echo, TTE, ejection-fraction, or cardiac-MRI imaging, hospital admission with cardiology, telemetry, or arrhythmia/decompensation monitoring, and ICU, vasopressor, inotrope, defibrillation, ventricular-arrhythmia, ECMO, Impella, or mechanical-circulatory-support escalation for fulminant shock or malignant arrhythmia",
    },
    {
      name: "myocarditis_treatment_safety",
      label: "Myocarditis treatment safety",
      applies: requiresMyocarditisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMyocarditisTreatmentSafetyCheck,
      issue:
        "myocarditis safety checks must include activity limitation, no sports, exercise restriction, return-to-play, or avoid stress testing review, avoidance of NSAIDs or cardiotoxic drugs, coronary CTA, cardiac catheterization, coronary-disease, ACS rule-out, or exclude-ACS review when chest pain mimics ACS, cardiac MRI, endomyocardial biopsy, biopsy, high-degree AV block, worsening, tertiary-care, mechanical-assist, or transplant escalation review, and follow-up echo, repeat echocardiogram, arrhythmia monitoring, or wearable-defibrillator planning",
    },
    {
      name: "dka_time_critical_actions",
      label: "DKA treatment sequence",
      applies: requiresDkaTreatmentSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDkaTimeCriticalActions,
      issue:
        "DKA time-critical actions must include potassium-before-insulin, fluids/IV insulin infusion planning, and anion-gap or ketone closure monitoring",
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
      name: "dka_advanced_insulin_transition_safety",
      label: "DKA transition safety",
      applies: requiresDkaTreatmentSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDkaAdvancedInsulinTransitionSafetyCheck,
      issue:
        "DKA advanced safety checks must include bicarbonate restriction or severe-acidosis pH review, phosphate replacement indications, dextrose addition when glucose falls with continued insulin until ketone, anion-gap, or DKA resolution, basal or subcutaneous insulin overlap before stopping IV insulin once DKA is resolved and oral intake is tolerated, and precipitant review for infection, myocardial infarction, stroke, SGLT2 inhibitor, medication contributors, or missed insulin",
    },
    {
      name: "pediatric_dka_time_critical_actions",
      label: "Pediatric DKA emergency actions",
      applies: requiresPediatricDkaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPediatricDkaTimeCriticalActions,
      issue:
        "pediatric DKA time-critical actions must include pediatric severity assessment, isotonic fluid or deficit replacement planning, insulin infusion without bolus after fluids and potassium assessment, electrolyte monitoring or repletion, and cerebral injury or PICU escalation",
    },
    {
      name: "pediatric_dka_treatment_safety",
      label: "Pediatric DKA cerebral injury safety",
      applies: requiresPediatricDkaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPediatricDkaTreatmentSafetyCheck,
      issue:
        "pediatric DKA safety checks must include bicarbonate avoidance or rare-use criteria, cerebral injury monitoring and mannitol or hypertonic saline rescue planning, hypoglycemia and electrolyte safeguards, and PICU/endocrinology disposition or transition criteria",
    },
    {
      name: "hhs_time_critical_actions",
      label: "HHS fluids, osmolality, insulin, and precipitant actions",
      applies: requiresHhsSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHhsTimeCriticalActions,
      issue:
        "HHS time-critical actions must include isotonic crystalloid, normal saline, fluid, volume, or perfusion resuscitation, osmolality plus sodium monitoring, glucose, ketone, beta-hydroxybutyrate, blood-gas, pH, or bicarbonate assessment, potassium review with cautious or deferred insulin such as 0.05 units/kg/h, and precipitant or ICU escalation for infection, culture, sepsis, stroke, or myocardial infarction",
    },
    {
      name: "hhs_treatment_safety",
      label: "HHS controlled correction and thrombosis safety",
      applies: requiresHhsSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHhsTreatmentSafetyCheck,
      issue:
        "HHS safety checks must include controlled osmolality, sodium, glucose-fall, rapid-correction, cerebral-edema, 3-to-8 mOsm/kg/hour, or sodium no-more-than-10 mmol/L/day review, fluids-first insulin timing with insulin after glucose stops falling, 0.05 units/kg/h, defer-insulin, or osmotic-shift review, potassium plus renal, CKD, frailty, cardiac-failure, or fluid safety review, thrombosis, VTE, infection, stroke, myocardial infarction, or precipitant review, and resolution or disposition review for osmolality below 300, urine output, cognitive status, euglycemia, or ICU",
    },
    {
      name: "hyponatremia_time_critical_actions",
      label: "Severe hyponatremia emergency actions",
      applies: requiresHyponatremiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHyponatremiaTimeCriticalActions,
      issue:
        "severe hyponatremia time-critical actions must include serum sodium, osmolality, hypotonic, or osmolar confirmation, hypertonic saline, 3% sodium chloride, or sodium-chloride bolus planning, seizure, coma, airway, neurologic, ICU, or high-dependency escalation, frequent, serial, repeat, q2, or every-2 sodium correction monitoring, and urine osmolality, urine sodium, volume status, SIADH, adrenal, thyroid, or diuretic cause evaluation",
    },
    {
      name: "hyponatremia_treatment_safety",
      label: "Severe hyponatremia correction safety",
      applies: requiresHyponatremiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHyponatremiaTreatmentSafetyCheck,
      issue:
        "severe hyponatremia safety checks must include correction limit review such as 6-8 mmol/L, 8 mmol/L, 10 mmol/L, 24-hour, ODS, or osmotic-demyelination safeguards, high-risk review for chronic or unknown duration, alcohol use, malnutrition, liver disease, or hypokalemia, overcorrection rescue with DDAVP, desmopressin, D5W, hypotonic fluid, or relowering planning, hypovolemic, euvolemic, hypervolemic, fluid-restriction, normal-saline, stop-thiazide, or offending-medication cause safety, and ICU, high-dependency, close, frequent, q2, or serial sodium monitoring disposition",
    },
    {
      name: "rhabdomyolysis_time_critical_actions",
      label: "Rhabdomyolysis kidney protection actions",
      applies: requiresRhabdomyolysisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasRhabdomyolysisTimeCriticalActions,
      issue:
        "rhabdomyolysis time-critical actions must include CK, CPK, creatine-kinase, myoglobin, myoglobinuria, or urinalysis assessment, isotonic crystalloid, normal saline, lactated Ringer, hydration, fluid, or IV-fluid resuscitation, urine-output or Foley monitoring plus a 200-300 mL/hour or goal-directed urine-output target, electrolyte, potassium, hyperkalemia, calcium, phosphate, or ECG assessment, and cause or complication control including crush, trauma, offending-agent removal, stop-statin, compartment, or DIC review",
    },
    {
      name: "rhabdomyolysis_treatment_safety",
      label: "Rhabdomyolysis renal and electrolyte safety",
      applies: requiresRhabdomyolysisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasRhabdomyolysisTreatmentSafetyCheck,
      issue:
        "rhabdomyolysis safety checks must include renal, AKI, volume-overload, or fluid-overload monitoring, bicarbonate, alkalinization, urine-pH, pH-7.5, mannitol, oliguria, or diuretic-limit safety, dialysis or hemodialysis indications for anuria, refractory hyperkalemia, severe acidosis, uremia, or volume overload, potassium, hyperkalemia, hypocalcemia, hypercalcemia, or calcium-caution electrolyte safety, and compartment-syndrome, neurovascular, fasciotomy, DIC, platelet, or PT complication monitoring",
    },
    {
      name: "hypercalcemia_time_critical_actions",
      label: "Severe hypercalcemia emergency actions",
      applies: requiresHypercalcemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHypercalcemiaTimeCriticalActions,
      issue:
        "severe hypercalcemia time-critical actions must include serum, corrected, repeat, albumin-adjusted, or ionized calcium confirmation, ECG, short-QT, creatinine, BUN, kidney, or renal assessment, isotonic saline, normal saline, 0.9% saline, fluid, or hydration resuscitation, explicit calcitonin for rapid onset or tachyphylaxis-aware bridging, bisphosphonate, zoledronate, pamidronate, or denosumab antiresorptive therapy, and cause or dialysis planning for PTH, PTHrP, vitamin D, malignancy, refractory disease, or renal failure",
    },
    {
      name: "hypercalcemia_treatment_safety",
      label: "Severe hypercalcemia treatment safety",
      applies: requiresHypercalcemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHypercalcemiaTreatmentSafetyCheck,
      issue:
        "severe hypercalcemia safety checks must include cardiac, heart-failure, renal, or volume-overload caution during saline hydration, loop-diuretic safety with furosemide only after rehydration, urine-output monitoring, or avoiding volume depletion, antiresorptive renal safety including severe renal impairment, denosumab alternative, vitamin D, or hypocalcemia risk, stopping or reviewing calcium supplements, vitamin D, vitamin A, thiazide, or lithium contributors, and refractory hypercalcemia dialysis planning for renal insufficiency or renal failure",
    },
    {
      name: "hypocalcemia_time_critical_actions",
      label: "Severe hypocalcemia emergency actions",
      applies: requiresHypocalcemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHypocalcemiaTimeCriticalActions,
      issue:
        "severe hypocalcemia time-critical actions must include serum, corrected, repeat, albumin-adjusted, or ionized calcium confirmation, ECG, EKG, telemetry, cardiac monitoring, QT, or prolonged-QT assessment, IV calcium such as calcium gluconate, calcium chloride, or intravenous calcium, repeat bolus, calcium infusion, continuous infusion, drip, or serial ionized calcium monitoring, and magnesium, phosphate, PTH, vitamin D, renal, or alkaline-phosphatase cause evaluation",
    },
    {
      name: "hypocalcemia_treatment_safety",
      label: "Severe hypocalcemia treatment safety",
      applies: requiresHypocalcemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHypocalcemiaTreatmentSafetyCheck,
      issue:
        "severe hypocalcemia safety checks must include digoxin, continuous ECG, slow calcium infusion, or hypokalemia correction safety, calcium-chloride, central-line, extravasation, local-irritation, or soft-tissue injury review, calcium-phosphate product, phosphate, hyperphosphatemia, or soft-tissue calcification review, hypomagnesemia or magnesium repletion with magnesium sulfate or PTH-resistance review, and transition to oral calcium, vitamin D, calcitriol, or chronic therapy",
    },
    {
      name: "tumor_lysis_time_critical_actions",
      label: "Tumor lysis syndrome emergency actions",
      applies: requiresTumorLysisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTumorLysisTimeCriticalActions,
      issue:
        "tumor lysis syndrome time-critical actions must include frequent q4, q6, electrolyte, potassium, phosphate, calcium, creatinine, or uric-acid monitoring, aggressive IV hydration, crystalloid, fluid, or urine-output support, uric-acid lowering with rasburicase, allopurinol, febuxostat, hypouricemic therapy, or urate planning, ECG, telemetry, hyperkalemia, insulin, calcium gluconate, hyperphosphatemia, or phosphate-binder management, and nephrology, dialysis, hemodialysis, CRRT, or renal-replacement escalation",
    },
    {
      name: "tumor_lysis_treatment_safety",
      label: "Tumor lysis syndrome safety",
      applies: requiresTumorLysisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTumorLysisTreatmentSafetyCheck,
      issue:
        "tumor lysis syndrome safety checks must include rasburicase G6PD screening plus hemolysis or methemoglobinemia safety, urine-alkalinization, bicarbonate, or calcium-phosphate precipitation avoidance, fluid safety for cardiac disease, heart failure, renal disease, fluid overload, hypovolemia, or obstructive uropathy, allopurinol renal adjustment, xanthine nephropathy, HLA-B*58:01, or azathioprine interaction review, calcium-phosphate or hyperphosphatemia safety with calcium reserved for symptomatic hypocalcemia, and dialysis or CRRT indications for anuria, fluid overload, persistent hyperkalemia, or renal-replacement need",
    },
    {
      name: "hyperkalemia_time_critical_actions",
      label: "Severe hyperkalemia emergency actions",
      applies: requiresHyperkalemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHyperkalemiaTimeCriticalActions,
      issue:
        "severe hyperkalemia time-critical actions must include IV calcium gluconate, calcium chloride, or equivalent IV calcium, insulin-based potassium shifting with dextrose or glucose co-therapy, and concrete potassium removal planning such as dialysis, diuretic, or potassium-binder therapy",
    },
    {
      name: "hyperkalemia_treatment_safety",
      label: "Severe hyperkalemia monitoring safety",
      applies: requiresHyperkalemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHyperkalemiaTreatmentSafetyCheck,
      issue:
        "severe hyperkalemia safety checks must include ECG or telemetry with repeat potassium monitoring, hypoglycemia or glucose monitoring after insulin, and renal or medication recurrence review",
    },
    {
      name: "status_epilepticus_time_critical_actions",
      label: "Status epilepticus staged treatment",
      applies: requiresStatusEpilepticusSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasStatusEpilepticusTimeCriticalActions,
      issue:
        "status epilepticus time-critical actions must include airway or oxygen support, benzodiazepine treatment, second-line antiseizure loading pathway, specific second-line medication such as levetiracetam, fosphenytoin, phenytoin, valproate, valproic acid, or phenobarbital, and refractory seizure escalation",
    },
    {
      name: "status_epilepticus_treatment_safety",
      label: "Status epilepticus treatment safety",
      applies: requiresStatusEpilepticusSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasStatusEpilepticusTreatmentSafetyCheck,
      issue:
        "status epilepticus safety checks must include bedside glucose, blood glucose, hypoglycemia, or dextrose assessment, respiratory depression or aspiration safeguards, and second-line antiseizure dosing or contraindication review",
    },
    {
      name: "severe_alcohol_withdrawal_time_critical_actions",
      label: "Severe alcohol withdrawal acute treatment",
      applies: requiresSevereAlcoholWithdrawalSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSevereAlcoholWithdrawalTimeCriticalActions,
      issue:
        "severe alcohol withdrawal time-critical actions must include withdrawal severity assessment, benzodiazepine treatment, explicit thiamine treatment or prophylaxis, electrolyte repletion, and ICU or refractory withdrawal escalation",
    },
    {
      name: "severe_alcohol_withdrawal_treatment_safety",
      label: "Severe alcohol withdrawal safety checks",
      applies: requiresSevereAlcoholWithdrawalSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereAlcoholWithdrawalTreatmentSafetyCheck,
      issue:
        "severe alcohol withdrawal safety checks must include respiratory depression or oversedation safeguards, seizure or delirium mimics and co-ingestion differential, hepatic disease or medication safety review, and admission or ICU disposition criteria",
    },
    {
      name: "adrenal_crisis_time_critical_actions",
      label: "Adrenal crisis immediate steroid and fluids",
      applies: requiresAdrenalCrisisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAdrenalCrisisTimeCriticalActions,
      issue:
        "adrenal crisis time-critical actions must include immediate hydrocortisone by IV, IM, or parenteral route or stress-dose steroid, isotonic saline or dextrose resuscitation, and glucose, electrolyte, or hemodynamic monitoring",
    },
    {
      name: "adrenal_crisis_treatment_safety",
      label: "Adrenal crisis monitoring and trigger safety",
      applies: requiresAdrenalCrisisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAdrenalCrisisTreatmentSafetyCheck,
      issue:
        "adrenal crisis safety checks must include not delaying hydrocortisone for cortisol testing, glucose and electrolyte monitoring, and precipitant, infection, or missed-steroid review",
    },
    {
      name: "button_battery_ingestion_time_critical_actions",
      label: "Button battery ingestion localization and removal actions",
      applies: requiresButtonBatterySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasButtonBatteryTimeCriticalActions,
      issue:
        "button battery ingestion time-critical actions must include immediate x-ray localization with AP/lateral neck, chest/esophagus, and abdomen views or double-rim/halo review, poison center or battery hotline consultation with NPO and no-vomiting instructions, honey or sucralfate mitigation when eligible without delaying care, and urgent endoscopic or specialist removal planning for esophageal batteries",
    },
    {
      name: "button_battery_ingestion_treatment_safety",
      label: "Button battery ingestion delay and injury safety",
      applies: requiresButtonBatterySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasButtonBatteryTreatmentSafetyCheck,
      issue:
        "button battery ingestion safety checks must include no-delay removal safeguards because honey, sucralfate, recent eating, or sedation timing must not delay esophageal battery removal, delayed esophageal injury monitoring for perforation, tracheoesophageal or vascular fistula, vocal cord injury, stricture, or sentinel bleeding, stomach/beyond-esophagus disposition or repeat imaging criteria, and avoidance of ipecac, induced vomiting, blind balloon/magnet removal, chelation, laxatives, or unnecessary mercury testing",
    },
    {
      name: "acetaminophen_toxicity_time_critical_actions",
      label: "Acetaminophen toxicity level, NAC, and hepatic monitoring",
      applies: requiresAcetaminophenToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcetaminophenToxicityTimeCriticalActions,
      issue:
        "acetaminophen toxicity time-critical actions must include a timed acetaminophen level with Rumack-Matthew nomogram planning, N-acetylcysteine treatment planning, and explicit hepatic injury labs such as AST, ALT, INR, PT, bilirubin, or LFT monitoring",
    },
    {
      name: "acetaminophen_toxicity_treatment_safety",
      label: "Acetaminophen toxicity treatment safety",
      applies: requiresAcetaminophenToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcetaminophenToxicityTreatmentSafetyCheck,
      issue:
        "acetaminophen toxicity safety checks must include ingestion timing or formulation limits for nomogram use, N-acetylcysteine dosing or infusion safety, and hepatic failure or transplant-risk monitoring",
    },
    {
      name: "valproate_toxicity_time_critical_actions",
      label: "Valproate toxicity labs, carnitine, and dialysis actions",
      applies: requiresValproateToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasValproateToxicityTimeCriticalActions,
      issue:
        "valproate toxicity time-critical actions must include serial valproate level or valproate concentration monitoring, ammonia, free-valproate, or unbound-valproate assessment, CMP, LFT, liver-function, CBC, glucose, electrolyte, acetaminophen, salicylate, co-ingestant, or pregnancy testing, airway, breathing, circulation, intubation, mechanical-ventilation, IV-fluid, vasopressor, or benzodiazepine stabilization, activated-charcoal, enteric-coated, extended-release, gastric-lavage, or decontamination planning, L-carnitine, levocarnitine, or carnitine therapy, poison-center or toxicologist consultation, and hemodialysis, ECTR, or extracorporeal-treatment escalation",
    },
    {
      name: "valproate_toxicity_treatment_safety",
      label: "Valproate toxicity dialysis and complication safety",
      applies: requiresValproateToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasValproateToxicityTreatmentSafetyCheck,
      issue:
        "valproate toxicity safety checks must include dialysis indication review for valproate concentration >1300 mg/L, shock, cerebral edema, severe acidosis, pH <7.10, hemodialysis, ECTR, or dialysis criteria, L-carnitine, levocarnitine, carnitine, 100 mg/kg, 50 mg/kg, or ammonia-response monitoring, free-level, unbound-level, hypoalbuminemia, low-albumin, protein-binding, or normal-total-level interpretation, enteric-coated, extended-release, within-2-hour, charcoal, swallow, or airway decontamination safety, and hepatotoxicity, thrombocytopenia, cerebral-edema, pancreatitis, pregnancy, or teratogen complication review",
    },
    {
      name: "theophylline_toxicity_time_critical_actions",
      label: "Theophylline toxicity labs, charcoal, seizure, and dialysis actions",
      applies: requiresTheophyllineToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTheophyllineToxicityTimeCriticalActions,
      issue:
        "theophylline toxicity time-critical actions must include serum theophylline level, ECG or cardiac monitoring, metabolic labs such as glucose, CMP, potassium, calcium, electrolyte, hyperglycemia, hypokalemia, or metabolic-acidosis assessment, co-ingestant or organ-injury labs such as acetaminophen, salicylate, iron, CK, creatine kinase, or LFT, airway, breathing, circulation, hemodynamic monitoring, intubation, IV-fluid, phenylephrine, norepinephrine, or vasopressor support, activated charcoal, multiple-dose activated charcoal, MDAC, multidose charcoal, or nasogastric decontamination planning, benzodiazepine, lorazepam, midazolam, diazepam, phenobarbital, propofol, or seizure treatment, poison-center or toxicologist consultation, and hemodialysis, hemoperfusion, ECTR, or extracorporeal-treatment escalation",
    },
    {
      name: "theophylline_toxicity_treatment_safety",
      label: "Theophylline toxicity dialysis and dysrhythmia safety",
      applies: requiresTheophyllineToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTheophyllineToxicityTreatmentSafetyCheck,
      issue:
        "theophylline toxicity safety checks must include dialysis or ECTR indication review for acute level >100, chronic level >60, elderly or infant chronic level >50, seizure, shock, rising level, clinical deterioration, or severe poisoning, arrhythmia or shock safety with ACLS, dysrhythmia, life-threatening dysrhythmia, phenylephrine, norepinephrine, beta-antagonist toxicologist consultation, or toxicology review, electrolyte and metabolic monitoring for hypokalemia, potassium, hyperglycemia, hypercalcemia, metabolic acidosis, CK, or rhabdomyolysis, decontamination safety including activated-charcoal contraindications, airway, MDAC during ECTR, emesis-not-recommended, gastric-lavage-not-recommended, or whole-bowel-irrigation review, and interaction or chronic-toxicity risk review for cimetidine, erythromycin, fluoroquinolone, ciprofloxacin, smoking, viral illness, CHF, cirrhosis, clearance, or metabolism",
    },
    {
      name: "toxic_alcohol_time_critical_actions",
      label: "Toxic alcohol antidote and dialysis actions",
      applies: requiresToxicAlcoholSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasToxicAlcoholTimeCriticalActions,
      issue:
        "toxic alcohol time-critical actions must include anion gap, osmolal gap, osmolar gap, or measured serum osmolality assessment, methanol, ethylene glycol, or toxic alcohol level assessment, explicit fomepizole, ethanol antidote, or alcohol-dehydrogenase blockade, poison-center or toxicologist consultation, hemodialysis, ECTR, or extracorporeal-treatment escalation, and acidosis, blood gas, pH, or bicarbonate support planning",
    },
    {
      name: "toxic_alcohol_treatment_safety",
      label: "Toxic alcohol dialysis and organ safety",
      applies: requiresToxicAlcoholSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasToxicAlcoholTreatmentSafetyCheck,
      issue:
        "toxic alcohol safety checks must include hemodialysis indication review for severe acidosis, anion gap, coma, seizure, visual symptoms, renal failure, kidney failure, or high-risk level, vision, optic, renal, kidney, urine, hypocalcemia, or calcium oxalate organ-injury monitoring, ethanol, isopropanol, salicylate, ketoacidosis, lactic acidosis, late presentation, or co-ingestion differential review, empiric fomepizole or alcohol-dehydrogenase blockade without waiting for confirmatory levels when suspicion is high, and folinic acid, folate, thiamine, or pyridoxine cofactor planning",
    },
    {
      name: "lithium_toxicity_time_critical_actions",
      label: "Lithium toxicity monitoring and dialysis actions",
      applies: requiresLithiumToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasLithiumToxicityTimeCriticalActions,
      issue:
        "lithium toxicity time-critical actions must include serial serum lithium level or concentration monitoring, renal function, creatinine, BUN, electrolyte, sodium, ECG, cardiac monitoring, or urine-output assessment, isotonic saline, normal saline, IV fluids, dehydration, volume-depletion, hold-lithium, or stop-lithium management, whole-bowel irrigation planning for sustained-release or massive ingestion, activated-charcoal-not-effective or co-ingestant-only decontamination limitation review, poison-center or toxicologist consultation, and hemodialysis, ECTR, or extracorporeal-treatment escalation",
    },
    {
      name: "lithium_toxicity_treatment_safety",
      label: "Lithium toxicity dialysis and rebound safety",
      applies: requiresLithiumToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasLithiumToxicityTreatmentSafetyCheck,
      issue:
        "lithium toxicity safety checks must include dialysis indication review for impaired kidney function, Li >4, level >5, decreased level of consciousness, seizure, dysrhythmia, confusion, or expected time >36 hours, rebound or post-ECTR serial-level monitoring with level <1.0 or clinical-improvement stopping criteria, precipitant review for NSAID, ACE-inhibitor, ARB, diuretic, thiazide, dehydration, sodium-depletion, low-sodium, renal-insufficiency, or nephrogenic-diabetes-insipidus risk, and clinical-status disposition because signs may not conform to lithium level, including admit, ICU, symptomatic despite normal level, asymptomatic, or less-than-1.5 discharge criteria",
    },
    {
      name: "salicylate_toxicity_time_critical_actions",
      label: "Salicylate toxicity levels and alkalinization",
      applies: requiresSalicylateToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSalicylateToxicityTimeCriticalActions,
      issue:
        "salicylate toxicity time-critical actions must include serial salicylate levels with anion gap, blood gas, ABG, VBG, or electrolyte monitoring, activated charcoal or multidose charcoal decontamination planning, sodium bicarbonate, urine alkalinization, alkaline diuresis, potassium, or urine pH planning, poison-center or toxicologist consultation, and hemodialysis, ECTR, or extracorporeal-treatment escalation",
    },
    {
      name: "salicylate_toxicity_treatment_safety",
      label: "Salicylate toxicity dialysis and airway safety",
      applies: requiresSalicylateToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSalicylateToxicityTreatmentSafetyCheck,
      issue:
        "salicylate toxicity safety checks must include hemodialysis indication review for acidemia, severe acidosis, altered mental status, seizure, renal failure, kidney failure, pulmonary edema, or very high salicylate level, intubation or mechanical ventilation pH-preservation planning with hyperventilation or bicarbonate safeguards, serum pH, urine pH 7.5 to 8, urine-output, or urinary-alkalinization target monitoring, and potassium, hypokalemia, glucose, hypoglycemia, temperature, pulmonary edema, or cerebral edema monitoring",
    },
    {
      name: "carbon_monoxide_poisoning_time_critical_actions",
      label: "Carbon monoxide oxygen, COHb, and HBO actions",
      applies: requiresCarbonMonoxidePoisoningSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCarbonMonoxidePoisoningTimeCriticalActions,
      issue:
        "carbon monoxide poisoning time-critical actions must include source removal or 100% high-flow oxygen by non-rebreather, carboxyhemoglobin, COHb, or co-oximetry diagnostic confirmation, hyperbaric oxygen, HBOT, poison center, toxicologist, or specialty escalation planning, and cardiac, ECG, troponin, lactate, neurologic, altered mental status, syncope, or seizure assessment",
    },
    {
      name: "carbon_monoxide_poisoning_treatment_safety",
      label: "Carbon monoxide HBO and complication safety",
      applies: requiresCarbonMonoxidePoisoningSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCarbonMonoxidePoisoningTreatmentSafetyCheck,
      issue:
        "carbon monoxide poisoning safety checks must include pulse oximetry or SpO2 false-normal limitation review, hyperbaric oxygen criteria review for pregnancy, neurologic symptoms, loss of consciousness, syncope, acidosis, cardiac ischemia, or high carboxyhemoglobin, COHb severity-correlation or elapsed-time limitation review using clinical symptoms and exposure history, pregnancy testing or fetal-risk review for women of childbearing age, cardiac, ECG, troponin, lactate, metabolic acidosis, myocardial, delayed neurologic, or neurocognitive complication monitoring, and smoke inhalation, cyanide, hydroxocobalamin, burn, fire, or lactate co-toxicity assessment",
    },
    {
      name: "cyanide_poisoning_time_critical_actions",
      label: "Cyanide poisoning antidote and support",
      applies: requiresCyanidePoisoningSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCyanidePoisoningTimeCriticalActions,
      issue:
        "cyanide poisoning time-critical actions must include source removal or 100% oxygen with respiratory or circulatory support, hydroxocobalamin or Cyanokit antidote planning, lactate, blood gas, ABG, VBG, pH, anion gap, or metabolic acidosis assessment, and poison center, toxicologist, ICU, or burn center escalation",
    },
    {
      name: "cyanide_poisoning_treatment_safety",
      label: "Cyanide poisoning smoke and antidote safety",
      applies: requiresCyanidePoisoningSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCyanidePoisoningTreatmentSafetyCheck,
      issue:
        "cyanide poisoning safety checks must include empiric antidote or do-not-wait cyanide-level planning, smoke inhalation, carbon monoxide, COHb, carboxyhemoglobin, or nitrite-avoidance review, shock, hypotension, cardiac arrest, coma, seizure, syncope, or altered mental status monitoring, enclosed-space fire, severe lactic acidosis, lactate above 8 to 10, or smoke-inhalation lactate trigger review for empiric treatment, and hydroxocobalamin blood pressure, red urine, chromaturia, lab-interference, or dialysis interference safety",
    },
    {
      name: "snakebite_envenomation_time_critical_actions",
      label: "Snakebite transport, labs, antivenom, and escalation",
      applies: requiresSnakebiteEnvenomationSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSnakebiteEnvenomationTimeCriticalActions,
      issue:
        "snakebite envenomation time-critical actions must include rapid transport with loose immobilization at heart level and removal of constricting rings or watches, serial exam or labs for swelling, CBC, platelets, PT/INR, fibrinogen, or coagulopathy, antivenom treatment action when envenomation progresses, poison center or toxicology consultation, and respiratory or neurologic support for airway, oxygen, ventilation, or neurotoxicity",
    },
    {
      name: "snakebite_envenomation_treatment_safety",
      label: "Snakebite harmful first aid and antivenom safety",
      applies: requiresSnakebiteEnvenomationSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSnakebiteEnvenomationTreatmentSafetyCheck,
      issue:
        "snakebite envenomation safety checks must include avoidance of harmful first aid such as tourniquet, incision, suction, ice, or electric shock, at least 8-hour observation or longer serial monitoring when envenomation findings are present, coagulopathy monitoring with platelets, PT/INR, fibrinogen, bleeding, or defibrination, antivenom reaction monitoring for hypersensitivity, serum sickness, reaction, or premedication needs, and compartment-syndrome or fasciotomy caution with pressure measurement, surgical consultation, or antivenom-first planning",
    },
    {
      name: "major_burn_time_critical_actions",
      label: "Major burn airway, TBSA, fluids, and transfer",
      applies: requiresMajorBurnSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMajorBurnTimeCriticalActions,
      issue:
        "major burn time-critical actions must include airway assessment or early intubation with 100% oxygen or ventilation support for inhalation injury, extinguishing ongoing burning plus clothing removal or chemical irrigation, TBSA and burn-depth assessment with rule-of-nines or Lund-Browder planning, large-bore IV lactated-Ringer or Parkland fluid resuscitation with urine-output monitoring, and burn center consultation, referral, or transfer",
    },
    {
      name: "major_burn_treatment_safety",
      label: "Major burn hypothermia, fluids, eschar, and infection safety",
      applies: requiresMajorBurnSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMajorBurnTreatmentSafetyCheck,
      issue:
        "major burn safety checks must include hypothermia prevention with warming, dry coverings, or temperature monitoring, fluid titration to urine output with hourly reassessment and fluid-overload, heart-failure, or compartment-syndrome monitoring, circumferential eschar or escharotomy review for perfusion or ventilation restriction, tetanus status or Tdap review, and antibiotic stewardship such as avoiding routine prophylactic systemic antibiotics or using topical antimicrobials when indicated",
    },
    {
      name: "sjs_ten_time_critical_actions",
      label: "SJS/TEN drug stop, severity, support, and eye actions",
      applies: requiresSjsTenSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSjsTenTimeCriticalActions,
      issue:
        "SJS/TEN time-critical actions must include immediate cessation, withdrawal, or discontinuation of the culprit/offending drug, hospital admission with dermatology, ICU, intensive-care, burn-unit, or burn-center escalation, BSA, body-surface-area, skin-detachment, epidermal-detachment, SCORTEN, or ABCD-10 severity assessment, supportive care with fluid replacement/resuscitation, nutrition, temperature/warm-room maintenance, and pain control, and mucosal, oral, eye-care, ophthalmology, or ophthalmologist assessment",
    },
    {
      name: "sjs_ten_treatment_safety",
      label: "SJS/TEN wound, infection, organ, and medication safety",
      applies: requiresSjsTenSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSjsTenTreatmentSafetyCheck,
      issue:
        "SJS/TEN safety checks must include sterile handling, reverse isolation, non-adherent dressings, avoid-adhesive, wound-care, or infection surveillance, antibiotic stewardship such as avoiding prophylactic systemic antibiotics or using systemic antibiotics only if infection develops, airway, respiratory distress, ARDS, pneumonia, kidney, liver, or organ-failure monitoring, avoidance of rechallenge or structurally related medicines with drug-allergy/cross-reaction documentation, and adjunct therapy risk review including steroid, IVIG, cyclosporine/ciclosporin, renal impairment, infection risk, or thalidomide avoidance",
    },
    {
      name: "dress_time_critical_actions",
      label: "DRESS drug stop, organ labs, severity, and steroid actions",
      applies: requiresDressSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDressTimeCriticalActions,
      issue:
        "DRESS/DIHS time-critical actions must include immediate cessation, withdrawal, or discontinuation of all suspect/culprit/offending medicines, CBC, blood-count, eosinophil, coagulation, liver-function, LFT, or renal-function testing, diagnostic severity assessment with hospitalisation/hospitalization, RegiSCAR, skin biopsy, drug timeline, or temporal-association review, cardiac or pulmonary evaluation with ECG, troponin, echocardiogram, myocarditis, chest X-ray, or pneumonitis review, and supportive care with fluid, electrolytes, warm environment, corticosteroid, prednisone, or slow-taper planning when severe organ involvement is present",
    },
    {
      name: "dress_treatment_safety",
      label: "DRESS organ, relapse, viral, rechallenge, and immunomodulator safety",
      applies: requiresDressSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDressTreatmentSafetyCheck,
      issue:
        "DRESS/DIHS safety checks must include severe organ complication review for acute liver failure, multiorgan failure, fulminant myocarditis, or hemophagocytosis/haemophagocytosis, steroid taper or relapse monitoring with slow taper or withdraw-very-slowly planning, viral or autoimmune follow-up with HHV-6, human herpesvirus, EBV, CMV, viral serology, thyroid, or autoimmune review, rechallenge/cross-reaction prevention with drug-allergy, avoid-causative, avoid-rechallenge, avoid-all-three aromatic anticonvulsants, cross-reaction, or first-degree-relative warning, and alternative immunomodulator review such as cyclosporine/ciclosporin, IVIG, plasmapheresis, mycophenolate, rituximab, or cyclophosphamide when corticosteroid response is inadequate",
    },
    {
      name: "ssss_time_critical_actions",
      label: "SSSS antibiotics, admission, fluids, and wound actions",
      applies: requiresSsssSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSsssTimeCriticalActions,
      issue:
        "staphylococcal scalded skin syndrome time-critical actions must include diagnostic/source evaluation with skin swab, blood culture, source of infection, nasopharynx, conjunctiva, Staph aureus, or skin-biopsy review, hospitalisation/hospitalization, dermatology, ICU, intensive-care, or burn-unit escalation, prompt IV anti-staphylococcal antibiotics such as flucloxacillin, cefazolin, nafcillin, oxacillin, or vancomycin, fluid, dehydration, electrolyte, temperature, or hypothermia support, and wound-care, nonadherent-dressing, burn-dressing, emollient, petroleum-jelly, pain-control, or pain-relief planning",
    },
    {
      name: "ssss_treatment_safety",
      label: "SSSS MRSA, medication harm, differential, and outbreak safety",
      applies: requiresSsssSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSsssTreatmentSafetyCheck,
      issue:
        "staphylococcal scalded skin syndrome safety checks must include MRSA, vancomycin, healthcare-exposure, or skilled-nursing review, medication harm review such as avoiding silver sulfadiazine, avoiding NSAIDs/ibuprofen with kidney impairment risk, and avoiding clindamycin monotherapy when resistance is possible, differential review for mucosal sparing versus SJS/TEN, toxic epidermal necrolysis, bullous impetigo, or AGEP, complication monitoring for dehydration, electrolyte imbalance, hypothermia, sepsis, pneumonia, or renal failure, and carrier, decolonization, nursery outbreak, outbreak, Staph aureus carrier, or hand-washing prevention planning",
    },
    {
      name: "toxic_shock_time_critical_actions",
      label: "TSS shock support, antibiotics, source control, and monitoring",
      applies: requiresToxicShockSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasToxicShockTimeCriticalActions,
      issue:
        "toxic shock syndrome time-critical actions must include immediate hospitalization, ICU/intensive-care, fluid resuscitation, vasopressor, ventilation, renal-replacement, hemodialysis, or organ-support planning, blood culture or cultures from wound, vagina, throat, nose, CT, MRI, or soft-tissue imaging to identify the organism/source, empiric toxin-suppressing antibiotics with clindamycin or linezolid plus beta-lactam, penicillin, vancomycin, daptomycin, or ceftaroline, source control with tampon/foreign-body/device removal, drainage, irrigation, debridement, or surgery, and renal, hepatic/liver, platelet, coagulation, CK, or cardiopulmonary monitoring",
    },
    {
      name: "toxic_shock_treatment_safety",
      label: "TSS regimen, IVIG, differential, recurrence, and contact safety",
      applies: requiresToxicShockSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasToxicShockTreatmentSafetyCheck,
      issue:
        "toxic shock syndrome safety checks must include group-A-strep/streptococcal regimen tailoring with penicillin plus clindamycin, staphylococcal/MSSA/MRSA regimen review with nafcillin, oxacillin, vancomycin, or MRSA coverage, IVIG or IV immune globulin consideration for severe or refractory shock, differential review for Kawasaki, scarlet fever, SSSS, staphylococcal scalded skin, Stevens-Johnson, meningococcemia, Rocky Mountain spotted fever, or leptospirosis, recurrence prevention with tampon, menstrual-cup, avoid-hyperabsorbent-tampon, mupirocin, or chlorhexidine guidance, and household-contact, prophylaxis, screening, not-routinely-recommend, or standard infection control review",
    },
    {
      name: "methemoglobinemia_time_critical_actions",
      label: "Methemoglobinemia oxygen, co-oximetry, antidote, and escalation",
      applies: requiresMethemoglobinemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMethemoglobinemiaTimeCriticalActions,
      issue:
        "methemoglobinemia time-critical actions must include oxygen or airway/ventilation support, removal or discontinuation of an offending benzocaine, dapsone, nitrate, nitrite, or oxidizing source, blood gas with co-oximetry or methemoglobin level confirmation, methylene blue treatment planning when symptomatic or significantly elevated, and poison center, toxicology, ICU, or toxicologist escalation",
    },
    {
      name: "methemoglobinemia_treatment_safety",
      label: "Methemoglobinemia pulse-ox and methylene blue safety",
      applies: requiresMethemoglobinemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMethemoglobinemiaTreatmentSafetyCheck,
      issue:
        "methemoglobinemia safety checks must include pulse oximetry unreliability or saturation-gap review, G6PD deficiency or hemolysis risk before methylene blue, serotonergic medication, SSRI, MAOI, or linezolid interaction review before methylene blue, treatment-threshold review for symptoms, end-organ damage, or methemoglobin above 20% to 30%, repeat-dose review after 30 to 60 minutes if symptoms persist or levels remain above threshold, rebound or serial methemoglobin/co-oximetry monitoring especially after dapsone, and alternative therapy planning such as ascorbic acid, exchange transfusion, or hyperbaric oxygen when methylene blue is contraindicated or refractory",
    },
    {
      name: "caustic_ingestion_time_critical_actions",
      label: "Caustic ingestion airway, endoscopy, CT, and escalation",
      applies: requiresCausticIngestionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCausticIngestionTimeCriticalActions,
      issue:
        "caustic ingestion time-critical actions must include ABC airway, breathing, circulation, intubation, ventilation, resuscitation, or stabilization planning, exposure history for product, substance, amount, concentration, time, intentionality, or co-ingestion, early EGD, upper endoscopy, endoscopic, gastroenterology, or GI consultation planning, CT, computed tomography, perforation, mediastinitis, peritonitis, surgical-abdomen, or surgical evaluation, and poison center, toxicology, toxicologist, surgery, or surgical consultation escalation",
    },
    {
      name: "caustic_ingestion_treatment_safety",
      label: "Caustic ingestion harmful intervention and follow-up safety",
      applies: requiresCausticIngestionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCausticIngestionTreatmentSafetyCheck,
      issue:
        "caustic ingestion safety checks must include avoidance of neutralization, dilution, activated charcoal, induced vomiting, or emesis, avoidance or specialist-guided review of blind NG, nasogastric, or orogastric tube placement, endoscopy timing or contraindication review for early endoscopy within 12 to 24 hours and avoiding high-risk endoscopy around 48 hours or when perforation is suspected, steroid or antibiotic stewardship with corticosteroids or antibiotics reserved for selected injury, infection, or perforation contexts, and long-term stricture, dysphagia follow-up, esophageal cancer, carcinoma, or surveillance planning",
    },
    {
      name: "opioid_toxicity_time_critical_actions",
      label: "Opioid toxicity airway, naloxone, and monitoring",
      applies: requiresOpioidToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOpioidToxicityTimeCriticalActions,
      issue:
        "opioid toxicity time-critical actions must include airway or ventilatory support, naloxone reversal, and recurrent respiratory depression monitoring or repeat-dose planning",
    },
    {
      name: "opioid_toxicity_treatment_safety",
      label: "Opioid toxicity rebound and co-ingestion safety",
      applies: requiresOpioidToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOpioidToxicityTreatmentSafetyCheck,
      issue:
        "opioid toxicity safety checks must include long-acting opioid or renarcotization observation, co-ingestion or alternate-cause assessment, and naloxone titration, withdrawal, aspiration, or pulmonary-edema safeguards",
    },
    {
      name: "sickle_splenic_sequestration_time_critical_actions",
      label: "Sickle splenic sequestration resuscitation and transfusion actions",
      applies: requiresSickleSplenicSequestrationSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSickleSplenicSequestrationTimeCriticalActions,
      issue:
        "sickle cell splenic sequestration time-critical actions must include spleen size, CBC, reticulocyte count, baseline hemoglobin comparison, and type-and-crossmatch assessment, immediate IV fluid resuscitation for hypovolemia or shock, simple transfusion or PRBC planning for severe anemia, and hematology or sickle cell expert consultation",
    },
    {
      name: "sickle_splenic_sequestration_treatment_safety",
      label: "Sickle splenic sequestration transfusion and recurrence safety",
      applies: requiresSickleSplenicSequestrationSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSickleSplenicSequestrationTreatmentSafetyCheck,
      issue:
        "sickle cell splenic sequestration safety checks must include avoiding over-transfusion or hyperviscosity such as hemoglobin above 8 g/dL, differential review for aplastic crisis, delayed hemolytic transfusion reaction, acute chest syndrome, infection, or sepsis, recurrence monitoring with spleen-size education and splenectomy discussion, and serial CBC, hemoglobin rebound, recheck, or vital-sign monitoring",
    },
    {
      name: "sickle_stroke_time_critical_actions",
      label: "Sickle stroke neuroimaging and transfusion actions",
      applies: requiresSickleStrokeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSickleStrokeTimeCriticalActions,
      issue:
        "sickle cell stroke time-critical actions must include urgent neurology or stroke consultation, urgent CT followed by MRI/MRA or neuroimaging when available, exchange or simple transfusion planning for imaging-confirmed acute stroke, and hematology, sickle cell expert, or apheresis consultation",
    },
    {
      name: "sickle_stroke_treatment_safety",
      label: "Sickle stroke transfusion and recurrence safety",
      applies: requiresSickleStrokeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSickleStrokeTreatmentSafetyCheck,
      issue:
        "sickle cell stroke safety checks must include hyperviscosity avoidance such as not transfusing above hemoglobin 10 g/dL, blood bank review for transfusion history, antigen matching, sickle-negative units, or alloimmunization risk, secondary stroke prevention with monthly simple or exchange transfusions, and hemorrhagic stroke, TIA, seizure, or stroke mimic review",
    },
    {
      name: "acute_chest_syndrome_time_critical_actions",
      label: "Acute chest syndrome emergency actions",
      applies: requiresAcuteChestSyndromeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteChestSyndromeTimeCriticalActions,
      issue:
        "acute chest syndrome time-critical actions must include chest imaging or infiltrate confirmation, oxygenation monitoring or support, empiric antibiotics, incentive spirometry with pain control, transfusion or exchange-transfusion planning, and respiratory failure escalation",
    },
    {
      name: "acute_chest_syndrome_treatment_safety",
      label: "Acute chest syndrome treatment safety",
      applies: requiresAcuteChestSyndromeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteChestSyndromeTreatmentSafetyCheck,
      issue:
        "acute chest syndrome safety checks must include fluid and opioid overhydration or hypoventilation safeguards, transfusion hyperviscosity or exchange-transfusion targets, bronchodilator and steroid caution, alternate cardiopulmonary diagnoses, and ICU or hematology disposition criteria",
    },
    {
      name: "severe_asthma_time_critical_actions",
      label: "Severe asthma bronchodilator and escalation actions",
      applies: requiresSevereAsthmaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSevereAsthmaTimeCriticalActions,
      issue:
        "severe asthma time-critical actions must include oxygen or ventilatory support, repeated or continuous SABA plus ipratropium, systemic corticosteroids, and magnesium or ICU/intubation escalation for poor response",
    },
    {
      name: "severe_asthma_treatment_safety",
      label: "Severe asthma response and respiratory failure safety",
      applies: requiresSevereAsthmaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereAsthmaTreatmentSafetyCheck,
      issue:
        "severe asthma safety checks must include serial severity or response monitoring, impending respiratory failure or ventilation risk review, and beta-agonist adverse-effect, electrolyte, or trigger reassessment",
    },
    {
      name: "severe_asthma_ventilation_safety",
      label: "Severe asthma ventilator safety",
      applies: requiresSevereAsthmaVentilationSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereAsthmaVentilationSafetyCheck,
      issue:
        "severe asthma ventilation safety checks must include low-minute ventilation or prolonged expiratory-time strategy, auto-PEEP or dynamic-hyperinflation monitoring, barotrauma or hemodynamic collapse surveillance, and sedation or ventilator-synchrony planning",
    },
    {
      name: "severe_cap_time_critical_actions",
      label: "Severe CAP oxygen, diagnostics, and antibiotics",
      applies: requiresSevereCapSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSevereCapTimeCriticalActions,
      issue:
        "severe community-acquired pneumonia time-critical actions must include oxygen, airway, HFNC, ventilation, intubation, hypoxemia, or respiratory-failure support, chest x-ray, chest radiograph, blood culture, sputum or respiratory culture, Legionella, urinary antigen, or severe-CAP diagnostic testing, empiric antibiotic therapy with beta-lactam, ceftriaxone, cefotaxime, ceftaroline, macrolide, azithromycin, levofloxacin, or moxifloxacin coverage, and sepsis, septic shock, lactate, vasopressor, ICU, or shock escalation",
    },
    {
      name: "severe_cap_treatment_safety",
      label: "Severe CAP resistant pathogen and complication safety",
      applies: requiresSevereCapSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereCapTreatmentSafetyCheck,
      issue:
        "severe community-acquired pneumonia safety checks must include MRSA or Pseudomonas risk-factor review for prior respiratory isolation, recent hospitalization or IV antibiotics within 90 days, vancomycin coverage, and de-escalation, severity or disposition review with PSI, CURB-65, major/minor criteria, shock, hypotension, or ICU need, parapneumonic effusion, empyema, loculated effusion, thoracentesis, or drainage review, and viral, influenza, COVID, aspiration, lung abscess, or pulmonary embolism differential assessment",
    },
    {
      name: "severe_cap_antibiotic_stewardship_safety",
      label: "Severe CAP antibiotic stewardship safety",
      applies: requiresSevereCapSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereCapAntibioticStewardshipSafetyCheck,
      issue:
        "severe community-acquired pneumonia stewardship safety checks must include not withholding initial empiric antibiotics because of procalcitonin, corticosteroid avoidance or refractory-septic-shock exception review, influenza antiviral or oseltamivir planning when positive, and antibiotic duration guided by clinical stability for at least 5 days",
    },
    {
      name: "copd_exacerbation_time_critical_actions",
      label: "COPD exacerbation controlled oxygen and ventilatory actions",
      applies: requiresCopdExacerbationSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCopdExacerbationTimeCriticalActions,
      issue:
        "COPD exacerbation time-critical actions must include controlled oxygen targeting 88-92%, short-acting bronchodilators, systemic corticosteroids, antibiotic or purulent-infection criteria, and NIV or ventilatory escalation for hypercapnic respiratory failure",
    },
    {
      name: "copd_exacerbation_treatment_safety",
      label: "COPD exacerbation hypercapnia and treatment safety",
      applies: requiresCopdExacerbationSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCopdExacerbationTreatmentSafetyCheck,
      issue:
        "COPD exacerbation safety checks must include oxygen-induced hypercapnia or ABG monitoring, NIV/intubation failure criteria, cardiopulmonary differential diagnosis review, and bronchodilator or steroid adverse-effect monitoring",
    },
    {
      name: "acute_heart_failure_time_critical_actions",
      label: "Acute heart failure oxygen, diuresis, and escalation",
      applies: requiresAcuteHeartFailureSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteHeartFailureTimeCriticalActions,
      issue:
        "acute heart failure time-critical actions must include oxygen or noninvasive ventilation for pulmonary edema, IV loop diuretic decongestion, blood-pressure-guided vasodilator or nitrate planning, and shock or respiratory-failure escalation",
    },
    {
      name: "acute_heart_failure_treatment_safety",
      label: "Acute heart failure renal, trigger, and shock safety",
      applies: requiresAcuteHeartFailureSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteHeartFailureTreatmentSafetyCheck,
      issue:
        "acute heart failure safety checks must include blood pressure or vasodilator contraindication review, renal and electrolyte monitoring during diuresis, trigger or cardiopulmonary differential review, and shock or respiratory-failure monitoring",
    },
    {
      name: "acute_heart_failure_shock_escalation_safety",
      label: "Acute heart failure shock escalation safety",
      applies: requiresAcuteHeartFailureSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteHeartFailureShockEscalationSafetyCheck,
      issue:
        "acute heart failure shock safety checks must include nitrate or vasodilator use limited to appropriate blood-pressure context with close monitoring or level-2 care, inotrope or vasopressor planning for potentially reversible cardiogenic shock in cardiac-care or high-dependency setting, early mechanical-circulatory-support or advanced heart-failure team discussion, and beta-blocker hold, continuation, or restart safety for shock, bradycardia, AV block, or stabilization",
    },
    {
      name: "ductal_dependent_chd_time_critical_actions",
      label: "Ductal-dependent CHD PGE1 and diagnostic actions",
      applies: requiresDuctalDependentChdSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasDuctalDependentChdTimeCriticalActions,
      issue:
        "ductal-dependent congenital heart disease time-critical actions must include immediate prostaglandin E1, PGE1, or alprostadil infusion planning, preductal/postductal pulse oximetry, four-extremity blood pressure, blood gas, lactate, ECG, chest x-ray, or echocardiogram assessment, neonatology, NICU, pediatric cardiology, cardiac ICU, transfer, or umbilical venous catheter escalation, and airway, vascular access, glucose, thermoregulation, metabolic acidosis, intubation, or ventilation support",
    },
    {
      name: "ductal_dependent_chd_treatment_safety",
      label: "Ductal-dependent CHD oxygen, PGE1, and transfer safety",
      applies: requiresDuctalDependentChdSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasDuctalDependentChdTreatmentSafetyCheck,
      issue:
        "ductal-dependent congenital heart disease safety checks must include judicious oxygen or pulmonary vascular resistance safety, PGE1 adverse-effect monitoring for apnea, respiratory depression, hypotension, fever, or intubation need, differential review for sepsis versus ductal-dependent lesions such as hypoplastic left heart, transposition, or pulmonary atresia, and do-not-delay transport, pediatric cardiology, pediatric cardiac, neonatology, or transfer planning",
    },
    {
      name: "cardiac_tamponade_time_critical_actions",
      label: "Cardiac tamponade drainage actions",
      applies: requiresCardiacTamponadeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCardiacTamponadeTimeCriticalActions,
      issue:
        "cardiac tamponade time-critical actions must include bedside echo, cardiac POCUS, or ultrasound assessment, immediate pericardiocentesis, pericardial drainage, pericardial window, or pericardiotomy planning, cardiology, cardiothoracic, thoracic, trauma, or emergency surgery escalation, and hemodynamic support with fluids, blood pressure, vasopressor, hypotension, or shock management",
    },
    {
      name: "cardiac_tamponade_treatment_safety",
      label: "Cardiac tamponade treatment safety",
      applies: requiresCardiacTamponadeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCardiacTamponadeTreatmentSafetyCheck,
      issue:
        "cardiac tamponade safety checks must include unstable-patient do-not-delay or immediate-drainage planning, anticoagulant, thrombolysis, bleeding, coagulopathy, INR, platelet, or reversal review, and trauma, iatrogenic injury, myocardial infarction or rupture, aortic dissection, malignancy, uremia, or renal failure cause assessment, plus avoidance of positive-pressure ventilation, intubation, diuresis, or other preload-reducing steps when feasible",
    },
    {
      name: "unstable_tachyarrhythmia_time_critical_actions",
      label: "Unstable tachyarrhythmia emergency actions",
      applies: requiresUnstableTachyarrhythmiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasUnstableTachyarrhythmiaTimeCriticalActions,
      issue:
        "unstable tachyarrhythmia time-critical actions must include ECG or monitor/defibrillator setup, pulse and instability assessment, synchronized cardioversion for unstable tachycardia with a pulse, electrolyte, ischemia, hypoxia, or torsades cause review, and ACLS, cardiology, sedation, or pulseless-defibrillation escalation",
    },
    {
      name: "unstable_tachyarrhythmia_treatment_safety",
      label: "Unstable tachyarrhythmia treatment safety",
      applies: requiresUnstableTachyarrhythmiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasUnstableTachyarrhythmiaTreatmentSafetyCheck,
      issue:
        "unstable tachyarrhythmia safety checks must include sedation without delaying shock and synchronized versus unsynchronized shock review, AV-nodal blocker avoidance in pre-excitation or irregular wide-complex rhythms, antiarrhythmic QT, torsades, magnesium, or hypotension cautions, and reversible-cause or disposition review",
    },
    {
      name: "symptomatic_bradycardia_time_critical_actions",
      label: "Symptomatic bradycardia emergency actions",
      applies: requiresSymptomaticBradycardiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSymptomaticBradycardiaTimeCriticalActions,
      issue:
        "symptomatic bradycardia time-critical actions must include ECG or cardiac monitoring, pulse and instability assessment, atropine, transcutaneous or transvenous pacing readiness, dopamine or epinephrine chronotropic infusion planning, and reversible-cause review",
    },
    {
      name: "symptomatic_bradycardia_treatment_safety",
      label: "Symptomatic bradycardia treatment safety",
      applies: requiresSymptomaticBradycardiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSymptomaticBradycardiaTreatmentSafetyCheck,
      issue:
        "symptomatic bradycardia safety checks must include not delaying pacing for unstable high-grade block, atropine limitation review, pacing route, capture confirmation, sedation or analgesia safeguards, dopamine or epinephrine adverse-effect monitoring, and reversible-cause or cardiology/pacemaker disposition review",
    },
    {
      name: "tension_pneumothorax_time_critical_actions",
      label: "Tension pneumothorax decompression and chest tube",
      applies: requiresTensionPneumothoraxSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasTensionPneumothoraxTimeCriticalActions,
      issue:
        "tension pneumothorax time-critical actions must include immediate needle or finger decompression, definitive chest tube or tube thoracostomy, airway or oxygen support, and post-decompression reassessment",
    },
    {
      name: "tension_pneumothorax_treatment_safety",
      label: "Tension pneumothorax no-delay and recurrence safety",
      applies: requiresTensionPneumothoraxSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasTensionPneumothoraxTreatmentSafetyCheck,
      issue:
        "tension pneumothorax safety checks must include not delaying decompression for imaging, decompression site and technique safety, recurrence or chest-tube failure monitoring, and obstructive-shock differential review",
    },
    {
      name: "stroke_time_critical_actions",
      label: "Stroke reperfusion timing",
      applies: requiresStrokeReperfusionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasStrokeTimeCriticalActions,
      issue:
        "stroke time-critical actions must include last-known-normal timing, brain imaging, and thrombolysis or thrombectomy planning",
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
      name: "stroke_advanced_reperfusion_monitoring_safety",
      label: "Stroke advanced reperfusion monitoring",
      applies: requiresStrokeReperfusionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasStrokeAdvancedReperfusionMonitoringSafetyCheck,
      issue:
        "stroke advanced reperfusion safety checks must include CTA, MRA, CT perfusion, MR perfusion, or vascular imaging for thrombectomy selection, NIHSS, modified Rankin, ASPECTS, large-vessel occlusion, 6-hour, 24-hour, salvageable-tissue, or thrombectomy eligibility review, stroke-service, stroke-unit, stroke-physician, post-thrombolysis complication, follow-up imaging, or re-imaging monitoring, aspirin, antiplatelet, anticoagulation, 24-hour, dysphagia, enteral, rectal, or swallow-route timing review, and oxygen, glucose, temperature, or dysphagia/swallow supportive safety checks",
    },
    {
      name: "pe_time_critical_actions",
      label: "PE risk and imaging pathway",
      applies: requiresPeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasPeTimeCriticalActions,
      issue:
        "PE time-critical actions must include risk stratification, hemodynamic or RV-strain assessment, and imaging or bedside-echo pathway plus therapeutic anticoagulation, a specific anticoagulant such as UFH/heparin/LMWH/DOAC, or thrombolysis/embolectomy action",
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
      name: "pe_reperfusion_escalation_safety",
      label: "PE reperfusion escalation safety",
      applies: requiresPeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasPeReperfusionEscalationSafetyCheck,
      issue:
        "PE reperfusion escalation safety checks must include anticoagulation initiation or contraindication planning, systemic thrombolysis indication review for high-risk PE with shock, persistent hypotension, cardiac arrest, or hemodynamic instability, catheter-directed therapy or surgical/catheter embolectomy backup when thrombolysis is contraindicated, unavailable, or fails, unstable-patient bedside echo or no-delay imaging logic, renal/contrast or pregnancy alternative imaging review, and PERT, ICU, transfer, or specialist escalation",
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
    {
      name: "acs_medication_reperfusion_safety",
      label: "ACS medication and reperfusion safety",
      applies: requiresAcsSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcsMedicationReperfusionSafetyCheck,
      issue:
        "ACS medication and reperfusion safety checks must include nitroglycerin or nitrate hypotension, right-ventricular/inferior MI, or PDE5-inhibitor review, oxygen use tied to hypoxia or saturation, beta-blocker contraindication review, and PCI or fibrinolysis timing or contraindication planning",
    },
    {
      name: "aortic_dissection_time_critical_actions",
      label: "Aortic dissection imaging and escalation",
      applies: requiresAorticDissectionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAorticDissectionTimeCriticalActions,
      issue:
        "aortic dissection time-critical actions must include definitive aortic imaging, anti-impulse blood pressure or heart-rate control, cardiothoracic, cardiac surgery, vascular surgery, transfer, or aortic-team escalation, and specific type A open aortic repair, ascending aortic repair, aortic replacement, intimal tear excision, Bentall, operative repair, surgical repair, or complicated type B TEVAR/endovascular repair pathway",
    },
    {
      name: "aortic_dissection_treatment_safety",
      label: "Aortic dissection impulse and complication safety",
      applies: requiresAorticDissectionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAorticDissectionTreatmentSafetyCheck,
      issue:
        "aortic dissection safety checks must include antithrombotic or thrombolysis avoidance, beta-blocker-before-vasodilator impulse control safety, and malperfusion, rupture, tamponade, or aortic regurgitation complications",
    },
    {
      name: "aortic_dissection_monitoring_targets_safety",
      label: "Aortic dissection monitoring and targets",
      applies: requiresAorticDissectionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAorticDissectionMonitoringTargetsSafetyCheck,
      issue:
        "aortic dissection monitoring safety checks must include continuous BP or arterial-line monitoring with access or urine-output tracking, analgesia or morphine pain control, explicit heart-rate or systolic BP targets, and type A surgical emergency or complicated type B TEVAR, endovascular, or surgical pathway planning",
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
