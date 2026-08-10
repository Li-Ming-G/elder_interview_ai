import { describe, expect, it } from 'vitest';

import type { CurrentMemoryItem } from '../memory/memory.service.js';
import type { EligibleQuestionBankItem } from '../question-bank/question-bank.types.js';
import { LocalTestQuestionDirector } from './question-director.js';

describe('LocalTestQuestionDirector', () => {
  const director = new LocalTestQuestionDirector();

  it('returns null instead of inventing a question when no eligible bank item exists', async () => {
    await expect(
      director.select({
        attemptKind: 'automatic',
        eligible: [],
        journeyStage: 'rapport',
        memories: [],
      }),
    ).resolves.toBeNull();
  });

  it('returns the licensed bank wording verbatim by default', async () => {
    const selected = await director.select({
      attemptKind: 'automatic',
      eligible: [bankItem({ questionText: '您小时候最喜欢在哪里玩？' })],
      journeyStage: 'rapport',
      memories: [],
    });

    expect(selected).toMatchObject({
      adaptationReasonCode: null,
      purpose: 'detail',
      questionText: '您小时候最喜欢在哪里玩？',
      selectionMode: 'verbatim',
      sourceQuestionId: 'demo-basic-1',
    });
  });

  it('only applies the controlled surface_wording transform and preserves purpose', async () => {
    const selected = await director.select({
      attemptKind: 'manual_next',
      eligible: [bankItem({ questionText: '如果您愿意，可以先从小时候住过的地方讲起吗？' })],
      journeyStage: 'rapport',
      memories: [],
    });

    expect(selected).toMatchObject({
      adaptationReasonCode: 'surface_wording',
      purpose: 'detail',
      questionText: '如果您愿意，能从小时候住过的地方讲讲吗？',
      selectionMode: 'lightly_adapted',
    });
  });

  it('fills a person slot only from a current single-resolution memory and keeps its provenance', async () => {
    const memory: CurrentMemoryItem = {
      authority: 'human_confirmed',
      canonicalKey: 'person.important.name',
      id: '11111111-1111-4111-8111-111111111111',
      memoryType: 'person',
      resolutionKind: 'single',
      resolutionRevision: 4,
      resolvedValue: { name: '林老师' },
    };
    const selected = await director.select({
      attemptKind: 'manual_next',
      eligible: [bankItem({ purpose: 'person', questionText: '谁对您影响最大？' })],
      journeyStage: 'life_outline',
      memories: [memory],
    });

    expect(selected).toMatchObject({
      adaptationReasonCode: 'grounded_slot_fill',
      groundedSlotValue: '林老师',
      memoryResolutionIds: [memory.id],
      purpose: 'person',
      questionText: '您年轻时，林老师是不是一位对您影响很大的人？',
      selectionMode: 'lightly_adapted',
    });
  });
});

function bankItem(overrides: Partial<EligibleQuestionBankItem> = {}): EligibleQuestionBankItem {
  return {
    applicableConditionCodes: ['stage.rapport'],
    bank: 'basic',
    bankVersion: 'internal-demo-v1',
    inapplicableConditionCodes: [],
    itemId: '22222222-2222-4222-8222-222222222222',
    licenseStatus: 'fixture_only',
    purpose: 'detail',
    questionId: 'demo-basic-1',
    questionText: '您小时候最喜欢在哪里玩？',
    sensitivity: 'low',
    sourceType: 'synthetic_fixture',
    topic: '童年',
    ...overrides,
  };
}
