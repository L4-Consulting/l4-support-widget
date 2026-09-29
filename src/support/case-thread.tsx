import type { JSX } from 'react';
import type { CaseDetail, CaseEvent, CaseMessage, SupportCase } from '../api/types';
import type { NormalizedConfig } from '../config';
import { strings } from '../strings';
import { supportStatusView } from '../tabs/support-status';
import vegaAvatarUrl from '../assets/vega-profile-128.jpg';

export function StatusPill({ status }: { status: string }): JSX.Element {
  const view = supportStatusView(status);
  return (
    <span className="l4-status-pill" data-tone={view.tone}>
      {view.label}
    </span>
  );
}

export function CaseThreadHeader({ detail }: { detail: CaseDetail }): JSX.Element {
  return (
    <div className="l4-thread-head">
      <div>
        <h3 className="l4-thread-title">{detail.case.subject}</h3>
        <div className="l4-thread-meta">
          <span className="l4-case-id">{caseNumber(detail.case)}</span>
          <StatusPill status={detail.case.status} />
          <span>
            {strings.supportOpenedPrefix} {formatDateTime(detail.case.created_at)}
          </span>
          <span>
            {strings.supportCategoryPrefix}{strings.separatorDot}{(detail.case.category ?? 'other').replace(/_/g, ' ')}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CaseThreadStream({
  detail,
  config,
}: {
  detail: CaseDetail;
  config: NormalizedConfig;
}): JSX.Element {
  return (
    <ol className="l4-thread-stream" data-l4-message-list>
      {timelineItems(detail).map((item) =>
        item.kind === 'message' ? (
          <MessageItem key={`message-${item.message.id}`} message={item.message} config={config} />
        ) : (
          <EventItem key={`event-${item.event.id}`} event={item.event} />
        ),
      )}
    </ol>
  );
}

export function MessageItem({
  message,
  config,
}: {
  message: CaseMessage;
  config: NormalizedConfig;
}): JSX.Element {
  const isCustomer = message.author_type === 'client' || message.author_type === 'customer';
  const isAi = message.author_type === 'agent';
  const authorName = isCustomer ? strings.supportYouAuthor : message.author_name || strings.supportAgentAuthor;
  return (
    <li className="l4-message" data-author={isCustomer ? 'customer' : 'l4'}>
      <MessageAvatar message={message} authorName={authorName} isCustomer={isCustomer} config={config} />
      <div className="l4-message-body">
        <div className="l4-message-who">
          {isCustomer ? (
            <span>{authorName}</span>
          ) : (
            <>
              <span>{authorName}</span>
              {isAi ? <span className="l4-vega-badge">{strings.supportVegaBadge}</span> : null}
            </>
          )}
          <span>{formatTime(message.created_at)}</span>
        </div>
        <div className="l4-bubble">{message.body}</div>
      </div>
    </li>
  );
}

function MessageAvatar({
  message,
  authorName,
  isCustomer,
  config,
}: {
  message: CaseMessage;
  authorName: string;
  isCustomer: boolean;
  config: NormalizedConfig;
}): JSX.Element {
  if (message.author_type === 'agent' && config.avatar.enabled) {
    return (
      <img
        className="l4-avatar l4-agent-avatar"
        src={vegaAvatarUrl}
        alt=""
        data-l4-agent-avatar
      />
    );
  }
  return <div className="l4-avatar">{isCustomer ? initials(authorName) : l4Initials(message)}</div>;
}

function EventItem({ event }: { event: CaseEvent }): JSX.Element | null {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
  const nextStatus = eventNextStatus(event, metadata);
  const label = eventLabel(event, nextStatus);
  if (!label) return null;

  return (
    <li className="l4-event">
      <span>{formatTime(event.created_at)}</span>
      {nextStatus ? (
        <span className="l4-event-pill">
          <span>{strings.supportStatusTransition}</span>
          <StatusPill status={nextStatus} />
          <span>{eventReason(event, metadata)}</span>
        </span>
      ) : (
        <span className="l4-event-pill">{label}</span>
      )}
    </li>
  );
}

type TimelineItem =
  | { kind: 'message'; at: string; message: CaseMessage }
  | { kind: 'event'; at: string; event: CaseEvent };

export function timelineItems(detail: CaseDetail): TimelineItem[] {
  const messages = detail.messages.map((message) => ({ kind: 'message' as const, at: message.created_at, message }));
  const events = (detail.events ?? [])
    .filter(isRenderableEvent)
    .map((event) => ({ kind: 'event' as const, at: event.created_at, event }));
  return [...messages, ...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function isRenderableEvent(event: CaseEvent): boolean {
  if (!event || typeof event.id !== 'string' || typeof event.created_at !== 'string') return false;
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
  return Boolean(eventLabel(event, eventNextStatus(event, metadata)));
}

function eventNextStatus(event: CaseEvent, metadata: Record<string, unknown> | null): string | null {
  return readString(metadata, 'next_status') ?? (event.event_type === 'case_updated' ? readString(metadata, 'status') : null);
}

function eventLabel(event: CaseEvent, nextStatus: string | null): string | null {
  if (nextStatus) return strings.supportStatusTransition;
  if (event.event_type === 'case_assigned') return strings.supportEventCaseAssigned;
  return null;
}

function eventReason(event: CaseEvent, metadata: Record<string, unknown> | null): string {
  const reason = readString(metadata, 'reason');
  if (reason) return reason;
  return event.event_type === 'agent_triage_completed' ? strings.supportAutoTriaged : strings.supportEventUpdated;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function caseNumber(supportCase: SupportCase): string {
  return supportCase.case_number || supportCase.id || strings.supportCaseNumberFallback;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes || 1}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function l4Initials(message: CaseMessage): string {
  if (message.author_type === 'agent') return 'V';
  return initials(message.author_name || strings.supportAgentAuthor);
}

export function showCsatForCase(detail: CaseDetail): boolean {
  return supportStatusView(detail.case.status).group === 'resolved';
}
