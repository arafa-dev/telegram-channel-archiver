import type { ArchiveItem } from './types';

export function ndjsonRow(item: ArchiveItem): string {
  return JSON.stringify(item) + '\n';
}

export function ndjsonAppend(existing: string, item: ArchiveItem): string {
  return existing + ndjsonRow(item);
}
