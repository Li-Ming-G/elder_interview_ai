import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ApiConfig } from '@elder-interview/config';
import type {
  ProjectSessionListItem,
  ProjectSessionListResponse,
  SessionHomeState,
  SessionPrimaryAction,
  SessionReviewAccess,
} from '@elder-interview/contracts';
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { InterviewSession, SessionCaptureGeneration } from '../generated/prisma/client.js';
import { ProjectAccessService } from './project-access.service.js';
import { PostSessionCoordinationService } from './post-session-coordination.service.js';

const CURSOR_VERSION = 1;
const FILTER_VERSION = 'home-session-v1';
const CURSOR_TTL_MS = 15 * 60 * 1000;

interface SessionCursorPayload {
  created_at: string;
  direction: 'desc';
  expires_at: number;
  filter: typeof FILTER_VERSION;
  id: string;
  limit: number;
  project_id: string;
  version: typeof CURSOR_VERSION;
}

type ListedSession = InterviewSession & {
  captureGenerations: SessionCaptureGeneration[];
  finalization: null | {
    audioObject: { manifestChecksum: string | null };
    audioStatus: 'awaiting_upload' | 'verifying' | 'complete' | 'unrecoverable';
    failureCode: string | null;
    transcriptStatus: 'pending' | 'draining' | 'drained' | 'degraded' | 'not_started';
  };
};

