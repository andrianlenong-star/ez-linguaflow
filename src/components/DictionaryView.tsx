import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Loader2, Search, Square, Volume2, X } from 'lucide-react';
import { lookupDictionaryApi } from '../lib/api/translatorClient.ts';
import type { PlaybackStatus } from '../lib/audio/ttsPlayer.ts';
import type { DictionaryEntry } from '../shared/types.ts';
import type { LanguageConfig } from '../shared/languages.ts';
import { LanguageSelector } from './LanguageSelector.tsx';

interface DictionaryContentProps {
  initialWord?: string;
  initialContext?: string;
  sourceLang: string;
  targetLang: string;
  extraLanguages: LanguageConfig[];
  playbackStatus?: PlaybackStatus;
  onSpeak?: (text: string, lang: string) => void;
  onStopSpeak?: () => void;
  onClose?: () => void;
  compact?: boolean;
}

export function DictionaryLookupPanel({
  initialWord = '',
  initialContext = '',
  sourceLang: defaultSourceLang,
  targetLang: defaultTargetLang,
  extraLanguages,
  playbackStatus = 'idle',
  onSpeak,
  onStopSpeak,
  onClose,
  compact = false,
}: DictionaryContentProps) {
  const [word, setWord] = useState(initialWord);
  const [contextSentence, setContextSentence] = useState(initialContext);
  const [sourceLang, setSourceLang] = useState(defaultSourceLang);
  const [targetLang, setTargetLang] = useState(defaultTargetLang);
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runLookup(targetWord: string, ctx?: string) {
    const clean = targetWord.trim();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const result = await lookupDictionaryApi({
        word: clean,
        sentenceContext: (ctx ?? contextSentence).trim() || undefined,
        sourceLang,
        targetLang,
      });
      setEntry(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to look up dictionary entry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialWord.trim()) {
      setWord(initialWord);
      setContextSentence(initialContext);
      void runLookup(initialWord, initialContext);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWord, initialContext]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runLookup(word, contextSentence);
  }

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl ${
        compact ? 'p-4 sm:p-5' : 'p-6'
      }`}
    >
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Contextual Dictionary
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dictionary panel"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSelector
            value={sourceLang}
            onChange={setSourceLang}
            allowAuto
            extraLanguages={extraLanguages}
            label="Dictionary source language"
          />
          <span className="text-slate-400 text-sm">to</span>
          <LanguageSelector
            value={targetLang}
            onChange={setTargetLang}
            extraLanguages={extraLanguages}
            label="Dictionary target language"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="Enter a word or phrase..."
              aria-label="Word or phrase to look up"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !word.trim()}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {loading ? 'Looking up...' : 'Look Up'}
          </button>
        </div>

        <div>
          <label
            htmlFor="dict-context-input"
            className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
          >
            Sentence context (optional — ensures context-accurate meaning)
          </label>
          <input
            id="dict-context-input"
            type="text"
            value={contextSentence}
            onChange={(e) => setContextSentence(e.target.value)}
            placeholder="Paste the sentence where the word appears..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-4 p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <span>Analyzing contextual meaning...</span>
        </div>
      )}

      {!loading && !entry && !error && (
        <div className="mt-6 py-8 text-center border-t border-slate-100 dark:border-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search any word above—or click a word inside your translation—to inspect contextual definitions, synonyms, antonyms, and bilingual examples.
          </p>
        </div>
      )}

      {!loading && entry && (
        <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">
                  {entry.word}
                </h3>
                {entry.pronunciation && (
                  <span className="text-sm font-mono text-slate-500 dark:text-slate-400">
                    /{entry.pronunciation}/
                  </span>
                )}
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  · {entry.partOfSpeech}
                </span>
              </div>
              <p className="mt-1 text-base font-semibold text-blue-600 dark:text-blue-400">
                {entry.contextualTranslation}
              </p>
            </div>

            {onSpeak && (
              playbackStatus === 'playing' || playbackStatus === 'loading' ? (
                <button
                  type="button"
                  onClick={() => onStopSpeak?.()}
                  aria-label="Stop pronunciation"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>{playbackStatus === 'loading' ? 'Loading...' : 'Stop'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    onSpeak(
                      (entry.word || word || '').trim(),
                      entry.detectedLanguage || (sourceLang === 'auto' ? 'en' : sourceLang),
                    )
                  }
                  aria-label={`Pronounce ${entry.word}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Listen</span>
                </button>
              )
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Definition in Context
            </h4>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              {entry.definition}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                Synonyms
              </h4>
              {(entry.synonyms || []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(entry.synonyms || []).map((syn) => (
                    <button
                      key={syn}
                      type="button"
                      onClick={() => {
                        setWord(syn);
                        void runLookup(syn);
                      }}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline text-left"
                    >
                      {syn}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">None listed</p>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                Antonyms
              </h4>
              {(entry.antonyms || []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(entry.antonyms || []).map((ant) => (
                    <button
                      key={ant}
                      type="button"
                      onClick={() => {
                        setWord(ant);
                        void runLookup(ant);
                      }}
                      className="text-sm text-slate-700 dark:text-slate-300 hover:underline text-left"
                    >
                      {ant}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Not applicable</p>
              )}
            </div>
          </div>

          {(entry.usageAlternatives || []).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                Contextual Alternatives
              </h4>
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {(entry.usageAlternatives || []).join(' · ')}
              </p>
            </div>
          )}

          {(entry.examples || []).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                Example Sentences
              </h4>
              <ul className="space-y-2.5 divide-y divide-slate-100 dark:divide-slate-800">
                {(entry.examples || []).map((ex, i) => (
                  <li key={i} className={i > 0 ? 'pt-2.5' : ''}>
                    <p className="text-sm text-slate-800 dark:text-slate-100">{ex.source}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{ex.target}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
