import { createContext, useContext } from 'react';

/** Host-supplied token getter; may be sync or async. */
export type TokenProvider = () => string | null | Promise<string | null>;

/** Mount-time configuration for the widget. */
export interface L4SupportInit {
  /** Sent as `X-Product-Key`. */
  productKey: string;
  /** API origin, e.g. "https://api.l4consulting.net". */
  apiBase: string;
  /** Host supplies the caller's JWT. */
  getToken?: TokenProvider;
  /** Which tabs to enable. Default: Help / My Support / Roadmap, with Support selected first. */
  tabs?: Array<'help' | 'support' | 'roadmap'>;
  theme?: { accent?: string; mode?: 'light' | 'dark' | 'auto' };
  launcher?: { enabled?: boolean; position?: 'br' | 'bl' };
  onEvent?: (e: { type: string; [k: string]: unknown }) => void;
}

export type SupportTabId = 'help' | 'support' | 'roadmap';
export type LauncherPosition = 'br' | 'bl';

export interface WidgetEvent {
  type: string;
  [key: string]: unknown;
}

export interface NormalizedConfig {
  productKey: string;
  apiBase: string;
  getToken: TokenProvider;
  tabs: SupportTabId[];
  theme: {
    accent: string;
    mode: 'light' | 'dark' | 'auto';
  };
  launcher: {
    enabled: boolean;
    position: LauncherPosition;
  };
  onEvent?: (event: WidgetEvent) => void;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_TABS: SupportTabId[] = ['help', 'support', 'roadmap'];
const ALL_TABS = new Set<SupportTabId>(['help', 'support', 'roadmap']);
const DEFAULT_ACCENT = '#2563eb';

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigError(`L4Support.init requires a non-empty ${name}.`);
  }
  return value.trim();
}

function normalizeApiBase(apiBase: string): string {
  try {
    const url = new URL(apiBase);
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new ConfigError(`L4Support.init received an invalid apiBase: ${apiBase}`);
  }
}

function normalizeTabs(tabs: L4SupportInit['tabs']): SupportTabId[] {
  if (!tabs) return DEFAULT_TABS;
  const unique = tabs.filter((tab, index) => tabs.indexOf(tab) === index);
  const valid = unique.filter((tab): tab is SupportTabId => ALL_TABS.has(tab));
  return valid.length > 0 ? valid : DEFAULT_TABS;
}

export function normalizeConfig(opts: L4SupportInit, fallbackTokenProvider?: TokenProvider | null): NormalizedConfig {
  const productKey = requireString(opts.productKey, 'productKey');
  const apiBase = normalizeApiBase(requireString(opts.apiBase, 'apiBase'));
  const getToken = opts.getToken ?? fallbackTokenProvider;

  if (typeof getToken !== 'function') {
    throw new ConfigError('L4Support.init requires getToken or L4Support.setTokenProvider(fn).');
  }

  const position = opts.launcher?.position === 'bl' ? 'bl' : 'br';
  const mode = opts.theme?.mode === 'dark' || opts.theme?.mode === 'auto' ? opts.theme.mode : 'light';
  const accent = typeof opts.theme?.accent === 'string' && opts.theme.accent.trim() ? opts.theme.accent : DEFAULT_ACCENT;

  return {
    productKey,
    apiBase,
    getToken,
    tabs: normalizeTabs(opts.tabs),
    theme: { accent, mode },
    launcher: {
      enabled: opts.launcher?.enabled !== false,
      position,
    },
    onEvent: opts.onEvent,
  };
}

export function emitEvent(config: Pick<NormalizedConfig, 'onEvent'> | null, event: WidgetEvent): void {
  try {
    config?.onEvent?.(event);
  } catch {
    // Host telemetry must never break the widget.
  }
}

export const ConfigContext = createContext<NormalizedConfig | null>(null);

export function useConfig(): NormalizedConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new ConfigError('L4 Support widget config is not available.');
  return config;
}
