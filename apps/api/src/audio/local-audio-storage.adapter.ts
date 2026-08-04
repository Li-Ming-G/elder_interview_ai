import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import {
  AudioStorageObjectMissingError,
  AudioStorageProvider,
  type PutStoredAudioChunkResult,
  type StoredAudioChunk,
} from './audio-storage.provider.js';

@Injectable()
export class LocalAudioStorageAdapter extends AudioStorageProvider {
  private readonly root: string;

  public constructor(@Inject(API_CONFIG) config: ApiConfigValue) {
    super();
    this.root = resolve(config.audioStorageRoot);
  }

  public async inspect(objectKey: string): Promise<StoredAudioChunk> {
    try {
      const bytes = await readFile(this.pathFor(objectKey));
      return { checksum: sha256(bytes), sizeBytes: bytes.byteLength };
    } catch (error: unknown) {
      if (isNodeError(error, 'ENOENT')) throw new AudioStorageObjectMissingError();
      throw error;
    }
  }

  public async putImmutable(objectKey: string, bytes: Buffer): Promise<PutStoredAudioChunkResult> {
    const target = this.pathFor(objectKey);
    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    const existing = await this.inspectIfPresent(objectKey);
    if (existing !== null) return { ...existing, created: false };

    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: FileHandle | undefined;
    let result: PutStoredAudioChunkResult | undefined;
    let operationFailed = false;
    let operationError: unknown;
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      try {
        handle = await this.openTemporary(temporary);
        await this.writeTemporary(handle, bytes);
        await this.syncTemporary(handle);
        await handle.close();
        handle = undefined;
        try {
          await this.linkTemporary(temporary, target);
          result = { checksum: sha256(bytes), created: true, sizeBytes: bytes.byteLength };
        } catch (error: unknown) {
          if (!isNodeError(error, 'EEXIST')) throw error;
          const raced = await this.inspect(objectKey);
          result = { ...raced, created: false };
        }
      } catch (error: unknown) {
        operationFailed = true;
        operationError = error;
      }
    } finally {
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch (error: unknown) {
          cleanupFailed = true;
          cleanupError = error;
        }
      }
      try {
        await this.removeTemporary(temporary);
      } catch (error: unknown) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
    }
    if (operationFailed) throw toError(operationError);
    if (cleanupFailed) throw toError(cleanupError);
    if (result === undefined) throw new Error('Audio storage operation produced no result');
    return result;
  }

  protected async openTemporary(path: string): Promise<FileHandle> {
    return open(path, 'wx', 0o600);
  }

  protected async writeTemporary(handle: FileHandle, bytes: Buffer): Promise<void> {
    await handle.writeFile(bytes);
  }

  protected async syncTemporary(handle: FileHandle): Promise<void> {
    await handle.sync();
  }

  protected async linkTemporary(temporary: string, target: string): Promise<void> {
    await link(temporary, target);
  }

  protected async removeTemporary(temporary: string): Promise<void> {
    await rm(temporary, { force: true });
  }

  private async inspectIfPresent(objectKey: string): Promise<StoredAudioChunk | null> {
    try {
      return await this.inspect(objectKey);
    } catch (error: unknown) {
      if (error instanceof AudioStorageObjectMissingError) return null;
      throw error;
    }
  }

  private pathFor(objectKey: string): string {
    if (!/^[0-9a-f-]{36}\/[0-9]+\.bin$/.test(objectKey)) {
      throw new Error('Invalid internal audio object key');
    }
    const target = resolve(this.root, objectKey);
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('Invalid audio storage path');
    return target;
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Audio storage operation failed', { cause: error });
}
