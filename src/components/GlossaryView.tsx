import { useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Download,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { getLanguageLabel, type LanguageConfig } from '../shared/languages.ts';
import type { Glossary, GlossaryTerm } from '../shared/types.ts';
import { exportGlossaryToCsv, parseGlossaryCsv } from '../utils/glossary.ts';
import { LanguageSelector } from './LanguageSelector.tsx';

interface GlossaryViewProps {
  glossaries: Glossary[];
  extraLanguages: LanguageConfig[];
  onSaveGlossary: (glossary: Glossary) => Promise<void>;
  onDeleteGlossary: (id: string) => Promise<void>;
}

export function GlossaryView({
  glossaries,
  extraLanguages,
  onSaveGlossary,
  onDeleteGlossary,
}: GlossaryViewProps) {
  const [selectedId, setSelectedId] = useState<string>(glossaries[0]?.id || '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSourceLang, setNewSourceLang] = useState('en');
  const [newTargetLang, setNewTargetLang] = useState('id');

  const [editingMeta, setEditingMeta] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSourceLang, setEditSourceLang] = useState('en');
  const [editTargetLang, setEditTargetLang] = useState('id');

  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [editTermSource, setEditTermSource] = useState('');
  const [editTermTarget, setEditTermTarget] = useState('');
  const [editTermNotes, setEditTermNotes] = useState('');

  const [sourceTerm, setSourceTerm] = useState('');
  const [targetTerm, setTargetTerm] = useState('');
  const [termNotes, setTermNotes] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);

  const activeGlossary =
    glossaries.find((g) => g.id === selectedId) || glossaries[0] || null;

  function selectGlossary(id: string) {
    setSelectedId(id);
    setEditingMeta(false);
    setEditingTermId(null);
    setFormError(null);
    setImportMessage(null);
  }

  async function handleCreateGlossary(e: FormEvent) {
    e.preventDefault();
    const cleanName = newName.trim();
    if (!cleanName) {
      setFormError('Glossary name cannot be empty.');
      return;
    }
    if (glossaries.some((g) => g.name.trim().toLowerCase() === cleanName.toLowerCase())) {
      setFormError(`A glossary named "${cleanName}" already exists.`);
      return;
    }
    setFormError(null);
    const glossary: Glossary = {
      id: crypto.randomUUID(),
      name: cleanName,
      sourceLang: newSourceLang,
      targetLang: newTargetLang,
      enabled: true,
      terms: [],
      updatedAt: Date.now(),
    };
    await onSaveGlossary(glossary);
    selectGlossary(glossary.id);
    setNewName('');
    setCreating(false);
  }

  async function handleToggleEnabled(glossary: Glossary) {
    await onSaveGlossary({
      ...glossary,
      enabled: !glossary.enabled,
      updatedAt: Date.now(),
    });
  }

  async function handleAddTerm(e: FormEvent) {
    e.preventDefault();
    if (!activeGlossary) return;
    const cleanSource = sourceTerm.trim();
    const cleanTarget = targetTerm.trim();
    if (!cleanSource || !cleanTarget) {
      setFormError('Both source term and preferred translation are required.');
      return;
    }
    const isDuplicate = activeGlossary.terms.some(
      (t) => t.sourceTerm.trim().toLowerCase() === cleanSource.toLowerCase(),
    );
    if (isDuplicate) {
      setFormError(`Term "${cleanSource}" already exists in "${activeGlossary.name}".`);
      return;
    }
    setFormError(null);
    const term: GlossaryTerm = {
      id: crypto.randomUUID(),
      sourceTerm: cleanSource,
      targetTerm: cleanTarget,
      ...(termNotes.trim() ? { notes: termNotes.trim() } : {}),
    };
    await onSaveGlossary({
      ...activeGlossary,
      terms: [term, ...activeGlossary.terms],
      updatedAt: Date.now(),
    });
    setSourceTerm('');
    setTargetTerm('');
    setTermNotes('');
  }

  async function handleDeleteTerm(termId: string) {
    if (!activeGlossary) return;
    if (editingTermId === termId) setEditingTermId(null);
    setFormError(null);
    await onSaveGlossary({
      ...activeGlossary,
      terms: activeGlossary.terms.filter((t) => t.id !== termId),
      updatedAt: Date.now(),
    });
  }

  async function handleSaveGlossaryMeta() {
    if (!activeGlossary) return;
    const cleanName = editName.trim();
    if (!cleanName) {
      setFormError('Glossary name cannot be empty.');
      return;
    }
    setFormError(null);
    await onSaveGlossary({
      ...activeGlossary,
      name: cleanName,
      sourceLang: editSourceLang,
      targetLang: editTargetLang,
      updatedAt: Date.now(),
    });
    setEditingMeta(false);
  }

  async function handleSaveEditedTerm() {
    if (!activeGlossary || !editingTermId) return;
    const cleanSource = editTermSource.trim();
    const cleanTarget = editTermTarget.trim();
    if (!cleanSource || !cleanTarget) {
      setFormError('Both source term and preferred translation are required.');
      return;
    }
    const isDuplicate = activeGlossary.terms.some(
      (t) =>
        t.id !== editingTermId &&
        t.sourceTerm.trim().toLowerCase() === cleanSource.toLowerCase(),
    );
    if (isDuplicate) {
      setFormError(`Duplicate term "${cleanSource}" already exists in "${activeGlossary.name}".`);
      return;
    }
    setFormError(null);
    await onSaveGlossary({
      ...activeGlossary,
      terms: activeGlossary.terms.map((t) =>
        t.id === editingTermId
          ? {
              ...t,
              sourceTerm: cleanSource,
              targetTerm: cleanTarget,
              notes: editTermNotes.trim() || undefined,
            }
          : t,
      ),
      updatedAt: Date.now(),
    });
    setEditingTermId(null);
  }

  async function handleImportCsv(file: File | undefined) {
    if (!file || !activeGlossary) return;
    setFormError(null);
    const text = await file.text();
    const parsed = parseGlossaryCsv(text);
    if (parsed.length === 0) {
      setImportMessage('No valid rows found. CSV must contain "source,target" columns.');
      return;
    }
    const existingKeys = new Set(activeGlossary.terms.map((t) => t.sourceTerm.trim().toLowerCase()));
    const newTerms: GlossaryTerm[] = parsed
      .filter((row) => !existingKeys.has(row.sourceTerm.trim().toLowerCase()))
      .map((row) => ({ id: crypto.randomUUID(), ...row }));
    const skippedCount = parsed.length - newTerms.length;

    if (newTerms.length > 0) {
      await onSaveGlossary({
        ...activeGlossary,
        terms: [...newTerms, ...activeGlossary.terms],
        updatedAt: Date.now(),
      });
    }
    setImportMessage(
      skippedCount > 0
        ? `Imported ${newTerms.length} new terms into "${activeGlossary.name}" (skipped ${skippedCount} duplicates).`
        : `Imported ${newTerms.length} new terms into "${activeGlossary.name}".`,
    );
  }

  function handleExportCsv() {
    if (!activeGlossary) return;
    const csv = exportGlossaryToCsv(activeGlossary.terms);
    const blob = new Blob([csv], { type: 'text/csv; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeGlossary.name.toLowerCase().replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Glossary List */}
      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Custom Glossaries
          </h2>
          <button
            type="button"
            onClick={() => setCreating((prev) => !prev)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Glossary</span>
          </button>
        </div>

        {creating && (
          <form
            onSubmit={handleCreateGlossary}
            className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 space-y-3"
          >
            <div>
              <label
                htmlFor="new-glossary-name"
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                Glossary Name
              </label>
              <input
                id="new-glossary-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Legal Terminology"
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <LanguageSelector
                value={newSourceLang}
                onChange={setNewSourceLang}
                extraLanguages={extraLanguages}
                label="Glossary source language"
              />
              <span className="text-xs text-slate-400">→</span>
              <LanguageSelector
                value={newTargetLang}
                onChange={setNewTargetLang}
                extraLanguages={extraLanguages}
                label="Glossary target language"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </form>
        )}

        {glossaries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
            No glossaries yet. Create one to enforce consistent terminology during translation.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {glossaries.map((g) => {
              const isSelected = activeGlossary?.id === g.id;
              return (
                <div
                  key={g.id}
                  className={`py-3 px-2.5 rounded-lg transition-colors ${
                    isSelected ? 'bg-blue-50/70 dark:bg-blue-950/40' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => selectGlossary(g.id)}
                      className="text-left flex-1 min-w-0"
                    >
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {g.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                        {getLanguageLabel(g.sourceLang, extraLanguages)} →{' '}
                        {getLanguageLabel(g.targetLang, extraLanguages)} · {g.terms.length} terms
                      </p>
                    </button>

                    <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer shrink-0 pt-0.5">
                      <input
                        type="checkbox"
                        checked={g.enabled}
                        aria-label={`Enable glossary ${g.name}`}
                        onChange={() => void handleToggleEnabled(g)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <span className="text-slate-600 dark:text-slate-300">
                        {g.enabled ? 'On' : 'Off'}
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Glossary Terms Editor */}
      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
        {!activeGlossary ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Select or create a glossary to manage terms.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 flex-wrap">
                {editingMeta ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label="Edit glossary name"
                      className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <LanguageSelector
                      value={editSourceLang}
                      onChange={setEditSourceLang}
                      extraLanguages={extraLanguages}
                      label="Edit glossary source language"
                    />
                    <span className="text-xs text-slate-400">→</span>
                    <LanguageSelector
                      value={editTargetLang}
                      onChange={setEditTargetLang}
                      extraLanguages={extraLanguages}
                      label="Edit glossary target language"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveGlossaryMeta()}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMeta(false)}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
                        {activeGlossary.name}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {getLanguageLabel(activeGlossary.sourceLang, extraLanguages)} →{' '}
                        {getLanguageLabel(activeGlossary.targetLang, extraLanguages)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Edit ${activeGlossary.name}`}
                      onClick={() => {
                        setEditName(activeGlossary.name);
                        setEditSourceLang(activeGlossary.sourceLang);
                        setEditTargetLang(activeGlossary.targetLang);
                        setEditingMeta(true);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Import CSV glossary"
                  onChange={(e) => {
                    void handleImportCsv(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={activeGlossary.terms.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const deletingId = activeGlossary.id;
                    setEditingMeta(false);
                    setEditingTermId(null);
                    setFormError(null);
                    setImportMessage(null);
                    void onDeleteGlossary(deletingId);
                  }}
                  aria-label={`Delete glossary ${activeGlossary.name}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {formError && (
              <p
                role="alert"
                className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3 py-2 rounded-lg"
              >
                {formError}
              </p>
            )}

            {importMessage && (
              <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 rounded-lg">
                {importMessage}
              </p>
            )}

            {/* Add Term Form */}
            <form onSubmit={handleAddTerm} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                required
                value={sourceTerm}
                onChange={(e) => setSourceTerm(e.target.value)}
                placeholder={`Source term (${getLanguageLabel(activeGlossary.sourceLang)})`}
                aria-label="Source glossary term"
                className="sm:col-span-4 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <input
                type="text"
                required
                value={targetTerm}
                onChange={(e) => setTargetTerm(e.target.value)}
                placeholder={`Preferred translation (${getLanguageLabel(activeGlossary.targetLang)})`}
                aria-label="Target glossary translation"
                className="sm:col-span-4 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <input
                type="text"
                value={termNotes}
                onChange={(e) => setTermNotes(e.target.value)}
                placeholder="Notes (optional)"
                aria-label="Glossary term notes"
                className="sm:col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="sm:col-span-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
              >
                Add Term
              </button>
            </form>

            {/* Terms Table */}
            {activeGlossary.terms.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                No terms in this glossary yet. Add terms above or import a CSV file.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 pr-4">Source Term</th>
                      <th className="py-2.5 pr-4">Preferred Translation</th>
                      <th className="py-2.5 pr-4">Notes</th>
                      <th className="py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {activeGlossary.terms.map((term) => {
                      const isEditing = editingTermId === term.id;
                      return (
                        <tr
                          key={term.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-slate-100">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editTermSource}
                                onChange={(e) => setEditTermSource(e.target.value)}
                                aria-label="Edit source term"
                                className="w-full px-2 py-1 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                              />
                            ) : (
                              term.sourceTerm
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-blue-700 dark:text-blue-300 font-medium">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editTermTarget}
                                onChange={(e) => setEditTermTarget(e.target.value)}
                                aria-label="Edit target translation"
                                className="w-full px-2 py-1 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                              />
                            ) : (
                              term.targetTerm
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editTermNotes}
                                onChange={(e) => setEditTermNotes(e.target.value)}
                                aria-label="Edit term notes"
                                className="w-full px-2 py-1 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                              />
                            ) : (
                              term.notes || '—'
                            )}
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            {isEditing ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEditedTerm()}
                                  aria-label="Save term changes"
                                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTermId(null)}
                                  aria-label="Cancel term edit"
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTermId(term.id);
                                    setEditTermSource(term.sourceTerm);
                                    setEditTermTarget(term.targetTerm);
                                    setEditTermNotes(term.notes || '');
                                  }}
                                  aria-label={`Edit term ${term.sourceTerm}`}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteTerm(term.id)}
                                  aria-label={`Delete term ${term.sourceTerm}`}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
