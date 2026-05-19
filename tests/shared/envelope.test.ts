import { describe, it, expect } from 'vitest';
import {
  encodeReq,
  encodeRes,
  encodeEvt,
  isOurMessage,
  parseEnvelope,
  type BridgeEvent,
  type BridgeOp,
} from '../../src/shared/envelope';

describe('envelope encoding', () => {
  it('encodes a request', () => {
    const e = encodeReq(42, 'getCurrentPeer');
    expect(e).toEqual({ source: 'tg-archive', kind: 'req', id: 42, op: 'getCurrentPeer', args: undefined });
  });

  it('encodes a request with args', () => {
    const e = encodeReq(7, 'getHistory', { peerId: 1, offsetId: 0, limit: 100 });
    expect(e.args).toEqual({ peerId: 1, offsetId: 0, limit: 100 });
  });

  it('encodes a success response', () => {
    const e = encodeRes(42, true, { peerId: 1 });
    expect(e).toEqual({ source: 'tg-archive', kind: 'res', id: 42, ok: true, value: { peerId: 1 } });
  });

  it('encodes an error response', () => {
    const e = encodeRes(42, false, undefined, 'FLOOD_WAIT_30');
    expect(e).toEqual({ source: 'tg-archive', kind: 'res', id: 42, ok: false, error: 'FLOOD_WAIT_30', value: undefined });
  });

  it('encodes an event', () => {
    const e = encodeEvt('downloadProgress', { messageId: 1, loaded: 100, total: 200 });
    expect(e).toMatchObject({ source: 'tg-archive', kind: 'evt', evt: 'downloadProgress' });
  });
});

describe('isOurMessage', () => {
  it('rejects foreign messages', () => {
    expect(isOurMessage({})).toBe(false);
    expect(isOurMessage(null)).toBe(false);
    expect(isOurMessage({ source: 'other' })).toBe(false);
  });

  it('accepts our envelopes', () => {
    expect(isOurMessage({ source: 'tg-archive', kind: 'req' })).toBe(true);
  });
});

describe('parseEnvelope', () => {
  it('returns null for non-envelopes', () => {
    expect(parseEnvelope({ source: 'foo' })).toBeNull();
  });

  it('parses a req envelope', () => {
    const v = parseEnvelope({ source: 'tg-archive', kind: 'req', id: 1, op: 'getCurrentPeer' });
    expect(v?.kind).toBe('req');
  });

  it('returns null for malformed request envelopes', () => {
    expect(parseEnvelope({ source: 'tg-archive', kind: 'req', id: '1', op: 'getCurrentPeer' })).toBeNull();
    expect(parseEnvelope({ source: 'tg-archive', kind: 'req', id: 1, op: 'x' })).toBeNull();
    expect(parseEnvelope({ source: 'tg-archive', kind: 'req', id: Number.NaN, op: 'getCurrentPeer' })).toBeNull();
  });

  it('returns null for malformed response envelopes', () => {
    expect(parseEnvelope({ source: 'tg-archive', kind: 'res', id: '1', ok: true })).toBeNull();
    expect(parseEnvelope({ source: 'tg-archive', kind: 'res', id: 1, ok: 'true' })).toBeNull();
    expect(parseEnvelope({ source: 'tg-archive', kind: 'res', id: Number.POSITIVE_INFINITY, ok: true })).toBeNull();
    expect(parseEnvelope({ source: 'tg-archive', kind: 'res', id: 1, ok: false, error: 30 })).toBeNull();
  });

  it('returns null for malformed event envelopes', () => {
    expect(parseEnvelope({ source: 'tg-archive', kind: 'evt', evt: 'x' })).toBeNull();
    expect(parseEnvelope({ source: 'tg-archive', kind: 'evt' })).toBeNull();
  });

  it('parses all valid envelope kinds', () => {
    const ops: BridgeOp[] = [
      'ping',
      'getCurrentPeer',
      'getHistory',
      'getMessageById',
      'extractMediaRef',
      'downloadMedia',
      'releaseMediaToken',
    ];
    const events: BridgeEvent[] = ['downloadProgress', 'bridgeReady'];

    for (const op of ops) {
      expect(parseEnvelope({ source: 'tg-archive', kind: 'req', id: 1, op })?.kind).toBe('req');
    }

    expect(parseEnvelope({ source: 'tg-archive', kind: 'res', id: 1, ok: false, error: 'err' })?.kind).toBe('res');

    for (const evt of events) {
      expect(parseEnvelope({ source: 'tg-archive', kind: 'evt', evt })?.kind).toBe('evt');
    }
  });
});
