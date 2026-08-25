import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHECKPOINT_A_DIRECTOR_MODEL_CONFIG_VERSION,
  CHECKPOINT_A_DIRECTOR_PROMPT_BUNDLE_VERSION,
  DIRECTOR_MODEL_CONFIG_VERSION,
  DIRECTOR_PROMPT_BUNDLE_VERSION,
  loadDirectorPromptBundle,
  QuestionDirectorContract,
} from './question-director-contract.js';

describe('QuestionDirectorContract', () => {
  const contract = new QuestionDirectorContract();
  const segmentId = '11111111-1111-4111-8111-111111111111';
  const itemId = '22222222-2222-4222-8222-222222222222';
  const context = {
    actual_asked: [],
    bank_references: [
      {
        bank: 'basic',
        purpose: 'detail',
        question_bank_item_id: itemId,
        question_text: '您小时候最喜欢在哪里玩？',
        sensitivity: 'low',
        topic: '童年',
      },
    ],
    boundaries: [],
    context_schema_version: 'interview-director-context-v1' as const,
    current_memories: [],
    current_presentation: null,
    interview_state: {
      goal: '建立谈话节奏',
      journey_reason_codes: ['JOURNEY_RAPPORT_INITIAL'],
      journey_stage: 'rapport' as const,
    },
    recent_transcript: [
      { segment_id: segmentId, start_ms: 0, text: '我住在河边。', trusted_role: 'elder' as const },
    ],
    recently_displayed: [],
  };

  it('uses the formal schemas and accepts free generation without a bank attribution', () => {
    contract.assertContext(context);
    expect(
      contract.parseOutput(
        {
          continue_reason_code: null,
          decision: 'suggest',
          declared_bank_references: [],
          grounding: [{ id: segmentId, kind: 'segment' }],
          purpose: 'detail',
          question: '愿意再讲讲那时的生活吗？',
          reason: '顺着刚才的内容继续。',
          risk: 'low',
        },
        context,
      ),
    ).toMatchObject({ decision: 'suggest', declared_bank_references: [] });
  });

  it('rejects grounding and declared attribution outside the frozen Context', () => {
    expect(() =>
      contract.parseOutput(
        {
          continue_reason_code: null,
          decision: 'suggest',
          declared_bank_references: [
            {
              question_bank_item_id: '33333333-3333-4333-8333-333333333333',
              usage: 'inspiration',
            },
          ],
          grounding: [],
          purpose: 'detail',
          question: '愿意讲讲吗？',
          reason: '测试',
          risk: 'low',
        },
        context,
      ),
    ).toThrow('AI_OUTPUT_REFERENCE_OUTSIDE_CONTEXT');
  });

  it('rejects parallel or partial output shapes through the formal Output Schema', () => {
    expect(() =>
      contract.parseOutput({ decision: 'suggest', question: '缺少正式字段' }, context),
    ).toThrow('AI_OUTPUT_SCHEMA_INVALID');
  });

  it('loads the immutable Owner Checkpoint A bundle and records selected provenance', () => {
    const checkpoint = new QuestionDirectorContract({ promptBundle: 'checkpoint_a' });
    const owner = readFileSync(
      join(
        process.cwd(),
        'docs/prompts/interview-director/owner-inputs/Interview_Director_System_v2.md',
      ),
      'utf8',
    );

    expect(checkpoint.promptBundleVersion).toBe(CHECKPOINT_A_DIRECTOR_PROMPT_BUNDLE_VERSION);
    expect(checkpoint.prompt.system).toBe(owner);
    expect(checkpoint.promptBundleDigest).toBe(
      '92ff398f95474b31fff7dee00b06575447cbb244e89b9ac3ff6cb02a7523de95',
    );
    expect(checkpoint.modelConfigVersion).toBe(CHECKPOINT_A_DIRECTOR_MODEL_CONFIG_VERSION);
    expect(checkpoint.modelConfigDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(contract.promptBundleVersion).toBe(DIRECTOR_PROMPT_BUNDLE_VERSION);
    expect(contract.modelConfigVersion).toBe(DIRECTOR_MODEL_CONFIG_VERSION);
  });

  it('fails closed when formal bundle bytes are mutated instead of retaining identity', () => {
    const root = copyPromptFixtures();
    try {
      const taskPath = join(root, 'docs/prompts/interview-director/checkpoint-a-v1/task.md');
      writeFileSync(taskPath, `${readFileSync(taskPath, 'utf8')}\nmutation`, 'utf8');
      expect(
        () => new QuestionDirectorContract({ promptBundle: 'checkpoint_a', repositoryRoot: root }),
      ).toThrow('INTERVIEW_DIRECTOR_PROMPT_BUNDLE_IDENTITY_MISMATCH');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each(['missing', 'draft'])('fails closed for a %s formal bundle', (kind) => {
    const root = copyPromptFixtures();
    try {
      const manifestPath = join(
        root,
        'docs/prompts/interview-director/checkpoint-a-v1/manifest.json',
      );
      if (kind === 'missing') {
        rmSync(manifestPath);
      } else {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        manifest.status = 'draft';
        writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
      }
      expect(() => loadDirectorPromptBundle(root, 'checkpoint_a')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed for an unknown bundle selection', () => {
    expect(() => loadDirectorPromptBundle(process.cwd(), 'unknown')).toThrow(
      'INTERVIEW_DIRECTOR_PROMPT_BUNDLE_UNKNOWN',
    );
  });
});

function copyPromptFixtures(): string {
  const root = mkdtempSync(join(tmpdir(), 'elder-interview-cpa-04-'));
  cpSync(
    join(process.cwd(), 'docs/prompts/interview-director'),
    join(root, 'docs/prompts/interview-director'),
    { recursive: true },
  );
  cpSync(join(process.cwd(), 'docs/contracts'), join(root, 'docs/contracts'), { recursive: true });
  return root;
}
