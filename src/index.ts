/**
 * ESM entry for `@l4/support-widget` (React host apps).
 *
 * SIDE-EFFECT-FREE (v2 plan, BLOCKER B2): this module MUST NOT define the custom
 * element or write to `window` at the top level. The element is registered
 * LAZILY inside `init()` (guarded by a DOM + not-already-defined check). React /
 * ReactDOM are externals in this build so host apps dedupe on their own copy.
 *
 * `package.json` has "sideEffects": false and its `exports` map only exposes this
 * build — ESM consumers never pull the side-effectful global bundle.
 */
export { destroy, init, open, setTokenProvider, version } from './public-api';
export type { L4SupportInit, TokenProvider } from './config';
export type {
  SupportCase,
  CaseDetail,
  CaseMessage,
  CreateCaseBody,
  CreateMessageBody,
  RoadmapItem,
  DocResult,
  CaseCategory,
  CaseSeverity,
} from './api/types';
