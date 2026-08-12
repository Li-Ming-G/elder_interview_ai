import { describe, expect, it } from 'vitest';

import { canonicalJson, createPayloadHash } from './create-idempotency.js';

describe('create idempotency payload', () => {
  it('canonicalizes object keys recursively and preserves JSON values', () => {
    expect(canonicalJson({ z: null, a: { y: 2, x: '值' }, list: [true, 1] })).toBe(
      '{"a":{"x":"值","y":2},"list":[true,1],"z":null}',
    );
  });

  it('produces the same lowercase SHA-256 for equivalent key order', () => {
    expect(createPayloadHash({ b: 2, a: 1 })).toBe(createPayloadHash({ a: 1, b: 2 }));
    expect(createPayloadHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
