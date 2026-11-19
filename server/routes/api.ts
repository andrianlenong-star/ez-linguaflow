import express from 'express';
import multer from 'multer';
import { SERVER_CONFIG } from '../config.ts';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.ts';
import type {
  ProviderId,
  ProviderStatus,
  SyncPushRequest,
  TranslationRequest,
} from '../../src/shared/types.ts';
import {
  normalizeAudioMimeType,
  sanitizeUserText,
  validateAudioFile,
  validateDocumentFile,
  validateImageFile,
} from '../../src/utils/text.ts';
import {
  clearGeminiCooldown,
  detectLanguageWithGemini,
  geminiProvider,
  generateSpeechAudio,
  isGeminiInCooldown,
  lookupContextualDictionary,
  markGeminiCooldown,
  transcribeAndTranslateAudio,
  translateImageWithGemini,
} from '../providers/geminiProvider.ts';
import { deeplProvider } from '../providers/deeplProvider.ts';
import { processDocumentTranslation } from '../documentProcessor.ts';
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { rateLimitMiddleware } from '../middleware/security.ts';
import {
  clearAllHistory,
  getUserPreferences,
  getUserProfile,
  listConversations,
  listGlossaries,
  listHistory,
  listSavedTranslations,
  listStyleProfiles,
  pullSyncState,
  pushSyncChanges,
  saveUserPreferences,
  softDeleteConversation,
  softDeleteGlossary,
  softDeleteHistoryItem,
  softDeleteSavedTranslation,
  softDeleteStyleProfile,
  upsertConversation,
  upsertGlossary,
  upsertHistoryItem,
  upsertSavedTranslation,
  upsertStyleProfile,
  upsertUserProfile,
} from '../services/firestoreRest.ts';
import {
  validateConversationPayload,
  validateGlossaryPayload,
  validateHistoryPayload,
  validateIdParam,
  validatePreferencesPayload,
  validateProfilePayload,
  validateSavedTranslationPayload,
  validateStyleProfilePayload,
} from '../utils/validation.ts';

export const apiRouter = express.Router();

// Memory-only multer upload (uploaded documents/audio/images are never persisted permanently to disk)
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SERVER_CONFIG.maxDocumentBytes },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SERVER_CONFIG.maxImageBytes },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SERVER_CONFIG.maxAudioBytes },
});

function extractSafeGeminiMessage(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    const match = raw.match(/"message"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function mapErrorToStatusAndMessage(err: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 400,
      code: 'AI_CONFIG_INVALID',
      message:
        'AI translation service configuration is invalid or missing. Verify GEMINI_API_KEY in server environment variables (Settings > Secrets or Vercel Environment Variables) and redeploy.',
    };
  }
  if (raw.includes('INVALID_ARGUMENT') || raw.includes('"code":400') || raw.includes('status 400')) {
    return {
      status: 400,
      code: 'INVALID_ARGUMENT',
      message: extractSafeGeminiMessage(raw) || raw,
    };
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied by upstream Google/AI service.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    const detail = extractSafeGeminiMessage(raw);
    return {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      message: detail
        ? `AI service rate limit or quota reached (${detail}). Please try again shortly.`
        : 'AI service rate limit reached. Please try again in a few seconds.',
    };
  }
  if (raw.includes('UNAVAILABLE') || raw.includes('"code":503') || raw.includes('503')) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'AI service is temporarily busy due to high demand. Please try again in a few seconds.',
    };
  }
  const errName = err instanceof Error ? err.name : '';
  if (
    errName === 'TimeoutError' ||
    errName === 'AbortError' ||
    raw.includes('TimeoutError') ||
    raw.includes('AbortError') ||
    raw.toLowerCase().includes('aborted') ||
    raw.toLowerCase().includes('timed out') ||
    raw.includes('DEADLINE_EXCEEDED')
  ) {
    return {
      status: 504,
      code: 'UPSTREAM_TIMEOUT',
      message: 'Upstream AI translation service timed out. Please try again in a moment.',
    };
  }
  if (raw.includes('DeepL API key is not configured')) {
    return { status: 503, code: 'PROVIDER_NOT_CONFIGURED', message: raw };
  }
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: raw || 'Unexpected server error.',
  };
}

