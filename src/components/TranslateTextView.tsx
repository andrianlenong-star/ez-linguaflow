import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bookmark,
  BookOpen,
  Check,
  ClipboardPaste,
  Copy,
  Loader2,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import {
  fetchAlternativesApi,
  translateTextApi,
} from '../lib/api/translatorClient.ts';
import type { PlaybackStatus } from '../lib/audio/ttsPlayer.ts';
import {
  AUTO_DETECT_CODE,
  getLanguageLabel,
  isRtlLanguage,
  type LanguageConfig,
} from '../shared/languages.ts';
import type {
  AlternativeTranslation,
  AppSettings,
  AppliedGlossaryEntry,
  Glossary,
  HistoryItem,
  ProviderId,
  StyleProfile,
  TranslationTone,
} from '../shared/types.ts';
import { findApplicableGlossaryTerms } from '../utils/glossary.ts';
import { countCharacters, countWords, tokenizeClickableText } from '../utils/text.ts';
import { DictionaryLookupPanel } from './DictionaryView.tsx';
import { LanguageSelector } from './LanguageSelector.tsx';

interface TranslateTextViewProps {
  settings: AppSettings;
  settingsHydrated: boolean;
  glossaries: Glossary[];
  styleProfiles: StyleProfile[];
  playbackStatus: PlaybackStatus;
  initialDraft?: {
    draftKey?: number;
    sourceText: string;
    translatedText: string;
    sourceLang: string;
    detectedSourceLang?: string;
    targetLang: string;
    tone: TranslationTone;
    context?: string;
  } | null;
  onSaveHistory: (item: HistoryItem) => Promise<void>;
  onSpeakText: (text: string, langCode: string) => void;
  onStopSpeak: () => void;
  onNavigateView: (view: 'glossary' | 'settings') => void;
}

const TONE_OPTIONS: Array<{ value: TranslationTone; label: string }> = [
  { value: 'natural', label: 'Natural' },
  { value: 'formal', label: 'Formal' },
  { value: 'informal', label: 'Informal' },
  { value: 'professional', label: 'Professional' },
  { value: 'academic', label: 'Academic' },
  { value: 'business', label: 'Business' },
  { value: 'casual', label: 'Casual' },
  { value: 'technical', label: 'Technical' },
  { value: 'custom', label: 'Custom Tone' },
];

const CONTEXT_PRESETS = [
  'Daily conversation',
  'Business email',
  'Legal document',
  'Academic paper',
  'Technical documentation',
];

const MAX_SOURCE_CHARS = 50000;

