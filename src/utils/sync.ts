import type { AppSettings, Glossary, HistoryItem, SavedTranslation, StyleProfile, ConversationSession } from '../shared/types.ts';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidEntityId(id: string): boolean {
  return SAFE_ID_REGEX.test(id);
}

export function sanitizeEntityId(rawId?: string): string {
  const cleaned = (rawId || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  if (cleaned && SAFE_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface TimestampedEntity {
  id: string;
  updatedAt?: number;
  createdAt?: number;
  deleted?: boolean;
}

/**
 * Deterministic last-write-wins merge for Web & Android synchronization.
 * Respects soft-delete tombstones (`deleted: true`) so deletions propagate across devices.
 */
export function mergeTimestampedEntities<T extends TimestampedEntity>(
  localItems: T[],
  remoteItems: T[],
): T[] {
  const byId = new Map<string, T>();

  for (const item of localItems) {
    byId.set(item.id, item);
  }

  for (const remote of remoteItems) {
    const existing = byId.get(remote.id);
    if (!existing) {
      byId.set(remote.id, remote);
      continue;
    }
    const localTs = existing.updatedAt ?? existing.createdAt ?? 0;
    const remoteTs = remote.updatedAt ?? remote.createdAt ?? 0;
    if (remoteTs >= localTs) {
      byId.set(remote.id, remote);
    }
  }

  return Array.from(byId.values())
    .filter((item) => !item.deleted)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
}

export function mergePreferences(local: AppSettings, remote: AppSettings | null): AppSettings {
  if (!remote) return local;
  const localTs = local.updatedAt ?? 0;
  const remoteTs = remote.updatedAt ?? 0;
  return remoteTs >= localTs ? { ...local, ...remote } : local;
}

export function deriveSavedTranslationsFromHistory(items: HistoryItem[]): SavedTranslation[] {
  return items
    .filter((item) => (item.favorite || item.saved) && !item.deleted)
    .map((item) => ({
      id: item.id,
      userId: item.userId,
      sourceText: item.sourceText,
      translatedText: item.translatedText,
      sourceLang: item.sourceLang,
      detectedSourceLang: item.detectedSourceLang,
      targetLang: item.targetLang,
      tone: item.tone,
      context: item.context,
      provider: item.provider,
      tags: item.favorite ? ['favorite'] : ['saved'],
      deleted: false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? item.createdAt,
    }));
}

export function filterSyncableEntitiesForUser<T extends { userId?: string }>(
  items: T[],
  uid: string,
): T[] {
  return items.filter((item) => !item.userId || item.userId === uid);
}

export type SyncableCollections = {
  history: HistoryItem[];
  savedTranslations: SavedTranslation[];
  glossaries: Glossary[];
  styleProfiles: StyleProfile[];
  conversations: ConversationSession[];
};

export function toggleHistoryFavoriteState(
  item: HistoryItem,
  now = Date.now(),
  uid?: string,
): HistoryItem {
  const nextFavorite = !item.favorite;
  return {
    ...item,
    userId: uid || item.userId,
    favorite: nextFavorite,
    saved: nextFavorite,
    updatedAt: now,
  };
}