function sendError(
  req: AuthenticatedRequest,
  res: express.Response,
  status: number,
  code: string,
  message: string,
) {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  res.status(status).json({
    error: message,
    code,
    requestId: req.requestId,
  });
}

function getProvider(providerId?: ProviderId) {
  if (providerId === 'deepl') return deeplProvider;
  return geminiProvider;
}

// Health check & metadata endpoints (public for Cloud Run readiness probes & client bootstrap)
apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    version: SERVER_CONFIG.apiVersion,
    environment: SERVER_CONFIG.nodeEnv,
    timestamp: new Date().toISOString(),
    geminiConfigured: geminiProvider.isConfigured(),
    deeplConfigured: deeplProvider.isConfigured(),
    databaseConfigured: Boolean(SERVER_CONFIG.firebaseConfig?.projectId),
    model: SERVER_CONFIG.geminiModel,
    limits: {
      maxTextLength: SERVER_CONFIG.maxTextLength,
      maxDocumentBytes: SERVER_CONFIG.maxDocumentBytes,
      maxImageBytes: SERVER_CONFIG.maxImageBytes,
      maxAudioBytes: SERVER_CONFIG.maxAudioBytes,
      requestTimeoutMs: SERVER_CONFIG.requestTimeoutMs,
      rateLimitPerMinute: SERVER_CONFIG.rateLimitMax,
    },
  });
});

// Parse optional Bearer token before rate limiter so authenticated Web/Android users get per-uid buckets
apiRouter.use(optionalAuth);
apiRouter.use(rateLimitMiddleware);

