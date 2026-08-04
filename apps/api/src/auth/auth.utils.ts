import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';

export const SESSION_BYTES = 32;
export const COOKIE_LOCAL = 'elder_interview_session';
export const COOKIE_PRODUCTION = '__Host-elder_interview_session';

export function opaqueToken(): string {
  return randomBytes(SESSION_BYTES).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeHashEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw validationError();
  }
  const email = value.trim().toLowerCase();
  if (
    Buffer.byteLength(email, 'utf8') > 254 ||
    !/^[\x21-\x7e]+$/.test(email) ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(email)
  ) {
    throw validationError();
  }
  return email;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw validationError();
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 12 || bytes > 128) {
    throw validationError();
  }
  return value;
}

export function validationError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALIDATION_ERROR',
    details: {},
    message: 'Request validation failed',
  });
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  production: boolean,
  clear = false,
): string {
  const attributes = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (production) attributes.push('Secure');
  if (clear) attributes.push('Max-Age=0');
  return attributes.join('; ');
}
