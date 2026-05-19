const SCRIPT_ID = 'tg-archive-bridge';

export async function registerBridge(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch {
    // Ignore stale or unavailable registrations; registration below is the source of truth.
  }

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: ['bridge/bridge.js'],
      matches: ['https://web.telegram.org/k/*'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: true,
    },
  ]);
}
