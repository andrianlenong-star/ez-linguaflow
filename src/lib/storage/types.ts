import type {
  AppSettings,
  Glossary,
  HistoryItem,
  StyleProfile,
} from '../../shared/types.ts';

export interface StorageRepository {
  getHistory(): Promise<HistoryItem[]>;
  saveHistoryItem(item: HistoryItem): Promise<void>;
  deleteHistoryItem(id: string): Promise<void>;
  clearHistory(): Promise<void>;

  getGlossaries(): Promise<Glossary[]>;
  saveGlossary(glossary: Glossary): Promise<void>;
  deleteGlossary(id: string): Promise<void>;

  getStyleProfiles(): Promise<StyleProfile[]>;
  saveStyleProfile(profile: StyleProfile): Promise<void>;
  deleteStyleProfile(id: string): Promise<void>;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;

  clearUserRecords(uid: string): Promise<void>;
}
