import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  AiJobCoordinatorService,
  type FreezeAiJobRequest,
  type FrozenAiJob,
} from '../ai-runtime/ai-job-coordinator.service.js';
import { AiPolicyService } from '../ai-runtime/ai-policy.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { MemoryP2PersistenceReader } from './memory-p2-persistence.reader.js';
import { MemoryP2PersistenceRepository } from './memory-p2-persistence.repository.js';
import { MemoryP2RecoveryService } from './memory-p2-recovery.service.js';
import { MemoryP2DecisionTraceService } from './memory-p2-decision-trace.service.js';
import { semanticSourceKindManifestHash } from './memory-semantic-envelope-contract.js';
import {
  MemoryP2OrchestrationService,
  type MemoryP2Clock,
} from './memory-p2-orchestration.service.js';
import { MemoryP2PlanAdapter } from './memory-p2-plan-adapter.js';
import type { MemoryP2ProviderPort } from './memory-p2-provider.port.js';
import {
  memoryP2CheckpointManifestHash,
  memoryP2LongSourceManifestHash,
  memoryP2SourceSessionSetHash,
  type MemoryP2CheckpointMemberInput,
  type MemoryP2ClaimInput,
  type MemoryP2CommitInput,
  type MemoryP2EvidenceInput,
  type MemoryP2FreezeCheckpointInput,
  type MemoryP2FreezeLongJobInput,
  type MemoryP2LeaseToken,
  type MemoryP2LongSourceInput,
  type MemoryP2LongWakeCandidate,
  type MemoryP2TraceSourceInput,
} from './memory-p2-persistence.types.js';
import type {
  MemoryP2AuthorityResult,
  MemoryP2CommitRequest,
  MemoryP2CommitResult,
  MemoryP2ErrorCode,
  MemoryP2FreezeResult,
  MemoryP2FrozenAttempt,
  MemoryP2GateResult,
  MemoryP2LongFollowUp,
  MemoryP2ProgressEvent,
  MemoryP2ProgressPort,
  MemoryP2StoredOutcome,
  MemoryP2RuntimeStorePort,
  MemoryP2TerminalRequest,
  MemoryP2Trigger,
  MemoryP2SemanticContext,
  MemoryP2SemanticClaim,
  MemoryP2SourceMember,
} from './memory-p2-runtime.types.js';
import {
  MemoryP2RuntimeError,
  type MemoryP2RecoveryAuthority,
  type MemoryP2RecoveryCasResult,
  type MemoryP2RecoveryCommand,
  type MemoryP2RecoveryPort,
  type MemoryP2TraceReference,
  type MemoryP2TraceReferenceAuthority,
} from './memory-p2-observability.types.js';
import type {
  MemoryP2DecisionTraceWrite,
  MemoryP2DecisionTraceWritePort,
  MemoryP2ObservabilitySink,
  MemoryP2RunningTraceStage,
  MemoryP2TraceAuthorityPort,
  MemoryP2TraceIdentity,
  MemoryP2JobStatus,
  MemoryP2TracePolicyAuthority,
  MemoryP2TraceSourceSessionAuthority,
  MemoryP2TraceStatus,
  MemoryP2TraceWriteResult,
} from './memory-p2-observability.types.js';
import { buildMemoryP2Trigger } from './memory-p2-trigger.js';
import {
  semanticCanonicalDigest,
  semanticContentDigest,
  semanticEvidenceManifestHash,
  semanticSourceManifestHash,
} from './memory-semantic-envelope-contract.js';

type Tx = Prisma.TransactionClient;
type Clock = { now(): Date };

const CLOCK: Clock = { now: () => new Date() };
const P2_CONTRACT = 'p2-contract-v1';
const P2_RETENTION_CONTRACT = 'p2-retention-contract-v1';

interface SourceSpec {
  snapshotId: string | null;
  checkpointId: string | null;
  resolutionIds: readonly string[];
  long: boolean;
}

interface Material {
  context: MemoryP2SemanticContext;
  expiresAt: Date;
  members: readonly MemoryP2CheckpointMemberInput[];
  refs: readonly MemoryP2TraceSourceInput[];
  threadId: string;
  threadRevisionId: string;
  threadRevision: number;
  threadStatus: string;
  threadManifestHash: string;
  boundaryManifestHash: string;
  resolutionManifestHash: string;
  snapshotId: string;
  checkpointRoot: string;
  longSources: readonly MemoryP2LongSourceInput[];
}

