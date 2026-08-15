export const LLM_EVALUATION_ARTIFACT_TARGET = 'isolated_evaluation_artifact' as const;

export interface LlmEvaluationArtifactEnvelopeV1 {
  artifact_target: typeof LLM_EVALUATION_ARTIFACT_TARGET;
  data_class: 'synthetic' | 'deidentified';
  contains_real_personal_data: false;
  publish_targets: [typeof LLM_EVALUATION_ARTIFACT_TARGET];
  prohibited_publish_targets: ['question_current', 'question_history'];
}

export function assertIsolatedLlmEvaluationArtifact(
  artifact: unknown,
): asserts artifact is LlmEvaluationArtifactEnvelopeV1 {
  if (typeof artifact !== 'object' || artifact === null) {
    throw new Error('LLM_EVALUATION_ARTIFACT_TARGET_INVALID');
  }
  const candidate = artifact as Record<string, unknown>;
  const publishTargets = candidate.publish_targets;
  const prohibitedTargets = candidate.prohibited_publish_targets;
  if (
    candidate.artifact_target !== LLM_EVALUATION_ARTIFACT_TARGET ||
    candidate.contains_real_personal_data !== false ||
    !Array.isArray(publishTargets) ||
    publishTargets.length !== 1 ||
    publishTargets[0] !== LLM_EVALUATION_ARTIFACT_TARGET ||
    !Array.isArray(prohibitedTargets) ||
    prohibitedTargets.length !== 2 ||
    prohibitedTargets[0] !== 'question_current' ||
    prohibitedTargets[1] !== 'question_history'
  ) {
    throw new Error('LLM_EVALUATION_ARTIFACT_TARGET_INVALID');
  }
}
