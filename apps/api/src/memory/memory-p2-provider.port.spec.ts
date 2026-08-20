import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DeterministicMemoryP2Provider,
  MemoryP2ProviderError,
  UnavailableMemoryP2Provider,
} from './memory-p2-provider.port.js';
import type { MemoryP2SemanticContext } from './memory-p2-runtime.types.js';

const context = (
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json'),
      'utf8',
    ),
  ) as { base: { context: MemoryP2SemanticContext } }
).base.context;

describe('memory P2 provider adapters', () => {
  it('returns byte-equivalent deterministic proposals for local/test context', async () => {
    const provider = new DeterministicMemoryP2Provider('test');
    const first = await provider.propose(context, new AbortController().signal);
    const second = await provider.propose(structuredClone(context), new AbortController().signal);

    expect(second).toEqual(first);
  });

  it('reports unavailable without network, secret, or provider payload', async () => {
    await expect(
      new UnavailableMemoryP2Provider().propose(context, new AbortController().signal),
    ).rejects.toBeInstanceOf(MemoryP2ProviderError);
  });

  it('refuses to bind the deterministic adapter in staging or production', async () => {
    await expect(
      new DeterministicMemoryP2Provider('production').propose(
        context,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(MemoryP2ProviderError);
  });
});
