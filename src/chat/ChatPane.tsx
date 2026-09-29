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
import type { CaseCsat, CaseDetail } from '../api/types';
import { emitNarration, type NormalizedConfig } from '../config';
import { strings } from '../strings';
import {
  CaseThreadHeader,
  CaseThreadStream,
  showCsatForCase,
} from '../support/case-thread';
import { CsatPanel } from '../tabs/CsatPanel';
import { injectChatStyles, releaseChatStyles } from './chat-styles';
import { ensureStreamAuthContext, resetStreamAuthContext, runCaseStream, streamAuthKey } from './stream';

const POLL_MS = 20_000;
const REFETCH_COALESCE_MS = 400;

export interface ChatPaneProps {
  container: HTMLElement;
  config: NormalizedConfig;
  caseId: string | null;
  onLivePausedChange?: (paused: boolean) => void;
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
  const narratedMessageIds = useRef(new Set<string>());
  const narrationAuthKeyRef = useRef<string | null>(null);
  const csatSubmitCaseRef = useRef<string | null>(null);
  const onNarrateRef = useRef(config.onNarrate);
  onNarrateRef.current = config.onNarrate;

  useEffect(() => {
    injectChatStyles(container);
    return () => {
      releaseChatStyles(container);
    };
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

  useEffect(() => {
    if (!config.voice.enabled || !onNarrateRef.current || !detail) return;
    for (const message of detail.messages) {
      if (message.author_type !== 'agent' || narratedMessageIds.current.has(message.id)) continue;
      narratedMessageIds.current.add(message.id);
      emitNarration({ onNarrate: onNarrateRef.current }, {
        id: message.id,
        body: message.body,
        author_type: 'agent',
        author_name: message.author_name,
        created_at: message.created_at,
      });
    }
  }, [config.voice.enabled, detail]);

  useLayoutEffect(() => {
    const authKey = streamAuthKey(config.apiBase, config.productKey, config.getToken);
    ensureStreamAuthContext(authKey);
    if (narrationAuthKeyRef.current !== authKey) {
      narrationAuthKeyRef.current = authKey;
      narratedMessageIds.current = new Set();
    }

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
    csatSubmitCaseRef.current = caseId;

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

  const handleCsatSubmitted = useCallback(
    (csat: CaseCsat) => {
      if (csatSubmitCaseRef.current !== caseId) return;
      setDetail((current) => (current ? { ...current, csat } : current));
    },
    [caseId],
  );

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
    return <p role="status">{strings.selectCase}</p>;
  }
  if (loadError) {
    return <p role="alert">{loadError}</p>;
  }
  if (!detail) {
    return <p className="l4-state-message" role="status" data-l4-state="loading">{strings.caseLoading}</p>;
  }

  return (
    <div data-l4-chat-pane aria-live="polite">
      {livePaused ? <div className="l4-chat-live-paused">Live updates paused</div> : null}
      <CaseThreadHeader detail={detail} />
      <CaseThreadStream detail={detail} config={config} />
      {showCsatForCase(detail) ? (
        <CsatPanel
          key={detail.case.id}
          api={api}
          caseId={detail.case.id}
          initialCsat={detail.csat ?? null}
          onSubmitted={handleCsatSubmitted}
        />
      ) : null}
      <form key={composerKey} className="l4-composer" onSubmit={handleSubmit}>
        <label className="l4-reply-label">
          <span>{strings.replyLabel}</span>
          <textarea
            className="l4-reply-box"
            name="body"
            placeholder={strings.replyPlaceholder}
            aria-label={strings.replyLabel}
            disabled={sendPending}
          />
        </label>
        {replyError ? <p className="l4-form-error" role="alert">{replyError}</p> : null}
        <div className="l4-composer-actions">
          <button className="l4-send-button" type="submit" disabled={sendPending}>
            {strings.replyButton}
          </button>
        </div>
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
  if (mountedContainer) releaseChatStyles(mountedContainer);
  mountRoot?.unmount();
  mountRoot = null;
  mountedContainer = null;
  resetStreamAuthContext();
}

export function updateChatCaseId(props: ChatPaneProps): void {
  mountChatPane(props);
}
