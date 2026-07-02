import type { RoadmapItem } from '../api/types';

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  deferred: 'Deferred',
  cancelled: 'Cancelled',
};

export function groupRoadmapItems(items: RoadmapItem[]): Array<{ heading: string; items: RoadmapItem[] }> {
  const groups = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    const heading = STATUS_LABELS[item.status] ?? 'Other';
    groups.set(heading, [...(groups.get(heading) ?? []), item]);
  }
  return Array.from(groups, ([heading, groupItems]) => ({ heading, items: groupItems }));
}
