export const MEMORY_P3_RETRIEVAL_CONTRACT_VERSION = 'memory-p3-retrieval-v1' as const;

export const MEMORY_P3_SOURCE_LEVELS = ['mid', 'long'] as const;
export type MemoryP3SourceLevel = (typeof MEMORY_P3_SOURCE_LEVELS)[number];

export const MEMORY_P3_MEMORY_KINDS = ['episode', 'fact'] as const;
export type MemoryP3MemoryKind = (typeof MEMORY_P3_MEMORY_KINDS)[number];

export const MEMORY_P3_READABLE_STATUSES = ['current', 'uncertain', 'disputed'] as const;
export type MemoryP3ReadableStatus = (typeof MEMORY_P3_READABLE_STATUSES)[number];

export const MEMORY_P3_RETRIEVAL_SOURCES = ['embedding', 'graph_neighbor'] as const;
export type MemoryP3RetrievalSource = (typeof MEMORY_P3_RETRIEVAL_SOURCES)[number];

export const MEMORY_P3_GRAPH_RELATIONS = ['CONTINUATION', 'RESUME', 'BRANCH', 'RELATED'] as const;
export type MemoryP3GraphRelation = (typeof MEMORY_P3_GRAPH_RELATIONS)[number];

/** Stable P2 identity; graph edges bind identities, never transient revisions. */
export interface MemoryLayerIdentityReference {
  readonly layerIdentityId: string;
  readonly projectId: string;
  readonly originSessionId: string;
  readonly originThreadId: string;
  readonly originResolutionId: string;
}

/** Working is query-side signal only. It is intentionally not a candidate shape. */
export interface MemoryP3WorkingQuerySignal {
  readonly workingMemoryId: string;
  readonly threadId: string;
  readonly revision: number;
  readonly kind: MemoryP3MemoryKind;
  readonly status: MemoryP3ReadableStatus;
  readonly queryText?: string;
}

export interface MemoryP3Query {
  readonly workingSignals: readonly MemoryP3WorkingQuerySignal[];
  readonly queryVector?: readonly number[];
}

export interface MemoryP3RetrievalConfiguration {
  readonly embeddingThreshold: number;
  readonly candidateLimit: number;
  readonly graphNeighborDepth: number;
  readonly graphNeighborLimit: number;
}

export interface MemoryP3Candidate {
  readonly memoryId: string;
  readonly authorityId: string;
  /** MemoryResolution revision observed by the readable P2 projection. */
  readonly revision: number;
  readonly sourceLevel: MemoryP3SourceLevel;
  /** Mid has exactly the current session; Long is the readable project source set. */
  readonly sourceSessionIds: readonly string[];
  readonly kind: MemoryP3MemoryKind;
  readonly status: MemoryP3ReadableStatus;
  /** Authority-derived safe semantic content; never transcript or evidence body. */
  readonly safeContent: string;
  readonly layerIdentity: MemoryLayerIdentityReference;
  readonly retrievalSources: readonly MemoryP3RetrievalSource[];
  readonly embeddingScore: number | null;
  readonly graphDistance: number | null;
  readonly score: number;
  readonly rank: number;
}

export interface MemoryP3GraphEdge {
  readonly relation: MemoryP3GraphRelation;
  readonly from: MemoryLayerIdentityReference;
  readonly to: MemoryLayerIdentityReference;
}

export interface MemoryP3RetrievalScope {
  readonly projectId: string;
  readonly currentSessionId: string;
}

export interface MemoryP3RetrievalRequest {
  readonly contractVersion: typeof MEMORY_P3_RETRIEVAL_CONTRACT_VERSION;
  readonly scope: MemoryP3RetrievalScope;
  readonly query: MemoryP3Query;
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
