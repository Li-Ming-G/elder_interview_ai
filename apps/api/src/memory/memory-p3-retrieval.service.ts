import { Injectable } from '@nestjs/common';

import { canonicalJson } from '../ai-runtime/ai-provenance.js';
import type {
  EmbeddingProvider,
  MemoryLayerIdentityReference,
  MemoryP3Candidate,
  MemoryP3GraphEdge,
  MemoryP3RecentTranscriptQuerySignal,
  MemoryP3RetrievalRequest,
  MemoryP3RetrievalResult,
  MemoryP3SourceLevel,
  MemoryP3WorkingQuerySignal,
} from './memory-p3-retrieval.types.js';
import {
  MEMORY_P3_RETRIEVAL_CONTRACT_VERSION,
  type MemoryP3RetrievalSource,
} from './memory-p3-retrieval.types.js';
import type { MemoryP3Source, MemoryP3SourceReaderPort } from './memory-p3-source.reader.js';
import type {
  MemoryP3EmbeddingRecord,
  MemoryP3GraphNeighbor,
} from './memory-p3-persistence.types.js';

export interface MemoryP3RetrievalPersistencePort {
  listEmbeddings(projectId: string): Promise<readonly MemoryP3EmbeddingRecord[]>;
  listGraphNeighbors(
    projectId: string,
    memoryId: string,
    limit?: number,
  ): Promise<readonly MemoryP3GraphNeighbor[]>;
}

interface CandidateState {
  readonly source: MemoryP3Source;
  embeddingScore: number | null;
  graphDistance: number | null;
  readonly retrievalSources: Set<MemoryP3RetrievalSource>;
}

interface GraphQueueItem {
  readonly memoryId: string;
  readonly distance: number;
}

interface QueryEmbedding {
  readonly modelId: string;
  readonly providerId: string;
  readonly vector: readonly number[];
}

interface EmbeddingProviderWithModel extends EmbeddingProvider {
  readonly modelId?: string;
}

/**
 * P3's deterministic candidate-set runtime. Working and transcript values
 * are used only to form the query embedding; readable P2 sources are the
 * only values that can become candidates.
 */
@Injectable()
export class MemoryP3RetrievalService {
  public constructor(
    private readonly sourceReader: MemoryP3SourceReaderPort,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly persistence: MemoryP3RetrievalPersistencePort,
  ) {}

  public async retrieve(request: MemoryP3RetrievalRequest): Promise<MemoryP3RetrievalResult> {
    assertRequest(request);
    const sources = (await this.sourceReader.read(request.projectId))
      .filter((source) => isReadableScope(source, request))
      .sort(compareSources);
    const sourcesById = new Map(sources.map((source) => [source.layerIdentityId, source]));

    const queryEmbedding =
      request.queryVector === undefined
        ? await this.embedQuery(request)
        : {
            ...configuredEmbeddingIdentity(this.embeddingProvider),
            vector: validateVector(request.queryVector, 'query vector'),
          };
    const queryVector = queryEmbedding.vector;
    const resultRequest = request.queryVector === undefined ? { ...request, queryVector } : request;
    const embeddings = await this.persistence.listEmbeddings(request.projectId);
    const candidates = new Map<string, CandidateState>();
    const semanticSeeds = new Set<string>();

    for (const embedding of embeddings) {
      const source = sourcesById.get(embedding.layerIdentityId);
      if (source === undefined || !isCurrentEmbedding(embedding, source, queryVector)) continue;
      if (
        embedding.embeddingProfile !== queryEmbedding.providerId ||
        embedding.embeddingVersion !== queryEmbedding.modelId
      )
        continue;
      const score = cosineSimilarity(queryVector, embedding.vector);
      if (score < request.configuration.embeddingThreshold) continue;
      semanticSeeds.add(source.layerIdentityId);
      mergeCandidate(candidates, source, 'embedding', score, null);
    }

    const graphSeeds = new Set(semanticSeeds);
    if (request.activeThreadId !== null) {
      for (const source of sources) {
        if (source.originThreadId === request.activeThreadId)
          graphSeeds.add(source.layerIdentityId);
      }
    }
    const graphEdges = await this.expandGraph(request, sourcesById, graphSeeds, candidates);
    const ordered = [...candidates.values()]
      .sort(compareCandidateStates)
      .slice(0, request.configuration.candidateLimit)
      .map((candidate, rank) => toCandidate(candidate, rank));

    return {
      candidates: ordered,
      graphEdges: graphEdges.sort(compareGraphEdges),
      request: resultRequest,
    };
  }

