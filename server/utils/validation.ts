import type {
  AppSettings,
  ConversationSession,
  FormalityLevel,
  Glossary,
  HistoryItem,
  ProviderId,
  SavedTranslation,
  StyleProfile,
  TranslationTone,
  UserProfile,
} from '../../src/shared/types.ts';
import { sanitizeUserText } from '../../src/utils/text.ts';
import { isValidEntityId, sanitizeEntityId } from '../../src/utils/sync.ts';

const VALID_TONES = new Set<TranslationTone>([
  'natural',
  'formal',
  'informal',
  'professional',
  'academic',
  'business',
  'casual',
  'technical',
  'custom',
]);

const VALID_FORMALITIES = new Set<FormalityLevel>(['default', 'more_formal', 'less_formal']);
const VALID_PROVIDERS = new Set<ProviderId>(['gemini', 'deepl']);
const VALID_VOICES = new Set<AppSettings['ttsVoice']>(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validateIdParam(id: string): ValidationResult<string> {
  if (!isValidEntityId(id)) {
    return {
      ok: false,
      error: 'Invalid resource ID format. IDs must be 1-128 alphanumeric, underscore, or hyphen characters.',
    };
  }
  return { ok: true, data: id };
}

export function validateTone(tone: unknown, fallback: TranslationTone = 'natural'): TranslationTone {
  return typeof tone === 'string' && VALID_TONES.has(tone as TranslationTone)
    ? (tone as TranslationTone)
    : fallback;
}

export function validateFormality(formality: unknown, fallback: FormalityLevel = 'default'): FormalityLevel {
  return typeof formality === 'string' && VALID_FORMALITIES.has(formality as FormalityLevel)
    ? (formality as FormalityLevel)
    : fallback;
}

export function validateProvider(provider: unknown, fallback: ProviderId = 'gemini'): ProviderId {
  return typeof provider === 'string' && VALID_PROVIDERS.has(provider as ProviderId)
    ? (provider as ProviderId)
    : fallback;
}

export function validateProfilePayload(
  body: Record<string, unknown>,
  uid: string,
  tokenEmail: string,
): ValidationResult<UserProfile> {
  const displayName = sanitizeUserText(String(body.displayName || ''), 120).trim();
  const safeName = displayName || tokenEmail.split('@')[0] || 'EduZone Linguaflow User';
  const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl.slice(0, 2048) : undefined;
  const platformRaw = String(body.platformLastSeen || 'shared');
  const platformLastSeen =
    platformRaw === 'web' || platformRaw === 'android' || platformRaw === 'shared'
      ? platformRaw
      : 'shared';

  return {
    ok: true,
    data: {
      uid,
      email: tokenEmail,
      displayName: safeName,
      ...(photoUrl ? { photoUrl } : {}),
      platformLastSeen,
    },
  };
}

export function validatePreferencesPayload(body: Record<string, unknown>): ValidationResult<AppSettings> {
  const theme = body.theme === 'dark' ? 'dark' : 'light';
  const provider = validateProvider(body.provider, 'gemini');
  const ttsSpeedNum = Number(body.ttsSpeed ?? 1.0);
  const ttsSpeed = Number.isFinite(ttsSpeedNum)
    ? Math.max(0.5, Math.min(2.0, ttsSpeedNum))
    : 1.0;

  const customLanguages = Array.isArray(body.customLanguages)
    ? body.customLanguages
        .slice(0, 50)
        .filter((l): l is Record<string, unknown> => Boolean(l && typeof l === 'object'))
        .map((l) => ({
          code: sanitizeUserText(String(l.code || ''), 24).trim(),
          name: sanitizeUserText(String(l.name || ''), 64).trim(),
          nativeName: sanitizeUserText(String(l.nativeName || l.name || ''), 64).trim(),
          bcp47: sanitizeUserText(String(l.bcp47 || l.code || ''), 32).trim(),
          rtl: Boolean(l.rtl),
          supportsFormality: Boolean(l.supportsFormality ?? true),
        }))
        .filter((l) => l.code.length > 0 && l.name.length > 0)
    : [];

  return {
    ok: true,
    data: {
      theme,
      provider,
      autoTranslate: body.autoTranslate !== false,
      autoSaveHistory: body.autoSaveHistory !== false,
      defaultSourceLang: sanitizeUserText(String(body.defaultSourceLang || 'auto'), 32).trim() || 'auto',
      defaultTargetLang: sanitizeUserText(String(body.defaultTargetLang || 'id'), 32).trim() || 'id',
      defaultTone: validateTone(body.defaultTone, 'natural'),
      defaultFormality: validateFormality(body.defaultFormality, 'default'),
      ttsVoice:
        typeof body.ttsVoice === 'string' && VALID_VOICES.has(body.ttsVoice as AppSettings['ttsVoice'])
          ? (body.ttsVoice as AppSettings['ttsVoice'])
          : 'Kore',
      ttsSpeed,
      showPrivacyNotice: body.showPrivacyNotice !== false,
      updatedAt: Number(body.updatedAt) || Date.now(),
      customLanguages,
    },
  };
}

export function validateHistoryPayload(
  body: Record<string, unknown>,
  uid: string,
  forcedId?: string,
): ValidationResult<HistoryItem> {
  const sourceText = sanitizeUserText(String(body.sourceText || ''), 50000);
  if (!sourceText.trim()) {
    return { ok: false, error: 'sourceText is required.' };
  }
  const targetLang = sanitizeUserText(String(body.targetLang || ''), 32).trim();
  if (!targetLang) {
    return { ok: false, error: 'targetLang is required.' };
  }

  const id = forcedId ? forcedId : sanitizeEntityId(typeof body.id === 'string' ? body.id : undefined);
  if (!isValidEntityId(id)) {
    return { ok: false, error: 'Invalid history entry id.' };
  }

  const now = Date.now();
  const createdAt = Number(body.createdAt);
  const updatedAt = Number(body.updatedAt);

  return {
    ok: true,
    data: {
      id,
      userId: uid,
      sourceText,
      translatedText: sanitizeUserText(String(body.translatedText || ''), 50000),
      sourceLang: sanitizeUserText(String(body.sourceLang || 'auto'), 32).trim() || 'auto',
      ...(body.detectedSourceLang
        ? { detectedSourceLang: sanitizeUserText(String(body.detectedSourceLang), 32).trim() }
        : {}),
      targetLang,
      tone: validateTone(body.tone, 'natural'),
      ...(body.context ? { context: sanitizeUserText(String(body.context), 500).trim() } : {}),
      provider: validateProvider(body.provider, 'gemini'),
      favorite: Boolean(body.favorite),
      saved: Boolean(body.saved),
      deleted: Boolean(body.deleted),
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now,
    },
  };
}

export function validateSavedTranslationPayload(
  body: Record<string, unknown>,
  uid: string,
  forcedId?: string,
): ValidationResult<SavedTranslation> {
  const sourceText = sanitizeUserText(String(body.sourceText || ''), 50000);
  if (!sourceText.trim()) {
    return { ok: false, error: 'sourceText is required.' };
  }
  const targetLang = sanitizeUserText(String(body.targetLang || ''), 32).trim();
  if (!targetLang) {
    return { ok: false, error: 'targetLang is required.' };
  }

  const id = forcedId ? forcedId : sanitizeEntityId(typeof body.id === 'string' ? body.id : undefined);
  if (!isValidEntityId(id)) {
    return { ok: false, error: 'Invalid saved translation id.' };
  }

  const tags = Array.isArray(body.tags)
    ? body.tags
        .slice(0, 20)
        .map((t) => sanitizeUserText(String(t || ''), 40).trim())
        .filter(Boolean)
    : [];

  const now = Date.now();
  const createdAt = Number(body.createdAt);
  const updatedAt = Number(body.updatedAt);

  return {
    ok: true,
    data: {
      id,
      userId: uid,
      sourceText,
      translatedText: sanitizeUserText(String(body.translatedText || ''), 50000),
      sourceLang: sanitizeUserText(String(body.sourceLang || 'auto'), 32).trim() || 'auto',
      ...(body.detectedSourceLang
        ? { detectedSourceLang: sanitizeUserText(String(body.detectedSourceLang), 32).trim() }
        : {}),
      targetLang,
      tone: validateTone(body.tone, 'natural'),
      ...(body.context ? { context: sanitizeUserText(String(body.context), 500).trim() } : {}),
      provider: validateProvider(body.provider, 'gemini'),
      tags,
      deleted: Boolean(body.deleted),
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now,
    },
  };
}

export function validateGlossaryPayload(
  body: Record<string, unknown>,
  uid: string,
  forcedId?: string,
): ValidationResult<Glossary> {
  const name = sanitizeUserText(String(body.name || ''), 120).trim();
  if (!name) {
    return { ok: false, error: 'Glossary name is required.' };
  }
  const id = forcedId ? forcedId : sanitizeEntityId(typeof body.id === 'string' ? body.id : undefined);
  if (!isValidEntityId(id)) {
    return { ok: false, error: 'Invalid glossary id.' };
  }

  const terms = Array.isArray(body.terms)
    ? body.terms
        .slice(0, 500)
        .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
        .map((t) => ({
          id: sanitizeEntityId(typeof t.id === 'string' ? t.id : undefined),
          sourceTerm: sanitizeUserText(String(t.sourceTerm || ''), 200).trim(),
          targetTerm: sanitizeUserText(String(t.targetTerm || ''), 200).trim(),
          ...(t.notes ? { notes: sanitizeUserText(String(t.notes), 200).trim() } : {}),
        }))
        .filter((t) => t.sourceTerm.length > 0 && t.targetTerm.length > 0)
    : [];

  const updatedAt = Number(body.updatedAt);

  return {
    ok: true,
    data: {
      id,
      userId: uid,
      name,
      sourceLang: sanitizeUserText(String(body.sourceLang || 'auto'), 32).trim() || 'auto',
      targetLang: sanitizeUserText(String(body.targetLang || 'id'), 32).trim() || 'id',
      enabled: body.enabled !== false,
      terms,
      deleted: Boolean(body.deleted),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    },
  };
}

export function validateStyleProfilePayload(
  body: Record<string, unknown>,
  uid: string,
  forcedId?: string,
): ValidationResult<StyleProfile> {
  const name = sanitizeUserText(String(body.name || ''), 120).trim();
  if (!name) {
    return { ok: false, error: 'Style profile name is required.' };
  }
  const id = forcedId ? forcedId : sanitizeEntityId(typeof body.id === 'string' ? body.id : undefined);
  if (!isValidEntityId(id)) {
    return { ok: false, error: 'Invalid style profile id.' };
  }

  const updatedAt = Number(body.updatedAt);

  return {
    ok: true,
    data: {
      id,
      userId: uid,
      name,
      tone: validateTone(body.tone, 'professional'),
      formality: validateFormality(body.formality, 'default'),
      writingStyle: sanitizeUserText(String(body.writingStyle || ''), 1000).trim(),
      preferredTerminology: sanitizeUserText(String(body.preferredTerminology || ''), 1000).trim(),
      customInstructions: sanitizeUserText(String(body.customInstructions || ''), 2000).trim(),
      isDefault: Boolean(body.isDefault),
      deleted: Boolean(body.deleted),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    },
  };
}

export function validateConversationPayload(
  body: Record<string, unknown>,
  uid: string,
  forcedId?: string,
): ValidationResult<ConversationSession> {
  const title = sanitizeUserText(String(body.title || 'Voice Conversation'), 160).trim() || 'Voice Conversation';
  const id = forcedId ? forcedId : sanitizeEntityId(typeof body.id === 'string' ? body.id : undefined);
  if (!isValidEntityId(id)) {
    return { ok: false, error: 'Invalid conversation id.' };
  }

  const turns = Array.isArray(body.turns)
    ? body.turns
        .slice(0, 200)
        .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
        .map((t) => ({
          id: sanitizeEntityId(typeof t.id === 'string' ? t.id : undefined),
          speaker: (t.speaker === 'speaker2' ? 'speaker2' : 'speaker1') as 'speaker1' | 'speaker2',
          speakerLabel: sanitizeUserText(String(t.speakerLabel || 'Speaker'), 40).trim(),
          sourceLang: sanitizeUserText(String(t.sourceLang || 'auto'), 32).trim() || 'auto',
          targetLang: sanitizeUserText(String(t.targetLang || 'id'), 32).trim() || 'id',
          ...(t.detectedLang ? { detectedLang: sanitizeUserText(String(t.detectedLang), 32).trim() } : {}),
          originalText: sanitizeUserText(String(t.originalText || ''), 5000),
          translatedText: sanitizeUserText(String(t.translatedText || ''), 5000),
          timestamp: Number(t.timestamp) || Date.now(),
        }))
    : [];

  const updatedAt = Number(body.updatedAt);

  return {
    ok: true,
    data: {
      id,
      userId: uid,
      title,
      speaker1Lang: sanitizeUserText(String(body.speaker1Lang || 'en'), 32).trim() || 'en',
      speaker2Lang: sanitizeUserText(String(body.speaker2Lang || 'id'), 32).trim() || 'id',
      turns,
      deleted: Boolean(body.deleted),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    },
  };
}