apiRouter.get('/languages', (_req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

apiRouter.get('/providers', (_req, res) => {
  const providers: ProviderStatus[] = [
    {
      id: 'gemini',
      name: 'Gemini AI Translator',
      available: geminiProvider.isConfigured(),
      model: SERVER_CONFIG.geminiModel,
      note: geminiProvider.isConfigured()
        ? `Active server-side Gemini engine (${SERVER_CONFIG.geminiModel})`
        : 'GEMINI_API_KEY is not configured in server secrets.',
    },
    {
      id: 'deepl',
      name: 'DeepL Official API',
      available: deeplProvider.isConfigured(),
      model: deeplProvider.getModelName(),
      note: deeplProvider.isConfigured()
        ? 'DEEPL_API_KEY is configured and ready.'
        : 'Optional provider. Set DEEPL_API_KEY in server secrets to enable official DeepL API.',
    },
  ];
  res.json({ providers });
});

// Standalone Language Detection
apiRouter.post('/detect', async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as { text?: string };
    const text = sanitizeUserText(String(body.text || ''), 10000);
    if (!text.trim()) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Text is required for language detection.');
      return;
    }
    if (!geminiProvider.isConfigured()) {
      sendError(
        req,
        res,
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Gemini AI Translator is not configured on the server. Add GEMINI_API_KEY to your server Environment Variables (e.g. Vercel Project Settings -> Environment Variables) and redeploy.',
      );
      return;
    }
    const result = await detectLanguageWithGemini(text);
    res.json(result);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Text Translation (with tone, formality, style profile, glossary support, and automatic DeepL failover)
apiRouter.post('/translate', async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as Partial<TranslationRequest>;
    const rawText = typeof body.text === 'string' ? body.text : String(body.text ?? '');
    if (rawText.length > SERVER_CONFIG.maxTextLength) {
      sendError(
        req,
        res,
        400,
        'TEXT_TOO_LONG',
        `Source text exceeds the maximum limit of ${SERVER_CONFIG.maxTextLength.toLocaleString()} characters.`,
      );
      return;
    }
    const text = sanitizeUserText(rawText, SERVER_CONFIG.maxTextLength);
    if (!text.trim()) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Source text is required.');
      return;
    }
    if (!body.targetLang) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Target language is required.');
      return;
    }

    const requestPayload: TranslationRequest = {
      text,
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      tone: body.tone || 'natural',
      formality: body.formality || 'default',
      context: body.context ? sanitizeUserText(body.context, 500) : undefined,
      customToneDescription: body.customToneDescription
        ? sanitizeUserText(body.customToneDescription, 500)
        : undefined,
      styleProfile: body.styleProfile,
      glossaryTerms: Array.isArray(body.glossaryTerms) ? body.glossaryTerms.slice(0, 100) : [],
      provider: body.provider,
    };

    const provider = getProvider(body.provider);
    if (!provider.isConfigured()) {
      if (provider.id === 'gemini' && deeplProvider.isConfigured()) {
        const fallbackResult = await deeplProvider.translate(requestPayload);
        res.json({
          ...fallbackResult,
          uncertaintyNotice:
            'Translated via DeepL Official API because GEMINI_API_KEY is not configured.',
        });
        return;
      }
      sendError(
        req,
        res,
        503,
        'PROVIDER_NOT_CONFIGURED',
        `${provider.name} is not configured on the server. Add GEMINI_API_KEY (or DEEPL_API_KEY) to your server Environment Variables (e.g. Vercel Project Settings -> Environment Variables) and redeploy.`,
      );
      return;
    }

    const hasDeeplFallback = provider.id === 'gemini' && deeplProvider.isConfigured();

    if (hasDeeplFallback && isGeminiInCooldown()) {
      const fallbackResult = await deeplProvider.translate(requestPayload);
      if (!res.headersSent) {
        res.json({
          ...fallbackResult,
          uncertaintyNotice:
            'Translated quickly via DeepL Official API while Gemini AI recovers from timeout or rate limit.',
        });
      }
      return;
    }

    try {
      const result =
        provider.id === 'gemini'
          ? await geminiProvider.translate(requestPayload, {
              timeoutMs: hasDeeplFallback ? 18_000 : 25_000,
              fallbackTimeoutMs: 18_000,
              maxRetries: hasDeeplFallback ? 0 : 1,
            })
          : await provider.translate(requestPayload);
      if (provider.id === 'gemini') {
        clearGeminiCooldown();
      }
      if (!res.headersSent) {
        res.json(result);
      }
      return;
    } catch (primaryErr) {
      if (hasDeeplFallback) {
        const reasonMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        console.warn('[api/translate] Gemini fallback triggered:', reasonMsg);
        markGeminiCooldown(15_000);
        try {
          const fallbackResult = await deeplProvider.translate(requestPayload);
          const glossaryNote =
            requestPayload.glossaryTerms && requestPayload.glossaryTerms.length > 0
              ? ' Custom glossary terms are only enforced on Gemini AI.'
              : '';
          if (!res.headersSent) {
            res.json({
              ...fallbackResult,
              uncertaintyNotice:
                `Translated via DeepL Official API fallback because Gemini AI was temporarily unavailable or timed out.${glossaryNote}`,
            });
          }
          return;
        } catch {
          throw primaryErr;
        }
      }
      throw primaryErr;
    }
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Alternative Translations
apiRouter.post('/translate/alternatives', async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as Partial<TranslationRequest>;
    const text = sanitizeUserText(body.text || '', 4000);
    if (!text.trim() || !body.targetLang) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Source text and target language are required.');
      return;
    }

    const requestedProvider = getProvider(body.provider);
    const provider =
      requestedProvider.id === 'deepl' && geminiProvider.isConfigured()
        ? geminiProvider
        : requestedProvider;
    if (!provider.isConfigured()) {
      sendError(
        req,
        res,
        503,
        'PROVIDER_NOT_CONFIGURED',
        `${provider.name} is not configured on the server.`,
      );
      return;
    }

    const result = await provider.getAlternatives({
      text,
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      tone: body.tone || 'natural',
      context: body.context ? sanitizeUserText(body.context, 500) : undefined,
      provider: provider.id,
    });
    res.json(result);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Contextual Dictionary
apiRouter.post('/dictionary', async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as {
      word?: string;
      sentenceContext?: string;
      sourceLang?: string;
      targetLang?: string;
    };
    const word = sanitizeUserText(body.word || '', 200).trim();
    if (!word || !body.targetLang) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Word and target language are required.');
      return;
    }

    const entry = await lookupContextualDictionary({
      word,
      sentenceContext: body.sentenceContext ? sanitizeUserText(body.sentenceContext, 1000) : undefined,
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
    });

    res.json(entry);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Document Translation (Multipart upload)
apiRouter.post('/translate/document', docUpload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    const file = req.file;
    if (!file) {
      sendError(req, res, 400, 'FILE_REQUIRED', 'No document file uploaded.');
      return;
    }

    const validation = validateDocumentFile(
      file.originalname,
      file.size,
      SERVER_CONFIG.maxDocumentBytes,
    );
    if (!validation.valid) {
      sendError(req, res, 400, 'INVALID_FILE', validation.error || 'Invalid document file.');
      return;
    }

    const targetLang = String(req.body.targetLang || '').trim();
    if (!targetLang) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Target language is required.');
      return;
    }

    let glossaryTerms = [];
    if (req.body.glossaryTerms) {
      try {
        glossaryTerms = JSON.parse(String(req.body.glossaryTerms));
      } catch {
        glossaryTerms = [];
      }
    }

    const result = await processDocumentTranslation({
      buffer: file.buffer,
      filename: file.originalname,
      ext: validation.ext,
      sourceLang: String(req.body.sourceLang || 'auto'),
      targetLang,
      tone: (req.body.tone || 'natural') as TranslationRequest['tone'],
      context: req.body.context ? sanitizeUserText(String(req.body.context), 500) : undefined,
      glossaryTerms: Array.isArray(glossaryTerms) ? glossaryTerms : [],
    });

    res.json(result);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Image Translation & OCR (Multipart upload)
apiRouter.post('/translate/image', imageUpload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    const file = req.file;
    if (!file) {
      sendError(req, res, 400, 'FILE_REQUIRED', 'No image file uploaded.');
      return;
    }

    const validation = validateImageFile(
      file.originalname,
      file.size,
      SERVER_CONFIG.maxImageBytes,
    );
    if (!validation.valid) {
      sendError(req, res, 400, 'INVALID_FILE', validation.error || 'Invalid image file.');
      return;
    }

    const targetLang = String(req.body.targetLang || '').trim();
    if (!targetLang) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Target language is required.');
      return;
    }

    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };

    const result = await translateImageWithGemini({
      base64Data: file.buffer.toString('base64'),
      mimeType: mimeMap[validation.ext] || file.mimetype || 'image/png',
      sourceLang: String(req.body.sourceLang || 'auto'),
      targetLang,
    });

    res.json(result);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Voice Transcription & Translation (Multipart audio upload)
