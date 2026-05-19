const SCRIPT_ID = 'tg-archive-bridge';

export async function registerBridge(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch {
    // Ignore stale or unavailable dynamic registrations; the manifest content script is the source of truth.
  }
}
