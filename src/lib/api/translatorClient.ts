import { getFreshIdToken } from '../firebase/client.ts';
import type {
  AlternativesResponse,
  AppliedGlossaryEntry,
  ConversationSession,
  DetectLanguageResult,
  DictionaryEntry,
  DocumentTranslationResult,
  ImageTranslationResult,
  ProviderStatus,
  SavedTranslation,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TranslationRequest,
  TranslationResult,
  TranslationTone,
  VoiceTranslationResult,
} from '../../shared/types.ts';
import { resolveApiBaseUrl } from '../../utils/apiUrl.ts';
import {
  formatHttpErrorMessage,
  normalizeImageTranslationResponse,
} from '../../utils/text.ts';

function getApiBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const loc =
    typeof window !== 'undefined' && window.location
      ? { origin: window.location.origin, hostname: window.location.hostname }
      : null;
  return resolveApiBaseUrl(env?.VITE_API_BASE_URL, loc);
}

export function buildApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

async function buildAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = await getFreshIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function handleJsonResponse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(formatHttpErrorMessage(res.status, data.error, 'Request'));
  }
  return data;
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  const res = await fetch(buildApiUrl('/api/providers'), {
    headers: await buildAuthHeaders(),
  });
  const data = await handleJsonResponse<{ providers: ProviderStatus[] }>(res);
  return data.providers;
}

export async function detectLanguageApi(text: string): Promise<DetectLanguageResult> {
  const res = await fetch(buildApiUrl('/api/detect'), {
    method: 'POST',
    headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text }),
  });
  return handleJsonResponse<DetectLanguageResult>(res);
}

export async function translateTextApi(
  payload: TranslationRequest,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  let res: Response;
  try {
    res = await fetch(buildApiUrl('/api/translate'), {
      method: 'POST',
      headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Translation failed. Please check your connection and try again.');
  }
  const data = await handleJsonResponse<TranslationResult>(res);
  if (!data || typeof data !== 'object' || typeof data.translatedText !== 'string') {
    throw new Error('The translation service returned an unexpected response.');
  }
  return data;
}

export async function fetchAlternativesApi(
  payload: TranslationRequest,
): Promise<AlternativesResponse> {
  const res = await fetch(buildApiUrl('/api/translate/alternatives'), {
    method: 'POST',
    headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<AlternativesResponse>(res);
}

export async function lookupDictionaryApi(payload: {
  word: string;
  sentenceContext?: string;
  sourceLang: string;
  targetLang: string;
}): Promise<DictionaryEntry> {
  const res = await fetch(buildApiUrl('/api/dictionary'), {
    method: 'POST',
    headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<DictionaryEntry>(res);
}

export async function translateDocumentApi(params: {
  file: File;
  sourceLang: string;
  targetLang: string;
  tone: TranslationTone;
  context?: string;
  glossaryTerms?: AppliedGlossaryEntry[];
  onUploadProgress?: (percent: number) => void;
}): Promise<DocumentTranslationResult> {
  const token = await getFreshIdToken();

  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', params.file);
    formData.append('sourceLang', params.sourceLang);
    formData.append('targetLang', params.targetLang);
    formData.append('tone', params.tone);
    if (params.context) formData.append('context', params.context);
    if (params.glossaryTerms && params.glossaryTerms.length > 0) {
      formData.append('glossaryTerms', JSON.stringify(params.glossaryTerms));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildApiUrl('/api/translate/document'));
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && params.onUploadProgress) {
        params.onUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}') as DocumentTranslationResult & {
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed);
        } else {
          reject(
            new Error(
              formatHttpErrorMessage(xhr.status, parsed.error, 'Document translation'),
            ),
          );
        }
      } catch {
        reject(new Error(formatHttpErrorMessage(xhr.status, undefined, 'Document translation')));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading document.'));
    xhr.send(formData);
  });
}

export async function translateImageApi(params: {
  file: File;
  sourceLang: string;
  targetLang: string;
}): Promise<ImageTranslationResult> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('sourceLang', params.sourceLang);
  formData.append('targetLang', params.targetLang);

  let res: Response;
  try {
    res = await fetch(buildApiUrl('/api/translate/image'), {
      method: 'POST',
      headers: await buildAuthHeaders(),
      body: formData,
    });
  } catch {
    throw new Error('Translation failed. Please check your connection and try again.');
  }
  const raw = await handleJsonResponse<unknown>(res);
  const normalized = normalizeImageTranslationResponse(raw);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }
  return normalized.data;
}

export async function translateVoiceApi(params: {
  audioBlob: Blob;
  filename?: string;
  sourceLang: string;
  targetLang: string;
}): Promise<VoiceTranslationResult> {
  const formData = new FormData();
  formData.append('file', params.audioBlob, params.filename || 'recording.webm');
  formData.append('sourceLang', params.sourceLang);
  formData.append('targetLang', params.targetLang);

  const res = await fetch(buildApiUrl('/api/translate/voice'), {
    method: 'POST',
    headers: await buildAuthHeaders(),
    body: formData,
  });
  return handleJsonResponse<VoiceTranslationResult>(res);
}

export async function synthesizeSpeechApi(params: {
  text: string;
  voiceName: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  styleHint?: string;
}): Promise<{ base64Wav: string; mimeType: string }> {
  const res = await fetch(buildApiUrl('/api/tts'), {
    method: 'POST',
    headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  return handleJsonResponse<{ base64Wav: string; mimeType: string }>(res);
}

export async function syncPullApi(sinceMs = 0): Promise<SyncPullResponse> {
  const res = await fetch(
    buildApiUrl(`/api/sync/pull?since=${encodeURIComponent(String(sinceMs))}`),
    {
      method: 'GET',
      headers: await buildAuthHeaders(),
    },
  );
  return handleJsonResponse<SyncPullResponse>(res);
}

export async function syncPushApi(payload: SyncPushRequest): Promise<SyncPushResponse> {
  const res = await fetch(buildApiUrl('/api/sync/push'), {
    method: 'POST',
    headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<SyncPushResponse>(res);
}

export async function fetchSavedTranslationsApi(): Promise<SavedTranslation[]> {
  const res = await fetch(buildApiUrl('/api/saved-translations'), {
    method: 'GET',
    headers: await buildAuthHeaders(),
  });
  const data = await handleJsonResponse<{ savedTranslations: SavedTranslation[] }>(res);
  return data.savedTranslations;
}

export async function saveConversationSessionApi(
  session: ConversationSession,
): Promise<ConversationSession> {
  const res = await fetch(buildApiUrl('/api/conversations'), {
    method: 'POST',
    headers: await buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(session),
  });
  const data = await handleJsonResponse<{ conversation: ConversationSession }>(res);
  return data.conversation;
}
