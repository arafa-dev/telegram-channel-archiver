export const SOURCE = 'tg-archive' as const;

export type BridgeOp = 'getCurrentPeer' | 'getHistory' | 'extractMediaRef' | 'downloadMedia';

export type BridgeEvent = 'downloadProgress' | 'bridgeReady';

export interface ReqEnvelope {
  source: typeof SOURCE;
  kind: 'req';
  id: number;
  op: BridgeOp;
  args?: unknown;
}

export interface ResEnvelope {
  source: typeof SOURCE;
  kind: 'res';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface EvtEnvelope {
  source: typeof SOURCE;
  kind: 'evt';
  evt: BridgeEvent;
  payload?: unknown;
}

export type AnyEnvelope = ReqEnvelope | ResEnvelope | EvtEnvelope;

export function encodeReq(id: number, op: BridgeOp, args?: unknown): ReqEnvelope {
  return { source: SOURCE, kind: 'req', id, op, args };
}

export function encodeRes(id: number, ok: boolean, value?: unknown, error?: string): ResEnvelope {
  return { source: SOURCE, kind: 'res', id, ok, value, error };
}

export function encodeEvt(evt: BridgeEvent, payload?: unknown): EvtEnvelope {
  return { source: SOURCE, kind: 'evt', evt, payload };
}

export function isOurMessage(m: unknown): m is { source: typeof SOURCE } {
  return typeof m === 'object' && m !== null && (m as { source?: unknown }).source === SOURCE;
}

export function parseEnvelope(m: unknown): AnyEnvelope | null {
  if (!isOurMessage(m)) return null;
  const env = m as AnyEnvelope;
  if (env.kind === 'req' || env.kind === 'res' || env.kind === 'evt') return env;
  return null;
}
