import { describe, expect, it } from "vitest";
import { reviewQualityGateStatuses, reviewQualityIssues } from "@/lib/caseQuality";
import type { ClinicalCaseReviewDetail, ClinicalSource } from "@/types";
import parityFixtures from "../../../../shared/case_quality_parity_cases.json";

type CaseQualityParityFixture = {
  name: string;
  expected_passed: boolean;
  expected_issue_substrings?: string[];
  overrides: Partial<ClinicalCaseReviewDetail> & {
    clinical_sources?: ClinicalSource[];
  };
};

const baseReviewDetail: ClinicalCaseReviewDetail = {
  id: "case-1",
  title: "Acute Chest Pain in a Middle-Aged Male",
  specialty: "internal_medicine",
  difficulty: "medium",
  chief_complaint: "Chest pain and diaphoresis",
  patient_demographics: { age: 58, sex: "male", weight_kg: 88, ethnicity: "Korean" },
  history_of_present_illness: "Sudden onset crushing substernal chest pain radiating to the left arm.",
  past_medical_history: "Hypertension, hyperlipidemia, former smoker.",
  medications: ["Lisinopril 10mg daily", "Atorvastatin 40mg daily", "Aspirin 100mg daily"],
  physical_exam: {
    vitals: { bp: "158/96", hr: 102, rr: 18, temp_c: 36.8, spo2: 95 },
    general: "Diaphoretic, pale, anxious, in moderate distress",
    cardiovascular: "Tachycardic, regular rhythm",
    pulmonary: "Mild bibasilar crackles",
    abdomen: "Soft, non-tender",
    neuro: "Alert and oriented",
  },
  initial_labs: { troponin_i: "0.04" },
  source_provenance: {
    source_count: 1,
    organizations: ["American Heart Association"],
    review_status: "educational_draft",
    review_label: "Educational draft",
    requires_caution: true,
    last_reviewed_at: "2026-06-01",
    review_valid_until: "2027-06-01",
    review_stale: false,
    review_date_invalid: false,
    review_content_changed: false,
  },
  times_used: 0,
  created_at: "2026-06-01T00:00:00Z",
  diagnosis: "STEMI / ACS - ST-Elevation Myocardial Infarction",
  key_teaching_points: [
    "Time-to-reperfusion is critical",
    "Borderline troponin at presentation does not rule out ACS",
    "Bibasilar crackles suggest early heart failure",
  ],
  cognitive_traps: [
    "Borderline troponin may falsely reassure students",
    "Mild oxygen abnormality might distract toward pulmonary causes",
  ],
  clinical_red_flags: [
    "Crushing substernal chest pain radiating to the arm with diaphoresis",
    "Bibasilar crackles suggesting early heart failure",
    "Tachycardia with multiple coronary risk factors",
  ],
  time_critical_actions: [
    "Obtain and interpret a 12-lead ECG within 10 minutes of presentation",
    "Activate local ACS/reperfusion pathway when STEMI criteria are met",
    "Give antiplatelet/anticoagulation only after checking ECG context and major contraindications",
  ],
  contraindication_checks: [
    "Aortic dissection features before anticoagulation or thrombolysis",
    "Active bleeding, severe allergy, or recent major surgery before antithrombotic therapy",
    "Hemodynamic instability or pulmonary edema requiring escalation",
  ],
  clinical_sources: [],
  coach_guidance: "Probe for high-risk chest pain reasoning without revealing the diagnosis.",
  reviewed_by_user_id: null,
  review_notes: null,
};

function makeReviewDetail(overrides: CaseQualityParityFixture["overrides"]): ClinicalCaseReviewDetail {
  return {
    ...baseReviewDetail,
    ...overrides,
    patient_demographics: {
      ...baseReviewDetail.patient_demographics,
      ...overrides.patient_demographics,
    },
    physical_exam: {
      ...baseReviewDetail.physical_exam,
      ...overrides.physical_exam,
      vitals: {
        ...baseReviewDetail.physical_exam.vitals,
        ...overrides.physical_exam?.vitals,
      },
    },
    source_provenance: {
      ...baseReviewDetail.source_provenance,
      ...overrides.source_provenance,
    },
  };
}

describe("reviewQualityIssues", () => {
  it.each(parityFixtures as CaseQualityParityFixture[])(
    "matches shared backend parity fixture: $name",
    (fixture) => {
      const issues = reviewQualityIssues(makeReviewDetail(fixture.overrides));

      expect(issues.length === 0).toBe(fixture.expected_passed);
      for (const issueSubstring of fixture.expected_issue_substrings ?? []) {
        expect(issues.some((issue) => issue.includes(issueSubstring))).toBe(true);
      }
    },
  );

  it("reports structured domain safety gate status for reviewer checklist display", () => {
    const detail = makeReviewDetail({
      diagnosis: "Septic shock from urinary source",
      time_critical_actions: ["Blood cultures before broad-spectrum antibiotics"],
      contraindication_checks: ["Drug allergy review only"],
    });

    const statuses = reviewQualityGateStatuses(detail);

    expect(
      statuses.find((status) => status.name === "infection_time_critical_actions"),
    ).toMatchObject({
      applied: true,
      passed: true,
      label: "Infection cultures and treatment plan",
      fieldName: "time_critical_actions",
    });
    expect(statuses.find((status) => status.name === "infection_antimicrobial_safety")).toMatchObject(
      {
        applied: true,
        passed: false,
        fieldName: "contraindication_checks",
      },
    );
  });

  it("flags clinician-reviewed cases with only one independent source organization", () => {
    const detail = makeReviewDetail({
      source_provenance: {
        review_status: "clinician_reviewed",
        review_label: "Clinician reviewed",
        requires_caution: false,
      },
      clinical_sources: [
        {
          title: "2021 AHA/ACC Guideline for the Evaluation and Diagnosis of Chest Pain",
          organization: "American Heart Association / American College of Cardiology",
          url: "https://www.jacc.org/doi/10.1016/j.jacc.2021.07.052",
          supports: [
            "ACS diagnosis and risk stratification for acute chest pain",
            "life-threatening chest pain differential and severity markers",
            "ECG within 10 minutes and reperfusion pathway activation",
            "crushing substernal chest pain radiating to the arm with diaphoresis",
            "bibasilar crackles suggesting early heart failure",
            "tachycardia with multiple coronary risk factors",
            "aortic dissection features before anticoagulation or thrombolysis",
            "active bleeding, severe allergy, or recent major surgery before antithrombotic therapy",
            "antiplatelet and anticoagulation only after checking ECG context and major contraindications",
            "hemodynamic instability or pulmonary edema requiring escalation",
          ],
        },
      ],
    });

    const issues = reviewQualityIssues(detail);

    expect(
      issues.some((issue) =>
        issue.includes("at least 2 independent clinical source organizations"),
      ),
    ).toBe(true);
  });
});
