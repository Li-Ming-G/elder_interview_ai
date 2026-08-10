import { createHash } from 'node:crypto';

export const EMPTY_MANIFEST_HASH = sha256('[]');

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function effectiveTextDigest(value: string): string {
  return sha256(value.replaceAll('\r\n', '\n').replaceAll('\r', '\n'));
}

export function manifestHash(entries: readonly string[]): string {
  return sha256(JSON.stringify(entries));
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
