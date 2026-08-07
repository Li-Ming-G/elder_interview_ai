import type { ConsentResponse } from '@elder-interview/contracts';

export function latestConsent(consents: readonly ConsentResponse[]): ConsentResponse | null {
  return (
    [...consents].sort((left, right) => {
      const byCreatedAt = right.created_at.localeCompare(left.created_at);
      return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt;
    })[0] ?? null
  );
}

export function hasCurrentValidConsent(consents: readonly ConsentResponse[]): boolean {
  const consent = latestConsent(consents);
  return consent?.status === 'valid' && consent.revoked_at === null;
}
