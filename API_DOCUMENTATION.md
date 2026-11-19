# EduZone Linguaflow Shared Backend API Documentation

Centralized Node.js + TypeScript API powering **EduZone Linguaflow Web** and **EduZone Linguaflow Native Android** with complete feature parity, strict user isolation, and zero client-side AI secrets.

See also the machine-readable OpenAPI 3.1 schema in [`openapi.yaml`](./openapi.yaml).

---

## 1. Base URLs

- **Local Development**: `http://localhost:3000`
- **Active Preview / Dev Runtime**: `https://ais-dev-w6ussora6ildia7ipquthz-496673436177.asia-southeast1.run.app`
- **Production Cloud Run**: Configured after deploying the container via `Dockerfile` (`PORT=8080`, HTTPS terminated by Cloud Run ingress).

---

## 2. Authentication & Security Architecture

### Token Verification
All user-scoped persistence and synchronization endpoints require a valid **Firebase Auth ID Token** (obtained via Google Sign-In on Web or Android Firebase Auth SDK):

```http
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

The backend verifies every token cryptographically using Google's public JWKS (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`) via `jose`:
- Checks `iss === https://securetoken.google.com/boreal-genius-zmn89`
- Checks `aud === boreal-genius-zmn89`
- Checks `email_verified === true`
- Extracts `uid` (`sub`) and forwards the caller's token to Firestore REST API so **Firestore Security Rules** (`firestore.rules`) enforce mathematical per-user isolation at the database layer as well.

### Secret Isolation
- `GEMINI_API_KEY` and `DEEPL_API_KEY` are stored **only** in server environment secrets.
- Neither the Web bundle nor the Android APK ever receives or embeds AI provider keys.

### Rate Limiting, Timeouts & Upload Limits
- **Rate Limit**: `90` requests / minute per authenticated `uid` (or per client IP for guest AI calls). Headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **Request Timeout**: `90000 ms` (90 seconds), configurable via `REQUEST_TIMEOUT_MS`.
- **File Upload Limits** (memory-only `multer`, never written to disk):
  - Documents (`POST /api/translate/document`): max **15 MB** (`.pdf`, `.docx`, `.pptx`, `.txt`, `.html`, `.htm`)
  - Images (`POST /api/translate/image`): max **10 MB** (`.jpg`, `.jpeg`, `.png`, `.webp`)
  - Voice Audio (`POST /api/translate/voice`): max **15 MB** (`.wav`, `.mp3`, `.webm`, `.ogg`, `.m4a`, `.aac`)
- **Correlation & Logging**: Every response includes `X-Request-Id`. Server logs emit privacy-safe structured JSON (`requestId`, `method`, `path`, `status`, `durationMs`, `uid`) without logging user text or credentials.

---

## 3. Error Codes & Standard Error Format

All errors return JSON:

```json
{
  "error": "Human-readable error description.",
  "code": "INVALID_INPUT",
  "requestId": "c1f9c9b2-8c7b-4f10-a91e-1d0f2b9a5c00"
}
```

| HTTP Status | `code` | Meaning |
|---|---|---|
| `400` | `INVALID_INPUT`, `INVALID_ID`, `FILE_REQUIRED`, `INVALID_FILE`, `AI_CONFIG_INVALID` | Missing/invalid payload, ID format violation, or unsupported file type |
| `401` | `UNAUTHORIZED` | Missing, expired, invalid, or unverified-email Firebase Bearer token |
| `403` | `PERMISSION_DENIED`, `CORS_FORBIDDEN` | Blocked by Firestore security rules or CORS policy |
| `404` | `NOT_FOUND` | Unknown `/api/*` endpoint |
| `413` | `FILE_TOO_LARGE` | Uploaded multipart file exceeds 10 MB / 15 MB limit |
| `429` | `RATE_LIMIT_EXCEEDED`, `QUOTA_EXCEEDED` | Rate limit or upstream Gemini/DeepL quota exceeded |
| `503` | `SERVICE_UNAVAILABLE`, `PROVIDER_NOT_CONFIGURED` | Upstream AI service busy or provider key not configured |
| `504` | `REQUEST_TIMEOUT` | Processing exceeded `REQUEST_TIMEOUT_MS` |

---

## 4. Public & AI Endpoints

### `GET /api/health`
Readiness & liveness check for Cloud Run and mobile clients.

**Response `200 OK`:**
```json
{
  "ok": true,
  "version": "1.1.0",
  "environment": "production",
  "timestamp": "2026-11-14T22:00:00.000Z",
  "geminiConfigured": true,
  "deeplConfigured": false,
  "databaseConfigured": true,
  "model": "gemini-4-hydrogen",
  "limits": {
    "maxTextLength": 50000,
    "maxDocumentBytes": 15728640,
    "maxImageBytes": 10485760,
    "maxAudioBytes": 15728640,
    "requestTimeoutMs": 90000,
    "rateLimitPerMinute": 90
  }
}
```

### `GET /api/languages`
Returns the built-in 20+ supported languages (`code`, `name`, `nativeName`, `bcp47`, `rtl`, `supportsFormality`).

### `GET /api/providers`
Returns configured translation providers (`gemini`, `deepl`) and availability status.

### `POST /api/detect`
Standalone language detection endpoint.

**Request:**
```json
{ "text": "Selamat pagi, rapat dimulai pukul sembilan." }
```
**Response `200 OK`:**
```json
{
  "detectedLang": "id",
  "languageName": "Indonesian",
  "confidence": "high",
  "isRtl": false,
  "providerUsed": "gemini"
}
```

### `POST /api/translate`
Translates text preserving paragraphs/formatting while applying tone, formality, context, style profile, and mandatory glossary constraints.

