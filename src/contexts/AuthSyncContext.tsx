import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  auth,
  consumeRedirectSignInResult,
  db,
  formatAuthErrorMessage,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
} from '../lib/firebase/client.ts';
import { syncPullApi, syncPushApi } from '../lib/api/translatorClient.ts';
import type {
  AppSettings,
  ConversationSession,
  Glossary,
  HistoryItem,
  SavedTranslation,
  StyleProfile,
} from '../shared/types.ts';
import {
  deriveSavedTranslationsFromHistory,
  mergePreferences,
  mergeTimestampedEntities,
} from '../utils/sync.ts';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface CloudSyncCallbacks {
  onApplySyncedState: (state: {
    preferences?: AppSettings;
    history?: HistoryItem[];
    glossaries?: Glossary[];
    styleProfiles?: StyleProfile[];
  }) => void;
  getLocalSnapshot: () => {
    preferences: AppSettings;
    history: HistoryItem[];
    glossaries: Glossary[];
    styleProfiles: StyleProfile[];
  };
}

interface AuthSyncContextValue {
  user: User | null;
  isAuthReady: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  syncError: string | null;
  authError: string | null;
  clearAuthError: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: (localSnapshot: {
    preferences: AppSettings;
    history: HistoryItem[];
    glossaries: Glossary[];
    styleProfiles: StyleProfile[];
  }) => Promise<{
    preferences: AppSettings;
    history: HistoryItem[];
    glossaries: Glossary[];
    styleProfiles: StyleProfile[];
  } | null>;
  pushPartial: (payload: {
    preferences?: AppSettings;
    history?: HistoryItem[];
    savedTranslations?: SavedTranslation[];
    glossaries?: Glossary[];
    styleProfiles?: StyleProfile[];
    conversations?: ConversationSession[];
  }) => Promise<void>;
}

const AuthSyncContext = createContext<AuthSyncContextValue | null>(null);