/** Concrete production binding for the already accepted P2-C seams. */
@Injectable()
export class MemoryP2RuntimeStoreAdapter
  implements
    MemoryP2RuntimeStorePort,
    MemoryP2ProgressPort,
    MemoryP2RecoveryPort,
    MemoryP2DecisionTraceWritePort,
    MemoryP2TraceAuthorityPort,
    MemoryP2ObservabilitySink
{
  public readonly transactionOwnership = 'existing_ai_job_coordinator' as const;
  private readonly traceService: MemoryP2DecisionTraceService;

  public get recoveryPort(): MemoryP2RecoveryPort {
    return this.repository;
  }

  public constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobCoordinatorService,
    private readonly policy: AiPolicyService,
    private readonly repository: MemoryP2PersistenceRepository,
    private readonly reader: MemoryP2PersistenceReader,
    private readonly clock: Clock = CLOCK,
  ) {
    this.traceService = new MemoryP2DecisionTraceService(this, this, this, clock);
  }

  public async freezeJobCheckpointAndRunningTrace(
    trigger: MemoryP2Trigger,
  ): Promise<MemoryP2FreezeResult> {
    const source = await this.sourceSpec(trigger);
    const request = await this.freezeRequest(trigger, source);
    let attempt: MemoryP2FrozenAttempt | undefined;
    const frozen = await this.jobs.freeze({
      ...request,
      afterFreeze: async (tx, job) => {
        const material = await this.material(tx, trigger, job, source, !source.long);
        const lease = this.lease(request.expiresAt);
        const traceId = deterministicUuid(`trace:${trigger.requestIdentity}`);
        if (source.long) {
          await this.repository.freezeLongJob(
            this.longFreeze(trigger, job, material, lease, traceId),
            tx,
          );
        } else {
          await this.repository.freezeCheckpoint(
            this.midFreeze(
              trigger,
              job,
              material,
              lease,
              traceId,
              deterministicUuid(`checkpoint:${trigger.requestIdentity}`),
            ),
            tx,
          );
        }
        attempt = {
          attemptNo: trigger.attemptNo,
          context: material.context,
          deadlineAt: request.expiresAt,
          jobId: job.id,
          trigger,
        };
      },
    });
    if (attempt !== undefined) return { attempt, kind: 'claimed' };
    const job = await this.prisma.aiJob.findUnique({ where: { id: frozen.id } });
    if (job === null) throw new MemoryP2RuntimeError('P2_TERMINAL_UNAVAILABLE');
    const outcome = await this.outcome(job.id, job.status, job.failureCode);
    if (outcome !== null) return { kind: 'replay', outcome };
    return {
      jobId: job.id,
      kind: 'in_progress',
      status: job.status === 'pending' ? 'pending' : 'running',
    };
  }

  public async preProviderGate(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2GateResult> {
    const job = await this.prisma.aiJob.findUnique({ where: { id: attempt.jobId } });
    if (job === null || job.status !== 'running') return blocked('P2_TARGET_DRIFT', 'cancelled');
    if (job.retentionState !== 'active' || job.expiresAt <= this.clock.now())
      return blocked('P2_RETENTION_UNAVAILABLE', 'unavailable');
    try {
      const currentPolicy = await this.policy.assertAllowed(job.requestedBy, job.projectId, [
        attempt.trigger.sessionId,
      ]);
      if (currentPolicy.deletionScopeDigest !== attempt.trigger.policy.deletionScopeDigest)
        return blocked('P2_DELETION_SCOPE_DRIFT', 'cancelled');
    } catch {
      return blocked('P2_POLICY_DRIFT', 'cancelled');
    }
    const projection = await this.prisma.memoryP2JobProjection.findUnique({
      where: { aiJobId: job.id },
    });
    if (
      projection === null ||
      projection.deletionScopeDigest !== attempt.trigger.policy.deletionScopeDigest ||
      projection.p2PolicyRevision !== attempt.trigger.policy.p2PolicyRevision ||
      projection.p2RetentionPolicyVersion !== attempt.trigger.policy.p2RetentionPolicyVersion
    )
      return blocked('P2_POLICY_DRIFT', 'cancelled');
    return { kind: 'allowed' };
  }

  public async readAuthority(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2AuthorityResult> {
    const [job, projection, trace] = await Promise.all([
      this.prisma.aiJob.findUnique({ where: { id: attempt.jobId } }),
      this.prisma.memoryP2JobProjection.findUnique({ where: { aiJobId: attempt.jobId } }),
      this.prisma.decisionTraceMemorySemantic.findUnique({ where: { aiJobId: attempt.jobId } }),
    ]);
    if (job === null || projection === null || trace === null)
      return { errorCode: 'P2_TARGET_DRIFT', kind: 'drifted', status: 'cancelled' };
    if (job.status !== 'running')
      return { errorCode: 'P2_TARGET_DRIFT', kind: 'drifted', status: 'cancelled' };
    if (job.retentionState !== 'active' || job.expiresAt <= this.clock.now())
      return { errorCode: 'P2_RETENTION_UNAVAILABLE', kind: 'drifted', status: 'unavailable' };
    if (
      projection.deletionScopeDigest !== attempt.trigger.policy.deletionScopeDigest ||
      projection.p2PolicyRevision !== attempt.trigger.policy.p2PolicyRevision ||
      projection.p2RetentionPolicyVersion !== attempt.trigger.policy.p2RetentionPolicyVersion ||
      trace.sourceManifestHash !== projection.sourceRevisionDigest
    )
      return { errorCode: 'P2_SOURCE_DRIFT', kind: 'drifted', status: 'cancelled' };
    return {
      authorityToken: `${job.id}:${String(job.attemptNo)}:${String(projection.recoveryLeaseEpoch)}`,
      kind: 'current',
    };
  }

  public async commitAuthorityAndTerminalTrace(
    request: MemoryP2CommitRequest,
  ): Promise<MemoryP2CommitResult> {
    const inputs = await this.commitInput(request);
    if (inputs === null) return { errorCode: 'P2_CAS_LOST', kind: 'cas_lost' };
    try {
      const results = await this.repository.commitLayerRevisions(inputs);
      const result = results[results.length - 1];
      if (result === undefined) return { errorCode: 'P2_CAS_LOST', kind: 'cas_lost' };
      return { commitProjection: result, kind: 'committed' };
    } catch (error) {
      if (error instanceof Error && error.message === 'MEMORY_P2_AUTHORITY_CAS_MISMATCH')
        return { errorCode: 'P2_CAS_LOST', kind: 'cas_lost' };
      throw error;
    }
  }

  public async terminalizeJobAndTrace(
    request: MemoryP2TerminalRequest,
  ): Promise<MemoryP2StoredOutcome> {
    const projection = await this.prisma.memoryP2JobProjection.findUnique({
      where: { aiJobId: request.attempt.jobId },
    });
    const trace = await this.prisma.decisionTraceMemorySemantic.findUnique({
      where: { aiJobId: request.attempt.jobId },
    });
    if (projection === null || trace === null)
      throw new MemoryP2RuntimeError('P2_TERMINAL_UNAVAILABLE');
    await this.repository.terminalizeUnavailable({
      aiJobId: request.attempt.jobId,
      errorCode: request.errorCode,
      lease: {
        epoch: projection.recoveryLeaseEpoch,
        expiresAt: projection.recoveryLeaseExpiresAt,
        owner: projection.recoveryLeaseOwner,
      },
      status: request.status,
      traceId: trace.traceId,
    });
    return { errorCode: request.errorCode, jobId: request.attempt.jobId, status: request.status };
  }

  public async registerLongWakeAfterFinalMid(followUp: MemoryP2LongFollowUp): Promise<boolean> {
    const pending = await this.reader.listPendingLongWakeCandidates(500);
    return pending.some((candidate) => candidate.sourceMidJobId === followUp.finalMidJobId);
  }

  public async recordProgress(event: MemoryP2ProgressEvent): Promise<void> {
    const stage: MemoryP2RunningTraceStage | null =
      event.stage === 'proposal_received'
        ? 'proposed'
        : event.stage === 'proposal_validated'
          ? 'validated'
          : event.stage === 'plan_built'
            ? 'planned'
            : null;
    if (stage === null || event.stage === 'proposal_received') return;
    const durable = await this.runningTraceInput(event.jobId);
    if (durable === null) throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
    const advance = async (
      nextStage: Exclude<MemoryP2RunningTraceStage, 'frozen'>,
      planDigest: string | null,
    ): Promise<void> => {
      const result = await this.traceService.advanceRunningStage({
        identity: durable.identity,
        memoryOutcome: 'unjudged',
        p2PolicyRevision: durable.policy.p2PolicyRevision,
        p2RetentionPolicyVersion: durable.policy.p2RetentionPolicyVersion,
        planDigest,
        proposalDigest:
          'proposalDigest' in event ? event.proposalDigest : (durable.trace.proposalDigest ?? ''),
        references: durable.references,
        retentionState: 'active',
        sourceSessionScope: durable.sourceSession,
        stage: nextStage,
      });
      if (result.outcome === 'cas_lost') throw new MemoryP2RuntimeError('P2_CAS_LOST');
    };
    if (stage === 'validated') await advance('proposed', null);
    await advance(stage, event.stage === 'plan_built' ? event.planDigest : null);
  }

  public record(observation: Parameters<MemoryP2ObservabilitySink['record']>[0]): void {
    void observation;
  }

  public async readPolicyAuthority(
    aiJobId: string,
    writeAt: Date,
    transaction?: Tx,
  ): Promise<MemoryP2TracePolicyAuthority | null> {
    void writeAt;
    const db = transaction ?? this.prisma;
    const [job, projection] = await Promise.all([
      db.aiJob.findUnique({ where: { id: aiJobId } }),
      db.memoryP2JobProjection.findUnique({ where: { aiJobId } }),
    ]);
    if (job === null || projection === null) return null;
    return {
      aiJobId,
      deletionScopeDigest: projection.deletionScopeDigest,
      expiresAt: job.expiresAt,
      p2PolicyRevision: projection.p2PolicyRevision,
      p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
      retentionState: job.retentionState as MemoryP2TracePolicyAuthority['retentionState'],
    };
  }

  public async readSourceSessionAuthority(
    aiJobId: string,
    transaction?: Tx,
  ): Promise<MemoryP2TraceSourceSessionAuthority | null> {
    const db = transaction ?? this.prisma;
    const [job, projection, longProjection] = await Promise.all([
      db.aiJob.findUnique({ where: { id: aiJobId } }),
      db.memoryP2JobProjection.findUnique({ where: { aiJobId } }),
      db.memoryLongJobProjection.findUnique({ where: { aiJobId } }),
    ]);
    if (job === null) return null;
    if (job.jobType === 'long_session_end' && longProjection !== null)
      return {
        aiJobId,
        sourceSessionIds: longProjection.sourceSessionIds,
        sourceSessionManifestHash: longProjection.sourceSessionSetHash,
        targetLayer: 'long',
      };
    const checkpoint = await db.memoryEvolutionCheckpoint.findFirst({
      where:
        projection?.sourceFinalMidCheckpointId === null ||
        projection?.sourceFinalMidCheckpointId === undefined
          ? { p2ProducerJobId: aiJobId }
          : {
              OR: [{ p2ProducerJobId: aiJobId }, { id: projection.sourceFinalMidCheckpointId }],
            },
    });
    if (checkpoint === null) return null;
    const sourceSessionIds = [checkpoint.sourceSessionId];
    return {
      aiJobId,
      sourceSessionIds,
      sourceSessionManifestHash: memoryP2SourceSessionSetHash(sourceSessionIds),
      targetLayer: job.jobType === 'long_session_end' ? 'long' : 'mid',
    };
  }

  public async readReferenceAuthorities(
    references: readonly MemoryP2TraceReference[],
    transaction?: Tx,
  ): Promise<readonly MemoryP2TraceReferenceAuthority[]> {
    const db = transaction ?? this.prisma;
    const authorities: MemoryP2TraceReferenceAuthority[] = [];
    for (const reference of references) {
      const authority = await this.readReferenceAuthority(reference, db);
      if (authority === null) return [];
      authorities.push(authority);
    }
    return authorities;
  }

  private async validateTraceWriteAuthorities(
    tx: Tx,
    write: MemoryP2DecisionTraceWrite,
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority,
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority,
    writeAt: Date,
    expectedJobStatuses: readonly MemoryP2JobStatus[] = ['running'],
  ): Promise<boolean> {
    const job = await tx.aiJob.findUnique({ where: { id: write.parent.aiJobId } });
    if (job === null || !expectedJobStatuses.includes(job.status)) return false;
    const [policy, source, references] = await Promise.all([
      this.readPolicyAuthority(write.parent.aiJobId, writeAt, tx),
      this.readSourceSessionAuthority(write.parent.aiJobId, tx),
      this.readReferenceAuthorities(write.references, tx),
    ]);
    return (
      policy !== null &&
      policy.aiJobId === expectedPolicyAuthority.aiJobId &&
      policy.p2PolicyRevision === expectedPolicyAuthority.p2PolicyRevision &&
      policy.p2RetentionPolicyVersion === expectedPolicyAuthority.p2RetentionPolicyVersion &&
      policy.deletionScopeDigest === expectedPolicyAuthority.deletionScopeDigest &&
      policy.retentionState === expectedPolicyAuthority.retentionState &&
      policy.expiresAt.getTime() === expectedPolicyAuthority.expiresAt.getTime() &&
      source !== null &&
      source.aiJobId === expectedSourceSessionAuthority.aiJobId &&
      source.targetLayer === expectedSourceSessionAuthority.targetLayer &&
      sameStrings(source.sourceSessionIds, expectedSourceSessionAuthority.sourceSessionIds) &&
      source.sourceSessionManifestHash ===
        expectedSourceSessionAuthority.sourceSessionManifestHash &&
      traceReferenceAuthoritiesMatch(
        write.references,
        references,
        write.parent.projectId,
        expectedSourceSessionAuthority.sourceSessionIds,
      )
    );
  }

  public async createRunning(input: {
    write: MemoryP2DecisionTraceWrite;
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority;
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority;
    writeAt: Date;
  }): Promise<MemoryP2TraceWriteResult> {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await this.validateTraceWriteAuthorities(
          tx,
          input.write,
          input.expectedPolicyAuthority,
          input.expectedSourceSessionAuthority,
          input.writeAt,
        ))
      )
        return { outcome: 'cas_lost', trace: null };
      const existing = await tx.decisionTrace.findUnique({
        where: { id: input.write.parent.traceId },
      });
      if (existing !== null) {
        const semantic = await tx.decisionTraceMemorySemantic.findUnique({
          where: { traceId: input.write.parent.traceId },
        });
        return existing.status === 'running' &&
          existing.stage === 'frozen' &&
          semantic !== null &&
          semantic.sourceManifestHash === input.write.semantic.sourceManifestHash &&
          semantic.deletionScopeDigest === input.write.semantic.deletionScopeDigest
          ? { outcome: 'replayed', trace: input.write }
          : { outcome: 'cas_lost', trace: null };
      }
      await tx.decisionTrace.create({ data: traceParentRow(input.write.parent) });
      await tx.decisionTraceMemorySemantic.create({ data: traceSemanticRow(input.write.semantic) });
      await tx.decisionTraceMemorySourceReference.createMany({
        data: input.write.references.map((reference) =>
          traceReferenceRow(input.write.parent.traceId, reference),
        ),
      });
      return { outcome: 'created', trace: input.write };
    });
  }

  public async advanceRunningStage(input: {
    write: MemoryP2DecisionTraceWrite;
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority;
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority;
    expectedStage: MemoryP2RunningTraceStage;
    writeAt: Date;
  }): Promise<MemoryP2TraceWriteResult> {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await this.validateTraceWriteAuthorities(
          tx,
          input.write,
          input.expectedPolicyAuthority,
          input.expectedSourceSessionAuthority,
          input.writeAt,
        ))
      )
        return { outcome: 'cas_lost', trace: null };
      const semantic = await tx.decisionTraceMemorySemantic.findUnique({
        where: { traceId: input.write.parent.traceId },
      });
      const parent = await tx.decisionTrace.findUnique({
        where: { id: input.write.parent.traceId },
      });
      if (semantic === null || parent === null || parent.status !== 'running')
        return { outcome: 'cas_lost', trace: null };
      if (
        parent.stage === input.write.parent.stage &&
        semantic.proposalDigest === input.write.semantic.proposalDigest &&
        semantic.planDigest === input.write.semantic.planDigest
      )
        return { outcome: 'replayed', trace: input.write };
      if (parent.stage !== input.expectedStage) return { outcome: 'cas_lost', trace: null };
      const updated = await tx.decisionTrace.updateMany({
        data: { stage: input.write.parent.stage },
        where: { id: parent.id, stage: input.expectedStage, status: 'running' },
      });
      if (updated.count !== 1) return { outcome: 'cas_lost', trace: null };
      await tx.decisionTraceMemorySemantic.update({
        data: {
          planDigest: input.write.semantic.planDigest,
          proposalDigest: input.write.semantic.proposalDigest,
        },
        where: { traceId: parent.id },
      });
      return { outcome: 'updated', trace: input.write };
    });
  }

  public async writeTerminal(input: {
    write: MemoryP2DecisionTraceWrite;
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority;
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority;
    expectedJobStatuses: readonly MemoryP2JobStatus[];
    expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
    writeAt: Date;
  }): Promise<MemoryP2TraceWriteResult> {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await this.validateTraceWriteAuthorities(
          tx,
          input.write,
          input.expectedPolicyAuthority,
          input.expectedSourceSessionAuthority,
          input.writeAt,
          input.expectedJobStatuses,
        ))
      )
        return { outcome: 'cas_lost', trace: null };
      const semantic = await tx.decisionTraceMemorySemantic.findUnique({
        where: { traceId: input.write.parent.traceId },
      });
      const parent = await tx.decisionTrace.findUnique({
        where: { id: input.write.parent.traceId },
      });
      if (
        parent !== null &&
        parent.status === input.write.parent.status &&
        semantic?.commitDigest === input.write.semantic.commitDigest
      )
        return { outcome: 'replayed', trace: input.write };
      if (
        parent !== null &&
        !input.expectedTraceStatuses.includes(parent.status as MemoryP2TraceStatus)
      )
        return { outcome: 'cas_lost', trace: null };
      if (parent === null && !input.expectedTraceStatuses.includes('missing'))
        return { outcome: 'cas_lost', trace: null };
      if (parent === null) {
        await tx.decisionTrace.create({ data: traceParentRow(input.write.parent) });
        await tx.decisionTraceMemorySemantic.create({
          data: traceSemanticRow(input.write.semantic),
        });
      } else {
        await tx.decisionTrace.update({
          data: traceParentRowUpdate(input.write.parent),
          where: { id: parent.id },
        });
        await tx.decisionTraceMemorySemantic.update({
          data: traceSemanticRowUpdate(input.write.semantic),
          where: { traceId: parent.id },
        });
      }
      return { outcome: 'updated', trace: input.write };
    });
  }

  public async listPendingLongWakeCandidates(
    limit = 100,
  ): Promise<readonly MemoryP2LongWakeCandidate[]> {
    return this.reader.listPendingLongWakeCandidates(limit);
  }

  public async scanCandidateJobIds(input: {
    limit: number;
    staleAtOrBefore: Date;
  }): Promise<readonly string[]> {
    return this.repository.scanCandidateJobIds(input);
  }

  public async readRecoveryAuthority(jobId: string): Promise<MemoryP2RecoveryAuthority | null> {
    return this.repository.readRecoveryAuthority(jobId);
    /* legacy adapter-local reader retained below only as a patch anchor; repository is canonical.
    const [job, projection, semantic, checkpoint] = await Promise.all([
      this.prisma.aiJob.findUnique({ where: { id: jobId } }),
      this.prisma.memoryP2JobProjection.findUnique({ where: { aiJobId: jobId } }),
      this.prisma.decisionTraceMemorySemantic.findUnique({ where: { aiJobId: jobId } }),
      this.prisma.memoryEvolutionCheckpoint.findFirst({ where: { p2ProducerJobId: jobId } }),
    ]);
    if (job === null || projection === null || semantic === null) return null;
    const parent = await this.prisma.decisionTrace.findUnique({ where: { id: semantic.traceId } });
    if (parent === null) return null;
    const rows = await this.prisma.decisionTraceMemorySourceReference.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { traceId: semantic.traceId },
    });
    const references = rows.map(referenceFromRow);
    const sourceSessionIds = checkpoint === null ? [job.projectId] : [checkpoint.sourceSessionId];
    const sourceSessionId = sourceSessionIds[0];
    if (sourceSessionId === undefined) return null;
    const referenceAuthorities: MemoryP2TraceReferenceAuthority[] = references.map((reference) => ({
      deletionScopeDigest: reference.deletionScopeDigest,
      membershipDigest: reference.membershipDigest,
      projectId: job.projectId,
      readability: 'active',
      sessionId: sourceSessionId,
      sourceKind: reference.sourceKind,
      sourceRevision: reference.sourceRevision,
      targetId: referenceTarget(reference),
    }));
    const identity = {
      aiJobId: job.id,
      createdAt: job.createdAt,
      deletionScopeDigest: projection.deletionScopeDigest,
      expiresAt: job.expiresAt,
      generationId: parent.generationId,
      inputHash: job.inputHash,
      ownerActorId: job.requestedBy,
      projectId: job.projectId,
      requestId: job.requestId,
      sessionId: parent.sessionId,
      sourceManifestHash: semantic.sourceManifestHash,
      startedAt: parent.startedAt,
      traceId: parent.id,
    };
    const trace = {
      commitDigest: semantic.commitDigest,
      deletionScopeDigest: semantic.deletionScopeDigest,
      errorCode: isErrorCode(parent.errorCode) ? parent.errorCode : null,
      expiresAt: job.expiresAt,
      memoryOutcome: parent.memoryOutcome as never,
      p2PolicyRevision: projection.p2PolicyRevision,
      p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
      planDigest: semantic.planDigest,
      proposalDigest: semantic.proposalDigest,
      references,
      retentionState: job.retentionState as never,
      sourceManifestHash: semantic.sourceManifestHash,
      stage: parent.stage as never,
      status: parent.status as never,
      traceId: parent.id,
    };
    return {
      attemptNo: job.attemptNo,
      checkpoint:
        checkpoint === null
          ? null
          : {
              checkpointId: checkpoint.id,
              deletionScopeDigest: checkpoint.deletionScopeDigest,
              p2PolicyRevision: projection.p2PolicyRevision,
              p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
              projectId: checkpoint.projectId,
              sessionId: checkpoint.sourceSessionId,
              sourceManifestHash: checkpoint.memberManifestHash,
              status: checkpoint.lifecycleStatus as 'committed',
            },
      committed: null,
      identity,
      jobFailureCode: isErrorCode(job.failureCode) ? job.failureCode : null,
      jobMemoryOutcome: parent.memoryOutcome as never,
      jobRevision: 0,
      jobStatus: job.status,
      leaseEpoch: projection.recoveryLeaseEpoch,
      leaseExpiresAt: projection.recoveryLeaseExpiresAt,
      leaseOwnerId: projection.recoveryLeaseOwner,
      legacyNullResolutionCount: 0,
      migrationStatus: 'completed',
      p2PolicyRevision: projection.p2PolicyRevision,
      p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
      referenceAuthorities,
      references,
      retentionState: job.retentionState as never,
      sourceSessionIds,
      sourceSessionManifestHash: semanticCanonicalDigest(
        'memory-p2-session-scope-v1',
        sourceSessionIds,
      ),
      targetLayer: projection.jobKind === 'long_session_end' ? 'long' : 'mid',
      trace,
    };
  */
  }

  public async applyRecovery(command: MemoryP2RecoveryCommand): Promise<MemoryP2RecoveryCasResult> {
    return this.repository.applyRecovery(command);
    /* legacy adapter-local mutation retained below only as a patch anchor; repository is canonical.
    return this.prisma.$transaction(async (tx) => {
      const [job, projection, semantic] = await Promise.all([
        tx.aiJob.findUnique({ where: { id: command.jobId } }),
        tx.memoryP2JobProjection.findUnique({ where: { aiJobId: command.jobId } }),
        tx.decisionTraceMemorySemantic.findUnique({ where: { aiJobId: command.jobId } }),
      ]);
      if (
        job === null ||
        projection === null ||
        semantic === null ||
        job.attemptNo !== command.expectedAttemptNo ||
        !command.expectedJobStatuses.includes(job.status) ||
        projection.recoveryLeaseEpoch !== command.expectedLeaseEpoch ||
        projection.recoveryLeaseOwner !== command.expectedLeaseOwnerId
      )
        return { outcome: 'cas_lost' };
      if (command.kind === 'terminalize_uncommitted')
        await tx.aiJob.update({
          data: {
            completedAt: command.writeAt,
            failureCode: command.errorCode,
            status: command.terminalStatus,
          },
          where: { id: command.jobId },
        });
      await tx.decisionTrace.update({
        data: {
          completedAt: command.trace.parent.completedAt,
          decisionOutcome: command.trace.parent.decisionOutcome,
          durationMs: command.trace.parent.durationMs,
          errorCode: command.trace.parent.errorCode,
          memoryOutcome: command.trace.parent.memoryOutcome,
          stage: command.trace.parent.stage,
          status: command.trace.parent.status,
        },
        where: { id: semantic.traceId },
      });
      await tx.decisionTraceMemorySemantic.update({
        data: {
          commitDigest: command.trace.semantic.commitDigest,
          planDigest: command.trace.semantic.planDigest,
          proposalDigest: command.trace.semantic.proposalDigest,
        },
        where: { traceId: semantic.traceId },
      });
      return { outcome: 'applied' };
    });
  */
  }

  public async buildLongWakeTrigger(
    candidate: Awaited<
      ReturnType<MemoryP2PersistenceReader['listPendingLongWakeCandidates']>
    >[number],
  ): Promise<MemoryP2Trigger> {
    const checkpoint = await this.prisma.memoryEvolutionCheckpoint.findUnique({
      where: { id: candidate.sourceFinalMidCheckpointId },
    });
    if (checkpoint === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    return this.longTriggerRequest(candidate, checkpoint.rootIdentity);
  }

  private async runningTraceInput(jobId: string): Promise<{
    identity: MemoryP2TraceIdentity;
    policy: MemoryP2TracePolicyAuthority;
    references: readonly MemoryP2TraceReference[];
    sourceSession: MemoryP2TraceSourceSessionAuthority;
    trace: { planDigest: string | null; proposalDigest: string | null };
  } | null> {
    const [job, projection, semantic] = await Promise.all([
      this.prisma.aiJob.findUnique({ where: { id: jobId } }),
      this.prisma.memoryP2JobProjection.findUnique({ where: { aiJobId: jobId } }),
      this.prisma.decisionTraceMemorySemantic.findUnique({ where: { aiJobId: jobId } }),
    ]);
    if (job === null || projection === null || semantic === null) return null;
    const parent = await this.prisma.decisionTrace.findUnique({ where: { id: semantic.traceId } });
    if (parent === null || parent.status !== 'running') return null;
    const rows = await this.prisma.decisionTraceMemorySourceReference.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { traceId: semantic.traceId },
    });
    const sourceSession = await this.readSourceSessionAuthority(jobId);
    if (sourceSession === null) return null;
    const policy = await this.readPolicyAuthority(jobId, this.clock.now());
    if (policy === null) return null;
    return {
      identity: {
        aiJobId: job.id,
        createdAt: job.createdAt,
        deletionScopeDigest: projection.deletionScopeDigest,
        expiresAt: job.expiresAt,
        generationId: parent.generationId,
        inputHash: job.inputHash,
        ownerActorId: job.requestedBy,
        projectId: job.projectId,
        requestId: job.requestId,
        sessionId: parent.sessionId,
        sourceManifestHash: semantic.sourceManifestHash,
        startedAt: parent.startedAt,
        traceId: parent.id,
      },
      policy,
      references: rows.map(referenceFromRow),
      sourceSession,
      trace: { planDigest: semantic.planDigest, proposalDigest: semantic.proposalDigest },
    };
  }

  private async readReferenceAuthority(
    reference: MemoryP2TraceReference,
    db: Tx | PrismaService = this.prisma,
  ): Promise<MemoryP2TraceReferenceAuthority | null> {
    const targetId = referenceTarget(reference);
    const base = {
      deletionScopeDigest: reference.deletionScopeDigest,
      membershipDigest: reference.membershipDigest,
      sourceKind: reference.sourceKind,
      sourceRevision: reference.sourceRevision,
      targetId,
    } as const;
    if (reference.sourceKind === 'checkpoint') {
      const row = await db.memoryEvolutionCheckpoint.findUnique({
        where: { id: targetId },
      });
      return row === null
        ? null
        : {
            ...base,
            membershipDigest: row.memberManifestHash,
            projectId: row.projectId,
            readability: lifecycleReadability(row.lifecycleStatus),
            sessionId: row.sourceSessionId,
            sourceRevision: 1,
          };
    }
    if (reference.sourceKind === 'job') {
      const row = await db.aiJob.findUnique({ where: { id: targetId } });
      return row === null
        ? null
        : {
            ...base,
            membershipDigest: row.inputHash,
            projectId: row.projectId,
            readability:
              row.retentionState === 'active' && row.expiresAt > this.clock.now()
                ? 'active'
                : 'expired',
            sessionId: await this.jobSessionId(row.id, db),
            sourceRevision: 1,
          };
    }
    if (reference.sourceKind === 'input_segment') {
      const row = await db.aiJobInputSegment.findUnique({ where: { id: targetId } });
      if (row === null) return null;
      const job = await db.aiJob.findUnique({ where: { id: row.aiJobId } });
      return job === null
        ? null
        : {
            ...base,
            membershipDigest: row.effectiveTextDigest,
            projectId: job.projectId,
            readability:
              job.retentionState === 'active' && job.expiresAt > this.clock.now()
                ? 'active'
                : 'expired',
            sessionId: row.sessionId,
            sourceRevision: row.textRevision,
          };
    }
    if (reference.sourceKind === 'evidence') {
      const row = await db.memoryEvidenceAuthority.findUnique({
        where: { evidenceId: targetId },
      });
      return row === null
        ? null
        : {
            ...base,
            membershipDigest: row.membershipDigest,
            projectId: row.projectId,
            readability: 'active',
            sessionId: row.sessionId,
            sourceRevision: row.authorityRevision,
          };
    }
    const row = await db.memoryResolutionAuthority.findUnique({
      where: { authorityId: targetId },
    });
    if (row === null) return null;
    const member = await db.memoryEvolutionCheckpointMember.findFirst({
      orderBy: { inputOrder: 'asc' },
      where: { resolutionAuthorityId: row.authorityId },
    });
    return {
      ...base,
      membershipDigest: member?.membershipDigest ?? reference.membershipDigest,
      projectId: row.projectId,
      readability: 'active',
      sessionId: row.originSessionId,
    };
  }

  private async jobSessionId(jobId: string, db: Tx | PrismaService = this.prisma): Promise<string> {
    const row = await db.aiJobSessionScope.findFirst({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: jobId },
    });
    if (row === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    return row.sessionId;
  }

  private async sourceSpec(trigger: MemoryP2Trigger): Promise<SourceSpec> {
    if (trigger.jobKind !== 'long_session_end') {
      const snapshot = await this.prisma.memoryWorkingSnapshot.findUnique({
        where: { id: trigger.sourceSnapshotId },
      });
      if (
        snapshot === null ||
        snapshot.projectId !== trigger.projectId ||
        snapshot.sourceSessionId !== trigger.sessionId
      )
        throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
      const rows = await this.prisma.memoryWorkingSnapshotResolution.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { snapshotId: snapshot.id },
      });
      return {
        checkpointId: null,
        resolutionIds: rows.map((row) => row.memoryResolutionId),
        snapshotId: snapshot.id,
        long: false,
      };
    }
    const checkpoint = await this.prisma.memoryEvolutionCheckpoint.findUnique({
      where: { id: trigger.sourceSnapshotId },
    });
    if (
      checkpoint === null ||
      checkpoint.lifecycleStatus !== 'committed' ||
      checkpoint.projectId !== trigger.projectId
    )
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const mid = await this.prisma.memoryEvolutionCheckpointMember.findMany({
      where: { checkpointId: checkpoint.id },
      orderBy: { inputOrder: 'asc' },
    });
    const midProjection = await this.prisma.memoryP2JobProjection.findFirst({
      where: { jobKind: 'mid_final', sourceCheckpointId: checkpoint.id },
    });
    const midRevision =
      midProjection?.targetLayerRevisionId === null ||
      midProjection?.targetLayerRevisionId === undefined
        ? null
        : await this.prisma.memoryLayerRevision.findUnique({
            where: { id: midProjection.targetLayerRevisionId },
          });
    const snapshot = await this.prisma.memoryWorkingSnapshot.findFirst({
      orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
      where: {
        projectId: trigger.projectId,
        sourceSessionId: trigger.sessionId,
        contractVersion: 'memory-maintainer-v1.2',
      },
    });
    return {
      checkpointId: checkpoint.id,
      resolutionIds: [
        ...new Set([
          ...(midRevision === null
            ? mid.map((row) => row.resolutionRowId)
            : [midRevision.resolutionRowId]),
        ]),
      ],
      snapshotId: snapshot?.id ?? null,
      long: true,
    };
  }

  private async freezeRequest(
    trigger: MemoryP2Trigger,
    source: SourceSpec,
  ): Promise<FreezeAiJobRequest> {
    if (source.snapshotId === null && !source.long)
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    if (source.checkpointId === null && source.snapshotId === null)
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const snapshotId = source.snapshotId ?? '';
    const sourceJobId =
      source.checkpointId === null
        ? (
            await this.prisma.memoryWorkingSnapshot.findUniqueOrThrow({
              where: { id: snapshotId },
            })
          ).aiJobId
        : (
            await this.prisma.memoryEvolutionCheckpoint.findUniqueOrThrow({
              where: { id: source.checkpointId },
            })
          ).p2ProducerJobId;
    const sourceJob = await this.prisma.aiJob.findUnique({ where: { id: sourceJobId } });
    if (sourceJob === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const request: FreezeAiJobRequest = {
      actorId: sourceJob.requestedBy,
      contextBuilderVersion: 'memory-p2-v1',
      expiresAt: sourceJob.expiresAt,
      jobType: trigger.jobKind,
      memoryResolutionIds: source.resolutionIds,
      projectId: trigger.projectId,
      requestId: deterministicUuid(`request:${trigger.requestIdentity}`),
      sessionIds: [trigger.sessionId],
      trustedRole: 'elder',
      trustedRoles: ['elder'],
      triggerDedupeKey: `memory-p2-v1:${trigger.triggerIdentity}`,
    };
    if (trigger.retryOf !== undefined) request.retryOfJobId = trigger.retryOf.jobId;
    if (!source.long && source.snapshotId !== null)
      request.sourceContextSnapshotId = source.snapshotId;
    return request;
  }

  private async material(
    tx: Tx,
    trigger: MemoryP2Trigger,
    job: FrozenAiJob,
    source: SourceSpec,
    verifyManifest = true,
  ): Promise<Material> {
    const durableJob = await tx.aiJob.findUnique({ where: { id: job.id } });
    if (durableJob === null) throw new MemoryP2RuntimeError('P2_TARGET_DRIFT');
    const snapshot =
      source.snapshotId === null
        ? null
        : await tx.memoryWorkingSnapshot.findUnique({ where: { id: source.snapshotId } });
    const checkpoint =
      source.checkpointId === null
        ? null
        : await tx.memoryEvolutionCheckpoint.findUnique({ where: { id: source.checkpointId } });
    if (snapshot === null && checkpoint === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const snapshotRows =
      snapshot === null
        ? []
        : await tx.memoryWorkingSnapshotResolution.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { snapshotId: snapshot.id },
          });
    const checkpointRows =
      checkpoint === null
        ? []
        : await tx.memoryEvolutionCheckpointMember.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { checkpointId: checkpoint.id },
          });
    const checkpointProjection =
      source.long && checkpoint !== null
        ? await tx.memoryP2JobProjection.findFirst({
            where: { jobKind: 'mid_final', sourceCheckpointId: checkpoint.id },
          })
        : null;
    const checkpointRevision =
      checkpointProjection?.targetLayerRevisionId === null ||
      checkpointProjection?.targetLayerRevisionId === undefined
        ? null
        : await tx.memoryLayerRevision.findUnique({
            where: { id: checkpointProjection.targetLayerRevisionId },
          });
    const selected = source.long
      ? [
          ...(checkpointRevision === null
            ? checkpointRows.map((row) => ({
                id: row.resolutionRowId,
                order: row.inputOrder,
                kind: 'mid_resolution' as const,
              }))
            : [
                {
                  id: checkpointRevision.resolutionRowId,
                  order: 0,
                  kind: 'mid_resolution' as const,
                },
              ]),
        ]
      : snapshotRows.map((row) => ({
          id: row.memoryResolutionId,
          order: row.inputOrder,
          kind: 'working_resolution' as const,
        }));
    const resolutions = await tx.memoryResolution.findMany({
      where: { id: { in: selected.map((row) => row.id) } },
    });
    const byResolution = new Map(resolutions.map((row) => [row.id, row]));
    const resolutionMembers = await tx.memoryResolutionMember.findMany({
      orderBy: { memberOrder: 'asc' },
      where: { memoryResolutionId: { in: selected.map((row) => row.id) } },
    });
    const claims = await tx.memoryClaim.findMany({
      where: { id: { in: resolutionMembers.map((row) => row.memoryClaimId) } },
    });
    const byClaim = new Map(claims.map((row) => [row.id, row]));
    const evidence = await tx.memoryClaimEvidence.findMany({
      orderBy: { evidenceOrder: 'asc' },
      where: { memoryClaimId: { in: claims.map((row) => row.id) } },
    });
    const byClaimEvidence = new Map<string, typeof evidence>();
    for (const row of evidence)
      byClaimEvidence.set(row.memoryClaimId, [
        ...(byClaimEvidence.get(row.memoryClaimId) ?? []),
        row,
      ]);
    const frozenSegments = await tx.aiJobInputSegment.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: job.id },
    });
    const byTranscript = new Map(frozenSegments.map((row) => [row.transcriptSegmentId, row]));
    const evidenceMembership: Record<string, unknown>[] = [];
    const evidenceSeen = new Set<string>();
    const sourceMembers: MemoryP2SourceMember[] = [];
    const members: MemoryP2CheckpointMemberInput[] = [];
    for (const item of selected) {
      const resolution = byResolution.get(item.id);
      if (
        resolution === undefined ||
        resolution.projectId !== trigger.projectId ||
        resolution.authorityId === null ||
        resolution.semanticKind === null ||
        resolution.semanticStatus === null ||
        !['automatic', 'human_confirmed'].includes(resolution.authority)
      )
        throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
      const claimRows = resolutionMembers.filter((row) => row.memoryResolutionId === resolution.id);
      const semanticClaims: MemoryP2SemanticClaim[] = [];
      for (const member of claimRows) {
        const claim = byClaim.get(member.memoryClaimId);
        if (claim === undefined) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
        const refs: string[] = [];
        for (const link of byClaimEvidence.get(claim.id) ?? []) {
          const segment = byTranscript.get(link.transcriptSegmentId);
          if (segment === undefined) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
          const ref = `evidence:${link.transcriptSegmentId}`;
          refs.push(ref);
          if (!evidenceSeen.has(ref)) {
            evidenceSeen.add(ref);
            evidenceMembership.push({
              content_kind: segment.contentKind,
              effective_text_digest: segment.effectiveTextDigest,
              evidence_ref_id: ref,
              input_order: evidenceMembership.length,
              segment_id: segment.transcriptSegmentId,
              session_id: segment.sessionId,
              speaker_role_revision: segment.speakerRoleRevision,
              text_revision: segment.textRevision,
              trusted_role: segment.trustedEffectiveRole,
            });
          }
        }
        semanticClaims.push({
          claim_key: claim.canonicalKey,
          evidence_ref_ids: refs,
          source_claim_ref_id: `claim:${claim.id}`,
          value: claim.valueJson,
          value_kind: claim.valueKind,
        });
      }
      const resolutionKind =
        resolution.resolutionKind === 'review_required' ? 'unknown' : resolution.resolutionKind;
      const state = {
        canonical_key: resolution.canonicalKey,
        claims: semanticClaims,
        memory_tag: resolution.memoryType,
        resolution_kind: resolutionKind,
        semantic_kind: resolution.semanticKind,
        semantic_status: resolution.semanticStatus,
        value: resolution.resolvedValueJson,
        value_kind:
          resolutionKind === 'single' ? 'exact' : resolutionKind === 'range' ? 'range' : 'unknown',
      } as const;
      const sourceRefId = `src:${item.kind}:${resolution.authorityId}`;
      sourceMembers.push({
        authority: resolution.authority === 'human_confirmed' ? 'human_confirmed' : 'automatic',
        content_digest: semanticContentDigest(state),
        input_order: item.order,
        project_id: resolution.projectId,
        resolution_id: resolution.id,
        resolution_revision: resolution.resolutionRevision,
        semantic_state: state,
        session_id: resolution.sourceSessionId ?? trigger.sessionId,
        source_kind: item.kind,
        source_ref_id: sourceRefId,
      });
      members.push({
        boundaryStatus: 'active',
        claimCount: claimRows.length,
        inputOrder: item.order,
        membershipDigest: semanticContentDigest(state),
        resolutionAuthorityId: resolution.authorityId,
        resolutionRevision: resolution.resolutionRevision,
        resolutionRowId: resolution.id,
        semanticStatus: resolution.semanticStatus,
      });
    }
    const sourceSessions = [...new Set(sourceMembers.map((member) => member.session_id))];
    const evidenceManifestHash = semanticEvidenceManifestHash(evidenceMembership);
    const sourceManifestHash = semanticSourceManifestHash(sourceMembers, evidenceMembership);
    if (verifyManifest && sourceManifestHash !== trigger.sourceManifestHash)
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const threadMember =
      snapshot === null
        ? null
        : await tx.memoryWorkingSnapshotThread.findFirst({
            orderBy: { inputOrder: 'asc' },
            where: { snapshotId: snapshot.id },
          });
    const thread =
      threadMember === null
        ? null
        : await tx.memoryThreadRevision.findUnique({
            where: { id: threadMember.threadRevisionId },
          });
    const threadId = checkpoint?.sourceThreadId ?? threadMember?.threadId;
    const threadRevisionId = checkpoint?.sourceThreadRevisionId ?? threadMember?.threadRevisionId;
    const threadRevision = checkpoint?.sourceThreadRevision ?? threadMember?.revision;
    const threadStatus = checkpoint?.sourceThreadStatus ?? thread?.status;
    const threadManifestHash = snapshot?.threadManifestHash ?? checkpoint?.sourceThreadManifestHash;
    const boundaryManifestHash =
      snapshot?.boundaryManifestHash ?? checkpoint?.sourceBoundaryManifestHash;
    const resolutionManifestHash =
      snapshot?.resolutionManifestHash ?? checkpoint?.sourceResolutionManifestHash;
    if (
      threadId === undefined ||
      threadRevisionId === undefined ||
      threadRevision === undefined ||
      threadStatus === undefined ||
      threadManifestHash === undefined ||
      boundaryManifestHash === undefined ||
      resolutionManifestHash === undefined
    )
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const context: MemoryP2SemanticContext = {
      context_schema_version: 'memory-semantic-context-v1',
      evidence_manifest_hash: evidenceManifestHash,
      evidence_membership: evidenceMembership,
      limits: {
        max_claims: 16,
        max_evidence_refs: 32,
        max_json_depth: 12,
        max_semantic_characters: 10000,
        max_source_members: 8,
        policy_version: 'semantic-safety-v1',
      },
      mode: source.long ? 'session_end_to_long' : 'working_to_mid',
      policy: {
        deletion_scope_digest: trigger.policy.deletionScopeDigest,
        deletion_scope_status: 'active',
        policy_revision: trigger.policy.p2PolicyRevision,
        retention_policy_version: trigger.policy.p2RetentionPolicyVersion,
        retention_status: 'active',
      },
      project_id: trigger.projectId,
      source_checkpoint: {
        checkpoint_id: checkpoint?.id ?? trigger.sourceSnapshotId,
        root_identity: checkpoint?.rootIdentity ?? trigger.sourceCheckpointRootIdentity,
        project_id: trigger.projectId,
        source_session_ids: sourceSessions,
        expected_member_count: sourceMembers.length,
        member_manifest_hash: sourceManifestHash,
        evidence_manifest_hash: evidenceManifestHash,
        source_set: {
          kind: source.long ? 'final_mid_and_current' : 'working_checkpoint',
          mid_expected_count: sourceMembers.filter(
            (member) => member.source_kind === 'mid_resolution',
          ).length,
          mid_manifest_hash: source.long
            ? semanticSourceKindManifestHash('mid_resolution', sourceMembers)
            : null,
          current_expected_count: sourceMembers.filter(
            (member) => member.source_kind === 'current_resolution',
          ).length,
          current_manifest_hash: source.long
            ? semanticSourceKindManifestHash('current_resolution', sourceMembers)
            : null,
        },
        terminal_status: 'succeeded',
      },
      source_manifest_hash: sourceManifestHash,
      source_members: sourceMembers,
      source_session_id: trigger.sessionId,
      source_session_ids: sourceSessions,
    };
    const refs = traceRefs(
      job,
      frozenSegments,
      sourceMembers,
      checkpoint === null
        ? null
        : { id: checkpoint.id, memberManifestHash: checkpoint.memberManifestHash },
      trigger.policy.deletionScopeDigest,
    );
    const longSources = checkpoint === null ? [] : await this.longSources(tx, checkpoint);
    return {
      context,
      expiresAt: durableJob.expiresAt,
      members,
      refs,
      threadId,
      threadRevisionId,
      threadRevision,
      threadStatus,
      threadManifestHash,
      boundaryManifestHash,
      resolutionManifestHash,
      snapshotId: snapshot?.id ?? checkpoint?.sourceWorkingSnapshotId ?? trigger.sourceSnapshotId,
      checkpointRoot: checkpoint?.rootIdentity ?? trigger.sourceCheckpointRootIdentity,
      longSources,
    };
  }

  private midFreeze(
    trigger: MemoryP2Trigger,
    job: FrozenAiJob,
    material: Material,
    lease: MemoryP2LeaseToken,
    traceId: string,
    checkpointId: string,
  ): MemoryP2FreezeCheckpointInput {
    const memberManifestHash = memoryP2CheckpointManifestHash(material.members);
    return {
      aiJobId: job.id,
      aiPolicyRevision: trigger.policy.aiPolicyRevision,
      checkpointId,
      deletionScopeDigest: trigger.policy.deletionScopeDigest,
      deletionScopePolicyRevision: trigger.policy.aiPolicyRevision,
      evidenceManifestHash: material.context.evidence_manifest_hash,
      lease,
      expectedMemberCount: material.members.length,
      expiresAt: material.expiresAt,
      memberManifestHash,
      members: material.members,
      midExpectedCount: 0,
      midManifestHash: null,
      ownerActorId: job.requestedBy,
      p2PolicyContractRevision: P2_CONTRACT,
      p2PolicyRevision: trigger.policy.p2PolicyRevision,
      p2RetentionContractVersion: P2_RETENTION_CONTRACT,
      p2RetentionPolicyVersion: trigger.policy.p2RetentionPolicyVersion,
      projectId: trigger.projectId,
      retentionPolicyVersion: trigger.policy.retentionPolicyVersion,
      rootIdentity: trigger.sourceCheckpointRootIdentity,
      sourceBoundaryManifestHash: material.boundaryManifestHash,
      sourceCurrentExpectedCount:
        trigger.kind === 'session_final_flush' ? material.members.length : 0,
      sourceCurrentManifestHash:
        trigger.kind === 'session_final_flush' ? material.resolutionManifestHash : null,
      sourceP1TerminalJobId: trigger.p1TerminalJobId,
      sourceP1TerminalOutcome: trigger.p1TerminalJobId === null ? null : 'succeeded',
      sourceP1TerminalStatus: trigger.p1TerminalJobId === null ? null : 'succeeded',
      sourceResolutionManifestHash: material.resolutionManifestHash,
      sourceRevisionDigest: memberManifestHash,
      sourceSessionId: trigger.sessionId,
      sourceSetKind:
        trigger.kind === 'session_final_flush' ? 'final_mid_and_current' : 'working_checkpoint',
      sourceThreadId: material.threadId,
      sourceThreadManifestHash: material.threadManifestHash,
      sourceThreadRevision: material.threadRevision,
      sourceThreadRevisionId: material.threadRevisionId,
      sourceThreadStatus: material.threadStatus,
      sourceTraceReferences: material.refs,
      sourceWorkingSnapshotContractVersion: 'memory-maintainer-v1.2',
      sourceWorkingSnapshotId: material.snapshotId,
      targetSlotDigest: trigger.targetLayerRootIdentity,
      traceGenerationId: deterministicUuid(`generation:${trigger.requestIdentity}`),
      traceId,
      traceRequestId: deterministicUuid(`request:${trigger.requestIdentity}`),
      triggerIdentity: trigger.triggerIdentity,
      triggerIdentityHash: trigger.triggerIdentity,
      triggerKind: trigger.kind as 'semantic_park' | 'capacity_checkpoint' | 'session_final_flush',
    };
  }

  private longFreeze(
    trigger: MemoryP2Trigger,
    job: FrozenAiJob,
    material: Material,
    lease: MemoryP2LeaseToken,
    traceId: string,
  ): MemoryP2FreezeLongJobInput {
    if (
      trigger.p1TerminalJobId === null ||
      material.context.source_checkpoint.checkpoint_id === null
    )
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    return {
      aiJobId: job.id,
      deletionScopeDigest: trigger.policy.deletionScopeDigest,
      deletionScopePolicyRevision: trigger.policy.aiPolicyRevision,
      expiresAt: material.expiresAt,
      lease,
      ownerActorId: job.requestedBy,
      p2PolicyContractRevision: P2_CONTRACT,
      p2PolicyRevision: trigger.policy.p2PolicyRevision,
      p2RetentionContractVersion: P2_RETENTION_CONTRACT,
      p2RetentionPolicyVersion: trigger.policy.p2RetentionPolicyVersion,
      projectId: trigger.projectId,
      sourceFinalMidCheckpointId: material.context.source_checkpoint.checkpoint_id as string,
      sourceP1TerminalJobId: trigger.p1TerminalJobId,
      sourceRevisionDigest: trigger.sourceManifestHash,
      sourceSessionId: trigger.sessionId,
      sourceTraceReferences: material.refs,
      targetSlotDigest: trigger.targetLayerRootIdentity,
      traceGenerationId: deterministicUuid(`generation:${trigger.requestIdentity}`),
      traceId,
      traceRequestId: deterministicUuid(`request:${trigger.requestIdentity}`),
      triggerIdentityHash: trigger.triggerIdentity,
    };
  }

  private async longSources(
    tx: Tx,
    checkpoint: { id: string },
  ): Promise<readonly MemoryP2LongSourceInput[]> {
    const projection = await tx.memoryP2JobProjection.findFirst({
      where: { sourceCheckpointId: checkpoint.id, jobKind: 'mid_final' },
    });
    if (
      projection?.targetLayerRevisionId === null ||
      projection?.targetLayerRevisionId === undefined
    )
      throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const source = await tx.memoryEvolutionCheckpoint.findUniqueOrThrow({
      where: { id: checkpoint.id },
    });
    return [
      {
        inputOrder: 0,
        membershipDigest: projection.targetRevisionDigest ?? '',
        sourceMidRevisionId: projection.targetLayerRevisionId,
        sourceSessionId: source.sourceSessionId,
      },
    ];
  }

  private async commitInput(
    request: MemoryP2CommitRequest,
  ): Promise<readonly MemoryP2CommitInput[] | null> {
    if (request.proposal.proposals.length < 1 || request.proposal.proposals.length > 40)
      return null;
    const inputs: MemoryP2CommitInput[] = [];
    for (const proposal of request.proposal.proposals) {
      const input = await this.commitInputForProposal({
        ...request,
        proposal: { ...request.proposal, proposals: [proposal] },
      });
      if (input === null) return null;
      inputs.push(input);
    }
    return inputs;
  }

  private async commitInputForProposal(
    request: MemoryP2CommitRequest,
  ): Promise<MemoryP2CommitInput | null> {
    const sourceCheckpointId = request.attempt.context.source_checkpoint.checkpoint_id;
    const checkpointPromise =
      request.attempt.context.mode === 'session_end_to_long'
        ? this.prisma.memoryEvolutionCheckpoint.findUnique({
            where: { id: typeof sourceCheckpointId === 'string' ? sourceCheckpointId : '' },
          })
        : this.prisma.memoryEvolutionCheckpoint.findFirst({
            where: { p2ProducerJobId: request.attempt.jobId },
          });
    const [projection, checkpoint, trace, job] = await Promise.all([
      this.prisma.memoryP2JobProjection.findUnique({ where: { aiJobId: request.attempt.jobId } }),
      checkpointPromise,
      this.prisma.decisionTraceMemorySemantic.findUnique({
        where: { aiJobId: request.attempt.jobId },
      }),
      this.prisma.aiJob.findUnique({ where: { id: request.attempt.jobId } }),
    ]);
    const entry = request.proposal.proposals[0];
    if (
      projection === null ||
      checkpoint === null ||
      trace === null ||
      job === null ||
      entry === undefined ||
      request.proposal.proposals.length !== 1
    ) {
      return null;
    }
    const targetState = entry.proposed_state;
    const sourceMember =
      request.attempt.context.source_members.find(
        (member) => member.source_ref_id === entry.target.existing_source_ref_id,
      ) ??
      request.attempt.context.source_members.find(
        (member) => member.source_ref_id === entry.source_member_ref_ids[0],
      );
    if (sourceMember === undefined) {
      return null;
    }
    const segmentRows = await this.prisma.aiJobInputSegment.findMany({
      where: { aiJobId: job.id },
    });
    const segments = new Map(segmentRows.map((row) => [row.transcriptSegmentId, row]));
    const evidenceByRef = new Map(
      request.attempt.context.evidence_membership.map((row) => [String(row.evidence_ref_id), row]),
    );
    const claims: MemoryP2ClaimInput[] = [];
    for (const claim of targetState.claims) {
      const evidences: MemoryP2EvidenceInput[] = [];
      for (const ref of claim.evidence_ref_ids) {
        const evidence = evidenceByRef.get(ref);
        if (evidence === undefined) {
          return null;
        }
        const segment = segments.get(String(evidence.segment_id));
        if (segment === undefined) {
          return null;
        }
        const membershipDigest = semanticCanonicalDigest(
          'memory-p2-evidence-membership-v1',
          evidence,
        );
        evidences.push({
          authorityRevision: 1,
          effectiveTextDigest: segment.effectiveTextDigest,
          expectedEvidenceId:
            ref.slice('evidence:'.length) === String(evidence.segment_id)
              ? null
              : ref.slice('evidence:'.length),
          inputOrder: segment.inputOrder,
          inputSegmentId: segment.id,
          membershipDigest,
          sourceId: segment.transcriptSegmentId,
          speakerRoleRevision: segment.speakerRoleRevision,
          textRevision: segment.textRevision,
        });
      }
      claims.push({
        canonicalKey: targetState.canonical_key,
        evidences,
        explicitCorrection: false,
        memoryType: targetState.memory_tag,
        normalizedValueDigest: semanticContentDigest(claim.value),
        role: 'primary',
        semanticKind: targetState.semantic_kind,
        valueJson: claim.value as Prisma.InputJsonValue,
        valueKind: claim.value_kind,
      });
    }
    const targetRevision =
      entry.target.existing_source_ref_id === null ? null : sourceMember.resolution_revision;
    const existingResolutionId =
      entry.target.existing_source_ref_id === null ? null : sourceMember.resolution_id;
    const existingAuthorityId =
      entry.target.existing_source_ref_id === null
        ? null
        : sourceMember.source_ref_id.slice(sourceMember.source_ref_id.lastIndexOf(':') + 1);
    const targetLayer = request.attempt.context.mode === 'session_end_to_long' ? 'long' : 'mid';
    const identityLayer = targetLayer === 'long' ? 'mid' : targetLayer;
    const existingIdentity =
      entry.target.existing_source_ref_id === null
        ? null
        : await this.prisma.memoryLayerIdentity.findUnique({
            where: {
              identityKeyDigest: semanticCanonicalDigest('memory-p2-layer-identity-v1', [
                job.projectId,
                targetState.canonical_key,
                targetState.semantic_kind,
                identityLayer,
              ]),
            },
          });
    const longSources =
      targetLayer === 'long' ? await this.longSources(this.prisma, { id: checkpoint.id }) : [];
    const longSourceMidManifestHash =
      targetLayer === 'long' ? memoryP2LongSourceManifestHash(longSources) : null;
    return {
      aiJobId: job.id,
      checkpointId: checkpoint.id,
      claims,
      commitDigest: semanticCanonicalDigest('memory-p2-commit-v1', request.proposal),
      deletionScopeDigest: request.attempt.trigger.policy.deletionScopeDigest,
      longSourceManifestHash:
        targetLayer === 'long' ? request.attempt.context.source_manifest_hash : null,
      longSourceMidManifestHash,
      longSources,
      lease: {
        epoch: projection.recoveryLeaseEpoch,
        expiresAt: projection.recoveryLeaseExpiresAt,
        owner: projection.recoveryLeaseOwner,
      },
      planDigest: request.plan.plan_digest,
      projectId: job.projectId,
      proposalDigest: request.plan.proposal_digest,
      sourceSessionId: request.attempt.trigger.sessionId,
      target: {
        authorityId: entry.target.existing_source_ref_id === null ? null : existingAuthorityId,
        canonicalKey: targetState.canonical_key,
        expectedCurrentResolutionId: existingResolutionId,
        expectedCurrentRevision: targetRevision ?? 0,
        identityId: existingIdentity?.id ?? null,
        identityKeyDigest: semanticCanonicalDigest('memory-p2-layer-identity-v1', [
          job.projectId,
          targetState.canonical_key,
          targetState.semantic_kind,
          identityLayer,
        ]),
        layer: targetLayer,
        resolutionKind:
          targetState.resolution_kind === 'conflict_set' ? 'unknown' : targetState.resolution_kind,
        resolvedValueJson: targetState.value as Prisma.InputJsonValue,
        semanticKind: targetState.semantic_kind,
        semanticStatus: targetState.semantic_status,
      },
      traceId: trace.traceId,
    };
  }

  private lease(expiresAt: Date): MemoryP2LeaseToken {
    return {
      epoch: 1,
      expiresAt: new Date(Math.min(expiresAt.getTime(), this.clock.now().getTime() + 30_000)),
      owner: `p2:${randomUUID()}`,
    };
  }

  private async outcome(
    jobId: string,
    status: string,
    failureCode: string | null,
  ): Promise<MemoryP2StoredOutcome | null> {
    if (status === 'succeeded') {
      const projection = await this.prisma.memoryP2JobProjection.findUnique({
        where: { aiJobId: jobId },
      });
      return projection === null
        ? null
        : { commitProjection: projection, jobId, status: 'succeeded' };
    }
    if (!['failed', 'cancelled', 'unavailable'].includes(status)) return null;
    return {
      errorCode: isErrorCode(failureCode) ? failureCode : 'P2_TERMINAL_UNAVAILABLE',
      jobId,
      status: status as 'failed' | 'cancelled' | 'unavailable',
    };
  }

  private async longTriggerRequest(
    candidate: Awaited<
      ReturnType<MemoryP2PersistenceReader['listPendingLongWakeCandidates']>
    >[number],
    root: string,
  ): Promise<MemoryP2Trigger> {
    const snapshot = await this.prisma.memoryWorkingSnapshot.findFirst({
      orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
      where: {
        projectId: candidate.projectId,
        sourceSessionId: candidate.sourceSessionId,
        contractVersion: 'memory-maintainer-v1.2',
      },
    });
    if (snapshot === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const sourceJob = await this.prisma.aiJob.findUniqueOrThrow({
      where: { id: candidate.sourceMidJobId },
    });
    const checkpointRow = await this.prisma.memoryEvolutionCheckpoint.findUniqueOrThrow({
      where: { id: candidate.sourceFinalMidCheckpointId },
    });
    const projection = await this.prisma.memoryP2JobProjection.findUniqueOrThrow({
      where: { aiJobId: candidate.sourceMidJobId },
    });
    const provisional = buildMemoryP2Trigger({
      kind: 'long_session_end',
      p1SourceContractVersion: 'memory-maintainer-v1.2',
      p1TerminalJobId: candidate.sourceP1TerminalJobId,
      policy: {
        aiPolicyRevision: sourceJob.policyRevision,
        deletionScopeDigest: checkpointRow.deletionScopeDigest,
        p2PolicyRevision: projection.p2PolicyRevision,
        p2RetentionPolicyVersion: projection.p2RetentionPolicyVersion,
        retentionPolicyVersion: sourceJob.retentionPolicyVersion,
      },
      projectId: candidate.projectId,
      sessionId: candidate.sourceSessionId,
      sourceCheckpointRootIdentity: root,
      sourceManifestHash: candidate.sourceRevisionDigest,
      sourceSnapshotId: candidate.sourceFinalMidCheckpointId,
      sourceSnapshotRevision: 1,
      targetLayerRootIdentity: semanticCanonicalDigest('memory-p2-long-target-v1', candidate),
      targetRevision: 0,
    });
    const source = await this.sourceSpec(provisional);
    await this.material(
      this.prisma,
      provisional,
      {
        actualQuestions: [],
        deletionFenceRevision: -1,
        deletionScopeDigest: '',
        id: candidate.sourceMidJobId,
        inputHash: sourceJob.inputHash,
        memories: [],
        policyRevision: sourceJob.policyRevision,
        projectId: sourceJob.projectId,
        replayed: true,
        requestedBy: sourceJob.requestedBy,
        retentionPolicyVersion: sourceJob.retentionPolicyVersion,
        segments: [],
        sessionIds: [candidate.sourceSessionId],
        status: 'succeeded',
      },
      source,
      false,
    );
    return provisional;
  }
}

