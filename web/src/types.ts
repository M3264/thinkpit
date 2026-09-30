export type Provider = {
  id: string;
  name: string;
  kind: "openai_compat" | "anthropic";
  base_url: string;
  endpoint_path?: string;
  has_key: boolean;
};
export type Participant = {
  id: string;
  name: string;
  provider_id: string;
  model: string;
  instructions?: string;
};
export type Question = {
  text: string;
  essential: boolean;
  message_id?: string;
};
export type Message = {
  id: string;
  speaker_id: string;
  content: string;
  status: "complete" | "streaming" | "incomplete";
  provider_id?: string;
  model?: string;
  control?: { question?: Question | null; ready_to_pause: boolean };
  created_at: string;
};
export type Conversation = {
  context?: Evidence[];
  id: string;
  topic: string;
  state:
    | "ready"
    | "running"
    | "waiting_for_user"
    | "paused"
    | "stopped"
    | "failed";
  reason?: string;
  participants: Participant[];
  ask_questions: boolean;
  messages: Message[];
  attempts: {
    id: string;
    message_id: string;
    status: string;
    error?: string;
  }[];
  active_attempt_id?: string;
  pending_question?: Question;
  charged_tokens: number;
  limits: { max_turns: number; max_tokens: number; max_output_tokens: number };
  updated_at: string;
  last_event_id?: number;
};
export type StreamEvent = { id: string; kind: string; data: unknown };

export type Model = {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  free?: boolean;
  capabilities: string[];
};
export type Catalog = { models: Model[]; truncated: boolean };
export type Evidence = {
  id: string;
  kind: "file" | "web";
  name: string;
  url?: string;
  text: string;
  truncated: boolean;
};
export type PreparedEvidence = { evidence: Evidence; token: string };
export type Setup = {
  id: string;
  name: string;
  participants: Participant[];
  limits: Conversation["limits"];
  ask_questions: boolean;
};