  private async embedQuery(request: MemoryP3RetrievalRequest): Promise<QueryEmbedding> {
    const result = await this.embeddingProvider.embed({ input: buildQuerySignal(request) });
    const vector = validateVector(result.vector, 'query embedding');
    if (!Number.isSafeInteger(result.dimensions) || result.dimensions < 1)
      throw new Error('query embedding dimensions must be a positive safe integer');
    if (result.dimensions !== vector.length)
      throw new Error('query embedding vector length must equal dimensions');
    if (result.providerId.trim().length === 0)
      throw new Error('query embedding provider id is required');
    if (result.providerId !== this.embeddingProvider.providerId)
      throw new Error('query embedding provider id does not match configured profile');
    if (result.modelId === undefined || result.modelId.trim().length === 0)
      throw new Error('query embedding model id is required');
    return { modelId: result.modelId, providerId: result.providerId, vector };
  }

  private async expandGraph(
    request: MemoryP3RetrievalRequest,
    sourcesById: ReadonlyMap<string, MemoryP3Source>,
    seeds: ReadonlySet<string>,
    candidates: Map<string, CandidateState>,
  ): Promise<MemoryP3GraphEdge[]> {
    const queue: GraphQueueItem[] = [...seeds]
      .sort(compareIds)
      .map((memoryId) => ({ distance: 0, memoryId }));
    const visited = new Map<string, number>();
    const graphEdges = new Map<string, MemoryP3GraphEdge>();
    let graphBudget = request.configuration.graphLimit;

    while (queue.length > 0 && graphBudget > 0) {
      const item = queue.shift();
      if (item === undefined || item.distance >= request.configuration.graphDepth) continue;
      const previousDistance = visited.get(item.memoryId);
      if (previousDistance !== undefined && previousDistance <= item.distance) continue;
      visited.set(item.memoryId, item.distance);

      const neighbors = await this.persistence.listGraphNeighbors(
        request.projectId,
        item.memoryId,
        graphBudget,
      );
      const orderedNeighbors = [...neighbors].sort(compareNeighbors);
      for (const neighbor of orderedNeighbors) {
        if (graphBudget === 0) break;
        graphBudget -= 1;
        const source = sourcesById.get(neighbor.neighborMemoryId);
        if (source === undefined) continue;
        const nextDistance = item.distance + 1;
        const from = sourcesById.get(neighbor.relation.sourceMemoryId);
        const to = sourcesById.get(neighbor.relation.targetMemoryId);
        if (from !== undefined && to !== undefined) {
          const edge = toGraphEdge(neighbor, from, to);
          graphEdges.set(graphEdgeKey(edge), edge);
        }
        mergeCandidate(candidates, source, 'graph', null, nextDistance);
        const knownDistance = visited.get(source.layerIdentityId);
        if (
          nextDistance < request.configuration.graphDepth &&
          (knownDistance === undefined || nextDistance < knownDistance)
        )
          queue.push({ distance: nextDistance, memoryId: source.layerIdentityId });
      }
    }
    return [...graphEdges.values()];
  }
}

function assertRequest(request: MemoryP3RetrievalRequest): void {
  if (
    (request as { contractVersion: string }).contractVersion !==
    MEMORY_P3_RETRIEVAL_CONTRACT_VERSION
  )
    throw new Error('P3 retrieval contract version is invalid');
  if (request.projectId.trim().length === 0 || request.currentSessionId.trim().length === 0)
    throw new Error('P3 retrieval project and session are required');
  if (request.activeThreadId === null && request.activeThreadRevision !== null)
    throw new Error('active thread revision must be null without an active thread');
  if (request.activeThreadId !== null && request.activeThreadRevision === null)
    throw new Error('active thread revision is required with an active thread');
  if (
    request.activeThreadRevision !== null &&
    (!Number.isSafeInteger(request.activeThreadRevision) || request.activeThreadRevision < 1)
  )
    throw new Error('active thread revision must be a positive safe integer');
  const configuration = request.configuration;
  if (
    !Number.isFinite(configuration.embeddingThreshold) ||
    configuration.embeddingThreshold < 0 ||
    configuration.embeddingThreshold > 1
  )
    throw new Error('embedding threshold must be between zero and one');
  if (!Number.isSafeInteger(configuration.candidateLimit) || configuration.candidateLimit < 1)
    throw new Error('candidate limit must be a positive safe integer');
  if (!Number.isSafeInteger(configuration.graphDepth) || configuration.graphDepth < 0)
    throw new Error('graph depth must be a non-negative safe integer');
  if (!Number.isSafeInteger(configuration.graphLimit) || configuration.graphLimit < 0)
    throw new Error('graph limit must be a non-negative safe integer');
  if (request.queryVector !== undefined) validateVector(request.queryVector, 'query vector');
}

