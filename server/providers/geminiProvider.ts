import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { SERVER_CONFIG } from '../config.ts';
import { getLanguageLabel } from '../../src/shared/languages.ts';
import { safeParseModelJson } from '../../src/utils/text.ts';
import type {
  AlternativesResponse,
  DetectLanguageResult,
  DictionaryEntry,
  ImageTranslationResult,
  TranslationRequest,
  TranslationResult,
} from '../../src/shared/types.ts';
import type { TranslationProvider } from './types.ts';

const ttsCache = new Map<string, { base64Wav: string; mimeType: string; expiresAt: number }>();
const TTS_CACHE_MAX = 40;
const TTS_CACHE_TTL_MS = 15 * 60_000;

let geminiCooldownUntil = 0;
let primaryModelCooldownUntil = 0;
let ttsLiteCooldownUntil = 0;
let transcribePrimaryUnavailable = false;

export function isGeminiInCooldown(now = Date.now()): boolean {
  return now < geminiCooldownUntil;
}

export function markGeminiCooldown(durationMs = 120_000, now = Date.now()): void {
  geminiCooldownUntil = now + durationMs;
}

export function clearGeminiCooldown(): void {
  geminiCooldownUntil = 0;
}

export function isPrimaryModelInCooldown(now = Date.now()): boolean {
  return now < primaryModelCooldownUntil;
}

export function markPrimaryModelCooldown(durationMs = 90_000, now = Date.now()): void {
  primaryModelCooldownUntil = now + durationMs;
}

export function clearPrimaryModelCooldown(): void {
  primaryModelCooldownUntil = 0;
}

function getAiClient(apiVersion?: string, timeoutMs = 25_000): GoogleGenAI {
  if (!SERVER_CONFIG.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }
  // Gemini API rejects explicit server deadlines shorter than 10s with 400 INVALID_ARGUMENT.
  const safeTimeoutMs = Math.max(10_000, timeoutMs);
  return new GoogleGenAI({
    apiKey: SERVER_CONFIG.geminiApiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      timeout: safeTimeoutMs,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isFallbackEligibleError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429') ||
    msg.includes('free_tier_requests') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.toLowerCase().includes('aborted') ||
    msg.toLowerCase().includes('timed out')
  );
}

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        (msg.includes('503') || msg.includes('UNAVAILABLE')) &&
        !msg.includes('RESOURCE_EXHAUSTED') &&
        !msg.includes('free_tier_requests') &&
        !msg.includes('PerDay');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function generateContentWithModelFallback(
  ai: GoogleGenAI,
  request: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'> & { model?: string },
  options?: { maxRetries?: number; apiVersion?: string; fallbackTimeoutMs?: number },
) {
  const primaryModel = request.model || SERVER_CONFIG.geminiModel;
  const maxRetries = options?.maxRetries ?? 0;
  const fallbackTimeoutMs = options?.fallbackTimeoutMs ?? 20_000;

  const buildLiteFallbackRequest = () => ({
    ...request,
    config: request.config
      ? {
          ...request.config,
          ...(request.config.thinkingConfig
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
            : {}),
        }
      : undefined,
    model: 'gemini-3.1-flash-lite',
  });

  if (primaryModel !== 'gemini-3.1-flash-lite' && isPrimaryModelInCooldown()) {
    const fallbackAi = getAiClient(options?.apiVersion, fallbackTimeoutMs);
    const response = await fallbackAi.models.generateContent(buildLiteFallbackRequest());
    return { response, modelUsed: 'gemini-3.1-flash-lite' };
  }

  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          ...request,
          model: primaryModel,
        }),
      maxRetries,
    );
    clearPrimaryModelCooldown();
    return { response, modelUsed: primaryModel };
  } catch (err) {
    if (primaryModel !== 'gemini-3.1-flash-lite' && isFallbackEligibleError(err)) {
      markPrimaryModelCooldown(25_000);
      const fallbackAi = getAiClient(options?.apiVersion, fallbackTimeoutMs);
      const response = await fallbackAi.models.generateContent(buildLiteFallbackRequest());
      return { response, modelUsed: 'gemini-3.1-flash-lite' };
    }
    throw err;
  }
}

