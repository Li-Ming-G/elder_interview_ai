import { ConflictException, Inject, Injectable } from '@nestjs/common';

import type { AudioChunk, AudioObject, Prisma } from '../generated/prisma/client.js';
import { canonicalAudioManifestChecksum } from './audio-manifest.js';
import { AudioStorageProvider } from './audio-storage.provider.js';

@Injectable()
export class AudioIntegrityService {
  public constructor(
    @Inject(AudioStorageProvider) private readonly storage: AudioStorageProvider,
  ) {}

  public async verifyCompleteConsentObject(
    transaction: Prisma.TransactionClient,
    projectId: string,
    audioObjectId: string,
  ): Promise<void> {
    const object = await transaction.audioObject.findUnique({ where: { id: audioObjectId } });
    if (
      object === null ||
      object.projectId !== projectId ||
      object.purpose !== 'consent' ||
      object.sessionId !== null ||
      object.status !== 'complete'
    ) {
      throw consentAudioNotVerified();
    }
    const chunks = await transaction.audioChunk.findMany({
      orderBy: { sequenceNo: 'asc' },
      where: { audioObjectId },
    });
    try {
      await this.verifyCompleteManifest(object, chunks);
    } catch {
      throw consentAudioNotVerified();
    }
  }

  public async verifyCompleteManifest(
    object: AudioObject,
    chunks: readonly AudioChunk[],
  ): Promise<void> {
    if (
      object.status !== 'complete' ||
      object.chunkCount === null ||
      object.totalSizeBytes === null ||
      object.manifestChecksum === null ||
      object.completedAt === null ||
      chunks.length !== object.chunkCount
    ) {
      throw new Error('Audio object is not complete');
    }
    this.assertContinuous(chunks, object.chunkCount);
    let totalSize = 0n;
    for (const chunk of chunks) {
      if (chunk.uploadStatus !== 'uploaded' || chunk.uploadedAt === null) {
        throw new Error('Audio chunk is not uploaded');
      }
      const stored = await this.storage.inspect(chunk.objectKey);
      if (stored.checksum !== chunk.checksum || stored.sizeBytes !== chunk.sizeBytes) {
        throw new Error('Stored audio chunk does not match metadata');
      }
      totalSize += BigInt(chunk.sizeBytes);
    }
    if (
      totalSize !== object.totalSizeBytes ||
      canonicalAudioManifestChecksum(chunks) !== object.manifestChecksum
    ) {
      throw new Error('Audio manifest does not match persisted chunks');
    }
  }

  public assertContinuous(chunks: readonly AudioChunk[], expectedCount: number): void {
    if (chunks.length !== expectedCount) throw new Error('Audio manifest has missing chunks');
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (
        chunk === undefined ||
        chunk.sequenceNo !== index ||
        (index === 0 ? chunk.startMs !== 0 : chunk.startMs !== chunks[index - 1]?.endMs)
      ) {
        throw new Error('Audio manifest is not continuous');
      }
    }
  }
}

function consentAudioNotVerified(): ConflictException {
  return new ConflictException({
    code: 'CONSENT_AUDIO_NOT_VERIFIED',
    details: {},
    message: 'Consent audio could not be verified',
  });
}
