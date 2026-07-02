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
    <section className="rounded-lg border border-slate-200 bg-white p-4" data-l4-help-tab data-l4-card>
      <label className="block text-sm font-medium text-slate-700">
        {strings.searchHelpLabel}
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          name="help-search"
          type="search"
          value={query}
          onChange={onQueryChange}
        />
      </label>

      <div className="mt-4 min-h-40">
        {state === 'idle' ? <StateMessage tone="empty">{strings.typeToSearch}</StateMessage> : null}
        {state === 'loading' ? <StateMessage tone="loading">{strings.searchHelpLoading}</StateMessage> : null}
        {state === 'error' ? <StateMessage tone="error">{strings.searchHelpError}</StateMessage> : null}
        {state === 'ready' && results.length === 0 ? <StateMessage tone="empty">{strings.noHelpArticles}</StateMessage> : null}
        {state === 'ready' && results.length > 0 ? <DocsResults results={results} /> : null}
      </div>

      {supportEnabled ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <button
            className="rounded-md bg-l4-accent px-3 py-2 text-sm font-semibold text-white"
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
      className={`text-sm ${tone === 'error' ? 'text-red-700' : 'text-slate-600'}`}
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
    <ul className="divide-y divide-slate-200" data-l4-doc-results>
      {results.map((result) => (
        <li key={result.id} className="py-3">
          <a
            className="text-sm font-semibold text-l4-accent underline-offset-2 hover:underline"
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
