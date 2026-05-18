import { describe, expect, it, vi } from 'vitest';
import { getHistory } from '../../src/bridge/history';
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
  it('returns messages and oldest id as the next offset for full pages', async () => {
    const getHistoryMock = vi.fn().mockResolvedValue({ messages: [{ id: 10 }, { id: 9 }] });

    await expect(getHistory(handles({ getHistory: getHistoryMock }), 7, 0, 2)).resolves.toEqual({
      messages: [{ id: 10 }, { id: 9 }],
      nextOffsetId: 9,
    });
    expect(getHistoryMock).toHaveBeenCalledWith({ peerId: 7, offsetId: 0, limit: 2 });
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

  it('throws for unknown history result shapes', async () => {
    await expect(
      getHistory(handles({ getHistory: vi.fn().mockResolvedValue({ ids: [1] }) }), 1, 0, 10)
    ).rejects.toThrow('UNEXPECTED_HISTORY_SHAPE');
  });
});