function configuredEmbeddingIdentity(
  provider: EmbeddingProvider,
): Pick<QueryEmbedding, 'modelId' | 'providerId'> {
  const providerId = provider.providerId.trim();
  const modelId = (provider as EmbeddingProviderWithModel).modelId?.trim();
  if (providerId.length === 0 || modelId === undefined || modelId.length === 0)
    throw new Error('supplied query vector requires exact embedding profile and version');
  return { modelId, providerId };
}

function buildQuerySignal(request: MemoryP3RetrievalRequest): string {
  return canonicalJson({
    activeThreadId: request.activeThreadId,
    activeThreadRevision: request.activeThreadRevision,
    currentSessionId: request.currentSessionId,
    currentWorkingSignals: request.currentWorkingSignals
      .filter(isWorkingSignal)
      .sort((left, right) => compareIds(left.signalId, right.signalId))
      .map(workingSignalForQuery),
    projectId: request.projectId,
    recentEligibleTranscriptSignals: request.recentEligibleTranscriptSignals
      .filter((signal) => signal.sessionId === request.currentSessionId)
      .sort((left, right) => compareIds(left.segmentId, right.segmentId))
      .map(recentTranscriptSignalForQuery),
    version: 'memory-p3-query-signal-v1',
  });
}

function workingSignalForQuery(signal: MemoryP3WorkingQuerySignal): Record<string, unknown> {
  const result: Record<string, unknown> = {
    revision: signal.revision,
    semanticKind: signal.semanticKind,
    semanticStatus: signal.semanticStatus,
    signalId: signal.signalId,
    threadId: signal.threadId,
    workingMemoryId: signal.workingMemoryId,
  };
  if (signal.queryText !== undefined) result.queryText = signal.queryText;
  return result;
}

function recentTranscriptSignalForQuery(
  signal: MemoryP3RecentTranscriptQuerySignal,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    effectiveTextDigest: signal.effectiveTextDigest,
    segmentId: signal.segmentId,
    sessionId: signal.sessionId,
    speakerRoleRevision: signal.speakerRoleRevision,
    textRevision: signal.textRevision,
  };
  if (signal.boundedQueryText !== undefined) result.boundedQueryText = signal.boundedQueryText;
  return result;
}

function isWorkingSignal(signal: MemoryP3WorkingQuerySignal): boolean {
  return signal.signalId.trim().length > 0 && signal.workingMemoryId.trim().length > 0;
}

function validateVector(vector: readonly number[], label: string): readonly number[] {
  if (vector.length < 1 || vector.some((value) => !Number.isFinite(value)))
    throw new Error(`${label} must contain finite values`);
  return [...vector];
}

function isReadableScope(source: MemoryP3Source, request: MemoryP3RetrievalRequest): boolean {
  if (source.projectId !== request.projectId) return false;
  return source.sourceLevel === 'long' || source.originSessionId === request.currentSessionId;
}

function isCurrentEmbedding(
  embedding: MemoryP3EmbeddingRecord,
  source: MemoryP3Source,
  queryVector: readonly number[],
): boolean {
  return (
    embedding.projectId === source.projectId &&
    embedding.layerIdentityId === source.layerIdentityId &&
    embedding.layerRevisionId === source.layerRevisionId &&
    embedding.dimensions === queryVector.length &&
    embedding.vector.length === queryVector.length &&
    embedding.vector.every(Number.isFinite)
  );
}

