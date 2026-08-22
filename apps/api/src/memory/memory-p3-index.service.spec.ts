import { describe, expect, it, vi } from 'vitest';

import type { MemoryP2PersistenceReader } from './memory-p2-persistence.reader.js';
import {
  DeterministicFakeEmbeddingProvider,
  MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
  MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
} from './memory-p3-embedding.provider.js';
import { MemoryP3IndexService } from './memory-p3-index.service.js';
import type { MemoryP3PersistenceRepository } from './memory-p3-persistence.repository.js';
import type {
  MemoryP3EmbeddingInput,
  MemoryP3EmbeddingRecord,
} from './memory-p3-persistence.types.js';
import { MemoryP3SourceReader } from './memory-p3-source.reader.js';
import type { MemoryP3Source, MemoryP3SourceReaderPort } from './memory-p3-source.reader.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const IDENTITY_ID = '44444444-4444-4444-8444-444444444444';

describe('DeterministicFakeEmbeddingProvider', () => {
  it('returns the same vector for the same semantic content', async () => {
    const provider = new DeterministicFakeEmbeddingProvider(4);

    const first = await provider.embed({ input: 'canonical semantic content' });
    const replay = await provider.embed({ input: 'canonical semantic content' });
    const changed = await provider.embed({ input: 'changed semantic content' });

    expect(first).toEqual(replay);
    expect(first.vector).toHaveLength(4);
    expect(first.providerId).toBe(MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID);
    expect(changed.vector).not.toEqual(first.vector);
  });
});

