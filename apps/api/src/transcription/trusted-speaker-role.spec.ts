import { describe, expect, it } from 'vitest';

import { projectTrustedSpeakerRole } from './trusted-speaker-role.js';

describe('projectTrustedSpeakerRole', () => {
  it('does not trust a provider elder label without user-confirmed authority', () => {
    expect(
      projectTrustedSpeakerRole({
        correctedSpeakerRole: null,
        originalRoleAuthority: 'unconfirmed',
        originalSpeakerRole: 'elder',
      }),
    ).toEqual({ effectiveSpeakerRole: 'elder', trustedEffectiveSpeakerRole: 'unknown' });
  });

  it('trusts an elder role captured from a user-confirmed stream mapping', () => {
    expect(
      projectTrustedSpeakerRole({
        correctedSpeakerRole: null,
        originalRoleAuthority: 'user_confirmed',
        originalSpeakerRole: 'elder',
      }),
    ).toEqual({ effectiveSpeakerRole: 'elder', trustedEffectiveSpeakerRole: 'elder' });
  });

  it('projects a future explicit correction without mutating original evidence', () => {
    const evidence = {
      correctedSpeakerRole: 'interviewer' as const,
      originalRoleAuthority: 'unconfirmed' as const,
      originalSpeakerRole: 'elder' as const,
    };
    expect(projectTrustedSpeakerRole(evidence)).toEqual({
      effectiveSpeakerRole: 'interviewer',
      trustedEffectiveSpeakerRole: 'interviewer',
    });
    expect(evidence.originalSpeakerRole).toBe('elder');
  });
});
