import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLanguageByCode,
  isRtlLanguage,
  searchLanguages,
  SUPPORTED_LANGUAGES,
} from '../shared/languages.ts';
import {
  exportGlossaryToCsv,
  findApplicableGlossaryTerms,
  parseGlossaryCsv,
} from './glossary.ts';
import {
  countCharacters,
  countWords,
  formatHttpErrorMessage,
  normalizeAudioMimeType,
  normalizeImageTranslationResponse,
  pickAudioRecordingFilename,
  safeParseModelJson,
  sanitizeUserText,
  tokenizeClickableText,
  validateAudioFile,
  validateDocumentFile,
  validateImageFile,
} from './text.ts';

test('supported languages include all 20 prioritized languages', () => {
  assert.ok(SUPPORTED_LANGUAGES.length >= 20);
  assert.equal(getLanguageByCode('id')?.name, 'Indonesian');
  assert.equal(getLanguageByCode('zh-Hans')?.name, 'Chinese (Simplified)');
  assert.equal(isRtlLanguage('ar'), true);
  assert.equal(isRtlLanguage('en'), false);
  assert.ok(searchLanguages('bahasa').length >= 2);
});

test('glossary CSV parser handles headers, quoted commas, and escaped quotes', () => {
  const csv = [
    'source,target,notes',
    '"cloud, native","komputasi awan","Tech ""term"""',
    'API Gateway,Gerbang API,Infrastructure',
    'API Gateway,Duplicate Should Ignore,Dup',
    '',
  ].join('\n');

  const parsed = parseGlossaryCsv(csv);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    sourceTerm: 'cloud, native',
    targetTerm: 'komputasi awan',
    notes: 'Tech "term"',
  });
  assert.equal(parsed[1].sourceTerm, 'API Gateway');
});

test('glossary CSV export round-trips safely', () => {
  const csv = exportGlossaryToCsv([
    { id: '1', sourceTerm: 'zero-trust, mesh', targetTerm: 'jaringan tanpa kepercayaan', notes: 'Security "v2"' },
  ]);
  const reparsed = parseGlossaryCsv(csv);
  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].sourceTerm, 'zero-trust, mesh');
  assert.equal(reparsed[0].notes, 'Security "v2"');
});

test('findApplicableGlossaryTerms matches enabled glossaries for language pair and whole words', () => {
  const glossaries = [
    {
      id: 'g1',
      name: 'Tech EN-ID',
      sourceLang: 'en',
      targetLang: 'id',
      enabled: true,
      updatedAt: 1,
      terms: [
        { id: 't1', sourceTerm: 'cloud-native', targetTerm: 'berbasis komputasi awan' },
        { id: 't2', sourceTerm: 'art', targetTerm: 'seni' },
      ],
    },
    {
      id: 'g2',
      name: 'Disabled EN-ID',
      sourceLang: 'en',
      targetLang: 'id',
      enabled: false,
      updatedAt: 1,
      terms: [{ id: 't3', sourceTerm: 'platform', targetTerm: 'wahana' }],
    },
  ];

  // Should match 'cloud-native', should NOT match 'art' inside 'article', and should ignore disabled glossary 'platform'
  const matches = findApplicableGlossaryTerms(
    'This article describes a cloud-native platform.',
    glossaries,
    'auto',
    'id',
  );
  assert.deepEqual(matches, [
    { sourceTerm: 'cloud-native', targetTerm: 'berbasis komputasi awan' },
  ]);
});

test('tokenizeClickableText preserves paragraphs, newlines, and attaches sentence context', () => {
  const text = 'Hello world.\nSecond paragraph!';
  const tokens = tokenizeClickableText(text);
  assert.equal(tokens.map((t) => t.text).join(''), text);
  const worldToken = tokens.find((t) => t.text === 'world');
  assert.ok(worldToken?.isWord);
  assert.equal(worldToken?.sentence, 'Hello world.');
});

