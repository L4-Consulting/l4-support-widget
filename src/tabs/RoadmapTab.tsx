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
    <section className="l4-roadmap" data-l4-roadmap-tab>
      {groupRoadmapItems(items).map((group) => (
        <section key={group.heading} className="l4-roadmap-card" data-l4-card>
          <div className="l4-roadmap-head">
            <h3>{group.heading}</h3>
          </div>
          <ul className="l4-roadmap-list">
            {group.items.map((item) => (
              <li key={item.id}>
                <h4>{item.title}</h4>
                <p>{item.description}</p>
                {item.target_date || item.quarter ? (
                  <p className="l4-roadmap-meta">{[item.target_date, item.quarter].filter(Boolean).join(' · ')}</p>
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
      className="l4-roadmap-state"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-l4-card
      data-l4-state={tone}
    >
      {children}
    </p>
  );
}
