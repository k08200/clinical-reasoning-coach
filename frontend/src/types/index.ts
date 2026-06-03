export type UserRole = "learner" | "clinician_reviewer" | "admin";

export interface User {
  id: string;
  email: string;
  full_name: string;
  training_level: string;
  role: UserRole;
  accepted_educational_use: boolean;
  accepted_educational_use_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface ClinicalCase {
  id: string;
  title: string;
  specialty: string;
  difficulty: "easy" | "medium" | "hard";
  chief_complaint: string;
  patient_demographics: {
    age: number | string;
    sex: string;
    weight_kg?: number;
    ethnicity?: string;
  };
  history_of_present_illness: string;
  past_medical_history: string;
  medications: string[];
  physical_exam: {
    vitals: {
      bp: string;
      hr: number;
      rr: number;
      temp_c: number;
      spo2: number;
    };
    general: string;
    cardiovascular: string;
    pulmonary: string;
    abdomen: string;
    neuro: string;
    other?: string;
  };
  initial_labs: Record<string, string>;
  key_teaching_points: string[];
  cognitive_traps: string[];
  source_provenance: {
    source_count: number;
    organizations: string[];
    review_status: string;
    review_label: string;
    requires_caution: boolean;
    last_reviewed_at: string | null;
    review_valid_until: string | null;
    review_stale: boolean;
    review_content_changed: boolean;
  };
  times_used: number;
  created_at: string;
}

export interface ClinicalCaseReview {
  id: string;
  case_id: string;
  reviewer_user_id: string;
  prior_review_status: string;
  resulting_review_status: string;
  confirmations: Record<string, boolean>;
  source_snapshot: {
    source_count: number;
    organizations: string[];
    case_content_fingerprint?: string;
    alignment_checklist?: SourceAlignmentChecks;
    supported_elements?: Array<{
      title?: string;
      organization?: string;
      supports: string[];
    }>;
  };
  review_notes: string | null;
  created_at: string;
}

export interface SourceAlignmentChecks {
  teaching_points_supported: boolean;
  red_flags_supported: boolean;
  time_critical_actions_supported: boolean;
  contraindication_checks_supported: boolean;
}

export interface ClinicalSource {
  title: string;
  organization: string;
  url: string;
  supports: string[];
}

export interface ClinicalCaseReviewDetail extends ClinicalCase {
  diagnosis: string;
  clinical_red_flags: string[];
  time_critical_actions: string[];
  contraindication_checks: string[];
  clinical_sources: ClinicalSource[];
  coach_guidance: string;
  reviewed_by_user_id: string | null;
  review_notes: string | null;
}

export interface Message {
  id: string;
  role: "student" | "coach";
  content: string;
  reasoning_score: number | null;
  biases_detected: string[];
  created_at: string;
}

export interface ReasoningNode {
  id: string;
  turn: number;
  hypothesis: string;
  quality: string;
  supporting_evidence: string[];
  missing_evidence: string[];
}

export interface ReasoningEdge {
  id: string;
  source: string;
  target: string;
}

export interface ReasoningMap {
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
}

export interface CoachingSession {
  id: string;
  user_id: string;
  case_id: string;
  status: "active" | "completed" | "abandoned" | "safety_locked";
  final_reasoning_score: number | null;
  reasoning_map: ReasoningMap;
  bias_summary: Record<string, number>;
  total_input_tokens: number;
  total_output_tokens: number;
  total_thinking_tokens: number;
  messages: Message[];
  started_at: string;
  completed_at: string | null;
}

export interface ReviewSource {
  title: string;
  organization: string;
  url: string;
  supports: string[];
}

export interface ReviewBiasFeedback {
  bias_type: string;
  severity: string;
  evidence: string;
  confidence: number;
  message_turn: number;
}

export interface ClinicalSafetyCoverageItem {
  item: string;
  covered: boolean;
  evidence_turns: number[];
  evidence: Array<{
    turn: number;
    excerpt: string;
  }>;
}

export interface ClinicalSafetyCoverage {
  red_flags: ClinicalSafetyCoverageItem[];
  time_critical_actions: ClinicalSafetyCoverageItem[];
  contraindication_checks: ClinicalSafetyCoverageItem[];
  covered_count: number;
  total_count: number;
}

export interface SessionReview {
  session_id: string;
  case_id: string;
  diagnosis: string;
  score_breakdown: Record<string, number>;
  strengths: string[];
  gaps: string[];
  coach_insights: string[];
  bias_feedback: ReviewBiasFeedback[];
  key_teaching_points: string[];
  cognitive_traps: string[];
  clinical_sources: ReviewSource[];
  clinical_safety_coverage: ClinicalSafetyCoverage;
  review_status: string;
  last_reviewed_at: string | null;
}

export interface SafetyEvent {
  id: string;
  session_id: string;
  case_id: string;
  session_status: string;
  user_id: string;
  user_email: string;
  user_full_name: string;
  event_type: string;
  severity: string;
  action_taken: string;
  detected_terms: string[];
  message_turn: number;
  note: string;
  status: "open" | "resolved";
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_user_email: string | null;
  resolved_by_user_full_name: string | null;
  created_at: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
}

export type BiasType =
  | "anchoring"
  | "premature_closure"
  | "availability"
  | "framing"
  | "search_satisficing"
  | "commission";

export type StreamEvent =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "usage"; usage: Partial<TokenUsage> }
  | { type: "done" }
  | { type: "error"; message: string };

export interface BiasPattern {
  bias_type: string;
  count: number;
  severity_distribution: Record<string, number>;
  avg_confidence: number;
}

export interface ReasoningTrend {
  session_number: number;
  avg_score: number;
  date: string;
}

export interface UserAnalytics {
  user_id: string;
  total_sessions: number;
  completed_sessions: number;
  total_messages: number;
  avg_reasoning_score: number;
  bias_patterns: BiasPattern[];
  reasoning_trend: ReasoningTrend[];
  total_tokens_used: number;
  strongest_areas: string[];
  weakest_areas: string[];
  specialty_performance: Record<string, number>;
}
