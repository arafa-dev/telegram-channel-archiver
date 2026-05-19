import { clampConcurrency } from '../shared/concurrency';

const concurrencyInput = document.getElementById('concurrency') as HTMLInputElement;
async function loadConcurrency(): Promise<void> {
  const { concurrency } = await chrome.storage.local.get('concurrency');
  concurrencyInput.value = String(clampConcurrency(concurrency));
}

concurrencyInput.addEventListener('change', () => {
  const concurrency = clampConcurrency(concurrencyInput.value);
  concurrencyInput.value = String(concurrency);
  void chrome.storage.local.set({ concurrency });
});

void loadConcurrency();
