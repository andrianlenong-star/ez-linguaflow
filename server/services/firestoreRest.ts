import { SERVER_CONFIG } from '../config.ts';
import type { AuthenticatedUser } from '../middleware/auth.ts';
import type {
  AppSettings,
  ConversationSession,
  Glossary,
  HistoryItem,
  SavedTranslation,
  StyleProfile,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  UserProfile,
} from '../../src/shared/types.ts';

export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return { integerValue: String(val) };
    }
    return { doubleValue: Number.isFinite(val) ? val : 0 };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.filter((v) => v !== undefined).map((v) => toFirestoreValue(v)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(fv?: FirestoreValue): unknown {
  if (!fv) return undefined;
  if ('nullValue' in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('stringValue' in fv) return fv.stringValue;
  if ('arrayValue' in fv) {
    return (fv.arrayValue.values || []).map((item) => fromFirestoreValue(item));
  }
  if ('mapValue' in fv) {
    const out: Record<string, unknown> = {};
    const fields = fv.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

export function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

export function fromFirestoreFields(doc: FirestoreDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!doc.fields) return out;
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function getBaseUrls() {
  const cfg = SERVER_CONFIG.firebaseConfig;
  if (!cfg) {
    throw new Error('Firebase configuration is not available.');
  }
  const dbRoot = `projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents`;
  return {
    dbRoot,
    apiBase: `https://firestore.googleapis.com/v1/${dbRoot}`,
  };
}

async function getDocument(docRelPath: string, idToken: string): Promise<FirestoreDocument | null> {
  const { apiBase } = getBaseUrls();
  const res = await fetch(`${apiBase}/${docRelPath}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore GET ${docRelPath} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as FirestoreDocument;
}

async function upsertDocumentWithServerTimestamps(
  docRelPath: string,
  data: Record<string, unknown>,
  immutableOnUpdate: string[],
  idToken: string,
): Promise<void> {
  const { dbRoot, apiBase } = getBaseUrls();
  const existing = await getDocument(docRelPath, idToken);
  const fullDocName = `${dbRoot}/${docRelPath}`;

  if (!existing) {
    const res = await fetch(`${apiBase}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: fullDocName,
              fields: toFirestoreFields(data),
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
            currentDocument: { exists: false },
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firestore CREATE ${docRelPath} failed (${res.status}): ${text}`);
    }
    return;
  }

  const mutableFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!immutableOnUpdate.includes(k) && v !== undefined) {
      mutableFields[k] = v;
    }
  }
  const fieldPaths = Object.keys(mutableFields);

  const res = await fetch(`${apiBase}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: fullDocName,
            fields: toFirestoreFields(mutableFields),
          },
          updateMask: { fieldPaths },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: true },
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore UPDATE ${docRelPath} failed (${res.status}): ${text}`);
  }
}

async function deleteDocumentHard(docRelPath: string, idToken: string): Promise<void> {
  const { apiBase } = getBaseUrls();
  const res = await fetch(`${apiBase}/${docRelPath}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore DELETE ${docRelPath} failed (${res.status}): ${text}`);
  }
}

async function queryUserSubcollection(
  uid: string,
  collectionId: string,
  idToken: string,
  limit = 500,
): Promise<Array<Record<string, unknown>>> {
  const { apiBase } = getBaseUrls();
  const res = await fetch(`${apiBase}/users/${uid}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'userId' },
            op: 'EQUAL',
            value: { stringValue: uid },
          },
        },
        limit,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore QUERY users/${uid}/${collectionId} failed (${res.status}): ${text}`);
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreDocument }>;
  return rows
    .filter((row) => Boolean(row.document))
    .map((row) => fromFirestoreFields(row.document as FirestoreDocument));
}

export async function ensureUserProfile(
  auth: AuthenticatedUser,
  platform: 'web' | 'android' | 'shared' = 'shared',
): Promise<UserProfile> {
  const docPath = `users/${auth.uid}`;
  const existing = await getDocument(docPath, auth.idToken);
  if (existing) {
    const parsed = fromFirestoreFields(existing);
    return {
      uid: String(parsed.uid || auth.uid),
      email: String(parsed.email || auth.email),
      displayName: String(parsed.displayName || auth.displayName),
      ...(parsed.photoUrl ? { photoUrl: String(parsed.photoUrl) } : {}),
      platformLastSeen:
        parsed.platformLastSeen === 'web' ||
        parsed.platformLastSeen === 'android' ||
        parsed.platformLastSeen === 'shared'
          ? parsed.platformLastSeen
          : 'shared',
    };
  }

  const profile: UserProfile = {
    uid: auth.uid,
    email: auth.email,
    displayName: auth.displayName,
    ...(auth.photoUrl ? { photoUrl: auth.photoUrl } : {}),
    platformLastSeen: platform,
  };
  await upsertDocumentWithServerTimestamps(docPath, { ...profile }, ['uid', 'createdAt'], auth.idToken);
  return profile;
}

export async function getUserProfile(auth: AuthenticatedUser): Promise<UserProfile> {
  return ensureUserProfile(auth);
}

export async function upsertUserProfile(
  auth: AuthenticatedUser,
  profile: UserProfile,
): Promise<UserProfile> {
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}`,
    { ...profile, uid: auth.uid, email: auth.email },
    ['uid', 'createdAt'],
    auth.idToken,
  );
  return profile;
}

