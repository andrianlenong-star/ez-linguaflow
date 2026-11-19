import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { SERVER_CONFIG } from './config.ts';
import { generateContentWithModelFallback } from './providers/geminiProvider.ts';
import { deeplProvider } from './providers/deeplProvider.ts';
import { getLanguageLabel } from '../src/shared/languages.ts';
import { safeParseModelJson } from '../src/utils/text.ts';
import type {
  AppliedGlossaryEntry,
  DocumentTranslationResult,
  TranslationTone,
} from '../src/shared/types.ts';

function getAiClient(timeoutMs = 20_000): GoogleGenAI {
  if (!SERVER_CONFIG.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }
  return new GoogleGenAI({
    apiKey: SERVER_CONFIG.geminiApiKey,
    httpOptions: {
      timeout: Math.max(10_000, timeoutMs),
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function translateBatchSegments(params: {
  segments: string[];
  sourceLang: string;
  targetLang: string;
  tone: TranslationTone;
  context?: string;
  glossaryTerms?: AppliedGlossaryEntry[];
}): Promise<{ translatedSegments: string[]; detectedSourceLang: string }> {
  const ai = getAiClient(18_000);
  const targetLabel = getLanguageLabel(params.targetLang);
  const sourceHint =
    params.sourceLang === 'auto'
      ? 'Automatically detect the source language'
      : `Source language: ${getLanguageLabel(params.sourceLang)}`;

  const glossaryBlock =
    params.glossaryTerms && params.glossaryTerms.length > 0
      ? `\nMandatory Glossary:\n${params.glossaryTerms
          .map((g) => `- "${g.sourceTerm}" => "${g.targetTerm}"`)
          .join('\n')}`
      : '';

  const results: string[] = [];
  let detectedSourceLang = params.sourceLang;
  const BATCH_SIZE = 60;

  for (let i = 0; i < params.segments.length; i += BATCH_SIZE) {
    const chunk = params.segments.slice(i, i + BATCH_SIZE);
    const indexedInput = chunk.map((text, idx) => ({ idx, text }));

    try {
      const { response } = await generateContentWithModelFallback(
        ai,
        {
          contents: `Translate every segment into ${targetLabel}. ${sourceHint}. Tone: ${params.tone}. ${
            params.context ? `Context: ${params.context}.` : ''
          }${glossaryBlock}\n\nSegments JSON:\n${JSON.stringify(indexedInput)}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'You are a precision document translator. Return the exact same number of segments in the exact same order, preserving leading/trailing whitespace if meaningful, numbers, dates, and formatting markers. Never merge or omit segments.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detectedSourceLang: { type: Type.STRING },
                translations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      idx: { type: Type.INTEGER },
                      text: { type: Type.STRING },
                    },
                    required: ['idx', 'text'],
                  },
                },
              },
              required: ['detectedSourceLang', 'translations'],
            },
          },
        },
        { fallbackTimeoutMs: 18_000 },
      );

      const parsed = safeParseModelJson<{
        detectedSourceLang?: string;
        translations?: Array<{ idx: number; text: string }>;
      }>(response.text || '{}');

      if (parsed.detectedSourceLang) {
        detectedSourceLang = parsed.detectedSourceLang;
      }

      const translatedMap = new Map<number, string>();
      for (const item of parsed.translations || []) {
        translatedMap.set(item.idx, item.text);
      }

      for (let j = 0; j < chunk.length; j += 1) {
        results.push(translatedMap.get(j) ?? chunk[j]);
      }
    } catch (err) {
      if (!deeplProvider.isConfigured()) {
        throw err;
      }
      const sep = '\n<<<LF_SEG>>>\n';
      const joinedRes = await deeplProvider.translate({
        text: chunk.join(sep),
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        tone: params.tone,
      });
      if (joinedRes.detectedSourceLang) {
        detectedSourceLang = joinedRes.detectedSourceLang;
      }
      const splitParts = joinedRes.translatedText.split(/\n?<<<LF_SEG>>>\n?/);
      for (let j = 0; j < chunk.length; j += 1) {
        results.push((splitParts[j] ?? chunk[j]).trim());
      }
    }
  }

  return { translatedSegments: results, detectedSourceLang };
}

function buildOutputFilename(originalFilename: string, targetLang: string, extOverride?: string): string {
  const dot = originalFilename.lastIndexOf('.');
  const base = dot > 0 ? originalFilename.slice(0, dot) : originalFilename;
  const ext = extOverride || (dot > 0 ? originalFilename.slice(dot + 1) : 'txt');
  return `${base}_${targetLang}.${ext}`;
}

export async function processDocumentTranslation(params: {
  buffer: Buffer;
  filename: string;
  ext: string;
  sourceLang: string;
  targetLang: string;
  tone: TranslationTone;
  context?: string;
  glossaryTerms?: AppliedGlossaryEntry[];
}): Promise<DocumentTranslationResult> {
  const ext = params.ext.toLowerCase();

  if (ext === 'txt') {
    const rawText = params.buffer.toString('utf8');
    const paragraphs = rawText.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) {
      throw new Error('The uploaded TXT file contains no translatable text.');
    }
    const { translatedSegments, detectedSourceLang } = await translateBatchSegments({
      segments: paragraphs,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      tone: params.tone,
      context: params.context,
      glossaryTerms: params.glossaryTerms,
    });
    const translatedText = translatedSegments.join('\n\n');
    return {
      originalFilename: params.filename,
      format: 'txt',
      detectedSourceLang,
      originalPreview: rawText.slice(0, 6000),
      translatedPreview: translatedText.slice(0, 6000),
      downloadFilename: buildOutputFilename(params.filename, params.targetLang, 'txt'),
      downloadMimeType: 'text/plain; charset=utf-8',
      downloadBase64: Buffer.from(translatedText, 'utf8').toString('base64'),
      preservesLayout: true,
      ocrUsed: false,
      segmentCount: paragraphs.length,
    };
  }

  if (ext === 'html' || ext === 'htm') {
    const rawHtml = params.buffer.toString('utf8');
    if (!rawHtml.trim()) {
      throw new Error('The uploaded HTML file contains no translatable content.');
    }
    const ai = getAiClient();
    const targetLabel = getLanguageLabel(params.targetLang);
    const sourceHint =
      params.sourceLang === 'auto'
        ? 'Automatically detect the source language'
        : `Source language: ${getLanguageLabel(params.sourceLang)}`;
    const glossaryBlock =
      params.glossaryTerms && params.glossaryTerms.length > 0
        ? `\nMandatory Glossary:\n${params.glossaryTerms
            .map((g) => `- "${g.sourceTerm}" => "${g.targetTerm}"`)
            .join('\n')}`
        : '';

    let detectedSourceLang: string | undefined;
    let translatedHtml = rawHtml;
    let plainTextPreview = '';

    try {
      const { response } = await generateContentWithModelFallback(ai, {
        contents: `Translate all visible text in this HTML document into ${targetLabel}. ${sourceHint}. Tone: ${params.tone}. ${
          params.context ? `Context: ${params.context}.` : ''
        } Preserve every HTML tag, structure, table, list, bold/italic markup, and attributes without altering CSS or scripts.${glossaryBlock}\n\n${rawHtml}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedSourceLang: { type: Type.STRING },
              translatedHtml: { type: Type.STRING },
              plainTextPreview: { type: Type.STRING },
            },
            required: ['detectedSourceLang', 'translatedHtml', 'plainTextPreview'],
          },
        },
      });

      const parsed = safeParseModelJson<{
        detectedSourceLang?: string;
        translatedHtml?: string;
        plainTextPreview?: string;
      }>(response.text || '{}');
      detectedSourceLang = parsed.detectedSourceLang;
      translatedHtml = parsed.translatedHtml || rawHtml;
      plainTextPreview =
        parsed.plainTextPreview ||
        translatedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (err) {
      if (!deeplProvider.isConfigured()) {
        throw err;
      }
      const plainInput = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const fallback = await deeplProvider.translate({
        text: plainInput,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        tone: params.tone,
      });
      detectedSourceLang = fallback.detectedSourceLang;
      plainTextPreview = fallback.translatedText;
      translatedHtml = `<!doctype html><html lang="${params.targetLang}"><head><meta charset="utf-8" /></head><body><p>${escapeXml(fallback.translatedText)}</p></body></html>`;
    }

    if (!/charset=/i.test(translatedHtml)) {
      if (/<head[^>]*>/i.test(translatedHtml)) {
        translatedHtml = translatedHtml.replace(
          /<head([^>]*)>/i,
          '<head$1>\n<meta charset="utf-8" />',
        );
      } else {
        translatedHtml = `<!doctype html>\n<html lang="${params.targetLang}">\n<head><meta charset="utf-8" /></head>\n<body>\n${translatedHtml}\n</body>\n</html>`;
      }
    }

    return {
      originalFilename: params.filename,
      format: 'html',
      detectedSourceLang,
      originalPreview: rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000),
      translatedPreview: plainTextPreview.slice(0, 6000),
      translatedHtml,
      downloadFilename: buildOutputFilename(params.filename, params.targetLang, 'html'),
      downloadMimeType: 'text/html; charset=utf-8',
      downloadBase64: Buffer.from(translatedHtml, 'utf8').toString('base64'),
      preservesLayout: true,
      ocrUsed: false,
      segmentCount: 1,
    };
  }

  if (ext === 'docx') {
    const zip = await JSZip.loadAsync(params.buffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('Invalid DOCX structure: missing word/document.xml.');
    }

    const originalXml = await docXmlFile.async('string');
    const mammothResult = await mammoth.extractRawText({ buffer: params.buffer });
    const originalPlain = mammothResult.value.trim();

    // Extract non-empty <w:t> runs while keeping XML markup intact
    const runRegex = /(<w:t(?:\s+[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
    const segments: string[] = [];
    const matches: Array<{ full: string; open: string; rawInner: string; close: string }> = [];

    let m: RegExpExecArray | null;
    while ((m = runRegex.exec(originalXml)) !== null) {
      const textVal = unescapeXml(m[2]);
      if (textVal.trim().length > 0) {
        segments.push(textVal);
        matches.push({ full: m[0], open: m[1], rawInner: m[2], close: m[3] });
      }
    }

    if (segments.length === 0) {
      throw new Error('No translatable text found inside this DOCX file.');
    }

    const { translatedSegments, detectedSourceLang } = await translateBatchSegments({
      segments,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      tone: params.tone,
      context: params.context,
      glossaryTerms: params.glossaryTerms,
    });

    let segIndex = 0;
    const updatedXml = originalXml.replace(runRegex, (full, open: string, rawInner: string, close: string) => {
      const decoded = unescapeXml(rawInner);
      if (decoded.trim().length === 0) return full;
      const translated = translatedSegments[segIndex] ?? decoded;
      segIndex += 1;
      const spaceAttr = open.includes('xml:space') ? open : open.replace('<w:t', '<w:t xml:space="preserve"');
      return `${spaceAttr}${escapeXml(translated)}${close}`;
    });

    zip.file('word/document.xml', updatedXml);
    const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const translatedPreview = translatedSegments.join(' ').replace(/\s+/g, ' ').trim();

    return {
      originalFilename: params.filename,
      format: 'docx',
      detectedSourceLang,
      originalPreview: originalPlain.slice(0, 6000),
      translatedPreview: translatedPreview.slice(0, 6000),
      downloadFilename: buildOutputFilename(params.filename, params.targetLang, 'docx'),
      downloadMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      downloadBase64: outBuffer.toString('base64'),
      fallbackTextDownloadFilename: buildOutputFilename(params.filename, params.targetLang, 'txt'),
      fallbackTextBase64: Buffer.from(translatedPreview, 'utf8').toString('base64'),
      preservesLayout: true,
      limitationNote:
        'Paragraph styles, bold/italic runs, tables, and lists in word/document.xml were preserved. Embedded images or text inside vector SmartArt graphics are not modified.',
      ocrUsed: false,
      segmentCount: segments.length,
    };
  }

  if (ext === 'pptx') {
    const zip = await JSZip.loadAsync(params.buffer);
    const slidePaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const numA = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
        const numB = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
        return numA - numB;
      });

    if (slidePaths.length === 0) {
      throw new Error('Invalid PPTX file: no slides found.');
    }

    const slideData: Array<{ path: string; xml: string; segments: string[] }> = [];
    const allSegments: string[] = [];
    const runRegex = /(<a:t(?:\s+[^>]*)?>)([\s\S]*?)(<\/a:t>)/g;

    for (const slidePath of slidePaths) {
      const xml = await zip.file(slidePath)!.async('string');
      const segs: string[] = [];
      let m: RegExpExecArray | null;
      runRegex.lastIndex = 0;
      while ((m = runRegex.exec(xml)) !== null) {
        const textVal = unescapeXml(m[2]);
        if (textVal.trim().length > 0) {
          segs.push(textVal);
          allSegments.push(textVal);
        }
      }
      slideData.push({ path: slidePath, xml, segments: segs });
    }

    if (allSegments.length === 0) {
      throw new Error('No translatable text found in PPTX slides.');
    }

    const { translatedSegments, detectedSourceLang } = await translateBatchSegments({
      segments: allSegments,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      tone: params.tone,
      context: params.context,
      glossaryTerms: params.glossaryTerms,
    });

    let globalIdx = 0;
    const translatedPreviewParts: string[] = [];
    const originalPreviewParts: string[] = [];

    for (let sIdx = 0; sIdx < slideData.length; sIdx += 1) {
      const slide = slideData[sIdx];
      const slideOrig: string[] = [];
      const slideTrans: string[] = [];

      const updatedXml = slide.xml.replace(
        runRegex,
        (full, open: string, rawInner: string, close: string) => {
          const decoded = unescapeXml(rawInner);
          if (decoded.trim().length === 0) return full;
          const translated = translatedSegments[globalIdx] ?? decoded;
          globalIdx += 1;
          slideOrig.push(decoded);
          slideTrans.push(translated);
          const spaceAttr = open.includes('xml:space')
            ? open
            : open.replace('<a:t', '<a:t xml:space="preserve"');
          return `${spaceAttr}${escapeXml(translated)}${close}`;
        },
      );

      zip.file(slide.path, updatedXml);
      if (slideOrig.length > 0) {
        originalPreviewParts.push(`Slide ${sIdx + 1}:\n${slideOrig.join(' ')}`);
        translatedPreviewParts.push(`Slide ${sIdx + 1}:\n${slideTrans.join(' ')}`);
      }
    }

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const translatedPreview = translatedPreviewParts.join('\n\n');

    return {
      originalFilename: params.filename,
      format: 'pptx',
      detectedSourceLang,
      originalPreview: originalPreviewParts.join('\n\n').slice(0, 6000),
      translatedPreview: translatedPreview.slice(0, 6000),
      downloadFilename: buildOutputFilename(params.filename, params.targetLang, 'pptx'),
      downloadMimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      downloadBase64: outBuffer.toString('base64'),
      fallbackTextDownloadFilename: buildOutputFilename(params.filename, params.targetLang, 'txt'),
      fallbackTextBase64: Buffer.from(translatedPreview, 'utf8').toString('base64'),
      preservesLayout: true,
      limitationNote:
        'Slide structure, themes, and text formatting were preserved in the exported PPTX. Longer translated text may require manual text-box resizing in PowerPoint.',
      ocrUsed: false,
      segmentCount: allSegments.length,
    };
  }

  if (ext === 'pdf') {
    const ai = getAiClient();
    const targetLabel = getLanguageLabel(params.targetLang);
    const sourceHint =
      params.sourceLang === 'auto'
        ? 'Automatically detect the source language'
        : `Source language: ${getLanguageLabel(params.sourceLang)}`;
    const glossaryBlock =
      params.glossaryTerms && params.glossaryTerms.length > 0
        ? `\nMandatory Glossary:\n${params.glossaryTerms
            .map((g) => `- "${g.sourceTerm}" => "${g.targetTerm}"`)
            .join('\n')}`
        : '';

    const { response } = await generateContentWithModelFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: params.buffer.toString('base64'),
            },
          },
          {
            text: `Extract all text from this PDF (including scanned pages via OCR if applicable) and translate it accurately into ${targetLabel}. ${sourceHint}. Tone: ${params.tone}. ${
              params.context ? `Context: ${params.context}.` : ''
            }${glossaryBlock}\n\nPreserve headings, paragraphs, tables, numbered/bulleted lists, page numbers, bold, and italic formatting inside clean semantic HTML (using <h1>-<h3>, <p>, <table>, <ol>, <ul>, <strong>, <em>). Never invent unreadable text; mark illegible scans clearly.`,
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedSourceLang: { type: Type.STRING },
            ocrUsed: { type: Type.BOOLEAN },
            originalPlainText: { type: Type.STRING },
            translatedPlainText: { type: Type.STRING },
            translatedHtmlBody: { type: Type.STRING },
            pageCountEstimate: { type: Type.INTEGER },
          },
          required: [
            'detectedSourceLang',
            'ocrUsed',
            'originalPlainText',
            'translatedPlainText',
            'translatedHtmlBody',
          ],
        },
      },
    });

    const parsed = safeParseModelJson<{
      detectedSourceLang?: string;
      ocrUsed?: boolean;
      originalPlainText?: string;
      translatedPlainText?: string;
      translatedHtmlBody?: string;
      pageCountEstimate?: number;
    }>(response.text || '{}');

    const htmlDocument = `<!doctype html>
<html lang="${params.targetLang}">
<head>
<meta charset="utf-8" />
<title>${escapeXml(params.filename)} (${params.targetLang})</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 24px; line-height: 1.6; color: #0f172a; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
  th { background: #f8fafc; }
</style>
</head>
<body>
${parsed.translatedHtmlBody || `<p>${escapeXml(parsed.translatedPlainText || '')}</p>`}
</body>
</html>`;

    const plainText = parsed.translatedPlainText || '';

    return {
      originalFilename: params.filename,
      format: 'pdf',
      detectedSourceLang: parsed.detectedSourceLang,
      originalPreview: (parsed.originalPlainText || '').slice(0, 6000),
      translatedPreview: plainText.slice(0, 6000),
      translatedHtml: parsed.translatedHtmlBody || '',
      downloadFilename: buildOutputFilename(params.filename, params.targetLang, 'html'),
      downloadMimeType: 'text/html; charset=utf-8',
      downloadBase64: Buffer.from(htmlDocument, 'utf8').toString('base64'),
      fallbackTextDownloadFilename: buildOutputFilename(params.filename, params.targetLang, 'txt'),
      fallbackTextBase64: Buffer.from(plainText, 'utf8').toString('base64'),
      preservesLayout: false,
      limitationNote:
        'PDF documents (including scanned PDFs processed via multimodal OCR) are reconstructed as structured HTML (preserving headings, tables, lists, and emphasis) and plain text. Exact fixed binary PDF page layout is not reflowed into a PDF file.',
      ocrUsed: Boolean(parsed.ocrUsed),
      segmentCount: parsed.pageCountEstimate || 1,
    };
  }

  throw new Error(`Unsupported document format: .${ext}`);
}
