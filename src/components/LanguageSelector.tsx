import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  AUTO_DETECT_CODE,
  getLanguageByCode,
  searchLanguages,
  type LanguageConfig,
} from '../shared/languages.ts';

interface LanguageSelectorProps {
  value: string;
  onChange: (code: string) => void;
  allowAuto?: boolean;
  detectedCode?: string;
  extraLanguages?: LanguageConfig[];
  label: string;
  id?: string;
}

export function LanguageSelector({
  value,
  onChange,
  allowAuto = false,
  detectedCode,
  extraLanguages = [],
  label,
  id,
}: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      setTimeout(() => searchRef.current?.focus(), 20);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const filtered = useMemo(
    () => searchLanguages(query, extraLanguages),
    [query, extraLanguages],
  );

  const selectedConfig =
    value === AUTO_DETECT_CODE ? undefined : getLanguageByCode(value, extraLanguages);

  const detectedConfig =
    detectedCode && detectedCode !== AUTO_DETECT_CODE
      ? getLanguageByCode(detectedCode, extraLanguages)
      : undefined;

  const displayLabel =
    value === AUTO_DETECT_CODE
      ? detectedConfig
        ? `Auto Detect (${detectedConfig.name})`
        : 'Auto Detect'
      : selectedConfig
        ? selectedConfig.name
        : value;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        id={id}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
      >
        <span className="truncate max-w-[200px]">{displayLabel}</span>
        <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={`${label} options`}
          className="absolute left-0 z-40 mt-2 w-72 sm:w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden"
        >
          <div className="p-2.5 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search language..."
                aria-label="Search language"
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
            {allowAuto && (
              <button
                type="button"
                role="option"
                aria-selected={value === AUTO_DETECT_CODE}
                onClick={() => {
                  onChange(AUTO_DETECT_CODE);
                  setOpen(false);
                  setQuery('');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg text-left transition-colors ${
                  value === AUTO_DETECT_CODE
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>Auto Detect Language</span>
                {value === AUTO_DETECT_CODE && <Check className="w-4 h-4 shrink-0" />}
              </button>
            )}

            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400 text-center">
                No languages match "{query}"
              </div>
            ) : (
              filtered.map((lang) => {
                const isSelected = lang.code === value;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(lang.code);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">
                      {lang.name}{' '}
                      <span className="text-slate-400 dark:text-slate-500 font-normal">
                        {lang.nativeName !== lang.name ? `· ${lang.nativeName}` : ''}
                      </span>
                    </span>
                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
