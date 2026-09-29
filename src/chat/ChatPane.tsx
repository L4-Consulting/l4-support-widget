import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiClient } from '../api/client';
import type { CaseDetail } from '../api/types';
import type { NormalizedConfig } from '../config';
import { ensureStreamAuthContext, resetStreamAuthContext, runCaseStream, streamAuthKey } from './stream';
import chatScopedCss from './chat-scoped.css?inline';

const POLL_MS = 20_000;
const REFETCH_COALESCE_MS = 400;

export interface ChatPaneProps {
  container: HTMLElement;
  config: NormalizedConfig;
  caseId: string | null;
  onLivePausedChange?: (paused: boolean) => void;
}

function injectScopedStyles(container: HTMLElement): void {
  const marker = 'data-l4-chat-style';
  if (container.querySelector(`[${marker}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(marker, '');
  style.textContent = chatScopedCss;
  container.prepend(style);
}

export function ChatPane({ config, caseId, onLivePausedChange, container }: ChatPaneProps): JSX.Element {
  const api = useMemo(() => new ApiClient(config), [config]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [replyError, setReplyError] = useState('');
  const [livePaused, setLivePaused] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const streamAbort = useRef<AbortController | null>(null);
  const pollId = useRef<number | undefined>(undefined);
  const lifecycleRef = useRef(0);
  const refetchTimer = useRef<number | undefined>(undefined);
  const detailRequestRef = useRef(0);
  const sendInflightRef = useRef(false);
  const streamLiveRef = useRef(false);

  useEffect(() => {
    injectScopedStyles(container);
  }, [container]);

  const refreshDetail = useCallback(
    async (silent = false, expectedLifecycle?: number) => {
      if (!caseId) {
        setDetail(null);
        return;
      }
      const requestId = ++detailRequestRef.current;
      try {
        const next = await api.getCase(caseId);
        if (expectedLifecycle !== undefined && expectedLifecycle !== lifecycleRef.current) return;
        if (requestId !== detailRequestRef.current) return;
        setDetail(next);
        setLoadError('');
      } catch {
        if (expectedLifecycle !== undefined && expectedLifecycle !== lifecycleRef.current) return;
        if (requestId !== detailRequestRef.current) return;
        if (!silent) setLoadError('Unable to load this conversation.');
      }
    },
    [api, caseId],
  );

  const scheduleAuthoritativeRefetch = useCallback(() => {
    if (refetchTimer.current !== undefined) return;
    const life = lifecycleRef.current;
    refetchTimer.current = window.setTimeout(() => {
      refetchTimer.current = undefined;
      void refreshDetail(true, life);
    }, REFETCH_COALESCE_MS);
  }, [refreshDetail]);

  const stopPoll = useCallback(() => {
    if (pollId.current !== undefined) window.clearInterval(pollId.current);
    pollId.current = undefined;
  }, []);

  const startPoll = useCallback(
    (life: number) => {
      if (pollId.current !== undefined) return;
      pollId.current = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refreshDetail(true, life);
      }, POLL_MS);
    },
    [refreshDetail],
  );

  useEffect(() => {
    onLivePausedChange?.(livePaused);
  }, [livePaused, onLivePausedChange]);

  useLayoutEffect(() => {
    const authKey = streamAuthKey(config.apiBase, config.productKey, config.getToken);
    ensureStreamAuthContext(authKey);

    const life = ++lifecycleRef.current;
    streamAbort.current?.abort();
    streamAbort.current = null;
    stopPoll();
    streamLiveRef.current = false;
    if (refetchTimer.current !== undefined) window.clearTimeout(refetchTimer.current);
    refetchTimer.current = undefined;
    setLivePaused(false);
    setSendPending(false);
    sendInflightRef.current = false;
    setReplyError('');
    setLoadError('');
    setDetail(null);
    setComposerKey((k) => k + 1);

    if (!caseId) {
      return;
    }

    void refreshDetail(false, life);

    const startStream = () => {
      if (document.visibilityState !== 'visible') return;
      streamAbort.current?.abort();
      const controller = new AbortController();
      streamAbort.current = controller;
      void runCaseStream({
        apiBase: config.apiBase,
        caseId,
        productKey: config.productKey,
        getToken: config.getToken,
        cursor: null,
        onCursor: () => {
          if (life !== lifecycleRef.current) return;
        },
        signal: controller.signal,
        handlers: {
          onOpen: () => {
            if (life !== lifecycleRef.current) return;
            streamLiveRef.current = true;
            setLivePaused(false);
            stopPoll();
            scheduleAuthoritativeRefetch();
          },
          onError: (reason) => {
            if (life !== lifecycleRef.current) return;
            if (reason === 'auth_retry') return;
            streamLiveRef.current = false;
            setLivePaused(true);
            startPoll(life);
          },
          onEvent: (event) => {
            if (life !== lifecycleRef.current) return;
            if (event.type === 'message' || event.type === 'status') {
              scheduleAuthoritativeRefetch();
            }
          },
        },
      });
    };

    const onVisibility = () => {
      if (life !== lifecycleRef.current) return;
      if (document.visibilityState === 'visible') {
        void refreshDetail(true, life);
        startStream();
      } else {
        streamAbort.current?.abort();
        streamLiveRef.current = false;
        stopPoll();
      }
    };

    startStream();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (life === lifecycleRef.current) lifecycleRef.current += 1;
      streamAbort.current?.abort();
      stopPoll();
      if (refetchTimer.current !== undefined) window.clearTimeout(refetchTimer.current);
      refetchTimer.current = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [
    caseId,
    config.apiBase,
    config.getToken,
    config.productKey,
    refreshDetail,
    scheduleAuthoritativeRefetch,
    startPoll,
    stopPoll,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!caseId || sendPending || sendInflightRef.current) return;
    const form = event.currentTarget;
    const body = (new FormData(form).get('body') as string | null)?.trim() ?? '';
    if (!body) return;
    const life = lifecycleRef.current;
    sendInflightRef.current = true;
    setReplyError('');
    setSendPending(true);
    try {
      await api.replyToCase(caseId, { body });
      if (life !== lifecycleRef.current) return;
      form.reset();
      setComposerKey((k) => k + 1);
      await refreshDetail(true, life);
    } catch {
      if (life === lifecycleRef.current) setReplyError('Send failed. Try again.');
    } finally {
      if (life === lifecycleRef.current) {
        sendInflightRef.current = false;
        setSendPending(false);
      }
    }
  }

  if (!caseId) {
    return <p role="status">Select a case to open the conversation.</p>;
  }
  if (loadError) {
    return <p role="alert">{loadError}</p>;
  }

  const messages = detail?.messages ?? [];

  return (
    <div data-l4-chat-pane aria-live="polite">
      {livePaused ? <div className="l4-chat-live-paused">Live updates paused</div> : null}
      <div className="l4-chat-stream" data-l4-chat-messages>
        {messages.map((message) => {
          const customer = message.author_type === 'client' || message.author_type === 'customer';
          return (
            <div
              key={message.id}
              className="l4-chat-bubble"
              data-side={customer ? 'customer' : 'l4'}
            >
              {message.body}
            </div>
          );
        })}
      </div>
      <form key={composerKey} className="l4-chat-composer" onSubmit={handleSubmit}>
        <label className="l4-chat-reply-label">
          <span className="l4-chat-sr-only">Reply</span>
          <textarea name="body" placeholder="Write a reply…" aria-label="Reply" disabled={sendPending} />
        </label>
        {replyError ? <p role="alert">{replyError}</p> : null}
        <button type="submit" disabled={sendPending}>Send</button>
      </form>
    </div>
  );
}

let mountRoot: Root | null = null;
let mountedContainer: HTMLElement | null = null;

export function mountChatPane(props: ChatPaneProps): void {
  if (!props.container) return;
  if (mountRoot && mountedContainer === props.container) {
    mountRoot.render(
      <ChatPane
        config={props.config}
        caseId={props.caseId}
        onLivePausedChange={props.onLivePausedChange}
        container={props.container}
      />,
    );
    return;
  }
  mountRoot?.unmount();
  mountRoot = createRoot(props.container);
  mountedContainer = props.container;
  mountRoot.render(
    <ChatPane
      config={props.config}
      caseId={props.caseId}
      onLivePausedChange={props.onLivePausedChange}
      container={props.container}
    />,
  );
}

export function unmountChatPane(): void {
  mountRoot?.unmount();
  mountRoot = null;
  mountedContainer = null;
  resetStreamAuthContext();
}

export function updateChatCaseId(props: ChatPaneProps): void {
  mountChatPane(props);
}
