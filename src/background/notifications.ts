export function notify(id: string, title: string, message: string) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title,
    message,
    priority: 1,
  });
}
