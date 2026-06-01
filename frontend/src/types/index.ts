export interface User {
  id: string;
  email: string;
  full_name: string;
  training_level: string;
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
    age: number;
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
  times_used: number;
  created_at: string;
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
  status: "active" | "completed" | "abandoned";
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
