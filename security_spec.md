# Linguaflow Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership & Identity Isolation**: Every document in `/users/{userId}` and its subcollections (`/preferences`, `/history`, `/savedTranslations`, `/glossaries`, `/styleProfiles`, `/conversations`) belongs exclusively to `request.auth.uid == userId`, with `request.auth.token.email_verified == true`.
2. **No Cross-User Reads or Lists**: Unauthenticated users and non-owners cannot `get` or `list` any document under `/users/{otherUid}`—including `UserProfile` which holds PII (`email`, `displayName`). `allow list` explicitly checks `resource.data.userId == request.auth.uid`.
3. **Master Gate Integrity**: Subcollection writes (`history`, `savedTranslations`, `glossaries`, `styleProfiles`, `preferences`, `conversations`) require that parent `/users/{userId}` exists (`exists(...)`) to prevent orphaned subcollection records.
4. **Path-ID & Field Synchronicity**: Every path ID (`userId`, `prefId`, `historyId`, `savedId`, `glossaryId`, `profileId`, `conversationId`) must match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars) and match the corresponding `id`/`uid`/`userId` field in the document payload.
5. **Immutable Ownership & Creation Metadata**: On `update`, `uid`, `userId`, `id`, and `createdAt` cannot change.
6. **Temporal Integrity**: Both `createdAt` (on create) and `updatedAt` (on create and update) MUST equal `request.time` (enforced via `serverTimestamp()` on Web SDK and `REQUEST_TIME` transform on backend REST API).
7. **Volumetric & Strict Key Guards**: Every payload enforces `.keys().hasAll(...)` + `.keys().hasOnly(...)` on `create`, `affectedKeys().hasOnly(...)` action branches on `update`, `.size()` limits on every string/list, and no arbitrary shadow fields.

## 2. The "Dirty Dozen" Attack Payloads (All Expected: `PERMISSION_DENIED`)
1. **Cross-User Profile Read (PII Leak)**: Signed in as `userA`, `get(/users/userB)` -> DENIED (`isOwner(userB)` is false).
2. **Unverified Email Write (Spoof Attack)**: Signed in with `email_verified: false`, `set(/users/userA, ...)` -> DENIED (`isVerifiedOwner` requires `request.auth.token.email_verified == true`).
3. **UID Spoofing in History Create**: Signed in as `userA`, `create(/users/userA/history/h1, { userId: "userB", ... })` -> DENIED (`data.userId == request.auth.uid` fails).
4. **Shadow/Ghost Field Injection**: Signed in as `userA`, `create(/users/userA, { uid: "userA", ..., isAdmin: true })` -> DENIED (`.keys().hasOnly(...)` rejects `isAdmin`).
5. **Orphaned Subcollection Write**: Signed in as `userA` when `/users/userA` does not exist yet, `create(/users/userA/history/h1, ...)` -> DENIED (parent `exists()` check fails).
6. **ID Poisoning**: `create(/users/userA/glossaries/bad..id$slash, ...)` or 500-char ID -> DENIED (`isValidId` rejects).
7. **Client-Forged Timestamp**: `create(/users/userA/history/h1, { ..., createdAt: "2020-01-01T00:00:00Z" })` -> DENIED (`createdAt == request.time` fails).
8. **Immutable Field Mutation on Update**: `update(/users/userA/history/h1, { userId: "userB", updatedAt: serverTimestamp() })` -> DENIED (`affectedKeys().hasOnly(...)` & immutability check reject).
9. **Denial-of-Wallet Oversized String**: `create(/users/userA/glossaries/g1, { name: "x".repeat(10000), ... })` -> DENIED (`data.name.size() <= 120` fails).
10. **Oversized Array Attack**: `create(/users/userA/glossaries/g1, { terms: [501 items], ... })` -> DENIED (`data.terms.size() <= 500` fails).
11. **Value Poisoning Type Mismatch**: `update(/users/userA/preferences/default, { ttsSpeed: "fast", updatedAt: serverTimestamp() })` -> DENIED (`isValidUserPreferences` enforces `ttsSpeed is number && ttsSpeed >= 0.5 && ttsSpeed <= 2.0`).
12. **Global Catch-All / Unknown Collection**: `set(/admins/userA, { role: "superadmin" })` or `get(/test/connection)` -> DENIED (default-deny catch-all).

## 3. Red Team Audit Checklist
- Catch-all deny block first inside `/databases/{database}/documents`: PASS
- No `incoming()` or `request.resource` inside `allow read` or `allow delete`: PASS
- No `allow list: if isSignedIn();` blanket reads; `allow list` validates `resource.data.userId == request.auth.uid` without `get()`/`exists()` inside `allow list`: PASS
- `isValid*` helper called on EVERY `create` and `update`: PASS
- Every string checked with `.size()` and every array bounded: PASS
- Action-based `affectedKeys().hasOnly(...)` branches on every `allow update`: PASS
- Server timestamps (`request.time`) enforced on `createdAt` & `updatedAt`: PASS
