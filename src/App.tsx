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
import { strings } from './strings';
import { TabStateContext, type OpenSupportOptions } from './tab-state';
import { HelpTab } from './tabs/HelpTab';
import { RoadmapTab } from './tabs/RoadmapTab';
import { SupportTab } from './tabs/SupportTab';
import vegaAvatarUrl from './assets/vega-profile-128.jpg';

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
        className="l4-widget-root"
        style={{ '--color-l4-accent': config.theme.accent } as CSSProperties}
        data-l4-theme={config.theme.mode}
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
      className={`l4-launcher ${sideClass}`}
      type="button"
      data-l4-launcher
      data-avatar={config.launcher.avatar}
      onClick={onOpen}
      aria-label={strings.launcherLabel}
    >
      {config.launcher.avatar ? (
        <img className="l4-launcher-avatar" src={vegaAvatarUrl} alt="" data-l4-launcher-avatar />
      ) : strings.launcherText}
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
    emitEvent(config, { type: 'deflect', subject: options.subject ?? '' });
  }, [activeTabs, config]);

  const tabState = useMemo(
    () => ({ activeTab, supportDraftSubject, openSupportWith }),
    [activeTab, openSupportWith, supportDraftSubject],
  );

  return (
    <ShadowPortal container={portalContainer}>
      <div
        className="l4-panel-backdrop"
        style={{ '--color-l4-accent': config.theme.accent } as CSSProperties}
        data-l4-app
        data-l4-theme={config.theme.mode}
        data-l4-panel-backdrop
      >
        <section
          ref={panelRef}
          className="l4-panel"
          role="dialog"
          aria-modal="true"
          aria-label={strings.widgetTitle}
          tabIndex={-1}
          data-l4-panel
        >
          <header className="l4-panel-header" data-l4-surface>
            {config.avatar.enabled ? (
              <img className="l4-header-avatar" src={vegaAvatarUrl} alt="" data-l4-header-avatar />
            ) : (
              <div className="l4-mark">{strings.headerMark}</div>
            )}
            <div>
              <h2>{strings.headerTitle}</h2>
              <p>{config.productLabel}</p>
            </div>
            <div className="l4-header-grow" />
            <button
              className="l4-close-button"
              type="button"
              data-l4-close-panel
              onClick={onClose}
              aria-label={strings.closePanelLabel}
            >
              {strings.closePanelGlyph}
            </button>
          </header>
          <nav className="l4-tabs" aria-label={strings.tabsLabel} role="tablist" data-l4-surface>
            {activeTabs.map((tab) => (
              <button
                key={tab}
                className="l4-tab"
                type="button"
                data-l4-tab={tab}
                data-active={activeTab === tab}
                id={`l4-tab-${tab}`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`l4-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabel(tab)}
              </button>
            ))}
          </nav>
          <TabStateContext.Provider value={tabState}>
            <main className="l4-panel-main" role="tabpanel" id={`l4-panel-${activeTab}`} aria-labelledby={`l4-tab-${activeTab}`}>
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
  if (tab === 'help') return strings.helpTab;
  if (tab === 'roadmap') return strings.roadmapTab;
  return strings.supportTitle;
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
      return (
        <div data-l4-error-boundary data-l4-app data-l4-theme="light" role="alert">
          {strings.boundaryFallback}
        </div>
      );
    }
    return this.props.children;
  }
}
