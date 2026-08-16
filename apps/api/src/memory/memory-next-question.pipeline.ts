import { Injectable } from '@nestjs/common';

import {
  type MemoryContextV2Candidate,
  type WorkingMemoryCandidateOperation,
  type MemoryThreadState,
  type MaintainerTranscriptSegment,
  type WorkingMemoryItem,
  type MemoryReference,
} from './memory-core.contract.js';
import { MemoryContextAssemblyService } from './memory-context-assembly.service.js';
import {
  WorkingMemoryMaintainerService,
  WorkingMemoryOperationApplier,
} from './working-memory-maintainer.service.js';

export type MemoryAwareNextQuestionResult =
  | {
      decision: 'suggest';
      question: string;
      reason: string;
      grounding: readonly { kind: 'segment' | 'memory'; id: string }[];
      context: MemoryContextV2Candidate;
      operations: readonly WorkingMemoryCandidateOperation[];
    }
  | {
      decision: 'continue_listening';
      question: null;
      reason: string;
      grounding: readonly [];
      context: MemoryContextV2Candidate;
      operations: readonly WorkingMemoryCandidateOperation[];
    };

export interface MemoryAwareNextQuestionInput {
  activeThread: MemoryThreadState | null;
  actualAsked?: readonly { id: string; text: string }[];
  bankReferences?: readonly { id: string; text: string; purpose: string }[];
  boundaries?: MemoryContextV2Candidate['boundaries'];
  currentPresentation?: { id: string; text: string } | null;
  currentWorking: readonly WorkingMemoryItem[];
  finalizedTranscript: readonly MaintainerTranscriptSegment[];
  journeyStage?: 'rapport' | 'life_outline' | 'story_depth';
  journeyReasonCodes?: readonly string[];
  midLongIndex?: readonly MemoryReference[];
  recentlyDisplayed?: readonly { id: string; text: string }[];
}

@Injectable()
export class MemoryAwareNextQuestionPipeline {
  public constructor(
    private readonly maintainer: WorkingMemoryMaintainerService,
    private readonly applier: WorkingMemoryOperationApplier,
    private readonly assembler: MemoryContextAssemblyService,
  ) {}

  public async run(input: MemoryAwareNextQuestionInput): Promise<MemoryAwareNextQuestionResult> {
    const maintenance = await this.maintainer.propose({
      activeThread: input.activeThread,
      currentWorking: input.currentWorking,
      finalizedTranscript: input.finalizedTranscript,
      sessionMidIndex: input.midLongIndex ?? [],
    });
    const currentWorking = this.applier.apply(input.currentWorking, maintenance.operations);
    const context = this.assembler.assemble({
      activeThread: input.activeThread,
      actualAsked: input.actualAsked ?? [],
      bankReferences: input.bankReferences ?? [],
      boundaries: [...(input.boundaries ?? []), ...maintenance.boundaryCandidates],
      currentPresentation: input.currentPresentation ?? null,
      journeyStage: input.journeyStage ?? 'life_outline',
      journeyReasonCodes: input.journeyReasonCodes ?? [],
      recentTranscript: input.finalizedTranscript,
      recentlyDisplayed: input.recentlyDisplayed ?? [],
      retrieval: {
        currentWorking,
        midLongIndex: input.midLongIndex ?? [],
        recentTranscript: input.finalizedTranscript,
      },
    });
    const latestElder = [...context.recent_transcript]
      .reverse()
      .find(({ trustedRole }) => trustedRole === 'elder');
    const boundary = context.boundaries.at(-1);
    if (boundary !== undefined && latestElder !== undefined) {
      return {
        context,
        decision: 'continue_listening',
        grounding: [],
        operations: maintenance.operations,
        question: null,
        reason: `已识别长者对“${boundary.abstractScope}”的明确边界，暂不继续追问该范围。`,
      };
    }
    if (latestElder !== undefined) {
      const working = context.current_working_memory[0];
      return {
        context,
        decision: 'suggest',
        grounding:
          working === undefined
            ? [{ kind: 'segment', id: latestElder.segmentId }]
            : [
                { kind: 'memory', id: working.id },
                { kind: 'segment', id: latestElder.segmentId },
              ],
        operations: maintenance.operations,
        question: '刚才您提到的这段经历，后来又发生了什么？',
        reason:
          working === undefined
            ? '沿着长者刚刚完成的叙述继续倾听。'
            : `沿着当前 Working Memory“${working.canonicalKey}”继续追问，避免跳出正在形成的故事主线。`,
      };
    }
    return {
      context,
      decision: 'continue_listening',
      grounding: [],
      operations: maintenance.operations,
      question: null,
      reason: '当前没有足够的长者已完成叙述来形成下一问。',
    };
  }
}