/** Runtime facade used by the director/worker seam; it adds no queue or second coordinator. */
@Injectable()
export class MemoryP2RuntimeFacade {
  private readonly orchestration: MemoryP2OrchestrationService;
  private readonly recovery: MemoryP2RecoveryService;

  public constructor(
    private readonly store: MemoryP2RuntimeStoreAdapter,
    provider: MemoryP2ProviderPort,
    planAdapter: MemoryP2PlanAdapter,
    clock?: MemoryP2Clock,
  ) {
    this.orchestration = new MemoryP2OrchestrationService(
      store,
      provider,
      planAdapter,
      store,
      clock,
    );
    this.recovery = new MemoryP2RecoveryService(store.recoveryPort, store, clock);
  }

  public run(
    trigger: MemoryP2Trigger,
    signal?: AbortSignal,
  ): ReturnType<MemoryP2OrchestrationService['run']> {
    return this.orchestration.run(trigger, signal);
  }

  public async runLongWakeCandidate(
    candidate: Awaited<
      ReturnType<MemoryP2PersistenceReader['listPendingLongWakeCandidates']>
    >[number],
    signal?: AbortSignal,
  ): ReturnType<MemoryP2OrchestrationService['run']> {
    return this.run(await this.store.buildLongWakeTrigger(candidate), signal);
  }

