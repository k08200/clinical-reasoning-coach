"""
Mock LLM provider — zero API key, zero cost, works offline.

Implements a rule-based Socratic coach with a curated question bank.
Detects reasoning phase and student keywords to pick relevant questions.
This is NOT a substitute for real AI coaching — it's a demo/dev mode.
"""
from __future__ import annotations

import asyncio
import json
import random
import re
from collections.abc import AsyncGenerator
from typing import Any

from app.services.provider import StreamChunk, LLMResponse

# ─── Socratic question bank ───────────────────────────────────────────────────

QUESTIONS_BY_PHASE = {
    "vitals_and_presentation": [
        "Looking at the vital signs — what stands out to you and why?",
        "What does the combination of heart rate and blood pressure tell you about this patient's hemodynamic status?",
        "If you had to identify the single most alarming finding on first glance, which would it be?",
        "How do you interpret the oxygen saturation in context with the rest of the presentation?",
        "What does the patient's general appearance suggest about the acuity of this situation?",
    ],
    "history": [
        "What aspects of the history of present illness are most relevant to narrowing your differential?",
        "How does the past medical history change your thinking about this presentation?",
        "What is the significance of the patient's current medications in this context?",
        "Are there any risk factors in this history that should elevate your concern for a life-threatening cause?",
        "What additional history would you want to gather, and why would that information matter?",
    ],
    "differential": [
        "What are the three most dangerous diagnoses you must rule out first in a case like this?",
        "You've suggested one diagnosis — what else on your differential could explain ALL of these findings?",
        "Which diagnoses on your list would be immediately life-threatening if missed?",
        "How would you rank your differentials by probability versus severity? Are those the same list?",
        "Is there a unifying diagnosis that explains both the primary complaint AND the abnormal vital signs?",
    ],
    "anchoring_challenge": [
        "You seem focused on one diagnosis. What findings would argue AGAINST that diagnosis?",
        "If I told you that diagnosis was ruled out, what would be your next hypothesis?",
        "What would make you MORE or LESS confident in that diagnosis?",
        "Are there any findings you're not yet accounting for in your current hypothesis?",
        "What is the base rate of that diagnosis in a patient with this demographic and presentation?",
    ],
    "evidence_gathering": [
        "What specific test result would most change your management right now?",
        "Before ordering that test — what clinical finding would confirm or deny your working hypothesis?",
        "What is the sensitivity and specificity of that test for your leading diagnosis?",
        "Which result would be most dangerous to miss — and how would you ensure you don't?",
        "How does the ECG finding change your differential ranking?",
    ],
    "mechanism": [
        "Why would a patient with that condition present with exactly these symptoms?",
        "What is the underlying pathophysiology that connects the symptom to the organ system?",
        "Walk me through the mechanism by which that would cause the vital sign abnormality you identified.",
        "How does age affect the typical presentation of this diagnosis?",
        "Why might this patient present atypically compared to the textbook description?",
    ],
    "premature_closure_challenge": [
        "You seem ready to commit to a diagnosis. What would your attending say if you stopped here?",
        "Before we move to management — have you definitively excluded the most dangerous alternative?",
        "What information are you still missing that could change your diagnosis entirely?",
        "Is there a simpler or more common explanation you may have overlooked?",
        "Let's test your hypothesis: if you're right, what else should we expect to find on examination?",
    ],
    "management": [
        "Before starting treatment — what is the most time-sensitive intervention in this case?",
        "What would happen to this patient if you waited 30 minutes before treating?",
        "How would you prioritize your interventions, and why in that order?",
        "What are the risks of the treatment you're proposing, and how do they compare to the risks of the disease?",
        "What is your monitoring plan — what would tell you the patient is improving or deteriorating?",
    ],
    "generic_deepening": [
        "Can you explain your reasoning process in arriving at that conclusion?",
        "What evidence-based guideline applies to this presentation?",
        "How confident are you in that assessment, and what would increase your confidence?",
        "What would your senior resident say when you present this case?",
        "Is there anything about this case that doesn't fit neatly into your working diagnosis?",
    ],
}

# ─── Specialty-specific question banks ───────────────────────────────────────

