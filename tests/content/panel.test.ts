import { describe, expect, test } from 'vitest';

describe('panel button state', () => {
  test('keeps start enabled when archive is completed so catch-up can run', async () => {
    const { getPanelButtonState } = await import('../../src/content/ui/panel');

    expect(getPanelButtonState('completed')).toEqual({
      startDisabled: false,
      startText: 'Archive this channel',
      pauseDisabled: true,
      cancelDisabled: true,
    });
  });
});
