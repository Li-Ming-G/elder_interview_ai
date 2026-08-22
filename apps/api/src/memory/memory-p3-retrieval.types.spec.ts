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
    expect(MEMORY_P3_RETRIEVAL_SOURCES).toEqual(['embedding', 'graph']);
    expect(MEMORY_P3_GRAPH_RELATIONS).toEqual(['CONTINUATION', 'RESUME', 'BRANCH', 'RELATED']);
    expect(MEMORY_P3_STORAGE_KIND).toBe('postgresql-pgvector-v1');
    expect(MEMORY_P3_EMBEDDING_PORT).toBe('provider-neutral');
    expect(MEMORY_P3_EMBEDDING_MODEL_STATUS).toBe('deferred');
  });

  it('requires an explicit project, session and active-thread reference', () => {
    const value = canonicalSurface();
    expect(compileSchema()(value)).toBe(true);
    delete value.project_id;
    expect(compileSchema()(value)).toBe(false);
  });

  it('keeps Working and recent transcript signals on the query side only', () => {
    const value = canonicalSurface();
    expect(value.current_working_signals).toHaveLength(1);
    expect(value.recent_eligible_transcript_signals).toHaveLength(1);
    expect(value.active_thread_id).not.toBeNull();
    Object.assign(value.candidates[0], {
      working_memory_id: 'working-1',
      segment_id: '88888888-8888-4888-8888-888888888888',
    });
    expect(compileSchema()(value)).toBe(false);
  });

  it('accepts the canonical closed contract shape', () => {
    const validate = compileSchema();
    expect(validate(canonicalSurface())).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('accepts the checked-in canonical fixture', () => {
    expect(compileSchema()(readFixture())).toBe(true);
  });

  it.each([
    [
      'revisionId',
      (value: Surface): void => {
        delete value.candidates[0].revision_id;
      },
    ],
    [
      'originResolutionAuthorityId',
      (value: Surface): void => {
        delete asObject(value.graph_edges[0].from).origin_resolution_authority_id;
      },
    ],
    [
      'old originResolutionId',
      (value: Surface): void => {
        const identity = asObject(value.graph_edges[0].from);
        delete identity.origin_resolution_authority_id;
        identity.origin_resolution_id = '66666666-6666-4666-8666-666666666666';
      },
    ],
    [
      'unknown graph relation',
      (value: Surface): void => {
        value.graph_edges[0].relation = 'CHILD';
      },
    ],
    [
      'raw transcript or evidence fields',
      (value: Surface): void => {
        Object.assign(value.candidates[0], { transcript: 'forbidden', evidence: [] });
      },
    ],
    [
      'ambiguous candidate field names',
      (value: Surface): void => {
        Object.assign(value.candidates[0], {
          authority_id: '66666666-6666-4666-8666-666666666666',
          revision: 1,
          kind: 'episode',
          status: 'current',
        });
      },
    ],
    [
      'non-canonical graph source',
      (value: Surface): void => {
        value.candidates[0].retrieval_sources = ['graph_neighbor'];
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const value = canonicalSurface();
    mutate(value);
    expect(compileSchema()(value)).toBe(false);
  });

  it('accepts graph as the canonical graph retrieval source', () => {
    const value = canonicalSurface();
    value.candidates[0].retrieval_sources = ['graph'];
    value.candidates[0].embedding_score = null;
    value.candidates[0].graph_distance = 1;
    expect(compileSchema()(value)).toBe(true);
  });

  it('requires graph edges to carry stable layer identities', () => {
    const value = canonicalSurface();
    delete asObject(value.graph_edges[0].from).layer_identity_id;
    expect(compileSchema()(value)).toBe(false);
  });
});

type JsonObject = Record<string, unknown>;

type Surface = {
  contract_version: string;
  project_id?: string;
  current_session_id: string;
  active_thread_id: string | null;
  active_thread_revision: number | null;
  current_working_signals: JsonObject[];
  recent_eligible_transcript_signals: JsonObject[];
  query_vector?: number[];
  configuration: JsonObject;
  storage: JsonObject;
  embedding: JsonObject;
  candidates: JsonObject[];
  graph_edges: JsonObject[];
};

function canonicalSurface(): Surface {
  const projectId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const identity = {
    layer_identity_id: '44444444-4444-4444-8444-444444444444',
    project_id: projectId,
    origin_session_id: sessionId,
    origin_thread_id: '55555555-5555-4555-8555-555555555555',
    origin_resolution_authority_id: '66666666-6666-4666-8666-666666666666',
  };
  return {
    contract_version: MEMORY_P3_RETRIEVAL_CONTRACT_VERSION,
    project_id: projectId,
    current_session_id: sessionId,
    active_thread_id: identity.origin_thread_id,
    active_thread_revision: 3,
    current_working_signals: [
      {
        signal_id: 'working-signal-1',
        working_memory_id: 'working-1',
        thread_id: identity.origin_thread_id,
        revision: 1,
        semantic_kind: 'episode',
        semantic_status: 'current',
        query_text: 'bounded semantic signal',
      },
    ],
    recent_eligible_transcript_signals: [
      {
        segment_id: '77777777-7777-4777-8777-777777777777',
        session_id: sessionId,
        text_revision: 1,
        speaker_role_revision: 1,
        effective_text_digest: 'a'.repeat(64),
        eligibility: 'trusted-elder-final-conversation',
        bounded_query_text: 'bounded transcript query signal',
      },
    ],
    query_vector: [0.1, 0.2],
    configuration: {
      embedding_threshold: 0.7,
      candidate_limit: 8,
      graph_depth: 1,
      graph_limit: 4,
    },
    storage: { kind: MEMORY_P3_STORAGE_KIND },
    embedding: {
      port: MEMORY_P3_EMBEDDING_PORT,
      model_status: MEMORY_P3_EMBEDDING_MODEL_STATUS,
      dimensions: 2,
    },
    candidates: [
      {
        memory_id: identity.layer_identity_id,
        resolution_authority_id: identity.origin_resolution_authority_id,
        revision_id: '88888888-8888-4888-8888-888888888888',
        revision_no: 1,
        source_level: 'mid',
        semantic_kind: 'episode',
        semantic_status: 'current',
        safe_content: 'safe semantic content',
        retrieval_sources: ['embedding', 'graph'],
        embedding_score: 0.9,
        graph_distance: 1,
        rank: 0,
      },
    ],
    graph_edges: [
      {
        relation: 'RELATED',
        from: identity,
        to: { ...identity, layer_identity_id: '99999999-9999-4999-8999-999999999999' },
      },
    ],
  };
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('expected object');
  return value as JsonObject;
}

function readFixture(): unknown {
  const root = process.cwd().replaceAll('\\', '/').endsWith('/apps/api')
    ? join(process.cwd(), '..', '..')
    : process.cwd();
  return JSON.parse(
    readFileSync(join(root, 'docs/contracts/memory-p3-retrieval-v1.fixtures.json'), 'utf8'),
  );
}

type ContractValidator = ((value: unknown) => boolean) & {
  errors?: readonly unknown[] | null;
};

function compileSchema(): ContractValidator {
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    addFormat(name: string, format: RegExp): void;
    compile(schema: object): ContractValidator;
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: true, validateFormats: true });
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
  );
}
