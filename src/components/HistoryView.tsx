import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import {
  getLanguageLabel,
  SUPPORTED_LANGUAGES,
  type LanguageConfig,
} from '../shared/languages.ts';
import type { HistoryItem } from '../shared/types.ts';

interface HistoryViewProps {
  history: HistoryItem[];
  extraLanguages: LanguageConfig[];
  onToggleFavorite: (item: HistoryItem) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onReopenTranslation: (item: HistoryItem) => void;
}

export function HistoryView({
  history,
  extraLanguages,
  onToggleFavorite,
  onDeleteItem,
  onClearAll,
  onReopenTranslation,
}: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'favorites'>('all');
  const [langFilter, setLangFilter] = useState('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const allLanguages = useMemo(
    () => [...SUPPORTED_LANGUAGES, ...extraLanguages],
    [extraLanguages],
  );

  const favoritesCount = useMemo(
    () => history.filter((item) => item.favorite || item.saved).length,
    [history],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return history.filter((item) => {
      if (filterTab === 'favorites' && !item.favorite && !item.saved) return false;
      if (
        langFilter !== 'all' &&
        item.sourceLang !== langFilter &&
        item.targetLang !== langFilter &&
        item.detectedSourceLang !== langFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.sourceText.toLowerCase().includes(q) ||
        item.translatedText.toLowerCase().includes(q) ||
        (item.context || '').toLowerCase().includes(q)
      );
    });
  }, [history, searchQuery, filterTab, langFilter]);

  async function handleCopy(item: HistoryItem) {
    try {
      setCopyError(null);
      await navigator.clipboard.writeText(item.translatedText);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopyError('Clipboard write permission was denied by browser.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filterTab === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              All History ({history.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('favorites')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filterTab === 'favorites'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Saved & Favorites ({favoritesCount})
            </button>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search translations..."
              aria-label="Search translation history"
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            aria-label="Filter history by language"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Languages</option>
            {allLanguages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={() => void onClearAll()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap self-start md:self-auto"
          >
            Clear All History
          </button>
        )}
      </div>

      {copyError && (
        <div
          role="alert"
          className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300"
        >
          {copyError}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {history.length === 0
              ? 'No translation history recorded yet. Completed translations are saved locally in IndexedDB.'
              : 'No history items match your current search or filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((item) => (
            <div key={item.id} className="p-4 sm:p-5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {getLanguageLabel(item.detectedSourceLang || item.sourceLang, extraLanguages)} →{' '}
                  {getLanguageLabel(item.targetLang, extraLanguages)} · {item.tone}
                  {item.context ? ` · ${item.context}` : ''} ·{' '}
                  {new Date(item.createdAt).toLocaleString()}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void onToggleFavorite(item)}
                    aria-label={item.favorite ? 'Remove from favorites' : 'Mark as favorite'}
                    className={`p-1.5 rounded-lg transition-colors ${
                      item.favorite
                        ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                        : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Star className="w-4 h-4" fill={item.favorite ? 'currentColor' : 'none'} />
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopy(item)}
                    aria-label="Copy saved translation"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {copiedId === item.id ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onReopenTranslation(item)}
                    aria-label="Reopen in Translate Text"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                  >
                    <span>Open</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void onDeleteItem(item.id)}
                    aria-label="Delete history entry"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap line-clamp-4">
                  {item.sourceText}
                </p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 whitespace-pre-wrap line-clamp-4">
                  {item.translatedText}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
