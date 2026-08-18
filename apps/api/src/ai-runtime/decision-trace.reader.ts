import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { AiJob, Prisma } from '../generated/prisma/client.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { effectiveTextDigest } from './ai-provenance.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import { AiPolicyService } from './ai-policy.service.js';
import {
  countDecisionTraceUsefulCharacters,
  DECISION_TRACE_MEMORY_TRIGGER_VERSION,
  DECISION_TRACE_USEFUL_CHARACTER_POLICY_VERSION,
  decisionTraceMemoryTriggerInputHash,
  decisionTraceMemoryTriggerManifest,
  type DecisionTraceMemoryTriggerSegmentInput,
} from './decision-trace.service.js';

const traceInclude = {
  transcriptMemberships: { orderBy: { inputOrder: 'asc' } },
  memoryMemberships: { orderBy: { inputOrder: 'asc' } },
  p3Candidates: { orderBy: { rank: 'asc' } },
  p4Memberships: { orderBy: { inputOrder: 'asc' } },
  evidenceCalls: { orderBy: { invocationNo: 'asc' } },
  memoryTriggerObservation: {
    include: { selectedNewMemberships: { orderBy: { inputOrder: 'asc' } } },
  },
} satisfies Prisma.DecisionTraceInclude;

type DecisionTraceRead = Prisma.DecisionTraceGetPayload<{ include: typeof traceInclude }>;
type ProviderProvenance = Pick<
  Prisma.AiProviderCallGetPayload<{
    select: {
      callNo: true;
      status: true;
      providerRequestId: true;
      inputHash: true;
      outputHash: true;
      latencyMs: true;
      errorCode: true;
    };
  }>,
  'callNo' | 'status' | 'providerRequestId' | 'inputHash' | 'outputHash' | 'latencyMs' | 'errorCode'
>;

/**
 * Read-only, reference-only trace access. This deliberately never joins or
 * returns transcript, memory, question, prompt, or provider payload bodies.
 */
