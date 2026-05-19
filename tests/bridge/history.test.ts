import { describe, expect, it, vi } from 'vitest';
import { getHistory, getMessageById } from '../../src/bridge/history';
import type { TelegramHandles } from '../../src/bridge/resolve';

function handles(appMessagesManager: unknown): TelegramHandles {
  return {
    appMessagesManager,
    appDownloadManager: {},
    appImManager: {},
    appPeersManager: {},
  };
}

describe('getHistory', () => {
  it('throws targeted compatibility error when appMessagesManager is missing at call time', async () => {
    await expect(getHistory(handles(undefined), 7, 0, 2)).rejects.toThrow(
      'BRIDGE_INCOMPATIBLE: missing appMessagesManager'
    );
  });

  it('returns messages and oldest id as the next offset for full pages', async () => {
    const getHistoryMock = vi.fn().mockResolvedValue({ messages: [{ id: 10 }, { id: 9 }] });

    await expect(getHistory(handles({ getHistory: getHistoryMock }), 7, 0, 2)).resolves.toEqual({
      messages: [{ id: 10 }, { id: 9 }],
      nextOffsetId: 9,
    });
    expect(getHistoryMock).toHaveBeenCalledWith({ peerId: 7, offsetId: 0, limit: 2 });
  });

  it('accepts direct message pages without getMessageByPeer capability', async () => {
    await expect(
      getHistory(handles({ getHistory: vi.fn().mockResolvedValue({ messages: [{ id: 1 }] }) }), 7, 0, 10)
    ).resolves.toEqual({
      messages: [{ id: 1 }],
      nextOffsetId: 0,
    });
  });

  it('resolves id-based history with getMessageByPeer', async () => {
    const appMessagesManager = {
      getHistory: vi.fn().mockResolvedValue({ history: [4, 3] }),
      getMessageByPeer: vi.fn((peerId: number, messageId: number) => ({ id: messageId, peerId })),
    };

    await expect(getHistory(handles(appMessagesManager), 22, 0, 5)).resolves.toEqual({
      messages: [
        { id: 4, peerId: 22 },
        { id: 3, peerId: 22 },
      ],
      nextOffsetId: 0,
    });
    expect(appMessagesManager.getMessageByPeer).toHaveBeenCalledWith(22, 4);
  });

  it('uses Telegram packed history ids as the next offset for id-based pages', async () => {
    const appMessagesManager = {
      getHistory: vi.fn().mockResolvedValue({ history: [4294971130, 4294971031] }),
      getMessageByPeer: vi.fn((_peerId: number, messageId: number) => ({
        id: messageId - 4294967296,
      })),
    };

    await expect(getHistory(handles(appMessagesManager), 22, 0, 2)).resolves.toEqual({
      messages: [{ id: 3834 }, { id: 3735 }],
      nextOffsetId: 4294971031,
    });
  });

  it('throws for unknown history result shapes', async () => {
    await expect(
      getHistory(handles({ getHistory: vi.fn().mockResolvedValue({ ids: [1] }) }), 1, 0, 10)
    ).rejects.toThrow('UNEXPECTED_HISTORY_SHAPE');
  });

  it('throws targeted compatibility error when id-based history requires missing getMessageByPeer', async () => {
    await expect(
      getHistory(handles({ getHistory: vi.fn().mockResolvedValue({ history: [1] }) }), 1, 0, 10)
    ).rejects.toThrow('BRIDGE_INCOMPATIBLE: missing appMessagesManager.getMessageByPeer');
  });

  it('resolves a visible message id through Telegram Web K packed ids first', async () => {
    const appMessagesManager = {
      getMessageByPeer: vi.fn((_peerId: number, messageId: number) =>
        messageId === 4_294_967_296 + 7847 ? { id: 7847, text: 'retry me' } : null
      ),
    };

    await expect(getMessageById(handles(appMessagesManager), 22, 7847)).resolves.toEqual({
      id: 7847,
      text: 'retry me',
    });
    expect(appMessagesManager.getMessageByPeer).toHaveBeenCalledWith(22, 4_294_967_296 + 7847);
  });

  it('falls back to visible ids when packed lookup misses', async () => {
    const appMessagesManager = {
      getMessageByPeer: vi.fn((_peerId: number, messageId: number) =>
        messageId === 5 ? { id: 5, text: 'visible' } : null
      ),
    };

    await expect(getMessageById(handles(appMessagesManager), 22, 5)).resolves.toEqual({ id: 5, text: 'visible' });
    expect(appMessagesManager.getMessageByPeer).toHaveBeenLastCalledWith(22, 5);
  });

  it('searches a nearby history page when direct message lookup misses the cache', async () => {
    let calls = 0;
    const appMessagesManager = {
      getMessageByPeer: vi.fn((_peerId: number, messageId: number) => {
        calls += 1;
        if (calls <= 2) return null;
        return messageId === 4_294_967_296 + 9 ? { id: 9 } : null;
      }),
      getHistory: vi.fn().mockResolvedValue({ history: [4_294_967_296 + 11, 4_294_967_296 + 9] }),
    };

    await expect(getMessageById(handles(appMessagesManager), 22, 9)).resolves.toEqual({ id: 9 });
    expect(appMessagesManager.getHistory).toHaveBeenCalledWith({
      peerId: 22,
      offsetId: 4_294_967_296 + 10,
      limit: 200,
    });
  });
});
