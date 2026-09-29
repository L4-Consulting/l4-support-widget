import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import { ApiClient, NotEnabledError, NotFoundError, RateLimitedError, ServerError, SessionExpiredError, ValidationError } from '../api/client';
import type { CaseCategory, CaseCsat, CaseDetail, CaseSeverity, SupportCase, DocResult } from '../api/types';
import { emitEvent, emitNarration, useConfig } from '../config';
import { strings } from '../strings';
import { useTabState } from '../tab-state';
import { ChatConversationHost } from '../chat-bridge';
import {
  CaseThreadHeader,
  CaseThreadStream,
  StatusPill,
  caseNumber,
  relativeTime,
  showCsatForCase,
} from '../support/case-thread';
import { CsatPanel } from './CsatPanel';
import { supportStatusView, type SupportStatusGroup } from './support-status';

const CATEGORIES: CaseCategory[] = ['how_to', 'bug', 'billing', 'refund', 'access', 'feature_request', 'implementation', 'data', 'other'];
const SEVERITIES: CaseSeverity[] = ['low', 'normal', 'high'];
const MIN_SEARCH_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;
const DETAIL_POLL_MS = 20_000;
const FILTERS: Array<{ group: SupportStatusGroup; label: string }> = [
  { group: 'open', label: strings.supportFilterOpen },
  { group: 'waiting', label: strings.supportFilterWaiting },
  { group: 'resolved', label: strings.supportFilterResolved },
];

type DetailState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type ListState = 'loading' | 'ready' | 'error';
type RightPaneMode = 'detail' | 'new';
type MobileView = 'list' | 'detail';

