import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cloud,
  CloudOff,
  LogIn,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { DictionaryLookupPanel } from './components/DictionaryView.tsx';
import { DocumentTranslateView } from './components/DocumentTranslateView.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GlossaryView } from './components/GlossaryView.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { ImageTranslateView } from './components/ImageTranslateView.tsx';
import { SeoHeroHeader, SeoLandingSection } from './components/SeoLandingSection.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { SidebarNav } from './components/SidebarNav.tsx';
import { TranslateTextView } from './components/TranslateTextView.tsx';
import { VoiceTranslateView } from './components/VoiceTranslateView.tsx';
import { AuthSyncProvider, useAuthSync } from './contexts/AuthSyncContext.tsx';
import { fetchProviders, saveConversationSessionApi } from './lib/api/translatorClient.ts';
import { TtsAudioController, type PlaybackStatus } from './lib/audio/ttsPlayer.ts';
import { DEFAULT_SETTINGS, storageRepository } from './lib/storage/indexedDb.ts';
import type {
  AppSettings,
  ConversationSession,
  Glossary,
  HistoryItem,
  NavView,
  ProviderStatus,
  StyleProfile,
  TranslationTone,
} from './shared/types.ts';
import {
  deriveSavedTranslationsFromHistory,
  filterSyncableEntitiesForUser,
  toggleHistoryFavoriteState,
} from './utils/sync.ts';

function isKnownAppPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return clean === '/' || clean === '/index.html';
}

const VIEW_TITLES: Record<NavView, string> = {
  translate: 'Translate Text',
  documents: 'Translate Documents',
  images: 'Translate Images',
  voice: 'Translate Voice',
  dictionary: 'Dictionary',
  glossary: 'Glossary',
  history: 'Translation History',
  settings: 'Settings',
};

