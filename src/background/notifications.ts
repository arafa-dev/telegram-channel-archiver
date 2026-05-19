export function notify(id: string, title: string, message: string) {
  return chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title,
    message,
    priority: 1,
  });
}