  public listPendingLongWakeCandidates(
    limit = 100,
  ): ReturnType<MemoryP2RuntimeStoreAdapter['listPendingLongWakeCandidates']> {
    return this.store.listPendingLongWakeCandidates(limit);
  }

  public reconcilePersistedState(
    limit = 200,
  ): ReturnType<MemoryP2RecoveryService['reconcilePersistedState']> {
    return this.recovery.reconcilePersistedState(limit);
  }
}

export { MemoryP2RuntimeFacade as MemoryP2Runtime };

function traceParentRow(
  parent: MemoryP2DecisionTraceWrite['parent'],
): Prisma.DecisionTraceUncheckedCreateInput {
  return {
    activeThreadId: parent.activeThreadId,
    aiJobId: parent.aiJobId,
    attemptId: parent.attemptId,
    completedAt: parent.completedAt,
    contextDigest: parent.contextDigest,
    contextRevision: parent.contextRevision,
    decisionOutcome: parent.decisionOutcome,
    directorInvoked: parent.directorInvoked,
    durationMs: parent.durationMs,
    errorCode: parent.errorCode,
    expiresAt: parent.expiresAt,
    gateReason: parent.gateReason,
    generationId: parent.generationId,
    id: parent.traceId,
    inputHash: parent.inputHash,
    memoryOutcome: parent.memoryOutcome,
    ownerActorId: parent.ownerActorId,
    projectId: parent.projectId,
    publicationOutcome: parent.publicationOutcome,
    requestId: parent.requestId,
    retentionState: persistenceRetentionState(parent.retentionState),
    sessionId: parent.sessionId,
    stage: parent.stage,
    stageTimingsJson: parent.stageTimingsMs,
    startedAt: parent.startedAt,
    status: parent.status,
    traceKind: parent.traceKind,
    triggerType: parent.triggerType,
    workingRevision: parent.workingRevision,
  };
}

