import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useConfig } from './config';
import { loadChatRuntime, type ChatRuntime } from './chat-loader';

export function ChatConversationHost({
  caseId,
  onLivePausedChange,
  onRuntimeUnavailable,
}: {
  caseId: string | null;
  onLivePausedChange?: (paused: boolean) => void;
  onRuntimeUnavailable?: () => void;
}): JSX.Element {
  const config = useConfig();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ChatRuntime | null>(null);
  const generationRef = useRef(0);
  const caseIdRef = useRef(caseId);
  caseIdRef.current = caseId;
  const onLivePausedChangeRef = useRef(onLivePausedChange);
  onLivePausedChangeRef.current = onLivePausedChange;
  const onRuntimeUnavailableRef = useRef(onRuntimeUnavailable);
  onRuntimeUnavailableRef.current = onRuntimeUnavailable;
  const emitLivePausedChange = useCallback((paused: boolean) => {
    onLivePausedChangeRef.current?.(paused);
  }, []);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !config.chat?.enabled || loadFailed) return undefined;

    const generation = ++generationRef.current;
    let cancelled = false;

    void loadChatRuntime(config).then((runtime) => {
      if (cancelled || generation !== generationRef.current) return;
      if (!runtime) {
        setLoadFailed(true);
        onRuntimeUnavailableRef.current?.();
        return;
      }
      runtimeRef.current = runtime;
      runtime.mount({
        container: host,
        config,
        caseId: caseIdRef.current,
        onLivePausedChange: emitLivePausedChange,
      });
    });

    return () => {
      cancelled = true;
      runtimeRef.current?.unmount();
      runtimeRef.current = null;
    };
  }, [config, emitLivePausedChange, loadFailed]);

  useEffect(() => {
    runtimeRef.current?.setCaseId(caseId);
  }, [caseId]);

  if (!config.chat?.enabled || loadFailed) return <></>;

  return <div ref={hostRef} data-l4-chat-mount />;
}
