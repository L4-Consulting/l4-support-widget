/**
 * FROZEN narrow client DTOs for the `/api/client/*` support surface.
 *
 * These are deliberately a small (~8-field) UI projection of the backend
 * shapes. We do NOT mirror the raw `work_items` row, and the CaseDetail
 * envelope intentionally IGNORES keys the widget does not render
 * (deliveries / events / attachments / knowledge_links / csat / automation_runs).
 *
 * Contract source: l4-cos `/api/client/*` (PR #666 + #676). Field lists are
 * frozen per the v2 plan's "API CONTRACT" correction. Widen only via a
 * deliberate contract bump.
 */

/** Category the client may set when filing a case. */
export type CaseCategory =
  | 'how_to'
  | 'bug'
  | 'billing'
  | 'refund'
  | 'access'
  | 'feature_request'
  | 'implementation'
  | 'data'
  | 'other';

/** Severity is capped at 'high' for client-filed cases. */
export type CaseSeverity = 'low' | 'normal' | 'high';

/** A support case as the client sees it in list/detail contexts. */
export interface SupportCase {
  id: string;
  case_number?: string;
  subject: string;
  status: string;
  category: CaseCategory;
  severity: CaseSeverity;
  created_at: string;
  updated_at?: string;
  /** Present when the backend chooses to surface who filed / for whom. */
  contact_name?: string;
  company_name?: string;
  /** Optional list projection fields from l4-cos listSupportCases. */
  last_public_message_at?: string | null;
  last_public_message_author_type?: string | null;
  last_customer_message_at?: string | null;
  last_customer_message_preview?: string | null;
  last_l4_public_reply_at?: string | null;
  has_unanswered_customer_activity?: boolean | null;
}

/** Who authored a message on a case, from the client's vantage point. */
export type MessageAuthorType = 'client' | 'customer' | 'agent' | 'human' | 'system';

/** Visibility of a message; the client only ever receives public ones. */
export type MessageVisibility = 'public' | 'internal';

/** A single message in a case thread (client-visible projection). */
export interface CaseMessage {
  id: string;
  body: string;
  author_type: MessageAuthorType;
  author_name?: string | null;
  visibility: MessageVisibility;
  created_at: string;
}

/**
 * Minimal event projection observed in l4-cos api/src/lib/work-items.js:
 * getSupportCase reads `SELECT * FROM work_item_events ... ORDER BY created_at`.
 * Status transitions are only safely renderable when carried in metadata.
 */
export interface CaseEvent {
  id: string;
  event_type: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Detail envelope from `GET /api/client/support/cases/:id`.
 * The raw backend envelope carries more keys; we narrow to rendered fields.
 */
export interface CaseDetail {
  case: SupportCase;
  messages: CaseMessage[];
  events?: CaseEvent[];
}

/** Request body for `POST /api/client/support/cases`. Only `subject` is required. */
export interface CreateCaseBody {
  subject: string;
  description?: string;
  category: CaseCategory;
  severity: CaseSeverity;
}

/** Request body for `POST /api/client/support/cases/:id/messages`. */
export interface CreateMessageBody {
  body: string;
}

/** A client-visible roadmap entry from `GET /api/client/roadmap`. */
export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  target_date: string | null;
  quarter: string | null;
  phase: string | null;
}

/**
 * A single docs-search hit from `GET /api/client/docs/search?q=`.
 * NOTE: there is intentionally NO `snippet` — UI copy must not promise excerpts.
 * Queries under 3 characters return an empty array.
 */
export interface DocResult {
  id: string;
  slug?: string;
  title: string;
  url: string;
  summary?: string | null;
  source_type: string;
  relationship: string;
  match_score: number;
  suggestion_source: string;
}

export interface DocArticle extends DocResult {
  slug: string;
  body_markdown: string;
}

/** List responses from the backend (no pagination yet — noted for scale). */
export interface ListCasesResponse {
  cases: SupportCase[];
}

export interface RoadmapResponse {
  items: RoadmapItem[];
}

export interface DocsSearchResponse {
  results: DocResult[];
}

export interface DocArticleResponse {
  article: DocArticle;
}