test('text counters, sanitization, and file validators enforce constraints', () => {
  assert.equal(countCharacters('abc\ndef'), 7);
  assert.equal(countWords('  one   two\nthree '), 3);
  assert.equal(sanitizeUserText('hi\u0000there\nok'), 'hithere\nok');

  assert.equal(validateDocumentFile('report.pdf', 1024).valid, true);
  assert.equal(validateDocumentFile('deck.pptx', 1024).valid, true);
  assert.equal(validateDocumentFile('virus.exe', 1024).valid, false);
  assert.equal(validateDocumentFile('empty.txt', 0).valid, false);

  assert.equal(validateImageFile('photo.webp', 2048).valid, true);
  assert.equal(validateImageFile('vector.svg', 2048).valid, false);

  assert.equal(validateAudioFile('voice.wav', 4096).valid, true);
  assert.equal(validateAudioFile('clip.mp3', 4096).valid, true);
  assert.equal(validateAudioFile('bad.exe', 4096).valid, false);
  assert.equal(validateAudioFile('empty.webm', 0).valid, false);
  assert.equal(validateAudioFile('huge.wav', 20 * 1024 * 1024).valid, false);
});

import {
  deriveSavedTranslationsFromHistory,
  filterSyncableEntitiesForUser,
  isValidEntityId,
  mergePreferences,
  mergeTimestampedEntities,
  sanitizeEntityId,
  toggleHistoryFavoriteState,
} from './sync.ts';
import {
  extractBearerToken,
  validateFirebaseClaims,
} from '../../server/middleware/auth.ts';
import {
  fromFirestoreFields,
  toFirestoreFields,
} from '../../server/services/firestoreRest.ts';
import {
  validateGlossaryPayload,
  validateHistoryPayload,
  validateIdParam,
  validatePreferencesPayload,
} from '../../server/utils/validation.ts';
import type { AppSettings, HistoryItem } from '../shared/types.ts';

test('sync merge respects last-write-wins timestamps and soft-delete tombstones', () => {
  const local: HistoryItem[] = [
    {
      id: 'h1',
      sourceText: 'Hello',
      translatedText: 'Halo',
      sourceLang: 'en',
      targetLang: 'id',
      tone: 'natural',
      provider: 'gemini',
      favorite: false,
      saved: false,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'h2',
      sourceText: 'Only local',
      translatedText: 'Hanya lokal',
      sourceLang: 'en',
      targetLang: 'id',
      tone: 'natural',
      provider: 'gemini',
      favorite: true,
      saved: true,
      createdAt: 2000,
      updatedAt: 2000,
    },
  ];
  const remote: HistoryItem[] = [
    {
      id: 'h1',
      sourceText: 'Hello',
      translatedText: 'Halo (Android update)',
      sourceLang: 'en',
      targetLang: 'id',
      tone: 'formal',
      provider: 'gemini',
      favorite: true,
      saved: true,
      createdAt: 1000,
      updatedAt: 3000,
    },
    {
      id: 'h2',
      sourceText: 'Only local',
      translatedText: 'Hanya lokal',
      sourceLang: 'en',
      targetLang: 'id',
      tone: 'natural',
      provider: 'gemini',
      favorite: true,
      saved: true,
      deleted: true,
      createdAt: 2000,
      updatedAt: 4000,
    },
  ];

  const merged = mergeTimestampedEntities(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'h1');
  assert.equal(merged[0].translatedText, 'Halo (Android update)');

  const saved = deriveSavedTranslationsFromHistory(merged);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].tags, ['favorite']);
});

test('mergePreferences picks newer updatedAt settings and ID helpers enforce safe regex', () => {
  const local: AppSettings = {
    theme: 'light',
    provider: 'gemini',
    autoTranslate: true,
    autoSaveHistory: true,
    defaultSourceLang: 'auto',
    defaultTargetLang: 'id',
    defaultTone: 'natural',
    defaultFormality: 'default',
    ttsVoice: 'Kore',
    ttsSpeed: 1.0,
    showPrivacyNotice: true,
    updatedAt: 1000,
    customLanguages: [],
  };
  const remote: AppSettings = { ...local, theme: 'dark', updatedAt: 2000 };
  assert.equal(mergePreferences(local, remote).theme, 'dark');
  assert.equal(isValidEntityId('valid_id-123'), true);
  assert.equal(isValidEntityId('../bad/id'), false);
  assert.ok(isValidEntityId(sanitizeEntityId('bad/id?x')));
});