function buildTranslationSystemPrompt(request: TranslationRequest): string {
  const sourceLabel =
    request.sourceLang === 'auto'
      ? 'Automatically detect the source language'
      : `Source language: ${getLanguageLabel(request.sourceLang)} (${request.sourceLang})`;
  const targetLabel = `${getLanguageLabel(request.targetLang)} (${request.targetLang})`;

  const lines = [
    'You are EduZone Linguaflow, an elite professional multilingual translation engine.',
    'Follow these strict translation principles:',
    '1. Preserve exact original meaning and author intent.',
    '2. Produce natural, idiomatic phrasing in the target language—avoid stiff literal word-for-word translation.',
    '3. Preserve paragraph breaks, line breaks, punctuation, lists, names, numbers, dates, and measurement units.',
    '4. Never add information that does not exist in the source text. Never summarize unless explicitly asked.',
    '5. Never include explanations, commentary, or notes inside the translatedText field.',
    '6. If a phrase is genuinely ambiguous or untranslatable with certainty, state the uncertainty in uncertaintyNotice without inventing facts.',
    '',
    sourceLabel,
    `Target language: ${targetLabel}`,
    `Requested tone: ${request.tone}`,
  ];

  if (request.formality && request.formality !== 'default') {
    lines.push(
      `Formality level: ${request.formality === 'more_formal' ? 'More formal / polite' : 'Less formal / conversational'}`,
    );
  }
  if (request.tone === 'custom' && request.customToneDescription) {
    lines.push(`Custom tone specification: ${request.customToneDescription}`);
  }
  if (request.context) {
    lines.push(`Domain & situational context: ${request.context}`);
  }
  if (request.styleProfile) {
    if (request.styleProfile.writingStyle) {
      lines.push(`Preferred writing style: ${request.styleProfile.writingStyle}`);
    }
    if (request.styleProfile.preferredTerminology) {
      lines.push(`Preferred terminology notes: ${request.styleProfile.preferredTerminology}`);
    }
    if (request.styleProfile.customInstructions) {
      lines.push(`Additional style instructions: ${request.styleProfile.customInstructions}`);
    }
  }
  if (request.glossaryTerms && request.glossaryTerms.length > 0) {
    lines.push('');
    lines.push('MANDATORY GLOSSARY CONSTRAINTS (must be applied consistently whenever these terms appear):');
    for (const term of request.glossaryTerms) {
      lines.push(`- "${term.sourceTerm}" => "${term.targetTerm}"`);
    }
  }

  return lines.join('\n');
}

