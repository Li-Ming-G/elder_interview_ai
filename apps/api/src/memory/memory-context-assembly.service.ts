import { Injectable } from '@nestjs/common';

import {
  membershipDigest,
  type MemoryBoundary,
  type MemoryCandidate,
  type MemoryContextV2Candidate,
  type MemoryReference,
  type MemoryThreadState,
  type MaintainerTranscriptSegment,
  type WorkingMemoryItem,
} from './memory-core.contract.js';

export interface RetrievalInput {
  currentWorking: readonly WorkingMemoryItem[];
  midLongIndex: readonly MemoryReference[];
  recentTranscript: readonly MaintainerTranscriptSegment[];
  maxCandidates?: number;
}

export interface ContextAssemblyInput {
  activeThread: MemoryThreadState | null;
  actualAsked: readonly { id: string; text: string }[];
  bankReferences: readonly { id: string; text: string; purpose: string }[];
  boundaries: readonly MemoryBoundary[];
  currentPresentation: { id: string; text: string } | null;
  journeyStage: 'rapport' | 'life_outline' | 'story_depth';
  journeyReasonCodes: readonly string[];
  recentTranscript: readonly MaintainerTranscriptSegment[];
  recentlyDisplayed: readonly { id: string; text: string }[];
  retrieval: RetrievalInput;
  maxTranscriptSegments?: number;
}

@Injectable()
export class MemoryRetrievalService {
  public retrieve(input: RetrievalInput): readonly MemoryCandidate[] {
    const maxCandidates = input.maxCandidates ?? 12;
    const transcriptText = input.recentTranscript
      .map(({ text }) => text.toLocaleLowerCase())
      .join('\n');
    const candidates: MemoryCandidate[] = [
      ...input.currentWorking.map((item, index) => ({
        id: item.id,
        layer: 'working' as const,
        revision: item.revision,
        status: item.status,
        canonicalKey: item.canonicalKey,
        membershipDigest: membershipDigest(
          item.evidence.map(
            (evidence) =>
              `${evidence.segmentId}:${String(evidence.textRevision)}:${String(evidence.speakerRoleRevision)}:${evidence.effectiveTextDigest}`,
          ),
        ),
        source: 'working' as const,
        rank: index,
        score: 1,
        included: true,
        exclusionReason: null,
      })),
      ...input.midLongIndex.map((item, index) => ({
        ...item,
        source:
          item.layer === 'mid' || item.layer === 'long'
            ? ('mid_index' as const)
            : ('recent_transcript' as const),
        rank: input.currentWorking.length + index,
        score:
          (item.status === 'current' ? 0.6 : 0.2) +
          (item.canonicalKey !== null &&
          transcriptText.includes(item.canonicalKey.toLocaleLowerCase())
            ? 0.25
            : 0),
        included:
          item.status === 'current' || item.status === 'uncertain' || item.status === 'disputed',
        exclusionReason:
          item.status === 'superseded'
            ? 'superseded'
            : item.status === 'unavailable'
              ? 'unavailable'
              : null,
      })),
    ];
    const deduped = new Map<string, MemoryCandidate>();
    for (const candidate of candidates) {
      const existing = deduped.get(candidate.id);
      if (existing === undefined || candidate.score > existing.score)
        deduped.set(candidate.id, candidate);
    }
    return [...deduped.values()]
      .sort(
        (left, right) =>
          right.score - left.score || left.rank - right.rank || left.id.localeCompare(right.id),
      )
      .slice(0, maxCandidates)
      .map((candidate, rank) => ({ ...candidate, rank }));
  }
}

@Injectable()
export class MemoryContextAssemblyService {
  public constructor(private readonly retrieval: MemoryRetrievalService) {}

  public assemble(input: ContextAssemblyInput): MemoryContextV2Candidate {
    const maxTranscriptSegments = input.maxTranscriptSegments ?? 40;
    const recentTranscript = input.recentTranscript.slice(-maxTranscriptSegments);
    const candidates = this.retrieval.retrieve(input.retrieval);
    const working = input.retrieval.currentWorking.slice(0, 40);
    const digestParts = [
      ...working.map((item) => `working:${item.id}:${String(item.revision)}`),
      ...candidates.map(
        (candidate) =>
          `candidate:${candidate.id}:${candidate.layer}:${String(candidate.revision)}:${candidate.membershipDigest ?? ''}:${String(candidate.included)}`,
      ),
      ...input.boundaries.map(
        (boundary) => `boundary:${boundary.id}:${String(boundary.revision)}:${boundary.status}`,
      ),
      ...recentTranscript.map(
        (segment) =>
          `segment:${segment.segmentId}:${String(segment.textRevision)}:${String(segment.speakerRoleRevision)}:${segment.effectiveTextDigest}`,
      ),
    ];
    return {
      context_schema_version: 'interview-director-context-v2-candidate',
      active_thread: input.activeThread,
      actual_asked: input.actualAsked,
      bank_references: input.bankReferences,
      boundaries: input.boundaries.filter(({ status }) => status === 'active'),
      budget: {
        maxCandidateItems: candidates.length,
        maxMemoryItems: working.length,
        maxTranscriptSegments: recentTranscript.length,
      },
      current_presentation: input.currentPresentation,
      current_working_memory: working,
      interview_state: {
        goal: goalFor(input.journeyStage),
        journey_reason_codes: input.journeyReasonCodes,
        journey_stage: input.journeyStage,
      },
      memory_candidates: candidates,
      membership_digest: membershipDigest(digestParts),
      recently_displayed: input.recentlyDisplayed,
      recent_transcript: recentTranscript,
    };
  }
}

function goalFor(stage: ContextAssemblyInput['journeyStage']): string {
  if (stage === 'rapport') return '建立安全感并邀请长者从愿意分享的经历开始。';
  if (stage === 'life_outline') return '沿着已经出现的生活线索，邀请长者补充时间与人物关系。';
  return '沿着当前故事主线深入一个具体、可回忆的片段。';
}
