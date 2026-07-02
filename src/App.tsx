import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type JSX,
  type ReactNode,
} from 'react';
import { ConfigContext, emitEvent, normalizeConfig, type L4SupportInit, type NormalizedConfig } from './config';
import { createShadowFocusTrap, type ShadowFocusTrap } from './focus-trap';
import { ShadowPortal } from './portal';
import { TabStateContext, type OpenSupportOptions } from './tab-state';
import { HelpTab } from './tabs/HelpTab';
import { RoadmapTab } from './tabs/RoadmapTab';
import { SupportTab } from './tabs/SupportTab';
import { version } from './version';

export interface AppProps {
  config: L4SupportInit;
  openSignal: number;
  shadowRoot: ShadowRoot;
  portalContainer: HTMLElement;
}

export function App(props: AppProps): JSX.Element {
  return (
    <RootErrorBoundary>
      <WidgetApp {...props} />
    </RootErrorBoundary>
  );
}

function WidgetApp({ config: rawConfig, openSignal, shadowRoot, portalContainer }: AppProps): JSX.Element {
  const config = useMemo(() => normalizeConfig(rawConfig), [rawConfig]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  function openPanel() {
    setOpen(true);
    emitEvent(config, { type: 'open' });
  }

  function closePanel() {
    setOpen(false);
    emitEvent(config, { type: 'close' });
  }

  return (
    <ConfigContext.Provider value={config}>
      <div
        className="font-l4-spike text-slate-900"
        style={{ '--color-l4-accent': config.theme.accent } as CSSProperties}
        data-l4-app
      >
        {config.launcher.enabled ? <Launcher config={config} onOpen={openPanel} /> : null}
        {open ? (
          <PanelPortal config={config} shadowRoot={shadowRoot} portalContainer={portalContainer} onClose={closePanel} />
        ) : null}
      </div>
    </ConfigContext.Provider>
  );
}

function Launcher({ config, onOpen }: { config: NormalizedConfig; onOpen: () => void }): JSX.Element {
  const sideClass = config.launcher.position === 'bl' ? 'left-5' : 'right-5';
  return (
    <button
      className={`fixed bottom-5 ${sideClass} z-40 rounded-full bg-l4-accent px-4 py-3 text-sm font-semibold text-white shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
      type="button"
      data-l4-launcher
      onClick={onOpen}
      aria-label="Open support"
    >
      Support
    </button>
  );
}

function PanelPortal({
  config,
  shadowRoot,
  portalContainer,
  onClose,
}: {
  config: NormalizedConfig;
  shadowRoot: ShadowRoot;
  portalContainer: HTMLElement;
  onClose: () => void;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const trapRef = useRef<ShadowFocusTrap | null>(null);
  const activeTabs = config.tabs;
  const initialTab = activeTabs.includes('support') ? 'support' : (activeTabs[0] ?? 'support');
  const [activeTab, setActiveTab] = useState<'help' | 'support' | 'roadmap'>(initialTab);
  const [supportDraftSubject, setSupportDraftSubject] = useState('');

  useEffect(() => {
    if (activeTabs.includes(activeTab)) return;
    setActiveTab(activeTabs.includes('support') ? 'support' : (activeTabs[0] ?? 'support'));
  }, [activeTab, activeTabs]);

  useEffect(() => {
    if (!panelRef.current) return;
    trapRef.current = createShadowFocusTrap(shadowRoot, panelRef.current, { onEscape: onClose });
    trapRef.current.activate();
    return () => {
      trapRef.current?.deactivate();
      trapRef.current = null;
    };
  }, [onClose, shadowRoot]);

  const openSupportWith = useCallback((options: OpenSupportOptions = {}) => {
    if (typeof options.subject === 'string') setSupportDraftSubject(options.subject);
    if (activeTabs.includes('support')) setActiveTab('support');
    emitEvent(config, { type: 'deflect_to_support', subject: options.subject ?? '' });
  }, [activeTabs, config]);

  const tabState = useMemo(
    () => ({ activeTab, supportDraftSubject, openSupportWith }),
    [activeTab, openSupportWith, supportDraftSubject],
  );

  return (
    <ShadowPortal container={portalContainer}>
      <div className="fixed inset-0 z-50 bg-slate-950/25 p-0 font-l4-spike sm:p-4" data-l4-panel-backdrop>
        <section
          ref={panelRef}
          className="ml-auto flex h-full w-full flex-col bg-slate-50 text-slate-900 shadow-2xl focus:outline-none sm:max-w-4xl sm:rounded-lg"
          role="dialog"
          aria-modal="true"
          aria-label="L4 Support"
          tabIndex={-1}
          data-l4-panel
        >
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">L4 Support</h2>
              <p className="text-xs text-slate-500">v{version}</p>
            </div>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              type="button"
              data-l4-close-panel
              onClick={onClose}
            >
              Close
            </button>
          </header>
          <nav className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-2" aria-label="Support widget tabs">
            {activeTabs.map((tab) => (
              <button
                key={tab}
                className={`border-b-2 px-3 py-2 text-sm font-semibold ${
                  activeTab === tab ? 'border-l4-accent text-slate-900' : 'border-transparent text-slate-600'
                }`}
                type="button"
                data-l4-tab={tab}
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabel(tab)}
              </button>
            ))}
          </nav>
          <TabStateContext.Provider value={tabState}>
            <main className="min-h-0 flex-1 overflow-auto p-4">
              {activeTab === 'help' ? <HelpTab supportEnabled={activeTabs.includes('support')} /> : null}
              {activeTab === 'support' ? <SupportTab /> : null}
              {activeTab === 'roadmap' ? <RoadmapTab /> : null}
            </main>
          </TabStateContext.Provider>
        </section>
      </div>
    </ShadowPortal>
  );
}

function tabLabel(tab: 'help' | 'support' | 'roadmap'): string {
  if (tab === 'help') return 'Help';
  if (tab === 'roadmap') return 'Roadmap';
  return 'My Support';
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('L4 support widget render failed', error, info);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <div data-l4-error-boundary />;
    }
    return this.props.children;
  }
}
