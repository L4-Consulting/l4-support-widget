import type {
  CaseDetail,
  CaseMessage,
  CreateCaseBody,
  CreateMessageBody,
  DocArticleResponse,
  DocsSearchResponse,
  ListCasesResponse,
  RoadmapResponse,
} from './types';
import { emitEvent, type NormalizedConfig, type WidgetEvent } from '../config';
import { strings } from '../strings';

export interface ValidationPayload {
  error: string;
  details?: unknown;
}

export class SessionExpiredError extends Error {
  constructor(message = strings.sessionExpired) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class NotEnabledError extends Error {
  constructor(message = strings.notEnabled) {
    super(message);
    this.name = 'NotEnabledError';
  }
}

export class RateLimitedError extends Error {
  retryAfter: number | null;

  constructor(retryAfter: number | null) {
    super(strings.rateLimited);
    this.name = 'RateLimitedError';
    this.retryAfter = retryAfter;
  }
}

export class ValidationError extends Error {
  details?: unknown;

  constructor(payload: ValidationPayload) {
    super(payload.error || strings.validationError);
    this.name = 'ValidationError';
    this.details = payload.details;
  }
}

export class ServerError extends Error {
  constructor(message = strings.genericError) {
    super(message);
    this.name = 'ServerError';
  }
}

export class NotFoundError extends Error {
  constructor(message = strings.caseUnavailable) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ApiClient {
  #config: NormalizedConfig;

  constructor(config: NormalizedConfig) {
    this.#config = config;
  }

  createCase(body: CreateCaseBody): Promise<CaseDetail['case']> {
    return this.#request<{ case: CaseDetail['case'] }>('/api/client/support/cases', {
      method: 'POST',
      body,
    }).then((result) => result.case);
  }

  listCases(): Promise<ListCasesResponse> {
    return this.#request<ListCasesResponse>('/api/client/support/cases');
  }

  getCase(caseId: string): Promise<CaseDetail> {
    return this.#request<CaseDetail>(`/api/client/support/cases/${encodeURIComponent(caseId)}`);
  }

  replyToCase(caseId: string, body: CreateMessageBody): Promise<CaseMessage> {
    return this.#request<{ message: CaseMessage }>(`/api/client/support/cases/${encodeURIComponent(caseId)}/messages`, {
      method: 'POST',
      body,
    }).then((result) => result.message);
  }

  searchDocs(q: string): Promise<DocsSearchResponse> {
    return this.#request<DocsSearchResponse>(`/api/client/docs/search?q=${encodeURIComponent(q)}`);
  }

  getDocArticle(slug: string): Promise<DocArticleResponse> {
    return this.#request<DocArticleResponse>(`/api/client/docs/articles/${encodeURIComponent(slug)}`);
  }

  getRoadmap(): Promise<RoadmapResponse> {
    return this.#request<RoadmapResponse>('/api/client/roadmap');
  }

  async #request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
    state: { retriedAuth?: boolean; retriedServer?: boolean } = {},
  ): Promise<T> {
    const token = await this.#config.getToken();
    if (!token) {
      this.#emit({ type: 'session_expired', reason: 'missing_token' });
      throw new SessionExpiredError();
    }

    let response: Response;
    try {
      response = await fetch(`${this.#config.apiBase}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Product-Key': this.#config.productKey,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      if (!state.retriedServer) {
        return this.#request<T>(path, options, { ...state, retriedServer: true });
      }
      this.#emit({ type: 'server_error', status: 'network' });
      throw new ServerError();
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    if (response.status === 401) {
      if (!state.retriedAuth) {
        return this.#request<T>(path, options, { ...state, retriedAuth: true });
      }
      this.#emit({ type: 'session_expired', status: 401 });
      throw new SessionExpiredError();
    }

    if (response.status === 403) throw new NotEnabledError();
    if (response.status === 404) throw new NotFoundError();
    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
      this.#emit({ type: 'rate_limited', status: 429, retryAfter });
      throw new RateLimitedError(retryAfter);
    }
    if (response.status === 400) throw new ValidationError(await readValidation(response));

    if (response.status >= 500) {
      if (!state.retriedServer) {
        return this.#request<T>(path, options, { ...state, retriedServer: true });
      }
      this.#emit({ type: 'server_error', status: response.status });
      throw new ServerError();
    }

    throw new ServerError();
  }

  #emit(event: WidgetEvent): void {
    emitEvent(this.#config, event);
  }
}

async function readValidation(response: Response): Promise<ValidationPayload> {
  try {
    return (await response.json()) as ValidationPayload;
  } catch {
    return { error: strings.validationError };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}