describe('MemoryP3IndexService', () => {
  it('upserts matching profile, version, dimension and content digest metadata', async () => {
    const source = makeSource();
    const sourceReader = readerFor(source);
    const upsertEmbedding = vi.fn(
      (input: MemoryP3EmbeddingInput): Promise<MemoryP3EmbeddingRecord> =>
        Promise.resolve({
          ...input,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          id: 'embedding-1',
        }),
    );
    const service = new MemoryP3IndexService(
      sourceReader,
      new DeterministicFakeEmbeddingProvider(4),
      { upsertEmbedding } as unknown as MemoryP3PersistenceRepository,
    );

    const result = await service.index({
      embeddingProfile: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
      embeddingVersion: MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
      projectId: PROJECT_ID,
    });

    expect(result.indexed).toHaveLength(1);
    expect(result.skippedStale).toBe(0);
    expect(upsertEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: 4,
        embeddingProfile: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
        embeddingVersion: MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
        inputDigest: source.contentDigest,
        layerRevisionId: source.layerRevisionId,
      }),
    );

    const replay = await service.index({
      embeddingProfile: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
      embeddingVersion: MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
      projectId: PROJECT_ID,
    });
    expect(replay.indexed[0]?.id).toBe(result.indexed[0]?.id);
    expect(upsertEmbedding.mock.calls[1]?.[0]).toEqual(upsertEmbedding.mock.calls[0]?.[0]);
    expect(upsertEmbedding).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        embeddingProfile: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
        embeddingVersion: MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
      }),
    );
  });

  it.each([
    ['revision', { layerRevisionId: 'new-revision', revisionNo: 2 }],
    ['content', { contentDigest: 'c'.repeat(64) }],
  ])('skips a source with stale %s before the derived write', async (_kind, change) => {
    const source = makeSource();
    const current = { ...source, ...change };
    const sourceReader: MemoryP3SourceReaderPort = {
      read: vi.fn().mockResolvedValue([source]),
      readCurrentLayer: vi.fn().mockResolvedValue(current),
    };
    const upsertEmbedding = vi.fn<MemoryP3PersistenceRepository['upsertEmbedding']>();
    const service = new MemoryP3IndexService(
      sourceReader,
      new DeterministicFakeEmbeddingProvider(4),
      { upsertEmbedding } as unknown as MemoryP3PersistenceRepository,
    );

    await expect(
      service.index({
        embeddingProfile: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
        embeddingVersion: MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toMatchObject({ indexed: [], skippedStale: 1 });
    expect(upsertEmbedding).not.toHaveBeenCalled();
  });

  it.each([
    ['mismatched profile', 'other-provider', MEMORY_P3_FAKE_EMBEDDING_MODEL_ID],
    ['mismatched version', MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID, 'other-model'],
  ])('rejects %s from the provider result', async (_kind, embeddingProfile, embeddingVersion) => {
    const source = makeSource();
    const service = new MemoryP3IndexService(
      readerFor(source),
      new DeterministicFakeEmbeddingProvider(4),
      { upsertEmbedding: vi.fn() } as unknown as MemoryP3PersistenceRepository,
    );

    await expect(
      service.index({ embeddingProfile, embeddingVersion, projectId: PROJECT_ID }),
    ).rejects.toThrow(/does not match/);
  });

  it.each([undefined, ''])('rejects a missing or empty provider model id', async (modelId) => {
    const source = makeSource();
    const provider = {
      embed: vi.fn().mockResolvedValue({
        dimensions: 4,
        modelId,
        providerId: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
        vector: [0, 0, 0, 0],
      }),
    };
    const service = new MemoryP3IndexService(readerFor(source), provider, {
      upsertEmbedding: vi.fn(),
    } as unknown as MemoryP3PersistenceRepository);

    await expect(
      service.index({
        embeddingProfile: MEMORY_P3_FAKE_EMBEDDING_PROVIDER_ID,
        embeddingVersion: MEMORY_P3_FAKE_EMBEDDING_MODEL_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow('embedding model id is required');
  });
});

describe('MemoryP3SourceReader', () => {
  it('reads only P2-readable semantic resolution and claim values', async () => {
    const layer = {
      authorityId: '66666666-6666-4666-8666-666666666666',
      claimIds: ['claim-1'],
      identityId: IDENTITY_ID,
      layer: 'mid' as const,
      memberManifestHash: 'a'.repeat(64),
      resolutionId: 'resolution-1',
      resolutionRevision: 2,
      revisionId: 'revision-1',
      revisionNo: 2,
      semanticStatus: 'current' as const,
    };
    const prisma = {
      memoryClaim: {
        findMany: vi.fn().mockResolvedValue([
          {
            canonicalKey: 'birth-place',
            id: 'claim-1',
            valueJson: 'semantic value',
            valueKind: 'exact',
          },
        ]),
      },
      memoryLayerIdentity: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: IDENTITY_ID,
            originSessionId: '33333333-3333-4333-8333-333333333333',
            originThreadId: '55555555-5555-4555-8555-555555555555',
            projectId: PROJECT_ID,
          },
        ]),
        findUnique: vi.fn(),
      },
      memoryResolution: {
        findUnique: vi.fn().mockResolvedValue({
          authorityId: layer.authorityId,
          canonicalKey: 'birth-place',
          memoryType: 'place',
          p2Write: true,
          projectId: PROJECT_ID,
          resolutionKind: 'single',
          resolutionRevision: 2,
          resolvedValueJson: 'semantic value',
          semanticKind: 'fact',
          semanticStatus: 'current',
          status: 'current',
        }),
      },
      memoryResolutionMember: {
        findMany: vi.fn().mockResolvedValue([{ memberOrder: 0, memoryClaimId: 'claim-1' }]),
      },
    };
    const p2Reader = {
      readCurrentLayer: vi.fn().mockResolvedValue(layer),
    } as unknown as MemoryP2PersistenceReader;
    const reader = new MemoryP3SourceReader(prisma as never, p2Reader);

    const [source] = await reader.read(PROJECT_ID);

    expect(source).toBeDefined();
    expect(source?.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(source?.layerRevisionId).toBe('revision-1');
    expect(source?.semanticKind).toBe('fact');
    expect(source?.sourceLevel).toBe('mid');
    expect(source?.safeContent).toContain('semantic value');
    expect(source?.safeContent).not.toContain('transcript');
  });

  it('drops layers that P2 marks unreadable', async () => {
    const prisma = {
      memoryLayerIdentity: {
        findMany: vi.fn().mockResolvedValue([{ id: IDENTITY_ID, projectId: PROJECT_ID }]),
      },
    };
    const p2Reader = {
      readCurrentLayer: vi.fn().mockResolvedValue(null),
    } as unknown as MemoryP2PersistenceReader;

    const sources = await new MemoryP3SourceReader(prisma as never, p2Reader).read(PROJECT_ID);

    expect(sources).toEqual([]);
  });

  it('fails closed when resolution members contain an unvalidated extra claim', async () => {
    const { prisma, layer } = sourceFixture({
      members: [
        { memberOrder: 0, memoryClaimId: 'claim-1' },
        { memberOrder: 1, memoryClaimId: 'claim-X' },
      ],
    });
    const reader = new MemoryP3SourceReader(prisma as never, p2ReaderFor(layer));

    await expect(reader.read(PROJECT_ID)).resolves.toEqual([]);
  });

  it('uses the P2 layer claim order for semantic content', async () => {
    const { prisma, layer } = sourceFixture({
      claimIds: ['claim-2', 'claim-1'],
      members: [
        { memberOrder: 0, memoryClaimId: 'claim-2' },
        { memberOrder: 1, memoryClaimId: 'claim-1' },
      ],
      claims: [
        { canonicalKey: 'first', id: 'claim-1', valueJson: 'value-1', valueKind: 'exact' },
        { canonicalKey: 'second', id: 'claim-2', valueJson: 'value-2', valueKind: 'exact' },
      ],
    });
    const [source] = await new MemoryP3SourceReader(prisma as never, p2ReaderFor(layer)).read(
      PROJECT_ID,
    );

    expect(source?.safeContent.indexOf('value-2')).toBeLessThan(
      source?.safeContent.indexOf('value-1') ?? -1,
    );
  });
});

function readerFor(source: MemoryP3Source): MemoryP3SourceReaderPort {
  return {
    read: vi.fn().mockResolvedValue([source]),
    readCurrentLayer: vi.fn().mockResolvedValue(source),
  };
}

function makeSource(): MemoryP3Source {
  return {
    contentDigest: 'b'.repeat(64),
    layerIdentityId: IDENTITY_ID,
    layerRevisionId: '88888888-8888-4888-8888-888888888888',
    originSessionId: '33333333-3333-4333-8333-333333333333',
    originThreadId: '55555555-5555-4555-8555-555555555555',
    projectId: PROJECT_ID,
    resolutionAuthorityId: '66666666-6666-4666-8666-666666666666',
    revisionNo: 1,
    safeContent: '{"value":"semantic"}',
    semanticKind: 'fact',
    semanticStatus: 'current',
    sourceLevel: 'mid',
  };
}

interface SourceFixtureClaim {
  canonicalKey: string;
  id: string;
  valueJson: unknown;
  valueKind: string;
}

interface SourceFixtureMember {
  memberOrder: number;
  memoryClaimId: string;
}

function sourceFixture(
  options: {
    claimIds?: readonly string[];
    claims?: readonly SourceFixtureClaim[];
    members?: readonly SourceFixtureMember[];
  } = {},
): { layer: Readonly<Record<string, unknown>>; prisma: Record<string, unknown> } {
  const claimIds = options.claimIds ?? ['claim-1'];
  const members = options.members ?? [{ memberOrder: 0, memoryClaimId: 'claim-1' }];
  const claims = options.claims ?? [
    { canonicalKey: 'birth-place', id: 'claim-1', valueJson: 'semantic value', valueKind: 'exact' },
  ];
  const layer = {
    authorityId: '66666666-6666-4666-8666-666666666666',
    claimIds,
    identityId: IDENTITY_ID,
    layer: 'mid',
    memberManifestHash: 'a'.repeat(64),
    resolutionId: 'resolution-1',
    resolutionRevision: 2,
    revisionId: 'revision-1',
    revisionNo: 2,
    semanticStatus: 'current',
  } as const;
  const prisma = {
    memoryClaim: { findMany: vi.fn().mockResolvedValue(claims) },
    memoryLayerIdentity: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: IDENTITY_ID,
          originSessionId: '33333333-3333-4333-8333-333333333333',
          originThreadId: '55555555-5555-4555-8555-555555555555',
          projectId: PROJECT_ID,
        },
      ]),
      findUnique: vi.fn(),
    },
    memoryResolution: {
      findUnique: vi.fn().mockResolvedValue({
        authorityId: layer.authorityId,
        canonicalKey: 'birth-place',
        memoryType: 'place',
        p2Write: true,
        projectId: PROJECT_ID,
        resolutionKind: 'single',
        resolutionRevision: 2,
        resolvedValueJson: 'semantic value',
        semanticKind: 'fact',
        semanticStatus: 'current',
        status: 'current',
      }),
    },
    memoryResolutionMember: { findMany: vi.fn().mockResolvedValue(members) },
  };
  return { layer, prisma };
}

function p2ReaderFor(layer: Readonly<Record<string, unknown>>): MemoryP2PersistenceReader {
  return {
    readCurrentLayer: vi.fn().mockResolvedValue(layer),
  } as unknown as MemoryP2PersistenceReader;
}
