import { afterEach, expect, it, vi } from 'vitest';
import { resetStreamAuthContext, runCaseStream } from '../src/chat/stream';

afterEach(() => { vi.unstubAllGlobals(); resetStreamAuthContext(); });

it.each([null, 'text/html', 'application/json'])('rejects a 200 response with content type %s before declaring the stream live', async (contentType) => {
  const controller = new AbortController();
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  const body = new TextEncoder().encode('id: invalid\nevent: message\ndata: {"body":"not an SSE response"}\n\n');
  const response = new Response(body, { status: 200, headers });
  const cancel = vi.spyOn(response.body!, 'cancel');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const onOpen = vi.fn();
  const onEvent = vi.fn(() => controller.abort());
  const onError = vi.fn(() => controller.abort());
  await runCaseStream({
    apiBase: 'https://api.example.test', caseId: 'c1', productKey: 'pk', getToken: () => 'token', cursor: null,
    onCursor: () => undefined, signal: controller.signal, handlers: { onOpen, onEvent, onError },
  });
  expect(onOpen).not.toHaveBeenCalled();
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('invalid_content_type');
  expect(cancel).toHaveBeenCalledOnce();
});

it('accepts text/event-stream with charset and delivers events', async () => {
  const controller = new AbortController();
  const frame = 'event: message\ndata: {"body":"live"}\n\n';
  const response = new Response(new TextEncoder().encode(frame), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const onOpen = vi.fn();
  const onEvent = vi.fn(() => controller.abort());
  const onError = vi.fn();
  await runCaseStream({
    apiBase: 'https://api.example.test', caseId: 'c1', productKey: 'pk', getToken: () => 'token', cursor: null,
    onCursor: () => undefined, signal: controller.signal, handlers: { onOpen, onEvent, onError },
  });
  expect(onOpen).toHaveBeenCalledOnce();
  expect(onEvent).toHaveBeenCalledWith({ type: 'message', data: { body: 'live' } });
  expect(onError).not.toHaveBeenCalled();
});

it('cancels the body when rejecting an invalid content type before reading', async () => {
  const controller = new AbortController();
  const response = new Response('not sse', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const cancel = vi.spyOn(response.body!, 'cancel');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const getReader = vi.spyOn(response.body!, 'getReader');
  const onError = vi.fn(() => controller.abort());
  await runCaseStream({
    apiBase: 'https://api.example.test', caseId: 'c1', productKey: 'pk', getToken: () => 'token', cursor: null,
    onCursor: () => undefined, signal: controller.signal, handlers: { onEvent: () => undefined, onError },
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(getReader).not.toHaveBeenCalled();
  expect(response.body!.locked).toBe(false);
  expect(onError).toHaveBeenCalledWith('invalid_content_type');
});
