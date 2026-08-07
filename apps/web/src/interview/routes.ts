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

export type InterviewRoute = PreparationRoute | WorkbenchRoute;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseInterviewRoute(pathname: string): InterviewRoute | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'projects' || !isUuid(segments[1]) || segments[2] !== 'interview') {
    return null;
  }

  if (segments.length === 4 && segments[3] === 'prepare') {
    return { kind: 'preparation', projectId: segments[1], sessionId: null };
  }

  if (segments.length !== 5 || !isUuid(segments[3])) return null;
  if (segments[4] === 'prepare') {
    return { kind: 'preparation', projectId: segments[1], sessionId: segments[3] };
  }
  if (segments[4] === 'workbench') {
    return { kind: 'workbench', projectId: segments[1], sessionId: segments[3] };
  }
  return null;
}

export function preparationPath(projectId: string, sessionId?: string): string {
  return `/projects/${projectId}/interview${sessionId === undefined ? '' : `/${sessionId}`}/prepare`;
}

export function workbenchPath(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/interview/${sessionId}/workbench`;
}

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_PATTERN.test(value);
}
