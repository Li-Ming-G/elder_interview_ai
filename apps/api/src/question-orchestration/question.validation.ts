import { BadRequestException } from '@nestjs/common';

export function validateUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw invalid();
  }
  return value;
}

export function validateManualNext(body: Record<string, unknown>): {
  expectedPresentationRevision: number;
  expectedSnapshotId: string | null;
  requestId: string;
} {
  const revision = body.expected_presentation_revision;
  const snapshot = body.expected_snapshot_id;
  if (!Number.isInteger(revision) || typeof revision !== 'number' || revision < 0) throw invalid();
  if (snapshot !== null && snapshot !== undefined) validateUuid(snapshot);
  return {
    expectedPresentationRevision: revision,
    expectedSnapshotId: typeof snapshot === 'string' ? snapshot : null,
    requestId: validateUuid(body.request_id),
  };
}

export function validateHistoryQuery(query: Record<string, unknown>): {
  anchor: string | null;
  cursor: string | null;
  limit: number;
} {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid();
  for (const value of [query.anchor, query.cursor]) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length === 0 || value.length > 2048)
    ) {
      throw invalid();
    }
  }
  return {
    anchor: typeof query.anchor === 'string' ? query.anchor : null,
    cursor: typeof query.cursor === 'string' ? query.cursor : null,
    limit,
  };
}

function invalid(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_REQUEST',
    details: {},
    message: 'Request body is invalid',
  });
}
