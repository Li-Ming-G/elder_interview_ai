import { describe, expect, it } from 'vitest';

import { parseInterviewRoute, preparationPath, workbenchPath } from './routes.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('interview routes', () => {
  it('parses project preparation, session preparation and workbench paths', () => {
    expect(parseInterviewRoute(preparationPath(PROJECT_ID))).toEqual({
      kind: 'preparation',
      projectId: PROJECT_ID,
      sessionId: null,
    });
    expect(parseInterviewRoute(preparationPath(PROJECT_ID, SESSION_ID))).toEqual({
      kind: 'preparation',
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(parseInterviewRoute(workbenchPath(PROJECT_ID, SESSION_ID))).toEqual({
      kind: 'workbench',
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
  });

  it('rejects query harnesses, malformed identifiers and unrelated routes', () => {
    expect(parseInterviewRoute('/?project_id=x&session_id=y')).toBeNull();
    expect(parseInterviewRoute('/projects/not-a-uuid/interview/prepare')).toBeNull();
    expect(
      parseInterviewRoute(`/projects/${PROJECT_ID}/interview/${SESSION_ID}/completed`),
    ).toBeNull();
  });
});
