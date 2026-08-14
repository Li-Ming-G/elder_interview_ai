import type {
  ConsentContinuationProjection,
  RepeatInterviewProjectActionProjection,
} from '@elder-interview/contracts';
import { Injectable } from '@nestjs/common';

import { DeletionScopeReader } from '../ai-runtime/deletion-scope.reader.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ElderProject, Prisma } from '../generated/prisma/client.js';
import {
  ConsentContinuationPolicyReader,
  type ConsentContinuationCandidate,
} from './consent-continuation.policy.js';
import {
  evaluateRepeatInterviewDecision,
  type RepeatInterviewSessionFact,
} from './repeat-interview-decision.js';

export type RepeatInterviewReadResult =
  | { visibility: 'hidden' }
  | { project: ElderProject; visibility: 'restricted' }
  | {
      consentContinuation: ConsentContinuationProjection;
      project: ElderProject;
      projectStateAvailable: boolean;
      projection: RepeatInterviewProjectActionProjection;
      sessions: readonly RepeatInterviewSessionFact[];
      visibility: 'ordinary';
    };

@Injectable()
export class RepeatInterviewDecisionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly consentPolicy: ConsentContinuationPolicyReader,
    private readonly deletionScopes: DeletionScopeReader,
  ) {}

  public async read(
    actorId: string,
    projectId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<RepeatInterviewReadResult> {
    const project = await db.elderProject.findUnique({
      include: {
        assignments: { select: { userId: true }, where: { revokedAt: null, userId: actorId } },
        consents: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          where: { consentType: 'recording_transcription_ai' },
        },
        interviewSessions: {
          orderBy: [{ sequenceNo: 'asc' }, { id: 'asc' }],
          select: { id: true, sequenceNo: true, status: true },
        },
      },
      where: { id: projectId },
    });
    if (
      project === null ||
      project.assignments.length === 0 ||
      project.deletedAt !== null ||
      project.status === 'deleted'
    ) {
      return { visibility: 'hidden' };
    }
    if (project.status === 'restricted') return { project, visibility: 'restricted' };

    const sessions: RepeatInterviewSessionFact[] = project.interviewSessions.map((session) => ({
      id: session.id,
      sequenceNo: session.sequenceNo,
      status: session.status,
    }));
    const consentContinuation = await this.readConsentContinuation(
      project.consents[0] === undefined
        ? null
        : {
            id: project.consents[0].id,
            revokedAt: project.consents[0].revokedAt,
            status: project.consents[0].status,
            textVersion: project.consents[0].consentTextVersion,
          },
    );
    let projectStateAvailable = true;
    try {
      await this.deletionScopes.assertNoActiveScope(
        project.id,
        sessions.map(({ id }) => id),
      );
    } catch {
      projectStateAvailable = false;
    }
    return {
      consentContinuation,
      project,
      projectStateAvailable,
      projection: evaluateRepeatInterviewDecision({
        actionAccessAvailable: true,
        consentContinuation,
        projectStateAvailable,
        projectStatus: project.status,
        sessions,
      }),
      sessions,
      visibility: 'ordinary',
    };
  }

  public async readConsentContinuation(
    candidate: ConsentContinuationCandidate | null,
  ): Promise<ConsentContinuationProjection> {
    try {
      return await this.consentPolicy.evaluate(candidate);
    } catch {
      return {
        basis_consent_record_id: null,
        basis_consent_text_version: null,
        reason: 'policy_unavailable',
        required_action: null,
        required_consent_text_version: null,
        status: 'unavailable',
        workflow_version: 'continuing-consent-v1',
      };
    }
  }
}
