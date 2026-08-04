import type {
  AudioChunkResponse,
  AudioManifestChunk,
  AudioManifestResponse,
  AudioObjectResponse,
} from '@elder-interview/contracts';

import type { AudioChunk, AudioObject } from '../generated/prisma/client.js';

export function mapAudioObject(value: AudioObject): AudioObjectResponse {
  return {
    created_at: value.createdAt.toISOString(),
    created_by: value.createdBy,
    id: value.id,
    mime_type: value.mimeType,
    project_id: value.projectId,
    purpose: value.purpose,
    session_id: value.sessionId,
    status: value.status,
  };
}

export function mapAudioChunk(value: AudioChunk): AudioChunkResponse {
  if (value.uploadStatus !== 'uploaded' || value.uploadedAt === null) {
    throw new Error('Only uploaded audio chunks can be acknowledged');
  }
  return {
    audio_object_id: value.audioObjectId,
    checksum: value.checksum,
    end_ms: value.endMs,
    id: value.id,
    mime_type: value.mimeType,
    sequence_no: value.sequenceNo,
    size_bytes: value.sizeBytes,
    start_ms: value.startMs,
    upload_status: 'uploaded',
    uploaded_at: value.uploadedAt.toISOString(),
  };
}

export function mapManifestChunk(value: AudioChunk): AudioManifestChunk {
  const mapped = mapAudioChunk(value);
  return {
    checksum: mapped.checksum,
    end_ms: mapped.end_ms,
    mime_type: mapped.mime_type,
    sequence_no: mapped.sequence_no,
    size_bytes: mapped.size_bytes,
    start_ms: mapped.start_ms,
    uploaded_at: mapped.uploaded_at,
  };
}

export function mapAudioManifest(value: AudioObject, chunks: AudioChunk[]): AudioManifestResponse {
  const totalSize = value.totalSizeBytes === null ? null : Number(value.totalSizeBytes);
  if (totalSize !== null && !Number.isSafeInteger(totalSize)) {
    throw new Error('Audio object size exceeds the API safe integer range');
  }
  return {
    ...mapAudioObject(value),
    chunk_count: value.chunkCount,
    chunks: chunks.map(mapManifestChunk),
    completed_at: value.completedAt?.toISOString() ?? null,
    manifest_checksum: value.manifestChecksum,
    total_size_bytes: totalSize,
  };
}
