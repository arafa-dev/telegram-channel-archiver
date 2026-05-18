import type { SwRequest, SwResponse } from '../background/router';

export async function callSw<T = unknown>(req: SwRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as SwResponse<T> | undefined;
  if (!res || !res.ok) throw new Error(res?.error ?? 'SW_FAILED');
  return res.value;
}

export function openKeepalivePort(): chrome.runtime.Port {
  return chrome.runtime.connect({ name: 'tg-archive-keepalive' });
}
