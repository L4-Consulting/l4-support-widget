import { createContext, useContext } from 'react';

export interface OpenSupportOptions {
  subject?: string;
}

export interface TabStateContextValue {
  activeTab: 'help' | 'support' | 'roadmap';
  supportDraftSubject: string;
  openSupportWith: (options?: OpenSupportOptions) => void;
}

export const TabStateContext = createContext<TabStateContextValue | null>(null);

export function useTabState(): TabStateContextValue {
  const context = useContext(TabStateContext);
  if (!context) throw new Error('L4 Support tab state is not available.');
  return context;
}