function mapDocToPreferences(raw: Record<string, unknown>): AppSettings {
  return {
    theme: raw.theme === 'dark' ? 'dark' : 'light',
    provider: raw.provider === 'deepl' ? 'deepl' : 'gemini',
    autoTranslate: Boolean(raw.autoTranslate ?? true),
    autoSaveHistory: Boolean(raw.autoSaveHistory ?? true),
    defaultSourceLang: String(raw.defaultSourceLang || 'auto'),
    defaultTargetLang: String(raw.defaultTargetLang || 'id'),
    defaultTone: (raw.defaultTone as AppSettings['defaultTone']) || 'natural',
    defaultFormality: (raw.defaultFormality as AppSettings['defaultFormality']) || 'default',
    ttsVoice: (raw.ttsVoice as AppSettings['ttsVoice']) || 'Kore',
    ttsSpeed: Number(raw.ttsSpeed || 1.0),
    showPrivacyNotice: Boolean(raw.showPrivacyNotice ?? true),
    updatedAt: Number(raw.updatedAtMs || Date.now()),
    customLanguages: Array.isArray(raw.customLanguages)
      ? (raw.customLanguages as AppSettings['customLanguages'])
      : [],
  };
}

export async function getUserPreferences(auth: AuthenticatedUser): Promise<AppSettings | null> {
  const doc = await getDocument(`users/${auth.uid}/preferences/default`, auth.idToken);
  if (!doc) return null;
  return mapDocToPreferences(fromFirestoreFields(doc));
}

export async function saveUserPreferences(
  auth: AuthenticatedUser,
  prefs: AppSettings,
): Promise<AppSettings> {
  await ensureUserProfile(auth);
  const updatedAtMs = prefs.updatedAt || Date.now();
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/preferences/default`,
    {
      userId: auth.uid,
      theme: prefs.theme,
      provider: prefs.provider,
      autoTranslate: prefs.autoTranslate,
      autoSaveHistory: prefs.autoSaveHistory,
      defaultSourceLang: prefs.defaultSourceLang,
      defaultTargetLang: prefs.defaultTargetLang,
      defaultTone: prefs.defaultTone,
      defaultFormality: prefs.defaultFormality,
      ttsVoice: prefs.ttsVoice,
      ttsSpeed: prefs.ttsSpeed,
      showPrivacyNotice: prefs.showPrivacyNotice,
      customLanguages: prefs.customLanguages,
      updatedAtMs,
    },
    ['userId', 'createdAt'],
    auth.idToken,
  );
  return { ...prefs, updatedAt: updatedAtMs };
}

function mapDocToHistoryItem(raw: Record<string, unknown>): HistoryItem {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    sourceText: String(raw.sourceText || ''),
    translatedText: String(raw.translatedText || ''),
    sourceLang: String(raw.sourceLang || 'auto'),
    ...(raw.detectedSourceLang ? { detectedSourceLang: String(raw.detectedSourceLang) } : {}),
    targetLang: String(raw.targetLang || 'id'),
    tone: (raw.tone as HistoryItem['tone']) || 'natural',
    ...(raw.context ? { context: String(raw.context) } : {}),
    provider: raw.provider === 'deepl' ? 'deepl' : 'gemini',
    favorite: Boolean(raw.favorite),
    saved: Boolean(raw.saved),
    deleted: Boolean(raw.deleted),
    createdAt: Number(raw.createdAtMs || Date.now()),
    updatedAt: Number(raw.updatedAtMs || raw.createdAtMs || Date.now()),
  };
}

export async function listHistory(
  auth: AuthenticatedUser,
  options?: { includeDeleted?: boolean; sinceMs?: number },
): Promise<HistoryItem[]> {
  const rows = await queryUserSubcollection(auth.uid, 'history', auth.idToken);
  return rows
    .map(mapDocToHistoryItem)
    .filter((item) => (options?.includeDeleted ? true : !item.deleted))
    .filter((item) => (options?.sinceMs ? (item.updatedAt ?? item.createdAt) >= options.sinceMs : true))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function upsertHistoryItem(
  auth: AuthenticatedUser,
  item: HistoryItem,
): Promise<HistoryItem> {
  await ensureUserProfile(auth);
  const createdAtMs = item.createdAt || Date.now();
  const updatedAtMs = item.updatedAt || createdAtMs;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/history/${item.id}`,
    {
      id: item.id,
      userId: auth.uid,
      sourceText: item.sourceText,
      translatedText: item.translatedText,
      sourceLang: item.sourceLang,
      ...(item.detectedSourceLang ? { detectedSourceLang: item.detectedSourceLang } : {}),
      targetLang: item.targetLang,
      tone: item.tone,
      ...(item.context ? { context: item.context } : {}),
      provider: item.provider,
      favorite: Boolean(item.favorite),
      saved: Boolean(item.saved),
      deleted: Boolean(item.deleted),
      createdAtMs,
      updatedAtMs,
    },
    ['id', 'userId', 'createdAt', 'createdAtMs'],
    auth.idToken,
  );
  return { ...item, userId: auth.uid, createdAt: createdAtMs, updatedAt: updatedAtMs };
}