SPECIALTY_QUESTIONS: dict[str, list[str]] = {
    "sepsis": [
        "What criteria would you use to define sepsis versus septic shock in this patient?",
        "What does the lactate level tell you about tissue perfusion, and what number is your threshold for action?",
        "Before starting antibiotics — what should you do first, and why does the order matter?",
        "What is the significance of the band count in the context of this WBC and possible sepsis?",
        "How does the organ dysfunction score change your management urgency?",
        "What is your 1-hour Sepsis Bundle, and which element is most time-critical here?",
        "The patient has CKD — how does that change your interpretation of the creatinine?",
        "What source-control measure would you consider, and when?",
        "Why might an elderly patient with sepsis have a blunted fever response?",
        "How would you monitor whether your resuscitation is working?",
    ],
    "dka": [
        "Walk me through how insulin deficiency leads to the acid-base disturbance you're seeing.",
        "What is the anion gap telling you, and how do you calculate the corrected value here?",
        "Why must potassium be checked — and possibly replaced — before starting insulin?",
        "How do you interpret the sodium in a patient with marked hyperglycemia?",
        "This patient has abdominal pain — how do you decide whether it's the DKA or a surgical emergency?",
        "What is your endpoint for insulin therapy — what tells you DKA has resolved?",
        "What is the difference between DKA and HHS, and which does this presentation fit?",
        "Why do Kussmaul respirations occur, and what do they tell you about severity?",
        "How would you replace the fluid deficit, and which fluid would you choose?",
        "What triggered this DKA, and does that change your management?",
    ],
    "stroke": [
        "What is the last known normal time — and why is that the critical number, not when symptoms were noticed?",
        "Calculate the tPA eligibility window: what is the deadline in this case?",
        "The NIHSS is 8 — what does that score mean for severity and treatment eligibility?",
        "This patient has atrial fibrillation with a subtherapeutic INR — what does that tell you about the stroke mechanism?",
        "The blood pressure is 178/104 — should you treat it now, and why or why not?",
        "What imaging would you order first, and what are you specifically looking for?",
        "Beyond tPA, what other time-sensitive intervention should you consider, and what criteria trigger it?",
        "What contraindications to thrombolysis do you need to check in this patient?",
        "How does the missed anticoagulation history affect your management decision?",
        "What is your blood pressure target before tPA, and why does that threshold exist?",
    ],
    "pe": [
        "What is this patient's Wells score? Walk me through each criterion.",
        "The troponin is mildly elevated — what does that suggest about right ventricular involvement?",
        "How do you interpret an SpO2 of 89% in the context of this presentation?",
        "She is on anticoagulation post-operatively — does that change your suspicion for PE?",
        "What is the significance of the loud P2 and elevated JVP you found on exam?",
        "How would you risk-stratify this PE — massive, submassive, or low-risk — and why does that matter?",
        "What is your diagnostic pathway: CT-PA, V/Q scan, or bedside echo first?",
        "At what point would you consider systemic thrombolysis instead of anticoagulation alone?",
        "The right calf finding — how does that change your pre-test probability?",
        "What monitoring would tell you this patient is decompensating?",
    ],
}


# Keywords that trigger specific question categories
KEYWORD_TRIGGERS = {
    "anchoring_challenge": [
        "definitely", "clearly", "obviously", "must be", "has to be",
        "i'm sure", "certain", "no doubt", "for sure",
    ],
    "premature_closure_challenge": [
        "give", "treat", "start", "order", "admit", "discharge",
        # Cardiac
        "aspirin", "heparin", "tpa", "nitro", "morphine",
        # Sepsis
        "antibiotics", "vancomycin", "ceftriaxone", "piperacillin", "meropenem",
        # DKA
        "insulin", "potassium replacement",
        # Stroke
        "alteplase", "thrombectomy", "rtpa",
        # PE
        "anticoagulate", "anticoagulation",
    ],
    "mechanism": [
        "because", "mechanism", "pathophysiology", "why", "causes",
    ],
    "management": [
        "ecg", "troponin", "ct", "ultrasound", "xray", "x-ray",
        "labs", "blood", "culture",
    ],
}

_CASE_STEMI = {
    "title": "Acute Chest Pain in a Middle-Aged Male",
    "specialty": "internal_medicine",
    "difficulty": "medium",
    "chief_complaint": "Chest pain and diaphoresis",
    "patient_demographics": {"age": 58, "sex": "male", "weight_kg": 88, "ethnicity": "Korean"},
    "history_of_present_illness": (
        "58-year-old male with sudden onset crushing substernal chest pain radiating to the left arm, "
        "onset 45 minutes ago at rest. Associated with diaphoresis, nausea, and mild dyspnea. "
        "Denies fever, cough, trauma, or recent prolonged immobility."
    ),
    "past_medical_history": "Hypertension (10 years), hyperlipidemia, smoker (20 pack-years), quit 5 years ago.",
    "medications": ["Lisinopril 10mg daily", "Atorvastatin 40mg daily", "Aspirin 100mg daily"],
    "physical_exam": {
        "vitals": {"bp": "158/96", "hr": 102, "rr": 18, "temp_c": 36.8, "spo2": 95},
        "general": "Diaphoretic, pale, anxious, in moderate distress",
        "cardiovascular": "Tachycardic, regular rhythm, no murmurs or rubs. JVP normal.",
        "pulmonary": "Mild bibasilar crackles on auscultation",
        "abdomen": "Soft, non-tender, no organomegaly",
        "neuro": "Alert and oriented x3, no focal deficits",
        "other": "No peripheral edema, peripheral pulses intact",
    },
    "initial_labs": {
        "wbc": "11.4 (mildly elevated)",
        "hgb": "14.2",
        "platelets": "224",
        "na": "138",
        "k": "4.1",
        "cr": "1.1",
        "glucose": "142 (mildly elevated)",
        "troponin_i": "0.04 (upper limit of normal 0.04 — borderline)",
        "bnp": "180 (mildly elevated)",
        "d_dimer": "Not yet ordered",
    },
    "diagnosis": "STEMI / ACS — ST-Elevation Myocardial Infarction",
    "key_teaching_points": [
        "Time-to-reperfusion is critical — door-to-balloon < 90 minutes",
        "Borderline troponin at presentation does not rule out ACS — repeat in 3-6 hours",
        "Bibasilar crackles suggest early Killip Class II heart failure",
        "Mild glucose elevation and WBC are expected stress responses",
    ],
    "cognitive_traps": [
        "Borderline troponin may falsely reassure students",
        "SpO2 of 95% might lead to anchoring on pulmonary embolism",
        "Mild glucose elevation might distract toward diabetic emergency",
    ],
    "clinical_red_flags": [
        "Crushing substernal chest pain radiating to the arm with diaphoresis",
        "Bibasilar crackles suggesting early heart failure",
        "Tachycardia with multiple coronary risk factors",
    ],
    "time_critical_actions": [
        "Obtain and interpret a 12-lead ECG within 10 minutes of presentation",
        "Activate local ACS/reperfusion pathway when STEMI criteria are met",
        "Give antiplatelet/anticoagulation only after checking ECG context and major contraindications",
    ],
    "contraindication_checks": [
        "Aortic dissection features before anticoagulation or thrombolysis",
        "Active bleeding, severe allergy, or recent major surgery before antithrombotic therapy",
        "Hemodynamic instability or pulmonary edema requiring escalation",
    ],
    "coach_guidance": (
        "Guide student toward: (1) identifying high-risk features (diaphoresis, radiation, risk factors), "
        "(2) not being falsely reassured by borderline troponin, "
        "(3) recognizing early pulmonary edema (crackles + elevated BNP), "
        "(4) understanding urgency of reperfusion. "
        "Challenge premature closure on GERD or anxiety. "
        "If student jumps to aspirin/heparin, ask about ECG first — time-sensitive diagnosis requires ECG within 10 minutes."
    ),
}

