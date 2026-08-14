import type { ConsentContinuationProjection } from '@elder-interview/contracts';
import { Injectable } from '@nestjs/common';

export const FICTIONAL_CONTINUING_CONSENT_VERSION = 'fictional-test-continuing-consent-v1' as const;

export interface ConsentContinuationCandidate {
  id: string;
  revokedAt: Date | null;
  status: string;
  textVersion: string;
}

export abstract class ConsentContinuationPolicyReader {
  public abstract evaluate(
    candidate: ConsentContinuationCandidate | null,
  ): Promise<ConsentContinuationProjection>;
}

/**
 * Production/default binding until SPEC-CONSENT-TEXT-POLICY-001 accepts an
 * authoritative text, digest, scope metadata, and compatibility policy.
 */
@Injectable()
export class UnavailableConsentContinuationPolicyReader extends ConsentContinuationPolicyReader {
  public override evaluate(): Promise<ConsentContinuationProjection> {
    return Promise.resolve({
      basis_consent_record_id: null,
      basis_consent_text_version: null,
      reason: 'policy_unavailable',
      required_action: null,
      required_consent_text_version: null,
      status: 'unavailable',
      workflow_version: 'continuing-consent-v1',
    });
  }
}

/** Explicit dependency-injection fixture for isolated tests only. */
@Injectable()
export class SyntheticConsentContinuationPolicyReader extends ConsentContinuationPolicyReader {
  public override evaluate(
    candidate: ConsentContinuationCandidate | null,
  ): Promise<ConsentContinuationProjection> {
    if (candidate === null) {
      return Promise.resolve({
        basis_consent_record_id: null,
        basis_consent_text_version: null,
        reason: 'consent_missing',
        required_action: 'record_formal_consent',
        required_consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        status: 'reauthorization_required',
        workflow_version: 'continuing-consent-v1',
      });
    }
    if (candidate.status !== 'valid' || candidate.revokedAt !== null) {
      return Promise.resolve({
        basis_consent_record_id: candidate.id,
        basis_consent_text_version: candidate.textVersion,
        reason: 'consent_revoked',
        required_action: 'record_formal_consent',
        required_consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        status: 'reauthorization_required',
        workflow_version: 'continuing-consent-v1',
      });
    }
    if (candidate.textVersion !== FICTIONAL_CONTINUING_CONSENT_VERSION) {
      return Promise.resolve({
        basis_consent_record_id: candidate.id,
        basis_consent_text_version: candidate.textVersion,
        reason: 'consent_text_version_incompatible',
        required_action: 'record_formal_consent',
        required_consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        status: 'reauthorization_required',
        workflow_version: 'continuing-consent-v1',
      });
    }
    return Promise.resolve({
      basis_consent_record_id: candidate.id,
      basis_consent_text_version: candidate.textVersion,
      reason: 'same_project_planned_interviews_covered',
      required_action: 'show_recording_reminder',
      required_consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
      status: 'covered',
      workflow_version: 'continuing-consent-v1',
    });
  }
}