export async function softDeleteHistoryItem(auth: AuthenticatedUser, id: string): Promise<void> {
  const existing = await getDocument(`users/${auth.uid}/history/${id}`, auth.idToken);
  if (!existing) return;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/history/${id}`,
    {
      deleted: true,
      updatedAtMs: Date.now(),
    },
    ['id', 'userId', 'createdAt', 'createdAtMs'],
    auth.idToken,
  );
}

export async function clearAllHistory(auth: AuthenticatedUser): Promise<number> {
  const items = await listHistory(auth, { includeDeleted: false });
  await Promise.all(items.map((item) => softDeleteHistoryItem(auth, item.id)));
  return items.length;
}

function mapDocToSavedTranslation(raw: Record<string, unknown>): SavedTranslation {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    sourceText: String(raw.sourceText || ''),
    translatedText: String(raw.translatedText || ''),
    sourceLang: String(raw.sourceLang || 'auto'),
    ...(raw.detectedSourceLang ? { detectedSourceLang: String(raw.detectedSourceLang) } : {}),
    targetLang: String(raw.targetLang || 'id'),
    tone: (raw.tone as SavedTranslation['tone']) || 'natural',
    ...(raw.context ? { context: String(raw.context) } : {}),
    provider: raw.provider === 'deepl' ? 'deepl' : 'gemini',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    deleted: Boolean(raw.deleted),
    createdAt: Number(raw.createdAtMs || Date.now()),
    updatedAt: Number(raw.updatedAtMs || raw.createdAtMs || Date.now()),
  };
}

export async function listSavedTranslations(
  auth: AuthenticatedUser,
  options?: { includeDeleted?: boolean; sinceMs?: number },
): Promise<SavedTranslation[]> {
  const rows = await queryUserSubcollection(auth.uid, 'savedTranslations', auth.idToken);
  return rows
    .map(mapDocToSavedTranslation)
    .filter((item) => (options?.includeDeleted ? true : !item.deleted))
    .filter((item) => (options?.sinceMs ? item.updatedAt >= options.sinceMs : true))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function upsertSavedTranslation(
  auth: AuthenticatedUser,
  item: SavedTranslation,
): Promise<SavedTranslation> {
  await ensureUserProfile(auth);
  const createdAtMs = item.createdAt || Date.now();
  const updatedAtMs = item.updatedAt || createdAtMs;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/savedTranslations/${item.id}`,
    {
      id: item.id,
      userId: auth.uid,
      sourceText: item.sourceText,
      translatedText: item.translatedText,
      sourceLang: item.sourceLang,
      ...(item.detectedSourceLang ? { detectedSourceLang: item.detectedSourceLang } : {}),
      targetLang: item.targetLang,
      tone: item.tone,
      ...(item.context ? { context: item.context } : {}),
      provider: item.provider,
      tags: item.tags || [],
      deleted: Boolean(item.deleted),
      createdAtMs,
      updatedAtMs,
    },
    ['id', 'userId', 'createdAt', 'createdAtMs'],
    auth.idToken,
  );
  return { ...item, userId: auth.uid, createdAt: createdAtMs, updatedAt: updatedAtMs };
}

