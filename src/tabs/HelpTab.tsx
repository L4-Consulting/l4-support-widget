import { useEffect, useMemo, useState, type ChangeEvent, type JSX } from 'react';
import { ApiClient } from '../api/client';
import type { DocResult } from '../api/types';
import { useConfig } from '../config';
import { strings } from '../strings';
import { useTabState } from '../tab-state';

const MIN_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;

export function HelpTab({ supportEnabled }: { supportEnabled: boolean }): JSX.Element {
  const config = useConfig();
  const api = useMemo(() => new ApiClient(config), [config]);
  const { openSupportWith } = useTabState();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocResult[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setState('idle');
      return;
    }

    let alive = true;
    const timeoutId = window.setTimeout(() => {
      setState('loading');
      api
        .searchDocs(trimmedQuery)
        .then(({ results: nextResults }) => {
          if (!alive) return;
          setResults(nextResults);
          setState('ready');
        })
        .catch(() => {
          if (!alive) return;
          setResults([]);
          setState('error');
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
    };
  }, [api, trimmedQuery]);

  function onQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  return (
    <section className="l4-help-panel" data-l4-help-tab data-l4-card>
      <label className="l4-help-search-label">
        {strings.searchHelpLabel}
        <input
          className="l4-help-search"
          name="help-search"
          type="search"
          value={query}
          onChange={onQueryChange}
        />
      </label>

      <div className="l4-help-results">
        {state === 'idle' ? <StateMessage tone="empty">{strings.typeToSearch}</StateMessage> : null}
        {state === 'loading' ? <StateMessage tone="loading">{strings.searchHelpLoading}</StateMessage> : null}
        {state === 'error' ? <StateMessage tone="error">{strings.searchHelpError}</StateMessage> : null}
        {state === 'ready' && results.length === 0 ? <StateMessage tone="empty">{strings.noHelpArticles}</StateMessage> : null}
        {state === 'ready' && results.length > 0 ? <DocsResults results={results} /> : null}
      </div>

      {supportEnabled ? (
        <div className="l4-help-deflect">
          <button
            className="l4-send-button"
            type="button"
            onClick={() => openSupportWith({ subject: trimmedQuery })}
          >
            {strings.helpDeflectButton}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function StateMessage({ children, tone }: { children: string; tone: 'empty' | 'loading' | 'error' }): JSX.Element {
  return (
    <p
      className="l4-help-state"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-l4-state={tone}
    >
      {children}
    </p>
  );
}

function DocsResults({ results }: { results: DocResult[] }): JSX.Element {
  return (
    <ul className="l4-doc-results" data-l4-doc-results>
      {results.map((result) => (
        <li key={result.id}>
          <a
            className="l4-doc-link"
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {result.title}
          </a>
        </li>
      ))}
    </ul>
  );
}
