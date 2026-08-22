import { Injectable } from '@nestjs/common';

import { canonicalJson, sha256 } from '../ai-runtime/ai-provenance.js';
import { PrismaService } from '../database/prisma.service.js';
import { MemoryP2PersistenceReader } from './memory-p2-persistence.reader.js';
import type { ReadableMemoryP2LayerRevision } from './memory-p2-persistence.types.js';
import type {
  MemoryP3MemoryKind,
  MemoryP3ReadableStatus,
  MemoryP3SourceLevel,
} from './memory-p3-retrieval.types.js';

export interface MemoryP3Source {
  readonly projectId: string;
  readonly layerIdentityId: string;
  readonly layerRevisionId: string;
  readonly revisionNo: number;
  readonly sourceLevel: MemoryP3SourceLevel;
  readonly resolutionAuthorityId: string;
  readonly originSessionId: string;
  readonly originThreadId: string;
  readonly semanticKind: MemoryP3MemoryKind;
  readonly semanticStatus: MemoryP3ReadableStatus;
  /** Canonical semantic content only; never transcript or evidence content. */
  readonly safeContent: string;
  readonly contentDigest: string;
}

export interface MemoryP3SourceReaderPort {
  read(projectId: string): Promise<readonly MemoryP3Source[]>;
  readCurrentLayer(layerIdentityId: string): Promise<MemoryP3Source | null>;
}

interface LayerIdentityRow {
  id: string;
  projectId: string;
  originSessionId: string;
  originThreadId: string;
}

interface ResolutionRow {
  id: string;
  canonicalKey: string;
  memoryType: string | null;
  resolutionKind: string;
  resolvedValueJson: unknown;
  semanticKind: MemoryP3MemoryKind | null;
}

interface ResolutionMemberRow {
  memoryClaimId: string;
  memberOrder: number;
}

interface ClaimRow {
  id: string;
  canonicalKey: string;
  valueJson: unknown;
  valueKind: string;
}

/**
 * P3's only semantic input. P2 decides whether a layer is readable; this
 * reader never reconstructs readability from raw transcript or evidence.
 */
@Injectable()
export class MemoryP3SourceReader implements MemoryP3SourceReaderPort {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly p2Reader: MemoryP2PersistenceReader,
  ) {}

  public async read(projectId: string): Promise<readonly MemoryP3Source[]> {
    const identities = (await this.prisma.memoryLayerIdentity.findMany({
      orderBy: { id: 'asc' },
      where: { projectId },
    })) as LayerIdentityRow[];
    const sources: MemoryP3Source[] = [];
    for (const identity of identities) {
      const source = await this.readIdentity(identity);
      if (source !== null) sources.push(source);
    }
    return sources;
  }

  public async readCurrentLayer(layerIdentityId: string): Promise<MemoryP3Source | null> {
    const identity = (await this.prisma.memoryLayerIdentity.findUnique({
      where: { id: layerIdentityId },
    })) as LayerIdentityRow | null;
    return identity === null ? null : this.readIdentity(identity);
  }

  private async readIdentity(identity: LayerIdentityRow): Promise<MemoryP3Source | null> {
    const layer = await this.p2Reader.readCurrentLayer(identity.id);
    if (layer === null) return null;
    return this.readReadableLayer(identity, layer);
  }

  private async readReadableLayer(
    identity: LayerIdentityRow,
    layer: ReadableMemoryP2LayerRevision,
  ): Promise<MemoryP3Source | null> {
    const [resolution, members] = await Promise.all([
      this.prisma.memoryResolution.findUnique({ where: { id: layer.resolutionId } }),
      this.prisma.memoryResolutionMember.findMany({
        orderBy: { memberOrder: 'asc' },
        where: { memoryResolutionId: layer.resolutionId },
      }),
    ]);
    if (resolution === null) return null;
    if (resolution.projectId !== identity.projectId) return null;
    if (resolution.status !== 'current' || !resolution.p2Write) return null;
    if (resolution.authorityId !== layer.authorityId) return null;
    if (resolution.resolutionRevision !== layer.resolutionRevision) return null;
    if (resolution.semanticStatus !== layer.semanticStatus) return null;

    const typedResolution = resolution as unknown as ResolutionRow;
    if (typedResolution.semanticKind === null) return null;
    const typedMembers = members as unknown as ResolutionMemberRow[];
    const claims = (await this.prisma.memoryClaim.findMany({
      where: { id: { in: typedMembers.map((member) => member.memoryClaimId) } },
    })) as ClaimRow[];
    const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
    const semanticClaims: readonly unknown[] = typedMembers.map((member) => {
      const claim = claimsById.get(member.memoryClaimId);
      return claim === undefined
        ? null
        : {
            canonicalKey: claim.canonicalKey,
            value: claim.valueJson,
            valueKind: claim.valueKind,
          };
    });
    if (semanticClaims.some((claim) => claim === null)) return null;

    const safeContent = canonicalJson({
      canonicalKey: typedResolution.canonicalKey,
      claims: semanticClaims,
      memoryType: typedResolution.memoryType,
      resolutionKind: typedResolution.resolutionKind,
      semanticKind: typedResolution.semanticKind,
      semanticStatus: layer.semanticStatus,
      value: typedResolution.resolvedValueJson,
    });
    if (safeContent === '{}' || safeContent.length === 0) return null;

    return {
      contentDigest: sha256(safeContent),
      layerIdentityId: identity.id,
      layerRevisionId: layer.revisionId,
      originSessionId: identity.originSessionId,
      originThreadId: identity.originThreadId,
      projectId: identity.projectId,
      resolutionAuthorityId: layer.authorityId,
      revisionNo: layer.revisionNo,
      safeContent,
      semanticKind: typedResolution.semanticKind,
      semanticStatus: layer.semanticStatus,
      sourceLevel: layer.layer,
    };
  }
}
