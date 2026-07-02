import { useEffect, useMemo, useState, type JSX } from 'react';
import { ApiClient } from '../api/client';
import type { RoadmapItem } from '../api/types';
import { useConfig } from '../config';
import { strings } from '../strings';
import { groupRoadmapItems } from './roadmap-groups';

export function RoadmapTab(): JSX.Element {
  const config = useConfig();
  const api = useMemo(() => new ApiClient(config), [config]);
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    setState('loading');
    api
      .getRoadmap()
      .then(({ items: nextItems }) => {
        if (!alive) return;
        setItems(nextItems);
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [api]);

  if (state === 'loading') return <StateMessage tone="loading">{strings.roadmapLoading}</StateMessage>;
  if (state === 'error') return <StateMessage tone="error">{strings.roadmapError}</StateMessage>;
  if (items.length === 0) return <StateMessage tone="empty">{strings.noRoadmap}</StateMessage>;

  return (
    <section className="space-y-4" data-l4-roadmap-tab>
      {groupRoadmapItems(items).map((group) => (
        <section key={group.heading} className="rounded-lg border border-slate-200 bg-white" data-l4-card>
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">{group.heading}</h3>
          </div>
          <ul className="divide-y divide-slate-200">
            {group.items.map((item) => (
              <li key={item.id} className="p-4">
                <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
                <p className="mt-1 text-sm text-slate-700">{item.description}</p>
                {item.target_date || item.quarter ? (
                  <p className="mt-2 text-xs text-slate-600">{[item.target_date, item.quarter].filter(Boolean).join(' · ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function StateMessage({ children, tone }: { children: string; tone: 'empty' | 'loading' | 'error' }): JSX.Element {
  return (
    <p
      className={`rounded-lg border border-slate-200 bg-white p-4 text-sm ${tone === 'error' ? 'text-red-700' : 'text-slate-600'}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-l4-card
      data-l4-state={tone}
    >
      {children}
    </p>
  );
}
