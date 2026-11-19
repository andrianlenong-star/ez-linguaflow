import type express from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { SERVER_CONFIG } from '../config.ts';
import { isValidEntityId } from '../../src/utils/sync.ts';

const FIREBASE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

const jwks = createRemoteJWKSet(FIREBASE_JWKS_URL);

export interface AuthenticatedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoUrl?: string;
  idToken: string;
}

export interface AuthenticatedRequest extends express.Request {
  user?: AuthenticatedUser;
  requestId?: string;
}

export function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 20 ? token : null;
}

export function validateFirebaseClaims(
  payload: JWTPayload,
  expectedProjectId: string,
): { valid: true; user: Omit<AuthenticatedUser, 'idToken'> } | { valid: false; reason: string } {
  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  if (!uid || !isValidEntityId(uid)) {
    return { valid: false, reason: 'Token subject (sub) is missing or invalid.' };
  }
  if (payload.aud !== expectedProjectId) {
    return { valid: false, reason: 'Token audience does not match Firebase project.' };
  }
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  if (payload.iss !== expectedIssuer) {
    return { valid: false, reason: 'Token issuer does not match Firebase project.' };
  }
  const emailVerified = payload.email_verified === true;
  if (!emailVerified) {
    return { valid: false, reason: 'Verified email is required to access synchronized storage.' };
  }
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email) {
    return { valid: false, reason: 'Authenticated email claim is missing.' };
  }
  const nameRaw = typeof payload.name === 'string' ? payload.name.trim() : '';
  const displayName = nameRaw || email.split('@')[0] || 'EduZone Linguaflow User';
  const photoUrl = typeof payload.picture === 'string' ? payload.picture : undefined;

  return {
    valid: true,
    user: {
      uid,
      email,
      emailVerified,
      displayName: displayName.slice(0, 120),
      photoUrl,
    },
  };
}

export async function verifyFirebaseIdToken(idToken: string): Promise<AuthenticatedUser> {
  const projectId = SERVER_CONFIG.firebaseConfig?.projectId;
  if (!projectId) {
    throw new Error('Firebase project configuration is missing on the server.');
  }
  const issuer = `https://securetoken.google.com/${projectId}`;
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience: projectId,
  });

  const validated = validateFirebaseClaims(payload, projectId);
  if (!validated.valid) {
    throw new Error(validated.reason);
  }
  return {
    ...validated.user,
    idToken,
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({
      error: 'Authentication required. Provide a valid Firebase ID token in Authorization: Bearer <token>.',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
    return;
  }

  try {
    req.user = await verifyFirebaseIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? `Invalid or expired auth token: ${err.message}` : 'Unauthorized',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
  }
}

export async function optionalAuth(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    if (SERVER_CONFIG.requireAuthForTranslation) {
      res.status(401).json({
        error: 'Authentication is required for this endpoint.',
        code: 'UNAUTHORIZED',
        requestId: req.requestId,
      });
      return;
    }
    next();
    return;
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    res.status(401).json({
      error: 'Malformed Authorization header. Expected Bearer <token>.',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
    return;
  }

  try {
    req.user = await verifyFirebaseIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? `Invalid or expired auth token: ${err.message}` : 'Unauthorized',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
  }
}
