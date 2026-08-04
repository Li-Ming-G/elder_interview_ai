import { createHash } from 'node:crypto';

import type { AudioChunk } from '../generated/prisma/client.js';

export function canonicalAudioManifestChecksum(chunks: readonly AudioChunk[]): string {
  const canonical = chunks.map((chunk) => ({
    checksum: chunk.checksum,
    end_ms: chunk.endMs,
    mime_type: chunk.mimeType,
    sequence_no: chunk.sequenceNo,
    size_bytes: chunk.sizeBytes,
    start_ms: chunk.startMs,
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
