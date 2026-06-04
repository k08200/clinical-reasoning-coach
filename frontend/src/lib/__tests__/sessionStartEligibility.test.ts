import { describe, expect, it } from "vitest";
import { evaluateSessionStartEligibility } from "@/lib/sessionStartEligibility";
import type { ClinicalCase } from "@/types";

const makeCase = (overrides: Partial<ClinicalCase> = {}): ClinicalCase => ({
  id: "case-1",
  title: "Chest Pain With Borderline Troponin",
  specialty: "internal_medicine",
  difficulty: "medium",
  chief_complaint: "Chest pain",
  patient_demographics: { age: 54, sex: "female" },
  history_of_present_illness: "Two hours of pressure-like chest pain.",
  past_medical_history: "Hypertension",
  medications: ["lisinopril"],
  physical_exam: {
    vitals: { bp: "148/88", hr: 94, rr: 18, temp_c: 37, spo2: 98 },
    general: "Uncomfortable",
    cardiovascular: "Regular rhythm",
    pulmonary: "Clear",
    abdomen: "Soft",
    neuro: "Alert",
  },
  initial_labs: { troponin: "0.03" },
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
  times_used: 2,
  created_at: "2026-05-25T00:00:00Z",
  ...overrides,
});

describe("evaluateSessionStartEligibility", () => {
  it("blocks cases without supporting clinical sources", () => {
    const eligibility = evaluateSessionStartEligibility(makeCase({
      source_provenance: {
        source_count: 0,
        organizations: [],
        review_status: "clinician_reviewed",
        review_label: "Clinician reviewed",
        requires_caution: false,
        last_reviewed_at: "2026-06-02",
        review_valid_until: "2027-06-02",
        review_stale: false,
        review_date_invalid: false,
        review_content_changed: false,
      },
    }));

    expect(eligibility.blocked).toBe(true);
    expect(eligibility.requiresAcknowledgement).toBe(false);
    expect(eligibility.buttonLabel).toBe("Source Review Required");
    expect(eligibility.cautionText).toBe(
      "No supporting clinical source; source review required.",
    );
    expect(eligibility.acknowledgementText).toContain("no supporting clinical source");
  });

  it("blocks unreviewed educational draft cases until clinical review", () => {
    const eligibility = evaluateSessionStartEligibility(makeCase());

    expect(eligibility.blocked).toBe(true);
    expect(eligibility.requiresAcknowledgement).toBe(false);
    expect(eligibility.buttonLabel).toBe("Clinical Review Required");
    expect(eligibility.cautionText).toBe("Not clinician reviewed; clinical review required.");
    expect(eligibility.acknowledgementText).toContain("not clinician reviewed");
    expect(eligibility.acknowledgementText).toContain("blocked until clinician review");
  });

  it("requires simulation acknowledgement for clinician-reviewed cases", () => {
    const eligibility = evaluateSessionStartEligibility(makeCase({
      source_provenance: {
        source_count: 1,
        organizations: ["American Heart Association"],
        review_status: "clinician_reviewed",
        review_label: "Clinician reviewed",
        requires_caution: false,
        last_reviewed_at: "2026-06-02",
        review_valid_until: "2027-06-02",
        review_stale: false,
        review_date_invalid: false,
        review_content_changed: false,
      },
    }));

    expect(eligibility.blocked).toBe(false);
    expect(eligibility.requiresAcknowledgement).toBe(true);
    expect(eligibility.cautionText).toBeNull();
    expect(eligibility.acknowledgementText).toContain("educational simulation only");
    expect(eligibility.acknowledgementText).toContain("emergency services");
  });

  it.each([
    {
      flag: "review_stale",
      label: "Clinician review is stale; re-review required.",
      acknowledgement: "stale clinician review",
    },
    {
      flag: "review_date_invalid",
      label: "Clinician review date is invalid; re-review required.",
      acknowledgement: "invalid clinician review date",
    },
    {
      flag: "review_content_changed",
      label: "Case changed after clinician review; re-review required.",
      acknowledgement: "changed after clinician review",
    },
    {
      flag: "review_audit_missing",
      label: "Clinical review audit is missing; re-review required.",
      acknowledgement: "no review audit fingerprint",
    },
    {
      flag: "review_audit_incomplete",
      label: "Clinical review audit is incomplete; re-review required.",
      acknowledgement: "review audit is incomplete",
    },
  ] as const)(
    "blocks sessions when $flag requires clinician re-review",
    ({ flag, label, acknowledgement }) => {
      const eligibility = evaluateSessionStartEligibility(makeCase({
        source_provenance: {
          source_count: 1,
          organizations: ["American Heart Association"],
          review_status: "clinician_reviewed",
          review_label: "Re-review required",
          requires_caution: true,
          last_reviewed_at: "2026-06-01",
          review_valid_until: "2027-06-01",
          review_stale: false,
          review_date_invalid: false,
          review_content_changed: false,
          [flag]: true,
        },
      }));

      expect(eligibility.blocked).toBe(true);
      expect(eligibility.requiresAcknowledgement).toBe(false);
      expect(eligibility.buttonLabel).toBe("Re-review Required");
      expect(eligibility.cautionText).toBe(label);
      expect(eligibility.acknowledgementText).toContain(acknowledgement);
      expect(eligibility.acknowledgementText).toContain("blocked until clinician re-review");
    },
  );

  it("blocks clinician-reviewed cases without independent source organizations", () => {
    const eligibility = evaluateSessionStartEligibility(makeCase({
      source_provenance: {
        source_count: 2,
        organizations: ["Same Clinical Society"],
        review_status: "clinician_reviewed",
        review_label: "Clinician review source diversity insufficient",
        requires_caution: true,
        last_reviewed_at: "2026-06-01",
        review_valid_until: "2027-06-01",
        review_stale: false,
        review_date_invalid: false,
        review_content_changed: false,
        source_diversity_insufficient: true,
      },
    }));

    expect(eligibility.blocked).toBe(true);
    expect(eligibility.requiresAcknowledgement).toBe(false);
    expect(eligibility.buttonLabel).toBe("Source Review Required");
    expect(eligibility.cautionText).toBe(
      "Independent clinical source review required.",
    );
    expect(eligibility.acknowledgementText).toContain(
      "at least 2 independent clinical source organizations",
    );
  });
});