test('Firebase token extractor and claims validator reject unverified or mismatched tokens', () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken('Basic abc'), null);
  assert.equal(extractBearerToken('Bearer short'), null);
  assert.equal(extractBearerToken('Bearer valid.jwt.token.string.123456'), 'valid.jwt.token.string.123456');

  const ok = validateFirebaseClaims(
    {
      sub: 'user123',
      aud: 'proj-1',
      iss: 'https://securetoken.google.com/proj-1',
      email: 'user@example.com',
      email_verified: true,
      name: 'Andri',
    },
    'proj-1',
  );
  assert.equal(ok.valid, true);

  const unverified = validateFirebaseClaims(
    {
      sub: 'user123',
      aud: 'proj-1',
      iss: 'https://securetoken.google.com/proj-1',
      email: 'user@example.com',
      email_verified: false,
    },
    'proj-1',
  );
  assert.equal(unverified.valid, false);
});

test('Firestore value encoder/decoder round-trips nested arrays and maps faithfully', () => {
  const input = {
    id: 'g1',
    enabled: true,
    count: 42,
    speed: 1.25,
    terms: [{ id: 't1', sourceTerm: 'cloud', targetTerm: 'awan' }],
  };
  const encoded = toFirestoreFields(input);
  const decoded = fromFirestoreFields({ name: 'doc', fields: encoded });
  assert.deepEqual(decoded, input);
});

test('server payload validators reject invalid inputs and enforce bounds', () => {
  assert.equal(validateIdParam('bad/id').ok, false);
  assert.equal(validateHistoryPayload({ sourceText: '' }, 'u1').ok, false);
  const hist = validateHistoryPayload(
    { sourceText: 'Hello', translatedText: 'Halo', targetLang: 'id' },
    'u1',
  );
  assert.equal(hist.ok, true);
  if (hist.ok) {
    assert.equal(hist.data.userId, 'u1');
  }
  const gloss = validateGlossaryPayload({ name: 'Tech', terms: [{ sourceTerm: 'a', targetTerm: 'b' }] }, 'u1');
  assert.equal(gloss.ok, true);
  const prefs = validatePreferencesPayload({ ttsSpeed: 99, theme: 'dark' });
  assert.equal(prefs.ok, true);
  if (prefs.ok) {
    assert.equal(prefs.data.ttsSpeed, 2.0);
    assert.equal(prefs.data.theme, 'dark');
  }
});

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import vercelHandler, { normalizeVercelApiUrl } from '../../api/index.ts';

test('normalizeVercelApiUrl reconstructs /api subpaths from Vercel rewrites cleanly', () => {
  assert.equal(normalizeVercelApiUrl('/api/index?__path=translate'), '/api/translate');
  assert.equal(
    normalizeVercelApiUrl('/api/index?__path=sync/pull&since=12345'),
    '/api/sync/pull?since=12345',
  );
  assert.equal(normalizeVercelApiUrl('/api/index'), '/api/health');
  assert.equal(normalizeVercelApiUrl('/api'), '/api/health');
  assert.equal(normalizeVercelApiUrl('/api/providers'), '/api/providers');
});