export async function softDeleteSavedTranslation(auth: AuthenticatedUser, id: string): Promise<void> {
  const existing = await getDocument(`users/${auth.uid}/savedTranslations/${id}`, auth.idToken);
  if (!existing) return;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/savedTranslations/${id}`,
    {
      deleted: true,
      updatedAtMs: Date.now(),
    },
    ['id', 'userId', 'createdAt', 'createdAtMs'],
    auth.idToken,
  );
}

function mapDocToGlossary(raw: Record<string, unknown>): Glossary {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    name: String(raw.name || ''),
    sourceLang: String(raw.sourceLang || 'auto'),
    targetLang: String(raw.targetLang || 'id'),
    enabled: Boolean(raw.enabled),
    terms: Array.isArray(raw.terms) ? (raw.terms as Glossary['terms']) : [],
    deleted: Boolean(raw.deleted),
    updatedAt: Number(raw.updatedAtMs || Date.now()),
  };
}

export async function listGlossaries(
  auth: AuthenticatedUser,
  options?: { includeDeleted?: boolean; sinceMs?: number },
): Promise<Glossary[]> {
  const rows = await queryUserSubcollection(auth.uid, 'glossaries', auth.idToken);
  return rows
    .map(mapDocToGlossary)
    .filter((item) => (options?.includeDeleted ? true : !item.deleted))
    .filter((item) => (options?.sinceMs ? item.updatedAt >= options.sinceMs : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertGlossary(auth: AuthenticatedUser, glossary: Glossary): Promise<Glossary> {
  await ensureUserProfile(auth);
  const updatedAtMs = glossary.updatedAt || Date.now();
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/glossaries/${glossary.id}`,
    {
      id: glossary.id,
      userId: auth.uid,
      name: glossary.name,
      sourceLang: glossary.sourceLang,
      targetLang: glossary.targetLang,
      enabled: Boolean(glossary.enabled),
      terms: glossary.terms || [],
      deleted: Boolean(glossary.deleted),
      updatedAtMs,
    },
    ['id', 'userId', 'createdAt'],
    auth.idToken,
  );
  return { ...glossary, userId: auth.uid, updatedAt: updatedAtMs };
}

export async function softDeleteGlossary(auth: AuthenticatedUser, id: string): Promise<void> {
  const existing = await getDocument(`users/${auth.uid}/glossaries/${id}`, auth.idToken);
  if (!existing) return;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/glossaries/${id}`,
    {
      deleted: true,
      updatedAtMs: Date.now(),
    },
    ['id', 'userId', 'createdAt'],
    auth.idToken,
  );
}

function mapDocToStyleProfile(raw: Record<string, unknown>): StyleProfile {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    name: String(raw.name || ''),
    tone: (raw.tone as StyleProfile['tone']) || 'professional',
    formality: (raw.formality as StyleProfile['formality']) || 'default',
    writingStyle: String(raw.writingStyle || ''),
    preferredTerminology: String(raw.preferredTerminology || ''),
    customInstructions: String(raw.customInstructions || ''),
    isDefault: Boolean(raw.isDefault),
    deleted: Boolean(raw.deleted),
    updatedAt: Number(raw.updatedAtMs || Date.now()),
  };
}

export async function listStyleProfiles(
  auth: AuthenticatedUser,
  options?: { includeDeleted?: boolean; sinceMs?: number },
): Promise<StyleProfile[]> {
  const rows = await queryUserSubcollection(auth.uid, 'styleProfiles', auth.idToken);
  return rows
    .map(mapDocToStyleProfile)
    .filter((item) => (options?.includeDeleted ? true : !item.deleted))
    .filter((item) => (options?.sinceMs ? item.updatedAt >= options.sinceMs : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertStyleProfile(
  auth: AuthenticatedUser,
  profile: StyleProfile,
): Promise<StyleProfile> {
  await ensureUserProfile(auth);
  const updatedAtMs = profile.updatedAt || Date.now();
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/styleProfiles/${profile.id}`,
    {
      id: profile.id,
      userId: auth.uid,
      name: profile.name,
      tone: profile.tone,
      formality: profile.formality,
      writingStyle: profile.writingStyle,
      preferredTerminology: profile.preferredTerminology,
      customInstructions: profile.customInstructions,
      isDefault: Boolean(profile.isDefault),
      deleted: Boolean(profile.deleted),
      updatedAtMs,
    },
    ['id', 'userId', 'createdAt'],
    auth.idToken,
  );
  return { ...profile, userId: auth.uid, updatedAt: updatedAtMs };
}

