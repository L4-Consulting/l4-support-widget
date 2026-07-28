import { useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react';
import { ApiClient, ConflictError, NotEnabledError, NotFoundError, RateLimitedError, SessionExpiredError, ValidationError } from '../api/client';
import type { CaseCsat } from '../api/types';
import { strings } from '../strings';

const VALUES: readonly number[] = [1, 2, 3, 4, 5];
const MAX_LEN = 5000;
const TOTAL = VALUES.length;

export interface CsatPanelProps {
  api: ApiClient;
  caseId: string;
  initialCsat: CaseCsat | null;
  onSubmitted: (csat: CaseCsat) => void;
}

/**
 * Star-rating CSAT panel. 1..5 radio-group with arrow-key navigation per
 * WAI-ARIA practices, optional comment (≤5000 chars), inline non-destructive
 * errors. Backend upserts; on success renders the submitted state with an
 * Edit button. Never throws or unmounts the parent thread.
 */
export function CsatPanel({ api, caseId, initialCsat, onSubmitted }: CsatPanelProps): JSX.Element {
  const [rating, setRating] = useState<number>(initialCsat?.rating ?? 0);
  const [comment, setComment] = useState<string>(initialCsat?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [submitted, setSubmitted] = useState<CaseCsat | null>(initialCsat);
  const starsRef = useRef<HTMLFieldSetElement | null>(null);

  useEffect(() => {
    setRating(initialCsat?.rating ?? 0);
    setComment(initialCsat?.comment ?? '');
    setSubmitted(initialCsat ?? null);
    setError('');
  }, [caseId, initialCsat]);

  function focusStar(value: number) {
    const node = starsRef.current?.querySelector<HTMLInputElement>(`input[data-csat-value="${value}"]`);
    node?.focus();
  }

  function onStarKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    const k = event.key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Home' && k !== 'End') return;
    const raw = Number((event.target as HTMLInputElement).dataset.csatValue);
    if (!Number.isFinite(raw)) return;
    event.preventDefault();
    let next: number;
    if (k === 'Home') next = VALUES[0];
    else if (k === 'End') next = VALUES[TOTAL - 1];
    else if (k === 'ArrowRight' || k === 'ArrowUp') next = raw >= VALUES[TOTAL - 1] ? VALUES[0] : raw + 1;
    else next = raw <= VALUES[0] ? VALUES[TOTAL - 1] : raw - 1;
    setRating(next);
    focusStar(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (rating < 1 || rating > TOTAL) { setError(strings.csatRatingOutOfRange); return; }
    const trimmed = comment.trim();
    if (trimmed.length > MAX_LEN) { setError(strings.csatCommentTooLong); return; }
    setSubmitting(true);
    try {
      const csat = await api.submitCsat(caseId, {
        rating: rating as 1 | 2 | 3 | 4 | 5,
        comment: trimmed || undefined,
      });
      setSubmitted(csat);
      onSubmitted(csat);
    } catch (err) {
      setError(csatErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="l4-csat" data-l4-csat aria-label={strings.csatHeading}>
      <h4 className="l4-csat-title">{strings.csatHeading}</h4>
      {submitted ? (
        <Submitted csat={submitted} onEdit={() => { setSubmitted(null); setError(''); }} />
      ) : (
        <form className="l4-csat-form" onSubmit={onSubmit} noValidate>
          <fieldset className="l4-csat-stars" ref={starsRef} onKeyDown={onStarKeyDown}>
            <legend className="l4-csat-prompt">{strings.csatPrompt}</legend>
            {VALUES.map((v) => {
              const checked = rating === v;
              const filled = v <= rating;
              return (
                <label key={v} className="l4-csat-star" data-checked={checked} data-filled={filled}>
                  <input
                    type="radio"
                    name="l4-csat-rating"
                    value={v}
                    data-csat-value={v}
                    checked={checked}
                    onChange={() => setRating(v)}
                    aria-label={strings.csatRatingAria(v, TOTAL)}
                  />
                  <span aria-hidden="true">{filled ? '★' : '☆'}</span>
                </label>
              );
            })}
          </fieldset>
          <label className="l4-csat-comment-label">
            <span>{strings.csatCommentLabel}</span>
            <textarea
              className="l4-csat-comment"
              name="comment"
              value={comment}
              maxLength={MAX_LEN}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </label>
          {error ? <p className="l4-csat-error" role="alert" data-l4-csat-error>{error}</p> : null}
          <div className="l4-csat-actions">
            <button className="l4-send-button l4-csat-submit" type="submit" disabled={submitting || rating < 1} data-l4-csat-submit>
              {strings.csatSubmit}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Submitted({ csat, onEdit }: { csat: CaseCsat; onEdit: () => void }): JSX.Element {
  return (
    <div className="l4-csat-submitted" data-l4-csat-submitted>
      <p className="l4-csat-thanks">{strings.csatThanks}</p>
      <div className="l4-csat-display" aria-label={strings.csatRatingAria(csat.rating, TOTAL)}>
        {VALUES.map((v) => (
          <span key={v} className="l4-csat-display-star" data-filled={v <= csat.rating} aria-hidden="true">
            {v <= csat.rating ? '★' : '☆'}
          </span>
        ))}
      </div>
      {csat.comment ? <p className="l4-csat-display-comment">{csat.comment}</p> : null}
      <button type="button" className="l4-csat-edit" onClick={onEdit} data-l4-csat-edit>
        {strings.csatEdit}
      </button>
    </div>
  );
}

function csatErrorMessage(error: unknown): string {
  if (error instanceof ConflictError) return strings.csatNotResolved;
  if (error instanceof SessionExpiredError) return strings.sessionExpired;
  if (error instanceof NotEnabledError) return strings.notEnabled;
  if (error instanceof RateLimitedError) return strings.rateLimited;
  if (error instanceof ValidationError) return error.message || strings.csatRatingOutOfRange;
  if (error instanceof NotFoundError) return strings.caseUnavailable;
  return strings.genericError;
}