function LinguaflowWorkspace({
  initialSyncedUpdate,
  registerRemoteHandler,
}: {
  initialSyncedUpdate: number;
  registerRemoteHandler: (
    handler: (update: {
      history?: HistoryItem[];
      glossaries?: Glossary[];
      styleProfiles?: StyleProfile[];
      preferences?: AppSettings;
    }) => void,
  ) => void;
}) {
  const {
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
  } = useAuthSync();

  const [activeView, setActiveView] = useState<NavView>('translate');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [glossaries, setGlossaries] = useState<Glossary[]>([]);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('idle');
  const [authActionBusy, setAuthActionBusy] = useState(false);

  const [reopenDraft, setReopenDraft] = useState<{
    draftKey: number;
    sourceText: string;
    translatedText: string;
    sourceLang: string;
    detectedSourceLang?: string;
    targetLang: string;
    tone: TranslationTone;
    context?: string;
  } | null>(null);

  const [isNotFoundRoute, setIsNotFoundRoute] = useState<boolean>(() =>
    typeof window !== 'undefined' ? !isKnownAppPath(window.location.pathname) : false,
  );

  const ttsRef = useRef<TtsAudioController | null>(null);
  const initialSyncDoneForUidRef = useRef<string | null>(null);
  const lastSignedInUidRef = useRef<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setIsNotFoundRoute(!isKnownAppPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) {
      robotsMeta.setAttribute(
        'content',
        isNotFoundRoute
          ? 'noindex, nofollow'
          : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      );
    }
  }, [isNotFoundRoute]);

  useEffect(() => {
    ttsRef.current = new TtsAudioController(setPlaybackStatus);
    return () => {
      ttsRef.current?.stop();
    };
  }, []);

  // Register handler for live Firestore snapshots once initial merge has completed
  useEffect(() => {
    registerRemoteHandler((update) => {
      if (!initialSyncDoneForUidRef.current) return;
      if (update.history) {
        setHistory(update.history);
      }
      if (update.glossaries) {
        setGlossaries(update.glossaries);
      }
      if (update.styleProfiles) {
        setStyleProfiles(update.styleProfiles);
      }
      if (update.preferences) {
        setSettings(update.preferences);
        void storageRepository.saveSettings(update.preferences);
      }
    });
  }, [registerRemoteHandler]);

  // Load persisted IndexedDB data & server providers on mount
  useEffect(() => {
    async function hydrate() {
      const [loadedSettings, loadedHistory, loadedGlossaries, loadedProfiles] =
        await Promise.all([
          storageRepository.getSettings(),
          storageRepository.getHistory(),
          storageRepository.getGlossaries(),
          storageRepository.getStyleProfiles(),
        ]);

      setSettings(loadedSettings);
      setSettingsHydrated(true);
      setHistory(loadedHistory);
      setGlossaries(loadedGlossaries);
      setStyleProfiles(loadedProfiles);

      try {
        const provs = await fetchProviders();
        setProviders(provs);
      } catch {
        setProviders([]);
      }
    }
    void hydrate();
  }, [initialSyncedUpdate]);

  // Run full bidirectional sync (merge IndexedDB <-> Cloud Firestore) upon sign-in
  const performCloudSync = useCallback(async () => {
    if (!user) return;
    const [localPrefs, localHistory, localGlossaries, localProfiles] = await Promise.all([
      storageRepository.getSettings(),
      storageRepository.getHistory(),
      storageRepository.getGlossaries(),
      storageRepository.getStyleProfiles(),
    ]);

    const isolatedHistory = filterSyncableEntitiesForUser(localHistory, user.uid);
    const isolatedGlossaries = filterSyncableEntitiesForUser(localGlossaries, user.uid);
    const isolatedProfiles = filterSyncableEntitiesForUser(localProfiles, user.uid);

    const merged = await syncNow({
      preferences: localPrefs,
      history: isolatedHistory,
      glossaries: isolatedGlossaries,
      styleProfiles: isolatedProfiles,
    });

    if (merged) {
      setSettings(merged.preferences);
      setHistory(merged.history);
      setGlossaries(merged.glossaries);
      setStyleProfiles(merged.styleProfiles);

      await Promise.all([
        storageRepository.saveSettings(merged.preferences),
        ...merged.history.map((h) => storageRepository.saveHistoryItem({ ...h, userId: user.uid })),
        ...merged.glossaries.map((g) => storageRepository.saveGlossary({ ...g, userId: user.uid })),
        ...merged.styleProfiles.map((p) =>
          storageRepository.saveStyleProfile({ ...p, userId: user.uid }),
        ),
      ]);
      initialSyncDoneForUidRef.current = user.uid;
    }
  }, [syncNow, user]);

  useEffect(() => {
    if (!isAuthReady) return;

    const prevUid = lastSignedInUidRef.current;
    if (!user) {
      initialSyncDoneForUidRef.current = null;
      if (prevUid) {
        lastSignedInUidRef.current = null;
        setHistory((prev) => prev.filter((item) => item.userId !== prevUid));
        setGlossaries((prev) => prev.filter((item) => item.userId !== prevUid));
        setStyleProfiles((prev) => prev.filter((item) => item.userId !== prevUid));
        void storageRepository.clearUserRecords(prevUid);
      }
      return;
    }

    if (prevUid && prevUid !== user.uid) {
      void storageRepository.clearUserRecords(prevUid);
      setHistory((prev) => prev.filter((item) => item.userId !== prevUid));
      setGlossaries((prev) => prev.filter((item) => item.userId !== prevUid));
      setStyleProfiles((prev) => prev.filter((item) => item.userId !== prevUid));
    }

    lastSignedInUidRef.current = user.uid;
    if (initialSyncDoneForUidRef.current === user.uid) return;
    void performCloudSync();
  }, [isAuthReady, user, performCloudSync]);

  // Sync Tailwind .dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  async function handleUpdateSettings(next: AppSettings) {
    const stamped = { ...next, updatedAt: Date.now() };
    setSettings(stamped);
    await storageRepository.saveSettings(stamped);
    if (user) {
      void pushPartial({ preferences: stamped });
    }
  }

  async function handleSaveHistory(item: HistoryItem) {
    const stamped: HistoryItem = {
      ...item,
      userId: user?.uid || item.userId,
      updatedAt: item.updatedAt || Date.now(),
      deleted: false,
    };
    setHistory((prev) => [stamped, ...prev.filter((h) => h.id !== stamped.id)]);
    await storageRepository.saveHistoryItem(stamped);
    if (user) {
      void pushPartial({
        history: [stamped],
        savedTranslations: deriveSavedTranslationsFromHistory([stamped]),
      });
    }
  }

  async function handleToggleFavorite(item: HistoryItem) {
    const now = Date.now();
    const updated = toggleHistoryFavoriteState(item, now, user?.uid);
    setHistory((prev) => prev.map((h) => (h.id === item.id ? updated : h)));
    await storageRepository.saveHistoryItem(updated);
    if (user) {
      void pushPartial({
        history: [updated],
        savedTranslations: updated.favorite
          ? deriveSavedTranslationsFromHistory([updated])
          : [{
              id: updated.id,
              userId: user.uid,
              sourceText: updated.sourceText,
              translatedText: updated.translatedText,
              sourceLang: updated.sourceLang,
              detectedSourceLang: updated.detectedSourceLang,
              targetLang: updated.targetLang,
              tone: updated.tone,
              context: updated.context,
              provider: updated.provider,
              tags: ['favorite'],
              deleted: true,
              createdAt: updated.createdAt,
              updatedAt: now,
            }],
      });
    }
  }

  async function handleDeleteHistory(id: string) {
    const target = history.find((h) => h.id === id);
    setHistory((prev) => prev.filter((h) => h.id !== id));
    await storageRepository.deleteHistoryItem(id);
    if (user && target) {
      const tombstone: HistoryItem = {
        ...target,
        userId: user.uid,
        deleted: true,
        updatedAt: Date.now(),
      };
      void pushPartial({ history: [tombstone] });
    }
  }

  async function handleClearHistory() {
    const snapshot = [...history];
    setHistory([]);
    await storageRepository.clearHistory();
    if (user && snapshot.length > 0) {
      const now = Date.now();
      const tombstones = snapshot.map((item) => ({
        ...item,
        userId: user.uid,
        deleted: true,
        updatedAt: now,
      }));
      void pushPartial({ history: tombstones });
    }
  }

  async function handleSaveGlossary(glossary: Glossary) {
    const stamped: Glossary = {
      ...glossary,
      userId: user?.uid || glossary.userId,
      updatedAt: Date.now(),
      deleted: false,
    };
    setGlossaries((prev) => {
      const exists = prev.some((g) => g.id === stamped.id);
      return exists
        ? prev.map((g) => (g.id === stamped.id ? stamped : g))
        : [stamped, ...prev];
    });
    await storageRepository.saveGlossary(stamped);
    if (user) {
      void pushPartial({ glossaries: [stamped] });
    }
  }

  async function handleDeleteGlossary(id: string) {
    const target = glossaries.find((g) => g.id === id);
    setGlossaries((prev) => prev.filter((g) => g.id !== id));
    await storageRepository.deleteGlossary(id);
    if (user && target) {
      void pushPartial({
        glossaries: [{ ...target, userId: user.uid, deleted: true, updatedAt: Date.now() }],
      });
    }
  }

  async function handleSaveStyleProfile(profile: StyleProfile) {
    const stamped: StyleProfile = {
      ...profile,
      userId: user?.uid || profile.userId,
      updatedAt: Date.now(),
      deleted: false,
    };
    setStyleProfiles((prev) => {
      const exists = prev.some((p) => p.id === stamped.id);
      return exists
        ? prev.map((p) => (p.id === stamped.id ? stamped : p))
        : [stamped, ...prev];
    });
    await storageRepository.saveStyleProfile(stamped);
    if (user) {
      void pushPartial({ styleProfiles: [stamped] });
    }
  }

  async function handleDeleteStyleProfile(id: string) {
    const target = styleProfiles.find((p) => p.id === id);
    setStyleProfiles((prev) => prev.filter((p) => p.id !== id));
    await storageRepository.deleteStyleProfile(id);
    if (user && target) {
      void pushPartial({
        styleProfiles: [{ ...target, userId: user.uid, deleted: true, updatedAt: Date.now() }],
      });
    }
  }

  async function handleSaveConversation(session: ConversationSession) {
    if (!user) return;
    try {
      await saveConversationSessionApi(session);
    } catch {
      // Non-fatal fallback; transcript already saved in History
    }
  }

  function handleSpeak(
    text: string,
    langCode: string,
    voice: AppSettings['ttsVoice'] = settings.ttsVoice,
    speed: number = settings.ttsSpeed,
  ) {
    if (typeof text !== 'string' || !text.trim()) return;
    void ttsRef.current?.play({
      text,
      langCode,
      voiceName: voice,
      speed,
    });
  }

  async function handleGoogleSignIn() {
    setAuthActionBusy(true);
    try {
      await signIn();
    } finally {
      setAuthActionBusy(false);
    }
  }

  const activeGlossaryCount = glossaries.filter((g) => g.enabled).length;

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <SidebarNav
        activeView={activeView}
        onSelectView={setActiveView}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        historyCount={history.length}
        activeGlossaryCount={activeGlossaryCount}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean 3-zone Top Header */}
        <header className="h-16 px-4 sm:px-6 lg:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            {activeView === 'translate' ? (
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 truncate">
                {VIEW_TITLES[activeView]}
              </span>
            ) : (
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 truncate">
                {VIEW_TITLES[activeView]}
              </h1>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAuthReady && (
              user ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void performCloudSync()}
                    disabled={syncStatus === 'syncing'}
                    title={
                      syncStatus === 'error'
                        ? syncError || 'Sync failed'
                        : lastSyncedAt
                          ? `Synced at ${new Date(lastSyncedAt).toLocaleTimeString()}`
                          : 'Sync with cloud'
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    {syncStatus === 'syncing' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    ) : syncStatus === 'error' ? (
                      <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span className="hidden md:inline max-w-[140px] truncate">
                      {user.displayName || user.email}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    aria-label="Sign out of cloud sync"
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleGoogleSignIn()}
                  disabled={authActionBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{authActionBusy ? 'Signing in...' : 'Sign in to Sync'}</span>
                </button>
              )
            )}

            <button
              type="button"
              onClick={() =>
                void handleUpdateSettings({
                  ...settings,
                  theme: settings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {settings.theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-600" />
                  <span className="hidden sm:inline">Dark Mode</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Main Workspace Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {authError && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-3 p-3.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs sm:text-sm text-amber-900 dark:text-amber-200"
            >
              <span className="whitespace-pre-line leading-relaxed">{authError}</span>
              <button
                type="button"
                onClick={clearAuthError}
                className="font-semibold underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
          {isNotFoundRoute ? (
            <section
              aria-labelledby="not-found-heading"
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-4 max-w-xl mx-auto my-8"
            >
              <p className="text-xs font-mono font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                HTTP 404 · Not Found
              </p>
              <h1
                id="not-found-heading"
                className="text-2xl font-bold text-slate-900 dark:text-slate-50"
              >
                404 — Halaman Tidak Ditemukan
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Maaf, URL <span className="font-mono">{window.location.pathname}</span> tidak tersedia di EduZone LinguaFlow. Kembali ke halaman utama untuk menggunakan penerjemah AI, dokumen, gambar OCR, suara, kamus, dan glossary.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    window.history.pushState({}, '', '/');
                    setIsNotFoundRoute(false);
                    setActiveView('translate');
                  }}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Kembali ke Beranda
                </button>
              </div>
            </section>
          ) : (
          <>
          {activeView === 'translate' && (
            <>
              <SeoHeroHeader
                onFocusTranslator={() => {
                  const el = document.getElementById('source-text-input') as HTMLTextAreaElement | null;
                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el?.focus();
                }}
              />
              <TranslateTextView
                settings={settings}
                settingsHydrated={settingsHydrated}
                glossaries={glossaries}
                styleProfiles={styleProfiles}
                playbackStatus={playbackStatus}
                initialDraft={reopenDraft}
                onSaveHistory={handleSaveHistory}
                onSpeakText={(txt, lang) => handleSpeak(txt, lang)}
                onStopSpeak={() => ttsRef.current?.stop()}
                onNavigateView={(view) => setActiveView(view)}
              />
              <SeoLandingSection
                onNavigateView={(view) => {
                  setActiveView(view);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onFocusTranslator={() => {
                  const el = document.getElementById('source-text-input') as HTMLTextAreaElement | null;
                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el?.focus();
                }}
              />
            </>
          )}

          {activeView === 'documents' && (
            <DocumentTranslateView
              settings={settings}
              glossaries={glossaries}
              onSaveHistory={handleSaveHistory}
            />
          )}

          {activeView === 'images' && (
            <ImageTranslateView settings={settings} onSaveHistory={handleSaveHistory} />
          )}

          {activeView === 'voice' && (
            <VoiceTranslateView
              settings={settings}
              playbackStatus={playbackStatus}
              onPlaySpeech={handleSpeak}
              onPauseSpeech={() => ttsRef.current?.pause()}
              onResumeSpeech={() => ttsRef.current?.resume()}
              onStopSpeech={() => ttsRef.current?.stop()}
              onChangeSpeed={(speed) => ttsRef.current?.setSpeed(speed)}
              onSaveHistory={handleSaveHistory}
              onSaveConversation={handleSaveConversation}
            />
          )}

          {activeView === 'dictionary' && (
            <DictionaryLookupPanel
              sourceLang={settings.defaultSourceLang || 'auto'}
              targetLang={settings.defaultTargetLang || 'id'}
              extraLanguages={settings.customLanguages || []}
              playbackStatus={playbackStatus}
              onSpeak={(txt, lang) => handleSpeak(txt, lang)}
              onStopSpeak={() => ttsRef.current?.stop()}
            />
          )}

          {activeView === 'glossary' && (
            <GlossaryView
              glossaries={glossaries}
              extraLanguages={settings.customLanguages || []}
              onSaveGlossary={handleSaveGlossary}
              onDeleteGlossary={handleDeleteGlossary}
            />
          )}

          {activeView === 'history' && (
            <HistoryView
              history={history}
              extraLanguages={settings.customLanguages || []}
              onToggleFavorite={handleToggleFavorite}
              onDeleteItem={handleDeleteHistory}
              onClearAll={handleClearHistory}
              onReopenTranslation={(item) => {
                setReopenDraft({
                  draftKey: Date.now(),
                  sourceText: item.sourceText,
                  translatedText: item.translatedText,
                  sourceLang: item.sourceLang,
                  detectedSourceLang: item.detectedSourceLang,
                  targetLang: item.targetLang,
                  tone: item.tone,
                  context: item.context,
                });
                setActiveView('translate');
              }}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              settings={settings}
              providers={providers}
              styleProfiles={styleProfiles}
              onUpdateSettings={handleUpdateSettings}
              onSaveStyleProfile={handleSaveStyleProfile}
              onDeleteStyleProfile={handleDeleteStyleProfile}
              cloudSync={{
                userEmail: user?.email || null,
                userName: user?.displayName || null,
                userUid: user?.uid || null,
                syncStatus,
                lastSyncedAt,
                syncError,
                authError,
                onSignIn: handleGoogleSignIn,
                onSignOut: signOut,
                onSyncNow: performCloudSync,
              }}
            />
          )}
          </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const remoteHandlerRef = useRef<
    ((update: {
      history?: HistoryItem[];
      glossaries?: Glossary[];
      styleProfiles?: StyleProfile[];
      preferences?: AppSettings;
    }) => void) | null
  >(null);

  const registerRemoteHandler = useCallback(
    (
      handler: (update: {
        history?: HistoryItem[];
        glossaries?: Glossary[];
        styleProfiles?: StyleProfile[];
        preferences?: AppSettings;
      }) => void,
    ) => {
      remoteHandlerRef.current = handler;
    },
    [],
  );

  const handleRemoteCollectionUpdate = useCallback(
    (update: {
      history?: HistoryItem[];
      glossaries?: Glossary[];
      styleProfiles?: StyleProfile[];
      preferences?: AppSettings;
    }) => {
      remoteHandlerRef.current?.(update);
    },
    [],
  );

  return (
    <ErrorBoundary>
      <AuthSyncProvider onRemoteCollectionUpdate={handleRemoteCollectionUpdate}>
        <LinguaflowWorkspace
          initialSyncedUpdate={0}
          registerRemoteHandler={registerRemoteHandler}
        />
      </AuthSyncProvider>
    </ErrorBoundary>
  );
}