test('Vercel serverless handler serves /api endpoints without returning static 404', async () => {
  const server = http.createServer((req, res) => vercelHandler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/index?__path=health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean; databaseConfigured: boolean };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.databaseConfigured, true);

    const langRes = await fetch(`${baseUrl}/api/index?__path=languages`);
    assert.equal(langRes.status, 200);
    const langJson = (await langRes.json()) as { languages: unknown[] };
    assert.ok(Array.isArray(langJson.languages) && langJson.languages.length >= 20);

    const invalidTranslateRes = await fetch(`${baseUrl}/api/index?__path=translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ', targetLang: 'id' }),
    });
    assert.equal(invalidTranslateRes.status, 400);
    const invalidJson = (await invalidTranslateRes.json()) as { code: string };
    assert.equal(invalidJson.code, 'INVALID_INPUT');

    const tooLongRes = await fetch(`${baseUrl}/api/index?__path=translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(50_005), targetLang: 'id' }),
    });
    assert.equal(tooLongRes.status, 400);
    const tooLongJson = (await tooLongRes.json()) as { code: string };
    assert.equal(tooLongJson.code, 'TEXT_TOO_LONG');

    const unauthHistoryRes = await fetch(`${baseUrl}/api/index?__path=history`);
    assert.equal(unauthHistoryRes.status, 401);

    const missingRes = await fetch(`${baseUrl}/api/index?__path=does-not-exist`);
    assert.equal(missingRes.status, 404);
    const missingJson = (await missingRes.json()) as { code: string };
    assert.equal(missingJson.code, 'NOT_FOUND');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { formatAuthErrorMessage } from './authErrors.ts';

test('formatAuthErrorMessage provides actionable Firebase domain errors and ignores benign popup closes', () => {
  assert.equal(formatAuthErrorMessage({ code: 'auth/popup-closed-by-user' }), null);
  assert.equal(formatAuthErrorMessage({ code: 'auth/cancelled-popup-request' }), null);
  const unauthMsg = formatAuthErrorMessage(
    { code: 'auth/unauthorized-domain' },
    'eduzone-linguafliw.vercel.app',
    'boreal-genius-zmn89',
  );
  assert.ok(unauthMsg?.includes('eduzone-linguafliw.vercel.app'));
  assert.ok(unauthMsg?.includes('boreal-genius-zmn89'));
  const blockedMsg = formatAuthErrorMessage({ code: 'auth/popup-blocked' });
  assert.ok(blockedMsg?.toLowerCase().includes('pop-up'));
});

import { resolveApiBaseUrl } from './apiUrl.ts';

test('resolveApiBaseUrl prefers same-origin /api on integrated hosts and respects custom base on static hosts', () => {
  assert.equal(
    resolveApiBaseUrl('https://edu-zone-linguaflow.vercel.app', {
      origin: 'http://localhost:3000',
      hostname: 'localhost',
    }),
    '',
  );
  assert.equal(
    resolveApiBaseUrl('https://edu-zone-linguaflow.vercel.app', {
      origin: 'https://linguafliw.vercel.app',
      hostname: 'linguafliw.vercel.app',
    }),
    '',
  );
  assert.equal(
    resolveApiBaseUrl('https://my-backend.run.app/', {
      origin: 'https://static-frontend.netlify.app',
      hostname: 'static-frontend.netlify.app',
    }),
    'https://my-backend.run.app',
  );
});

import fs from 'node:fs';
import path from 'node:path';
import { FAQ_ITEMS } from '../components/SeoLandingSection.tsx';

test('SEO assets (robots.txt, sitemap.xml, vercel.json) are valid and non-shadowed', () => {
  const canonicalOrigin = 'https://ez-linguaflow-j4sf.vercel.app';
  const robotsTxt = fs.readFileSync(path.resolve('public/robots.txt'), 'utf8');
  assert.ok(robotsTxt.includes('User-agent: Googlebot'));
  assert.ok(robotsTxt.includes('Allow: /'));
  assert.ok(robotsTxt.includes('Allow: /assets/'));
  assert.ok(robotsTxt.includes('Disallow: /api/'));
  assert.ok(robotsTxt.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));

  const sitemapXml = fs.readFileSync(path.resolve('public/sitemap.xml'), 'utf8');
  assert.ok(sitemapXml.includes(`<loc>${canonicalOrigin}/</loc>`));
  assert.ok(!sitemapXml.includes('/api/'));

  const vercelConfig = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8')) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const spaRewrite = vercelConfig.rewrites.find((r) => r.destination === '/index.html');
  assert.ok(spaRewrite);
  assert.ok(spaRewrite.source.includes('robots'));
  assert.ok(spaRewrite.source.includes('sitemap'));
});

