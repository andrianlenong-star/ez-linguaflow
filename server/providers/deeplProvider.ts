import { SERVER_CONFIG } from '../config.ts';
import type {
  AlternativesResponse,
  TranslationRequest,
  TranslationResult,
} from '../../src/shared/types.ts';
import type { TranslationProvider } from './types.ts';

function toDeepLTargetCode(code: string): string {
  const map: Record<string, string> = {
    en: 'EN-US',
    id: 'ID',
    ja: 'JA',
    ko: 'KO',
    'zh-hans': 'ZH-HANS',
    'zh-hant': 'ZH-HANT',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
    pt: 'PT-BR',
    it: 'IT',
    nl: 'NL',
    ru: 'RU',
    ar: 'AR',
    tr: 'TR',
    pl: 'PL',
  };
  return map[code.toLowerCase()] ?? code.toUpperCase();
}

export const deeplProvider: TranslationProvider = {
  id: 'deepl',
  name: 'DeepL Official API',
  isConfigured() {
    return Boolean(SERVER_CONFIG.deeplApiKey);
  },
  getModelName() {
    return SERVER_CONFIG.deeplApiKey ? 'DeepL API v2' : undefined;
  },

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (!SERVER_CONFIG.deeplApiKey) {
      throw new Error('DeepL API key is not configured on the server.');
    }

    const isFreeKey = SERVER_CONFIG.deeplApiKey.endsWith(':fx');
    const endpoint = isFreeKey
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    const payload: Record<string, unknown> = {
      text: [request.text],
      target_lang: toDeepLTargetCode(request.targetLang),
    };

    if (request.sourceLang && request.sourceLang !== 'auto') {
      payload.source_lang = request.sourceLang.split('-')[0].toUpperCase();
    }
    if (request.formality === 'more_formal' || request.tone === 'formal') {
      payload.formality = 'prefer_more';
    } else if (request.formality === 'less_formal' || request.tone === 'informal' || request.tone === 'casual') {
      payload.formality = 'prefer_less';
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${SERVER_CONFIG.deeplApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepL API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      translations?: Array<{ text: string; detected_source_language?: string }>;
    };
    const first = data.translations?.[0];

    return {
      translatedText: first?.text ?? '',
      detectedSourceLang: first?.detected_source_language?.toLowerCase(),
      providerUsed: 'deepl',
      modelUsed: 'DeepL API v2',
      appliedTerms: [],
    };
  },

  async getAlternatives(): Promise<AlternativesResponse> {
    throw new Error(
      'Nuanced alternative explanations are powered by Gemini AI. Switch to Gemini or configure Gemini to generate alternatives.',
    );
  },
};