_CASE_SEPSIS = {
    "title": "Fever and Altered Mental Status in an Elderly Patient",
    "specialty": "internal_medicine",
    "difficulty": "medium",
    "chief_complaint": "Fever, confusion, and hypotension",
    "patient_demographics": {"age": 74, "sex": "female", "weight_kg": 62, "ethnicity": "Korean"},
    "history_of_present_illness": (
        "74-year-old female brought by family for 2-day history of worsening confusion and fever. "
        "Family reports she was complaining of dysuria and frequency 3 days ago. "
        "She became progressively lethargic today. Denies chest pain, cough, or diarrhea. "
        "Last voided 12 hours ago with dark, malodorous urine."
    ),
    "past_medical_history": "Type 2 diabetes mellitus (15 years), hypertension, CKD stage 3.",
    "medications": ["Metformin 1000mg twice daily", "Amlodipine 5mg daily", "Lisinopril 10mg daily"],
    "physical_exam": {
        "vitals": {"bp": "88/56", "hr": 118, "rr": 22, "temp_c": 38.9, "spo2": 94},
        "general": "Elderly female, lethargic, responds only to voice, appears ill",
        "cardiovascular": "Tachycardic, faint peripheral pulses. Capillary refill 4 seconds.",
        "pulmonary": "Clear to auscultation bilaterally",
        "abdomen": "Mild suprapubic tenderness on deep palpation",
        "neuro": "Confused, GCS 13 (E3V4M6), no focal deficits",
        "other": "Dry mucous membranes, decreased skin turgor",
    },
    "initial_labs": {
        "wbc": "22.4 (significantly elevated, 18% bands)",
        "hgb": "11.2",
        "platelets": "98 (low)",
        "na": "132 (hyponatremia)",
        "k": "5.2 (mildly elevated)",
        "cr": "2.8 (elevated from baseline 1.4)",
        "glucose": "318 (markedly elevated)",
        "lactate": "4.1 mmol/L (severely elevated)",
        "urinalysis": "Pyuria, bacteriuria, nitrite positive",
        "procalcitonin": "Not yet resulted",
    },
    "diagnosis": "Septic Shock secondary to Urosepsis (UTI → urosepsis → septic shock)",
    "key_teaching_points": [
        "Septic shock = sepsis + vasopressor requirement to maintain MAP ≥65 mmHg + lactate >2 mmol/L",
        "Source control (antibiotics within 1 hour) and fluid resuscitation are time-critical",
        "Elevated lactate 4.1 indicates tissue hypoperfusion — immediate action required",
        "Altered mental status in elderly is a sepsis red flag even without classic fever pattern",
        "AKI and thrombocytopenia suggest early organ dysfunction (sepsis-3 criteria)",
    ],
    "cognitive_traps": [
        "Students may anchor on AMS as primary neurological problem (stroke, delirium)",
        "Glucose elevation may distract toward diabetic emergency as primary diagnosis",
        "Low-grade fever might underestimate severity in elderly with blunted response",
        "CKD baseline may mask degree of AKI",
    ],
    "clinical_red_flags": [
        "Hypotension with fever and altered mental status",
        "Lactate 4.1 mmol/L suggesting tissue hypoperfusion",
        "AKI, thrombocytopenia, delayed urination, and poor perfusion",
    ],
    "time_critical_actions": [
        "Recognize suspected septic shock and escalate immediately",
        "Obtain blood cultures promptly without delaying empiric antibiotics",
        "Start sepsis bundle actions including fluids, antibiotics, lactate reassessment, and source control planning",
    ],
    "contraindication_checks": [
        "Renal impairment and allergy history before antibiotic selection or dosing",
        "Volume overload risk during fluid resuscitation in CKD or heart failure",
        "Need for vasopressors if hypotension persists after initial resuscitation",
    ],
    "coach_guidance": (
        "Guide student toward: (1) recognizing SIRS criteria and sepsis-3, "
        "(2) identifying source (urinary symptoms + UA), "
        "(3) lactate as prognostic marker requiring immediate intervention, "
        "(4) understanding organ dysfunction scoring. "
        "Challenge anchoring on delirium or stroke. "
        "Emphasize time-critical nature: antibiotics within 1 hour, 30mL/kg IV fluids."
    ),
}

