import { describe, expect, it } from 'vitest';
import {
  parseDownloadMediaArgs,
  parseExtractMediaRefArgs,
  parseGetHistoryArgs,
  parseGetMessageByIdArgs,
} from '../../src/bridge/validation';

describe('bridge argument validation', () => {
  it('accepts bounded getHistory arguments', () => {
    expect(parseGetHistoryArgs({ peerId: 1, offsetId: 0, limit: 200 })).toEqual({
      peerId: 1,
      offsetId: 0,
      limit: 200,
    });
  });

  it('throws INVALID_ARGS for invalid getHistory arguments', () => {
    expect(() => parseGetHistoryArgs({ peerId: Number.NaN, offsetId: 0, limit: 10 })).toThrow('INVALID_ARGS');
    expect(() => parseGetHistoryArgs({ peerId: 1.5, offsetId: 0, limit: 10 })).toThrow('INVALID_ARGS');
    expect(() => parseGetHistoryArgs({ peerId: 1, offsetId: 0.5, limit: 10 })).toThrow('INVALID_ARGS');
    expect(() => parseGetHistoryArgs({ peerId: 1, offsetId: -1, limit: 10 })).toThrow('INVALID_ARGS');
    expect(() => parseGetHistoryArgs({ peerId: 1, offsetId: 0, limit: 201 })).toThrow('INVALID_ARGS');
  });

  it('validates getMessageById arguments', () => {
    expect(parseGetMessageByIdArgs({ peerId: -100, messageId: 123 })).toEqual({ peerId: -100, messageId: 123 });
    expect(() => parseGetMessageByIdArgs({ peerId: -100, messageId: 0 })).toThrow('INVALID_ARGS');
    expect(() => parseGetMessageByIdArgs({ peerId: -100, messageId: 1.5 })).toThrow('INVALID_ARGS');
    expect(() => parseGetMessageByIdArgs({ peerId: Number.NaN, messageId: 1 })).toThrow('INVALID_ARGS');
  });

  it('validates extractMediaRef arguments', () => {
    const message = { id: 1 };
    expect(parseExtractMediaRefArgs({ message })).toEqual({ message });
    expect(() => parseExtractMediaRefArgs({ message: null })).toThrow('INVALID_ARGS');
  });

  it('validates downloadMedia arguments', () => {
    expect(parseDownloadMediaArgs({ rawMediaToken: 'media:1', fileName: 'a.jpg', requestId: 1 })).toEqual({
      rawMediaToken: 'media:1',
      fileName: 'a.jpg',
      requestId: 1,
    });
    expect(() => parseDownloadMediaArgs({ rawMediaToken: {}, fileName: 'a.jpg', requestId: 1 })).toThrow(
      'INVALID_ARGS'
    );
    expect(() => parseDownloadMediaArgs({ rawMediaToken: 'media:1', fileName: '', requestId: 1 })).toThrow(
      'INVALID_ARGS'
    );
    expect(() => parseDownloadMediaArgs({ rawMediaToken: 'media:1', fileName: 'a.jpg', requestId: Infinity })).toThrow(
      'INVALID_ARGS'
    );
    expect(() => parseDownloadMediaArgs({ rawMediaToken: 'media:1', fileName: 'a.jpg', requestId: 1.5 })).toThrow(
      'INVALID_ARGS'
    );
  });
});
