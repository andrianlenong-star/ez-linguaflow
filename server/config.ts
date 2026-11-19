import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig | null {
  try {
    const candidates = [
      path.join(ROOT_DIR, 'firebase-applet-config.json'),
      path.join(process.cwd(), 'firebase-applet-config.json'),
    ];
    let raw: string | null = null;
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        raw = fs.readFileSync(candidate, 'utf-8');
        break;
      }
    }
    if (!raw && process.env.FIREBASE_APPLET_CONFIG_JSON) {
      raw = process.env.FIREBASE_APPLET_CONFIG_JSON;
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
    if (!parsed.projectId || !parsed.firestoreDatabaseId) return null;
    return {
      projectId: parsed.projectId,
      appId: parsed.appId || '',
      apiKey: parsed.apiKey || '',
      authDomain: parsed.authDomain || '',
      firestoreDatabaseId: parsed.firestoreDatabaseId,
      storageBucket: parsed.storageBucket,
    };
  } catch {
    return null;
  }
}

const DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function resolveGeminiModel(): string {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  if (!configured || DEPRECATED_MODELS.has(configured)) {
    return 'gemini-4-hydrogen';
  }
  return configured;
}

function parseAllowedOrigins(): string[] {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export const SERVER_CONFIG = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiVersion: '1.1.0',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: resolveGeminiModel(),
  deeplApiKey: process.env.DEEPL_API_KEY || '',
  maxTextLength: 50000,
  maxDocumentBytes: 15 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxAudioBytes: 15 * 1024 * 1024,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 90000),
  rateLimitWindowMs: 60_000,
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 90),
  allowedOrigins: parseAllowedOrigins(),
  requireAuthForTranslation: process.env.REQUIRE_AUTH_FOR_TRANSLATION === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  firebaseConfig: loadFirebaseAppletConfig(),
};