function traceParentRowUpdate(
  parent: MemoryP2DecisionTraceWrite['parent'],
): Prisma.DecisionTraceUpdateInput {
  return {
    completedAt: parent.completedAt,
    decisionOutcome: parent.decisionOutcome,
    durationMs: parent.durationMs,
    errorCode: parent.errorCode,
    memoryOutcome: parent.memoryOutcome,
    stage: parent.stage,
    status: parent.status,
  };
}

function traceSemanticRow(
  semantic: MemoryP2DecisionTraceWrite['semantic'],
): Prisma.DecisionTraceMemorySemanticUncheckedCreateInput {
  return {
    aiJobId: semantic.aiJobId,
    commitDigest: semantic.commitDigest,
    createdAt: semantic.createdAt,
    deletionScopeDigest: semantic.deletionScopeDigest,
    planDigest: semantic.planDigest,
    proposalDigest: semantic.proposalDigest,
    sourceManifestHash: semantic.sourceManifestHash,
    traceId: semantic.traceId,
  };
}

function traceSemanticRowUpdate(
  semantic: MemoryP2DecisionTraceWrite['semantic'],
): Prisma.DecisionTraceMemorySemanticUpdateInput {
  return {
    commitDigest: semantic.commitDigest,
    planDigest: semantic.planDigest,
    proposalDigest: semantic.proposalDigest,
    sourceManifestHash: semantic.sourceManifestHash,
  };
}

