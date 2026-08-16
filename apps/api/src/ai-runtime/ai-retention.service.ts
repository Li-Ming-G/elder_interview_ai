import { createHmac, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export type AiRetentionRootKind =
  'ai_job' | 'question_display_snapshot' | 'memory_retention_root' | 'decision_trace';

interface RetentionRootSnapshot {
  expiresAt: Date;
  retentionCleanupAttemptCount: number;
  retentionCleanupRequestId: string | null;
  retentionState: 'active' | 'hidden' | 'purging' | 'cleanup_failed';
}

@Injectable()
export class AiRetentionService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfigValue,
  ) {}

  public async hideExpired(
    rootKind: AiRetentionRootKind,
    rootId: string,
    cleanupRequestId: string,
    now = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`retention:${rootKind}:${rootId}`}, 0))`;
      const root = await this.readRoot(tx, rootKind, rootId);
      if (root === null) return;
      if (root.expiresAt > now) throw new Error('AI_RETENTION_NOT_EXPIRED');
      if (
        root.retentionCleanupRequestId !== null &&
        root.retentionCleanupRequestId !== cleanupRequestId
      )
        throw new Error('AI_RETENTION_CLEANUP_IDENTITY_MISMATCH');
      if (root.retentionState === 'hidden' || root.retentionState === 'cleanup_failed') return;
      await this.markHidden(tx, rootKind, rootId, cleanupRequestId, now);
      await this.detach(tx, rootKind, rootId);
    });
  }

  public async purge(
    rootKind: AiRetentionRootKind,
    rootId: string,
    cleanupRequestId: string,
  ): Promise<void> {
    const requestHash = this.hash('request', cleanupRequestId);
    const existingAudit = await this.prisma.aiRetentionCleanupAudit.findUnique({
      where: { cleanupRequestHash: requestHash },
    });
    if (existingAudit?.outcome === 'purged') return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`retention:${rootKind}:${rootId}`}, 0))`;
        const root = await this.readRoot(tx, rootKind, rootId);
        if (root === null) return;
        if (root.retentionCleanupRequestId !== cleanupRequestId) {
          throw new Error('AI_RETENTION_CLEANUP_IDENTITY_MISMATCH');
        }
        if (!['hidden', 'cleanup_failed'].includes(root.retentionState)) {
          throw new Error('AI_RETENTION_HIDE_REQUIRED');
        }
        await this.markPurging(tx, rootKind, rootId);
        await this.detachCrossRootMemberships(tx, rootKind, rootId);
        await this.deleteRoot(tx, rootKind, rootId);
        await tx.aiRetentionCleanupAudit.upsert({
          create: {
            attemptCount: root.retentionCleanupAttemptCount + 1,
            cleanupRequestHash: requestHash,
            completedAt: new Date(),
            id: randomUUID(),
            outcome: 'purged',
            rootIdHash: this.hash('root', rootId),
            rootKind,
          },
          update: {
            attemptCount: { increment: 1 },
            completedAt: new Date(),
            errorCode: null,
            outcome: 'purged',
          },
          where: { cleanupRequestHash: requestHash },
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        ['AI_RETENTION_CLEANUP_IDENTITY_MISMATCH', 'AI_RETENTION_HIDE_REQUIRED'].includes(
          error.message,
        )
      ) {
        throw error;
      }
      await this.markFailed(rootKind, rootId, cleanupRequestId, error);
      throw error;
    }
  }

  private async detach(
    tx: Prisma.TransactionClient,
    rootKind: AiRetentionRootKind,
    rootId: string,
  ): Promise<void> {
    if (rootKind === 'ai_job') {
      await tx.aiDerivedOutput.updateMany({
        data: {
          invalidatedAt: new Date(),
          invalidationReason: 'retention_hidden',
          status: 'invalidated',
        },
        where: { aiJobId: rootId, status: 'current' },
      });
      await tx.memoryResolution.updateMany({
        data: { status: 'superseded' },
        where: { aiJobId: rootId, status: 'current' },
      });
      await tx.actualQuestionAnalysis.updateMany({
        data: { isCurrentPublished: false },
        where: { aiJobId: rootId, isCurrentPublished: true },
      });
      await tx.$executeRawUnsafe(
        `UPDATE ai_derived_output SET status='invalidated', invalidated_at=now(), invalidation_reason='dependency_retention_hidden'
         WHERE id IN (
           SELECT d.ai_derived_output_id FROM ai_output_memory_dependency d
           JOIN ai_job_input_memory m ON m.id=d.ai_job_input_memory_id
           JOIN memory_resolution r ON r.id=m.memory_resolution_id WHERE r.ai_job_id=$1::uuid
           UNION
           SELECT d.ai_derived_output_id FROM ai_output_question_dependency d
           JOIN actual_question q ON q.id=d.target_id
           JOIN actual_question_analysis a ON a.id=q.actual_question_analysis_id WHERE a.ai_job_id=$1::uuid
           UNION
           SELECT r.ai_derived_output_id FROM memory_resolution r
           JOIN memory_resolution_member m ON m.memory_resolution_id=r.id
           JOIN memory_claim c ON c.id=m.memory_claim_id WHERE c.ai_job_id=$1::uuid
         ) AND status='current'`,
        rootId,
      );
      return;
    }
    if (rootKind === 'question_display_snapshot') {
      await tx.questionDisplayState.updateMany({
        data: {
          currentSnapshotId: null,
          presentationRevision: { increment: 1 },
          visibility: 'withdrawn',
          withdrawalReason: 'retention_hidden',
        },
        where: { currentSnapshotId: rootId },
      });
      await tx.$executeRawUnsafe(
        `UPDATE ai_derived_output SET status='invalidated', invalidated_at=now(), invalidation_reason='display_retention_hidden'
         WHERE id IN (SELECT ai_derived_output_id FROM ai_output_question_dependency WHERE target_kind='display_snapshot' AND target_id=$1::uuid)
           AND status='current'`,
        rootId,
      );
      return;
    }
    await tx.memoryResolution.updateMany({
      data: { status: 'superseded' },
      where: { memoryRetentionRootId: rootId, status: 'current' },
    });
  }

  private async detachCrossRootMemberships(
    tx: Prisma.TransactionClient,
    rootKind: AiRetentionRootKind,
    rootId: string,
  ): Promise<void> {
    if (rootKind === 'ai_job') {
      await tx.$executeRawUnsafe(
        `DELETE FROM ai_job_input_actual_question WHERE actual_question_id IN (
           SELECT q.id FROM actual_question q JOIN actual_question_analysis a ON a.id=q.actual_question_analysis_id WHERE a.ai_job_id=$1::uuid
         ) AND ai_job_id <> $1::uuid`,
        rootId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM context_snapshot_actual_question WHERE actual_question_id IN (
           SELECT q.id FROM actual_question q JOIN actual_question_analysis a ON a.id=q.actual_question_analysis_id WHERE a.ai_job_id=$1::uuid
         )`,
        rootId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM context_snapshot_memory WHERE memory_resolution_id IN (SELECT id FROM memory_resolution WHERE ai_job_id=$1::uuid)`,
        rootId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM memory_resolution_member
         WHERE memory_claim_id IN (SELECT id FROM memory_claim WHERE ai_job_id=$1::uuid)
           AND memory_resolution_id NOT IN (SELECT id FROM memory_resolution WHERE ai_job_id=$1::uuid)`,
        rootId,
      );
    } else if (rootKind === 'memory_retention_root') {
      await tx.$executeRawUnsafe(
        `DELETE FROM context_snapshot_memory WHERE memory_resolution_id IN (SELECT id FROM memory_resolution WHERE memory_retention_root_id=$1::uuid)`,
        rootId,
      );
    }
    // decision_trace children are owned by the root and cascade on purge.
  }

  private async readRoot(
    tx: Prisma.TransactionClient,
    rootKind: AiRetentionRootKind,
    rootId: string,
  ): Promise<RetentionRootSnapshot | null> {
    if (rootKind === 'ai_job') return tx.aiJob.findUnique({ where: { id: rootId } });
    if (rootKind === 'question_display_snapshot') {
      return tx.questionDisplaySnapshot.findUnique({ where: { id: rootId } });
    }
    if (rootKind === 'decision_trace')
      return tx.decisionTrace.findUnique({ where: { id: rootId } });
    return tx.memoryRetentionRoot.findUnique({ where: { id: rootId } });
  }

  private async markHidden(
    tx: Prisma.TransactionClient,
    rootKind: AiRetentionRootKind,
    rootId: string,
    cleanupRequestId: string,
    now: Date,
  ): Promise<void> {
    const data = {
      retentionCleanupAttemptCount: { increment: 1 },
      retentionCleanupRequestId: cleanupRequestId,
      retentionHiddenAt: now,
      retentionState: 'hidden' as const,
    };
    if (rootKind === 'ai_job') await tx.aiJob.update({ data, where: { id: rootId } });
    else if (rootKind === 'question_display_snapshot') {
      await tx.questionDisplaySnapshot.update({ data, where: { id: rootId } });
    } else if (rootKind === 'decision_trace') {
      await tx.decisionTrace.update({ data, where: { id: rootId } });
    } else await tx.memoryRetentionRoot.update({ data, where: { id: rootId } });
  }

  private async markPurging(
    tx: Prisma.TransactionClient,
    rootKind: AiRetentionRootKind,
    rootId: string,
  ): Promise<void> {
    const data = { retentionCleanupStartedAt: new Date(), retentionState: 'purging' as const };
    if (rootKind === 'ai_job') await tx.aiJob.update({ data, where: { id: rootId } });
    else if (rootKind === 'question_display_snapshot') {
      await tx.questionDisplaySnapshot.update({ data, where: { id: rootId } });
    } else if (rootKind === 'decision_trace') {
      await tx.decisionTrace.update({ data, where: { id: rootId } });
    } else await tx.memoryRetentionRoot.update({ data, where: { id: rootId } });
  }

  private async deleteRoot(
    tx: Prisma.TransactionClient,
    rootKind: AiRetentionRootKind,
    rootId: string,
  ): Promise<void> {
    if (rootKind === 'ai_job') await tx.aiJob.delete({ where: { id: rootId } });
    else if (rootKind === 'question_display_snapshot') {
      await tx.questionDisplaySnapshot.delete({ where: { id: rootId } });
    } else if (rootKind === 'decision_trace') {
      await tx.decisionTrace.delete({ where: { id: rootId } });
    } else await tx.memoryRetentionRoot.delete({ where: { id: rootId } });
  }

  private async markFailed(
    rootKind: AiRetentionRootKind,
    rootId: string,
    cleanupRequestId: string,
    error: unknown,
  ): Promise<void> {
    const code = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN';
    const data = { retentionCleanupErrorCode: code, retentionState: 'cleanup_failed' as const };
    try {
      if (rootKind === 'ai_job') await this.prisma.aiJob.update({ data, where: { id: rootId } });
      else if (rootKind === 'question_display_snapshot') {
        await this.prisma.questionDisplaySnapshot.update({ data, where: { id: rootId } });
      } else if (rootKind === 'decision_trace') {
        await this.prisma.decisionTrace.update({ data, where: { id: rootId } });
      } else await this.prisma.memoryRetentionRoot.update({ data, where: { id: rootId } });
      await this.prisma.aiRetentionCleanupAudit.upsert({
        create: {
          attemptCount: 1,
          cleanupRequestHash: this.hash('request', cleanupRequestId),
          errorCode: code,
          id: randomUUID(),
          outcome: 'failed',
          rootIdHash: this.hash('root', rootId),
          rootKind,
        },
        update: { attemptCount: { increment: 1 }, errorCode: code, outcome: 'failed' },
        where: { cleanupRequestHash: this.hash('request', cleanupRequestId) },
      });
    } catch {
      // The root may already have been deleted by an idempotent concurrent cleanup.
    }
  }

  private hash(kind: string, value: string): string {
    return createHmac('sha256', this.config.aiRetentionCleanupPepper)
      .update(`ai-retention/${kind}/${value}`, 'utf8')
      .digest('hex');
  }
}