@Injectable()
export class ProjectSessionListService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly authorization: ResourceAuthorizationService,
    private readonly postSession: PostSessionCoordinationService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  public async list(
    actor: AuthPrincipal,
    projectId: string,
    query: { cursor: string | null; limit: number },
  ): Promise<ProjectSessionListResponse> {
    await this.authorization.assertRole(actor, ['interviewer']);
    await this.access.assertCanReadOrdinary(actor, projectId);
    const cursor =
      query.cursor === null ? null : this.decodeCursor(query.cursor, projectId, query.limit);
    const sessions = await this.prisma.interviewSession.findMany({
      include: {
        captureGenerations: { orderBy: { generationNo: 'desc' }, take: 1 },
        finalization: { include: { audioObject: { select: { manifestChecksum: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      where: {
        projectId,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: new Date(cursor.created_at) } },
                { createdAt: new Date(cursor.created_at), id: { lt: cursor.id } },
              ],
            }),
      },
    });
    const hasMore = sessions.length > query.limit;
    const items = await Promise.all(
      sessions.slice(0, query.limit).map(async (session) => {
        const coordination = await this.postSession.project(session);
        return projectSessionListItem(session, coordination);
      }),
    );
    const last = sessions[Math.min(sessions.length, query.limit) - 1];
    return {
      items,
      next_cursor:
        hasMore && last !== undefined
          ? this.encodeCursor({
              created_at: last.createdAt.toISOString(),
              direction: 'desc',
              expires_at: Date.now() + CURSOR_TTL_MS,
              filter: FILTER_VERSION,
              id: last.id,
              limit: query.limit,
              project_id: projectId,
              version: CURSOR_VERSION,
            })
          : null,
    };
  }

  private encodeCursor(payload: SessionCursorPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${this.signature(encoded)}`;
  }

  private decodeCursor(value: string, projectId: string, limit: number): SessionCursorPayload {
    try {
      const [encoded, signature, extra] = value.split('.');
      if (encoded === undefined || signature === undefined || extra !== undefined)
        throw new Error();
      if (
        Buffer.from(encoded, 'base64url').toString('base64url') !== encoded ||
        Buffer.from(signature, 'base64url').toString('base64url') !== signature
      )
        throw new Error();
      const expected = Buffer.from(this.signature(encoded), 'base64url');
      const actual = Buffer.from(signature, 'base64url');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw new Error();
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (
        parsed.version !== CURSOR_VERSION ||
        parsed.filter !== FILTER_VERSION ||
        parsed.direction !== 'desc' ||
        parsed.project_id !== projectId ||
        parsed.limit !== limit ||
        typeof parsed.expires_at !== 'number' ||
        parsed.expires_at < Date.now() ||
        typeof parsed.created_at !== 'string' ||
        !Number.isFinite(Date.parse(parsed.created_at)) ||
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.id,
        )
      ) {
        throw new Error();
      }
      return parsed as unknown as SessionCursorPayload;
    } catch {
      throw new UnprocessableEntityException({
        code: 'INVALID_SESSION_CURSOR',
        details: {},
        message: 'Session cursor is invalid',
      });
    }
  }

  private signature(encoded: string): string {
    return createHmac('sha256', this.config.authLoginThrottlePepper)
      .update(`session-cursor-v1:${encoded}`)
      .digest('base64url');
  }
}

export function projectSessionListItem(
  session: ListedSession,
  coordination: Awaited<ReturnType<PostSessionCoordinationService['project']>> = {
    postSessionAnalysis: null,
    secondSessionOpening: null,
  },
): ProjectSessionListItem {
  const capture = session.captureGenerations[0] ?? null;
  const manifestChecksum =
    session.finalization?.audioStatus === 'complete'
      ? session.finalization.audioObject.manifestChecksum
      : null;
  const projection = sessionProjection(session.status, session.captureFailureCode, {
    hasFinalization: session.finalization !== null,
    manifestChecksum,
    uploadStatus: session.finalization?.audioStatus ?? null,
  });
  return {
    capture: capture === null ? null : { status: capture.status },
    capture_failure_code: session.captureFailureCode,
    created_at: session.createdAt.toISOString(),
    duration_seconds: session.durationSeconds,
    ended_at: session.endedAt?.toISOString() ?? null,
    finalization:
      session.finalization === null
        ? null
        : {
            failure_code: publicFailureCode(session.finalization.failureCode),
            manifest_checksum: manifestChecksum,
            recording_status:
              capture?.status === 'interrupted' || session.status === 'interrupted'
                ? 'interrupted'
                : capture?.status === 'active' || session.status === 'recording'
                  ? 'recording'
                  : 'stopped',
            transcript_status: session.finalization.transcriptStatus,
            upload_status: session.finalization.audioStatus,
          },
    home_state: projection.homeState,
    id: session.id,
    primary_action: projection.primaryAction,
    project_id: session.projectId,
    review_access: projection.reviewAccess,
    ...(coordination.postSessionAnalysis === null
      ? {}
      : { post_session_analysis: coordination.postSessionAnalysis }),
    ...(coordination.secondSessionOpening === null
      ? {}
      : { second_session_opening: coordination.secondSessionOpening }),
    sequence_no: session.sequenceNo,
    started_at: session.startedAt?.toISOString() ?? null,
    status: session.status,
  };
}

export function sessionProjection(
  status: InterviewSession['status'],
  captureFailureCode: InterviewSession['captureFailureCode'],
  finalization: {
    hasFinalization: boolean;
    manifestChecksum: string | null;
    uploadStatus: 'awaiting_upload' | 'verifying' | 'complete' | 'unrecoverable' | null;
  },
): {
  homeState: SessionHomeState;
  primaryAction: SessionPrimaryAction;
  reviewAccess: SessionReviewAccess;
} {
  if (status === 'created' || status === 'device_check')
    return result('preparation_required', 'continue_preparation', 'unavailable');
  if (status === 'recording' || status === 'reconnecting')
    return result('interview_active', 'return_to_interview', 'unavailable');
  if (status === 'interrupted')
    return result('interview_interrupted', 'resolve_interruption', 'unavailable');
  if (status === 'stopping') return result('saving_audio', 'view_save_progress', 'unavailable');
  if (status === 'completed') return result('review_ready', 'view_review', 'read_only');
  const completeManifest =
    finalization.hasFinalization &&
    finalization.uploadStatus === 'complete' &&
    finalization.manifestChecksum !== null;
  if (status === 'processing' && completeManifest)
    return result('transcript_processing', 'view_review', 'read_only');
  if (
    status === 'failed' &&
    captureFailureCode === 'NO_AUDIO_CAPTURED' &&
    !finalization.hasFinalization
  )
    return result('no_audio_captured', 'view_save_facts', 'unavailable');
  if (status === 'failed' && completeManifest)
    return result('saved_with_warning', 'view_review', 'read_only');
  return result('save_failed', 'view_save_facts', 'unavailable');
}

function result(
  homeState: SessionHomeState,
  primaryAction: SessionPrimaryAction,
  reviewAccess: SessionReviewAccess,
): {
  homeState: SessionHomeState;
  primaryAction: SessionPrimaryAction;
  reviewAccess: SessionReviewAccess;
} {
  return { homeState, primaryAction, reviewAccess };
}

function publicFailureCode(
  value: string | null,
):
  | 'AUDIO_COMMITMENT_CONFLICT'
  | 'AUDIO_MANIFEST_UNRECOVERABLE'
  | 'FINALIZATION_INTERNAL_FAILURE'
  | null {
  if (value === null) return null;
  if (value === 'AUDIO_COMMITMENT_CONFLICT' || value === 'AUDIO_MANIFEST_UNRECOVERABLE') {
    return value;
  }
  return 'FINALIZATION_INTERNAL_FAILURE';
}
