import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export function ShadowPortal({
  children,
  container,
}: {
  children: ReactNode;
  container: HTMLElement;
}): ReactNode {
  return createPortal(children, container);
}