test('index.html contains valid Indonesian SEO metadata and Schema.org JSON-LD matching visible FAQ', () => {
  const canonicalUrl = 'https://ez-linguaflow-j4sf.vercel.app/';
  const html = fs.readFileSync(path.resolve('index.html'), 'utf8');

  assert.ok(html.includes('<html lang="id">'));
  assert.ok(html.includes(`href="${canonicalUrl}"`));
  assert.ok(html.includes('name="robots"'));
  assert.ok(html.includes('index, follow'));
  assert.ok(!html.includes('AIza'));

  const gscMatches = html.match(/name="google-site-verification"/g) || [];
  assert.equal(gscMatches.length, 1);
  assert.ok(
    html.includes(
      '<meta name="google-site-verification" content="_b5F-o_3wZdzsSz31LE_DjEaYO2NVp4TL4qQjL2SIYI" />',
    ),
  );

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  assert.ok(titleMatch);
  const titleText = titleMatch[1].replace(/&amp;/g, '&');
  assert.ok(titleText.length >= 30 && titleText.length <= 65, `Title length: ${titleText.length}`);

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLdMatch);
  const parsed = JSON.parse(jsonLdMatch[1]) as {
    '@graph': Array<Record<string, unknown>>;
  };
  const types = parsed['@graph'].map((n) => n['@type']);
  assert.ok(types.includes('WebSite'));
  assert.ok(types.includes('Organization'));
  assert.ok(types.includes('WebApplication'));
  assert.ok(types.includes('BreadcrumbList'));
  assert.ok(types.includes('FAQPage'));

  const faqNode = parsed['@graph'].find((n) => n['@type'] === 'FAQPage') as {
    mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
  };
  assert.equal(faqNode.mainEntity.length, FAQ_ITEMS.length);
  for (let i = 0; i < FAQ_ITEMS.length; i += 1) {
    assert.equal(faqNode.mainEntity[i].name, FAQ_ITEMS[i].question);
    assert.equal(faqNode.mainEntity[i].acceptedAnswer.text, FAQ_ITEMS[i].answer);
  }
});

import {
  clearGeminiCooldown,
  clearPrimaryModelCooldown,
  ensureWavBase64,
  isGeminiInCooldown,
  isPrimaryModelInCooldown,
  markGeminiCooldown,
  markPrimaryModelCooldown,
} from '../../server/providers/geminiProvider.ts';

test('Gemini cooldown and primary-model circuit breakers activate on failure and clear cleanly', () => {
  clearGeminiCooldown();
  assert.equal(isGeminiInCooldown(1_000_000), false);
  markGeminiCooldown(120_000, 1_000_000);
  assert.equal(isGeminiInCooldown(1_060_000), true);
  assert.equal(isGeminiInCooldown(1_130_000), false);
  clearGeminiCooldown();
  assert.equal(isGeminiInCooldown(1_000_001), false);

  clearPrimaryModelCooldown();
  assert.equal(isPrimaryModelInCooldown(2_000_000), false);
  markPrimaryModelCooldown(90_000, 2_000_000);
  assert.equal(isPrimaryModelInCooldown(2_045_000), true);
  assert.equal(isPrimaryModelInCooldown(2_100_000), false);
  clearPrimaryModelCooldown();
  assert.equal(isPrimaryModelInCooldown(2_000_001), false);
});

test('filterSyncableEntitiesForUser blocks cross-user IndexedDB leaks', () => {
  const items = [
    { id: 'anon-1', updatedAt: 1 },
    { id: 'u1-item', userId: 'user-a', updatedAt: 2 },
    { id: 'u2-item', userId: 'user-b', updatedAt: 3 },
  ];
  const forB = filterSyncableEntitiesForUser(items, 'user-b');
  assert.deepEqual(
    forB.map((i) => i.id),
    ['anon-1', 'u2-item'],
  );
});

test('ensureWavBase64 wraps raw PCM with RIFF header and preserves existing WAV headers', () => {
  const rawPcm = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64');
  const wrapped = Buffer.from(ensureWavBase64(rawPcm, 'audio/l16;rate=24000'), 'base64');
  assert.equal(wrapped.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wrapped.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wrapped.length, 48);

  const alreadyWav = wrapped.toString('base64');
  const unchanged = Buffer.from(ensureWavBase64(alreadyWav, 'audio/wav'), 'base64');
  assert.equal(unchanged.length, 48);
});