_CASE_PE = {
    "title": "Sudden Dyspnea in a Post-Surgical Patient",
    "specialty": "emergency_medicine",
    "difficulty": "hard",
    "chief_complaint": "Sudden-onset dyspnea and pleuritic chest pain",
    "patient_demographics": {"age": 45, "sex": "female", "weight_kg": 72, "ethnicity": "Korean"},
    "history_of_present_illness": (
        "45-year-old female, post-op day 5 from right total knee replacement, "
        "presents with sudden-onset dyspnea and sharp right-sided pleuritic chest pain. "
        "Onset 1 hour ago at rest. Also reports right calf pain and swelling for 2 days. "
        "Denies fever, hemoptysis, or prior similar episodes."
    ),
    "past_medical_history": "Obesity (BMI 34), oral contraceptive use, no prior DVT/PE.",
    "medications": ["Rivaroxaban 10mg daily (started post-op, last dose yesterday)", "OCP"],
    "physical_exam": {
        "vitals": {"bp": "105/70", "hr": 114, "rr": 26, "temp_c": 37.2, "spo2": 89},
        "general": "Anxious female in moderate respiratory distress",
        "cardiovascular": "Tachycardic, loud P2 on auscultation. JVP elevated at 5cm above sternal angle.",
        "pulmonary": "Decreased breath sounds at right base. No crackles.",
        "abdomen": "Soft, non-tender",
        "neuro": "Alert and oriented",
        "other": "Right calf: warm, erythematous, 3cm circumference difference vs left",
    },
    "initial_labs": {
        "wbc": "11.8",
        "hgb": "13.1",
        "platelets": "210",
        "na": "139",
        "k": "3.9",
        "cr": "0.9",
        "d_dimer": "5,840 ng/mL (markedly elevated, normal <500)",
        "troponin_i": "0.08 (mildly elevated — RV strain)",
        "bnp": "220 (mildly elevated)",
        "abg": "pH 7.48, pO2 58, pCO2 30 (respiratory alkalosis + hypoxemia)",
    },
    "diagnosis": "Massive/Submassive Pulmonary Embolism with right ventricular strain",
    "key_teaching_points": [
        "Wells PE criteria: 3 points (DVT signs) + 3 (HR>100) + 1.5 (immobilization post-surgery) = high pre-test probability",
        "RV strain signs: elevated troponin, BNP, loud P2, elevated JVP = submassive PE",
        "SpO2 89% + HR 114 + hypotension = hemodynamic compromise requiring urgent intervention",
        "CT-PA is gold standard but consider thrombolysis if hemodynamically unstable",
        "Low-dose rivaroxaban post-op may have been insufficient prophylaxis",
    ],
    "cognitive_traps": [
        "Pleuritic pain may be mistaken for musculoskeletal post-op pain",
        "Recent anticoagulant use may falsely reassure students",
        "Normal temperature may underestimate seriousness",
        "SpO2 of 89% requires urgent intervention — not just supplemental O2",
    ],
    "clinical_red_flags": [
        "Sudden dyspnea with hypoxemia and pleuritic chest pain after surgery",
        "Tachycardia with borderline blood pressure and signs of right heart strain",
        "Unilateral calf swelling and markedly elevated D-dimer",
    ],
    "time_critical_actions": [
        "Risk stratify for massive versus submassive PE before choosing disposition",
        "Escalate urgently for worsening hypotension, syncope, or shock",
        "Select imaging or bedside echo pathway based on hemodynamic stability",
    ],
    "contraindication_checks": [
        "Bleeding risk, recent surgery, and neuraxial anesthesia before thrombolysis or anticoagulation",
        "Renal function and contrast allergy before CT pulmonary angiography",
        "Pregnancy status when selecting imaging and anticoagulation",
    ],
    "coach_guidance": (
        "Guide student toward Wells criteria scoring. "
        "Challenge premature reassurance from recent anticoagulation. "
        "Emphasize RV strain as a marker of severity. "
        "Ask about thrombolysis decision criteria — when does PE require systemic thrombolysis?"
    ),
}