function mergeCandidate(
  candidates: Map<string, CandidateState>,
  source: MemoryP3Source,
  retrievalSource: MemoryP3RetrievalSource,
  embeddingScore: number | null,
  graphDistance: number | null,
): void {
  const existing = candidates.get(source.layerIdentityId);
  if (existing === undefined) {
    candidates.set(source.layerIdentityId, {
      embeddingScore,
      graphDistance,
      retrievalSources: new Set([retrievalSource]),
      source,
    });
    return;
  }
  existing.retrievalSources.add(retrievalSource);
  if (
    embeddingScore !== null &&
    (existing.embeddingScore === null || embeddingScore > existing.embeddingScore)
  )
    existing.embeddingScore = embeddingScore;
  if (
    graphDistance !== null &&
    (existing.graphDistance === null || graphDistance < existing.graphDistance)
  )
    existing.graphDistance = graphDistance;
}

function toCandidate(state: CandidateState, rank: number): MemoryP3Candidate {
  return {
    embeddingScore: state.embeddingScore,
    graphDistance: state.graphDistance,
    memoryId: state.source.layerIdentityId,
    rank,
    retrievalSources: [...state.retrievalSources].sort(compareRetrievalSources),
    resolutionAuthorityId: state.source.resolutionAuthorityId,
    revisionId: state.source.layerRevisionId,
    revisionNo: state.source.revisionNo,
    safeContent: state.source.safeContent,
    semanticKind: state.source.semanticKind,
    semanticStatus: state.source.semanticStatus,
    sourceLevel: state.source.sourceLevel,
  };
}

function compareCandidateStates(left: CandidateState, right: CandidateState): number {
  const leftBoth = left.retrievalSources.has('embedding') && left.retrievalSources.has('graph');
  const rightBoth = right.retrievalSources.has('embedding') && right.retrievalSources.has('graph');
  return (
    Number(rightBoth) - Number(leftBoth) ||
    compareEmbeddingScores(left.embeddingScore, right.embeddingScore) ||
    compareNullableNumbers(left.graphDistance, right.graphDistance) ||
    sourceLevelRank(left.source.sourceLevel) - sourceLevelRank(right.source.sourceLevel) ||
    compareIds(left.source.layerIdentityId, right.source.layerIdentityId) ||
    compareIds(left.source.layerRevisionId, right.source.layerRevisionId)
  );
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEmbeddingScores(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? 1 : left > right ? -1 : 0;
}

function sourceLevelRank(level: MemoryP3SourceLevel): number {
  return level === 'mid' ? 0 : 1;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

function toGraphEdge(
  neighbor: MemoryP3GraphNeighbor,
  from: MemoryP3Source,
  to: MemoryP3Source,
): MemoryP3GraphEdge {
  return {
    from: identityReference(from),
    relation: neighbor.relation.relationType,
    to: identityReference(to),
  };
}

function identityReference(source: MemoryP3Source): MemoryLayerIdentityReference {
  return {
    layerIdentityId: source.layerIdentityId,
    originResolutionAuthorityId: source.resolutionAuthorityId,
    originSessionId: source.originSessionId,
    originThreadId: source.originThreadId,
    projectId: source.projectId,
  };
}

function graphEdgeKey(edge: MemoryP3GraphEdge): string {
  return `${edge.relation}:${edge.from.layerIdentityId}:${edge.to.layerIdentityId}`;
}

function compareGraphEdges(left: MemoryP3GraphEdge, right: MemoryP3GraphEdge): number {
  return (
    compareIds(left.relation, right.relation) ||
    compareIds(left.from.layerIdentityId, right.from.layerIdentityId) ||
    compareIds(left.to.layerIdentityId, right.to.layerIdentityId)
  );
}

function compareNeighbors(left: MemoryP3GraphNeighbor, right: MemoryP3GraphNeighbor): number {
  return (
    compareIds(left.relation.relationType, right.relation.relationType) ||
    compareIds(left.neighborMemoryId, right.neighborMemoryId) ||
    compareIds(left.relation.id, right.relation.id)
  );
}

function compareSources(left: MemoryP3Source, right: MemoryP3Source): number {
  return (
    sourceLevelRank(left.sourceLevel) - sourceLevelRank(right.sourceLevel) ||
    compareIds(left.layerIdentityId, right.layerIdentityId) ||
    compareIds(left.layerRevisionId, right.layerRevisionId)
  );
}

function compareRetrievalSources(
  left: MemoryP3RetrievalSource,
  right: MemoryP3RetrievalSource,
): number {
  return left === 'embedding' ? (right === 'embedding' ? 0 : -1) : right === 'graph' ? 0 : 1;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
