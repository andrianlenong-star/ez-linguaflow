import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Download,
  Eye,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { translateImageApi, translateTextApi } from '../lib/api/translatorClient.ts';
import type { LanguageConfig } from '../shared/languages.ts';
import type {
  AppSettings,
  HistoryItem,
  ImageRegion,
  ImageTranslationResult,
} from '../shared/types.ts';
import { validateImageFile } from '../utils/text.ts';
import { LanguageSelector } from './LanguageSelector.tsx';

interface ImageTranslateViewProps {
  settings: AppSettings;
  onSaveHistory?: (item: HistoryItem) => Promise<void>;
}

export function ImageTranslateView({ settings, onSaveHistory }: ImageTranslateViewProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState(settings.defaultSourceLang || 'auto');
  const [targetLang, setTargetLang] = useState(settings.defaultTargetLang || 'id');
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageTranslationResult | null>(null);
  const [editableRegions, setEditableRegions] = useState<ImageRegion[]>([]);
  const [fullOcrText, setFullOcrText] = useState('');
  const [fullTranslatedText, setFullTranslatedText] = useState('');
  const [viewMode, setViewMode] = useState<'translated' | 'original'>('translated');
  const [savedNotice, setSavedNotice] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const extraLanguages: LanguageConfig[] = settings.customLanguages || [];

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setEditableRegions([]);
    setFullOcrText('');
    setFullTranslatedText('');
    setSavedNotice(false);
    const check = validateImageFile(file.name, file.size);
    if (!check.valid) {
      setError(check.error || 'Invalid image file.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFileChange(file);
  }

  async function handleTranslateImage() {
    if (!selectedFile) return;
    setLoading(true);
    setError(null);
    setSavedNotice(false);
    try {
      const res = await translateImageApi({
        file: selectedFile,
        sourceLang,
        targetLang,
      });
      setResult(res);
      setEditableRegions(res.regions);
      setFullOcrText(
        res.fullOriginalText || res.regions.map((r) => r.originalText).filter(Boolean).join('\n'),
      );
      setFullTranslatedText(
        res.fullTranslatedText ||
          res.regions.map((r) => r.translatedText).filter(Boolean).join('\n'),
      );
      setViewMode('translated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image translation failed.');
    } finally {
      setLoading(false);
    }
  }

  function handleRegionOriginalEdit(id: string, newOriginalText: string) {
    setEditableRegions((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, originalText: newOriginalText } : r));
      setFullOcrText(next.map((r) => r.originalText).join('\n'));
      return next;
    });
  }

  function handleRegionEdit(id: string, newTranslatedText: string) {
    setEditableRegions((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, translatedText: newTranslatedText } : r));
      setFullTranslatedText(next.map((r) => r.translatedText).join('\n'));
      return next;
    });
  }

  async function handleRetranslateEditedOcr() {
    if (editableRegions.length === 0 && !fullOcrText.trim()) return;
    setRetranslating(true);
    setError(null);
    setSavedNotice(false);
    try {
      if (editableRegions.length > 0) {
        const updatedRegions = await Promise.all(
          editableRegions.map(async (region) => {
            const clean = region.originalText.trim();
            if (!clean) {
              return { ...region, translatedText: '' };
            }
            const translated = await translateTextApi({
              text: clean,
              sourceLang,
              targetLang,
              tone: settings.defaultTone || 'natural',
              formality: settings.defaultFormality || 'default',
              context: 'OCR image text region',
              provider: settings.provider,
            });
            return { ...region, translatedText: translated.translatedText };
          }),
        );
        setEditableRegions(updatedRegions);
        setFullOcrText(updatedRegions.map((r) => r.originalText).join('\n'));
        setFullTranslatedText(updatedRegions.map((r) => r.translatedText).join('\n'));
      } else {
        const translated = await translateTextApi({
          text: fullOcrText.trim(),
          sourceLang,
          targetLang,
          tone: settings.defaultTone || 'natural',
          formality: settings.defaultFormality || 'default',
          context: 'OCR extracted image text',
          provider: settings.provider,
        });
        setFullTranslatedText(translated.translatedText);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-translate edited OCR text.');
    } finally {
      setRetranslating(false);
    }
  }

  async function handleSaveToHistory() {
    if (!onSaveHistory || !result) return;
    const orig =
      fullOcrText.trim() || editableRegions.map((r) => r.originalText).filter(Boolean).join('\n');
    const trans =
      fullTranslatedText.trim() ||
      editableRegions.map((r) => r.translatedText).filter(Boolean).join('\n');
    if (!orig || !trans) return;

    await onSaveHistory({
      id: crypto.randomUUID(),
      sourceText: `[Image OCR: ${selectedFile?.name || 'image'}]\n${orig}`,
      translatedText: trans,
      sourceLang,
      detectedSourceLang: result.detectedSourceLang,
      targetLang,
      tone: settings.defaultTone || 'natural',
      context: 'Image OCR Translation',
      provider: 'gemini',
      favorite: true,
      saved: true,
      createdAt: Date.now(),
    });
    setSavedNotice(true);
  }

  function handleDownloadText() {
    if (!result) return;
    const lines = [
      `EduZone Linguaflow Image Translation (${selectedFile?.name || 'image'})`,
      `Detected Language: ${result.detectedSourceLang}`,
      '',
      '--- Translated Regions ---',
      ...(editableRegions.length > 0
        ? editableRegions.map(
            (r, i) => `${i + 1}. [Original] ${r.originalText}\n   [Translated] ${r.translatedText}`,
          )
        : [`[Original]\n${fullOcrText}\n\n[Translated]\n${fullTranslatedText}`]),
    ];
    if (result.unreadableSections.length > 0) {
      lines.push('', '--- Unreadable / Unclear Sections ---', ...result.unreadableSections);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFile?.name || 'image'}_translation.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadImagePng() {
    if (!previewUrl || !result) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (const region of editableRegions) {
        const [ymin, xmin, ymax, xmax] = region.box2d;
        if (ymax <= ymin || xmax <= xmin) continue;
        const x = (xmin / 1000) * canvas.width;
        const y = (ymin / 1000) * canvas.height;
        const w = Math.max(40, ((xmax - xmin) / 1000) * canvas.width);
        const h = Math.max(20, ((ymax - ymin) / 1000) * canvas.height);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.75)';
        ctx.lineWidth = Math.max(1, canvas.width * 0.002);
        ctx.strokeRect(x, y, w, h);

        const padX = Math.max(6, Math.round(w * 0.04));
        const maxW = Math.max(16, w - padX * 2);
        let fontSize = Math.max(11, Math.min(26, Math.round(h * 0.5)));
        let lines: string[] = [];

        const wrapLines = (size: number): string[] => {
          ctx.font = `600 ${size}px sans-serif`;
          const words = region.translatedText.trim().split(/\s+/).filter(Boolean);
          if (words.length === 0) return [];
          const out: string[] = [];
          let current = words[0];
          for (let i = 1; i < words.length; i += 1) {
            const candidate = `${current} ${words[i]}`;
            if (ctx.measureText(candidate).width <= maxW) {
              current = candidate;
            } else {
              out.push(current);
              current = words[i];
            }
          }
          out.push(current);
          return out;
        };

        while (fontSize > 10) {
          lines = wrapLines(fontSize);
          if (lines.length * fontSize * 1.2 <= h - 6) break;
          fontSize -= 2;
        }
        if (lines.length === 0) {
          lines = wrapLines(fontSize);
        }

        const lineHeight = fontSize * 1.2;
        const totalTextHeight = lines.length * lineHeight;
        let textY = y + Math.max(lineHeight * 0.5 + 3, (h - totalTextHeight) / 2 + lineHeight * 0.5);

        ctx.font = `600 ${fontSize}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        for (const line of lines) {
          if (textY > y + h - 2) break;
          ctx.fillText(line, x + padX, textY, maxW);
          textY += lineHeight;
        }
      }

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedFile?.name.replace(/\.[^.]+$/, '') || 'image'}_translated.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = previewUrl;
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
                label="Image source language"
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
                label="Image target language"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              aria-label="Upload image for OCR translation"
              onChange={(e) => {
                handleFileChange(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Upload className="w-4 h-4" />
              <span>{selectedFile ? 'Change Image' : 'Upload Image'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleTranslateImage()}
              disabled={!selectedFile || loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loading ? 'Analyzing OCR...' : 'Translate Image'}</span>
            </button>
          </div>
        </div>

        {!previewUrl && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30'
                : 'border-slate-300 dark:border-slate-700 hover:border-blue-500'
            }`}
          >
            <ImageIcon className="w-8 h-8 text-blue-600 dark:text-blue-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Drag and drop or select a JPG, JPEG, PNG, or WEBP image
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Recognizes text regions via multimodal OCR, allows editing extracted text, and displays positioned translation overlays
            </p>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {previewUrl && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Image Canvas with Overlay */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {result
                  ? `Detected: ${result.detectedSourceLang} · ${editableRegions.length} text regions`
                  : selectedFile?.name}
              </span>

              {result && (
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setViewMode('translated')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      viewMode === 'translated'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Translated Overlay
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('original')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      viewMode === 'original'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Original Image
                  </button>
                </div>
              )}
            </div>

            <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
              <img
                src={previewUrl}
                alt={selectedFile?.name || 'Uploaded image preview'}
                className="w-full h-auto block"
              />

              {result &&
                viewMode === 'translated' &&
                editableRegions.map((region) => {
                  const [ymin, xmin, ymax, xmax] = region.box2d;
                  if (ymax <= ymin || xmax <= xmin) return null;
                  return (
                    <div
                      key={region.id}
                      style={{
                        top: `${ymin / 10}%`,
                        left: `${xmin / 10}%`,
                        width: `${Math.max(8, (xmax - xmin) / 10)}%`,
                        minHeight: `${Math.max(4, (ymax - ymin) / 10)}%`,
                      }}
                      title={`Original: ${region.originalText}`}
                      className="absolute z-10 bg-slate-950/95 text-white text-[11px] sm:text-xs leading-snug px-2 py-1 rounded border border-blue-400/60 shadow-sm overflow-hidden flex items-center"
                    >
                      {region.translatedText}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Editable Extracted & Translated Segments */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  OCR & Editable Translation
                </h2>
              </div>
              {result && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleRetranslateEditedOcr()}
                    disabled={retranslating || (editableRegions.length === 0 && !fullOcrText.trim())}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retranslating ? 'animate-spin' : ''}`} />
                    <span>{retranslating ? 'Translating...' : 'Translate Edited OCR'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadImagePng}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadText}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>TXT</span>
                  </button>
                  {onSaveHistory && (
                    <button
                      type="button"
                      onClick={() => void handleSaveToHistory()}
                      disabled={savedNotice}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>{savedNotice ? 'Saved' : 'Save'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!result && !loading && (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                Click &quot;Translate Image&quot; to extract and translate text from this image.
              </p>
            )}

            {result && result.unreadableSections.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Partially Unreadable Areas</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {result.unreadableSections.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            {result && editableRegions.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No bounded text regions were detected, or you can enter/edit OCR text manually below and translate it:
                </p>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                  Extracted OCR Text (Editable)
                </label>
                <textarea
                  aria-label="Edit extracted OCR text"
                  value={fullOcrText}
                  onChange={(e) => setFullOcrText(e.target.value)}
                  rows={3}
                  placeholder="Enter or correct extracted image text..."
                  className="w-full px-2.5 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
                {fullTranslatedText && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Translated Output
                    </label>
                    <textarea
                      aria-label="Translated image text"
                      value={fullTranslatedText}
                      onChange={(e) => setFullTranslatedText(e.target.value)}
                      rows={3}
                      className="w-full px-2.5 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>
            )}

            {result && editableRegions.length > 0 && (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {editableRegions.map((region, idx) => (
                  <div
                    key={region.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Region {idx + 1}</span>
                      <span>Confidence: {region.confidence}</span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                        Extracted OCR Text (Editable)
                      </label>
                      <textarea
                        aria-label={`Edit OCR text for region ${idx + 1}`}
                        value={region.originalText}
                        onChange={(e) => handleRegionOriginalEdit(region.id, e.target.value)}
                        rows={2}
                        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                        Translated Text (Editable)
                      </label>
                      <textarea
                        aria-label={`Edit translation for region ${idx + 1}`}
                        value={region.translatedText}
                        onChange={(e) => handleRegionEdit(region.id, e.target.value)}
                        rows={2}
                        className="w-full px-2.5 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
