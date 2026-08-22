import { describe, expect, it, vi } from 'vitest';

import type { EmbeddingProvider, MemoryP3RetrievalRequest } from './memory-p3-retrieval.types.js';
import { MemoryP3RetrievalService } from './memory-p3-retrieval.service.js';
import type {
  MemoryP3EmbeddingRecord,
  MemoryP3GraphNeighbor,
} from './memory-p3-persistence.types.js';
import type { MemoryP3Source, MemoryP3SourceReaderPort } from './memory-p3-source.reader.js';

const PROJECT_ID = 'project-1';
const SESSION_ID = 'session-current';
const THREAD_ID = 'thread-active';

describe('MemoryP3RetrievalService', () => {
  it('builds a query embedding, recalls readable Mid/Long, and deduplicates embedding plus graph', async () => {
    const sources = [
      makeSource('mid-embedding', 'mid', SESSION_ID, 'thread-other'),
      makeSource('mid-embedding-only', 'mid', SESSION_ID, 'thread-other'),
      makeSource('long-graph', 'long', 'session-old', 'thread-other'),
      makeSource('active-thread', 'mid', SESSION_ID, THREAD_ID),
      makeSource('other-session-mid', 'mid', 'session-old', 'thread-other'),
    ];
    const embed = vi.fn<EmbeddingProvider['embed']>().mockResolvedValue({
      dimensions: 2,
      modelId: 'fake-v1',
      providerId: 'fake-provider',
      vector: [1, 0],
    });
    const provider: EmbeddingProvider = {
      embed,
      providerId: 'fake-provider',
    };
    const graphNeighbors: MemoryP3GraphNeighbor[] = [
      {
        neighborMemoryId: 'mid-embedding',
        relation: makeRelation('active-thread', 'mid-embedding', 'CONTINUATION'),
      },
      {
        neighborMemoryId: 'long-graph',
        relation: makeRelation('active-thread', 'long-graph', 'RELATED'),
      },
    ];
    const persistence = {
      listEmbeddings: vi
        .fn()
        .mockResolvedValue([
          makeEmbedding('mid-embedding', 'revision-mid-embedding', [1, 0]),
          makeEmbedding('mid-embedding-only', 'revision-mid-embedding-only', [0.9, 0.435889894]),
          makeEmbedding('long-graph', 'revision-long-graph', [0, 1]),
          makeEmbedding('other-session-mid', 'revision-other-session-mid', [1, 0]),
        ]),
      listGraphNeighbors: vi.fn((_projectId: string, memoryId: string) =>
        Promise.resolve(memoryId === 'active-thread' ? graphNeighbors : []),
      ),
    };
    const service = new MemoryP3RetrievalService(readerFor(sources), provider, persistence);

    const result = await service.retrieve(makeRequest());

    expect(embed).toHaveBeenCalledOnce();
    expect(String(embed.mock.calls[0]?.[0].input)).toContain(PROJECT_ID);
    expect(String(embed.mock.calls[0]?.[0].input)).toContain('working query');
    expect(String(embed.mock.calls[0]?.[0].input)).toContain('recent query');
    expect(result.request.queryVector).toEqual([1, 0]);
    expect(result.candidates.map(({ memoryId }) => memoryId)).toEqual([
      'mid-embedding',
      'mid-embedding-only',
      'long-graph',
    ]);
    expect(result.candidates[0]).toMatchObject({
      graphDistance: 1,
      memoryId: 'mid-embedding',
      retrievalSources: ['embedding', 'graph'],
    });
    expect(result.candidates[1]).toMatchObject({
      graphDistance: null,
      memoryId: 'mid-embedding-only',
      retrievalSources: ['embedding'],
    });
    expect(result.candidates[1]?.embeddingScore).toBeCloseTo(0.9, 5);
    expect(result.candidates[2]).toMatchObject({
      graphDistance: 1,
      memoryId: 'long-graph',
      retrievalSources: ['graph'],
    });
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ memoryId: 'active-thread' }),
    );
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ memoryId: 'other-session-mid' }),
    );
    expect(result.graphEdges).toHaveLength(2);
  });

  it('returns an empty candidate set when semantic scores miss the threshold and there are no graph seeds', async () => {
    const source = makeSource('unrelated', 'long', 'session-old', 'thread-other');
    const provider: EmbeddingProvider = {
      embed: vi.fn().mockResolvedValue({
        dimensions: 2,
        modelId: 'fake-v1',
        providerId: 'fake-provider',
        vector: [1, 0],
      }),
      providerId: 'fake-provider',
    };
    const service = new MemoryP3RetrievalService(readerFor([source]), provider, {
      listEmbeddings: vi
        .fn()
        .mockResolvedValue([makeEmbedding(source.layerIdentityId, source.layerRevisionId, [0, 1])]),
      listGraphNeighbors: vi.fn(),
    });

    const result = await service.retrieve({
      ...makeRequest(),
      activeThreadId: null,
      activeThreadRevision: null,
      configuration: { ...makeRequest().configuration, embeddingThreshold: 0.5 },
    });

    expect(result.candidates).toEqual([]);
    expect(result.graphEdges).toEqual([]);
  });

  it('uses the supplied query vector and never turns Working into a candidate', async () => {
    const source = makeSource('readable', 'mid', SESSION_ID, 'thread-other');
    const embed = vi.fn();
    const provider = {
      embed,
      modelId: 'fake-v1',
      providerId: 'fake-provider',
    };
    const service = new MemoryP3RetrievalService(readerFor([source]), provider, {
      listEmbeddings: vi
        .fn()
        .mockResolvedValue([makeEmbedding(source.layerIdentityId, source.layerRevisionId, [1, 0])]),
      listGraphNeighbors: vi.fn().mockResolvedValue([]),
    });

    const result = await service.retrieve({
      ...makeRequest(),
      queryVector: [1, 0],
      currentWorkingSignals: [
        { ...makeRequest().currentWorkingSignals[0], workingMemoryId: 'working-only' },
      ],
    });

    expect(embed).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.memoryId).toBe('readable');
    expect(result.candidates[0]).not.toHaveProperty('workingMemoryId');
  });

  it('filters supplied query vectors to the exact configured profile and version', async () => {
    const source = makeSource('same-layer', 'mid', SESSION_ID, 'thread-other');
    const provider = {
      embed: vi.fn(),
      modelId: 'version-a',
      providerId: 'profile-a',
    };
    const service = new MemoryP3RetrievalService(readerFor([source]), provider, {
      listEmbeddings: vi.fn().mockResolvedValue([
        {
          ...makeEmbedding(source.layerIdentityId, source.layerRevisionId, [0.8, 0.6]),
          embeddingProfile: 'profile-a',
          embeddingVersion: 'version-a',
        },
        {
          ...makeEmbedding(source.layerIdentityId, source.layerRevisionId, [1, 0]),
          embeddingProfile: 'profile-a',
          embeddingVersion: 'version-b',
        },
        {
          ...makeEmbedding(source.layerIdentityId, source.layerRevisionId, [1, 0]),
          embeddingProfile: 'profile-b',
          embeddingVersion: 'version-a',
        },
      ]),
      listGraphNeighbors: vi.fn().mockResolvedValue([]),
    });

    const result = await service.retrieve({
      ...makeRequest(),
      activeThreadId: null,
      activeThreadRevision: null,
      queryVector: [1, 0],
      configuration: { ...makeRequest().configuration, embeddingThreshold: 0.5 },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.embeddingScore).toBeCloseTo(0.8, 5);
  });

  it('fails closed when a generated query has no model version', async () => {
    const source = makeSource('missing-model', 'mid', SESSION_ID, 'thread-other');
    const provider: EmbeddingProvider = {
      embed: vi.fn().mockResolvedValue({
        dimensions: 2,
        providerId: 'fake-provider',
        vector: [1, 0],
      }),
      providerId: 'fake-provider',
    };
    const service = new MemoryP3RetrievalService(readerFor([source]), provider, {
      listEmbeddings: vi.fn(),
      listGraphNeighbors: vi.fn(),
    });

    await expect(service.retrieve(makeRequest())).rejects.toThrow(
      'query embedding model id is required',
    );
  });

  it('fails closed when a supplied query vector has no configured model version', async () => {
    const provider: EmbeddingProvider = {
      embed: vi.fn(),
      providerId: 'fake-provider',
    };
    const service = new MemoryP3RetrievalService(readerFor([]), provider, {
      listEmbeddings: vi.fn(),
      listGraphNeighbors: vi.fn(),
    });

    await expect(service.retrieve({ ...makeRequest(), queryVector: [1, 0] })).rejects.toThrow(
      'supplied query vector requires exact embedding profile and version',
    );
  });
});

