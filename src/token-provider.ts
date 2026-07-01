import type { TokenProvider } from './config';

let tokenProvider: TokenProvider | null = null;

export function setStoredTokenProvider(fn: TokenProvider): void {
  tokenProvider = fn;
}

export function getStoredTokenProvider(): TokenProvider | null {
  return tokenProvider;
}
