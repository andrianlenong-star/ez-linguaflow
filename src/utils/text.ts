export interface TextToken {
  text: string;
  isWord: boolean;
  sentence: string;
}

export function countCharacters(text: string): number {
  return text.length;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function sanitizeUserText(input: string, maxLength = 50000): string {
  // Remove null bytes and unsafe ASCII control chars while preserving tabs/newlines
  const cleaned = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned.slice(0, maxLength);
}

/**
 * Splits text into clickable word tokens and non-word whitespace/punctuation tokens
 * while preserving exact newlines, spacing, and extracting the containing sentence.
 */
export function tokenizeClickableText(text: string): TextToken[] {
  if (!text) return [];
  const tokens: TextToken[] = [];
  const wordOrOther = /(\p{L}[\p{L}\p{N}'’-]*|\s+|[^\p{L}\s]+)/gu;

  const sentences = text.split(/(?<=[.!?。\n])\s*/);
  let cursor = 0;

  const findSentenceAt = (index: number): string => {
    let running = 0;
    for (const s of sentences) {
      const pos = text.indexOf(s, running);
      if (pos === -1) continue;
      const end = pos + s.length;
      if (index >= pos && index <= end) {
        return s.trim() || text.slice(Math.max(0, index - 80), index + 80);
      }
      running = end;
    }
    return text.slice(Math.max(0, index - 80), index + 80);
  };

  let match: RegExpExecArray | null;
  while ((match = wordOrOther.exec(text)) !== null) {
    const piece = match[0];
    const isWord = /^\p{L}/u.test(piece);
    tokens.push({
      text: piece,
      isWord,
      sentence: isWord ? findSentenceAt(cursor) : '',
    });
    cursor += piece.length;
  }

  return tokens;
}

export const DOCUMENT_ALLOWED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'txt', 'html', 'htm'] as const;
export const IMAGE_ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;
export const AUDIO_ALLOWED_EXTENSIONS = ['wav', 'mp3', 'webm', 'ogg', 'm4a', 'aac', 'flac', 'mp4'] as const;

export function getFileExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function validateDocumentFile(filename: string, sizeBytes: number, maxBytes = 15 * 1024 * 1024): {
  valid: boolean;
  ext: string;
  error?: string;
} {
  const ext = getFileExtension(filename);
  if (!DOCUMENT_ALLOWED_EXTENSIONS.includes(ext as (typeof DOCUMENT_ALLOWED_EXTENSIONS)[number])) {
    return {
      valid: false,
      ext,
      error: `Unsupported document format ".${ext || 'unknown'}". Supported formats: PDF, DOCX, PPTX, TXT, HTML.`,
    };
  }
  if (sizeBytes <= 0) {
    return { valid: false, ext, error: 'The selected file is empty.' };
  }
  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      ext,
      error: `File exceeds maximum size limit of ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }
  return { valid: true, ext };
}

export function validateImageFile(filename: string, sizeBytes: number, maxBytes = 10 * 1024 * 1024): {
  valid: boolean;
  ext: string;
  error?: string;
} {
  const ext = getFileExtension(filename);
  if (!IMAGE_ALLOWED_EXTENSIONS.includes(ext as (typeof IMAGE_ALLOWED_EXTENSIONS)[number])) {
    return {
      valid: false,
      ext,
      error: `Unsupported image format ".${ext || 'unknown'}". Supported formats: JPG, JPEG, PNG, WEBP.`,
    };
  }
  if (sizeBytes <= 0) {
    return { valid: false, ext, error: 'The selected image is empty.' };
  }
  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      ext,
      error: `Image exceeds maximum size limit of ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }
  return { valid: true, ext };
}

export function validateAudioFile(filename: string, sizeBytes: number, maxBytes = 15 * 1024 * 1024): {
  valid: boolean;
  ext: string;
  error?: string;
} {
  const ext = getFileExtension(filename);
  if (!AUDIO_ALLOWED_EXTENSIONS.includes(ext as (typeof AUDIO_ALLOWED_EXTENSIONS)[number])) {
    return {
      valid: false,
      ext,
      error: `Unsupported audio format ".${ext || 'unknown'}". Supported formats: WAV, MP3, WEBM, OGG, M4A, AAC, FLAC.`,
    };
  }
  if (sizeBytes <= 0) {
    return { valid: false, ext, error: 'The selected audio file is empty.' };
  }
  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      ext,
      error: `Audio exceeds maximum size limit of ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }
  return { valid: true, ext };
}

export function formatHttpErrorMessage(
  status: number,
  serverError?: string,
  actionLabel = 'Request',
): string {
  if (serverError && serverError.trim()) {
    return serverError.trim();
  }
  if (status === 401) {
    return 'Authentication required or session expired (HTTP 401). Please sign in again to sync.';
  }
  if (status === 403) {
    return 'Access forbidden by server or preview session proxy (HTTP 403). If using AI Studio preview or Vercel, refresh the page and ensure your request origin is allowed.';
  }
  if (status === 404) {
    return 'Backend API endpoint not found (404). Make sure the server /api routes or Vercel Serverless Functions are deployed.';
  }
  if (status === 413) {
    return 'Uploaded file or payload is too large (HTTP 413). Please choose a smaller file.';
  }
  if (status === 429) {
    return 'Too many requests in a short period (HTTP 429). Please wait a few seconds and try again.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return `Translation service is temporarily unavailable or timed out (HTTP ${status}). Please try again in a few seconds.`;
  }
  return `${actionLabel} failed with status ${status}`;
}

export function normalizeAudioMimeType(rawMime?: string, ext?: string): string {
  const baseMime = (rawMime || '').split(';')[0].trim().toLowerCase();
  const mimeAliases: Record<string, string> = {
    'audio/wave': 'audio/wav',
    'audio/x-wav': 'audio/wav',
    'audio/vnd.wave': 'audio/wav',
    'audio/x-m4a': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'audio/mp4a-latm': 'audio/mp4',
    'audio/mpeg': 'audio/mp3',
    'audio/mpeg3': 'audio/mp3',
    'audio/x-mpeg-3': 'audio/mp3',
    'video/webm': 'audio/webm',
    'video/mp4': 'audio/mp4',
  };
  if (baseMime && baseMime !== 'application/octet-stream') {
    return mimeAliases[baseMime] || baseMime;
  }
  const extMimeMap: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mp3',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    mp4: 'audio/mp4',
  };
  return extMimeMap[(ext || '').toLowerCase()] || 'audio/webm';
}

export function pickAudioRecordingFilename(mimeType?: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base.includes('mp4') || base.includes('m4a')) return 'mic-recording.mp4';
  if (base.includes('ogg')) return 'mic-recording.ogg';
  if (base.includes('wav')) return 'mic-recording.wav';
  if (base.includes('aac')) return 'mic-recording.aac';
  if (base.includes('mp3') || base.includes('mpeg')) return 'mic-recording.mp3';
  return 'mic-recording.webm';
}

export function safeParseModelJson<T>(rawText: string): T {
  let cleaned = (rawText || '{}').trim();
  const fenced = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    cleaned = fenced[1].trim();
  }
  return JSON.parse(cleaned) as T;
}

export function normalizeSpeakableText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}