function makeRequest(): MemoryP3RetrievalRequest {
  return {
    activeThreadId: THREAD_ID,
    activeThreadRevision: 2,
    contractVersion: 'memory-p3-retrieval-v1',
    currentSessionId: SESSION_ID,
    currentWorkingSignals: [
      {
        queryText: 'working query',
        revision: 1,
        semanticKind: 'fact',
        semanticStatus: 'current',
        signalId: 'working-signal',
        threadId: THREAD_ID,
        workingMemoryId: 'working-1',
      },
    ],
    projectId: PROJECT_ID,
    recentEligibleTranscriptSignals: [
      {
        boundedQueryText: 'recent query',
        effectiveTextDigest: 'a'.repeat(64),
        eligibility: 'trusted-elder-final-conversation',
        segmentId: 'segment-1',
        sessionId: SESSION_ID,
        speakerRoleRevision: 1,
        textRevision: 1,
      },
    ],
    configuration: {
      candidateLimit: 8,
      embeddingThreshold: 0.7,
      graphDepth: 1,
      graphLimit: 8,
    },
  };
}

function readerFor(sources: readonly MemoryP3Source[]): MemoryP3SourceReaderPort {
  return { read: vi.fn().mockResolvedValue(sources), readCurrentLayer: vi.fn() };
}

