export const MEMORY_P3_RETRIEVAL_CONTRACT_VERSION = 'memory-p3-retrieval-v1' as const;

export const MEMORY_P3_SOURCE_LEVELS = ['mid', 'long'] as const;
export type MemoryP3SourceLevel = (typeof MEMORY_P3_SOURCE_LEVELS)[number];

export const MEMORY_P3_MEMORY_KINDS = ['episode', 'fact'] as const;
export type MemoryP3MemoryKind = (typeof MEMORY_P3_MEMORY_KINDS)[number];

export const MEMORY_P3_READABLE_STATUSES = ['current', 'uncertain', 'disputed'] as const;
export type MemoryP3ReadableStatus = (typeof MEMORY_P3_READABLE_STATUSES)[number];

export const MEMORY_P3_RETRIEVAL_SOURCES = ['embedding', 'graph'] as const;
export type MemoryP3RetrievalSource = (typeof MEMORY_P3_RETRIEVAL_SOURCES)[number];

export const MEMORY_P3_GRAPH_RELATIONS = ['CONTINUATION', 'RESUME', 'BRANCH', 'RELATED'] as const;
export type MemoryP3GraphRelation = (typeof MEMORY_P3_GRAPH_RELATIONS)[number];

/** Stable P2 MemoryLayerIdentity; graph edges bind identities, never revisions or authorities. */
export interface MemoryLayerIdentityReference {
  readonly layerIdentityId: string;
  readonly projectId: string;
  readonly originSessionId: string;
  readonly originThreadId: string;
  readonly originResolutionAuthorityId: string;
}

/** Working is query-side signal only. It is intentionally not a candidate shape. */
export interface MemoryP3WorkingQuerySignal {
  readonly signalId: string;
  readonly workingMemoryId: string;
  readonly threadId: string;
  readonly revision: number;
  readonly semanticKind: MemoryP3MemoryKind;
  readonly semanticStatus: MemoryP3ReadableStatus;
  readonly queryText?: string;
}

/** Reference-safe, bounded recent final transcript signal; it is never a candidate. */
export interface MemoryP3RecentTranscriptQuerySignal {
  readonly segmentId: string;
  readonly sessionId: string;
  readonly textRevision: number;
  readonly speakerRoleRevision: number;
  readonly effectiveTextDigest: string;
  readonly eligibility: 'trusted-elder-final-conversation';
  readonly boundedQueryText?: string;
}

export interface MemoryP3RetrievalConfiguration {
  readonly embeddingThreshold: number;
  readonly candidateLimit: number;
  readonly graphDepth: number;
  readonly graphLimit: number;
}

export interface MemoryP3Candidate {
  /** Exactly the stable MemoryLayerIdentity.id. */
  readonly memoryId: string;
  /** MemoryResolution authority identity observed by the readable P2 projection. */
  readonly resolutionAuthorityId: string;
  /** Exactly the MemoryLayerRevision.id observed by P3. */
  readonly revisionId: string;
  readonly revisionNo?: number;
  readonly sourceLevel: MemoryP3SourceLevel;
  readonly semanticKind: MemoryP3MemoryKind;
  readonly semanticStatus: MemoryP3ReadableStatus;
  /** Authority-derived safe semantic content; never transcript or evidence body. */
  readonly safeContent: string;
  readonly retrievalSources: readonly MemoryP3RetrievalSource[];
  readonly embeddingScore: number | null;
  readonly graphDistance: number | null;
  readonly rank: number;
}

export interface MemoryP3GraphEdge {
  readonly relation: MemoryP3GraphRelation;
  readonly from: MemoryLayerIdentityReference;
  readonly to: MemoryLayerIdentityReference;
}

export interface MemoryP3RetrievalRequest {
  readonly contractVersion: typeof MEMORY_P3_RETRIEVAL_CONTRACT_VERSION;
  readonly projectId: string;
  readonly currentSessionId: string;
  /** Null means no active thread; non-null is an explicit current-thread reference. */
  readonly activeThreadId: string | null;
  readonly activeThreadRevision: number | null;
  readonly currentWorkingSignals: readonly MemoryP3WorkingQuerySignal[];
  readonly recentEligibleTranscriptSignals: readonly MemoryP3RecentTranscriptQuerySignal[];
  readonly queryVector?: readonly number[];
  readonly configuration: MemoryP3RetrievalConfiguration;
}

export interface MemoryP3RetrievalResult {
  readonly request: MemoryP3RetrievalRequest;
  readonly candidates: readonly MemoryP3Candidate[];
  readonly graphEdges: readonly MemoryP3GraphEdge[];
}

export interface EmbeddingRequest {
  readonly input: string;
}

export interface EmbeddingResult {
  readonly vector: readonly number[];
  readonly dimensions: number;
  readonly providerId: string;
  readonly modelId?: string;
}

/** Provider-neutral seam; provider/model/region/secret activation is deferred. */
export interface EmbeddingProvider {
  readonly providerId: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

export const MEMORY_P3_STORAGE_KIND = 'postgresql-pgvector-v1' as const;
export const MEMORY_P3_EMBEDDING_PORT = 'provider-neutral' as const;
export const MEMORY_P3_EMBEDDING_MODEL_STATUS = 'deferred' as const;