export function SupportTab(): JSX.Element {
  const config = useConfig();
  const api = useMemo(() => new ApiClient(config), [config]);
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('detail');
  const [mobileView, setMobileView] = useState<MobileView>('detail');
  const [activeFilter, setActiveFilter] = useState<SupportStatusGroup>('open');
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState<DocResult[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailState, setDetailState] = useState<DetailState>('idle');
  const detailRequestSequence = useRef(0);
  const latestDetailRequest = useRef<{ caseId: string | null; sequence: number }>({ caseId: null, sequence: 0 });
  const [formError, setFormError] = useState('');
  const [replyError, setReplyError] = useState('');
  const { supportDraftSubject } = useTabState();
  const [subject, setSubject] = useState(supportDraftSubject);

  useEffect(() => {
    setSubject(supportDraftSubject);
    if (supportDraftSubject) {
      setRightPaneMode('new');
      setMobileView('detail');
    }
  }, [supportDraftSubject]);

  useEffect(() => {
    let alive = true;
    setListState('loading');
    api
      .listCases()
      .then(({ cases: nextCases }) => {
        if (!alive) return;
        setCases(nextCases);
        setListState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setListState('error');
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    if (selectedId || rightPaneMode === 'new' || cases.length === 0) return;
    setSelectedId(cases[0].id);
  }, [cases, rightPaneMode, selectedId]);

  const chatEnabled = config.chat?.enabled === true;
  const [chatRuntimeReady, setChatRuntimeReady] = useState(true);
  const chatUsesSeparateAsset = chatEnabled && chatRuntimeReady;

  useEffect(() => {
    setChatRuntimeReady(true);
  }, [chatEnabled, selectedId]);

  useEffect(() => {
    if (!selectedId || rightPaneMode === 'new') {
      setDetail(null);
      setDetailState('idle');
      return;
    }
    if (chatUsesSeparateAsset) {
      setDetailState('ready');
      return;
    }
    let alive = true;
    let polling = false;
    let intervalId: number | undefined;
    setDetailState('loading');
    const fetchDetail = (silent = false) => {
      if (silent && polling) return;
      if (silent) polling = true;
      const requestSequence = ++detailRequestSequence.current;
      latestDetailRequest.current = { caseId: selectedId, sequence: requestSequence };
      api.getCase(selectedId)
      .then((nextDetail) => {
        if (!alive || latestDetailRequest.current.caseId !== selectedId || latestDetailRequest.current.sequence !== requestSequence) return;
        setDetail(nextDetail);
        setDetailState('ready');
      })
      .catch((error: unknown) => {
        if (
          !alive
          || silent
          || latestDetailRequest.current.caseId !== selectedId
          || latestDetailRequest.current.sequence !== requestSequence
        ) return;
        setDetail(null);
        setDetailState(error instanceof NotFoundError ? 'missing' : 'error');
      })
      .finally(() => {
        polling = false;
      });
    };
    const stopPolling = () => {
      if (intervalId !== undefined) window.clearInterval(intervalId);
      intervalId = undefined;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState !== 'visible') return;
      intervalId = window.setInterval(() => fetchDetail(true), DETAIL_POLL_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') startPolling();
      else stopPolling();
    };

    fetchDetail();
    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      alive = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [api, chatUsesSeparateAsset, rightPaneMode, selectedId]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < MIN_SEARCH_LENGTH) {
      setAnswers([]);
      return;
    }

    let alive = true;
    const timeoutId = window.setTimeout(() => {
      api
        .searchDocs(trimmedQuery)
        .then(({ results }) => {
          if (alive) setAnswers(results);
        })
        .catch(() => {
          if (alive) setAnswers([]);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
    };
  }, [api, trimmedQuery]);

  const filteredCases = useMemo(() => {
    const normalizedQuery = trimmedQuery.toLowerCase();
    return cases.filter((supportCase) => {
      if (supportStatusView(supportCase.status).group !== activeFilter) return false;
      if (!normalizedQuery) return true;
      return [
        supportCase.case_number,
        supportCase.subject,
        supportCase.status,
        supportCase.last_customer_message_preview,
        supportCase.contact_name,
        supportCase.company_name,
      ].some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery));
    });
  }, [activeFilter, cases, trimmedQuery]);

  const counts = useMemo(() => {
    return cases.reduce<Record<SupportStatusGroup, number>>(
      (acc, supportCase) => {
        acc[supportStatusView(supportCase.status).group] += 1;
        return acc;
      },
      { open: 0, waiting: 0, resolved: 0 },
    );
  }, [cases]);

  function selectCase(id: string) {
    setSelectedId(id);
    setRightPaneMode('detail');
    setMobileView('detail');
  }

  function startNewCase() {
    setRightPaneMode('new');
    setMobileView('detail');
    setFormError('');
  }

  function showListOnMobile() {
    setSelectedId(null);
    setRightPaneMode('detail');
    setMobileView('list');
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError('');
    const data = new FormData(form);
    const nextSubject = String(data.get('subject') ?? '').trim();
    const description = String(data.get('description') ?? '').trim();
    const category = String(data.get('category') ?? 'other') as CaseCategory;
    const severity = String(data.get('severity') ?? 'normal') as CaseSeverity;
    if (!nextSubject) {
      setFormError(strings.subjectRequired);
      return;
    }

    try {
      const created = await api.createCase({
        subject: nextSubject,
        description: description || undefined,
        category,
        severity,
      });
      setCases((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedId(created.id);
      setRightPaneMode('detail');
      setMobileView('detail');
      setActiveFilter(supportStatusView(created.status).group);
      emitEvent(config, { type: 'submit', caseId: created.id });
      form.reset();
      setSubject('');
    } catch (error) {
      setFormError(apiErrorMessage(error));
    }
  }

  async function onReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const form = event.currentTarget;
    setReplyError('');
    const data = new FormData(form);
    const body = String(data.get('body') ?? '').trim();
    if (!body) {
      setReplyError(strings.replyRequired);
      return;
    }
    try {
      latestDetailRequest.current = { caseId: selectedId, sequence: ++detailRequestSequence.current };
      const message = await api.replyToCase(selectedId, { body });
      latestDetailRequest.current = { caseId: selectedId, sequence: ++detailRequestSequence.current };
      setDetail((current) => (current ? { ...current, messages: [...current.messages, message] } : current));
      setCases((current) => current.map((item) => (item.id === selectedId ? { ...item, last_customer_message_preview: body } : item)));
      emitEvent(config, { type: 'support_case_replied', caseId: selectedId });
      form.reset();
    } catch (error) {
      setReplyError(apiErrorMessage(error));
    }
  }

  function onCsatSubmitted(csat: CaseCsat) {
    setDetail((current) => (current ? { ...current, csat } : current));
  }

  return (
    <div className="l4-support-console" data-l4-support-tab data-l4-mobile-view={mobileView}>
      <aside className="l4-case-list-pane" aria-label={strings.casesLabel}>
        <div className="l4-case-tools">
          <input
            className="l4-case-search"
            type="search"
            aria-label={strings.supportSearchPlaceholder}
            placeholder={strings.supportSearchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="l4-new-case-button" type="button" onClick={startNewCase}>
            {strings.supportNewButton}
          </button>
        </div>
        <div className="l4-case-filters" role="group" aria-label={strings.casesLabel}>
          {FILTERS.map((filter) => (
            <button
              key={filter.group}
              className="l4-case-filter"
              type="button"
              data-active={activeFilter === filter.group}
              aria-pressed={activeFilter === filter.group}
              onClick={() => setActiveFilter(filter.group)}
            >
              {filter.label}{strings.separatorDot}{counts[filter.group]}
            </button>
          ))}
        </div>
        <SearchAnswers results={answers} show={trimmedQuery.length >= MIN_SEARCH_LENGTH} />
        <div className="l4-list-heading">{strings.supportTicketsTitle}</div>
        <CasesList cases={filteredCases} state={listState} selectedId={selectedId} onSelect={selectCase} />
      </aside>

      <section className="l4-thread-pane" aria-label={strings.casesLabel} data-l4-card>
        <button className="l4-mobile-back" type="button" onClick={showListOnMobile}>
          {strings.supportBackButton}
        </button>
        {rightPaneMode === 'new' ? (
          <CreateCasePanel subject={subject} setSubject={setSubject} formError={formError} onSubmit={onSubmit} />
        ) : (
          <CaseDetailPanel
            state={detailState}
            detail={detail}
            api={api}
            onReply={onReply}
            replyError={replyError}
            onCsatSubmitted={onCsatSubmitted}
            caseId={selectedId}
            chatEnabled={chatUsesSeparateAsset}
            onChatRuntimeUnavailable={() => setChatRuntimeReady(false)}
          />
        )}
      </section>
    </div>
  );
}

function CreateCasePanel({
  subject,
  setSubject,
  formError,
  onSubmit,
}: {
  subject: string;
  setSubject: (value: string) => void;
  formError: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): JSX.Element {
  return (
    <article className="l4-create-case" data-l4-case-detail>
      <div className="l4-thread-head">
        <div>
          <h3 className="l4-thread-title">{strings.supportNewThreadTitle}</h3>
          <p className="l4-thread-subtle">{strings.supportCreateHint}</p>
        </div>
      </div>
      <form className="l4-create-form" data-l4-support-form onSubmit={onSubmit}>
        <Field
          label={strings.subjectLabel}
          name="subject"
          required
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
        <Field label={strings.descriptionLabel} name="description" multiline />
        <Select label={strings.categoryLabel} name="category" values={CATEGORIES} defaultValue="other" />
        <Select label={strings.severityLabel} name="severity" values={SEVERITIES} defaultValue="normal" />
        {formError ? <p className="l4-form-error" role="alert">{formError}</p> : null}
        <button className="l4-send-button" type="submit">
          {strings.submitButton}
        </button>
      </form>
    </article>
  );
}

function Field({
  label,
  name,
  required,
  multiline,
  value,
  onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  multiline?: boolean;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label className="l4-field">
      <span>{label}</span>
      {multiline ? (
        <textarea className="l4-input l4-textarea" name={name} />
      ) : (
        <input className="l4-input" name={name} required={required} value={value} onChange={onChange} />
      )}
    </label>
  );
}

function Select({
  label,
  name,
  values,
  defaultValue,
}: {
  label: string;
  name: string;
  values: string[];
  defaultValue: string;
}): JSX.Element {
  return (
    <label className="l4-field">
      <span>{label}</span>
      <select className="l4-input" name={name} defaultValue={defaultValue}>
        {values.map((value) => (
          <option key={value} value={value}>
            {value.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchAnswers({ results, show }: { results: DocResult[]; show: boolean }): JSX.Element | null {
  if (!show || results.length === 0) return null;

  return (
    <section className="l4-answers-group" aria-label={strings.supportAnswersTitle}>
      <h3>{strings.supportAnswersTitle}</h3>
      <ul>
        {results.slice(0, 3).map((result) => (
          <li key={result.id}>
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {result.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CasesList({
  cases,
  state,
  selectedId,
  onSelect,
}: {
  cases: SupportCase[];
  state: ListState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (state === 'loading') return <StateMessage tone="loading">{strings.casesLoading}</StateMessage>;
  if (state === 'error') return <StateMessage tone="error">{strings.casesError}</StateMessage>;
  if (cases.length === 0) return <StateMessage tone="empty">{strings.noCases}</StateMessage>;

  return (
    <ul className="l4-ticket-list" data-l4-cases-list>
      {cases.map((supportCase) => (
        <li key={supportCase.id}>
          <TicketRow supportCase={supportCase} selected={selectedId === supportCase.id} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function TicketRow({
  supportCase,
  selected,
  onSelect,
}: {
  supportCase: SupportCase;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const preview = supportCase.last_customer_message_preview;
  const timestamp = supportCase.last_public_message_at ?? supportCase.updated_at ?? supportCase.created_at;

  return (
    <button
      className="l4-ticket-row"
      type="button"
      data-selected={selected}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(supportCase.id)}
    >
      <span className="l4-ticket-line">
        <span className="l4-case-id">{caseNumber(supportCase)}</span>
        <span className="l4-ticket-time">{relativeTime(timestamp)}</span>
      </span>
      <span className="l4-ticket-subject">{supportCase.subject}</span>
      <span className="l4-ticket-line">
        <StatusPill status={supportCase.status} />
        {supportCase.has_unanswered_customer_activity ? (
          <>
            <span className="l4-unread-dot" aria-hidden="true" />
            <span className="l4-sr-only">Unread customer activity</span>
          </>
        ) : null}
        {preview ? <span className="l4-ticket-preview">{preview}</span> : null}
      </span>
    </button>
  );
}

function CaseDetailPanel({
  state,
  detail,
  api,
  onReply,
  replyError,
  onCsatSubmitted,
  caseId,
  chatEnabled,
  onChatRuntimeUnavailable,
}: {
  state: DetailState;
  detail: CaseDetail | null;
  api: ApiClient;
  onReply: (event: FormEvent<HTMLFormElement>) => void;
  replyError: string;
  onCsatSubmitted: (csat: CaseCsat) => void;
  caseId: string | null;
  chatEnabled: boolean;
  onChatRuntimeUnavailable?: () => void;
}): JSX.Element {
  const config = useConfig();
  const narratedMessageIds = useRef(new Set<string>());

  useEffect(() => {
    if (!config.voice.enabled || !config.onNarrate || !detail) return;
    for (const message of detail.messages) {
      if (message.author_type !== 'agent' || narratedMessageIds.current.has(message.id)) continue;
      narratedMessageIds.current.add(message.id);
      emitNarration(config, {
        id: message.id,
        body: message.body,
        author_type: 'agent',
        author_name: message.author_name,
        created_at: message.created_at,
      });
    }
  }, [config, detail]);

  if (state === 'idle') return <EmptyThread />;
  if (!chatEnabled && state === 'loading') return <StateMessage tone="loading">{strings.caseLoading}</StateMessage>;
  if (!chatEnabled && state === 'missing') return <StateMessage tone="empty">{strings.caseUnavailable}</StateMessage>;
  if (!chatEnabled && (state === 'error' || !detail)) return <StateMessage tone="error">{strings.caseError}</StateMessage>;

  if (chatEnabled) {
    return (
      <article className="l4-thread" data-l4-case-detail data-l4-chat-enabled>
        <ChatConversationHost caseId={caseId} onRuntimeUnavailable={onChatRuntimeUnavailable} />
      </article>
    );
  }

  if (!detail) {
    return <StateMessage tone="error">{strings.caseError}</StateMessage>;
  }

  return (
    <article className="l4-thread" data-l4-case-detail>
      <CaseThreadHeader detail={detail} />
      <CaseThreadStream detail={detail} config={config} />
      {showCsatForCase(detail) ? (
        <CsatPanel
          api={api}
          caseId={detail.case.id}
          initialCsat={detail.csat ?? null}
          onSubmitted={onCsatSubmitted}
        />
      ) : null}
      <form className="l4-composer" onSubmit={onReply}>
        <label className="l4-reply-label">
          <span>{strings.replyLabel}</span>
          <textarea className="l4-reply-box" name="body" placeholder={strings.replyPlaceholder} />
        </label>
        {replyError ? <p className="l4-form-error" role="alert">{replyError}</p> : null}
        <div className="l4-composer-actions">
          <button className="l4-send-button" type="submit">
            {strings.replyButton}
          </button>
        </div>
      </form>
    </article>
  );
}

function EmptyThread(): JSX.Element {
  return (
    <div className="l4-empty-thread" role="status" aria-live="polite">
      <h3>{strings.supportEmptyThreadTitle}</h3>
      <p>{strings.selectCase}</p>
    </div>
  );
}

function StateMessage({ children, tone }: { children: string; tone: 'empty' | 'loading' | 'error' }): JSX.Element {
  return (
    <p className="l4-state-message" role={tone === 'error' ? 'alert' : 'status'} aria-live="polite" data-l4-state={tone}>
      {children}
    </p>
  );
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof SessionExpiredError) return strings.sessionExpired;
  if (error instanceof NotEnabledError) return strings.notEnabled;
  if (error instanceof RateLimitedError) return strings.rateLimited;
  if (error instanceof ValidationError) return error.message || strings.validationError;
  if (error instanceof NotFoundError) return strings.caseUnavailable;
  if (error instanceof ServerError) return strings.genericError;
  return error instanceof Error ? error.message : strings.genericError;
}
