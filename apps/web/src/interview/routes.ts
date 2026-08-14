export interface PreparationRoute {
  kind: 'preparation';
  projectId: string;
  sessionId: string | null;
}

export interface WorkbenchRoute {
  kind: 'workbench';
  projectId: string;
  sessionId: string;
}

export interface ReviewRoute {
  kind: 'review' | 'save_facts';
  projectId: string;
  sessionId: string;
}

export interface NewInterviewRoute {
  kind: 'new_interview';
}

export interface ReauthorizationRoute {
  kind: 'reauthorization';
  projectId: string;
}

export type InterviewRoute =
  PreparationRoute | WorkbenchRoute | ReviewRoute | NewInterviewRoute | ReauthorizationRoute;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseInterviewRoute(pathname: string): InterviewRoute | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 2 && segments[0] === 'interviews' && segments[1] === 'new') {
    return { kind: 'new_interview' };
  }
  if (segments[0] !== 'projects' || !isUuid(segments[1]) || segments[2] !== 'interview') {
    return null;
  }

  if (segments.length === 4 && segments[3] === 'prepare') {
    return { kind: 'preparation', projectId: segments[1], sessionId: null };
  }
  if (segments.length === 4 && segments[3] === 'reauthorize') {
    return { kind: 'reauthorization', projectId: segments[1] };
  }

  if (segments.length !== 5 || !isUuid(segments[3])) return null;
  if (segments[4] === 'prepare') {
    return { kind: 'preparation', projectId: segments[1], sessionId: segments[3] };
  }
  if (segments[4] === 'workbench') {
    return { kind: 'workbench', projectId: segments[1], sessionId: segments[3] };
  }
  if (segments[4] === 'review') {
    return { kind: 'review', projectId: segments[1], sessionId: segments[3] };
  }
  if (segments[4] === 'save-facts') {
    return { kind: 'save_facts', projectId: segments[1], sessionId: segments[3] };
  }
  return null;
}

export function preparationPath(projectId: string, sessionId?: string): string {
  return `/projects/${projectId}/interview${sessionId === undefined ? '' : `/${sessionId}`}/prepare`;
}

export function workbenchPath(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/interview/${sessionId}/workbench`;
}

export function reauthorizationPath(projectId: string): string {
  return `/projects/${projectId}/interview/reauthorize`;
}

export function reviewPath(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/interview/${sessionId}/review`;
}

export function saveFactsPath(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/interview/${sessionId}/save-facts`;
}

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_PATTERN.test(value);
}
