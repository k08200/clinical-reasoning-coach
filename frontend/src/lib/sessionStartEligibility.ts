import type { ClinicalCase } from "@/types";

export type SessionStartEligibility = {
  blocked: boolean;
  requiresAcknowledgement: boolean;
  buttonLabel: string;
  cautionText: string | null;
  acknowledgementText: string;
};

const SIMULATION_ACKNOWLEDGEMENT =
  "This is an educational simulation only, not patient care or medical advice. For real patients, follow local clinical protocols and contact a supervising clinician or emergency services.";

export function evaluateSessionStartEligibility(
  clinicalCase: ClinicalCase,
): SessionStartEligibility {
  const provenance = clinicalCase.source_provenance;

  if (provenance.review_content_changed) {
    return {
      blocked: true,
      requiresAcknowledgement: false,
      buttonLabel: "Re-review Required",
      cautionText: "Case changed after clinician review; re-review required.",
      acknowledgementText:
        "This case changed after clinician review. Learner sessions are blocked until clinician re-review.",
    };
  }

  if (provenance.review_stale) {
    return {
      blocked: true,
      requiresAcknowledgement: false,
      buttonLabel: "Re-review Required",
      cautionText: "Clinician review is stale; re-review required.",
      acknowledgementText:
        "This case has a stale clinician review. Learner sessions are blocked until clinician re-review.",
    };
  }

  if (provenance.review_date_invalid) {
    return {
      blocked: true,
      requiresAcknowledgement: false,
      buttonLabel: "Re-review Required",
      cautionText: "Clinician review date is invalid; re-review required.",
      acknowledgementText:
        "This case has an invalid clinician review date. Learner sessions are blocked until clinician re-review.",
    };
  }

  if (provenance.requires_caution) {
    return {
      blocked: false,
      requiresAcknowledgement: true,
      buttonLabel: "Start Session",
      cautionText: "Not clinician reviewed; use only for education.",
      acknowledgementText:
        "This case is not clinician reviewed. This is an educational simulation only, not patient care or medical advice.",
    };
  }

  return {
    blocked: false,
    requiresAcknowledgement: true,
    buttonLabel: "Start Session",
    cautionText: null,
    acknowledgementText: SIMULATION_ACKNOWLEDGEMENT,
  };
}