export async function softDeleteStyleProfile(auth: AuthenticatedUser, id: string): Promise<void> {
  const existing = await getDocument(`users/${auth.uid}/styleProfiles/${id}`, auth.idToken);
  if (!existing) return;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/styleProfiles/${id}`,
    {
      deleted: true,
      updatedAtMs: Date.now(),
    },
    ['id', 'userId', 'createdAt'],
    auth.idToken,
  );
}

function mapDocToConversation(raw: Record<string, unknown>): ConversationSession {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    title: String(raw.title || 'Voice Conversation'),
    speaker1Lang: String(raw.speaker1Lang || 'en'),
    speaker2Lang: String(raw.speaker2Lang || 'id'),
    turns: Array.isArray(raw.turns) ? (raw.turns as ConversationSession['turns']) : [],
    deleted: Boolean(raw.deleted),
    updatedAt: Number(raw.updatedAtMs || Date.now()),
  };
}

export async function listConversations(
  auth: AuthenticatedUser,
  options?: { includeDeleted?: boolean; sinceMs?: number },
): Promise<ConversationSession[]> {
  const rows = await queryUserSubcollection(auth.uid, 'conversations', auth.idToken);
  return rows
    .map(mapDocToConversation)
    .filter((item) => (options?.includeDeleted ? true : !item.deleted))
    .filter((item) => (options?.sinceMs ? item.updatedAt >= options.sinceMs : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertConversation(
  auth: AuthenticatedUser,
  session: ConversationSession,
): Promise<ConversationSession> {
  await ensureUserProfile(auth);
  const updatedAtMs = session.updatedAt || Date.now();
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/conversations/${session.id}`,
    {
      id: session.id,
      userId: auth.uid,
      title: session.title,
      speaker1Lang: session.speaker1Lang,
      speaker2Lang: session.speaker2Lang,
      turns: session.turns || [],
      deleted: Boolean(session.deleted),
      updatedAtMs,
    },
    ['id', 'userId', 'createdAt'],
    auth.idToken,
  );
  return { ...session, userId: auth.uid, updatedAt: updatedAtMs };
}

export async function softDeleteConversation(auth: AuthenticatedUser, id: string): Promise<void> {
  const existing = await getDocument(`users/${auth.uid}/conversations/${id}`, auth.idToken);
  if (!existing) return;
  await upsertDocumentWithServerTimestamps(
    `users/${auth.uid}/conversations/${id}`,
    {
      deleted: true,
      updatedAtMs: Date.now(),
    },
    ['id', 'userId', 'createdAt'],
    auth.idToken,
  );
}

export async function pullSyncState(
  auth: AuthenticatedUser,
  sinceMs = 0,
): Promise<SyncPullResponse> {
  const profile = await ensureUserProfile(auth);
  const [preferences, history, savedTranslations, glossaries, styleProfiles, conversations] =
    await Promise.all([
      getUserPreferences(auth),
      listHistory(auth, { includeDeleted: true, sinceMs }),
      listSavedTranslations(auth, { includeDeleted: true, sinceMs }),
      listGlossaries(auth, { includeDeleted: true, sinceMs }),
      listStyleProfiles(auth, { includeDeleted: true, sinceMs }),
      listConversations(auth, { includeDeleted: true, sinceMs }),
    ]);

  return {
    serverTimeMs: Date.now(),
    profile,
    preferences,
    history,
    savedTranslations,
    glossaries,
    styleProfiles,
    conversations,
  };
}

export async function pushSyncChanges(
  auth: AuthenticatedUser,
  payload: SyncPushRequest,
): Promise<SyncPushResponse> {
  await ensureUserProfile(auth);

  let prefsAccepted = false;
  if (payload.preferences) {
    await saveUserPreferences(auth, payload.preferences);
    prefsAccepted = true;
  }

  const historyItems = payload.history || [];
  const savedItems = payload.savedTranslations || [];
  const glossaryItems = payload.glossaries || [];
  const profileItems = payload.styleProfiles || [];
  const conversationItems = payload.conversations || [];

  await Promise.all([
    ...historyItems.map((item) => upsertHistoryItem(auth, item)),
    ...savedItems.map((item) => upsertSavedTranslation(auth, item)),
    ...glossaryItems.map((item) => upsertGlossary(auth, item)),
    ...profileItems.map((item) => upsertStyleProfile(auth, item)),
    ...conversationItems.map((item) => upsertConversation(auth, item)),
  ]);

  return {
    serverTimeMs: Date.now(),
    accepted: {
      preferences: prefsAccepted,
      history: historyItems.length,
      savedTranslations: savedItems.length,
      glossaries: glossaryItems.length,
      styleProfiles: profileItems.length,
      conversations: conversationItems.length,
    },
  };
}

export { deleteDocumentHard };
