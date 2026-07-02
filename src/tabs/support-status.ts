import { strings } from '../strings';

export type SupportStatusTone = 'new' | 'progress' | 'waiting' | 'resolved' | 'unknown';
export type SupportStatusGroup = 'open' | 'waiting' | 'resolved';

export interface SupportStatusView {
  label: string;
  tone: SupportStatusTone;
  group: SupportStatusGroup;
}

const STATUS_MAP: Record<string, SupportStatusView> = {
  new: { label: strings.supportStatusNew, tone: 'new', group: 'open' },
  triaging: { label: strings.supportStatusProgress, tone: 'progress', group: 'open' },
  waiting_on_l4: { label: strings.supportStatusProgress, tone: 'progress', group: 'open' },
  escalated: { label: strings.supportStatusProgress, tone: 'progress', group: 'open' },
  reopened: { label: strings.supportStatusProgress, tone: 'progress', group: 'open' },
  waiting_on_customer: { label: strings.supportStatusWaiting, tone: 'waiting', group: 'waiting' },
  resolved: { label: strings.supportStatusResolved, tone: 'resolved', group: 'resolved' },
  closed: { label: strings.supportStatusResolved, tone: 'resolved', group: 'resolved' },
};

export function supportStatusView(status: string | null | undefined): SupportStatusView {
  const raw = typeof status === 'string' ? status.trim() : '';
  const key = raw.toLowerCase();
  return STATUS_MAP[key] ?? { label: raw || strings.supportUnknownStatus, tone: 'unknown', group: 'open' };
}
