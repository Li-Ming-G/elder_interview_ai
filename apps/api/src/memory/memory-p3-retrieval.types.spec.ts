import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  MEMORY_P3_EMBEDDING_MODEL_STATUS,
  MEMORY_P3_EMBEDDING_PORT,
  MEMORY_P3_GRAPH_RELATIONS,
  MEMORY_P3_RETRIEVAL_CONTRACT_VERSION,
  MEMORY_P3_RETRIEVAL_SOURCES,
  MEMORY_P3_SOURCE_LEVELS,
  MEMORY_P3_STORAGE_KIND,
} from './memory-p3-retrieval.types.js';

describe('P3 retrieval contract surface', () => {
  it('freezes the P3 boundary and provider/storage seams', () => {
    expect(MEMORY_P3_RETRIEVAL_CONTRACT_VERSION).toBe('memory-p3-retrieval-v1');
    expect(MEMORY_P3_SOURCE_LEVELS).toEqual(['mid', 'long']);
    expect(MEMORY_P3_RETRIEVAL_SOURCES).toEqual(['embedding', 'graph_neighbor']);
    expect(MEMORY_P3_GRAPH_RELATIONS).toEqual(['CONTINUATION', 'RESUME', 'BRANCH', 'RELATED']);
    expect(MEMORY_P3_STORAGE_KIND).toBe('postgresql-pgvector-v1');
    expect(MEMORY_P3_EMBEDDING_PORT).toBe('provider-neutral');
    expect(MEMORY_P3_EMBEDDING_MODEL_STATUS).toBe('deferred');
  });

  it('accepts the canonical closed contract shape', () => {
    const validate = compileSchema();
    expect(validate(canonicalSurface())).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it.each([
    [
      'Working candidate',
      (value: Surface): void => {
        value.candidates[0].source_level = 'working';
      },
    ],
    [
      'unknown graph relation',
      (value: Surface): void => {
        value.graph_edges[0].relation = 'CHILD';
      },
    ],
    [
      'candidate transcript field',
      (value: Surface): void => {
        Object.assign(value.candidates[0], { transcript: 'forbidden' });
      },
    ],
    [
      'candidate evidence field',
      (value: Surface): void => {
        Object.assign(value.candidates[0], { evidence: [] });
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const value = canonicalSurface();
    mutate(value);
    expect(compileSchema()(value)).toBe(false);
  });

  it('requires graph edges to carry stable layer identities', () => {
    const value = canonicalSurface();
    delete value.graph_edges[0].from.layer_identity_id;
    expect(compileSchema()(value)).toBe(false);
  });
});

type Surface = {
  contract_version: string;
  scope: { project_id: string; current_session_id: string };
  query: {
    working_signals: Array<Record<string, unknown>>;
    query_vector?: number[];
  };
  configuration: Record<string, number>;
  storage: { kind: string };
  embedding: Record<string, unknown>;
  candidates: Array<Record<string, any>>;
  graph_edges: Array<Record<string, any>>;
};

function canonicalSurface(): Surface {
  const projectId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const identity = {
    layer_identity_id: '44444444-4444-4444-8444-444444444444',
    project_id: projectId,
    origin_session_id: sessionId,
    origin_thread_id: '55555555-5555-4555-8555-555555555555',
    origin_resolution_id: '66666666-6666-4666-8666-666666666666',
  };
  return {
    contract_version: MEMORY_P3_RETRIEVAL_CONTRACT_VERSION,
    scope: { project_id: projectId, current_session_id: sessionId },
    query: {
      working_signals: [
        {
          working_memory_id: 'working-1',
          thread_id: identity.origin_thread_id,
          revision: 1,
          kind: 'episode',
          status: 'current',
          query_text: 'semantic signal',
        },
      ],
      query_vector: [0.1, 0.2],
    },
    configuration: {
      embedding_threshold: 0.7,
      candidate_limit: 8,
      graph_neighbor_depth: 1,
      graph_neighbor_limit: 4,
    },
    storage: { kind: MEMORY_P3_STORAGE_KIND },
    embedding: {
      port: MEMORY_P3_EMBEDDING_PORT,
      model_status: MEMORY_P3_EMBEDDING_MODEL_STATUS,
      dimensions: 2,
    },
    candidates: [
      {
        memory_id: 'memory-1',
        authority_id: identity.origin_resolution_id,
        revision: 1,
        source_level: 'mid',
        source_session_ids: [sessionId],
        kind: 'episode',
        status: 'current',
        safe_content: 'safe semantic content',
        layer_identity: identity,
        retrieval_sources: ['embedding'],
        embedding_score: 0.9,
        graph_distance: null,
        score: 0.9,
        rank: 0,
      },
    ],
    graph_edges: [
      {
        relation: 'RELATED',
        from: identity,
        to: { ...identity, layer_identity_id: '77777777-7777-4777-8777-777777777777' },
      },
    ],
  };
}

function compileSchema(): (value: unknown) => boolean & { errors?: unknown } {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const root = process.cwd().replaceAll('\\', '/').endsWith('/apps/api')
    ? join(process.cwd(), '..', '..')
    : process.cwd();
  return ajv.compile(
    JSON.parse(
      readFileSync(join(root, 'docs/contracts/memory-p3-retrieval-v1.schema.json'), 'utf8'),
    ) as object,
  ) as (value: unknown) => boolean & { errors?: unknown };
}