import { isAllowedCorsOrigin } from '../../server/app.ts';

test('isAllowedCorsOrigin allows same-origin requests behind reverse proxies via X-Forwarded-Host', () => {
  const allowedOrigins = ['https://ez-linguaflow-j4sf.vercel.app'];

  // Proxied AI Studio preview where Nginx rewrites Host to localhost:3000 and sets X-Forwarded-Host
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'https://ais-dev-w6ussora6ildia7ipquthz-496673436177.asia-southeast1.run.app',
      host: 'localhost:3000',
      forwardedHost: 'ais-dev-w6ussora6ildia7ipquthz-496673436177.asia-southeast1.run.app',
      allowedOrigins,
    }),
    true,
  );

  // Explicit allowlisted production origin
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'https://ez-linguaflow-j4sf.vercel.app',
      host: 'internal-vercel-host',
      allowedOrigins,
    }),
    true,
  );

  // Disallowed external third-party origin
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'https://evil-attacker.example.com',
      host: 'localhost:3000',
      forwardedHost: 'ais-dev-w6ussora6ildia7ipquthz-496673436177.asia-southeast1.run.app',
      allowedOrigins,
    }),
    false,
  );
});

test('formatHttpErrorMessage explains 403/401/503 proxy failures cleanly and preserves server JSON messages', () => {
  assert.equal(formatHttpErrorMessage(403, 'Custom server message'), 'Custom server message');
  assert.ok(formatHttpErrorMessage(403).includes('HTTP 403'));
  assert.ok(formatHttpErrorMessage(401).includes('HTTP 401'));
  assert.ok(formatHttpErrorMessage(503).includes('HTTP 503'));
  assert.ok(formatHttpErrorMessage(404).includes('404'));
});

test('toggleHistoryFavoriteState cleanly toggles both favorite and saved flags', () => {
  const base: HistoryItem = {
    id: 'item-1',
    sourceText: 'Hello',
    translatedText: 'Halo',
    sourceLang: 'en',
    targetLang: 'id',
    tone: 'natural',
    provider: 'gemini',
    favorite: false,
    saved: true,
    createdAt: 1000,
  };
  const favOn = toggleHistoryFavoriteState(base, 2000, 'u1');
  assert.equal(favOn.favorite, true);
  assert.equal(favOn.saved, true);
  assert.equal(favOn.userId, 'u1');
  assert.equal(favOn.updatedAt, 2000);

  const favOff = toggleHistoryFavoriteState(favOn, 3000, 'u1');
  assert.equal(favOff.favorite, false);
  assert.equal(favOff.saved, false);
  assert.equal(deriveSavedTranslationsFromHistory([favOff]).length, 0);
});

