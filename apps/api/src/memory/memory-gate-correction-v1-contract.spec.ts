import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

type FixtureCase = {
  name: string;
  message: Record<string, unknown>;
  expected?: {
    decision_status?: string;
    reason_code?: string;
    mutation_action?: string;
    semantic_status?: string;
    boundary_status?: string;
  };
};
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

describe('Memory Gate/Correction V1 contract', () => {
  it('accepts the synthetic gate matrix and rejects malformed transitions', async () => {
    const schema = (await readJson(
      'docs/contracts/memory-gate-correction-v1.schema.json',
    )) as object;
    const fixtures = (await readJson(
      'docs/contracts/fixtures/memory-gate-correction-v1/fixtures.json',
    )) as FixtureDocument;
    const validate = compileSchema(schema);

    for (const fixture of fixtures.valid) {
      expect(validate(fixture.message), fixture.name).toBe(true);
    }
    for (const fixture of fixtures.invalid) {
      expect(validate(fixture.message), fixture.name).toBe(false);
    }

    const reviewFixture = fixtures.valid.find(
      (fixture) => fixture.name === 'LLM-proposed Boundary withdrawal requires human authorization',
    );
    expect(reviewFixture).toBeDefined();
    const unsafe = structuredClone(reviewFixture?.message) as Record<string, unknown>;
    const unsafeDecision = unsafe.decision as Record<string, unknown>;
    const unsafeMutation = unsafeDecision.mutation as Record<string, unknown>;
    unsafeDecision.decision_status = 'accepted';
    unsafeDecision.reason_code = 'EXPLICIT_BOUNDARY_WITHDRAWAL';
    unsafeDecision.fail_closed = false;
    unsafeMutation.action = 'append_boundary_revision';
    unsafeMutation.new_revision_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    unsafeMutation.new_revision_no = 2;
    unsafeMutation.predecessor_revision_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(validate(unsafe), 'LLM Boundary withdrawal append mutation must be rejected').toBe(
      false,
    );
  });

  it('keeps accepted corrections append-only and all unsafe outcomes fail closed', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/memory-gate-correction-v1/fixtures.json',
    )) as FixtureDocument;

    for (const fixture of fixtures.valid) {
      const message = fixture.message;
      if (message.message_type !== 'gate_decision') continue;

      const decision = message.decision as Record<string, unknown>;
      const mutation = decision.mutation as Record<string, unknown>;
      expect(decision.decision_status, fixture.name).toBe(fixture.expected?.decision_status);
      expect(decision.reason_code, fixture.name).toBe(fixture.expected?.reason_code);
      expect(mutation.action, fixture.name).toBe(fixture.expected?.mutation_action);

      if (mutation.action !== 'none') {
        expect(mutation.predecessor_preserved, fixture.name).toBe(true);
        expect(mutation.evidence_preserved, fixture.name).toBe(true);
        expect(mutation.source_preserved, fixture.name).toBe(true);
      }
      if (decision.decision_status !== 'accepted') {
        expect(decision.fail_closed, fixture.name).toBe(true);
      }

      const candidate = message.candidate as Record<string, unknown>;
      const state = candidate.proposed_state as Record<string, unknown>;
      if (fixture.expected?.semantic_status) {
        expect(state.semantic_status, fixture.name).toBe(fixture.expected.semantic_status);
      }
      if (fixture.expected?.boundary_status) {
        expect(state.status, fixture.name).toBe(fixture.expected.boundary_status);
      }
    }
  });

  it('requires explicit elder evidence for Fact and Boundary transitions', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/memory-gate-correction-v1/fixtures.json',
    )) as FixtureDocument;

    const factDecision = fixtures.valid.find(
      (fixture) => fixture.name === 'inferred Fact rejected',
    );
    const boundaryDecision = fixtures.valid.find(
      (fixture) => fixture.name === 'silent Boundary is not revoked',
    );
    expect(factDecision?.expected?.reason_code).toBe('FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED');
    expect(boundaryDecision?.expected?.reason_code).toBe('BOUNDARY_WITHDRAWAL_REQUIRED');
  });

  it('never lets an LLM-proposed Boundary withdrawal or supersession authorize mutation', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/memory-gate-correction-v1/fixtures.json',
    )) as FixtureDocument;

    for (const fixture of fixtures.valid) {
      const message = fixture.message;
      if (message.message_type !== 'gate_decision') continue;
      const candidate = message.candidate as Record<string, unknown>;
      if (
        candidate.candidate_kind !== 'boundary' ||
        !['revoke', 'supersede'].includes(String(candidate.operation))
      ) {
        continue;
      }

      const decision = message.decision as Record<string, unknown>;
      const mutation = decision.mutation as Record<string, unknown>;
      expect(['rejected', 'review_required'], fixture.name).toContain(decision.decision_status);
      if (decision.decision_status === 'review_required') {
        expect(decision.reason_code, fixture.name).toBe('BOUNDARY_HUMAN_AUTHORIZATION_REQUIRED');
      }
      expect(decision.fail_closed, fixture.name).toBe(true);
      expect(mutation.action, fixture.name).toBe('none');
    }
  });

  it('rejects accepted mutation without explicit elder evidence or eligible sources', async () => {
    const schema = (await readJson(
      'docs/contracts/memory-gate-correction-v1.schema.json',
    )) as object;
    const fixtures = (await readJson(
      'docs/contracts/fixtures/memory-gate-correction-v1/fixtures.json',
    )) as FixtureDocument;
    const validate = compileSchema(schema);
    const factFixture = fixtures.valid.find(
      (fixture) => fixture.name === 'explicit elder Fact accepted',
    );
    const boundaryFixture = fixtures.valid.find(
      (fixture) => fixture.name === 'active Boundary requires explicit elder intent',
    );

    const factWithInference = structuredClone(factFixture?.message) as Record<string, unknown>;
    const factInferenceEvidence = (
      (factWithInference.candidate as Record<string, unknown>).evidence as Array<
        Record<string, unknown>
      >
    )[0];
    factInferenceEvidence.evidence_role = 'model_inference';
    expect(validate(factWithInference), 'accepted Fact with model inference only').toBe(false);

    const factWithInterviewerSuggestion = structuredClone(factFixture?.message) as Record<
      string,
      unknown
    >;
    const interviewerEvidence = (
      (factWithInterviewerSuggestion.candidate as Record<string, unknown>).evidence as Array<
        Record<string, unknown>
      >
    )[0];
    interviewerEvidence.trusted_role = 'interviewer';
    interviewerEvidence.evidence_role = 'interviewer_suggestion';
    expect(
      validate(factWithInterviewerSuggestion),
      'accepted Fact with interviewer evidence only',
    ).toBe(false);

    const boundaryWithoutIntent = structuredClone(boundaryFixture?.message) as Record<
      string,
      unknown
    >;
    const boundaryEvidence = (
      (boundaryWithoutIntent.candidate as Record<string, unknown>).evidence as Array<
        Record<string, unknown>
      >
    )[0];
    boundaryEvidence.evidence_role = 'elder_story_context';
    expect(validate(boundaryWithoutIntent), 'accepted Boundary without activation intent').toBe(
      false,
    );

    const eligibilityCases: Array<[string, string]> = [
      ['authorization', 'denied'],
      ['deletion', 'deleted'],
      ['retention', 'ineligible'],
    ];
    for (const [field, value] of eligibilityCases) {
      const ineligibleSource = structuredClone(factFixture?.message) as Record<string, unknown>;
      const evidence = (
        (ineligibleSource.candidate as Record<string, unknown>).evidence as Array<
          Record<string, unknown>
        >
      )[0];
      (evidence.eligibility as Record<string, unknown>)[field] = value;
      expect(validate(ineligibleSource), `accepted mutation with ${field} evidence`).toBe(false);
    }
  });
});
