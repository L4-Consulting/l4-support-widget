import { useEffect, useMemo, useState, type ChangeEvent, type JSX } from 'react';
import { ApiClient } from '../api/client';
import type { DocArticle, DocResult } from '../api/types';
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
  const [article, setArticle] = useState<DocArticle | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [articleState, setArticleState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
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
    setArticle(null);
    setArticleState('idle');
  }

  function openArticle(result: DocResult) {
    if (!result.slug) {
      window.open(result.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setArticle(null);
    setArticleState('loading');
    api
      .getDocArticle(result.slug)
      .then(({ article: nextArticle }) => {
        setArticle(nextArticle);
        setArticleState('ready');
      })
      .catch(() => {
        setArticle(null);
        setArticleState('error');
      });
  }

  function closeArticle() {
    setArticle(null);
    setArticleState('idle');
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
        {articleState === 'loading' ? <StateMessage tone="loading">{strings.loadingArticle}</StateMessage> : null}
        {articleState === 'error' ? (
          <>
            <StateMessage tone="error">{strings.articleLoadError}</StateMessage>
            <button className="l4-help-back" type="button" onClick={closeArticle}>{strings.backToResults}</button>
          </>
        ) : null}
        {articleState === 'ready' && article ? <ArticleReader article={article} onBack={closeArticle} /> : null}
        {articleState === 'idle' ? (
          <>
            {state === 'idle' ? <StateMessage tone="empty">{strings.typeToSearch}</StateMessage> : null}
            {state === 'loading' ? <StateMessage tone="loading">{strings.searchHelpLoading}</StateMessage> : null}
            {state === 'error' ? <StateMessage tone="error">{strings.searchHelpError}</StateMessage> : null}
            {state === 'ready' && results.length === 0 ? <StateMessage tone="empty">{strings.noHelpArticles}</StateMessage> : null}
            {state === 'ready' && results.length > 0 ? <DocsResults results={results} onOpen={openArticle} /> : null}
          </>
        ) : null}
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

function DocsResults({ results, onOpen }: { results: DocResult[]; onOpen: (result: DocResult) => void }): JSX.Element {
  return (
    <ul className="l4-doc-results" data-l4-doc-results>
      {results.map((result) => (
        <li key={result.id}>
          <button
            className="l4-doc-link"
            type="button"
            onClick={() => onOpen(result)}
          >
            {result.title}
          </button>
          {result.summary ? <p className="l4-doc-summary">{result.summary}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function ArticleReader({ article, onBack }: { article: DocArticle; onBack: () => void }): JSX.Element {
  return (
    <article className="l4-help-article" data-l4-help-article>
      <button className="l4-help-back" type="button" onClick={onBack}>{strings.backToResults}</button>
      <h2>{article.title}</h2>
      {article.summary ? <p className="l4-help-article-summary">{article.summary}</p> : null}
      <MarkdownBlocks markdown={article.body_markdown} />
    </article>
  );
}

function MarkdownBlocks({ markdown }: { markdown: string }): JSX.Element {
  const blocks = parseMarkdown(markdown);
  return (
    <div className="l4-help-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={index}>{block.text}</h3>;
        if (block.type === 'list') {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith('#')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: line.replace(/^#+\s*/, '') });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