_CASE_DKA = {
    "title": "Young Diabetic with Nausea and Abdominal Pain",
    "specialty": "internal_medicine",
    "difficulty": "easy",
    "chief_complaint": "Nausea, vomiting, and diffuse abdominal pain",
    "patient_demographics": {"age": 22, "sex": "male", "weight_kg": 68, "ethnicity": "Korean"},
    "history_of_present_illness": (
        "22-year-old male with known Type 1 diabetes presents with 12-hour history of nausea, "
        "vomiting (×5), and diffuse crampy abdominal pain. He ran out of insulin 2 days ago. "
        "Reports increased thirst and urination for 3 days. "
        "Denies fever, diarrhea, or recent illness. Last ate 8 hours ago."
    ),
    "past_medical_history": "Type 1 diabetes mellitus (diagnosed age 12), no prior DKA episodes.",
    "medications": ["Insulin glargine 20 units nightly (ran out 2 days ago)", "Insulin lispro with meals (ran out 2 days ago)"],
    "physical_exam": {
        "vitals": {"bp": "102/68", "hr": 122, "rr": 28, "temp_c": 37.1, "spo2": 99},
        "general": "Ill-appearing young male, Kussmaul respirations, fruity breath odor",
        "cardiovascular": "Tachycardic, dry mucous membranes",
        "pulmonary": "Clear, deep rapid breathing (Kussmaul)",
        "abdomen": "Diffusely tender, no guarding or rigidity, no rebound",
        "neuro": "Alert but fatigued, slightly confused",
        "other": "Sunken eyes, decreased skin turgor, capillary refill 3 seconds",
    },
    "initial_labs": {
        "glucose": "480 mg/dL (markedly elevated)",
        "ph": "7.18 (severe acidosis)",
        "bicarbonate": "8 mEq/L (low)",
        "anion_gap": "28 (elevated, normal 8-12)",
        "ketones": "Serum ketones 4+ positive",
        "na": "128 (pseudohyponatremia — corrected Na = 135)",
        "k": "5.8 (elevated — but total body K depleted)",
        "cr": "1.6 (AKI from dehydration)",
        "wbc": "14.2 (stress leukocytosis)",
        "urinalysis": "Glucosuria 4+, ketonuria 4+",
    },
    "diagnosis": "Diabetic Ketoacidosis (DKA) — precipitated by insulin non-compliance",
    "key_teaching_points": [
        "DKA criteria: glucose >250, pH <7.3, bicarbonate <15, positive ketones",
        "Corrected Na = measured Na + 1.6 × (glucose-100)/100 — do not treat apparent hyponatremia",
        "Potassium must be replaced BEFORE insulin if K <3.5 — insulin drives K intracellularly",
        "Abdominal pain in DKA is often the acidosis itself, not a surgical emergency",
        "Never stop insulin infusion until anion gap closes and patient is eating",
    ],
    "cognitive_traps": [
        "Abdominal pain may lead students toward surgical causes (appendicitis, bowel obstruction)",
        "Pseudohyponatremia may prompt incorrect aggressive sodium replacement",
        "Visible tachycardia may focus students on cardiac etiology",
        "Normal temperature rules out infection as precipitant — but check anyway",
    ],
    "clinical_red_flags": [
        "Severe metabolic acidosis with Kussmaul respirations",
        "Tachycardia, dehydration signs, AKI, and mild confusion",
        "Hyperkalemia despite total body potassium depletion",
    ],
    "time_critical_actions": [
        "Assess severity and initiate monitored DKA protocol with fluids and insulin planning",
        "Check potassium before insulin and replace if low",
        "Identify precipitating cause while closing the anion gap",
    ],
    "contraindication_checks": [
        "Potassium below safe threshold before insulin infusion",
        "Cerebral edema risk from overly rapid osmolar shifts",
        "Need to exclude surgical abdomen if pain persists after metabolic correction",
    ],
    "coach_guidance": (
        "Guide student toward: (1) DKA diagnosis criteria, "
        "(2) potassium management BEFORE insulin if K low, "
        "(3) calculating corrected sodium, "
        "(4) differentiating DKA from HHS (age, ketones, acidosis). "
        "Challenge premature surgical referral for abdominal pain."
    ),
}

_CASE_STROKE = {
    "title": "Sudden Facial Droop and Speech Difficulty",
    "specialty": "neurology",
    "difficulty": "medium",
    "chief_complaint": "Sudden facial droop, slurred speech, and right arm weakness",
    "patient_demographics": {"age": 67, "sex": "male", "weight_kg": 82, "ethnicity": "Korean"},
    "history_of_present_illness": (
        "67-year-old male found by wife at 08:15 AM with sudden right-sided facial droop, "
        "dysarthria, and right arm weakness. Wife reports he was normal at 07:00 AM when she woke up. "
        "Onset was sudden with no preceding headache, trauma, or loss of consciousness. "
        "Now 09:00 AM. No vomiting. No history of similar episodes."
    ),
    "past_medical_history": "Atrial fibrillation (on anticoagulation — missed doses for 5 days), hypertension.",
    "medications": ["Apixaban 5mg twice daily (missed last 5 days)", "Amlodipine 5mg daily"],
    "physical_exam": {
        "vitals": {"bp": "178/104", "hr": 88, "rr": 16, "temp_c": 36.9, "spo2": 97},
        "general": "Alert, cooperative, in moderate distress",
        "cardiovascular": "Irregularly irregular rhythm (AFib), no murmurs",
        "pulmonary": "Clear bilaterally",
        "abdomen": "Soft, non-tender",
        "neuro": "NIHSS 8: right facial droop, dysarthria, right arm drift (grade 4/5 strength), mild right leg weakness. No aphasia. Gaze deviation to left.",
        "other": "No signs of trauma",
    },
    "initial_labs": {
        "wbc": "9.8",
        "hgb": "14.1",
        "platelets": "188",
        "na": "140",
        "k": "4.0",
        "cr": "1.0",
        "glucose": "128",
        "inr": "1.2 (subtherapeutic — missed doses)",
        "inr_therapeutic_range": "Target 2.0-3.0",
        "noncontrast_ct": "No hemorrhage, no early ischemic changes",
    },
    "diagnosis": "Acute Ischemic Stroke — cardioembolic (AFib + subtherapeutic anticoagulation)",
    "key_teaching_points": [
        "Time is brain: 1.9 million neurons die per minute in untreated stroke",
        "tPA window: 3-4.5 hours from LAST KNOWN NORMAL, not symptom onset",
        "Last known normal is 07:00 AM — tPA window: until 11:30 AM",
        "Subtherapeutic INR 1.2 from missed apixaban doses suggests cardioembolic mechanism",
        "NIHSS 8 = moderate stroke; LKN + non-contrast CT negative = tPA eligible",
    ],
    "cognitive_traps": [
        "Using symptom recognition time (09:00 AM) instead of last known normal (07:00 AM) — wrong tPA window",
        "AFib + anticoagulation may falsely reassure students that embolism is unlikely",
        "Blood pressure 178/104 might prompt treatment — but BP should NOT be lowered before tPA",
        "Students may skip mechanical thrombectomy consideration for large vessel occlusion",
    ],
    "clinical_red_flags": [
        "Sudden focal neurologic deficit with NIHSS 8",
        "Potentially treatable stroke within thrombolysis window from last known normal",
        "Atrial fibrillation with missed anticoagulation suggesting embolic risk",
    ],
    "time_critical_actions": [
        "Establish last known normal and activate stroke pathway immediately",
        "Obtain noncontrast head CT to exclude hemorrhage without delaying treatment decision",
        "Assess thrombolysis and thrombectomy eligibility in parallel",
    ],
    "contraindication_checks": [
        "Intracranial hemorrhage or early extensive ischemic change on imaging",
        "Recent anticoagulant use, bleeding history, platelet count, glucose, and blood pressure thresholds",
        "Large vessel occlusion criteria and transfer needs for thrombectomy",
    ],
    "coach_guidance": (
        "Critical teaching point: LKN is 07:00 AM, not 09:00 AM. "
        "Guide student to calculate correct tPA eligibility window. "
        "Ask: 'What is the last known normal time and why does that matter?' "
        "Challenge BP management instinct — pre-tPA, accept BP up to 185/110. "
        "Ask about mechanical thrombectomy criteria (NIHSS ≥6, LVO on CTA)."
    ),
}