apiRouter.post('/translate/voice', audioUpload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    const file = req.file;
    if (!file) {
      sendError(req, res, 400, 'FILE_REQUIRED', 'No audio recording uploaded.');
      return;
    }

    const audioValidation = validateAudioFile(
      file.originalname || 'recording.webm',
      file.size,
      SERVER_CONFIG.maxAudioBytes,
    );
    if (!audioValidation.valid) {
      sendError(req, res, 400, 'INVALID_FILE', audioValidation.error || 'Invalid audio file.');
      return;
    }

    const targetLang = String(req.body.targetLang || '').trim();
    if (!targetLang) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Target language is required.');
      return;
    }

    const ext = audioValidation.ext;
    const resolvedMime = normalizeAudioMimeType(file.mimetype, ext);

    const result = await transcribeAndTranslateAudio({
      base64Audio: file.buffer.toString('base64'),
      mimeType: resolvedMime,
      sourceLang: String(req.body.sourceLang || 'auto'),
      targetLang,
      fallbackTranslate: deeplProvider.isConfigured()
        ? (txt, src, tgt) =>
            deeplProvider.translate({
              text: txt,
              sourceLang: src,
              targetLang: tgt,
              tone: 'natural',
              context: 'Spoken conversation transcript',
              provider: 'deepl',
            })
        : undefined,
    });

    res.json(result);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Text-to-Speech Synthesis
