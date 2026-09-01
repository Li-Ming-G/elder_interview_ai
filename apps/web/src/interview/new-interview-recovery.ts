import type {
  InterviewSessionResponse,
  ProjectSessionListResponse,
} from '@elder-interview/contracts';

import type { NewInterviewWorkflow } from './new-interview-workflow-store.js';

export interface NewInterviewRecoveryAuthority {
  getSession?: (sessionId: string) => Promise<InterviewSessionResponse>;
  listProjectSessions?: (
    projectId: string,
    input?: { cursor?: string | null; limit?: number },
  ) => Promise<ProjectSessionListResponse>;
}

export type NewInterviewRecoveryResult =
  | { kind: 'active'; workflow: NewInterviewWorkflow }
  | { kind: 'retired'; workflow: NewInterviewWorkflow }
  | { kind: 'unavailable' };

const ADVANCED_SESSION_STATUSES = new Set<InterviewSessionResponse['status']>([
  'recording',
  'reconnecting',
  'stopping',
  'processing',
  'completed',
  'interrupted',
  'failed',
]);

export async function reconcileNewInterviewWorkflow(
  workflow: NewInterviewWorkflow,
  authority: NewInterviewRecoveryAuthority,
): Promise<NewInterviewRecoveryResult> {
  const project = workflow.projectAttempt?.response;
  const session = workflow.sessionAttempt?.response;

  if (workflow.status !== 'active') {
    return { kind: 'unavailable' };
  }
  if (project === undefined || project === null) return { kind: 'active', workflow };
  if (
    typeof project.id !== 'string' ||
    project.id.length === 0 ||
    project.created_by !== workflow.actorId
  ) {
    return { kind: 'unavailable' };
  }
  if (session !== undefined && session !== null) {
    const sessionAttempt = workflow.sessionAttempt;
    if (sessionAttempt === null) return { kind: 'unavailable' };
    if (authority.getSession === undefined) return { kind: 'unavailable' };
    let serverSession: InterviewSessionResponse;
    try {
      serverSession = await authority.getSession(session.id);
    } catch {
      return { kind: 'unavailable' };
    }
    if (
      serverSession.id !== session.id ||
      serverSession.project_id !== project.id ||
      serverSession.project_id !== session.project_id ||
      serverSession.created_by !== workflow.actorId ||
      !isKnownSessionStatus(serverSession.status)
    ) {
      return { kind: 'unavailable' };
    }
    const reconciled = {
      ...workflow,
      sessionAttempt: { ...sessionAttempt, response: serverSession },
    };
    return ADVANCED_SESSION_STATUSES.has(serverSession.status)
      ? { kind: 'retired', workflow: reconciled }
      : { kind: 'active', workflow: reconciled };
  }

  if (authority.listProjectSessions === undefined) return { kind: 'unavailable' };
  let cursor: string | null = null;
  do {
    let sessions: ProjectSessionListResponse;
    try {
      sessions = await authority.listProjectSessions(project.id, { cursor });
    } catch {
      return { kind: 'unavailable' };
    }
    if (
      !Array.isArray(sessions.items) ||
      sessions.items.some((item) => item.project_id !== project.id) ||
      (sessions.next_cursor !== null && typeof sessions.next_cursor !== 'string')
    ) {
      return { kind: 'unavailable' };
    }
    if (sessions.items.length > 0) return { kind: 'retired', workflow };
    cursor = sessions.next_cursor;
  } while (cursor !== null);
  return { kind: 'active', workflow };
}

function isKnownSessionStatus(value: unknown): value is InterviewSessionResponse['status'] {
  return (
    value === 'created' ||
    value === 'device_check' ||
    ADVANCED_SESSION_STATUSES.has(value as InterviewSessionResponse['status'])
  );
}