function traceReferenceRow(
  traceId: string,
  reference: MemoryP2TraceReference,
): Prisma.DecisionTraceMemorySourceReferenceUncheckedCreateInput {
  return {
    aiJobInputSegmentId:
      reference.sourceKind === 'input_segment' ? reference.aiJobInputSegmentId : null,
    createdAt: new Date(),
    deletionScopeDigest: reference.deletionScopeDigest,
    evidenceId: reference.sourceKind === 'evidence' ? reference.evidenceId : null,
    id: randomUUID(),
    inputOrder: reference.inputOrder,
    membershipDigest: reference.membershipDigest,
    resolutionAuthorityId:
      reference.sourceKind === 'resolution' ? reference.resolutionAuthorityId : null,
    sourceCheckpointId: reference.sourceKind === 'checkpoint' ? reference.sourceCheckpointId : null,
    sourceId: referenceTarget(reference),
    sourceJobId: reference.sourceKind === 'job' ? reference.sourceJobId : null,
    sourceKind: reference.sourceKind,
    sourceRevision: reference.sourceRevision,
    traceId,
  };
}

function lifecycleReadability(value: string): MemoryP2TraceReferenceAuthority['readability'] {
  if (value === 'committed' || value === 'frozen') return 'active';
  if (value === 'hidden') return 'hidden';
  if (value === 'deleted') return 'deleted';
  if (value === 'expired') return 'expired';
  if (value === 'cleanup_failed') return 'cleanup_failed';
  return 'missing';
}

