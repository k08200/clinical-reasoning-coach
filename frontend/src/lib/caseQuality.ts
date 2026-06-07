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
  "meningococcemia",
  "meningococcal",
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

const ECTOPIC_PREGNANCY_MTX_SAFETY_TERMS = [
  "breastfeeding",
  "cbc",
  "liver",
  "methotrexate",
  "renal",
  "rupture",
  "unstable",
  "간기능",
  "메토트렉세이트",
  "신장",
  "파열",
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
  "magnesium",
  "magnesium sulfate",
  "mgso4",
  "seizure prophylaxis",
  "seizure treatment",
  "황산마그네슘",
];

const SEVERE_PREECLAMPSIA_ANTIHYPERTENSIVE_ACTION_TERMS = [
  "acute severe hypertension",
  "antihypertensive",
  "blood pressure",
  "hydralazine",
  "labetalol",
  "nifedipine",
  "severe-range",
  "혈압",
];

const SEVERE_PREECLAMPSIA_DELIVERY_ACTION_TERMS = [
  "antenatal corticosteroid",
  "delivery",
  "fetal",
  "maternal-fetal",
  "obstetric",
  "placenta",
  "stabilize",
  "분만",
  "태아",
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

const SEVERE_PREECLAMPSIA_MAGNESIUM_TOX_SAFETY_TERMS = [
  "calcium gluconate",
  "deep tendon reflex",
  "magnesium toxicity",
  "respiratory depression",
  "respiratory rate",
  "urine output",
  "반사",
  "소변",
];

const SEVERE_PREECLAMPSIA_BP_MED_SAFETY_TERMS = [
  "asthma",
  "bradycardia",
  "heart failure",
  "hypotension",
  "labetalol",
  "nifedipine",
  "혈압",
];

const SEVERE_PREECLAMPSIA_LAB_ORGAN_SAFETY_TERMS = [
  "alt",
  "ast",
  "creatinine",
  "hellp",
  "liver",
  "platelet",
  "proteinuria",
  "renal",
  "간",
  "신장",
  "혈소판",
];

const SEVERE_PREECLAMPSIA_MATERNAL_FETAL_SAFETY_TERMS = [
  "abruption",
  "fetal",
  "gestational age",
  "headache",
  "pulmonary edema",
  "right upper quadrant",
  "seizure",
  "visual",
  "태아",
  "폐부종",
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

const HYPERTENSIVE_EMERGENCY_BP_CONFIRM_MONITOR_ACTION_TERMS = [
  "arterial line",
  "blood pressure confirmation",
  "continuous bp",
  "icu",
  "monitored setting",
  "repeat bp",
  "repeat blood pressure",
  "telemetry",
  "반복 혈압",
  "중환자",
];

const HYPERTENSIVE_EMERGENCY_ORGAN_ASSESSMENT_ACTION_TERMS = [
  "aki",
  "aortic dissection",
  "chest x-ray",
  "creatinine",
  "ct head",
  "ecg",
  "encephalopathy",
  "fundoscopic",
  "neurologic",
  "pulmonary edema",
  "renal",
  "troponin",
  "urinalysis",
  "장기 손상",
];

const HYPERTENSIVE_EMERGENCY_IV_TREATMENT_ACTION_TERMS = [
  "clevidipine",
  "esmolol",
  "fenoldopam",
  "iv antihypertensive",
  "iv labetalol",
  "labetalol",
  "nicardipine",
  "nitroglycerin",
  "nitroprusside",
  "titrated infusion",
  "정맥",
];

const HYPERTENSIVE_EMERGENCY_BP_TARGET_ACTION_TERMS = [
  "20 to 25%",
  "20-25%",
  "25%",
  "first hour",
  "gradual",
  "map",
  "mean arterial pressure",
  "not abruptly",
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

const HYPERTENSIVE_EMERGENCY_OVERLOWERING_SAFETY_TERMS = [
  "avoid rapid",
  "cerebral hypoperfusion",
  "gradual",
  "hypoperfusion",
  "hypotension",
  "no more than 25%",
  "not abruptly",
  "overcorrection",
  "과교정",
];

const HYPERTENSIVE_EMERGENCY_CONDITION_MED_SAFETY_TERMS = [
  "aortic dissection",
  "asthma",
  "beta blocker",
  "bradycardia",
  "heart failure",
  "ischemic stroke",
  "pregnancy",
  "pulmonary edema",
  "renal failure",
  "stroke",
  "금기",
];

const HYPERTENSIVE_EMERGENCY_DISPOSITION_SAFETY_TERMS = [
  "arterial line",
  "continuous",
  "icu",
  "monitored",
  "reassessment",
  "telemetry",
  "titration",
  "중환자",
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

const GIANT_CELL_ARTERITIS_STEROID_ACTION_TERMS = [
  "corticosteroid",
  "glucocorticoid",
  "high-dose prednisone",
  "iv methylprednisolone",
  "methylprednisolone",
  "prednisone",
  "prednisolone",
  "steroid",
  "스테로이드",
];

const GIANT_CELL_ARTERITIS_LAB_ACTION_TERMS = [
  "cbc",
  "crp",
  "erythrocyte sedimentation rate",
  "esr",
  "inflammatory marker",
  "platelet",
  "혈소판",
];

const GIANT_CELL_ARTERITIS_DIAGNOSTIC_ACTION_TERMS = [
  "biopsy",
  "color doppler",
  "halo sign",
  "temporal artery biopsy",
  "temporal artery ultrasound",
  "ultrasound",
  "초음파",
  "생검",
];

const GIANT_CELL_ARTERITIS_ESCALATION_ACTION_TERMS = [
  "emergency",
  "ophthalmology",
  "rheumatology",
  "same-day",
  "urgent referral",
  "vision loss",
  "visual symptom",
  "응급",
  "안과",
  "류마티스",
];

const GIANT_CELL_ARTERITIS_DO_NOT_DELAY_SAFETY_TERMS = [
  "before biopsy",
  "do not delay",
  "do not wait",
  "immediate",
  "not delay",
  "same day",
  "지연",
  "즉시",
];

const GIANT_CELL_ARTERITIS_VISION_ISCHEMIA_SAFETY_TERMS = [
  "amaurosis fugax",
  "cranial ischemia",
  "diplopia",
  "stroke",
  "visual disturbance",
  "vision loss",
  "시력",
];

const GIANT_CELL_ARTERITIS_STEROID_RISK_SAFETY_TERMS = [
  "bone protection",
  "diabetes",
  "fracture",
  "glucose",
  "infection",
  "osteoporosis",
  "ppi",
  "steroid toxicity",
  "위장",
  "혈당",
];

const GIANT_CELL_ARTERITIS_FOLLOWUP_SAFETY_TERMS = [
  "large vessel",
  "polymyalgia rheumatica",
  "relapse",
  "taper",
  "tocilizumab",
  "vascular imaging",
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

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_ASSESSMENT_ACTION_TERMS = [
  "gonioscopy",
  "intraocular pressure",
  "iop",
  "slit lamp",
  "tonometry",
  "안압",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_AQUEOUS_SUPPRESSANT_ACTION_TERMS = [
  "apraclonidine",
  "beta blocker",
  "brimonidine",
  "dorzolamide",
  "timolol",
  "topical",
  "점안",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_SYSTEMIC_IOP_ACTION_TERMS = [
  "acetazolamide",
  "diamox",
  "glycerol",
  "isosorbide",
  "mannitol",
  "osmotic",
  "systemic",
  "아세타졸아마이드",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_DEFINITIVE_ACTION_TERMS = [
  "iridectomy",
  "iridotomy",
  "laser peripheral iridotomy",
  "lpi",
  "ophthalmology",
  "urgent ophthalmology",
  "안과",
  "홍채절개",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_MED_CONTRA_SAFETY_TERMS = [
  "acetazolamide allergy",
  "asthma",
  "bradycardia",
  "copd",
  "renal failure",
  "sulfa allergy",
  "timolol",
  "금기",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_SAFETY_TERMS = [
  "avoid pilocarpine",
  "corneal edema",
  "defer pilocarpine",
  "high iop",
  "lens-induced",
  "pilocarpine",
  "phacomorphic",
  "pupil block",
  "필로카르핀",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_SAFETY_TERMS = [
  "bilateral",
  "both eyes",
  "fellow eye",
  "prophylactic iridotomy",
  "second eye",
  "양안",
];

const ACUTE_ANGLE_CLOSURE_GLAUCOMA_MONITORING_SAFETY_TERMS = [
  "corneal edema",
  "optic nerve",
  "recheck iop",
  "repeat iop",
  "visual acuity",
  "vision loss",
  "시력",
  "안압 재측정",
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

const RETINAL_DETACHMENT_VISUAL_ASSESSMENT_ACTION_TERMS = [
  "afferent pupillary defect",
  "apd",
  "dilated fundus",
  "fundoscopy",
  "pupil",
  "red reflex",
  "relative afferent pupillary defect",
  "visual acuity",
  "visual field",
  "산동",
  "시력",
  "시야",
];

const RETINAL_DETACHMENT_RETINAL_EXAM_ACTION_TERMS = [
  "b-scan",
  "dilated exam",
  "dilated retinal exam",
  "indirect ophthalmoscopy",
  "ocular ultrasound",
  "ophthalmoscopy",
  "retinal exam",
  "slit lamp",
  "ultrasound",
  "안저",
  "초음파",
];

const RETINAL_DETACHMENT_URGENT_SPECIALIST_ACTION_TERMS = [
  "emergency department",
  "emergency ophthalmology",
  "ophthalmology",
  "retina specialist",
  "retinal surgery",
  "same-day",
  "urgent ophthalmology",
  "urgent referral",
  "vitreoretinal",
  "응급",
  "안과",
];

const RETINAL_DETACHMENT_DEFINITIVE_REPAIR_ACTION_TERMS = [
  "cryotherapy",
  "laser retinopexy",
  "pneumatic retinopexy",
  "retinal repair",
  "scleral buckle",
  "surgery",
  "vitrectomy",
  "레이저",
  "수술",
];

const RETINAL_DETACHMENT_DELAY_SAFETY_TERMS = [
  "do not delay",
  "emergency",
  "immediate",
  "not delay",
  "same day",
  "urgent",
  "응급",
  "즉시",
  "지연",
];

const RETINAL_DETACHMENT_MACULA_SAFETY_TERMS = [
  "central vision",
  "macula",
  "macula off",
  "macula on",
  "macular involvement",
  "visual field",
  "중심시력",
  "황반",
];

const RETINAL_DETACHMENT_DIFFERENTIAL_SAFETY_TERMS = [
  "migraine",
  "posterior vitreous detachment",
  "pvd",
  "retinal tear",
  "vitreous hemorrhage",
  "vitreous detachment",
  "감별",
  "망막 열공",
];

const RETINAL_DETACHMENT_PRECAUTION_SAFETY_TERMS = [
  "avoid eye pressure",
  "head position",
  "nothing by mouth",
  "npo",
  "progression",
  "recheck",
  "return precautions",
  "worsening vision",
  "금식",
  "악화",
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

const CENTRAL_RETINAL_ARTERY_OCCLUSION_ONSET_STROKE_ACTION_TERMS = [
  "last known well",
  "last-known-normal",
  "last-known-well",
  "onset",
  "stroke activation",
  "stroke center",
  "stroke code",
  "stroke pathway",
  "symptom onset",
  "증상 발생",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_OPHTHALMIC_CONFIRM_ACTION_TERMS = [
  "cherry red spot",
  "dilated fundus",
  "fundus exam",
  "fundus photograph",
  "ophthalmology",
  "optic disc",
  "retinal exam",
  "retinal whitening",
  "visual acuity",
  "안저",
  "시력",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_VASCULAR_WORKUP_ACTION_TERMS = [
  "brain imaging",
  "carotid",
  "cta",
  "ct angiography",
  "ecg",
  "echocardiogram",
  "embol",
  "mra",
  "mri",
  "stroke workup",
  "vascular imaging",
  "혈관",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_REPERFUSION_ACTION_TERMS = [
  "alteplase",
  "fibrinolysis",
  "reperfusion",
  "thrombolysis",
  "thrombolytic",
  "tnk",
  "tpa",
  "혈전용해",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_MIMIC_SAFETY_TERMS = [
  "acute optic neuropathy",
  "gca",
  "giant cell arteritis",
  "migraine",
  "optic neuritis",
  "retinal detachment",
  "vitreous hemorrhage",
  "감별",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_THROMBOLYSIS_SAFETY_TERMS = [
  "anticoagulant",
  "bleeding",
  "blood pressure",
  "contraindication",
  "hemorrhage",
  "inr",
  "platelet",
  "recent surgery",
  "thrombolysis eligibility",
  "금기",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_SECONDARY_PREVENTION_SAFETY_TERMS = [
  "antiplatelet",
  "atrial fibrillation",
  "carotid stenosis",
  "risk factor",
  "secondary prevention",
  "statin",
  "stroke prevention",
  "vascular risk",
  "예방",
];

const CENTRAL_RETINAL_ARTERY_OCCLUSION_ARTERITIC_SAFETY_TERMS = [
  "crp",
  "esr",
  "giant cell arteritis",
  "jaw claudication",
  "scalp tenderness",
  "steroid",
  "temporal arteritis",
  "temporal headache",
  "측두",
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

const OPEN_GLOBE_SHIELD_ACTION_TERMS = [
  "eye shield",
  "protective shield",
  "rigid shield",
  "shield",
  "안대",
  "보호대",
];

const OPEN_GLOBE_ANTIBIOTIC_TETANUS_ACTION_TERMS = [
  "antibiotic",
  "ceftazidime",
  "fluoroquinolone",
  "iv antibiotics",
  "moxifloxacin",
  "systemic antibiotic",
  "tetanus",
  "vancomycin",
  "파상풍",
  "항생제",
];

const OPEN_GLOBE_TETANUS_ACTION_TERMS = [
  "tdap",
  "tetanus",
  "tetanus prophylaxis",
  "tetanus vaccine",
  "파상풍",
];

const OPEN_GLOBE_IMAGING_ACTION_TERMS = [
  "ct",
  "ct orbit",
  "ct orbits",
  "foreign body",
  "intraocular foreign body",
  "orbital ct",
  "x-ray",
  "영상",
];

const OPEN_GLOBE_OPHTHALMOLOGY_SURGERY_ACTION_TERMS = [
  "globe exploration",
  "ophthalmology",
  "operative repair",
  "surgical repair",
  "surgery",
  "urgent ophthalmology",
  "안과",
  "수술",
];

const OPEN_GLOBE_NO_PRESSURE_SAFETY_TERMS = [
  "avoid pressure",
  "do not press",
  "no pressure",
  "not patch",
  "pressure patch",
  "tonometry",
  "ultrasound",
  "압박",
  "안압",
];

const OPEN_GLOBE_NPO_ANTIEMETIC_SAFETY_TERMS = [
  "analgesia",
  "antiemetic",
  "nausea",
  "nothing by mouth",
  "npo",
  "pain control",
  "vomiting",
  "구토",
  "금식",
];

const OPEN_GLOBE_FOREIGN_BODY_MRI_SAFETY_TERMS = [
  "do not remove",
  "foreign body",
  "intraocular foreign body",
  "leave in place",
  "metallic",
  "mri",
  "remove foreign body",
  "금속",
];

const OPEN_GLOBE_ENDOPHTHALMITIS_FOLLOWUP_SAFETY_TERMS = [
  "endophthalmitis",
  "intravitreal",
  "posttraumatic infection",
  "recheck",
  "sympathetic ophthalmia",
  "vision prognosis",
  "감염",
  "안내염",
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

const NEUTROPENIC_FEVER_CULTURE_ACTION_TERMS = [
  "blood culture",
  "central line culture",
  "culture",
  "cultures",
  "peripheral culture",
  "source",
  "urinalysis",
  "배양",
];

const NEUTROPENIC_FEVER_ANTIPSEUDOMONAL_ACTION_TERMS = [
  "anti-pseudomonal",
  "antipseudomonal",
  "broad-spectrum antibiotic",
  "cefepime",
  "ceftazidime",
  "empiric antibiotic",
  "meropenem",
  "piperacillin",
  "tazobactam",
  "within 1 hour",
  "항생제",
];

const NEUTROPENIC_FEVER_ESCALATION_ACTION_TERMS = [
  "admit",
  "cisne",
  "hematology",
  "icu",
  "mascc",
  "oncology",
  "risk score",
  "risk stratification",
  "sepsis",
  "입원",
  "혈액",
  "종양",
];

const NEUTROPENIC_FEVER_ANTIBIOTIC_SAFETY_TERMS = [
  "allergy",
  "antibiogram",
  "creatinine",
  "hepatic",
  "kidney",
  "liver",
  "renal",
  "toxicity",
  "간",
  "신장",
];

const NEUTROPENIC_FEVER_CATHETER_RESISTANCE_SAFETY_TERMS = [
  "catheter",
  "central line",
  "gram-positive",
  "local microbiology",
  "mrsa",
  "pneumonia",
  "resistant",
  "skin",
  "soft tissue",
  "vancomycin",
  "중심정맥",
];

const NEUTROPENIC_FEVER_RISK_DISPOSITION_SAFETY_TERMS = [
  "cisne",
  "comorbidity",
  "discharge",
  "high risk",
  "low risk",
  "mascc",
  "outpatient",
  "return precautions",
  "risk score",
  "social",
  "퇴원",
];

const NEUTROPENIC_FEVER_REASSESSMENT_SAFETY_TERMS = [
  "antifungal",
  "deterioration",
  "fungal",
  "persistent fever",
  "reassess",
  "reassessment",
  "resistant",
  "72 hours",
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

const OBSTRUCTIVE_PYELONEPHRITIS_CULTURE_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "blood culture",
  "cefepime",
  "ceftriaxone",
  "culture",
  "piperacillin",
  "urine culture",
  "항생제",
  "배양",
];

const OBSTRUCTIVE_PYELONEPHRITIS_IMAGING_OBSTRUCTION_ACTION_TERMS = [
  "ct",
  "hydronephrosis",
  "obstruction",
  "obstructive",
  "stone",
  "ultrasound",
  "ureteral stone",
  "urolithiasis",
  "수신증",
  "요로결석",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_ACTION_TERMS = [
  "decompression",
  "drainage",
  "nephrostomy",
  "pcn",
  "percutaneous nephrostomy",
  "stent",
  "ureteral stent",
  "urology",
  "urgent decompression",
  "배액",
  "스텐트",
];

const OBSTRUCTIVE_PYELONEPHRITIS_SEPSIS_SUPPORT_ACTION_TERMS = [
  "fluid",
  "icu",
  "lactate",
  "sepsis",
  "septic shock",
  "shock",
  "vasopressor",
  "쇼크",
  "수액",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DELAY_STONE_SAFETY_TERMS = [
  "defer",
  "definitive stone",
  "delay",
  "lithotripsy",
  "postpone",
  "stone removal",
  "until infection",
  "until sepsis",
  "지연",
];

const OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_OPTION_SAFETY_TERMS = [
  "decompression",
  "drainage",
  "nephrostomy",
  "pcn",
  "percutaneous nephrostomy",
  "retrograde",
  "stent",
  "ureteral stent",
  "배액",
  "스텐트",
];

const OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_SAFETY_TERMS = [
  "antibiogram",
  "antibiotic adjustment",
  "culture result",
  "renal dosing",
  "reassess",
  "resistance",
  "source control",
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

const SEVERE_HYPOGLYCEMIA_DEXTROSE_GLUCAGON_ACTION_TERMS = [
  "carbohydrate",
  "d10",
  "d50",
  "dextrose",
  "glucagon",
  "oral glucose",
  "iv sugar",
  "oral sugar",
  "sugar",
  "포도당",
];

const SEVERE_HYPOGLYCEMIA_RECHECK_FEEDING_ACTION_TERMS = [
  "15 minutes",
  "complex carbohydrate",
  "continuous dextrose",
  "dextrose infusion",
  "meal",
  "protein",
  "recheck",
  "repeat glucose",
  "snack",
  "재측정",
];

const SEVERE_HYPOGLYCEMIA_ESCALATION_CAUSE_ACTION_TERMS = [
  "admit",
  "altered mental status",
  "cause",
  "hospitalize",
  "long-acting insulin",
  "octreotide",
  "renal failure",
  "seizure",
  "sulfonylurea",
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

const SEVERE_HYPOGLYCEMIA_RECURRENCE_MED_SAFETY_TERMS = [
  "long-acting insulin",
  "octreotide",
  "observation",
  "rebound",
  "recurrent",
  "sulfonylurea",
  "재발",
];

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
  "100% oxygen",
  "산소",
];

const MALIGNANT_HYPERTHERMIA_DANTROLENE_ACTION_TERMS = [
  "dantrium",
  "dantrolene",
  "revonto",
  "ryanodex",
  "단트롤렌",
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

const MALIGNANT_HYPERTHERMIA_METABOLIC_SAFETY_TERMS = [
  "acidosis",
  "arrhythmia",
  "blood gas",
  "calcium",
  "ck",
  "creatine kinase",
  "hyperkalemia",
  "potassium",
  "rhabdomyolysis",
  "횡문근",
  "칼륨",
];

const MALIGNANT_HYPERTHERMIA_MONITORING_SAFETY_TERMS = [
  "core temperature",
  "etco2",
  "end-tidal",
  "myoglobin",
  "urine output",
  "vital signs",
  "소변",
];

const MALIGNANT_HYPERTHERMIA_DANTROLENE_SAFETY_TERMS = [
  "calcium channel blocker",
  "dantrolene",
  "dose",
  "recrudescence",
  "repeat dose",
  "weakness",
  "단트롤렌",
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
  "rate control",
  "tachycardia",
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

const THYROID_STORM_STEROID_SUPPORT_ACTION_TERMS = [
  "acetaminophen",
  "cooling",
  "dexamethasone",
  "glucocorticoid",
  "hydrocortisone",
  "icu",
  "supportive care",
  "steroid",
  "냉각",
  "스테로이드",
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

const THYROID_STORM_DRUG_LIVER_SAFETY_TERMS = [
  "agranulocytosis",
  "cbc",
  "hepatotoxicity",
  "liver",
  "pregnancy",
  "ptu",
  "transaminase",
  "간",
  "임신",
];

const THYROID_STORM_TRIGGER_MONITORING_SAFETY_TERMS = [
  "arrhythmia",
  "atrial fibrillation",
  "infection",
  "mi",
  "precipitant",
  "pulmonary embolism",
  "thyroidectomy",
  "trigger",
  "감염",
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
  "rectal temperature",
  "temperature",
  "thermometer",
  "심부체온",
  "직장체온",
];

const HEAT_STROKE_RAPID_COOLING_ACTION_TERMS = [
  "cold water immersion",
  "cool first",
  "cooling",
  "evaporative cooling",
  "ice bath",
  "ice water immersion",
  "rapid cooling",
  "whole-body cooling",
  "냉각",
];

const HEAT_STROKE_ABC_FLUID_ACTION_TERMS = [
  "airway",
  "circulation",
  "iv fluid",
  "iv fluids",
  "normal saline",
  "oxygen",
  "resuscitation",
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

const HEAT_STROKE_ANTIPYRETIC_SAFETY_TERMS = [
  "acetaminophen",
  "antipyretic",
  "dantrolene",
  "not recommended",
  "nsaid",
  "avoid",
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

const CAUDA_EQUINA_MRI_ACTION_TERMS = [
  "emergency mri",
  "immediate mri",
  "lumbar mri",
  "mri",
  "urgent mri",
  "응급 mri",
  "자기공명",
];

const CAUDA_EQUINA_BLADDER_ACTION_TERMS = [
  "bladder scan",
  "incontinence",
  "post-void residual",
  "postvoid residual",
  "pvr",
  "urinary retention",
  "voiding",
  "배뇨",
  "요정체",
];

const CAUDA_EQUINA_NEURO_EXAM_ACTION_TERMS = [
  "anal tone",
  "lower limb weakness",
  "motor deficit",
  "perianal",
  "perineal",
  "saddle anesthesia",
  "saddle anaesthesia",
  "sensory deficit",
  "항문긴장도",
  "회음부",
];

const CAUDA_EQUINA_SPINE_ESCALATION_ACTION_TERMS = [
  "decompression",
  "neurosurgery",
  "operative",
  "spine surgeon",
  "spine surgery",
  "surgical referral",
  "urgent surgery",
  "감압",
  "신경외과",
  "척추",
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

const ACUTE_COMPARTMENT_SYNDROME_DECOMPRESSION_ACTION_TERMS = [
  "fasciotomy",
  "orthopedic",
  "orthopaedic",
  "surgical decompression",
  "surgical emergency",
  "surgery",
  "urgent decompression",
  "정형외과",
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
  "surgical",
  "thrombectomy",
  "vascular surgery",
  "vascular surgeon",
  "혈관외과",
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
  "orchiopexy",
  "scrotal exploration",
  "surgical exploration",
  "urology",
  "urgent exploration",
  "urgent surgery",
  "uro consult",
  "비뇨",
  "수술",
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

const OVARIAN_TORSION_SURGICAL_ACTION_TERMS = [
  "diagnostic laparoscopy",
  "detorsion",
  "gynecology",
  "laparoscopy",
  "ob/gyn",
  "obgyn",
  "surgical evaluation",
  "urgent surgery",
  "산부인과",
  "수술",
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

const SPINAL_EPIDURAL_ABSCESS_MRI_ACTION_TERMS = [
  "contrast mri",
  "emergency mri",
  "immediate mri",
  "mri",
  "mri spine",
  "spine mri",
  "whole spine",
  "응급 mri",
];

const SPINAL_EPIDURAL_ABSCESS_CULTURE_LAB_ACTION_TERMS = [
  "blood culture",
  "blood cultures",
  "crp",
  "culture",
  "cultures",
  "esr",
  "source culture",
  "배양",
  "혈액배양",
];

const SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "cefepime",
  "ceftriaxone",
  "empiric",
  "meropenem",
  "vancomycin",
  "항생제",
];

const SPINAL_EPIDURAL_ABSCESS_SURGERY_ACTION_TERMS = [
  "decompression",
  "drainage",
  "neurosurgery",
  "source control",
  "spine surgery",
  "surgical consultation",
  "surgical decompression",
  "감압",
  "신경외과",
];

const SPINAL_EPIDURAL_ABSCESS_NEURO_SEPSIS_SAFETY_TERMS = [
  "bowel",
  "bladder",
  "neurologic",
  "paralysis",
  "sepsis",
  "serial exam",
  "weakness",
  "신경",
  "패혈증",
];

const SPINAL_EPIDURAL_ABSCESS_RISK_SOURCE_SAFETY_TERMS = [
  "bacteremia",
  "diabetes",
  "endocarditis",
  "immunosuppression",
  "iv drug",
  "ivdu",
  "recent spinal procedure",
  "source",
  "staphylococcus",
  "감염원",
];

const SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_TIMING_SAFETY_TERMS = [
  "after blood cultures",
  "biopsy",
  "blood culture",
  "culture before",
  "do not delay",
  "empiric antibiotics",
  "neurologic compromise",
  "unstable",
  "배양",
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

const SEPTIC_ARTHRITIS_ARTHROCENTESIS_ACTION_TERMS = [
  "arthrocentesis",
  "aspiration",
  "joint aspiration",
  "synovial aspiration",
  "synovial fluid",
  "tap",
  "관절천자",
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

const SEPTIC_ARTHRITIS_ANTIBIOTIC_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "ceftriaxone",
  "empiric",
  "vancomycin",
  "항생제",
];

const SEPTIC_ARTHRITIS_DRAINAGE_ORTHO_ACTION_TERMS = [
  "arthroscopy",
  "drainage",
  "irrigation",
  "orthopedic",
  "orthopedics",
  "surgical washout",
  "washout",
  "정형외과",
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

const UPPER_GI_BLEED_RESUSCITATION_ACTION_TERMS = [
  "blood pressure",
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

const UPPER_GI_BLEED_TRANSFUSION_LAB_ACTION_TERMS = [
  "cbc",
  "crossmatch",
  "hemoglobin",
  "inr",
  "packed red blood",
  "prbc",
  "restrictive transfusion",
  "transfusion",
  "type and screen",
  "수혈",
];

const UPPER_GI_BLEED_ENDOSCOPY_ACTION_TERMS = [
  "early endoscopy",
  "endoscopic hemostasis",
  "endoscopy",
  "egd",
  "gastroenterology",
  "gi consult",
  "within 24 hours",
  "내시경",
];

const UPPER_GI_BLEED_PPI_VARICEAL_ACTION_TERMS = [
  "antibiotic",
  "ceftriaxone",
  "octreotide",
  "ppi",
  "proton pump",
  "somatostatin",
  "terlipressin",
  "vasoactive",
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

const ACUTE_CHOLECYSTITIS_ANTIBIOTIC_CULTURE_ACTION_TERMS = [
  "antibiotic",
  "bile culture",
  "blood culture",
  "broad-spectrum",
  "ceftriaxone",
  "culture",
  "piperacillin",
  "항생제",
];

const ACUTE_CHOLECYSTITIS_IMAGING_ACTION_TERMS = [
  "ct",
  "gallbladder wall",
  "hidascan",
  "murphy",
  "pericholecystic",
  "ruq ultrasound",
  "sonographic",
  "ultrasound",
  "초음파",
];

const ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_ACTION_TERMS = [
  "cholecystectomy",
  "cholecystostomy",
  "drainage",
  "gallbladder drainage",
  "laparoscopic",
  "lap-c",
  "percutaneous",
  "ptgbd",
  "담낭절제",
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

const ACUTE_CHOLANGITIS_ANTIBIOTIC_SUPPORT_ACTION_TERMS = [
  "antibiotic",
  "antibiotics",
  "broad-spectrum",
  "cefepime",
  "ceftriaxone",
  "piperacillin",
  "supportive care",
  "tazobactam",
  "항생제",
];

const ACUTE_CHOLANGITIS_CULTURE_LAB_ACTION_TERMS = [
  "bilirubin",
  "blood culture",
  "blood cultures",
  "bile culture",
  "crp",
  "inflammatory",
  "lft",
  "liver function",
  "wbc",
  "배양",
  "빌리루빈",
];

const ACUTE_CHOLANGITIS_IMAGING_OBSTRUCTION_ACTION_TERMS = [
  "biliary dilatation",
  "biliary dilation",
  "common bile duct",
  "ct",
  "mrcp",
  "obstruction",
  "stone",
  "stricture",
  "ultrasound",
  "초음파",
];

const ACUTE_CHOLANGITIS_DRAINAGE_ACTION_TERMS = [
  "biliary decompression",
  "biliary drainage",
  "drainage",
  "ercp",
  "nasobiliary",
  "ptbd",
  "stent",
  "percutaneous transhepatic",
  "담도 배액",
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

const ACUTE_PANCREATITIS_ERCP_CHOLANGITIS_SAFETY_TERMS = [
  "biliary obstruction",
  "cholangitis",
  "ercp",
  "jaundice",
  "no cholangitis",
  "without cholangitis",
  "담관염",
];

const ACUTE_PANCREATITIS_ANTIBIOTIC_SAFETY_TERMS = [
  "antibiotic",
  "extrapancreatic infection",
  "infected necrosis",
  "prophylactic antibiotics",
  "sterile necrosis",
  "항생제",
];

const ACUTE_PANCREATITIS_NUTRITION_SAFETY_TERMS = [
  "enteral",
  "feeding",
  "ng tube",
  "oral feeding",
  "parenteral",
  "tpn",
  "영양",
];

const ACUTE_PANCREATITIS_NECROSIS_PROCEDURE_SAFETY_TERMS = [
  "4 weeks",
  "drainage",
  "infected necrosis",
  "necrosis",
  "step-up",
  "walled-off",
  "췌장괴사",
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

const ACUTE_APPENDICITIS_SURGERY_ACTION_TERMS = [
  "appendectomy",
  "appendicectomy",
  "laparoscopic",
  "laparoscopy",
  "operation",
  "surgeon",
  "surgery",
  "surgical consult",
  "수술",
  "외과",
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

const ACUTE_MESENTERIC_ISCHEMIA_SURGERY_REVASCULARIZATION_ACTION_TERMS = [
  "embolectomy",
  "endovascular",
  "exploratory laparotomy",
  "laparotomy",
  "resection",
  "revascularization",
  "revascularisation",
  "sma",
  "vascular surgery",
  "혈관외과",
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

const NECROTIZING_SOFT_TISSUE_INFECTION_SURGERY_ACTION_TERMS = [
  "debridement",
  "exploration",
  "fasciotomy",
  "operative",
  "surgical consult",
  "surgical debridement",
  "surgical exploration",
  "surgery",
  "수술",
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

const RUPTURED_AAA_VASCULAR_ACTION_TERMS = [
  "aneurysm repair",
  "evar",
  "open repair",
  "operative repair",
  "vascular surgery",
  "vascular surgeon",
  "혈관외과",
  "수술",
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
  "calcium chloride",
  "calcium gluconate",
  "cardiac membrane",
  "iv calcium",
  "membrane stabilization",
  "칼슘",
];

const HYPERKALEMIA_SHIFT_ACTION_TERMS = [
  "albuterol",
  "dextrose",
  "glucose",
  "insulin",
  "salbutamol",
  "포도당",
  "인슐린",
];

const HYPERKALEMIA_REMOVAL_ACTION_TERMS = [
  "dialysis",
  "diuretic",
  "hemodialysis",
  "potassium binder",
  "potassium removal",
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

const STATUS_EPILEPTICUS_SECOND_LINE_ACTION_TERMS = [
  "antiseizure loading",
  "fosphenytoin",
  "levetiracetam",
  "phenobarbital",
  "phenytoin",
  "second-line",
  "valproate",
  "항경련제",
];

const STATUS_EPILEPTICUS_REFRACTORY_ACTION_TERMS = [
  "anesthetic infusion",
  "continuous eeg",
  "icu",
  "intubation",
  "neurology",
  "propofol",
  "refractory",
  "midazolam infusion",
  "뇌파",
  "중환자",
];

const STATUS_EPILEPTICUS_GLUCOSE_SAFETY_TERMS = [
  "dextrose",
  "glucose",
  "hypoglycemia",
  "thiamine",
  "저혈당",
  "티아민",
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
  "glucocorticoid",
  "hydrocortisone",
  "parenteral steroid",
  "stress dose",
  "steroid",
  "하이드로코르티손",
  "스테로이드",
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
  "hepatic",
  "inr",
  "lft",
  "liver",
  "poison center",
  "poison control",
  "toxicologist",
  "transplant",
  "간",
  "독성",
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

const TOXIC_ALCOHOL_GAP_LAB_ACTION_TERMS = [
  "anion gap",
  "ethylene glycol level",
  "methanol level",
  "osmol gap",
  "osmolal gap",
  "osmolar gap",
  "serum osmolality",
  "toxic alcohol level",
  "음이온차",
];

const TOXIC_ALCOHOL_ANTIDOTE_ACTION_TERMS = [
  "alcohol dehydrogenase",
  "ethanol antidote",
  "fomepizole",
  "포메피졸",
];

const TOXIC_ALCOHOL_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "dialysis",
  "extracorporeal",
  "hemodialysis",
  "nephrology",
  "poison center",
  "poison control",
  "toxicologist",
  "투석",
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

const SALICYLATE_LEVEL_ACID_BASE_ACTION_TERMS = [
  "abg",
  "anion gap",
  "blood gas",
  "electrolyte",
  "repeat level",
  "salicylate concentration",
  "salicylate level",
  "serial level",
  "vbg",
  "살리실산 농도",
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

const SALICYLATE_DIALYSIS_ESCALATION_ACTION_TERMS = [
  "dialysis",
  "hemodialysis",
  "nephrology",
  "poison center",
  "poison control",
  "toxicologist",
  "투석",
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
  "sodium thiosulfate",
  "thiosulfate",
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

const CYANIDE_HYDROXOCOBALAMIN_EFFECT_SAFETY_TERMS = [
  "blood pressure",
  "chromaturia",
  "dialysis",
  "hypertension",
  "lab interference",
  "red urine",
  "혈압",
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
  "intubation",
  "magnesium",
  "mechanical ventilation",
  "noninvasive ventilation",
  "respiratory failure",
  "마그네슘",
  "삽관",
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
  "88",
  "92",
  "controlled oxygen",
  "oxygen target",
  "spo2",
  "target saturation",
  "venturi",
  "산소",
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

const COPD_ANTIBIOTIC_CRITERIA_ACTION_TERMS = [
  "antibiotic",
  "infection",
  "pneumonia",
  "purulent sputum",
  "sputum purulence",
  "감염",
  "항생제",
];

const COPD_VENTILATORY_SUPPORT_ACTION_TERMS = [
  "bipap",
  "hypercapnia",
  "intubation",
  "niv",
  "noninvasive ventilation",
  "non-invasive ventilation",
  "respiratory acidosis",
  "respiratory failure",
  "기계환기",
  "비침습",
  "삽관",
];

const COPD_OXYGEN_CO2_SAFETY_TERMS = [
  "88",
  "92",
  "abg",
  "arterial blood gas",
  "co2",
  "controlled oxygen",
  "hypercapnia",
  "oxygen-induced",
  "paco2",
  "ph",
  "venturi",
  "동맥혈",
  "이산화탄소",
];

const COPD_NIV_INTUBATION_SAFETY_TERMS = [
  "abg",
  "altered mental status",
  "bipap",
  "fatigue",
  "hypercapnic acidosis",
  "intubation",
  "niv",
  "noninvasive ventilation",
  "ph",
  "respiratory acidosis",
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

const ACUTE_HF_OXYGEN_NIV_ACTION_TERMS = [
  "bipap",
  "cpap",
  "hypoxemia",
  "intubation",
  "niv",
  "noninvasive ventilation",
  "non-invasive ventilation",
  "oxygen",
  "positive pressure",
  "ventilation",
  "산소",
  "양압",
  "환기",
];

const ACUTE_HF_DIURETIC_ACTION_TERMS = [
  "bumetanide",
  "decongestion",
  "diuretic",
  "furosemide",
  "loop diuretic",
  "torsemide",
  "이뇨",
];

const ACUTE_HF_VASODILATOR_BP_ACTION_TERMS = [
  "afterload",
  "blood pressure",
  "hypertensive",
  "nitroglycerin",
  "nitrate",
  "nitroprusside",
  "vasodilator",
  "혈압",
  "혈관확장",
];

const ACUTE_HF_ESCALATION_ACTION_TERMS = [
  "cardiogenic shock",
  "icu",
  "inotrope",
  "intubation",
  "mechanical ventilation",
  "pressor",
  "respiratory failure",
  "shock",
  "vasopressor",
  "기계환기",
  "삽관",
  "쇼크",
  "중환자",
];

const ACUTE_HF_BP_VASODILATOR_SAFETY_TERMS = [
  "aortic stenosis",
  "blood pressure",
  "hypotension",
  "nitrate",
  "right ventricular infarct",
  "sildenafil",
  "vasodilator",
  "저혈압",
  "혈압",
];

const ACUTE_HF_RENAL_ELECTROLYTE_SAFETY_TERMS = [
  "creatinine",
  "electrolyte",
  "hypokalemia",
  "kidney",
  "magnesium",
  "potassium",
  "renal",
  "urine output",
  "신장",
  "전해질",
];

const ACUTE_HF_TRIGGER_DIFFERENTIAL_SAFETY_TERMS = [
  "acute coronary syndrome",
  "arrhythmia",
  "infection",
  "ischemia",
  "myocardial infarction",
  "pulmonary embolism",
  "trigger",
  "valvular",
  "감염",
  "부정맥",
  "심근경색",
];

const ACUTE_HF_SHOCK_RESPIRATORY_FAILURE_SAFETY_TERMS = [
  "altered mental status",
  "cardiogenic shock",
  "hypoperfusion",
  "hypotension",
  "intubation",
  "lactate",
  "respiratory failure",
  "shock",
  "저관류",
  "쇼크",
  "호흡부전",
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
  "pocus",
  "ultrasound",
  "심초음파",
  "초음파",
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
  "clinical diagnosis",
  "do not delay",
  "do not wait",
  "immediate drainage",
  "unstable",
  "urgent drainage",
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
  "needle decompression",
  "needle thoracostomy",
  "thoracostomy",
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
  "clinical diagnosis",
  "do not delay",
  "do not wait",
  "imaging",
  "unstable",
  "x-ray",
  "지연",
];

const TENSION_PNEUMOTHORAX_SITE_TECHNIQUE_SAFETY_TERMS = [
  "4th intercostal",
  "5th intercostal",
  "axillary",
  "large-bore",
  "midaxillary",
  "midclavicular",
  "site",
  "sterile",
  "technique",
  "위치",
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
  "shock",
  "trauma",
  "감별",
  "쇼크",
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

const AORTIC_DISSECTION_SURGICAL_ACTION_TERMS = [
  "aortic team",
  "cardiothoracic",
  "surgery",
  "surgical",
  "transfer",
  "type a",
  "vascular surgery",
  "대동맥팀",
  "심장외과",
  "수술",
  "전원",
  "혈관외과",
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

  const hasDirectContext = EPIGLOTTITIS_DIRECT_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  const hasAirwayContext = EPIGLOTTITIS_AIRWAY_CONTEXT_TERMS.some((term) =>
    containsSafetyTerm(riskText, term),
  );
  return hasDirectContext || hasAirwayContext;
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
  const hasLpOrCtPathway = CNS_INFECTION_LP_CT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSteroidTiming = CNS_INFECTION_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCultures && hasAntibiotics && hasLpOrCtPathway && hasSteroidTiming;
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
  const hasMtxSafety = ECTOPIC_PREGNANCY_MTX_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasHemodynamicSafety = ECTOPIC_PREGNANCY_HEMODYNAMIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasRhSafety && hasMtxSafety && hasHemodynamicSafety;
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
  const hasAntihypertensive = SEVERE_PREECLAMPSIA_ANTIHYPERTENSIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDeliveryPlanning = SEVERE_PREECLAMPSIA_DELIVERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = SEVERE_PREECLAMPSIA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasMagnesium && hasAntihypertensive && hasDeliveryPlanning && hasEscalation;
}

function hasSeverePreeclampsiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMagnesiumToxicitySafety = SEVERE_PREECLAMPSIA_MAGNESIUM_TOX_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasBpMedSafety = SEVERE_PREECLAMPSIA_BP_MED_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasLabOrganSafety = SEVERE_PREECLAMPSIA_LAB_ORGAN_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMaternalFetalSafety = SEVERE_PREECLAMPSIA_MATERNAL_FETAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasMagnesiumToxicitySafety &&
    hasBpMedSafety &&
    hasLabOrganSafety &&
    hasMaternalFetalSafety
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
  const hasBpConfirmationMonitoring =
    HYPERTENSIVE_EMERGENCY_BP_CONFIRM_MONITOR_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasOrganAssessment = HYPERTENSIVE_EMERGENCY_ORGAN_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasIvTreatment = HYPERTENSIVE_EMERGENCY_IV_TREATMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBpTarget = HYPERTENSIVE_EMERGENCY_BP_TARGET_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasBpConfirmationMonitoring && hasOrganAssessment && hasIvTreatment && hasBpTarget;
}

function hasHypertensiveEmergencyTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasUrgencyDifferentiation =
    HYPERTENSIVE_EMERGENCY_URGENCY_DIFFERENTIATION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasOverloweringSafety = HYPERTENSIVE_EMERGENCY_OVERLOWERING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasConditionMedSafety = HYPERTENSIVE_EMERGENCY_CONDITION_MED_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDispositionSafety = HYPERTENSIVE_EMERGENCY_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasUrgencyDifferentiation &&
    hasOverloweringSafety &&
    hasConditionMedSafety &&
    hasDispositionSafety
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
  const hasSteroid = GIANT_CELL_ARTERITIS_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasLabs = GIANT_CELL_ARTERITIS_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDiagnosticConfirmation = GIANT_CELL_ARTERITIS_DIAGNOSTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = GIANT_CELL_ARTERITIS_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasSteroid && hasLabs && hasDiagnosticConfirmation && hasEscalation;
}

function hasGiantCellArteritisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDoNotDelay = GIANT_CELL_ARTERITIS_DO_NOT_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasVisionIschemiaSafety = GIANT_CELL_ARTERITIS_VISION_ISCHEMIA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasSteroidRiskSafety = GIANT_CELL_ARTERITIS_STEROID_RISK_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasFollowupSafety = GIANT_CELL_ARTERITIS_FOLLOWUP_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDoNotDelay && hasVisionIschemiaSafety && hasSteroidRiskSafety && hasFollowupSafety;
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
  const hasIopAssessment = ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAqueousSuppression =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_AQUEOUS_SUPPRESSANT_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasSystemicIopLowering =
    ACUTE_ANGLE_CLOSURE_GLAUCOMA_SYSTEMIC_IOP_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasDefinitivePlan = ACUTE_ANGLE_CLOSURE_GLAUCOMA_DEFINITIVE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasIopAssessment && hasAqueousSuppression && hasSystemicIopLowering && hasDefinitivePlan;
}

function hasAcuteAngleClosureGlaucomaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMedContraSafety = ACUTE_ANGLE_CLOSURE_GLAUCOMA_MED_CONTRA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPilocarpineSafety = ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasFellowEyeSafety = ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMonitoringSafety = ACUTE_ANGLE_CLOSURE_GLAUCOMA_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasMedContraSafety && hasPilocarpineSafety && hasFellowEyeSafety && hasMonitoringSafety;
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
  const hasVisualAssessment = RETINAL_DETACHMENT_VISUAL_ASSESSMENT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRetinalExam = RETINAL_DETACHMENT_RETINAL_EXAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasUrgentSpecialist = RETINAL_DETACHMENT_URGENT_SPECIALIST_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDefinitiveRepair = RETINAL_DETACHMENT_DEFINITIVE_REPAIR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasVisualAssessment && hasRetinalExam && hasUrgentSpecialist && hasDefinitiveRepair;
}

function hasRetinalDetachmentTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDelaySafety = RETINAL_DETACHMENT_DELAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMaculaSafety = RETINAL_DETACHMENT_MACULA_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = RETINAL_DETACHMENT_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasPrecautionSafety = RETINAL_DETACHMENT_PRECAUTION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasDelaySafety && hasMaculaSafety && hasDifferentialSafety && hasPrecautionSafety;
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
  const hasOnsetStrokeAction = CENTRAL_RETINAL_ARTERY_OCCLUSION_ONSET_STROKE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasOphthalmicConfirmation =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_OPHTHALMIC_CONFIRM_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasVascularWorkup = CENTRAL_RETINAL_ARTERY_OCCLUSION_VASCULAR_WORKUP_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasReperfusionReview = CENTRAL_RETINAL_ARTERY_OCCLUSION_REPERFUSION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  return hasOnsetStrokeAction && hasOphthalmicConfirmation && hasVascularWorkup && hasReperfusionReview;
}

function hasCentralRetinalArteryOcclusionTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMimicSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_MIMIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasThrombolysisSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_THROMBOLYSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasSecondaryPrevention =
    CENTRAL_RETINAL_ARTERY_OCCLUSION_SECONDARY_PREVENTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasArteriticSafety = CENTRAL_RETINAL_ARTERY_OCCLUSION_ARTERITIC_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasMimicSafety && hasThrombolysisSafety && hasSecondaryPrevention && hasArteriticSafety;
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
  const hasShield = OPEN_GLOBE_SHIELD_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibioticTetanus = OPEN_GLOBE_ANTIBIOTIC_TETANUS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTetanus = OPEN_GLOBE_TETANUS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImaging = OPEN_GLOBE_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOphthalmologySurgery = OPEN_GLOBE_OPHTHALMOLOGY_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasShield && hasAntibioticTetanus && hasTetanus && hasImaging && hasOphthalmologySurgery;
}

function hasOpenGlobeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNoPressure = OPEN_GLOBE_NO_PRESSURE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNpoAntiemetic = OPEN_GLOBE_NPO_ANTIEMETIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasForeignBodyMri = OPEN_GLOBE_FOREIGN_BODY_MRI_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasEndophthalmitisFollowup = OPEN_GLOBE_ENDOPHTHALMITIS_FOLLOWUP_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasNoPressure && hasNpoAntiemetic && hasForeignBodyMri && hasEndophthalmitisFollowup;
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
  const hasCultures = NEUTROPENIC_FEVER_CULTURE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntipseudomonalAntibiotics = NEUTROPENIC_FEVER_ANTIPSEUDOMONAL_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = NEUTROPENIC_FEVER_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAncCheck && hasCultures && hasAntipseudomonalAntibiotics && hasEscalation;
}

function hasNeutropenicFeverTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasAntibioticSafety = NEUTROPENIC_FEVER_ANTIBIOTIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCatheterResistanceSafety = NEUTROPENIC_FEVER_CATHETER_RESISTANCE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRiskDispositionSafety = NEUTROPENIC_FEVER_RISK_DISPOSITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasReassessmentSafety = NEUTROPENIC_FEVER_REASSESSMENT_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasAntibioticSafety &&
    hasCatheterResistanceSafety &&
    hasRiskDispositionSafety &&
    hasReassessmentSafety
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
  const hasAntibioticsAndCultures =
    OBSTRUCTIVE_PYELONEPHRITIS_CULTURE_ANTIBIOTIC_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasObstructionImaging =
    OBSTRUCTIVE_PYELONEPHRITIS_IMAGING_OBSTRUCTION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  const hasDecompression = OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSepsisSupport = OBSTRUCTIVE_PYELONEPHRITIS_SEPSIS_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAntibioticsAndCultures && hasObstructionImaging && hasDecompression && hasSepsisSupport;
}

function hasObstructivePyelonephritisTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasDelayedStoneTreatment =
    OBSTRUCTIVE_PYELONEPHRITIS_DELAY_STONE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDrainageOptionReview =
    OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_OPTION_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasAntibioticReassessment =
    OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasComplicationRiskReview =
    OBSTRUCTIVE_PYELONEPHRITIS_COMPLICATION_RISK_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasDelayedStoneTreatment &&
    hasDrainageOptionReview &&
    hasAntibioticReassessment &&
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
  const hasDextroseOrGlucagon = SEVERE_HYPOGLYCEMIA_DEXTROSE_GLUCAGON_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasRecheckFeeding = SEVERE_HYPOGLYCEMIA_RECHECK_FEEDING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalationOrCause = SEVERE_HYPOGLYCEMIA_ESCALATION_CAUSE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasGlucoseCheck && hasDextroseOrGlucagon && hasRecheckFeeding && hasEscalationOrCause;
}

function hasSevereHypoglycemiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasRouteAirwaySafety = SEVERE_HYPOGLYCEMIA_ROUTE_AIRWAY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceMedSafety = SEVERE_HYPOGLYCEMIA_RECURRENCE_MED_SAFETY_TERMS.some((term) =>
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
    hasRecurrenceMedSafety &&
    hasCauseRiskSafety &&
    hasDischargePreventionSafety
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
  const hasDantrolene = MALIGNANT_HYPERTHERMIA_DANTROLENE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCooling = MALIGNANT_HYPERTHERMIA_COOLING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = MALIGNANT_HYPERTHERMIA_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasTriggerStop && hasDantrolene && hasCooling && hasEscalation;
}

function hasMalignantHyperthermiaTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasMetabolicSafety = MALIGNANT_HYPERTHERMIA_METABOLIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasMonitoringSafety = MALIGNANT_HYPERTHERMIA_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDantroleneSafety = MALIGNANT_HYPERTHERMIA_DANTROLENE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTriggerPreventionSafety = MALIGNANT_HYPERTHERMIA_TRIGGER_PREVENTION_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasMetabolicSafety && hasMonitoringSafety && hasDantroleneSafety && hasTriggerPreventionSafety;
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
  const hasSteroidSupport = THYROID_STORM_STEROID_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasBetaBlocker && hasThionamide && hasIodine && hasSteroidSupport;
}

function hasThyroidStormTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasSequenceSafety = THYROID_STORM_SEQUENCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasBetaBlockerSafety = THYROID_STORM_BETA_BLOCKER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDrugLiverSafety = THYROID_STORM_DRUG_LIVER_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTriggerMonitoringSafety = THYROID_STORM_TRIGGER_MONITORING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasSequenceSafety && hasBetaBlockerSafety && hasDrugLiverSafety && hasTriggerMonitoringSafety;
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
  const hasAbcFluid = HEAT_STROKE_ABC_FLUID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = HEAT_STROKE_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCoreTemp && hasRapidCooling && hasAbcFluid && hasEscalation;
}

function hasHeatStrokeTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOvercoolingSafety = HEAT_STROKE_OVERCOOLING_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasOrganInjurySafety = HEAT_STROKE_ORGAN_INJURY_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntipyreticSafety = HEAT_STROKE_ANTIPYRETIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialSafety = HEAT_STROKE_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOvercoolingSafety &&
    hasOrganInjurySafety &&
    hasAntipyreticSafety &&
    hasDifferentialSafety
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
  const hasMri = CAUDA_EQUINA_MRI_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBladderAssessment = CAUDA_EQUINA_BLADDER_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasNeuroExam = CAUDA_EQUINA_NEURO_EXAM_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSpineEscalation = CAUDA_EQUINA_SPINE_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasMri && hasBladderAssessment && hasNeuroExam && hasSpineEscalation;
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
  const hasDecompression = ACUTE_COMPARTMENT_SYNDROME_DECOMPRESSION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTemporizingRelease = ACUTE_COMPARTMENT_SYNDROME_TEMPORIZE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasLimbExam && hasPressurePathway && hasDecompression && hasTemporizingRelease;
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
  const hasSurgicalEscalation = OVARIAN_TORSION_SURGICAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasPregnancyAssessment && hasUltrasoundAssessment && hasSurgicalEscalation;
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

function hasSpinalEpiduralAbscessTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasMri = SPINAL_EPIDURAL_ABSCESS_MRI_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasCultureLab = SPINAL_EPIDURAL_ABSCESS_CULTURE_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSurgery = SPINAL_EPIDURAL_ABSCESS_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasMri && hasCultureLab && hasAntibiotic && hasSurgery;
}

function hasSpinalEpiduralAbscessTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasNeuroSepsisSafety = SPINAL_EPIDURAL_ABSCESS_NEURO_SEPSIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRiskSourceSafety = SPINAL_EPIDURAL_ABSCESS_RISK_SOURCE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticTimingSafety =
    SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_TIMING_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return hasNeuroSepsisSafety && hasRiskSourceSafety && hasAntibioticTimingSafety;
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
  const hasArthrocentesis = SEPTIC_ARTHRITIS_ARTHROCENTESIS_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSynovialStudies = SEPTIC_ARTHRITIS_SYNOVIAL_STUDY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasBloodCultureLab = SEPTIC_ARTHRITIS_BLOOD_CULTURE_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = SEPTIC_ARTHRITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDrainageOrtho = SEPTIC_ARTHRITIS_DRAINAGE_ORTHO_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasArthrocentesis &&
    hasSynovialStudies &&
    hasBloodCultureLab &&
    hasAntibiotic &&
    hasDrainageOrtho
  );
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
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasResuscitation = UPPER_GI_BLEED_RESUSCITATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasTransfusionLab = UPPER_GI_BLEED_TRANSFUSION_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEndoscopy = UPPER_GI_BLEED_ENDOSCOPY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasPpiVaricealAction = UPPER_GI_BLEED_PPI_VARICEAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasResuscitation && hasTransfusionLab && hasEndoscopy && hasPpiVaricealAction;
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
  const hasAntibioticCulture = ACUTE_CHOLECYSTITIS_ANTIBIOTIC_CULTURE_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasImaging = ACUTE_CHOLECYSTITIS_IMAGING_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSourceControl = ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasSeverity && hasAntibioticCulture && hasImaging && hasSourceControl;
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
  const hasAntibioticSupport = ACUTE_CHOLANGITIS_ANTIBIOTIC_SUPPORT_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasCultureLab = ACUTE_CHOLANGITIS_CULTURE_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasImagingObstruction = ACUTE_CHOLANGITIS_IMAGING_OBSTRUCTION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDrainage = ACUTE_CHOLANGITIS_DRAINAGE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasOrganSupport = ACUTE_CHOLANGITIS_ORGAN_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasAntibioticSupport &&
    hasCultureLab &&
    hasImagingObstruction &&
    hasDrainage &&
    hasOrganSupport
  );
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
  const hasErcpCholangitisSafety = ACUTE_PANCREATITIS_ERCP_CHOLANGITIS_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasAntibioticSafety = ACUTE_PANCREATITIS_ANTIBIOTIC_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNutritionSafety = ACUTE_PANCREATITIS_NUTRITION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNecrosisProcedureSafety =
    ACUTE_PANCREATITIS_NECROSIS_PROCEDURE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  return (
    hasErcpCholangitisSafety &&
    hasAntibioticSafety &&
    hasNutritionSafety &&
    hasNecrosisProcedureSafety
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
  const hasSurgery = ACUTE_APPENDICITIS_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = ACUTE_APPENDICITIS_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasComplicationAssessment = ACUTE_APPENDICITIS_COMPLICATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasRiskImaging && hasSurgery && hasAntibiotic && hasComplicationAssessment;
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
  const hasSurgeryRevascularization =
    ACUTE_MESENTERIC_ISCHEMIA_SURGERY_REVASCULARIZATION_ACTION_TERMS.some((term) =>
      containsSafetyTerm(normalizedActions, term),
    );
  return hasCta && hasResuscitation && hasAntibiotic && hasSurgeryRevascularization;
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

function hasNecrotizingSoftTissueInfectionTimeCriticalActions(actions: string[]): boolean {
  const normalizedActions = actions.join(" ").toLowerCase();
  const hasSurgery = NECROTIZING_SOFT_TISSUE_INFECTION_SURGERY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibiotic = NECROTIZING_SOFT_TISSUE_INFECTION_ANTIBIOTIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasResuscitation = NECROTIZING_SOFT_TISSUE_INFECTION_RESUSCITATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasDelayPrevention = NECROTIZING_SOFT_TISSUE_INFECTION_DELAY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasSurgery && hasAntibiotic && hasResuscitation && hasDelayPrevention;
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
  const hasVascularAction = RUPTURED_AAA_VASCULAR_ACTION_TERMS.some((term) =>
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
  return hasVascularAction && hasHemodynamicAction && hasBloodAction && hasImagingAction;
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
  const hasShift = HYPERKALEMIA_SHIFT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRemoval = HYPERKALEMIA_REMOVAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasCalcium && hasShift && hasRemoval;
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
  const hasSecondLine = STATUS_EPILEPTICUS_SECOND_LINE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasRefractoryEscalation = STATUS_EPILEPTICUS_REFRACTORY_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAirway && hasBenzo && hasSecondLine && hasRefractoryEscalation;
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
  const hasGapLabAction = TOXIC_ALCOHOL_GAP_LAB_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntidoteAction = TOXIC_ALCOHOL_ANTIDOTE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDialysisEscalation = TOXIC_ALCOHOL_DIALYSIS_ESCALATION_ACTION_TERMS.some(
    (term) => containsSafetyTerm(normalizedActions, term),
  );
  const hasAcidosisSupport = TOXIC_ALCOHOL_ACIDOSIS_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasGapLabAction && hasAntidoteAction && hasDialysisEscalation && hasAcidosisSupport;
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
  return (
    hasDialysisIndicationSafety && hasOrganInjurySafety && hasCoingestionDifferentialSafety
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
  const hasLevelAcidBaseAction = SALICYLATE_LEVEL_ACID_BASE_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDecontaminationAction = SALICYLATE_DECONTAMINATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAlkalinizationAction = SALICYLATE_ALKALINIZATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDialysisEscalation = SALICYLATE_DIALYSIS_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasLevelAcidBaseAction &&
    hasDecontaminationAction &&
    hasAlkalinizationAction &&
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
  const hasElectrolyteGlucoseSafety = SALICYLATE_ELECTROLYTE_GLUCOSE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasDialysisIndicationSafety && hasIntubationPhSafety && hasElectrolyteGlucoseSafety;
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
  const hasComplicationSafety = CARBON_MONOXIDE_COMPLICATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasCyanideSmokeSafety = CARBON_MONOXIDE_CYANIDE_SMOKE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return hasPulseOxSafety && hasHboCriteriaSafety && hasComplicationSafety && hasCyanideSmokeSafety;
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
  const hasHydroxocobalaminEffectSafety = CYANIDE_HYDROXOCOBALAMIN_EFFECT_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasDoNotWaitLevelSafety &&
    hasSmokeCoNitriteSafety &&
    hasShockNeuroSafety &&
    hasHydroxocobalaminEffectSafety
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
  const hasBronchodilator = COPD_BRONCHODILATOR_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasSystemicSteroid = COPD_STEROID_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasAntibioticCriteria = COPD_ANTIBIOTIC_CRITERIA_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVentilatorySupport = COPD_VENTILATORY_SUPPORT_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return (
    hasControlledOxygen &&
    hasBronchodilator &&
    hasSystemicSteroid &&
    hasAntibioticCriteria &&
    hasVentilatorySupport
  );
}

function hasCopdExacerbationTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasOxygenCo2Safety = COPD_OXYGEN_CO2_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasNivIntubationSafety = COPD_NIV_INTUBATION_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasDifferentialReview = COPD_COMORBID_DIFFERENTIAL_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTreatmentAdverseSafety = COPD_TREATMENT_ADVERSE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasOxygenCo2Safety &&
    hasNivIntubationSafety &&
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
  const hasOxygenNiv = ACUTE_HF_OXYGEN_NIV_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasDiuretic = ACUTE_HF_DIURETIC_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasVasodilatorOrBpPlan = ACUTE_HF_VASODILATOR_BP_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  const hasEscalation = ACUTE_HF_ESCALATION_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasOxygenNiv && hasDiuretic && hasVasodilatorOrBpPlan && hasEscalation;
}

function hasAcuteHeartFailureTreatmentSafetyCheck(checks: string[]): boolean {
  const normalizedChecks = checks.join(" ").toLowerCase();
  const hasBpVasodilatorSafety = ACUTE_HF_BP_VASODILATOR_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasRenalElectrolyteSafety = ACUTE_HF_RENAL_ELECTROLYTE_SAFETY_TERMS.some((term) =>
    containsSafetyTerm(normalizedChecks, term),
  );
  const hasTriggerDifferentialReview = ACUTE_HF_TRIGGER_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasShockRespiratoryFailureSafety = ACUTE_HF_SHOCK_RESPIRATORY_FAILURE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return (
    hasBpVasodilatorSafety &&
    hasRenalElectrolyteSafety &&
    hasTriggerDifferentialReview &&
    hasShockRespiratoryFailureSafety
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
  return hasNoDelaySafety && hasAnticoagReversalSafety && hasCauseComplicationSafety;
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
  const hasSiteTechniqueSafety = TENSION_PNEUMOTHORAX_SITE_TECHNIQUE_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  const hasRecurrenceFailureSafety =
    TENSION_PNEUMOTHORAX_RECURRENCE_FAILURE_SAFETY_TERMS.some((term) =>
      containsSafetyTerm(normalizedChecks, term),
    );
  const hasDifferentialReview = TENSION_PNEUMOTHORAX_DIFFERENTIAL_SAFETY_TERMS.some(
    (term) => containsSafetyTerm(normalizedChecks, term),
  );
  return hasNoDelaySafety && hasSiteTechniqueSafety && hasRecurrenceFailureSafety && hasDifferentialReview;
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
  const hasSurgicalEscalation = AORTIC_DISSECTION_SURGICAL_ACTION_TERMS.some((term) =>
    containsSafetyTerm(normalizedActions, term),
  );
  return hasAorticImaging && hasAntiImpulse && hasSurgicalEscalation;
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
        "CNS infection time-critical actions must include blood cultures, immediate empiric antibiotics, lumbar puncture or CT-before-LP pathway, and dexamethasone timing when bacterial meningitis is possible",
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
        "ectopic pregnancy safety checks must include Rh status or anti-D planning, methotrexate eligibility or contraindications, and hemodynamic or rupture risk",
    },
    {
      name: "severe_preeclampsia_time_critical_actions",
      label: "Severe preeclampsia emergency actions",
      applies: requiresSeverePreeclampsiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSeverePreeclampsiaTimeCriticalActions,
      issue:
        "severe preeclampsia or eclampsia time-critical actions must include magnesium sulfate seizure prophylaxis or treatment, acute severe-hypertension treatment, delivery or maternal-fetal planning, and OB/MFM or critical-care escalation",
    },
    {
      name: "severe_preeclampsia_treatment_safety",
      label: "Severe preeclampsia treatment safety",
      applies: requiresSeverePreeclampsiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSeverePreeclampsiaTreatmentSafetyCheck,
      issue:
        "severe preeclampsia or eclampsia safety checks must include magnesium toxicity monitoring, antihypertensive contraindication review, HELLP or renal-organ labs, and maternal-fetal severe-feature or delivery-risk monitoring",
    },
    {
      name: "hypertensive_emergency_time_critical_actions",
      label: "Hypertensive emergency actions",
      applies: requiresHypertensiveEmergencySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHypertensiveEmergencyTimeCriticalActions,
      issue:
        "hypertensive emergency time-critical actions must include repeat BP confirmation or monitored-setting/ICU/telemetry/arterial-line monitoring, acute target-organ damage assessment for neurologic, renal, cardiac, pulmonary-edema, aortic-dissection, fundoscopic, ECG, troponin, creatinine, urinalysis, CT-head, or chest-x-ray findings, titratable IV antihypertensive therapy such as nicardipine, labetalol, clevidipine, esmolol, fenoldopam, nitroglycerin, or nitroprusside, and a controlled BP-lowering target such as MAP or mean arterial pressure reduction by about 20-25% in the first hour without abrupt overcorrection",
    },
    {
      name: "hypertensive_emergency_treatment_safety",
      label: "Hypertensive emergency treatment safety",
      applies: requiresHypertensiveEmergencySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasHypertensiveEmergencyTreatmentSafetyCheck,
      issue:
        "hypertensive emergency safety checks must distinguish true emergency with acute target-organ damage from asymptomatic markedly elevated BP or hypertensive urgency, avoid overly rapid BP lowering, hypotension, cerebral hypoperfusion, or more-than-25% early reduction, review condition-specific medication choice or contraindications for aortic dissection, pulmonary edema, stroke, pregnancy, renal failure, heart failure, asthma, bradycardia, or beta-blocker use, and include ICU, monitored, continuous BP, arterial-line, telemetry, titration, or reassessment disposition",
    },
    {
      name: "giant_cell_arteritis_time_critical_actions",
      label: "Giant cell arteritis emergency actions",
      applies: requiresGiantCellArteritisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasGiantCellArteritisTimeCriticalActions,
      issue:
        "giant cell arteritis time-critical actions must include immediate high-dose glucocorticoid or corticosteroid therapy such as prednisone, prednisolone, or IV methylprednisolone, ESR, CRP, CBC, platelet, or inflammatory-marker testing, temporal artery biopsy, temporal artery ultrasound, color Doppler, halo-sign, or diagnostic confirmation planning, and urgent ophthalmology, rheumatology, emergency, same-day, visual-symptom, or vision-loss escalation",
    },
    {
      name: "giant_cell_arteritis_treatment_safety",
      label: "Giant cell arteritis treatment safety",
      applies: requiresGiantCellArteritisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasGiantCellArteritisTreatmentSafetyCheck,
      issue:
        "giant cell arteritis safety checks must include explicit do-not-delay, do-not-wait, immediate, same-day, or before-biopsy steroid planning, vision or cranial-ischemia risk review for amaurosis fugax, diplopia, visual disturbance, vision loss, or stroke, steroid-risk mitigation for glucose, diabetes, infection, osteoporosis, fracture, bone protection, PPI, GI, or toxicity, and follow-up planning for taper, relapse, large-vessel disease, vascular imaging, polymyalgia rheumatica, or tocilizumab",
    },
    {
      name: "acute_angle_closure_glaucoma_time_critical_actions",
      label: "Acute angle-closure glaucoma emergency actions",
      applies: requiresAcuteAngleClosureGlaucomaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteAngleClosureGlaucomaTimeCriticalActions,
      issue:
        "acute angle-closure glaucoma time-critical actions must include IOP, intraocular-pressure, tonometry, slit-lamp, or gonioscopy assessment, topical aqueous suppression with timolol, beta blocker, brimonidine, apraclonidine, dorzolamide, or topical drops, systemic IOP lowering with acetazolamide, Diamox, osmotic agent, mannitol, glycerol, or isosorbide, and urgent ophthalmology plus laser peripheral iridotomy, LPI, iridotomy, or iridectomy definitive planning",
    },
    {
      name: "acute_angle_closure_glaucoma_treatment_safety",
      label: "Acute angle-closure glaucoma treatment safety",
      applies: requiresAcuteAngleClosureGlaucomaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasAcuteAngleClosureGlaucomaTreatmentSafetyCheck,
      issue:
        "acute angle-closure glaucoma safety checks must include medication contraindication review for acetazolamide allergy, sulfa allergy, renal failure, timolol, asthma, COPD, bradycardia, or beta-blocker risk, pilocarpine timing or avoidance review for high IOP, corneal edema, lens-induced or phacomorphic angle closure, or pupil block, fellow-eye or bilateral prophylactic iridotomy planning, and visual acuity, optic-nerve, corneal-edema, vision-loss, repeat-IOP, or recheck-IOP monitoring",
    },
    {
      name: "retinal_detachment_time_critical_actions",
      label: "Retinal detachment emergency actions",
      applies: requiresRetinalDetachmentSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasRetinalDetachmentTimeCriticalActions,
      issue:
        "retinal detachment time-critical actions must include visual acuity, visual-field, pupil, APD, red-reflex, or dilated assessment, dilated retinal exam, indirect ophthalmoscopy, fundoscopy, slit-lamp, ocular ultrasound, or B-scan evaluation, urgent ophthalmology, retina specialist, vitreoretinal, same-day, emergency-department, or urgent-referral escalation, and definitive repair planning such as laser retinopexy, cryotherapy, pneumatic retinopexy, scleral buckle, vitrectomy, retinal repair, or surgery",
    },
    {
      name: "retinal_detachment_treatment_safety",
      label: "Retinal detachment treatment safety",
      applies: requiresRetinalDetachmentSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasRetinalDetachmentTreatmentSafetyCheck,
      issue:
        "retinal detachment safety checks must include explicit do-not-delay, same-day, immediate, urgent, or emergency ophthalmology planning, macula-on, macula-off, macular involvement, central-vision, or visual-field status review, differential review for retinal tear, posterior vitreous detachment, PVD, vitreous hemorrhage, or migraine, and precautions for worsening vision, progression, recheck, return precautions, NPO, head positioning, or avoiding eye pressure",
    },
    {
      name: "central_retinal_artery_occlusion_time_critical_actions",
      label: "Central retinal artery occlusion emergency actions",
      applies: requiresCentralRetinalArteryOcclusionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCentralRetinalArteryOcclusionTimeCriticalActions,
      issue:
        "central retinal artery occlusion time-critical actions must include symptom-onset, last-known-well, stroke-code, stroke-center, or stroke-pathway activation, ophthalmic confirmation with visual acuity, fundus exam, dilated fundus, fundus photograph, cherry-red spot, retinal whitening, optic-disc, or ophthalmology assessment, brain, vascular, carotid, CTA, MRA, MRI, ECG, echocardiogram, embolus, or stroke-workup evaluation, and reperfusion eligibility review with alteplase, tPA, TNK, thrombolysis, fibrinolysis, or thrombolytic planning",
    },
    {
      name: "central_retinal_artery_occlusion_treatment_safety",
      label: "Central retinal artery occlusion treatment safety",
      applies: requiresCentralRetinalArteryOcclusionSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCentralRetinalArteryOcclusionTreatmentSafetyCheck,
      issue:
        "central retinal artery occlusion safety checks must include mimic review for retinal detachment, vitreous hemorrhage, acute optic neuropathy, optic neuritis, migraine, giant cell arteritis, or GCA, thrombolysis eligibility or contraindication review for bleeding, hemorrhage, anticoagulant, INR, platelet, blood pressure, or recent surgery, secondary stroke prevention for antiplatelet, statin, atrial fibrillation, carotid stenosis, vascular risk, or risk-factor control, and arteritic CRAO screening with ESR, CRP, temporal arteritis, giant cell arteritis, jaw claudication, scalp tenderness, temporal headache, or steroid planning",
    },
    {
      name: "open_globe_time_critical_actions",
      label: "Open globe emergency actions",
      applies: requiresOpenGlobeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasOpenGlobeTimeCriticalActions,
      issue:
        "open globe time-critical actions must include rigid eye shield, protective shield, or eye-shield placement without pressure, systemic or IV antibiotics such as vancomycin, ceftazidime, moxifloxacin, fluoroquinolone, plus tetanus planning, CT orbit, orbital CT, x-ray, foreign-body, or intraocular-foreign-body imaging, and urgent ophthalmology, globe exploration, surgical repair, operative repair, or surgery planning",
    },
    {
      name: "open_globe_treatment_safety",
      label: "Open globe treatment safety",
      applies: requiresOpenGlobeSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasOpenGlobeTreatmentSafetyCheck,
      issue:
        "open globe safety checks must include avoiding pressure, eye patching, tonometry, ocular ultrasound, or manipulation that can extrude ocular contents, NPO, antiemetic, analgesia, vomiting, or pain-control planning, intraocular foreign-body precautions including do-not-remove, leave-in-place, metallic foreign body, or MRI avoidance review, and posttraumatic endophthalmitis, intravitreal antibiotic, sympathetic ophthalmia, infection, vision-prognosis, or close follow-up monitoring",
    },
    {
      name: "neutropenic_fever_time_critical_actions",
      label: "Febrile neutropenia emergency actions",
      applies: requiresNeutropenicFeverSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasNeutropenicFeverTimeCriticalActions,
      issue:
        "febrile neutropenia time-critical actions must include ANC or CBC confirmation, blood cultures or source cultures, immediate empiric antipseudomonal broad-spectrum antibiotics, and oncology/hematology or sepsis-risk escalation",
    },
    {
      name: "neutropenic_fever_treatment_safety",
      label: "Febrile neutropenia treatment safety",
      applies: requiresNeutropenicFeverSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasNeutropenicFeverTreatmentSafetyCheck,
      issue:
        "febrile neutropenia safety checks must include antibiotic allergy or renal/hepatic dosing review, central-line or resistant-organism coverage indications, validated risk/disposition assessment, and persistent fever or fungal-risk reassessment",
    },
    {
      name: "obstructive_pyelonephritis_time_critical_actions",
      label: "Obstructive pyelonephritis emergency actions",
      applies: requiresObstructivePyelonephritisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasObstructivePyelonephritisTimeCriticalActions,
      issue:
        "obstructive pyelonephritis time-critical actions must include immediate antibiotics and urine or blood cultures, CT, ultrasound, hydronephrosis, obstruction, stone, or ureteral-stone imaging, urgent urology decompression with ureteral stent, percutaneous nephrostomy, PCN, nephrostomy, drainage, or decompression, and sepsis support with fluids, lactate, shock, vasopressor, ICU, or septic-shock monitoring",
    },
    {
      name: "obstructive_pyelonephritis_treatment_safety",
      label: "Obstructive pyelonephritis treatment safety",
      applies: requiresObstructivePyelonephritisSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasObstructivePyelonephritisTreatmentSafetyCheck,
      issue:
        "obstructive pyelonephritis safety checks must include delayed definitive stone removal until infection or sepsis resolves, drainage option review for ureteral stent, retrograde stent, percutaneous nephrostomy, PCN, or nephrostomy, antibiotic reassessment with culture result, antibiogram, resistance, renal dosing, or source-control review, and complication risk review for anuria, AKI, renal failure, solitary kidney, pregnancy, immunocompromised state, urosepsis, or septic shock",
    },
    {
      name: "severe_hypoglycemia_time_critical_actions",
      label: "Severe hypoglycemia emergency actions",
      applies: requiresSevereHypoglycemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSevereHypoglycemiaTimeCriticalActions,
      issue:
        "severe hypoglycemia time-critical actions must include bedside or point-of-care glucose confirmation, immediate oral glucose, IV dextrose, or glucagon therapy, repeat glucose checks with feeding or dextrose infusion to prevent recurrence, and cause or admission escalation for prolonged-risk cases",
    },
    {
      name: "severe_hypoglycemia_treatment_safety",
      label: "Severe hypoglycemia treatment safety",
      applies: requiresSevereHypoglycemiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSevereHypoglycemiaTreatmentSafetyCheck,
      issue:
        "severe hypoglycemia safety checks must include airway or swallow route safety, recurrent hypoglycemia risk from sulfonylurea or long-acting insulin with octreotide or observation planning, renal, hepatic, alcohol, sepsis, or adrenal cause review, and discharge prevention such as education, dose adjustment, meal access, or glucagon planning",
    },
    {
      name: "malignant_hyperthermia_time_critical_actions",
      label: "Malignant hyperthermia emergency actions",
      applies: requiresMalignantHyperthermiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasMalignantHyperthermiaTimeCriticalActions,
      issue:
        "malignant hyperthermia time-critical actions must include stopping triggering anesthetics or succinylcholine with high-flow oxygen or non-triggering anesthesia, immediate dantrolene, active cooling, and MH cart, hotline, ICU, or urine-output escalation",
    },
    {
      name: "malignant_hyperthermia_treatment_safety",
      label: "Malignant hyperthermia treatment safety",
      applies: requiresMalignantHyperthermiaSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasMalignantHyperthermiaTreatmentSafetyCheck,
      issue:
        "malignant hyperthermia safety checks must include hyperkalemia, acidosis, arrhythmia, or rhabdomyolysis monitoring, core temperature or ETCO2 and urine-output monitoring, dantrolene repeat-dose or interaction safety, and trigger-free anesthesia or susceptibility prevention planning",
    },
    {
      name: "thyroid_storm_time_critical_actions",
      label: "Thyroid storm emergency actions",
      applies: requiresThyroidStormSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasThyroidStormTimeCriticalActions,
      issue:
        "thyroid storm time-critical actions must include beta-blockade or rate control, thionamide antithyroid therapy, iodine or iodide therapy, and glucocorticoid plus cooling, ICU, or supportive care",
    },
    {
      name: "thyroid_storm_treatment_safety",
      label: "Thyroid storm treatment safety",
      applies: requiresThyroidStormSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasThyroidStormTreatmentSafetyCheck,
      issue:
        "thyroid storm safety checks must include iodine-after-thionamide sequencing, beta-blocker contraindication review, thionamide pregnancy, liver, or agranulocytosis safety, and precipitant, arrhythmia, or ICU monitoring",
    },
    {
      name: "heat_stroke_time_critical_actions",
      label: "Heat stroke emergency actions",
      applies: requiresHeatStrokeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHeatStrokeTimeCriticalActions,
      issue:
        "heat stroke time-critical actions must include core or rectal temperature confirmation, immediate rapid whole-body cooling, airway, oxygen, circulation, or IV-fluid resuscitation, and EMS, ICU, transfer, or organ-failure escalation",
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
      name: "cauda_equina_time_critical_actions",
      label: "Cauda equina MRI and escalation",
      applies: requiresCaudaEquinaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCaudaEquinaTimeCriticalActions,
      issue:
        "cauda equina time-critical actions must include emergency lumbar MRI, bladder or post-void residual assessment, saddle, perianal, anal-tone, or lower-limb neurologic exam, and urgent neurosurgery, spine surgery, or decompression escalation",
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
      name: "acute_compartment_syndrome_time_critical_actions",
      label: "Acute compartment syndrome emergency actions",
      applies: requiresAcuteCompartmentSyndromeSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteCompartmentSyndromeTimeCriticalActions,
      issue:
        "acute compartment syndrome time-critical actions must include pain-out-of-proportion, passive-stretch, tense-compartment, pulse, capillary-refill, neurovascular, or serial limb exam, intracompartmental pressure, compartment pressure, delta pressure, diastolic pressure, pressure measurement, or pressure monitoring when diagnosis is uncertain, urgent orthopedic or orthopaedic surgery consultation, fasciotomy, surgical decompression, or urgent decompression, and temporizing removal or release of cast, splint, dressing, or circumferential compression with heart-level limb positioning and blood-pressure support",
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
        "testicular torsion time-critical actions must include acute scrotal assessment with high-clinical-suspicion, cremasteric, high-riding, Doppler, or ultrasound pathway, immediate urology, scrotal exploration, orchiopexy, or urgent surgical escalation, and explicit imaging-not-to-delay or immediate time-critical management",
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
        "ovarian or adnexal torsion time-critical actions must include pregnancy testing or quantitative hCG, pelvic or transvaginal ultrasound with Doppler assessment, and urgent OB/GYN, diagnostic laparoscopy, detorsion, or surgical escalation",
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
        "spinal epidural abscess time-critical actions must include urgent MRI spine or whole-spine imaging, blood cultures, ESR, CRP, source cultures, or microbiology workup, empiric IV antibiotics, and neurosurgery, spine surgery, decompression, drainage, or source-control escalation",
    },
    {
      name: "spinal_epidural_abscess_treatment_safety",
      label: "Spinal epidural abscess treatment safety",
      applies: requiresSpinalEpiduralAbscessSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSpinalEpiduralAbscessTreatmentSafetyCheck,
      issue:
        "spinal epidural abscess safety checks must include neurologic deficit, bowel or bladder dysfunction, serial neurologic exams, or sepsis monitoring, bacteremia, endocarditis, diabetes, IVDU, immunosuppression, recent spinal procedure, staphylococcal, or source-risk review, and culture-before-antibiotics, biopsy, or do-not-delay empiric antibiotics for unstable or neurologic compromise planning",
    },
    {
      name: "septic_arthritis_time_critical_actions",
      label: "Septic arthritis aspiration and drainage",
      applies: requiresSepticArthritisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSepticArthritisTimeCriticalActions,
      issue:
        "septic arthritis time-critical actions must include urgent arthrocentesis, joint aspiration, tap, synovial fluid, or synovial aspiration, synovial WBC, leukocyte, cell count, Gram stain, culture, microscopy, or crystal studies, blood cultures, CRP, ESR, leukocytosis, or inflammatory marker assessment, empiric antibiotics such as vancomycin or ceftriaxone, and orthopedic, arthroscopy, irrigation, drainage, surgical washout, or washout escalation",
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
        "acute cholangitis time-critical actions must include immediate broad-spectrum antibiotics and supportive care, blood culture, bile culture, WBC, CRP, bilirubin, LFT, or liver function assessment, ultrasound, CT, MRCP, biliary dilation, common bile duct, stone, stricture, or obstruction imaging, ERCP, biliary drainage, biliary decompression, stent, PTBD, nasobiliary, or percutaneous transhepatic drainage planning, and sepsis, shock, fluid, vasopressor, respiratory, circulatory, organ-support, or ICU escalation",
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
      name: "acute_appendicitis_time_critical_actions",
      label: "Acute appendicitis diagnostics and surgery",
      applies: requiresAcuteAppendicitisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcuteAppendicitisTimeCriticalActions,
      issue:
        "acute appendicitis time-critical actions must include clinical risk score, Alvarado, AIR score, Adult Appendicitis Score, ultrasound, CT, MRI, or imaging assessment, urgent surgery, surgeon, surgical consult, appendectomy, appendicectomy, laparoscopy, or operative pathway, perioperative, preoperative, broad-spectrum, ceftriaxone, metronidazole, cefoxitin, piperacillin, or antibiotic planning, and complicated appendicitis assessment for perforation, peritonitis, abscess, phlegmon, drainage, sepsis, or source control",
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
        "acute mesenteric ischemia time-critical actions must include CTA or CT angiography, resuscitation with lactate, acidosis, shock, or fluid monitoring, early broad-spectrum antibiotics, and urgent surgery, vascular surgery, endovascular therapy, laparotomy, embolectomy, revascularization, or bowel-resection escalation",
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
        "necrotizing soft tissue infection time-critical actions must include urgent surgical exploration, operative debridement, fasciotomy, or surgical consultation, broad-spectrum empiric antibiotics, sepsis, shock, lactate, ICU, vasopressor, or fluid resuscitation, and explicit do-not-delay source-control or immediate time-critical management",
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
      name: "ruptured_aaa_time_critical_actions",
      label: "Ruptured AAA emergency actions",
      applies: requiresRupturedAaaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasRupturedAaaTimeCriticalActions,
      issue:
        "ruptured or symptomatic abdominal aortic aneurysm time-critical actions must include immediate vascular surgery, EVAR, open repair, or operative repair escalation, permissive hypotension or controlled restrictive resuscitation planning, blood product, crossmatch, large-bore access, or massive transfusion preparation, and bedside ultrasound, CTA, or imaging-not-to-delay strategy",
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
      name: "hyperkalemia_time_critical_actions",
      label: "Severe hyperkalemia emergency actions",
      applies: requiresHyperkalemiaSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasHyperkalemiaTimeCriticalActions,
      issue:
        "severe hyperkalemia time-critical actions must include IV calcium or cardiac membrane stabilization, potassium-shifting therapy, and potassium removal or dialysis planning",
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
        "status epilepticus time-critical actions must include airway or oxygen support, benzodiazepine treatment, second-line antiseizure loading, and refractory seizure escalation",
    },
    {
      name: "status_epilepticus_treatment_safety",
      label: "Status epilepticus treatment safety",
      applies: requiresStatusEpilepticusSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasStatusEpilepticusTreatmentSafetyCheck,
      issue:
        "status epilepticus safety checks must include glucose or thiamine assessment, respiratory depression or aspiration safeguards, and second-line antiseizure dosing or contraindication review",
    },
    {
      name: "adrenal_crisis_time_critical_actions",
      label: "Adrenal crisis immediate steroid and fluids",
      applies: requiresAdrenalCrisisSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAdrenalCrisisTimeCriticalActions,
      issue:
        "adrenal crisis time-critical actions must include immediate hydrocortisone or stress-dose steroid, isotonic saline or dextrose resuscitation, and glucose, electrolyte, or hemodynamic monitoring",
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
      name: "acetaminophen_toxicity_time_critical_actions",
      label: "Acetaminophen toxicity level, NAC, and hepatic monitoring",
      applies: requiresAcetaminophenToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAcetaminophenToxicityTimeCriticalActions,
      issue:
        "acetaminophen toxicity time-critical actions must include a timed acetaminophen level with Rumack-Matthew nomogram planning, N-acetylcysteine treatment planning, and hepatic injury or toxicology monitoring",
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
      name: "toxic_alcohol_time_critical_actions",
      label: "Toxic alcohol antidote and dialysis actions",
      applies: requiresToxicAlcoholSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasToxicAlcoholTimeCriticalActions,
      issue:
        "toxic alcohol time-critical actions must include anion gap, osmolal gap, osmolar gap, serum osmolality, methanol, ethylene glycol, or toxic alcohol level assessment, fomepizole or ethanol alcohol-dehydrogenase blockade, poison center, toxicologist, nephrology, hemodialysis, dialysis, or extracorporeal escalation, and acidosis, blood gas, pH, or bicarbonate support planning",
    },
    {
      name: "toxic_alcohol_treatment_safety",
      label: "Toxic alcohol dialysis and organ safety",
      applies: requiresToxicAlcoholSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasToxicAlcoholTreatmentSafetyCheck,
      issue:
        "toxic alcohol safety checks must include hemodialysis indication review for severe acidosis, anion gap, coma, seizure, visual symptoms, renal failure, kidney failure, or high-risk level, vision, optic, renal, kidney, urine, hypocalcemia, or calcium oxalate organ-injury monitoring, and ethanol, isopropanol, salicylate, ketoacidosis, lactic acidosis, late presentation, or co-ingestion differential review",
    },
    {
      name: "salicylate_toxicity_time_critical_actions",
      label: "Salicylate toxicity levels and alkalinization",
      applies: requiresSalicylateToxicitySafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasSalicylateToxicityTimeCriticalActions,
      issue:
        "salicylate toxicity time-critical actions must include serial salicylate levels with anion gap, blood gas, ABG, VBG, or electrolyte monitoring, activated charcoal or multidose charcoal decontamination planning, sodium bicarbonate, urine alkalinization, alkaline diuresis, potassium, or urine pH planning, and poison center, toxicologist, nephrology, hemodialysis, or dialysis escalation",
    },
    {
      name: "salicylate_toxicity_treatment_safety",
      label: "Salicylate toxicity dialysis and airway safety",
      applies: requiresSalicylateToxicitySafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasSalicylateToxicityTreatmentSafetyCheck,
      issue:
        "salicylate toxicity safety checks must include hemodialysis indication review for acidemia, severe acidosis, altered mental status, seizure, renal failure, kidney failure, pulmonary edema, or very high salicylate level, intubation or mechanical ventilation pH-preservation planning with hyperventilation or bicarbonate safeguards, and potassium, hypokalemia, glucose, hypoglycemia, temperature, pulmonary edema, or cerebral edema monitoring",
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
        "carbon monoxide poisoning safety checks must include pulse oximetry or SpO2 false-normal limitation review, hyperbaric oxygen criteria review for pregnancy, neurologic symptoms, loss of consciousness, syncope, acidosis, cardiac ischemia, or high carboxyhemoglobin, cardiac, ECG, troponin, lactate, metabolic acidosis, myocardial, delayed neurologic, or neurocognitive complication monitoring, and smoke inhalation, cyanide, hydroxocobalamin, burn, fire, or lactate co-toxicity assessment",
    },
    {
      name: "cyanide_poisoning_time_critical_actions",
      label: "Cyanide poisoning antidote and support",
      applies: requiresCyanidePoisoningSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasCyanidePoisoningTimeCriticalActions,
      issue:
        "cyanide poisoning time-critical actions must include source removal or 100% oxygen with respiratory or circulatory support, hydroxocobalamin, Cyanokit, sodium thiosulfate, or thiosulfate antidote planning, lactate, blood gas, ABG, VBG, pH, anion gap, or metabolic acidosis assessment, and poison center, toxicologist, ICU, or burn center escalation",
    },
    {
      name: "cyanide_poisoning_treatment_safety",
      label: "Cyanide poisoning smoke and antidote safety",
      applies: requiresCyanidePoisoningSafetyCheck,
      fieldName: "contraindication_checks",
      validator: hasCyanidePoisoningTreatmentSafetyCheck,
      issue:
        "cyanide poisoning safety checks must include empiric antidote or do-not-wait cyanide-level planning, smoke inhalation, carbon monoxide, COHb, carboxyhemoglobin, or nitrite-avoidance review, shock, hypotension, cardiac arrest, coma, seizure, syncope, or altered mental status monitoring, and hydroxocobalamin blood pressure, red urine, chromaturia, lab-interference, or dialysis interference safety",
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
        "cardiac tamponade safety checks must include unstable-patient do-not-delay or immediate-drainage planning, anticoagulant, thrombolysis, bleeding, coagulopathy, INR, platelet, or reversal review, and trauma, iatrogenic injury, myocardial infarction or rupture, aortic dissection, malignancy, uremia, or renal failure cause assessment",
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
        "tension pneumothorax safety checks must include not delaying decompression for imaging, decompression site or technique safety, recurrence or chest-tube failure monitoring, and obstructive-shock differential review",
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
    {
      name: "aortic_dissection_time_critical_actions",
      label: "Aortic dissection imaging and escalation",
      applies: requiresAorticDissectionSafetyCheck,
      fieldName: "time_critical_actions",
      validator: hasAorticDissectionTimeCriticalActions,
      issue:
        "aortic dissection time-critical actions must include definitive aortic imaging, anti-impulse blood pressure or heart-rate control, and cardiothoracic, vascular, or aortic-team surgical escalation",
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