test('normalizeAudioMimeType strips codecs parameters and maps MIME aliases cleanly', () => {
  assert.equal(normalizeAudioMimeType('audio/webm;codecs=opus', 'webm'), 'audio/webm');
  assert.equal(normalizeAudioMimeType('audio/mp4;codecs=mp4a.40.2', 'mp4'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType('audio/x-m4a', 'm4a'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType('audio/mpeg', 'mp3'), 'audio/mp3');
  assert.equal(normalizeAudioMimeType('audio/x-wav', 'wav'), 'audio/wav');
  assert.equal(normalizeAudioMimeType('application/octet-stream', 'ogg'), 'audio/ogg');
});

test('pickAudioRecordingFilename chooses matching extension for MediaRecorder MIME type', () => {
  assert.equal(pickAudioRecordingFilename('audio/mp4;codecs=mp4a.40.2'), 'mic-recording.mp4');
  assert.equal(pickAudioRecordingFilename('audio/ogg;codecs=opus'), 'mic-recording.ogg');
  assert.equal(pickAudioRecordingFilename('audio/wav'), 'mic-recording.wav');
  assert.equal(pickAudioRecordingFilename('audio/webm;codecs=opus'), 'mic-recording.webm');
  assert.equal(pickAudioRecordingFilename(undefined), 'mic-recording.webm');
});

test('safeParseModelJson parses plain JSON and strips markdown code fences', () => {
  assert.deepEqual(safeParseModelJson<{ ok: boolean }>('{"ok":true}'), { ok: true });
  assert.deepEqual(safeParseModelJson<{ a: number }>('```json\n{"a": 42}\n```'), { a: 42 });
  assert.deepEqual(safeParseModelJson<{ b: string }>('```\n{"b":"hi"}\n```'), { b: 'hi' });
});

import { normalizeSpeakableText } from './text.ts';

test('normalizeSpeakableText safely guards undefined, null, non-string, and blank TTS inputs', () => {
  assert.equal(normalizeSpeakableText(undefined), '');
  assert.equal(normalizeSpeakableText(null), '');
  assert.equal(normalizeSpeakableText(12345), '');
  assert.equal(normalizeSpeakableText('   \n\t  '), '');
  assert.equal(normalizeSpeakableText('  innovation  '), 'innovation');
});

test('normalizeImageTranslationResponse safely handles missing arrays, empty OCR, and malformed payloads', () => {
  // Partial response missing regions and unreadableSections must NEVER leave undefined arrays
  const partial = normalizeImageTranslationResponse({
    detectedSourceLang: 'en',
    fullOriginalText: 'Hello',
    fullTranslatedText: 'Halo',
  });
  assert.equal(partial.ok, true);
  if (partial.ok) {
    assert.equal(partial.hasReadableText, true);
    assert.deepEqual(partial.data.regions, []);
    assert.deepEqual(partial.data.unreadableSections, []);
    assert.equal(partial.data.regions.length, 0);
    assert.equal(partial.data.unreadableSections.length, 0);
  }

  // Empty OCR response flags hasReadableText = false without crashing
  const emptyOcr = normalizeImageTranslationResponse({
    detectedSourceLang: 'Unknown',
    regions: [],
    fullOriginalText: '',
    fullTranslatedText: '',
    unreadableSections: [],
  });
  assert.equal(emptyOcr.ok, true);
  if (emptyOcr.ok) {
    assert.equal(emptyOcr.hasReadableText, false);
  }

  // Unexpected non-OCR JSON shape is rejected cleanly
  assert.equal(normalizeImageTranslationResponse(null).ok, false);
  assert.equal(normalizeImageTranslationResponse({ foo: 'bar' }).ok, false);

  // Non-object region entries or bad box2d coordinates are sanitized without crashing
  const dirtyRegions = normalizeImageTranslationResponse({
    regions: [null, 'bad-entry', { originalText: 'Test', translatedText: 'Uji', box2d: [9999, -5, 'NaN', 500] }],
    unreadableSections: [null, 42, 'Blurry corner'],
  });
  assert.equal(dirtyRegions.ok, true);
  if (dirtyRegions.ok) {
    assert.equal(dirtyRegions.data.regions.length, 1);
    assert.deepEqual(dirtyRegions.data.regions[0].box2d, [1000, 0, 0, 500]);
    assert.deepEqual(dirtyRegions.data.unreadableSections, ['Blurry corner']);
    assert.equal(dirtyRegions.data.fullOriginalText, 'Test');
    assert.equal(dirtyRegions.data.fullTranslatedText, 'Uji');
  }
});

test('validateImageFile enforces supported formats and rejects empty or oversized files', () => {
  assert.equal(validateImageFile('photo.jpg', 1024).valid, true);
  assert.equal(validateImageFile('scan.png', 2048).valid, true);
  assert.equal(validateImageFile('graphic.webp', 4096).valid, true);

  const badExt = validateImageFile('vector.svg', 512);
  assert.equal(badExt.valid, false);
  assert.ok(badExt.error?.includes('Unsupported image format'));

  const emptyFile = validateImageFile('blank.png', 0);
  assert.equal(emptyFile.valid, false);
  assert.ok(emptyFile.error?.includes('empty'));
});

