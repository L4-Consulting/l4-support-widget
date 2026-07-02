import type { RoadmapItem } from '../api/types';
import { strings } from '../strings';

const STATUS_LABELS: Record<string, string> = {
  planned: strings.roadmapStatusPlanned,
  in_progress: strings.roadmapStatusInProgress,
  completed: strings.roadmapStatusCompleted,
  deferred: strings.roadmapStatusDeferred,
  cancelled: strings.roadmapStatusCancelled,
};

export function groupRoadmapItems(items: RoadmapItem[]): Array<{ heading: string; items: RoadmapItem[] }> {
  const groups = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    const heading = STATUS_LABELS[item.status] ?? strings.roadmapStatusOther;
    groups.set(heading, [...(groups.get(heading) ?? []), item]);
  }
  return Array.from(groups, ([heading, groupItems]) => ({ heading, items: groupItems }));
}