export const geminiProvider: TranslationProvider = {
  id: 'gemini',
  name: 'Gemini AI Translator',
  isConfigured() {
    return Boolean(SERVER_CONFIG.geminiApiKey);
  },
  getModelName() {
    return SERVER_CONFIG.geminiModel;
  },

  async translate(
    request: TranslationRequest,
    options?: { timeoutMs?: number; fallbackTimeoutMs?: number; maxRetries?: number },
  ): Promise<TranslationResult> {
    const ai = getAiClient(undefined, options?.timeoutMs ?? 24_000);
    const systemInstruction = buildTranslationSystemPrompt(request);

    const { response, modelUsed } = await generateContentWithModelFallback(
      ai,
      {
        contents: `Translate the following text accurately:\n\n${request.text}`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedText: {
                type: Type.STRING,
                description: 'The clean translated text preserving formatting and line breaks, without commentary.',
              },
              detectedSourceLang: {
                type: Type.STRING,
                description: 'BCP-47 or short language code of the source text (e.g. en, id, ja, zh-Hans).',
              },
              detectedSourceLangName: {
                type: Type.STRING,
                description: 'Human-readable English name of the detected source language.',
              },
              uncertaintyNotice: {
                type: Type.STRING,
                description: 'Optional brief note only if source text is ambiguous or partially unclear; empty string otherwise.',
              },
            },
            required: ['translatedText', 'detectedSourceLang', 'detectedSourceLangName'],
          },
        },
      },
      {
        maxRetries: options?.maxRetries ?? 1,
        fallbackTimeoutMs: options?.fallbackTimeoutMs,
      },
    );

    const parsed = safeParseModelJson<{
      translatedText?: string;
      detectedSourceLang?: string;
      detectedSourceLangName?: string;
      uncertaintyNotice?: string;
    }>(response.text || '{}');

    return {
      translatedText: parsed.translatedText ?? '',
      detectedSourceLang: parsed.detectedSourceLang || request.sourceLang,
      detectedSourceLangName: parsed.detectedSourceLangName,
      providerUsed: 'gemini',
      modelUsed,
      appliedTerms: request.glossaryTerms ?? [],
      uncertaintyNotice: parsed.uncertaintyNotice ? parsed.uncertaintyNotice : undefined,
    };
  },

  async getAlternatives(request: TranslationRequest): Promise<AlternativesResponse> {
    const ai = getAiClient(undefined, 25_000);
    const sourceLabel =
      request.sourceLang === 'auto'
        ? 'auto-detected source language'
        : getLanguageLabel(request.sourceLang);
    const targetLabel = getLanguageLabel(request.targetLang);

    const { response } = await generateContentWithModelFallback(ai, {
      contents: `Source text (${sourceLabel}):\n${request.text}\n\nTarget language: ${targetLabel}\nContext: ${request.context || 'General'}\nTone: ${request.tone}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction:
          'Provide 3 to 4 accurate alternative translations that preserve the exact core meaning of the source text while offering distinct stylistic nuances, registers, or natural phrasing. Never include alternatives that alter the factual meaning.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            alternatives: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  translation: { type: Type.STRING },
                  nuanceDifference: {
                    type: Type.STRING,
                    description: 'Short explanation of nuance difference in meaning or tone.',
                  },
                  usageContext: {
                    type: Type.STRING,
                    description: 'When to choose this phrasing (e.g. Executive email, Casual chat).',
                  },
                  formalityLevel: {
                    type: Type.STRING,
                    description: 'e.g. Formal, Neutral, Informal, Literary',
                  },
                  isMostNatural: {
                    type: Type.BOOLEAN,
                    description: 'True for the single most natural everyday option.',
                  },
                },
                required: [
                  'translation',
                  'nuanceDifference',
                  'usageContext',
                  'formalityLevel',
                  'isMostNatural',
                ],
              },
            },
          },
          required: ['alternatives'],
        },
      },
    });

    const parsed = safeParseModelJson<{
      alternatives?: AlternativesResponse['alternatives'];
    }>(response.text || '{}');

    return {
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      providerUsed: 'gemini',
    };
  },
};

export async function lookupContextualDictionary(params: {
  word: string;
  sentenceContext?: string;
  sourceLang: string;
  targetLang: string;
}): Promise<DictionaryEntry> {
  const ai = getAiClient(undefined, 25_000);
  const sourceLabel =
    params.sourceLang === 'auto' ? 'Auto-detect' : getLanguageLabel(params.sourceLang);
  const targetLabel = getLanguageLabel(params.targetLang);

  const { response } = await generateContentWithModelFallback(ai, {
    contents: [
      `Word or phrase to look up: "${params.word}"`,
      `Sentence context: "${params.sentenceContext || params.word}"`,
      `Source language: ${sourceLabel}`,
      `Target language: ${targetLabel}`,
    ].join('\n'),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'You are an authoritative bilingual lexicographer. Analyze the target word strictly within the provided sentence context. Provide accurate contextual translation, definition, part of speech, IPA or pronunciation hint, synonyms, antonyms (empty array if none apply), bilingual example sentences, and contextual usage alternatives.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          detectedLanguage: { type: Type.STRING },
          contextualTranslation: { type: Type.STRING },
          partOfSpeech: { type: Type.STRING },
          pronunciation: { type: Type.STRING },
          definition: { type: Type.STRING },
          synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
          antonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
          examples: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source: { type: Type.STRING },
                target: { type: Type.STRING },
              },
              required: ['source', 'target'],
            },
          },
          usageAlternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'word',
          'contextualTranslation',
          'partOfSpeech',
          'definition',
          'synonyms',
          'antonyms',
          'examples',
          'usageAlternatives',
        ],
      },
    },
  });

  const parsed = safeParseModelJson<Partial<DictionaryEntry>>(response.text || '{}');
  return {
    word: parsed.word || params.word,
    detectedLanguage: parsed.detectedLanguage || (params.sourceLang === 'auto' ? undefined : params.sourceLang),
    contextualTranslation: parsed.contextualTranslation || '',
    partOfSpeech: parsed.partOfSpeech || 'term',
    pronunciation: parsed.pronunciation || undefined,
    definition: parsed.definition || '',
    synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms.filter(Boolean) : [],
    antonyms: Array.isArray(parsed.antonyms) ? parsed.antonyms.filter(Boolean) : [],
    examples: Array.isArray(parsed.examples)
      ? parsed.examples.filter((ex) => ex && typeof ex.source === 'string' && typeof ex.target === 'string')
      : [],
    usageAlternatives: Array.isArray(parsed.usageAlternatives)
      ? parsed.usageAlternatives.filter(Boolean)
      : [],
  };
}

export async function translateImageWithGemini(params: {
  base64Data: string;
  mimeType: string;
  sourceLang: string;
  targetLang: string;
}): Promise<ImageTranslationResult> {
  const ai = getAiClient(undefined, 30_000);
  const targetLabel = getLanguageLabel(params.targetLang);
  const sourceInstruction =
    params.sourceLang === 'auto'
      ? 'Automatically detect the language(s) of the text in the image.'
      : `Source language hint: ${getLanguageLabel(params.sourceLang)}.`;

  const { response, modelUsed } = await generateContentWithModelFallback(ai, {
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.base64Data,
          },
        },
        {
          text: `${sourceInstruction} Extract all legible text regions from this image with their normalized 2D bounding boxes [ymin, xmin, ymax, xmax] on a 0-1000 scale, and translate every region naturally into ${targetLabel}. If any text is blurry, cut off, or illegible, DO NOT guess or fabricate it—list it in unreadableSections instead.`,
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'You are an accurate multimodal OCR and translation engine. Never invent text that is not visibly legible in the image. Return exact bounding boxes [ymin, xmin, ymax, xmax] between 0 and 1000.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedSourceLang: { type: Type.STRING },
          regions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                originalText: { type: Type.STRING },
                translatedText: { type: Type.STRING },
                box2d: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                  description: '[ymin, xmin, ymax, xmax] normalized 0 to 1000',
                },
                confidence: { type: Type.STRING },
              },
              required: ['id', 'originalText', 'translatedText', 'box2d', 'confidence'],
            },
          },
          fullOriginalText: { type: Type.STRING },
          fullTranslatedText: { type: Type.STRING },
          unreadableSections: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'detectedSourceLang',
          'regions',
          'fullOriginalText',
          'fullTranslatedText',
          'unreadableSections',
        ],
      },
    },
  },
  { maxRetries: 1, fallbackTimeoutMs: 25_000 },
  );

  const parsed = safeParseModelJson<ImageTranslationResult>(response.text || '{}');
  return {
    detectedSourceLang: parsed.detectedSourceLang || 'Unknown',
    regions: Array.isArray(parsed.regions)
      ? parsed.regions.map((r, idx) => ({
          id: r.id || `region-${idx + 1}`,
          originalText: r.originalText || '',
          translatedText: r.translatedText || '',
          box2d:
            Array.isArray(r.box2d) && r.box2d.length === 4
              ? [
                  Math.max(0, Math.min(1000, r.box2d[0])),
                  Math.max(0, Math.min(1000, r.box2d[1])),
                  Math.max(0, Math.min(1000, r.box2d[2])),
                  Math.max(0, Math.min(1000, r.box2d[3])),
                ]
              : [0, 0, 0, 0],
          confidence:
            r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
              ? r.confidence
              : 'medium',
        }))
      : [],
    fullOriginalText: parsed.fullOriginalText || '',
    fullTranslatedText: parsed.fullTranslatedText || '',
    unreadableSections: Array.isArray(parsed.unreadableSections) ? parsed.unreadableSections : [],
    modelUsed,
  };
}

export async function transcribeAndTranslateAudio(params: {
  base64Audio: string;
  mimeType: string;
  sourceLang: string;
  targetLang: string;
  fallbackTranslate?: (text: string, sourceLang: string, targetLang: string) => Promise<TranslationResult>;
}): Promise<{ detectedSourceLang: string; transcript: string; translatedText: string }> {
  const audioPart = {
    inlineData: {
      mimeType: params.mimeType,
      data: params.base64Audio,
    },
  };

  const sourceHint =
    params.sourceLang === 'auto'
      ? 'Detect the spoken language automatically.'
      : `The speaker is speaking ${getLanguageLabel(params.sourceLang)}.`;

  const promptText = `${sourceHint} Listen carefully to the speech in this audio and transcribe it verbatim in its original spoken language. Return only the exact spoken words without quotes or commentary. If there is no speech at all, return an empty string.`;

  let transcript = '';

  // 1. Primary specialized transcription model (uses v1beta; gracefully disables if 404 NOT_FOUND)
  if (!transcribePrimaryUnavailable) {
    try {
      const primaryAi = getAiClient('v1beta', 20_000);
      const transcribeResp = await withRetry(
        () =>
          primaryAi.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [audioPart, { text: promptText }],
            },
          }),
        1,
      );
      transcript = (transcribeResp.text || '').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NOT_FOUND') || msg.includes('404') || msg.includes('not found')) {
        transcribePrimaryUnavailable = true;
      } else {
        console.warn('[transcribeAndTranslateAudio] Primary transcribe fallback:', msg);
      }
    }
  }

  // 2. Fallback to multimodal Gemini models (gemini-4-hydrogen -> gemini-3.1-flash-lite) if primary failed or returned empty
  if (!transcript) {
    const runFallbackTranscribe = async () => {
      const fallbackAi = getAiClient(undefined, 20_000);
      const { response: fallbackResp } = await generateContentWithModelFallback(
        fallbackAi,
        {
          contents: {
            parts: [audioPart, { text: promptText }],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        },
        { maxRetries: 1, fallbackTimeoutMs: 15_000 },
      );
      return (fallbackResp.text || '').trim();
    };

    try {
      transcript = await runFallbackTranscribe();
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      const isTransientBurst =
        !msg.includes('PerDay') &&
        (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('503'));
      if (!isTransientBurst) {
        throw fallbackErr;
      }
      await new Promise((r) => setTimeout(r, 1800));
      transcript = await runFallbackTranscribe();
    }
  }

  if (!transcript) {
    return {
      detectedSourceLang: params.sourceLang === 'auto' ? 'unknown' : params.sourceLang,
      transcript: '',
      translatedText: '',
    };
  }

  let translated: TranslationResult;
  try {
    translated = await geminiProvider.translate({
      text: transcript,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      tone: 'natural',
      context: 'Spoken conversation transcript',
    });
  } catch (trErr) {
    if (params.fallbackTranslate && isFallbackEligibleError(trErr)) {
      translated = await params.fallbackTranslate(
        transcript,
        params.sourceLang,
        params.targetLang,
      );
    } else {
      throw trErr;
    }
  }

  return {
    detectedSourceLang: translated.detectedSourceLang || params.sourceLang,
    transcript,
    translatedText: translated.translatedText,
  };
}

export function ensureWavBase64(base64Audio: string, rawMimeType?: string): string {
  const bytes = Buffer.from(base64Audio, 'base64');
  const hasRiffHeader =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45; // E

  const isRawPcm =
    !hasRiffHeader &&
    (!rawMimeType ||
      rawMimeType.toLowerCase().includes('pcm') ||
      rawMimeType.toLowerCase().includes('l16') ||
      rawMimeType.toLowerCase() === 'audio/wav');

  if (!isRawPcm) {
    return base64Audio;
  }

  // Wrap raw 24kHz mono 16-bit LE PCM in standard 44-byte RIFF/WAVE header
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = bytes.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM format chunk size
  header.writeUInt16LE(1, 20); // PCM format = 1
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, bytes]).toString('base64');
}

async function withTtsRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPerDayExhausted = msg.includes('PerDay') || msg.includes('daily');
    const isRetryable =
      !isPerDayExhausted &&
      (msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED'));
    if (!isRetryable) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return await fn();
  }
}

export async function generateSpeechAudio(params: {
  text: string;
  voiceName: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  styleHint?: string;
}): Promise<{ base64Wav: string; mimeType: string }> {
  const voice = params.voiceName || 'Kore';
  const style = params.styleHint || 'Clear, natural, articulate pronunciation';
  const cacheKey = `${voice}|${style}|${params.text}`;
  const now = Date.now();
  const cached = ttsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { base64Wav: cached.base64Wav, mimeType: cached.mimeType };
  }

  const ai = getAiClient('v1beta', 25_000);
  const buildTtsRequest = (model: string) =>
    ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: params.text,
              speechMetadata: {
                style,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
    });

  let response;
  if (Date.now() < ttsLiteCooldownUntil) {
    response = await withTtsRetry(() => buildTtsRequest('gemini-3.8-flash-tts'));
  } else {
    try {
      response = await withTtsRetry(() => buildTtsRequest('gemini-3.8-flash-lite-tts'));
    } catch (liteErr) {
      const msg = liteErr instanceof Error ? liteErr.message : String(liteErr);
      if (msg.includes('PerDay') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('503')) {
        if (msg.includes('PerDay')) {
          ttsLiteCooldownUntil = Date.now() + 10 * 60_000;
        }
        response = await withTtsRetry(() => buildTtsRequest('gemini-3.8-flash-tts'));
      } else {
        throw liteErr;
      }
    }
  }

  const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const base64Audio = inlineData?.data;
  if (!base64Audio) {
    throw new Error('TTS model returned no audio data.');
  }

  const result = {
    base64Wav: ensureWavBase64(base64Audio, inlineData?.mimeType),
    mimeType: 'audio/wav',
  };

  if (ttsCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey !== undefined) ttsCache.delete(oldestKey);
  }
  ttsCache.set(cacheKey, { ...result, expiresAt: now + TTS_CACHE_TTL_MS });

  return result;
}

export async function detectLanguageWithGemini(text: string): Promise<DetectLanguageResult> {
  const ai = getAiClient(undefined, 20_000);
  const { response } = await generateContentWithModelFallback(ai, {
    contents: `Identify the language of this text:\n\n${text}`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'Detect the primary language of the given text. Return its standard ISO 639-1 / BCP-47 code (e.g. en, id, ja, zh-Hans, ar, fr), English language name, confidence ("high", "medium", or "low"), and whether the script is right-to-left (isRtl).',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedLang: { type: Type.STRING },
          languageName: { type: Type.STRING },
          confidence: { type: Type.STRING },
          isRtl: { type: Type.BOOLEAN },
        },
        required: ['detectedLang', 'languageName', 'confidence', 'isRtl'],
      },
    },
  });

  const parsed = safeParseModelJson<{
    detectedLang?: string;
    languageName?: string;
    confidence?: string;
    isRtl?: boolean;
  }>(response.text || '{}');

  const confidence =
    parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
      ? parsed.confidence
      : 'medium';

  return {
    detectedLang: parsed.detectedLang || 'unknown',
    languageName: parsed.languageName || 'Unknown',
    confidence,
    isRtl: Boolean(parsed.isRtl),
    providerUsed: 'gemini',
  };
}

