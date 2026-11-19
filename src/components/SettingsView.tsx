import { useState, type FormEvent } from 'react';
import { Cloud, CloudOff, LogIn, LogOut, Moon, Plus, RefreshCw, Sun, Trash2 } from 'lucide-react';
import type {
  AppSettings,
  ProviderStatus,
  StyleProfile,
  TranslationTone,
} from '../shared/types.ts';
import type { SyncStatus } from '../contexts/AuthSyncContext.tsx';
import { LanguageSelector } from './LanguageSelector.tsx';

interface SettingsViewProps {
  settings: AppSettings;
  providers: ProviderStatus[];
  styleProfiles: StyleProfile[];
  onUpdateSettings: (next: AppSettings) => Promise<void>;
  onSaveStyleProfile: (profile: StyleProfile) => Promise<void>;
  onDeleteStyleProfile: (id: string) => Promise<void>;
  cloudSync?: {
    userEmail: string | null;
    userName: string | null;
    userUid: string | null;
    syncStatus: SyncStatus;
    lastSyncedAt: number | null;
    syncError: string | null;
    authError?: string | null;
    onSignIn: () => Promise<void>;
    onSignOut: () => Promise<void>;
    onSyncNow: () => Promise<void>;
  };
}

export function SettingsView({
  settings,
  providers,
  styleProfiles,
  onUpdateSettings,
  onSaveStyleProfile,
  onDeleteStyleProfile,
  cloudSync,
}: SettingsViewProps) {
  const [profileName, setProfileName] = useState('');
  const [profileTone, setProfileTone] = useState<TranslationTone>('professional');
  const [profileFormality, setProfileFormality] = useState<StyleProfile['formality']>('more_formal');
  const [writingStyle, setWritingStyle] = useState('');
  const [preferredTerms, setPreferredTerms] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');

  const [newLangCode, setNewLangCode] = useState('');
  const [newLangName, setNewLangName] = useState('');
  const [newLangNative, setNewLangNative] = useState('');
  const [newLangBcp47, setNewLangBcp47] = useState('');

  async function handleCreateProfile(e: FormEvent) {
    e.preventDefault();
    if (!profileName.trim()) return;
    await onSaveStyleProfile({
      id: crypto.randomUUID(),
      name: profileName.trim(),
      tone: profileTone,
      formality: profileFormality,
      writingStyle: writingStyle.trim(),
      preferredTerminology: preferredTerms.trim(),
      customInstructions: customInstructions.trim(),
      updatedAt: Date.now(),
    });
    setProfileName('');
    setWritingStyle('');
    setPreferredTerms('');
    setCustomInstructions('');
  }

  async function handleAddCustomLanguage(e: FormEvent) {
    e.preventDefault();
    if (!newLangCode.trim() || !newLangName.trim()) return;
    const entry = {
      code: newLangCode.trim(),
      name: newLangName.trim(),
      nativeName: newLangNative.trim() || newLangName.trim(),
      bcp47: newLangBcp47.trim() || newLangCode.trim(),
      supportsFormality: true,
    };
    const filtered = (settings.customLanguages || []).filter(
      (l) => l.code.toLowerCase() !== entry.code.toLowerCase(),
    );
    await onUpdateSettings({
      ...settings,
      customLanguages: [...filtered, entry],
    });
    setNewLangCode('');
    setNewLangName('');
    setNewLangNative('');
    setNewLangBcp47('');
  }

  async function handleRemoveCustomLanguage(code: string) {
    await onUpdateSettings({
      ...settings,
      customLanguages: (settings.customLanguages || []).filter((l) => l.code !== code),
    });
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Cloud Account & Web <-> Android Synchronization */}
      {cloudSync && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
                Cloud Account & Cross-Device Sync (Web ↔ Android)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sign in with Google to synchronize history, saved translations, glossaries, style profiles, and preferences across EduZone Linguaflow Web and Android.
              </p>
            </div>

            {cloudSync.userEmail ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void cloudSync.onSyncNow()}
                  disabled={cloudSync.syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${cloudSync.syncStatus === 'syncing' ? 'animate-spin' : ''}`}
                  />
                  <span>{cloudSync.syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void cloudSync.onSignOut()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void cloudSync.onSignIn()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign in with Google</span>
              </button>
            )}
          </div>

          {cloudSync.userEmail ? (
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {cloudSync.userName || 'Signed-in User'} ({cloudSync.userEmail})
                </p>
                <p className="font-mono text-slate-500 dark:text-slate-400">
                  User ID: {cloudSync.userUid}
                </p>
              </div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                {cloudSync.syncStatus === 'error' ? (
                  <>
                    <CloudOff className="w-4 h-4 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">
                      {cloudSync.syncError || 'Sync failed'}
                    </span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>
                      {cloudSync.lastSyncedAt
                        ? `Last synced ${new Date(cloudSync.lastSyncedAt).toLocaleString()}`
                        : 'Connected'}
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Currently in local offline mode (saved in browser IndexedDB). Signing in automatically merges your local items into your private cloud workspace.
              </p>
              {cloudSync.authError && (
                <p role="alert" className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
                  {cloudSync.authError}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Appearance & General Behavior */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
          Appearance & Translation Defaults
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-4 py-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Color Theme</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Switch between crisp light workspace and low-glare dark mode.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => void onUpdateSettings({ ...settings, theme: 'light' })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                settings.theme === 'light'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => void onUpdateSettings({ ...settings, theme: 'dark' })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                settings.theme === 'dark'
                  ? 'bg-slate-900 text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Default Source Language
            </span>
            <LanguageSelector
              value={settings.defaultSourceLang}
              onChange={(code) => void onUpdateSettings({ ...settings, defaultSourceLang: code })}
              allowAuto
              extraLanguages={settings.customLanguages}
              label="Default source language"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Default Target Language
            </span>
            <LanguageSelector
              value={settings.defaultTargetLang}
              onChange={(code) => void onUpdateSettings({ ...settings, defaultTargetLang: code })}
              extraLanguages={settings.customLanguages}
              label="Default target language"
            />
          </div>

          <div>
            <label
              htmlFor="settings-default-tone"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Default Translation Tone
            </label>
            <select
              id="settings-default-tone"
              value={settings.defaultTone}
              onChange={(e) =>
                void onUpdateSettings({
                  ...settings,
                  defaultTone: e.target.value as TranslationTone,
                })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="natural">Natural</option>
              <option value="formal">Formal</option>
              <option value="informal">Informal</option>
              <option value="professional">Professional</option>
              <option value="academic">Academic</option>
              <option value="business">Business</option>
              <option value="casual">Casual</option>
              <option value="technical">Technical</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="settings-default-formality"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Default Formality
            </label>
            <select
              id="settings-default-formality"
              value={settings.defaultFormality}
              onChange={(e) =>
                void onUpdateSettings({
                  ...settings,
                  defaultFormality: e.target.value as AppSettings['defaultFormality'],
                })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="default">Standard</option>
              <option value="more_formal">More Formal</option>
              <option value="less_formal">Less Formal</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="settings-tts-voice"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Default Speech Voice
            </label>
            <select
              id="settings-tts-voice"
              value={settings.ttsVoice}
              onChange={(e) =>
                void onUpdateSettings({
                  ...settings,
                  ttsVoice: e.target.value as AppSettings['ttsVoice'],
                })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="Kore">Kore (Balanced)</option>
              <option value="Puck">Puck (Bright)</option>
              <option value="Charon">Charon (Deep)</option>
              <option value="Fenrir">Fenrir (Resonant)</option>
              <option value="Zephyr">Zephyr (Calm)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="settings-tts-speed"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 font-mono tabular-nums"
            >
              Default Speech Speed ({settings.ttsSpeed.toFixed(2)}x)
            </label>
            <input
              id="settings-tts-speed"
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={settings.ttsSpeed}
              onChange={(e) =>
                void onUpdateSettings({
                  ...settings,
                  ttsSpeed: Number(e.target.value),
                })
              }
              className="w-full accent-blue-600 mt-2"
            />
          </div>
        </div>

        <div className="space-y-2.5 pt-2">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoTranslate}
              onChange={(e) =>
                void onUpdateSettings({ ...settings, autoTranslate: e.target.checked })
              }
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span>Automatically translate while typing (debounced)</span>
          </label>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoSaveHistory}
              onChange={(e) =>
                void onUpdateSettings({ ...settings, autoSaveHistory: e.target.checked })
              }
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span>Automatically save completed translations to local IndexedDB history</span>
          </label>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showPrivacyNotice}
              onChange={(e) =>
                void onUpdateSettings({ ...settings, showPrivacyNotice: e.target.checked })
              }
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span>Show AI processing privacy notice in translator workspace</span>
          </label>
        </div>
      </section>

      {/* Translation Provider Architecture */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Translation Engine Providers
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            All provider credentials remain strictly server-side in environment secrets.
          </p>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {providers.map((p) => {
            const isActive = settings.provider === p.id;
            return (
              <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {p.name}{' '}
                    {p.model ? (
                      <span className="text-xs font-mono font-normal text-slate-500 dark:text-slate-400">
                        · {p.model}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{p.note}</p>
                </div>

                <button
                  type="button"
                  disabled={!p.available || isActive}
                  onClick={() => void onUpdateSettings({ ...settings, provider: p.id })}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : p.available
                        ? 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        : 'border border-slate-200 dark:border-slate-800 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {isActive ? 'Active Provider' : p.available ? 'Use Provider' : 'Not Configured'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Reusable Style Profiles */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Saved Translation Style Profiles
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Create reusable tone, formality, writing style, and terminology presets.
          </p>
        </div>

        <form
          onSubmit={handleCreateProfile}
          className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Profile name (e.g. Legal Brief)"
              aria-label="New style profile name"
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            <select
              aria-label="Style profile tone"
              value={profileTone}
              onChange={(e) => setProfileTone(e.target.value as TranslationTone)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              <option value="natural">Natural</option>
              <option value="formal">Formal</option>
              <option value="informal">Informal</option>
              <option value="professional">Professional</option>
              <option value="academic">Academic</option>
              <option value="business">Business</option>
              <option value="casual">Casual</option>
              <option value="technical">Technical</option>
              <option value="custom">Custom Tone</option>
            </select>
            <select
              aria-label="Style profile formality"
              value={profileFormality}
              onChange={(e) =>
                setProfileFormality(e.target.value as StyleProfile['formality'])
              }
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              <option value="default">Standard Formality</option>
              <option value="more_formal">More Formal</option>
              <option value="less_formal">Less Formal</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={writingStyle}
              onChange={(e) => setWritingStyle(e.target.value)}
              placeholder="Writing style (e.g. Active voice, short paragraphs)"
              aria-label="Writing style description"
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={preferredTerms}
              onChange={(e) => setPreferredTerms(e.target.value)}
              placeholder="Preferred terminology notes"
              aria-label="Preferred terminology notes"
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Additional translation instructions..."
              aria-label="Additional style instructions"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Save Profile</span>
            </button>
          </div>
        </form>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {styleProfiles.map((prof) => (
            <div key={prof.id} className="py-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {prof.name}{' '}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    · {prof.tone} · {prof.formality.replace('_', ' ')}
                  </span>
                </p>
                {prof.writingStyle && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    {prof.writingStyle}
                  </p>
                )}
                {prof.customInstructions && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {prof.customInstructions}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => void onDeleteStyleProfile(prof.id)}
                aria-label={`Delete style profile ${prof.name}`}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Extensible Language Registry */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Language Registry Configuration
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            20 core languages are built-in. Add regional variants or additional languages supported by Gemini.
          </p>
        </div>

        <form onSubmit={handleAddCustomLanguage} className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
          <input
            type="text"
            required
            value={newLangCode}
            onChange={(e) => setNewLangCode(e.target.value)}
            placeholder="Code (e.g. sv)"
            aria-label="Language ISO code"
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
          <input
            type="text"
            required
            value={newLangName}
            onChange={(e) => setNewLangName(e.target.value)}
            placeholder="English Name (Swedish)"
            aria-label="Language English name"
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
          <input
            type="text"
            value={newLangNative}
            onChange={(e) => setNewLangNative(e.target.value)}
            placeholder="Native Name (Svenska)"
            aria-label="Language native name"
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
          <input
            type="text"
            value={newLangBcp47}
            onChange={(e) => setNewLangBcp47(e.target.value)}
            placeholder="BCP-47 (sv-SE)"
            aria-label="Language BCP-47 tag"
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
          >
            Add Language
          </button>
        </form>

        {(settings.customLanguages || []).length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(settings.customLanguages || []).map((lang) => (
              <div key={lang.code} className="py-2 flex items-center justify-between text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  {lang.name} ({lang.nativeName}) ·{' '}
                  <span className="font-mono text-xs text-slate-500">{lang.code}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemoveCustomLanguage(lang.code)}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
