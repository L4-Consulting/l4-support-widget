/**
 * Chat IIFE entry — `dist/l4-support-widget-chat.js`
 */
import { mountChatPane, unmountChatPane, updateChatCaseId, type ChatPaneProps } from './ChatPane';
import type { NormalizedConfig } from '../config';

export interface ChatRuntime {
  mount(props: ChatPaneProps): void;
  unmount(): void;
  setCaseId(caseId: string | null): void;
}

let hostContainer: HTMLElement | null = null;
let hostConfig: NormalizedConfig | null = null;
let onLivePausedChange: ((paused: boolean) => void) | undefined;

const runtime: ChatRuntime = {
  mount(props) {
    hostContainer = props.container;
    hostConfig = props.config;
    onLivePausedChange = props.onLivePausedChange;
    hostContainer.setAttribute('data-l4-chat-host', '');
    mountChatPane(props);
  },
  unmount() {
    unmountChatPane();
    hostContainer = null;
    hostConfig = null;
    onLivePausedChange = undefined;
  },
  setCaseId(caseId) {
    if (!hostContainer || !hostConfig) return;
    updateChatCaseId({
      container: hostContainer,
      config: hostConfig,
      caseId,
      onLivePausedChange,
    });
  },
};

if (typeof window !== 'undefined') {
  window.L4SupportChat = runtime;
}

export default runtime;
