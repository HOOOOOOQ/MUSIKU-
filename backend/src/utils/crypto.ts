import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash?: string): Promise<boolean> =>
  hash ? bcrypt.compare(plain, hash) : Promise.resolve(false);

export const sha256 = (input: string): string => crypto.createHash('sha256').update(input).digest('hex');

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('hex');

/** Symmetric encryption for provider secrets stored at rest (AES-256-GCM). */
function secretKey(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_SECRET).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export interface AccessTokenPayload {
  sub: string;
  role: string;
  type: 'access';
  sid?: string;
}

export function signAccessToken(userId: string, role: string, sid?: string): string {
  return jwt.sign({ sub: userId, role, type: 'access', sid, jti: crypto.randomUUID() } as AccessTokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  if (decoded.type !== 'access') throw new Error('invalid token type');
  return decoded;
}

export function signRefreshToken(userId: string): string {
  // jti ensures every issued token is unique (required for rotation/revocation).
  return jwt.sign({ sub: userId, type: 'refresh', jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES as jwt.SignOptions['expiresIn'],
  });
}

export function verifyRefreshToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; type: string };
  if (decoded.type !== 'refresh') throw new Error('invalid token type');
  return decoded;
}
