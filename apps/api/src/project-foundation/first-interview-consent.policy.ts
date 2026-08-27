export interface CurrentFirstInterviewConsent {
  consentType: string;
  projectId: string;
  revokedAt: Date | null;
  status: string;
}

export function isCurrentFirstInterviewConsentValid(
  consent: CurrentFirstInterviewConsent | null,
  projectId: string,
): boolean {
  return (
    consent !== null &&
    consent.projectId === projectId &&
    consent.consentType === 'recording_transcription_ai' &&
    consent.status === 'valid' &&
    consent.revokedAt === null
  );
}
