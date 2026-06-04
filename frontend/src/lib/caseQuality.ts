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

export function reviewQualityIssues(detail: ClinicalCaseReviewDetail | undefined): string[] {
  if (!detail) return ["Reviewer-only case detail must load before review."];
  const issues: string[] = [];
  if (detail.key_teaching_points.length < 3) {
    issues.push("At least 3 key teaching points are required.");
  }
  if (detail.cognitive_traps.length < 2) {
    issues.push("At least 2 cognitive traps are required.");
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
  if (detail.clinical_sources.length < 1) {
    issues.push("At least 1 clinical source is required.");
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
