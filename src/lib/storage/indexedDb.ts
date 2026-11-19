import type {
  AppSettings,
  Glossary,
  HistoryItem,
  StyleProfile,
} from '../../shared/types.ts';
import type { StorageRepository } from './types.ts';

const DB_NAME = 'linguaflow_db';
const DB_VERSION = 1;
const STORES = {
  history: 'history',
  glossaries: 'glossaries',
  styleProfiles: 'styleProfiles',
  settings: 'settings',
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  provider: 'gemini',
  autoTranslate: true,
  autoSaveHistory: true,
  defaultSourceLang: 'auto',
  defaultTargetLang: 'id',
  defaultTone: 'natural',
  defaultFormality: 'default',
  ttsVoice: 'Kore',
  ttsSpeed: 1.0,
  showPrivacyNotice: true,
  customLanguages: [],
};

const SEED_PROFILES: StyleProfile[] = [
  {
    id: 'profile-business',
    name: 'Executive Business',
    tone: 'business',
    formality: 'more_formal',
    writingStyle: 'Clear, concise, polite, and action-oriented corporate register.',
    preferredTerminology: 'Use standard enterprise and financial terminology.',
    customInstructions: 'Avoid slang. Keep greetings and sign-offs courteous and direct.',
    isDefault: false,
    updatedAt: Date.now(),
  },
  {
    id: 'profile-academic',
    name: 'Academic & Research',
    tone: 'academic',
    formality: 'more_formal',
    writingStyle: 'Objective, precise, formal scholarly prose.',
    preferredTerminology: 'Maintain established discipline-specific scientific terms.',
    customInstructions: 'Preserve citations, hedging expressions, and passive/impersonal constructions where appropriate.',
    isDefault: false,
    updatedAt: Date.now(),
  },
];

const SEED_GLOSSARIES: Glossary[] = [
  {
    id: 'glossary-tech-en-id',
    name: 'Software & Cloud (EN → ID)',
    sourceLang: 'en',
    targetLang: 'id',
    enabled: false,
    updatedAt: Date.now(),
    terms: [
      { id: 'term-1', sourceTerm: 'cloud-native', targetTerm: 'berbasis komputasi awan', notes: 'Architecture' },
      { id: 'term-2', sourceTerm: 'deployment', targetTerm: 'penerapan sistem', notes: 'DevOps' },
      { id: 'term-3', sourceTerm: 'latency', targetTerm: 'latensi', notes: 'Networking' },
    ],
  },
];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.history)) {
        db.createObjectStore(STORES.history, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.glossaries)) {
        db.createObjectStore(STORES.glossaries, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.styleProfiles)) {
        db.createObjectStore(STORES.styleProfiles, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(storeName: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const SEED_FLAG_KEY = 'linguaflow_seeded_v1';

export class IndexedDbStorageRepository implements StorageRepository {
  private async ensureSeeded(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(SEED_FLAG_KEY)) return;
    try {
      const [profiles, glossaries] = await Promise.all([
        idbGetAll<StyleProfile>(STORES.styleProfiles),
        idbGetAll<Glossary>(STORES.glossaries),
      ]);
      if (profiles.length === 0) {
        for (const p of SEED_PROFILES) {
          await idbPut(STORES.styleProfiles, p);
        }
      }
      if (glossaries.length === 0) {
        for (const g of SEED_GLOSSARIES) {
          await idbPut(STORES.glossaries, g);
        }
      }
      localStorage.setItem(SEED_FLAG_KEY, '1');
    } catch {
      // Ignore seed error on restricted contexts
    }
  }

  async getHistory(): Promise<HistoryItem[]> {
    try {
      const items = await idbGetAll<HistoryItem>(STORES.history);
      return items.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  async saveHistoryItem(item: HistoryItem): Promise<void> {
    await idbPut(STORES.history, item);
  }

  async deleteHistoryItem(id: string): Promise<void> {
    await idbDelete(STORES.history, id);
  }

  async clearHistory(): Promise<void> {
    await idbClear(STORES.history);
  }

  async getGlossaries(): Promise<Glossary[]> {
    await this.ensureSeeded();
    try {
      const items = await idbGetAll<Glossary>(STORES.glossaries);
      return items.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async saveGlossary(glossary: Glossary): Promise<void> {
    await idbPut(STORES.glossaries, glossary);
  }

  async deleteGlossary(id: string): Promise<void> {
    await idbDelete(STORES.glossaries, id);
  }

  async getStyleProfiles(): Promise<StyleProfile[]> {
    await this.ensureSeeded();
    try {
      const items = await idbGetAll<StyleProfile>(STORES.styleProfiles);
      return items.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return SEED_PROFILES;
    }
  }

  async saveStyleProfile(profile: StyleProfile): Promise<void> {
    await idbPut(STORES.styleProfiles, profile);
  }

  async deleteStyleProfile(id: string): Promise<void> {
    await idbDelete(STORES.styleProfiles, id);
  }

  async getSettings(): Promise<AppSettings> {
    try {
      const rows = await idbGetAll<AppSettings & { id: string }>(STORES.settings);
      const found = rows.find((r) => r.id === 'app_settings');
      if (!found) return DEFAULT_SETTINGS;
      const { id: _id, ...rest } = found;
      return { ...DEFAULT_SETTINGS, ...rest };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await idbPut(STORES.settings, { id: 'app_settings', ...settings });
  }

  async clearUserRecords(uid: string): Promise<void> {
    try {
      const [history, glossaries, profiles] = await Promise.all([
        idbGetAll<HistoryItem>(STORES.history),
        idbGetAll<Glossary>(STORES.glossaries),
        idbGetAll<StyleProfile>(STORES.styleProfiles),
      ]);
      await Promise.all([
        ...history.filter((h) => h.userId === uid).map((h) => idbDelete(STORES.history, h.id)),
        ...glossaries.filter((g) => g.userId === uid).map((g) => idbDelete(STORES.glossaries, g.id)),
        ...profiles.filter((p) => p.userId === uid).map((p) => idbDelete(STORES.styleProfiles, p.id)),
      ]);
    } catch {
      // Ignore cleanup errors on restricted IndexedDB contexts
    }
  }
}

export const storageRepository: StorageRepository = new IndexedDbStorageRepository();