apiRouter.post('/tts', async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as {
      text?: string;
      voiceName?: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
      styleHint?: string;
    };
    const text = sanitizeUserText(body.text || '', 2500).trim();
    if (!text) {
      sendError(req, res, 400, 'INVALID_INPUT', 'Text for speech synthesis is required.');
      return;
    }

    const audio = await generateSpeechAudio({
      text,
      voiceName: body.voiceName || 'Kore',
      styleHint: body.styleHint,
    });

    res.json(audio);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// ============================================================================
// AUTHENTICATED, USER-ISOLATED PERSISTENCE & SYNC ENDPOINTS (Web + Android)
// ============================================================================

// User Profile
apiRouter.get('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const profile = await getUserProfile(req.user!);
    res.json({ profile });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.put('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validateProfilePayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
      req.user!.email,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const profile = await upsertUserProfile(req.user!, validated.data);
    res.json({ profile });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// User Translation Preferences / Settings
apiRouter.get('/preferences', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const preferences = await getUserPreferences(req.user!);
    res.json({ preferences });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.put('/preferences', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validatePreferencesPayload((req.body || {}) as Record<string, unknown>);
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const preferences = await saveUserPreferences(req.user!, validated.data);
    res.json({ preferences });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Glossaries (User-Isolated)
apiRouter.get('/glossaries', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const glossaries = await listGlossaries(req.user!);
    res.json({ glossaries });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.post('/glossaries', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validateGlossaryPayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const glossary = await upsertGlossary(req.user!, validated.data);
    res.status(201).json({ glossary });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.put('/glossaries/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    const validated = validateGlossaryPayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
      idCheck.data,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const glossary = await upsertGlossary(req.user!, validated.data);
    res.json({ glossary });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.delete('/glossaries/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    await softDeleteGlossary(req.user!, idCheck.data);
    res.json({ deleted: true, id: idCheck.data });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Style Profiles (User-Isolated)
apiRouter.get('/style-profiles', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const styleProfiles = await listStyleProfiles(req.user!);
    res.json({ styleProfiles });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.post('/style-profiles', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validateStyleProfilePayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const styleProfile = await upsertStyleProfile(req.user!, validated.data);
    res.status(201).json({ styleProfile });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.put('/style-profiles/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    const validated = validateStyleProfilePayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
      idCheck.data,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const styleProfile = await upsertStyleProfile(req.user!, validated.data);
    res.json({ styleProfile });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.delete('/style-profiles/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    await softDeleteStyleProfile(req.user!, idCheck.data);
    res.json({ deleted: true, id: idCheck.data });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Translation History (User-Isolated)
apiRouter.get('/history', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const history = await listHistory(req.user!);
    res.json({ history });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.post('/history', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validateHistoryPayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const item = await upsertHistoryItem(req.user!, validated.data);
    res.status(201).json({ item });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.put('/history/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    const validated = validateHistoryPayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
      idCheck.data,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const item = await upsertHistoryItem(req.user!, validated.data);
    res.json({ item });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.delete('/history/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    await softDeleteHistoryItem(req.user!, idCheck.data);
    res.json({ deleted: true, id: idCheck.data });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.delete('/history', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cleared = await clearAllHistory(req.user!);
    res.json({ deleted: true, count: cleared });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Saved Translations / Phrasebook (User-Isolated)
apiRouter.get('/saved-translations', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const savedTranslations = await listSavedTranslations(req.user!);
    res.json({ savedTranslations });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.post('/saved-translations', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validateSavedTranslationPayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const item = await upsertSavedTranslation(req.user!, validated.data);
    res.status(201).json({ item });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.delete('/saved-translations/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    await softDeleteSavedTranslation(req.user!, idCheck.data);
    res.json({ deleted: true, id: idCheck.data });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Voice Conversation Mode Sessions (User-Isolated)
apiRouter.get('/conversations', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const conversations = await listConversations(req.user!);
    res.json({ conversations });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.post('/conversations', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const validated = validateConversationPayload(
      (req.body || {}) as Record<string, unknown>,
      req.user!.uid,
    );
    if (!validated.ok) {
      sendError(req, res, 400, 'INVALID_INPUT', validated.error);
      return;
    }
    const conversation = await upsertConversation(req.user!, validated.data);
    res.status(201).json({ conversation });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.delete('/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const idCheck = validateIdParam(req.params.id);
    if (!idCheck.ok) {
      sendError(req, res, 400, 'INVALID_ID', idCheck.error);
      return;
    }
    await softDeleteConversation(req.user!, idCheck.data);
    res.json({ deleted: true, id: idCheck.data });
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

// Cross-Device Synchronization (Web <-> Android)
apiRouter.get('/sync/pull', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const sinceParam = Number(req.query.since || 0);
    const sinceMs = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : 0;
    const snapshot = await pullSyncState(req.user!, sinceMs);
    res.json(snapshot);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});

apiRouter.post('/sync/push', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const raw = (req.body || {}) as SyncPushRequest;
    const sanitized: SyncPushRequest = {};

    if (raw.preferences && typeof raw.preferences === 'object') {
      const p = validatePreferencesPayload(raw.preferences as unknown as Record<string, unknown>);
      if (!p.ok) {
        sendError(req, res, 400, 'INVALID_INPUT', p.error);
        return;
      }
      sanitized.preferences = p.data;
    }

    if (Array.isArray(raw.history)) {
      sanitized.history = [];
      for (const item of raw.history.slice(0, 200)) {
        const check = validateHistoryPayload(
          item as unknown as Record<string, unknown>,
          req.user!.uid,
          typeof item.id === 'string' ? item.id : undefined,
        );
        if (check.ok) sanitized.history.push(check.data);
      }
    }

    if (Array.isArray(raw.savedTranslations)) {
      sanitized.savedTranslations = [];
      for (const item of raw.savedTranslations.slice(0, 200)) {
        const check = validateSavedTranslationPayload(
          item as unknown as Record<string, unknown>,
          req.user!.uid,
          typeof item.id === 'string' ? item.id : undefined,
        );
        if (check.ok) sanitized.savedTranslations.push(check.data);
      }
    }

    if (Array.isArray(raw.glossaries)) {
      sanitized.glossaries = [];
      for (const item of raw.glossaries.slice(0, 100)) {
        const check = validateGlossaryPayload(
          item as unknown as Record<string, unknown>,
          req.user!.uid,
          typeof item.id === 'string' ? item.id : undefined,
        );
        if (check.ok) sanitized.glossaries.push(check.data);
      }
    }

    if (Array.isArray(raw.styleProfiles)) {
      sanitized.styleProfiles = [];
      for (const item of raw.styleProfiles.slice(0, 100)) {
        const check = validateStyleProfilePayload(
          item as unknown as Record<string, unknown>,
          req.user!.uid,
          typeof item.id === 'string' ? item.id : undefined,
        );
        if (check.ok) sanitized.styleProfiles.push(check.data);
      }
    }

    if (Array.isArray(raw.conversations)) {
      sanitized.conversations = [];
      for (const item of raw.conversations.slice(0, 100)) {
        const check = validateConversationPayload(
          item as unknown as Record<string, unknown>,
          req.user!.uid,
          typeof item.id === 'string' ? item.id : undefined,
        );
        if (check.ok) sanitized.conversations.push(check.data);
      }
    }

    const result = await pushSyncChanges(req.user!, sanitized);
    res.json(result);
  } catch (err) {
    const mapped = mapErrorToStatusAndMessage(err);
    sendError(req, res, mapped.status, mapped.code, mapped.message);
  }
});
