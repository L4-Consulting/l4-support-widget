import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import { ApiClient, NotEnabledError, NotFoundError, RateLimitedError, ServerError, SessionExpiredError, ValidationError } from '../api/client';
import type { CaseCategory, CaseDetail, CaseMessage, CaseSeverity, SupportCase } from '../api/types';
import { emitEvent, useConfig } from '../config';
import { strings } from '../strings';
import { useTabState } from '../tab-state';

const CATEGORIES: CaseCategory[] = [
  'how_to',
  'bug',
  'billing',
  'refund',
  'access',
  'feature_request',
  'implementation',
  'data',
  'other',
];
const SEVERITIES: CaseSeverity[] = ['low', 'normal', 'high'];

export function SupportTab(): JSX.Element {
  const config = useConfig();
  const api = useMemo(() => new ApiClient(config), [config]);
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [replyError, setReplyError] = useState('');
  const { supportDraftSubject } = useTabState();
  const [subject, setSubject] = useState(supportDraftSubject);

  useEffect(() => {
    setSubject(supportDraftSubject);
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
    if (!selectedId) {
      setDetail(null);
      setDetailState('idle');
      return;
    }
    let alive = true;
    setDetailState('loading');
    api
      .getCase(selectedId)
      .then((nextDetail) => {
        if (!alive) return;
        setDetail(nextDetail);
        setDetailState('ready');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setDetail(null);
        setDetailState(error instanceof NotFoundError ? 'missing' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [api, selectedId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError('');
    setFormSuccess('');
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
      setFormSuccess(strings.caseSubmitted);
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
      const message = await api.replyToCase(selectedId, { body });
      setDetail((current) => (current ? { ...current, messages: [...current.messages, message] } : current));
      emitEvent(config, { type: 'support_case_replied', caseId: selectedId });
      form.reset();
    } catch (error) {
      setReplyError(apiErrorMessage(error));
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[17rem_1fr]" data-l4-support-tab>
      <form className="rounded-lg border border-slate-200 bg-white p-4" data-l4-support-form data-l4-card onSubmit={onSubmit}>
        <h3 className="text-sm font-semibold text-slate-900">{strings.submitTitle}</h3>
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
        {formError ? <p className="mt-3 text-sm text-red-700" role="alert">{formError}</p> : null}
        {formSuccess ? <p className="mt-3 text-sm text-green-700" role="status" aria-live="polite">{formSuccess}</p> : null}
        <button className="mt-4 w-full rounded-md bg-l4-accent px-3 py-2 text-sm font-semibold text-white" type="submit">
          {strings.submitButton}
        </button>
      </form>

      <section className="min-h-[22rem] rounded-lg border border-slate-200 bg-white" aria-label={strings.casesLabel} data-l4-card>
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">{strings.supportTitle}</h3>
        </div>
        <div className="grid gap-0 md:grid-cols-[15rem_1fr]">
          <CasesList cases={cases} state={listState} selectedId={selectedId} onSelect={setSelectedId} />
          <CaseDetailPanel state={detailState} detail={detail} onReply={onReply} replyError={replyError} />
        </div>
      </section>
    </div>
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
    <label className="mt-3 block text-sm font-medium text-slate-700">
      {label}
      {multiline ? (
        <textarea className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" name={name} />
      ) : (
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          name={name}
          required={required}
          value={value}
          onChange={onChange}
        />
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
    <label className="mt-3 block text-sm font-medium text-slate-700">
      {label}
      <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" name={name} defaultValue={defaultValue}>
        {values.map((value) => (
          <option key={value} value={value}>
            {value.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function CasesList({
  cases,
  state,
  selectedId,
  onSelect,
}: {
  cases: SupportCase[];
  state: 'loading' | 'ready' | 'error';
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (state === 'loading') return <StateMessage tone="loading">{strings.casesLoading}</StateMessage>;
  if (state === 'error') return <StateMessage tone="error">{strings.casesError}</StateMessage>;
  if (cases.length === 0) return <StateMessage tone="empty">{strings.noCases}</StateMessage>;

  return (
    <ul className="divide-y divide-slate-200 border-r border-slate-200" data-l4-cases-list>
      {cases.map((supportCase) => (
        <li key={supportCase.id}>
          <button
            type="button"
            className={`block w-full px-4 py-3 text-left text-sm ${selectedId === supportCase.id ? 'bg-blue-50' : 'bg-white'}`}
            onClick={() => onSelect(supportCase.id)}
          >
            <span className="block font-semibold text-slate-900">{supportCase.subject}</span>
            <span className="block text-xs text-slate-600">{supportCase.status}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CaseDetailPanel({
  state,
  detail,
  onReply,
  replyError,
}: {
  state: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  detail: CaseDetail | null;
  onReply: (event: FormEvent<HTMLFormElement>) => void;
  replyError: string;
}): JSX.Element {
  if (state === 'idle') return <StateMessage tone="empty">{strings.selectCase}</StateMessage>;
  if (state === 'loading') return <StateMessage tone="loading">{strings.caseLoading}</StateMessage>;
  if (state === 'missing') return <StateMessage tone="empty">{strings.caseUnavailable}</StateMessage>;
  if (state === 'error' || !detail) return <StateMessage tone="error">{strings.caseError}</StateMessage>;

  return (
    <article className="p-4" data-l4-case-detail>
      <h4 className="text-base font-semibold text-slate-900">{detail.case.subject}</h4>
      <p className="mt-1 text-xs text-slate-600">
        {detail.case.category.replace(/_/g, ' ')} · {detail.case.severity} · {detail.case.status}
      </p>
      <ol className="mt-4 space-y-3" data-l4-message-list>
        {detail.messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </ol>
      <form className="mt-4 border-t border-slate-200 pt-4" onSubmit={onReply}>
        <label className="block text-sm font-medium text-slate-700">
          {strings.replyLabel}
          <textarea name="body" className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        {replyError ? <p className="mt-2 text-sm text-red-700" role="alert">{replyError}</p> : null}
        <button className="mt-3 rounded-md bg-l4-accent px-3 py-2 text-sm font-semibold text-white" type="submit">
          {strings.replyButton}
        </button>
      </form>
    </article>
  );
}

function MessageItem({ message }: { message: CaseMessage }): JSX.Element {
  return (
    <li className="rounded-md bg-slate-50 p-3 text-sm">
      <p className="font-medium text-slate-900">{message.author_type}</p>
      <p className="mt-1 whitespace-pre-wrap text-slate-700">{message.body}</p>
    </li>
  );
}

function StateMessage({ children, tone }: { children: string; tone: 'empty' | 'loading' | 'error' }): JSX.Element {
  return (
    <p
      className={`p-4 text-sm ${tone === 'error' ? 'text-red-700' : 'text-slate-600'}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-l4-state={tone}
    >
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
