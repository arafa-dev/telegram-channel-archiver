// The content script opens a long-lived port for the duration of an active job.
// As long as the port is open, the service worker is kept alive.

let active = 0;

export function installKeepalive() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'tg-archive-keepalive') return;
    active++;
    console.log('[tg-archive/sw] keepalive ↑', active);
    port.onDisconnect.addListener(() => {
      active--;
      console.log('[tg-archive/sw] keepalive ↓', active);
    });
  });
}

export function activeCount(): number {
  return active;
}