export function AuthSyncProvider({
  children,
  onRemoteCollectionUpdate,
}: {
  children: ReactNode;
  onRemoteCollectionUpdate: (update: {
    history?: HistoryItem[];
    glossaries?: Glossary[];
    styleProfiles?: StyleProfile[];
    preferences?: AppSettings;
  }) => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    void consumeRedirectSignInResult().catch((err) => {
      const msg = formatAuthErrorMessage(err);
      if (msg) setAuthError(msg);
    });
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsAuthReady(true);
      if (nextUser) {
        setAuthError(null);
      } else {
        setSyncStatus('idle');
        setSyncError(null);
      }
    });
    return () => unsub();
  }, []);

  // Live Firestore snapshot listeners ONLY when authenticated with verified email
  useEffect(() => {
    if (!isAuthReady || !user || !user.emailVerified) return;

    const uid = user.uid;
    const unsubs: Array<() => void> = [];

    const historyPath = `users/${uid}/history`;
    unsubs.push(
      onSnapshot(
        query(collection(db, historyPath), where('userId', '==', uid)),
        (snap) => {
          const items = snap.docs
            .map((d) => {
              const raw = d.data() as Record<string, unknown>;
              return {
                id: String(raw.id || d.id),
                userId: uid,
                sourceText: String(raw.sourceText || ''),
                translatedText: String(raw.translatedText || ''),
                sourceLang: String(raw.sourceLang || 'auto'),
                detectedSourceLang: raw.detectedSourceLang
                  ? String(raw.detectedSourceLang)
                  : undefined,
                targetLang: String(raw.targetLang || 'id'),
                tone: (raw.tone as HistoryItem['tone']) || 'natural',
                context: raw.context ? String(raw.context) : undefined,
                provider: raw.provider === 'deepl' ? 'deepl' : 'gemini',
                favorite: Boolean(raw.favorite),
                saved: Boolean(raw.saved),
                deleted: Boolean(raw.deleted),
                createdAt: Number(raw.createdAtMs || Date.now()),
                updatedAt: Number(raw.updatedAtMs || raw.createdAtMs || Date.now()),
              } satisfies HistoryItem;
            })
            .filter((item) => !item.deleted)
            .sort((a, b) => b.createdAt - a.createdAt);
          onRemoteCollectionUpdate({ history: items });
        },
        (err) => {
          setSyncStatus('error');
          setSyncError(err.message || 'Cloud history listener error.');
          try {
            handleFirestoreError(err, OperationType.LIST, historyPath);
          } catch {
            // Logged structured JSON by handleFirestoreError; surfaced in UI via syncError
          }
        },
      ),
    );

    const glossariesPath = `users/${uid}/glossaries`;
    unsubs.push(
      onSnapshot(
        query(collection(db, glossariesPath), where('userId', '==', uid)),
        (snap) => {
          const items = snap.docs
            .map((d) => {
              const raw = d.data() as Record<string, unknown>;
              return {
                id: String(raw.id || d.id),
                userId: uid,
                name: String(raw.name || ''),
                sourceLang: String(raw.sourceLang || 'auto'),
                targetLang: String(raw.targetLang || 'id'),
                enabled: Boolean(raw.enabled),
                terms: Array.isArray(raw.terms) ? (raw.terms as Glossary['terms']) : [],
                deleted: Boolean(raw.deleted),
                updatedAt: Number(raw.updatedAtMs || Date.now()),
              } satisfies Glossary;
            })
            .filter((item) => !item.deleted)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          onRemoteCollectionUpdate({ glossaries: items });
        },
        (err) => {
          setSyncStatus('error');
          setSyncError(err.message || 'Cloud glossary listener error.');
          try {
            handleFirestoreError(err, OperationType.LIST, glossariesPath);
          } catch {
            // Logged structured JSON by handleFirestoreError; surfaced in UI via syncError
          }
        },
      ),
    );

    const profilesPath = `users/${uid}/styleProfiles`;
    unsubs.push(
      onSnapshot(
        query(collection(db, profilesPath), where('userId', '==', uid)),
        (snap) => {
          const items = snap.docs
            .map((d) => {
              const raw = d.data() as Record<string, unknown>;
              return {
                id: String(raw.id || d.id),
                userId: uid,
                name: String(raw.name || ''),
                tone: (raw.tone as StyleProfile['tone']) || 'professional',
                formality: (raw.formality as StyleProfile['formality']) || 'default',
                writingStyle: String(raw.writingStyle || ''),
                preferredTerminology: String(raw.preferredTerminology || ''),
                customInstructions: String(raw.customInstructions || ''),
                isDefault: Boolean(raw.isDefault),
                deleted: Boolean(raw.deleted),
                updatedAt: Number(raw.updatedAtMs || Date.now()),
              } satisfies StyleProfile;
            })
            .filter((item) => !item.deleted)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          onRemoteCollectionUpdate({ styleProfiles: items });
        },
        (err) => {
          setSyncStatus('error');
          setSyncError(err.message || 'Cloud style profiles listener error.');
          try {
            handleFirestoreError(err, OperationType.LIST, profilesPath);
          } catch {
            // Logged structured JSON by handleFirestoreError; surfaced in UI via syncError
          }
        },
      ),
    );

    const prefPath = `users/${uid}/preferences/default`;
    unsubs.push(
      onSnapshot(
        doc(db, 'users', uid, 'preferences', 'default'),
        (snap) => {
          if (!snap.exists()) return;
          const raw = snap.data() as Record<string, unknown>;
          const prefs: AppSettings = {
            theme: raw.theme === 'dark' ? 'dark' : 'light',
            provider: raw.provider === 'deepl' ? 'deepl' : 'gemini',
            autoTranslate: Boolean(raw.autoTranslate ?? true),
            autoSaveHistory: Boolean(raw.autoSaveHistory ?? true),
            defaultSourceLang: String(raw.defaultSourceLang || 'auto'),
            defaultTargetLang: String(raw.defaultTargetLang || 'id'),
            defaultTone: (raw.defaultTone as AppSettings['defaultTone']) || 'natural',
            defaultFormality: (raw.defaultFormality as AppSettings['defaultFormality']) || 'default',
            ttsVoice: (raw.ttsVoice as AppSettings['ttsVoice']) || 'Kore',
            ttsSpeed: Number(raw.ttsSpeed || 1.0),
            showPrivacyNotice: Boolean(raw.showPrivacyNotice ?? true),
            updatedAt: Number(raw.updatedAtMs || Date.now()),
            customLanguages: Array.isArray(raw.customLanguages)
              ? (raw.customLanguages as AppSettings['customLanguages'])
              : [],
          };
          onRemoteCollectionUpdate({ preferences: prefs });
        },
        (err) => {
          setSyncStatus('error');
          setSyncError(err.message || 'Cloud preferences listener error.');
          try {
            handleFirestoreError(err, OperationType.GET, prefPath);
          } catch {
            // Logged structured JSON by handleFirestoreError; surfaced in UI via syncError
          }
        },
      ),
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isAuthReady, user, onRemoteCollectionUpdate]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const signIn = useCallback(async () => {
    setSyncError(null);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = formatAuthErrorMessage(err);
      if (msg) {
        setAuthError(msg);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await signOutUser();
    setSyncStatus('idle');
    setLastSyncedAt(null);
    setSyncError(null);
    setAuthError(null);
  }, []);

  const syncNow = useCallback(
    async (localSnapshot: {
      preferences: AppSettings;
      history: HistoryItem[];
      glossaries: Glossary[];
      styleProfiles: StyleProfile[];
    }) => {
      if (!auth.currentUser) return null;
      setSyncStatus('syncing');
      setSyncError(null);
      try {
        const remote = await syncPullApi(0);

        const mergedHistory = mergeTimestampedEntities(localSnapshot.history, remote.history);
        const mergedGlossaries = mergeTimestampedEntities(
          localSnapshot.glossaries,
          remote.glossaries,
        );
        const mergedProfiles = mergeTimestampedEntities(
          localSnapshot.styleProfiles,
          remote.styleProfiles,
        );
        const mergedPreferences = mergePreferences(
          localSnapshot.preferences,
          remote.preferences,
        );

        await syncPushApi({
          preferences: mergedPreferences,
          history: mergedHistory,
          savedTranslations: deriveSavedTranslationsFromHistory(mergedHistory),
          glossaries: mergedGlossaries,
          styleProfiles: mergedProfiles,
        });

        setSyncStatus('synced');
        setLastSyncedAt(Date.now());
        return {
          preferences: mergedPreferences,
          history: mergedHistory,
          glossaries: mergedGlossaries,
          styleProfiles: mergedProfiles,
        };
      } catch (err) {
        setSyncStatus('error');
        setSyncError(err instanceof Error ? err.message : 'Cloud synchronization failed.');
        return null;
      }
    },
    [],
  );

  const pushPartial = useCallback(
    async (payload: {
      preferences?: AppSettings;
      history?: HistoryItem[];
      savedTranslations?: SavedTranslation[];
      glossaries?: Glossary[];
      styleProfiles?: StyleProfile[];
      conversations?: ConversationSession[];
    }) => {
      if (!auth.currentUser) return;
      try {
        await syncPushApi(payload);
        setSyncStatus('synced');
        setLastSyncedAt(Date.now());
        setSyncError(null);
      } catch (err) {
        setSyncStatus('error');
        setSyncError(err instanceof Error ? err.message : 'Failed to push cloud changes.');
      }
    },
    [],
  );

  return (
    <AuthSyncContext.Provider
      value={{
        user,
        isAuthReady,
        syncStatus,
        lastSyncedAt,
        syncError,
        authError,
        clearAuthError,
        signIn,
        signOut,
        syncNow,
        pushPartial,
      }}
    >
      {children}
    </AuthSyncContext.Provider>
  );
}

export function useAuthSync(): AuthSyncContextValue {
  const ctx = useContext(AuthSyncContext);
  if (!ctx) {
    throw new Error('useAuthSync must be used inside AuthSyncProvider.');
  }
  return ctx;
}