**Request:**
```json
{
  "text": "Our cloud-native deployment reduced latency.",
  "sourceLang": "auto",
  "targetLang": "id",
  "tone": "business",
  "formality": "more_formal",
  "context": "Executive quarterly update email",
  "glossaryTerms": [
    { "sourceTerm": "cloud-native", "targetTerm": "berbasis komputasi awan" },
    { "sourceTerm": "deployment", "targetTerm": "penerapan sistem" }
  ],
  "provider": "gemini"
}
```
**Response `200 OK`:**
```json
{
  "translatedText": "Penerapan sistem berbasis komputasi awan kami telah mengurangi latensi.",
  "detectedSourceLang": "en",
  "detectedSourceLangName": "English",
  "providerUsed": "gemini",
  "modelUsed": "gemini-4-hydrogen",
  "appliedTerms": [
    { "sourceTerm": "cloud-native", "targetTerm": "berbasis komputasi awan" },
    { "sourceTerm": "deployment", "targetTerm": "penerapan sistem" }
  ]
}
```

### `POST /api/translate/alternatives`
Generates 3–4 nuanced alternative translations with `nuanceDifference`, `usageContext`, `formalityLevel`, and `isMostNatural`.

### `POST /api/dictionary`
Contextual word/phrase lookup (`word`, `sentenceContext`, `sourceLang`, `targetLang`) returning definition, part of speech, pronunciation, synonyms, antonyms, bilingual examples, and alternatives.

### `POST /api/translate/document`
`multipart/form-data` with fields: `file` (PDF/DOCX/PPTX/TXT/HTML, max 15 MB), `sourceLang`, `targetLang`, `tone`, optional `context`, optional `glossaryTerms` (JSON string).
Returns `originalPreview`, `translatedPreview`, `downloadBase64`, `downloadFilename`, `downloadMimeType`, `preservesLayout`, `ocrUsed`, and `segmentCount`.

### `POST /api/translate/image`
`multipart/form-data` with fields: `file` (JPG/JPEG/PNG/WEBP, max 10 MB), `sourceLang`, `targetLang`.
- **Android Integration**: Capture image via CameraX / Gallery picker, compress/encode as JPEG/PNG (`<= 10 MB`), upload via Retrofit `MultipartBody.Part` to `/api/translate/image`, render returned `box2d` (`[ymin, xmin, ymax, xmax]` in `0..1000` normalized space) directly over the Android `ImageView`/Canvas.

### `POST /api/translate/voice`
`multipart/form-data` with fields: `file` (WAV/MP3/WEBM/OGG/M4A/AAC, max 15 MB), `sourceLang`, `targetLang`.
- **Android Integration**: Record audio natively via Android `AudioRecord` / `MediaRecorder` (M4A or WAV) and upload to `/api/translate/voice`. Receive `{ detectedSourceLang, transcript, translatedText }`, then optionally invoke `POST /api/tts` or Android `TextToSpeech` + `POST /api/conversations` to sync Conversation Mode sessions.

### `POST /api/tts`
JSON `{ "text": "Halo dunia", "voiceName": "Kore", "styleHint": "Clear natural pronunciation" }` -> `{ "base64Wav": "...", "mimeType": "audio/wav" }`.

---

## 5. Authenticated User Persistence & Sync Endpoints (`Authorization: Bearer <token>`)

All endpoints below reject unauthenticated calls with `401 UNAUTHORIZED` and store records exclusively under `/users/{uid}/...` in Firestore:

| Feature | Endpoints | Methods |
|---|---|---|
| **User Profile** | `/api/profile` | `GET`, `PUT` |
| **User Settings / Preferences** | `/api/preferences` | `GET`, `PUT` |
| **Translation History** | `/api/history`, `/api/history/:id` | `GET`, `POST`, `PUT`, `DELETE` |
| **Saved Translations (Phrasebook)** | `/api/saved-translations`, `/api/saved-translations/:id` | `GET`, `POST`, `DELETE` |
| **Glossaries** | `/api/glossaries`, `/api/glossaries/:id` | `GET`, `POST`, `PUT`, `DELETE` |
| **Style Profiles** | `/api/style-profiles`, `/api/style-profiles/:id` | `GET`, `POST`, `PUT`, `DELETE` |
| **Voice Conversations** | `/api/conversations`, `/api/conversations/:id` | `GET`, `POST`, `DELETE` |
| **Cross-Device Sync** | `/api/sync/pull?since=<ms>`, `/api/sync/push` | `GET`, `POST` |

### Cross-Device Synchronization Rules (Web ↔ Android)
1. **Last-Write-Wins (LWW)**: Every synced record carries an `updatedAt` epoch millisecond timestamp. On conflicts between offline local edits and remote cloud edits, the higher `updatedAt` wins (`remote.updatedAt >= local.updatedAt`).
2. **Soft-Delete Tombstones**: Deleting a history entry, saved translation, glossary, style profile, or conversation marks `deleted: true` and updates `updatedAt` rather than immediately erasing the record, ensuring deletions propagate cleanly from Web to Android and vice versa.
3. **Incremental Delta Pull**: Android/Web clients pass `?since=<lastSyncServerTimeMs>` to `GET /api/sync/pull` to fetch only items changed since the previous sync, then push local offline queues via `POST /api/sync/push`.
4. **Offline-First Cache**: Web uses IndexedDB and Android should use Room (`SQLite`), pushing pending changes once connectivity returns.
5. **User Isolation**: Firestore security rules (`firestore.rules`) enforce `request.auth.uid == userId` and `request.auth.token.email_verified == true` on every read, list, create, update, and delete operation.