export function TranslateTextView({
  settings,
  settingsHydrated,
  glossaries,
  styleProfiles,
  playbackStatus,
  initialDraft,
  onSaveHistory,
  onSpeakText,
  onStopSpeak,
  onNavigateView,
}: TranslateTextViewProps) {
  const [sourceLang, setSourceLang] = useState(
    initialDraft?.sourceLang || settings.defaultSourceLang || AUTO_DETECT_CODE,
  );
  const [targetLang, setTargetLang] = useState(
    initialDraft?.targetLang || settings.defaultTargetLang || 'id',
  );
  const [sourceText, setSourceText] = useState(initialDraft?.sourceText || '');
  const [translatedText, setTranslatedText] = useState(initialDraft?.translatedText || '');
  const [detectedSourceLang, setDetectedSourceLang] = useState<string | undefined>(undefined);
  const [tone, setTone] = useState<TranslationTone>(
    initialDraft?.tone || settings.defaultTone || 'natural',
  );
  const [formality, setFormality] = useState(settings.defaultFormality || 'default');
  const [customToneDescription, setCustomToneDescription] = useState('');
  const [context, setContext] = useState(initialDraft?.context || '');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [useGlossary, setUseGlossary] = useState(true);
  const [autoTranslate, setAutoTranslate] = useState(settings.autoTranslate);

  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertaintyNotice, setUncertaintyNotice] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const [alternatives, setAlternatives] = useState<AlternativeTranslation[]>([]);
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);
  const [alternativesError, setAlternativesError] = useState<string | null>(null);

  const [inspectWordMode, setInspectWordMode] = useState(false);
  const [dictionaryQuery, setDictionaryQuery] = useState<{
    word: string;
    sentence: string;
    lang: string;
  } | null>(null);

  const [privacyDismissed, setPrivacyDismissed] = useState(false);
  const [activeSpeechSide, setActiveSpeechSide] = useState<'source' | 'target' | 'dictionary' | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoTranslateTimerRef = useRef<number | null>(null);
  const lastSavedKeyRef = useRef<string>('');
  const lastCompletedKeyRef = useRef<string>('');
  const lastProviderUsedRef = useRef<ProviderId>(settings.provider);
  const lastSavedEntryRef = useRef<{
    id: string;
    key: string;
    provider: ProviderId;
    createdAt: number;
  } | null>(null);
  const appliedHydrationRef = useRef(false);

  useEffect(() => {
    if (playbackStatus === 'idle') {
      setActiveSpeechSide(null);
    }
  }, [playbackStatus]);

  useEffect(() => {
    if (!settingsHydrated || appliedHydrationRef.current || initialDraft) return;
    appliedHydrationRef.current = true;
    setSourceLang(settings.defaultSourceLang || AUTO_DETECT_CODE);
    setTargetLang(settings.defaultTargetLang || 'id');
    setTone(settings.defaultTone || 'natural');
    setFormality(settings.defaultFormality || 'default');
    setAutoTranslate(settings.autoTranslate);
    lastProviderUsedRef.current = settings.provider;
  }, [settingsHydrated, settings, initialDraft]);

  useEffect(() => {
    if (initialDraft) {
      if (autoTranslateTimerRef.current !== null) {
        window.clearTimeout(autoTranslateTimerRef.current);
        autoTranslateTimerRef.current = null;
      }
      abortControllerRef.current?.abort();
      const draftCtx = (initialDraft.context || '').trim();
      const draftGlossary = useGlossary
        ? findApplicableGlossaryTerms(
            initialDraft.sourceText,
            glossaries,
            initialDraft.sourceLang,
            initialDraft.targetLang,
          )
        : [];
      lastCompletedKeyRef.current = JSON.stringify({
        t: initialDraft.sourceText.trim(),
        s: initialDraft.sourceLang,
        d: initialDraft.targetLang,
        tone: initialDraft.tone,
        f: formality,
        c: draftCtx,
        ct: initialDraft.tone === 'custom' ? customToneDescription.trim() : '',
        p: selectedProfileId,
        g: draftGlossary,
        pr: settings.provider,
      });
      lastSavedKeyRef.current = `${initialDraft.sourceLang}|${initialDraft.targetLang}|${initialDraft.sourceText.trim()}|${initialDraft.translatedText}`;
      setSourceText(initialDraft.sourceText);
      setTranslatedText(initialDraft.translatedText);
      setSourceLang(initialDraft.sourceLang);
      setDetectedSourceLang(initialDraft.detectedSourceLang);
      setTargetLang(initialDraft.targetLang);
      setTone(initialDraft.tone);
      setContext(draftCtx);
      setError(null);
      setUncertaintyNotice(undefined);
      setAlternatives([]);
      setAlternativesError(null);
      setIsTranslating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  const extraLanguages: LanguageConfig[] = settings.customLanguages || [];

  const activeProfile = useMemo(
    () => styleProfiles.find((p) => p.id === selectedProfileId),
    [styleProfiles, selectedProfileId],
  );

  const matchedGlossaryTerms: AppliedGlossaryEntry[] = useMemo(() => {
    if (!useGlossary) return [];
    return findApplicableGlossaryTerms(sourceText, glossaries, sourceLang, targetLang);
  }, [useGlossary, sourceText, glossaries, sourceLang, targetLang]);

  const enabledGlossariesCount = useMemo(
    () => glossaries.filter((g) => g.enabled).length,
    [glossaries],
  );

  function handleApplyProfile(profileId: string) {
    setSelectedProfileId(profileId);
    const prof = styleProfiles.find((p) => p.id === profileId);
    if (prof) {
      setTone(prof.tone);
      setFormality(prof.formality);
    }
  }

  function buildRequestKey(textToTranslate: string): string {
    return JSON.stringify({
      t: textToTranslate.trim(),
      s: sourceLang,
      d: targetLang,
      tone,
      f: formality,
      c: context.trim(),
      ct: tone === 'custom' ? customToneDescription.trim() : '',
      p: selectedProfileId,
      g: useGlossary ? matchedGlossaryTerms : [],
      pr: settings.provider,
    });
  }

  async function executeTranslate(textToTranslate: string, saveToHistory = true) {
    if (autoTranslateTimerRef.current !== null) {
      window.clearTimeout(autoTranslateTimerRef.current);
      autoTranslateTimerRef.current = null;
    }
    const trimmed = textToTranslate.trim();
    if (!trimmed) {
      setTranslatedText('');
      setDetectedSourceLang(undefined);
      setAlternatives([]);
      setUncertaintyNotice(undefined);
      lastCompletedKeyRef.current = '';
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranslating(true);
    setError(null);
    setUncertaintyNotice(undefined);

    try {
      const result = await translateTextApi(
        {
          text: textToTranslate,
          sourceLang,
          targetLang,
          tone,
          formality,
          context: context.trim() || undefined,
          customToneDescription:
            tone === 'custom' ? customToneDescription.trim() || undefined : undefined,
          styleProfile: activeProfile
            ? {
                writingStyle: activeProfile.writingStyle,
                preferredTerminology: activeProfile.preferredTerminology,
                customInstructions: activeProfile.customInstructions,
              }
            : undefined,
          glossaryTerms: matchedGlossaryTerms,
          provider: settings.provider,
        },
        controller.signal,
      );

      if (abortControllerRef.current !== controller || controller.signal.aborted) return;

      lastCompletedKeyRef.current = buildRequestKey(textToTranslate);
      lastProviderUsedRef.current = result.providerUsed;
      setTranslatedText(result.translatedText);
      setDetectedSourceLang(result.detectedSourceLang);
      setUncertaintyNotice(result.uncertaintyNotice);

      if (saveToHistory && settings.autoSaveHistory && result.translatedText.trim()) {
        const dedupKey = `${sourceLang}|${targetLang}|${trimmed}|${result.translatedText}`;
        if (lastSavedKeyRef.current !== dedupKey) {
          lastSavedKeyRef.current = dedupKey;
          const entryId = crypto.randomUUID();
          const createdAt = Date.now();
          lastSavedEntryRef.current = {
            id: entryId,
            key: dedupKey,
            provider: result.providerUsed,
            createdAt,
          };
          await onSaveHistory({
            id: entryId,
            sourceText: textToTranslate,
            translatedText: result.translatedText,
            sourceLang,
            detectedSourceLang: result.detectedSourceLang,
            targetLang,
            tone,
            context: context.trim() || undefined,
            provider: result.providerUsed,
            favorite: false,
            saved: false,
            createdAt,
          });
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || abortControllerRef.current !== controller) return;
      lastCompletedKeyRef.current = '';
      setError(err instanceof Error ? err.message : 'Translation failed.');
    } finally {
      if (abortControllerRef.current === controller) {
        setIsTranslating(false);
      }
    }
  }

  // Debounced auto-translate when typing
  useEffect(() => {
    if (!autoTranslate) return;
    if (!sourceText.trim()) {
      setTranslatedText('');
      setDetectedSourceLang(undefined);
      setAlternatives([]);
      lastCompletedKeyRef.current = '';
      return;
    }
    const candidateKey = buildRequestKey(sourceText);
    if (lastCompletedKeyRef.current === candidateKey && translatedText.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      autoTranslateTimerRef.current = null;
      void executeTranslate(sourceText, true);
    }, 1050);
    autoTranslateTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autoTranslateTimerRef.current === timer) {
        autoTranslateTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourceText,
    sourceLang,
    targetLang,
    tone,
    customToneDescription,
    formality,
    context,
    selectedProfileId,
    useGlossary,
    autoTranslate,
    settings.provider,
  ]);

  async function handleLoadAlternatives() {
    if (!sourceText.trim()) return;
    setLoadingAlternatives(true);
    setAlternativesError(null);
    try {
      const resp = await fetchAlternativesApi({
        text: sourceText.slice(0, 4000),
        sourceLang,
        targetLang,
        tone,
        context: context.trim() || undefined,
        provider: settings.provider,
      });
      setAlternatives(resp.alternatives);
    } catch (err) {
      setAlternativesError(
        err instanceof Error ? err.message : 'Failed to load alternative translations.',
      );
    } finally {
      setLoadingAlternatives(false);
    }
  }

  function handleSwapLanguages() {
    const resolvedSource =
      sourceLang === AUTO_DETECT_CODE ? detectedSourceLang || 'en' : sourceLang;
    if (resolvedSource === targetLang) return;
    const prevSourceText = sourceText;
    const prevTranslatedText = translatedText;

    setSourceLang(targetLang);
    setTargetLang(resolvedSource);
    setDetectedSourceLang(undefined);
    setAlternatives([]);
    lastCompletedKeyRef.current = '';

    if (prevTranslatedText.trim()) {
      setSourceText(prevTranslatedText);
      setTranslatedText(prevSourceText);
    }
  }

  async function handlePaste() {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) {
        if (clip.length > MAX_SOURCE_CHARS) {
          setSourceText(clip.slice(0, MAX_SOURCE_CHARS));
          setError(`Pasted text exceeded ${MAX_SOURCE_CHARS.toLocaleString()} characters and was trimmed to the maximum supported length.`);
        } else {
          setError(null);
          setSourceText(clip);
        }
      }
    } catch {
      setError('Clipboard read permission was denied by browser. Please use Ctrl/Cmd+V.');
    }
  }

  async function handleCopy() {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Failed to copy translation to clipboard.');
    }
  }

  async function handleBookmarkTranslation() {
    if (!sourceText.trim() || !translatedText.trim()) return;
    const dedupKey = `${sourceLang}|${targetLang}|${sourceText.trim()}|${translatedText}`;
    const existing =
      lastSavedEntryRef.current && lastSavedEntryRef.current.key === dedupKey
        ? lastSavedEntryRef.current
        : null;
    const entryId = existing?.id || crypto.randomUUID();
    const createdAt = existing?.createdAt || Date.now();
    const provider = existing?.provider || lastProviderUsedRef.current || settings.provider;
    lastSavedEntryRef.current = { id: entryId, key: dedupKey, provider, createdAt };
    lastSavedKeyRef.current = dedupKey;

    await onSaveHistory({
      id: entryId,
      sourceText,
      translatedText,
      sourceLang,
      detectedSourceLang,
      targetLang,
      tone,
      context: context.trim() || undefined,
      provider,
      favorite: true,
      saved: true,
      createdAt,
      updatedAt: Date.now(),
    });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  }

  function handleClear() {
    if (autoTranslateTimerRef.current !== null) {
      window.clearTimeout(autoTranslateTimerRef.current);
      autoTranslateTimerRef.current = null;
    }
    abortControllerRef.current?.abort();
    lastCompletedKeyRef.current = '';
    setIsTranslating(false);
    setSourceText('');
    setTranslatedText('');
    setDetectedSourceLang(undefined);
    setAlternatives([]);
    setAlternativesError(null);
    setUncertaintyNotice(undefined);
    setError(null);
  }

  const clickableTargetTokens = useMemo(
    () => tokenizeClickableText(translatedText),
    [translatedText],
  );
  const clickableSourceTokens = useMemo(
    () => tokenizeClickableText(sourceText),
    [sourceText],
  );

  const sourceRtl = isRtlLanguage(detectedSourceLang || sourceLang, extraLanguages);
  const targetRtl = isRtlLanguage(targetLang, extraLanguages);

  return (
    <div className="space-y-5">
      {/* Privacy disclosure notice */}
      {settings.showPrivacyNotice && !privacyDismissed && (
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-300">
          <span>
            Text sent for translation is processed server-side via{' '}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              {settings.provider === 'deepl' ? 'DeepL Official API' : 'Gemini AI'}
            </strong>{' '}
            and is never stored permanently on our servers.
          </span>
          <button
            type="button"
            onClick={() => setPrivacyDismissed(true)}
            className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 font-medium whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Style, Tone, Context & Glossary Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[150px] flex-1 sm:flex-initial">
            <label
              htmlFor="tone-select"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Tone & Register
            </label>
            <select
              id="tone-select"
              value={tone}
              onChange={(e) => setTone(e.target.value as TranslationTone)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[150px] flex-1 sm:flex-initial">
            <label
              htmlFor="formality-select"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Formality
            </label>
            <select
              id="formality-select"
              value={formality}
              onChange={(e) => setFormality(e.target.value as AppSettings['defaultFormality'])}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="default">Standard</option>
              <option value="more_formal">More Formal</option>
              <option value="less_formal">Less Formal</option>
            </select>
          </div>

          <div className="min-w-[170px] flex-1 sm:flex-initial">
            <label
              htmlFor="profile-select"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Style Profile
            </label>
            <select
              id="profile-select"
              value={selectedProfileId}
              onChange={(e) => handleApplyProfile(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">None (Manual settings)</option>
              {styleProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[220px]">
            <label
              htmlFor="context-input"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Translation Context
            </label>
            <input
              id="context-input"
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. Executive email, legal contract, casual chat..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-3 pb-1">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={useGlossary}
                onChange={(e) => setUseGlossary(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>
                Glossary ({enabledGlossariesCount} active)
              </span>
            </label>

            <button
              type="button"
              onClick={() => onNavigateView('glossary')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Manage
            </button>
          </div>
        </div>

        {tone === 'custom' && (
          <div>
            <label
              htmlFor="custom-tone-input"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Custom Tone Instructions
            </label>
            <input
              id="custom-tone-input"
              type="text"
              value={customToneDescription}
              onChange={(e) => setCustomToneDescription(e.target.value)}
              placeholder="Describe exact tone, e.g. Warm empathetic customer support with concise sentences"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Quick context:</span>
          {CONTEXT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setContext(preset)}
              className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
                context === preset
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Main Dual-Pane Translation Workbench */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Language Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
          <div className="flex items-center gap-2 flex-wrap">
            <LanguageSelector
              id="source-language-select"
              value={sourceLang}
              onChange={setSourceLang}
              allowAuto
              detectedCode={detectedSourceLang}
              extraLanguages={extraLanguages}
              label="Source language"
            />

            <button
              type="button"
              onClick={handleSwapLanguages}
              aria-label="Swap source and target languages"
              title="Swap languages"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>

            <LanguageSelector
              id="target-language-select"
              value={targetLang}
              onChange={setTargetLang}
              extraLanguages={extraLanguages}
              label="Target language"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={autoTranslate}
                onChange={(e) => setAutoTranslate(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Auto-translate</span>
            </label>

            <button
              type="button"
              onClick={() => setInspectWordMode((prev) => !prev)}
              aria-pressed={inspectWordMode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                inspectWordMode
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>{inspectWordMode ? 'Word Inspector: On' : 'Inspect Words'}</span>
            </button>
          </div>
        </div>

        {/* Two Panes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Source Pane */}
          <div className="flex flex-col min-h-[300px] sm:min-h-[340px] p-4 sm:p-5">
            {inspectWordMode && sourceText ? (
              <div
                dir={sourceRtl ? 'rtl' : 'ltr'}
                className="flex-1 text-base leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words"
              >
                {clickableSourceTokens.map((tok, idx) =>
                  tok.isWord ? (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setDictionaryQuery({
                          word: tok.text,
                          sentence: tok.sentence,
                          lang: detectedSourceLang || sourceLang,
                        })
                      }
                      className="inline rounded-[2px] hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted decoration-slate-300 dark:decoration-slate-600 cursor-pointer"
                    >
                      {tok.text}
                    </button>
                  ) : (
                    <span key={idx}>{tok.text}</span>
                  ),
                )}
              </div>
            ) : (
              <textarea
                id="source-text-input"
                aria-label="Source text to translate"
                value={sourceText}
                maxLength={MAX_SOURCE_CHARS}
                dir={sourceRtl ? 'rtl' : 'ltr'}
                onChange={(e) => setSourceText(e.target.value.slice(0, MAX_SOURCE_CHARS))}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void executeTranslate(sourceText, true);
                  }
                }}
                placeholder="Enter or paste text to translate... (Ctrl/Cmd + Enter)"
                className="flex-1 w-full resize-none bg-transparent text-base leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
              />
            )}

            {matchedGlossaryTerms.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  Active glossary matches:
                </span>{' '}
                {matchedGlossaryTerms.map((g) => `${g.sourceTerm} → ${g.targetTerm}`).join(' · ')}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handlePaste()}
                  aria-label="Paste from clipboard"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Paste</span>
                </button>
                {activeSpeechSide === 'source' &&
                (playbackStatus === 'playing' || playbackStatus === 'loading') ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSpeechSide(null);
                      onStopSpeak();
                    }}
                    aria-label="Stop listening to text"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>{playbackStatus === 'loading' ? 'Loading...' : 'Stop'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSpeechSide('source');
                      onSpeakText(sourceText, detectedSourceLang || sourceLang);
                    }}
                    disabled={!sourceText.trim()}
                    aria-label="Listen to source text"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={!sourceText && !translatedText}
                  aria-label="Clear translation text"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-mono tabular-nums ${
                    countCharacters(sourceText) >= MAX_SOURCE_CHARS
                      ? 'text-red-600 dark:text-red-400 font-semibold'
                      : countCharacters(sourceText) >= 48000
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {countCharacters(sourceText).toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()} chars · {countWords(sourceText)} words
                </span>
                <button
                  type="button"
                  onClick={() => void executeTranslate(sourceText, true)}
                  disabled={isTranslating || !sourceText.trim()}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {isTranslating ? 'Translating...' : 'Translate'}
                </button>
              </div>
            </div>
          </div>

          {/* Target Pane */}
          <div className="flex flex-col min-h-[300px] sm:min-h-[340px] p-4 sm:p-5 bg-slate-50/40 dark:bg-slate-950/30">
            <div className="flex-1">
              {isTranslating && !translatedText ? (
                <div className="space-y-3 pt-1" aria-live="polite">
                  <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Translating...</span>
                  </div>
                  <div className="space-y-2.5 animate-pulse">
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-5/6" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-4/6" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
                  </div>
                </div>
              ) : translatedText ? (
                <div
                  dir={targetRtl ? 'rtl' : 'ltr'}
                  data-testid="translation-output"
                  className="text-base leading-relaxed text-slate-900 dark:text-slate-50 whitespace-pre-wrap break-words"
                >
                  {clickableTargetTokens.map((tok, idx) =>
                    tok.isWord ? (
                      <button
                        key={idx}
                        type="button"
                        title="Click to inspect word in Context Dictionary"
                        onClick={() =>
                          setDictionaryQuery({
                            word: tok.text,
                            sentence: tok.sentence,
                            lang: targetLang,
                          })
                        }
                        className={`inline rounded-[2px] cursor-pointer transition-colors ${
                          inspectWordMode
                            ? 'underline decoration-dotted decoration-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                            : 'hover:bg-blue-50 dark:hover:bg-blue-950/60'
                        }`}
                      >
                        {tok.text}
                      </button>
                    ) : (
                      <span key={idx}>{tok.text}</span>
                    ),
                  )}
                </div>
              ) : (
                <p className="text-base text-slate-400 dark:text-slate-500">
                  Translation will appear here. Click any translated word to inspect its contextual dictionary entry.
                </p>
              )}
            </div>

            {uncertaintyNotice && (
              <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uncertaintyNotice}</span>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!translatedText}
                  aria-label="Copy translated text"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                {activeSpeechSide === 'target' &&
                (playbackStatus === 'playing' || playbackStatus === 'loading') ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSpeechSide(null);
                      onStopSpeak();
                    }}
                    aria-label="Stop listening to translated text"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>{playbackStatus === 'loading' ? 'Loading...' : 'Stop'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSpeechSide('target');
                      onSpeakText(translatedText, targetLang);
                    }}
                    disabled={!translatedText}
                    aria-label="Listen to translated text"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleBookmarkTranslation()}
                  disabled={!translatedText}
                  aria-label="Save translation to favorites"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>{savedToast ? 'Saved' : 'Save'}</span>
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
                {isTranslating && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
                <span>{countCharacters(translatedText).toLocaleString()} chars</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Alternative Translations Section */}
      {translatedText && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Alternative Translations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Compare phrasing nuances and click any alternative to replace the main translation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleLoadAlternatives()}
              disabled={loadingAlternatives}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              {loadingAlternatives ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              )}
              <span>
                {alternatives.length > 0 ? 'Refresh Alternatives' : 'Show Alternatives'}
              </span>
            </button>
          </div>

          {alternativesError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{alternativesError}</p>
          )}

          {alternatives.length > 0 && (
            <div
              data-testid="alternatives-list"
              className="mt-4 divide-y divide-slate-100 dark:divide-slate-800"
            >
              {alternatives.map((alt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setTranslatedText(alt.translation)}
                  className="w-full text-left py-3 px-2 -mx-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {alt.translation}
                    </p>
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                      {alt.formalityLevel}
                      {alt.isMostNatural ? ' · Most natural' : ''}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {alt.nuanceDifference} · Context: {alt.usageContext}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inline Context Dictionary Inspector when a word is clicked */}
      {dictionaryQuery && (
        <DictionaryLookupPanel
          key={`${dictionaryQuery.word}-${dictionaryQuery.sentence}`}
          initialWord={dictionaryQuery.word}
          initialContext={dictionaryQuery.sentence}
          sourceLang={dictionaryQuery.lang}
          targetLang={
            dictionaryQuery.lang === targetLang
              ? detectedSourceLang || (sourceLang === AUTO_DETECT_CODE ? 'en' : sourceLang)
              : targetLang
          }
          extraLanguages={extraLanguages}
          playbackStatus={activeSpeechSide === 'dictionary' ? playbackStatus : 'idle'}
          onSpeak={(txt, lang) => {
            setActiveSpeechSide('dictionary');
            onSpeakText(txt, lang);
          }}
          onStopSpeak={() => {
            setActiveSpeechSide(null);
            onStopSpeak();
          }}
          onClose={() => setDictionaryQuery(null)}
          compact
        />
      )}
    </div>
  );
}