# Pool of all pre-built cases — used by generate_demo_case()
CASE_POOL = [_CASE_STEMI, _CASE_SEPSIS, _CASE_PE, _CASE_DKA, _CASE_STROKE]

# Keep backward compatibility alias
DEMO_CASE = _CASE_STEMI


# ─── Mock provider ────────────────────────────────────────────────────────────

class MockProvider:
    """Rule-based Socratic coach. No API key needed."""

    def _detect_specialty(self, system: str) -> str | None:
        """Detect case specialty from the system prompt to pick targeted questions."""
        lower = system.lower()
        if any(k in lower for k in ["septic shock", "urosepsis", "bacteremia", "sirs", "sepsis-3"]):
            return "sepsis"
        if any(k in lower for k in ["ketoacidosis", "dka", "insulin deficiency", "anion gap acidosis"]):
            return "dka"
        if any(k in lower for k in ["ischemic stroke", "last known normal", "lkn", "nihss", "alteplase"]):
            return "stroke"
        if any(k in lower for k in ["pulmonary embolism", "right ventricular strain", "wells criteria", "massive pe"]):
            return "pe"
        return None  # cardiac / default

    def _detect_phase(self, student_text: str, turn_number: int) -> str:
        lower = student_text.lower()

        for phase, keywords in KEYWORD_TRIGGERS.items():
            if any(kw in lower for kw in keywords):
                return phase

        if turn_number == 1:
            return "vitals_and_presentation"
        if turn_number == 2:
            return "history"
        if turn_number <= 4:
            return "differential"
        if turn_number <= 6:
            return "evidence_gathering"
        if turn_number <= 8:
            return "mechanism"
        return "generic_deepening"

    def _pick_question(self, phase: str) -> str:
        bank = QUESTIONS_BY_PHASE.get(phase, QUESTIONS_BY_PHASE["generic_deepening"])
        return random.choice(bank)

    def _build_response(self, student_text: str, turn_number: int, specialty: str | None = None) -> str:
        phase = self._detect_phase(student_text, turn_number)
        q1 = self._pick_question(phase)
        # If a specialty is known, inject one specialty-specific question for depth
        if specialty and specialty in SPECIALTY_QUESTIONS:
            q2 = random.choice(SPECIALTY_QUESTIONS[specialty])
        else:
            other_phases = [p for p in QUESTIONS_BY_PHASE if p != phase]
            q2 = self._pick_question(random.choice(other_phases))
        return f"{q1}\n\nAlso consider: {q2}"

    async def stream(
        self,
        messages: list[dict[str, Any]],
        system: str,
        operation: str = "mock",
    ) -> AsyncGenerator[StreamChunk, None]:
        turn_number = sum(1 for m in messages if m.get("role") == "user")
        student_text = messages[-1].get("content", "") if messages else ""
        specialty = self._detect_specialty(system)

        response = self._build_response(student_text, turn_number, specialty)

        yield StreamChunk(type="thinking_start")
        await asyncio.sleep(0.3)  # simulate thinking

        # Stream word by word for realism
        words = response.split()
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield StreamChunk(type="text_delta", content=chunk)
            await asyncio.sleep(0.03)

        word_count = len(response.split())
        yield StreamChunk(
            type="usage",
            usage={"input_tokens": len(student_text) // 4, "output_tokens": word_count * 2, "thinking_tokens": 50},
        )
        yield StreamChunk(type="done")

    async def complete(
        self,
        messages: list[dict[str, Any]],
        system: str,
    ) -> LLMResponse:
        user_text = messages[-1].get("content", "") if messages else ""
        # For case generation: return a randomly selected pre-built case
        if "case designer" in system.lower():
            return LLMResponse(
                text=json.dumps(random.choice(CASE_POOL)),
                thinking="[mock] Returning pre-built case from pool",
                input_tokens=100,
                output_tokens=300,
                thinking_tokens=50,
            )
        # For reasoning analysis: extract only the current student response to avoid
        # false positives from conversation history
        student_response = _extract_student_response(user_text)
        mock_analysis = _analyze_reasoning(student_response)
        return LLMResponse(
            text=json.dumps(mock_analysis),
            thinking="[mock] Rule-based analysis",
            input_tokens=80,
            output_tokens=150,
            thinking_tokens=30,
        )


def _extract_hypothesis(text: str) -> str:
    """Extract the main diagnostic hypothesis from student text using word boundaries."""
    # Ordered longest-first so "stemi" matches before "mi" would as a substring
    diagnoses = [
        ("myocardial infarction", "Myocardial Infarction"),
        ("pulmonary embolism", "Pulmonary Embolism"),
        ("aortic dissection", "Aortic Dissection"),
        ("heart failure", "Heart Failure"),
        ("stemi", "STEMI"),
        ("nstemi", "NSTEMI"),
        ("acs", "ACS"),
        ("septic shock", "Septic Shock"),
        ("sepsis", "Sepsis"),
        ("urosepsis", "Urosepsis"),
        ("stroke", "Stroke"),
        ("pneumonia", "Pneumonia"),
        ("angina", "Angina"),
        ("gerd", "GERD"),
        ("dka", "DKA"),
        ("mi", "MI"),
        ("pe", "PE"),
    ]
    lower = text.lower()
    for pattern, label in diagnoses:
        # Use word boundary to avoid "mi" matching inside "stemi" etc.
        if re.search(r"\b" + re.escape(pattern) + r"\b", lower):
            return label
    return "Under investigation"


def _extract_student_response(prompt: str) -> str:
    """
    Extract the current student response from the full analysis prompt.
    Falls back to the full text if the expected format is not found.
    """
    # Prompt format: 'Turn N — Student response to analyze:\n"<text>"\n\nAnalyze...'
    import re as _re
    match = _re.search(r'Student response to analyze:\s*"(.+?)"\s*\n', prompt, _re.DOTALL)
    if match:
        return match.group(1)
    return prompt


def _analyze_reasoning(text: str) -> dict:
    """
    Rule-based reasoning quality analysis.
    Scores 4 dimensions and detects cognitive biases from student text.
    """
    lower = text.lower()
    words = lower.split()
    word_count = len(words)

    # ── Dimension 1: Systematic approach (0-25) ──────────────────────────────
    # Multiple diagnoses mentioned → systematic; single diagnosis → lower
    diagnosis_keywords = [
        "stemi", "nstemi", "acs", "mi", "pe", "pulmonary embolism",
        "aortic dissection", "pneumonia", "heart failure", "angina",
        "gerd", "anxiety", "pericarditis", "pneumothorax",
        "sepsis", "septic shock", "urosepsis", "bacteremia",
        "stroke", "tia", "hemorrhage", "embolism",
        "dka", "ketoacidosis", "hhs",
        "appendicitis", "cholecystitis", "pancreatitis",
    ]
    diagnoses_mentioned = sum(1 for d in diagnosis_keywords if d in lower)
    systematic = min(25, 8 + diagnoses_mentioned * 4 + (3 if word_count > 80 else 0))

    # ── Dimension 2: Evidence integration (0-25) ─────────────────────────────
    evidence_terms = [
        # Cardiac
        "troponin", "ecg", "bnp", "d-dimer", "spo2", "bp", "heart rate",
        "tachycardia", "diaphoresis", "radiation", "crackles", "bibasilar",
        "risk factor", "hypertension", "smoking", "hyperlipidemia",
        # Sepsis
        "lactate", "wbc", "bands", "procalcitonin", "blood culture",
        "fever", "hypotension", "altered mental", "confusion",
        "urinalysis", "pyuria", "bacteriuria",
        # PE/DVT
        "wells", "dvt", "calf", "immobility", "ocp", "oral contraceptive",
        "d-dimer", "ct-pa", "v/q",
        # DKA
        "glucose", "ketone", "bicarbonate", "anion gap", "kussmaul",
        "ph", "acidosis",
        # Stroke
        "nihss", "lkn", "last known normal", "tpa", "ct head",
        "facial droop", "aphasia", "atrial fibrillation", "afib",
        # General
        "history", "medication", "allergy", "vital sign",
    ]
    evidence_used = sum(1 for e in evidence_terms if e in lower)
    evidence = min(25, 5 + evidence_used * 2)

    # ── Dimension 3: Prioritization (0-25) ───────────────────────────────────
    priority_terms = [
        "life-threatening", "urgent", "immediately", "first", "priority",
        "rule out", "must exclude", "time-sensitive", "emergent", "stat",
        "dangerous", "critical", "most important",
        "time is", "door-to", "within", "hour", "minutes",
    ]
    priority_used = sum(1 for p in priority_terms if p in lower)
    prioritization = min(25, 8 + priority_used * 4)

    # ── Dimension 4: Mechanism understanding (0-25) ───────────────────────────
    mechanism_terms = [
        "because", "mechanism", "pathophysiology", "due to", "caused by",
        "results in", "explains", "consistent with", "suggests", "indicates",
        "ischemia", "infarction", "occlusion", "reperfusion", "preload",
        "vasodilation", "vasoplegia", "endotoxin", "cytokine",
        "embolic", "thrombotic", "clot", "obstruction",
        "insulin deficiency", "ketogenesis", "acidosis",
        "hypoperfusion", "organ dysfunction",
    ]
    mechanism_used = sum(1 for m in mechanism_terms if m in lower)
    mechanism = min(25, 5 + mechanism_used * 4)

    total_score = systematic + evidence + prioritization + mechanism

    # ── Bias detection ────────────────────────────────────────────────────────
    biases = []

    # Premature closure: jumping to treatment/specific diagnosis too early
    treatment_words = [
        # Cardiac
        "give aspirin", "start heparin", "thrombolysis",
        "take aspirin", "administer", "treat with", "prescribe",
        # Sepsis
        "give antibiotics", "start antibiotics", "broad-spectrum antibiotics",
        "vancomycin", "piperacillin", "ceftriaxone", "meropenem",
        # DKA
        "start insulin", "give insulin", "insulin drip", "insulin infusion",
        # Stroke
        "give tpa", "administer tpa", "give alteplase", "give rtpa",
        "mechanical thrombectomy", "thrombectomy",
        # PE
        "heparin drip", "anticoagulate", "give heparin", "start anticoagulation",
        "systemic thrombolysis",
    ]
    if any(t in lower for t in treatment_words):
        biases.append({
            "type": "premature_closure",
            "severity": "moderate",
            "evidence": "Student proposed specific treatment before completing diagnostic workup",
            "confidence": 0.75,
        })

    # Anchoring: certainty language around a single diagnosis
    certainty_words = ["definitely", "clearly", "obviously", "must be", "has to be", "certain", "no doubt"]
    if any(c in lower for c in certainty_words) and diagnoses_mentioned <= 1:
        biases.append({
            "type": "anchoring",
            "severity": "mild",
            "evidence": "Student using high-certainty language while considering only one diagnosis",
            "confidence": 0.7,
        })

    # Availability bias: anchoring on an unusual/memorable diagnosis (PE without strong evidence)
    if "pe" in lower or "pulmonary embolism" in lower:
        if "d-dimer" not in lower and "wells" not in lower and "immobility" not in lower:
            biases.append({
                "type": "availability",
                "severity": "mild",
                "evidence": "Considering PE without citing supporting risk factors (immobility, Wells criteria)",
                "confidence": 0.65,
            })

    # ── Strengths & gaps ──────────────────────────────────────────────────────
    strengths = []
    gaps = []

    if diagnoses_mentioned >= 2:
        strengths.append("Maintaining a broad differential diagnosis")
    if evidence_used >= 4:
        strengths.append("Actively integrating clinical evidence into reasoning")
    if priority_used >= 1:
        strengths.append("Recognizing urgency and prioritizing dangerous diagnoses")
    if mechanism_used >= 2:
        strengths.append("Demonstrating pathophysiological reasoning")

    if diagnoses_mentioned < 2:
        gaps.append("Differential diagnosis should be broader at this stage")
    if evidence_used < 3:
        gaps.append("More clinical data should be explicitly cited to support reasoning")
    if priority_used == 0:
        gaps.append("Life-threatening diagnoses should be explicitly prioritized")
    if "serial" not in lower and "repeat" not in lower and "troponin" in lower:
        gaps.append("Single troponin result insufficient — serial measurements needed")

    # ── Reasoning quality label ───────────────────────────────────────────────
    if diagnoses_mentioned >= 3 and evidence_used >= 4:
        quality = "systematic"
    elif diagnoses_mentioned >= 2:
        quality = "divergent"
    elif any(b["type"] == "anchoring" for b in biases):
        quality = "anchored"
    else:
        quality = "convergent"

    hypothesis = _extract_hypothesis(text)
    supporting = [e for e in evidence_terms if e in lower][:3]
    missing = []
    if "ecg" not in lower and "ekg" not in lower:
        missing.append("12-lead ECG not mentioned")
    if "serial" not in lower and "repeat troponin" not in lower:
        missing.append("Serial troponin for ACS rule-out")
    if "d-dimer" not in lower:
        missing.append("D-dimer if PE remains in differential")

    return {
        "reasoning_score": total_score,
        "score_breakdown": {
            "systematic_approach": systematic,
            "evidence_integration": evidence,
            "prioritization": prioritization,
            "mechanism_understanding": mechanism,
        },
        "biases_detected": biases,
        "reasoning_node": {
            "hypothesis": hypothesis,
            "supporting_evidence": supporting,
            "missing_evidence": missing[:3],
            "reasoning_quality": quality,
        },
        "coach_insight": (
            f"Student at {quality} reasoning stage. "
            f"{'Bias risk detected. ' if biases else ''}"
            f"Strength: {strengths[0] if strengths else 'engagement with case'}."
        ),
        "student_strengths": strengths or ["Engaging with the case"],
        "student_gaps": gaps or ["Continue developing systematic approach"],
    }