@Injectable()
export class DecisionTraceReader {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
    private readonly eligibility: AiOutputEligibilityService,
  ) {}

  public async read(
    actorId: string,
    traceId: string,
  ): Promise<{ trace: DecisionTraceRead; providerProvenance: ProviderProvenance[] | null }> {
    const trace = await this.prisma.decisionTrace.findUnique({
      where: { id: traceId },
      include: traceInclude,
    });
    if (trace === null || trace.retentionState !== 'active' || trace.expiresAt <= new Date()) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const actor = await this.prisma.user.findUnique({
      select: { status: true },
      where: { id: actorId },
    });
    if (actor?.status !== 'active') throw new Error('DECISION_TRACE_UNAVAILABLE');
    let scopeSessionIds: string[] = [trace.sessionId];
    let frozenScopes: Array<{
      eligibleSegmentCount: number;
      segmentManifestHash: string;
      sessionId: string;
      speakerRoleRevision: number;
    }> = [];
    let sourceJob: AiJob | null = null;
    if (trace.aiJobId !== null) {
      const [job, scopes] = await Promise.all([
        this.prisma.aiJob.findUnique({ where: { id: trace.aiJobId } }),
        this.prisma.aiJobSessionScope.findMany({
          orderBy: { inputOrder: 'asc' },
          where: { aiJobId: trace.aiJobId },
        }),
      ]);
      sourceJob = job;
      if (
        job === null ||
        job.projectId !== trace.projectId ||
        job.retentionState !== 'active' ||
        job.expiresAt <= new Date() ||
        scopes.length === 0
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
      frozenScopes = scopes;
      scopeSessionIds = scopes.map(({ sessionId }) => sessionId);
      if (!scopeSessionIds.includes(trace.sessionId)) throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    await this.policy.assertAllowed(actorId, trace.projectId, scopeSessionIds).catch(() => {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    });
    const sessions = await this.prisma.interviewSession.findMany({
      where: { id: { in: scopeSessionIds }, projectId: trace.projectId },
      select: { id: true },
    });
    if (sessions.length !== new Set(scopeSessionIds).size)
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    const scopeBySessionId = new Map(frozenScopes.map((scope) => [scope.sessionId, scope]));
    for (const membership of trace.p4Memberships.filter((item) => item.sourceType === 'session')) {
      const scope = scopeBySessionId.get(membership.sourceId);
      if (
        trace.aiJobId === null
          ? membership.sourceId !== trace.sessionId
          : scope === undefined ||
            membership.revisionStatus !== 'available' ||
            membership.revision !== scope.speakerRoleRevision ||
            membership.membershipDigest !== scope.segmentManifestHash
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }

    for (const membership of trace.transcriptMemberships) {
      const segment = await this.prisma.transcriptSegment.findUnique({
        where: { id: membership.segmentId },
      });
      if (
        segment === null ||
        !scopeSessionIds.includes(segment.sessionId) ||
        segment.textRevision !== membership.textRevision ||
        segment.speakerRoleRevision !== membership.speakerRoleRevision ||
        effectiveTextDigest(segment.correctedText ?? segment.originalText) !==
          membership.effectiveTextDigest
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    await this.assertMemoryTriggerObservation(trace, sourceJob, scopeSessionIds);
    for (const membership of trace.memoryMemberships) {
      const memory = await this.prisma.memoryResolution.findUnique({
        where: { id: membership.memoryId },
        select: { resolutionRevision: true },
      });
      if (
        memory === null ||
        memory.resolutionRevision !== membership.revision ||
        !(await this.eligibility.isMemoryResolutionEligible(
          actorId,
          trace.projectId,
          membership.memoryId,
        ))
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const snapshotIds = trace.p4Memberships
      .filter(
        (item) => item.sourceType === 'display_snapshot' || item.sourceType === 'presentation',
      )
      .map((item) => item.sourceId);
    if (snapshotIds.length > 0) {
      const snapshots = await this.prisma.questionDisplaySnapshot.findMany({
        where: { id: { in: snapshotIds }, retentionState: 'active', expiresAt: { gt: new Date() } },
      });
      if (
        snapshots.length !== new Set(snapshotIds).size ||
        snapshots.some((snapshot) => !scopeSessionIds.includes(snapshot.sessionId))
      )
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
      for (const membership of trace.p4Memberships.filter(
        (item) => item.sourceType === 'display_snapshot' || item.sourceType === 'presentation',
      )) {
        const snapshot = snapshotsById.get(membership.sourceId);
        if (
          snapshot === undefined ||
          membership.revisionStatus !== 'available' ||
          membership.revision !== snapshot.publishedPresentationRevision ||
          membership.membershipDigest !== snapshot.normalizedQuestionDigest
        )
          throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const actualIds = trace.p4Memberships
      .filter((item) => item.sourceType === 'actual_question')
      .map((item) => item.sourceId);
    if (actualIds.length > 0) {
      for (const membership of trace.p4Memberships.filter(
        (item) => item.sourceType === 'actual_question',
      )) {
        const question = await this.prisma.actualQuestion.findUnique({
          where: { id: membership.sourceId },
        });
        const analysis =
          question === null
            ? null
            : await this.prisma.actualQuestionAnalysis.findUnique({
                where: { id: question.actualQuestionAnalysisId },
              });
        if (
          question === null ||
          analysis === null ||
          membership.revisionStatus !== 'available' ||
          membership.revision !== analysis.analysisRevision ||
          membership.membershipDigest !== question.normalizedDigest ||
          !(await this.eligibility.isActualQuestionEligible(
            actorId,
            trace.projectId,
            question.id,
            scopeSessionIds,
          ))
        ) {
          throw new Error('DECISION_TRACE_UNAVAILABLE');
        }
      }
    }
    const providerProvenance =
      trace.aiJobId === null
        ? null
        : await this.prisma.aiProviderCall.findMany({
            where: { aiJobId: trace.aiJobId },
            orderBy: { callNo: 'asc' },
            select: {
              callNo: true,
              status: true,
              providerRequestId: true,
              inputHash: true,
              outputHash: true,
              latencyMs: true,
              errorCode: true,
            },
          });
    return { trace, providerProvenance };
  }

  private async assertMemoryTriggerObservation(
    trace: DecisionTraceRead,
    sourceJob: AiJob | null,
    scopeSessionIds: readonly string[],
  ): Promise<void> {
    const observation = trace.memoryTriggerObservation ?? null;
    const isV12MemoryJob =
      sourceJob?.jobType === 'working_memory_maintain' &&
      sourceJob.triggerDedupeKey?.startsWith('memory-p1-v1.2:') === true;
    if (!isV12MemoryJob) {
      if (observation !== null) throw new Error('DECISION_TRACE_UNAVAILABLE');
      return;
    }
    if (
      observation === null ||
      trace.aiJobId === null ||
      observation.aiJobId !== trace.aiJobId ||
      observation.observationVersion !== DECISION_TRACE_MEMORY_TRIGGER_VERSION ||
      observation.usefulCharacterPolicyVersion !== DECISION_TRACE_USEFUL_CHARACTER_POLICY_VERSION ||
      observation.triggerIdentity !== sourceJob.triggerDedupeKey ||
      observation.minimumUsefulCharacters <= 0 ||
      observation.selectedNewSegmentCount !== observation.selectedNewMemberships.length ||
      observation.selectedNewManifestHash !==
        decisionTraceMemoryTriggerManifest(observation.selectedNewMemberships)
    ) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const ids = observation.selectedNewMemberships.map(
      ({ transcriptSegmentId }) => transcriptSegmentId,
    );
    if (new Set(ids).size !== ids.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
    const segments = await this.prisma.transcriptSegment.findMany({
      where: { id: { in: ids } },
    });
    if (segments.length !== ids.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    let cumulative = 0;
    for (const [inputOrder, membership] of observation.selectedNewMemberships.entries()) {
      const segment = byId.get(membership.transcriptSegmentId);
      const text = segment?.correctedText ?? segment?.originalText;
      if (
        membership.inputOrder !== inputOrder ||
        segment === undefined ||
        text === undefined ||
        !scopeSessionIds.includes(segment.sessionId) ||
        segment.contentKind !== 'conversation' ||
        projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole !== 'elder' ||
        segment.textRevision !== membership.textRevision ||
        segment.speakerRoleRevision !== membership.speakerRoleRevision ||
        effectiveTextDigest(text) !== membership.effectiveTextDigest ||
        countDecisionTraceUsefulCharacters(text) !== membership.usefulCharacterCount
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
      cumulative += membership.usefulCharacterCount;
    }
    if (cumulative !== observation.cumulativeUsefulCharacters)
      throw new Error('DECISION_TRACE_UNAVAILABLE');

    const unjudged = sourceJob.failureCode === 'MEMORY_UNJUDGED';
    if (unjudged) {
      if (
        sourceJob.status !== 'cancelled' ||
        observation.triggerKind !== 'session_final_flush' ||
        !observation.triggerIdentity.endsWith(
          `:final-unjudged:${observation.selectedNewManifestHash.slice(0, 32)}`,
        ) ||
        (observation.selectedNewSegmentCount > 0 &&
          observation.cumulativeUsefulCharacters >= observation.minimumUsefulCharacters) ||
        trace.status !== 'unavailable' ||
        trace.decisionOutcome !== 'unavailable' ||
        trace.directorInvoked ||
        trace.errorCode !== 'MEMORY_UNJUDGED' ||
        trace.completedAt === null ||
        (await this.prisma.aiProviderCall.count({ where: { aiJobId: sourceJob.id } })) !== 0
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    } else if (observation.cumulativeUsefulCharacters < observation.minimumUsefulCharacters) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const sourceMemberships = await this.prisma.memoryMaintenanceInputSegment.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: sourceJob.id },
    });
    if (unjudged) {
      const scopeRows = await this.prisma.aiJobSessionScope.findMany({
        where: { aiJobId: sourceJob.id },
      });
      const scope = scopeRows[0];
      if (
        scopeRows.length !== 1 ||
        scope === undefined ||
        scope.sessionId !== trace.sessionId ||
        scope.eligibleSegmentCount !== observation.selectedNewSegmentCount ||
        scope.segmentManifestHash !== observation.selectedNewManifestHash ||
        trace.inputHash !==
          decisionTraceMemoryTriggerInputHash({
            contextBuilderVersion: 'memory-maintainer-v1.2',
            jobType: sourceJob.jobType,
            projectId: sourceJob.projectId,
            selectedNewManifestHash: observation.selectedNewManifestHash,
            sessionId: trace.sessionId,
            triggerIdentity: observation.triggerIdentity,
          }) ||
        sourceJob.inputHash !== trace.inputHash
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const memberships = unjudged
      ? sourceMemberships
      : sourceMemberships.filter((membership) => membership.membershipKind === 'new');
    if (
      memberships.length !== observation.selectedNewMemberships.length ||
      (unjudged && sourceMemberships.some((membership) => membership.membershipKind !== 'new'))
    ) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const inputRows = await this.prisma.aiJobInputSegment.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: sourceJob.id },
    });
    if (unjudged && inputRows.length !== observation.selectedNewMemberships.length) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const inputsById = new Map(inputRows.map((row) => [row.id, row]));
    for (const [index, source] of memberships.entries()) {
      const observed = observation.selectedNewMemberships[index] as
        DecisionTraceMemoryTriggerSegmentInput | undefined;
      const input = inputsById.get(source.aiJobInputSegmentId);
      if (
        observed === undefined ||
        input === undefined ||
        (unjudged &&
          (source.inputOrder !== index ||
            input.inputOrder !== index ||
            input.sessionId !== trace.sessionId ||
            source.aiJobInputSegmentId !== input.id ||
            source.transcriptSegmentId !== observed.transcriptSegmentId)) ||
        input.transcriptSegmentId !== observed.transcriptSegmentId ||
        input.textRevision !== observed.textRevision ||
        input.speakerRoleRevision !== observed.speakerRoleRevision ||
        input.effectiveTextDigest !== observed.effectiveTextDigest
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
  }
}