function persistenceRetentionState(
  value: MemoryP2DecisionTraceWrite['parent']['retentionState'],
): 'active' | 'hidden' | 'purging' | 'cleanup_failed' {
  return value === 'active' ||
    value === 'hidden' ||
    value === 'purging' ||
    value === 'cleanup_failed'
    ? value
    : 'cleanup_failed';
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function traceReferenceAuthoritiesMatch(
  references: readonly MemoryP2TraceReference[],
  authorities: readonly MemoryP2TraceReferenceAuthority[],
  projectId: string,
  sourceSessionIds: readonly string[],
): boolean {
  return (
    references.length === authorities.length &&
    references.every((reference, index) => {
      const authority = authorities[index];
      return (
        authority !== undefined &&
        authority.sourceKind === reference.sourceKind &&
        authority.targetId === referenceTarget(reference) &&
        authority.projectId === projectId &&
        sourceSessionIds.includes(authority.sessionId) &&
        authority.sourceRevision === reference.sourceRevision &&
        authority.membershipDigest === reference.membershipDigest &&
        authority.deletionScopeDigest === reference.deletionScopeDigest &&
        authority.readability === 'active'
      );
    })
  );
}

function deterministicUuid(value: string): string {
  const digest = semanticCanonicalDigest('memory-p2-uuid-v1', value);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function blocked(
  errorCode: MemoryP2ErrorCode,
  status: 'cancelled' | 'unavailable',
): MemoryP2GateResult {
  return { errorCode, kind: 'blocked', status };
}

function isErrorCode(value: string | null): value is MemoryP2ErrorCode {
  return (
    value !== null &&
    [
      'P2_CAS_LOST',
      'P2_DELETION_SCOPE_DRIFT',
      'P2_MIGRATION_UNAVAILABLE',
      'P2_POLICY_DRIFT',
      'P2_PROVIDER_UNAVAILABLE',
      'P2_RESTART_RECOVERY',
      'P2_RETENTION_UNAVAILABLE',
      'P2_SOURCE_DRIFT',
      'P2_TARGET_DRIFT',
      'P2_TERMINAL_UNAVAILABLE',
      'P2_TRACE_UNAVAILABLE',
    ].includes(value)
  );
}

function traceRefs(
  job: FrozenAiJob,
  segments: readonly {
    id: string;
    inputOrder: number;
    textRevision: number;
    effectiveTextDigest: string;
    sessionId: string;
  }[],
  members: readonly MemoryP2SourceMember[],
  checkpoint: { id: string; memberManifestHash: string } | null,
  deletionScopeDigest: string,
): readonly MemoryP2TraceSourceInput[] {
  const refs: MemoryP2TraceSourceInput[] = [];
  if (checkpoint !== null)
    refs.push({
      deletionScopeDigest,
      inputOrder: 0,
      membershipDigest: checkpoint.memberManifestHash,
      sourceId: checkpoint.id,
      sourceKind: 'checkpoint',
      sourceRevision: 1,
    });
  refs.push({
    deletionScopeDigest,
    inputOrder: refs.length,
    membershipDigest: job.inputHash,
    sourceId: job.id,
    sourceKind: 'job',
    sourceRevision: 1,
  });
  for (const segment of segments)
    refs.push({
      deletionScopeDigest,
      inputOrder: refs.length,
      membershipDigest: segment.effectiveTextDigest,
      sourceId: segment.id,
      sourceKind: 'input_segment',
      sourceRevision: segment.textRevision,
    });
  for (const member of members)
    refs.push({
      deletionScopeDigest,
      inputOrder: refs.length,
      membershipDigest: member.content_digest,
      sourceId: member.source_ref_id.slice(member.source_ref_id.lastIndexOf(':') + 1),
      sourceKind: 'resolution',
      sourceRevision: member.resolution_revision,
    });
  return refs;
}

function referenceFromRow(row: {
  sourceKind: string;
  sourceCheckpointId: string | null;
  sourceJobId: string | null;
  aiJobInputSegmentId: string | null;
  evidenceId: string | null;
  resolutionAuthorityId: string | null;
  sourceRevision: number;
  membershipDigest: string;
  deletionScopeDigest: string;
  inputOrder: number;
}): MemoryP2TraceReference {
  const base = {
    deletionScopeDigest: row.deletionScopeDigest,
    inputOrder: row.inputOrder,
    membershipDigest: row.membershipDigest,
    sourceRevision: row.sourceRevision,
  };
  switch (row.sourceKind) {
    case 'checkpoint':
      if (row.sourceCheckpointId === null) throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
      return { ...base, sourceCheckpointId: row.sourceCheckpointId, sourceKind: 'checkpoint' };
    case 'job':
      if (row.sourceJobId === null) throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
      return { ...base, sourceJobId: row.sourceJobId, sourceKind: 'job' };
    case 'input_segment':
      if (row.aiJobInputSegmentId === null) throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
      return { ...base, aiJobInputSegmentId: row.aiJobInputSegmentId, sourceKind: 'input_segment' };
    case 'evidence':
      if (row.evidenceId === null) throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
      return { ...base, evidenceId: row.evidenceId, sourceKind: 'evidence' };
    case 'resolution':
      if (row.resolutionAuthorityId === null)
        throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
      return {
        ...base,
        resolutionAuthorityId: row.resolutionAuthorityId,
        sourceKind: 'resolution',
      };
    default:
      throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
  }
}

function referenceTarget(reference: MemoryP2TraceReference): string {
  if (reference.sourceKind === 'checkpoint') return reference.sourceCheckpointId;
  if (reference.sourceKind === 'job') return reference.sourceJobId;
  if (reference.sourceKind === 'input_segment') return reference.aiJobInputSegmentId;
  if (reference.sourceKind === 'evidence') return reference.evidenceId;
  return reference.resolutionAuthorityId;
}