function makeSource(
  layerIdentityId: string,
  sourceLevel: 'mid' | 'long',
  originSessionId: string,
  originThreadId: string,
): MemoryP3Source {
  return {
    contentDigest: `${layerIdentityId}-digest`,
    layerIdentityId,
    layerRevisionId: `revision-${layerIdentityId}`,
    originSessionId,
    originThreadId,
    projectId: PROJECT_ID,
    resolutionAuthorityId: `authority-${layerIdentityId}`,
    revisionNo: 1,
    safeContent: `safe ${layerIdentityId}`,
    semanticKind: 'fact',
    semanticStatus: 'current',
    sourceLevel,
  };
}

function makeEmbedding(
  layerIdentityId: string,
  layerRevisionId: string,
  vector: readonly number[],
): MemoryP3EmbeddingRecord {
  return {
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    dimensions: vector.length,
    embeddingProfile: 'fake-provider',
    embeddingVersion: 'fake-v1',
    id: `embedding-${layerIdentityId}`,
    inputDigest: 'b'.repeat(64),
    layerIdentityId,
    layerRevisionId,
    projectId: PROJECT_ID,
    vector,
  };
}

function makeRelation(
  sourceMemoryId: string,
  targetMemoryId: string,
  relationType: 'CONTINUATION' | 'RESUME' | 'BRANCH' | 'RELATED',
): MemoryP3GraphNeighbor['relation'] {
  return {
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    id: `relation-${sourceMemoryId}-${targetMemoryId}`,
    projectId: PROJECT_ID,
    provenanceDigest: null,
    relationType,
    sourceMemoryId,
    targetMemoryId,
  };
}
