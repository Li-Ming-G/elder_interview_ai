import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

type RuntimeRecord = Record<string, unknown>;
type FixtureCase = { name: string; record: RuntimeRecord };
type FixtureDocument = { valid: FixtureCase[]; invalid: FixtureCase[] };

const root = fileURLToPath(new URL('../../../../', import.meta.url));

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as unknown;
}

function compileSchema(schema: object): (value: unknown) => boolean {
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    compile: (schema: object) => (value: unknown) => boolean;
  };
  return new AjvConstructor({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema,
  );
}

function objectAt(value: unknown): RuntimeRecord {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  return value as RuntimeRecord;
}

function stringAt(value: unknown): string {
  expect(value).toBeTypeOf('string');
  return value as string;
}

describe('P6 Runtime Orchestration V1 contract', () => {
  it('accepts the synthetic contract fixtures and rejects malformed fixtures', async () => {
    const schema = (await readJson(
      'docs/contracts/question-runtime-orchestration-v1.schema.json',
    )) as object;
    const fixtures = (await readJson(
      'docs/contracts/fixtures/question-runtime-orchestration-v1/fixtures.json',
    )) as FixtureDocument;
    const validate = compileSchema(schema);

    for (const fixture of fixtures.valid) {
      expect(validate(fixture.record), fixture.name).toBe(true);
    }
    for (const fixture of fixtures.invalid) {
      expect(validate(fixture.record), fixture.name).toBe(false);
    }
  });

  it('mechanically checks the cross-field runtime invariants', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/question-runtime-orchestration-v1/fixtures.json',
    )) as FixtureDocument;

    for (const fixture of fixtures.valid) {
      const record = fixture.record;
      const trigger = objectAt(record.trigger);
      const lanes = objectAt(record.lanes);
      const terminal = objectAt(record.terminal);
      const trace = objectAt(record.trace);
      const generation = record.generation === null ? null : objectAt(record.generation);

      expect(lanes.recording_blocked, fixture.name).toBe(false);
      expect(lanes.finalized_asr_blocked, fixture.name).toBe(false);
      expect(lanes.background_blocks_director, fixture.name).toBe(false);
      expect(lanes.background_blocks_recording, fixture.name).toBe(false);

      if (trigger.kind === 'interim_asr') {
        expect(generation, fixture.name).toBeNull();
        expect(terminal.generation_outcome, fixture.name).toBe('NOT_STARTED');
      }

      if (trigger.kind === 'manual_next') {
        const priority = objectAt(trigger.manual_priority);
        const gate = objectAt(trigger.automatic_gate);
        expect(priority.bypasses_automatic_wait, fixture.name).toBe(true);
        expect(gate.reason, fixture.name).toBe('manual_bypass');
        expect(generation?.attempt_kind, fixture.name).toBe('manual_next');
      }

      if (generation !== null) {
        const deadline = objectAt(generation.deadline);
        const fence = objectAt(generation.fence);
        const publication = objectAt(generation.publication);
        const result = objectAt(generation.result);
        const authority = objectAt(trace.authority);
        const projection = objectAt(trace.orchestration_projection);

        expect(stringAt(trace.trace_id), fixture.name).toBe(stringAt(generation.trace_id));
        expect(stringAt(trace.request_id), fixture.name).toBe(stringAt(generation.request_id));
        expect(authority.contract, fixture.name).toBe('decision-trace-v1');
        expect(authority.accepted_identity, fixture.name).toBe(
          '40cc61e12ef63096474fe63b69463920f2d6a7c4',
        );
        expect(stringAt(trace.generation_id), fixture.name).toBe(
          stringAt(generation.generation_id),
        );
        expect(stringAt(trace.trigger_event_id), fixture.name).toBe(
          stringAt(trigger.source_event_id),
        );
        expect(trace.director_invoked, fixture.name).toBe(result.director_invoked);
        expect(projection.outcome_kind, fixture.name).not.toBe('gate_only');
        expect(trace, fixture.name).not.toHaveProperty('status');
        expect(trace, fixture.name).not.toHaveProperty('decision_outcome');
        expect(trace, fixture.name).not.toHaveProperty('trigger_type');

        if (generation.replayed === true) {
          const replayOf = objectAt(generation.replay_of);
          expect(replayOf.generation_id, fixture.name).toBe(generation.generation_id);
          expect(replayOf.request_id, fixture.name).toBe(generation.request_id);
          expect(replayOf.attempt_id, fixture.name).toBe(generation.attempt_id);
          expect(replayOf.ai_job_id, fixture.name).toBe(generation.ai_job_id);
        } else {
          expect(generation.replay_of, fixture.name).toBeNull();
        }

        if (fence.can_publish === false) {
          expect(
            ['stale_basis', 'superseded_by_manual', 'policy_blocked'].includes(
              stringAt(publication.outcome),
            ),
            fixture.name,
          ).toBe(true);
        }

        if (deadline.state === 'expired') {
          expect(result.decision_outcome, fixture.name).toBe('system_error');
          expect(result.generation_outcome, fixture.name).toBe('SYSTEM_ERROR');
          expect(terminal.decision_outcome, fixture.name).toBe('system_error');
        }

        if (result.decision_outcome === 'continue_listening') {
          expect(result.generation_outcome, fixture.name).toBe('CONTINUE_LISTENING');
          expect(result.semantic_success, fixture.name).toBe(true);
          expect(result.error_code, fixture.name).toBeNull();
          expect(generation.lifecycle_status, fixture.name).toBe('succeeded');
        }
      } else {
        const authority = objectAt(trace.authority);
        const projection = objectAt(trace.orchestration_projection);
        expect(trace.attempt_id, fixture.name).toBeNull();
        expect(trace.ai_job_id, fixture.name).toBeNull();
        expect(trace.director_invoked, fixture.name).toBe(false);
        expect(authority.contract, fixture.name).toBe('decision-trace-v1');
        expect(projection.outcome_kind, fixture.name).toBe('gate_only');
        expect(terminal.decision_outcome, fixture.name).toBe('not_started');
        expect(terminal.generation_outcome, fixture.name).toBe('NOT_STARTED');
        expect(trace, fixture.name).not.toHaveProperty('decision_outcome');
      }

      const serialized = JSON.stringify(record);
      expect(serialized, fixture.name).not.toMatch(
        /provider_payload|prompt|transcript_text|raw_context/iu,
      );
    }
  });

  it('covers every required P6R-01 behavior by named fixture', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/question-runtime-orchestration-v1/fixtures.json',
    )) as FixtureDocument;
    const names = new Set(fixtures.valid.map(({ name }) => name));

    expect(names).toEqual(
      new Set([
        'interim ASR is observational only',
        'rapid finalized finals are coalesced into one bounded eligibility check',
        'manual-next bypasses automatic waiting',
        'older automatic generation loses publication authority',
        'deadline expiration is a system error',
        'genuine continue-listening remains a successful semantic decision',
        'P2 failure does not block the Director lane',
        'restart reuses the existing durable generation authority',
      ]),
    );
  });

  it('distinguishes gate-only NOT_STARTED from successful Director CONTINUE_LISTENING', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/question-runtime-orchestration-v1/fixtures.json',
    )) as FixtureDocument;
    const gate = fixtures.valid.find(({ name }) => name === 'interim ASR is observational only');
    const success = fixtures.valid.find(
      ({ name }) => name === 'genuine continue-listening remains a successful semantic decision',
    );
    expect(gate).toBeDefined();
    expect(success).toBeDefined();

    const gateRecord = gate?.record;
    const successfulRecord = success?.record;
    expect(gateRecord?.generation).toBeNull();
    expect(objectAt(gateRecord?.trace).director_invoked).toBe(false);
    expect(objectAt(objectAt(gateRecord?.trace).orchestration_projection).outcome_kind).toBe(
      'gate_only',
    );
    expect(objectAt(gateRecord?.terminal).generation_outcome).toBe('NOT_STARTED');
    expect(objectAt(gateRecord?.trace)).not.toHaveProperty('decision_outcome');

    const successfulGeneration = objectAt(successfulRecord?.generation);
    const successfulResult = objectAt(successfulGeneration.result);
    expect(successfulResult.director_invoked).toBe(true);
    expect(successfulResult.generation_outcome).toBe('CONTINUE_LISTENING');
    expect(objectAt(successfulRecord?.trace).director_invoked).toBe(true);
    expect(objectAt(objectAt(successfulRecord?.trace).orchestration_projection).outcome_kind).toBe(
      'director_result',
    );
  });
});
