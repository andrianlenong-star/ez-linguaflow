import { useRef, useState, type DragEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react';
import { translateDocumentApi } from '../lib/api/translatorClient.ts';
import type { LanguageConfig } from '../shared/languages.ts';
import type {
  AppSettings,
  DocumentTranslationResult,
  Glossary,
  HistoryItem,
  TranslationTone,
} from '../shared/types.ts';
import { validateDocumentFile } from '../utils/text.ts';
import { LanguageSelector } from './LanguageSelector.tsx';

interface DocumentTranslateViewProps {
  settings: AppSettings;
  glossaries: Glossary[];
  onSaveHistory: (item: HistoryItem) => Promise<void>;
}

function downloadBase64File(base64: string, filename: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DocumentTranslateView({
  settings,
  glossaries,
  onSaveHistory,
}: DocumentTranslateViewProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState(settings.defaultSourceLang || 'auto');
  const [targetLang, setTargetLang] = useState(settings.defaultTargetLang || 'id');
  const [tone, setTone] = useState<TranslationTone>(settings.defaultTone || 'professional');
  const [useGlossary, setUseGlossary] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'translating' | 'done'>('idle');
  const [result, setResult] = useState<DocumentTranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedToHistory, setSavedToHistory] = useState(false);
  const [previewMode, setPreviewMode] = useState<'formatted' | 'text'>('formatted');

  const inputRef = useRef<HTMLInputElement>(null);
  const extraLanguages: LanguageConfig[] = settings.customLanguages || [];

  function handleSelectFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setSavedToHistory(false);
    const check = validateDocumentFile(file.name, file.size);
    if (!check.valid) {
      setError(check.error || 'Invalid file.');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleSelectFile(file);
  }

  async function handleTranslateDocument() {
    if (!selectedFile) return;
    setError(null);
    setResult(null);
    setSavedToHistory(false);
    setUploadProgress(0);
    setStage('uploading');

    const activeGlossaryTerms = useGlossary
      ? glossaries
          .filter(
            (g) =>
              g.enabled &&
              g.targetLang.toLowerCase() === targetLang.toLowerCase() &&
              (sourceLang === 'auto' || g.sourceLang.toLowerCase() === sourceLang.toLowerCase()),
          )
          .flatMap((g) =>
            g.terms.map((t) => ({ sourceTerm: t.sourceTerm, targetTerm: t.targetTerm })),
          )
      : [];

    try {
      const res = await translateDocumentApi({
        file: selectedFile,
        sourceLang,
        targetLang,
        tone,
        glossaryTerms: activeGlossaryTerms,
        onUploadProgress: (pct) => {
          setUploadProgress(pct);
          if (pct >= 100) {
            setStage('translating');
          }
        },
      });
      setStage('done');
      setResult(res);
    } catch (err) {
      setStage('idle');
      setError(err instanceof Error ? err.message : 'Document translation failed.');
    }
  }

  async function handleSaveResultToHistory() {
    if (!result) return;
    await onSaveHistory({
      id: crypto.randomUUID(),
      sourceText: `[Document: ${result.originalFilename}]\n${result.originalPreview}`,
      translatedText: result.translatedPreview,
      sourceLang,
      detectedSourceLang: result.detectedSourceLang,
      targetLang,
      tone,
      context: `Document (${result.format.toUpperCase()})`,
      provider: 'gemini',
      favorite: true,
      saved: true,
      createdAt: Date.now(),
    });
    setSavedToHistory(true);
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Source Language
              </span>
              <LanguageSelector
                value={sourceLang}
                onChange={setSourceLang}
                allowAuto
                extraLanguages={extraLanguages}
                label="Document source language"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Target Language
              </span>
              <LanguageSelector
                value={targetLang}
                onChange={setTargetLang}
                extraLanguages={extraLanguages}
                label="Document target language"
              />
            </div>

            <div>
              <label
                htmlFor="doc-tone-select"
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                Translation Style
              </label>
              <select
                id="doc-tone-select"
                value={tone}
                onChange={(e) => setTone(e.target.value as TranslationTone)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-[40px]"
              >
                <option value="natural">Natural</option>
                <option value="professional">Professional</option>
                <option value="formal">Formal</option>
                <option value="business">Business</option>
                <option value="academic">Academic</option>
                <option value="technical">Technical</option>
              </select>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={useGlossary}
              onChange={(e) => setUseGlossary(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Apply active glossaries</span>
          </label>
        </div>

        {/* Drag and Drop Area */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30'
              : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.html,.htm"
            aria-label="Choose document file"
            onChange={(e) => {
              handleSelectFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />

          <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Drag and drop your document here, or browse from device
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Supported: PDF (with OCR for scans), DOCX, PPTX, TXT, HTML · Max 15 MB · Original file stays untouched
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Browse File
            </button>

            {selectedFile && (
              <button
                type="button"
                onClick={() => void handleTranslateDocument()}
                disabled={stage === 'uploading' || stage === 'translating'}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {stage === 'uploading' || stage === 'translating'
                  ? 'Processing Document...'
                  : 'Translate Document'}
              </button>
            )}
          </div>

          {selectedFile && (
            <div className="mt-4 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 font-mono">
              <FileText className="w-4 h-4 text-blue-600" />
              <span>
                {selectedFile.name} · {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
            </div>
          )}
        </div>

        {/* Upload & Translation Progress */}
        {(stage === 'uploading' || stage === 'translating') && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                {stage === 'uploading'
                  ? `Uploading document (${uploadProgress}%)...`
                  : 'Translating document structure and content...'}
              </span>
              <span className="font-mono tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200"
                style={{ width: `${stage === 'translating' ? 100 : uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Translation Ready: {result.downloadFilename}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                Format: {result.format.toUpperCase()} · Segments: {result.segmentCount}
                {result.ocrUsed ? ' · Multimodal OCR applied' : ''}
                {result.preservesLayout ? ' · Native formatting preserved' : ' · Structured export'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadBase64File(
                    result.downloadBase64,
                    result.downloadFilename,
                    result.downloadMimeType,
                  )
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>
                  Download {(result.downloadFilename.split('.').pop() || result.format).toUpperCase()}
                </span>
              </button>

              {result.fallbackTextBase64 && result.fallbackTextDownloadFilename && (
                <button
                  type="button"
                  onClick={() =>
                    downloadBase64File(
                      result.fallbackTextBase64!,
                      result.fallbackTextDownloadFilename!,
                      'text/plain; charset=utf-8',
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Download className="w-4 h-4" />
                  <span>Download TXT</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleSaveResultToHistory()}
                disabled={savedToHistory}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                {savedToHistory ? 'Saved to History' : 'Save to History'}
              </button>
            </div>
          </div>

          {result.limitationNote && (
            <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
              {result.limitationNote}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                Original Content Preview
              </h3>
              <pre className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap font-sans max-h-80 overflow-y-auto">
                {result.originalPreview}
              </pre>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Translated Content Preview
                </h3>
                {result.translatedHtml && (
                  <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
                    <button
                      type="button"
                      onClick={() => setPreviewMode('formatted')}
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        previewMode === 'formatted'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Formatted
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode('text')}
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        previewMode === 'text'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Plain Text
                    </button>
                  </div>
                )}
              </div>
              {result.translatedHtml && previewMode === 'formatted' ? (
                <iframe
                  title="Translated HTML preview"
                  sandbox=""
                  srcDoc={result.translatedHtml}
                  className="w-full h-80 rounded border border-slate-200 dark:border-slate-800 bg-white"
                />
              ) : (
                <pre className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap font-sans max-h-80 overflow-y-auto">
                  {result.translatedPreview}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
