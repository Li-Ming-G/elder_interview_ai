export interface StoredAudioChunk {
  checksum: string;
  sizeBytes: number;
}

export interface PutStoredAudioChunkResult extends StoredAudioChunk {
  created: boolean;
}

export class AudioStorageObjectMissingError extends Error {
  public constructor() {
    super('Stored audio object is missing');
    this.name = 'AudioStorageObjectMissingError';
  }
}

export abstract class AudioStorageProvider {
  public abstract inspect(objectKey: string): Promise<StoredAudioChunk>;
  public abstract putImmutable(
    objectKey: string,
    bytes: Buffer,
  ): Promise<PutStoredAudioChunkResult>;
}
