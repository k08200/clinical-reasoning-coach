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
    "Activate local ACS/reperfusion pathway and cath lab when STEMI criteria are met",
    "Plan primary PCI or coronary angiography within the door-to-balloon 90 minute goal, transfer 120 minute limit, 12 hour presentation window, or door-to-needle fibrinolysis pathway if PCI is delayed",
    "Give 300 mg aspirin loading plus dual antiplatelet therapy with ticagrelor, prasugrel, or clopidogrel and UFH heparin antithrombin anticoagulation after checking ECG context and major contraindications",
  ],
  contraindication_checks: [
    "Aortic dissection features before anticoagulation or thrombolysis",
    "Active bleeding, recent major surgery, aspirin allergy, aspirin hypersensitivity, or severe allergy before antithrombotic therapy",
    "Anticoagulant and antithrombin bleeding risk, renal impairment, low body weight, age, dose adjustment, and clotting function monitoring before heparin, UFH, bivalirudin, or fondaparinux",
    "Serial troponin or cardiac biomarker review plus GRACE NSTEMI risk assessment using creatinine, glucose, and hemoglobin",
    "Hemodynamic instability or pulmonary edema requiring escalation",
    "Nitroglycerin or nitrate only after checking hypotension, right ventricular or inferior infarct, and PDE5 inhibitor use",
    "Use oxygen only for hypoxia or low SpO2; avoid routine oxygen when oxygen saturation is adequate",
    "Early rate-control medication contraindication review for acute heart failure, shock, bradycardia, AV block, or bronchospasm",
    "Track door-to-balloon PCI 90 minute goal, transfer 120 minute limit, 12 hour presentation window, and door-to-needle fibrinolysis contraindication planning",
    "If fibrinolysis is used, give antithrombin at the same time, repeat post-fibrinolysis ECG at 60-90 minutes, offer rescue PCI for failed reperfusion or residual ST elevation, and do not repeat fibrinolysis",
    "Choose DAPT with prasugrel, ticagrelor, or clopidogrel according to high bleeding risk and oral anticoagulant status",
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

  it("accepts a complete acute chest syndrome emergency plan", () => {
    const issues = reviewQualityIssues(
      makeReviewDetail({
        diagnosis: "Sickle cell acute chest syndrome",
        chief_complaint: "Fever, pleuritic chest pain, and hypoxemia",
        history_of_present_illness:
          "Patient with HbSS has fever, cough, tachypnea, SpO2 88%, and a new pulmonary infiltrate.",
        key_teaching_points: [
          "Acute chest syndrome is new infiltrate plus respiratory symptoms or fever in sickle cell disease",
          "Acute chest syndrome can progress rapidly and requires inpatient management",
          "Management requires oxygen, antibiotics, spirometry, and transfusion escalation",
        ],
        clinical_red_flags: [
          "SpO2 below 90 despite supplemental oxygen, increasing respiratory distress, progressive infiltrates, and falling hemoglobin require urgent escalation",
          "Hypoxemia and multilobar disease can progress to respiratory failure",
        ],
        time_critical_actions: [
          "Obtain chest x-ray, CBC with reticulocyte count, and blood culture",
          "Give supplemental oxygen with continuous pulse oximetry and maintain SpO2 above 95 percent",
          "Start IV ceftriaxone plus oral azithromycin macrolide empiric antibiotics",
          "Use awake incentive spirometry every 2 hours and ketorolac-based analgesia",
          "Use simple transfusion when hemoglobin is more than 1 g/dL below baseline; arrange exchange transfusion for high pretransfusion hemoglobin or rapidly progressive disease",
          "Escalate to ICU with BiPAP or intubation for worsening hypoxemia despite supplemental oxygen, increasing respiratory distress, or progressive infiltrates",
        ],
        contraindication_checks: [
          "Avoid overhydration and fluid overload; monitor pulmonary edema and opioid oversedation or hypoventilation",
          "Review simple transfusion versus exchange transfusion with hematology and blood bank, and avoid hemoglobin above 10 because of hyperviscosity",
          "Use bronchodilator only for asthma or bronchospasm; avoid routine systemic steroid because rebound vaso-occlusive crisis and readmission can occur",
          "Evaluate pneumonia and pulmonary embolism, pneumothorax, ARDS, acute coronary syndrome, and empyema as alternate cardiopulmonary diagnoses",
          "Admit for inpatient monitoring and escalate to ICU and hematology for multilobar disease, severe hypoxemia, or respiratory failure",
        ],
      }),
    );

    expect(issues.some((issue) => issue.startsWith("acute chest syndrome "))).toBe(false);
  });

  it("accepts a complete severe asthma and ventilation safety plan", () => {
    const issues = reviewQualityIssues(
      makeReviewDetail({
        diagnosis: "Status asthmaticus requiring mechanical ventilation",
        chief_complaint: "Severe wheeze, silent chest, and respiratory failure",
        history_of_present_illness:
          "Patient with status asthmaticus has fatigue, drowsiness, hypercapnia, and respiratory acidosis requiring intubation and mechanical ventilation.",
        key_teaching_points: [
          "Severe asthma requires controlled oxygen, repeated SABA, ipratropium, and early systemic corticosteroids",
          "Drowsiness, silent chest, or hypercapnia requires ICU escalation",
          "Mechanical ventilation requires prevention of auto-PEEP and dynamic hyperinflation",
        ],
        clinical_red_flags: [
          "Silent chest, fatigue, drowsiness, hypercapnia, and respiratory acidosis",
          "Worsening hypoxemia or poor response to repeated bronchodilator treatment",
        ],
        time_critical_actions: [
          "Give controlled supplemental oxygen by nasal cannula with continuous pulse oximetry and target SpO2 93-95 percent",
          "Give repeated albuterol SABA every 20 minutes with ipratropium for severe bronchospasm",
          "Give IV methylprednisolone systemic corticosteroid early",
          "For poor response give IV magnesium sulfate and transfer to ICU for intubation and mechanical ventilation",
        ],
        contraindication_checks: [
          "Monitor pulse oximetry, serial PEF or FEV1, work of breathing, and response reassessment",
          "Review silent chest, fatigue, drowsiness, hypercapnia CO2, and intubation or ventilation risk",
          "Monitor beta-agonist tachycardia or arrhythmia plus potassium hypokalemia and lactic acidosis",
          "Avoid routine antibiotics and avoid routine chest x-ray unless infection or another diagnosis is suspected",
          "Use low respiratory rate and low minute ventilation with prolonged expiratory time and permissive hypercapnia",
          "Monitor auto-PEEP, air trapping, and dynamic hyperinflation with an end expiratory pause and expiratory flow-time waveform",
          "Watch for barotrauma or pneumothorax plus hypotension, hemodynamic collapse, or obstructive shock",
          "Use ketamine sedation and neuromuscular blockade for ventilator asynchrony when needed",
        ],
      }),
    );

    expect(issues.some((issue) => issue.startsWith("severe asthma "))).toBe(false);
  });

  it("accepts current severe CAP stewardship", () => {
    const issues = reviewQualityIssues(
      makeReviewDetail({
        diagnosis: "Severe community-acquired pneumonia with hypoxemia",
        chief_complaint: "Fever, cough, confusion, and severe shortness of breath",
        history_of_present_illness:
          "Patient has hypoxemia, hypotension, elevated lactate, sepsis, and respiratory failure from severe community-acquired pneumonia.",
        key_teaching_points: [
          "Severe CAP requires oxygenation support and early empiric antibiotics",
          "Severe CAP requires cultures, urinary antigens, and MRSA or Pseudomonas risk review",
          "Systemic corticosteroids may be considered for severe CAP after contraindication review",
        ],
        clinical_red_flags: [
          "Hypoxemia, respiratory failure, hypotension, shock, confusion, multilobar infiltrates, or ICU need",
          "Prior respiratory isolation of MRSA or Pseudomonas, recent hospitalization with IV antibiotics within 90 days, or empyema",
        ],
        time_critical_actions: [
          "Give supplemental oxygen and escalate to HFNC, ventilation, or intubation for hypoxemia and respiratory failure",
          "Obtain chest x-ray, blood cultures, sputum respiratory culture, Legionella urinary antigen, and pneumococcal urinary antigen",
          "Start empiric ceftriaxone beta-lactam plus azithromycin macrolide antibiotics",
          "Treat sepsis with IV fluids, lactate monitoring, vasopressor planning, and ICU escalation for septic shock",
        ],
        contraindication_checks: [
          "Review MRSA and Pseudomonas risk factors including prior respiratory isolation and recent hospitalization with IV antibiotics within 90 days; use vancomycin or antipseudomonal coverage only when indicated and de-escalate when cultures are negative",
          "Use PSI, CURB-65, major criteria, minor criteria, hypotension, shock, and ICU need for severity and disposition review",
          "Assess parapneumonic effusion or empyema, loculated effusion, thoracentesis need, and drainage indications",
          "Evaluate viral influenza, COVID, aspiration, and lung abscess differential diagnoses",
          "Do not withhold initial empiric antibiotics because of low procalcitonin when severe CAP is clinically suspected",
          "Consider systemic hydrocortisone for severe CAP; avoid it with influenza pneumonia, uncontrolled diabetes, recent GI bleeding, or Aspergillus concern",
          "If influenza is positive, start antiviral therapy such as oseltamivir while continuing antibacterial coverage when bacterial coinfection remains possible",
          "Guide antibiotic duration by clinical stability including vital signs, respiratory rate, oxygen saturation, oral intake, and baseline mental status for at least 5 days",
        ],
      }),
    );

    expect(issues.some((issue) => issue.startsWith("severe community-acquired pneumonia "))).toBe(
      false,
    );
  });

  it("flags Korean diagnosis terms in learner-visible case fields", () => {
    const issues = reviewQualityIssues(
      makeReviewDetail({
        diagnosis: "급성 허혈성 뇌졸중",
        title: "급성허혈성뇌졸중 환자의 초기 평가",
      }),
    );

    expect(
      issues.some((issue) => issue.includes("title must not reveal the diagnosis term")),
    ).toBe(true);
    expect(issues.some((issue) => issue.includes("급성허혈성뇌졸중"))).toBe(true);
  });

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
    expect(statuses.find((status) => status.name === "sepsis_resuscitation_actions")).toMatchObject(
      {
        applied: true,
        passed: false,
        label: "Sepsis resuscitation actions",
        fieldName: "time_critical_actions",
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
