import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { StreamingAsrUnavailableError } from './streaming-asr.js';

const ADAPTER_ACCEPT_TIMEOUT_MS = 250;
const MAX_DURABLE_STREAM_CACHE = 1_024;

@Injectable()
export class CapturePcmEvidenceService {
  private readonly durableStreams = new Map<string, true>();
  private readonly firstEvidenceAttempts = new Map<string, Promise<unknown>>();

  public constructor(private readonly prisma: PrismaService) {}

  public async acceptAndPersist<TResult>(
    sessionId: string,
    audioStreamId: string,
    accept: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    for (;;) {
      if (this.hasDurableEvidence(audioStreamId)) return this.acceptWithinDeadline(accept);
      const activeAttempt = this.firstEvidenceAttempts.get(audioStreamId);
      if (activeAttempt !== undefined) {
        try {
          await activeAttempt;
        } catch {
          // The waiting frame gets its own bounded attempt after the failed leader.
        }
        continue;
      }
      const attempt = this.acceptFirst(sessionId, audioStreamId, accept);
      this.firstEvidenceAttempts.set(audioStreamId, attempt);
      try {
        return await attempt;
      } finally {
        if (this.firstEvidenceAttempts.get(audioStreamId) === attempt) {
          this.firstEvidenceAttempts.delete(audioStreamId);
        }
      }
    }
  }

  private async acceptFirst<TResult>(
    sessionId: string,
    audioStreamId: string,
    accept: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const location = await tx.interviewSession.findUnique({
        select: { projectId: true },
        where: { id: sessionId },
      });
      if (location === null) throw new Error('Capture evidence target is unavailable');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project:${location.projectId}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`session:${sessionId}`}, 0))`;
      const capture = await tx.sessionCaptureGeneration.findUnique({
        where: { audioStreamId },
      });
      if (
        capture === null ||
        capture.sessionId !== sessionId ||
        !['preparing', 'active'].includes(capture.status)
      ) {
        throw new Error('Capture evidence target is unavailable');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`audio:${capture.audioObjectId}`}, 0))`;
      const current = await tx.sessionCaptureGeneration.findUnique({
        where: { id: capture.id },
      });
      if (
        current === null ||
        current.sessionId !== sessionId ||
        current.audioStreamId !== audioStreamId ||
        !['preparing', 'active'].includes(current.status)
      ) {
        throw new Error('Capture evidence target is unavailable');
      }
      if (current.firstPcmAcceptedAt !== null) return { durable: true as const };
      const result = await this.acceptWithinDeadline(accept);
      const persisted = await tx.sessionCaptureGeneration.updateMany({
        data: { firstPcmAcceptedAt: new Date() },
        where: { firstPcmAcceptedAt: null, id: current.id },
      });
      if (persisted.count !== 1) throw new Error('Capture evidence was not persisted');
      return { durable: false as const, result };
    });
    this.markDurable(audioStreamId);
    return outcome.durable ? this.acceptWithinDeadline(accept) : outcome.result;
  }

  private acceptWithinDeadline<TResult>(
    accept: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new StreamingAsrUnavailableError());
      }, ADAPTER_ACCEPT_TIMEOUT_MS);
    });
    const accepted = Promise.resolve().then(() => accept(controller.signal));
    return Promise.race([accepted, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  private hasDurableEvidence(audioStreamId: string): boolean {
    if (!this.durableStreams.delete(audioStreamId)) return false;
    this.durableStreams.set(audioStreamId, true);
    return true;
  }

  private markDurable(audioStreamId: string): void {
    this.durableStreams.delete(audioStreamId);
    this.durableStreams.set(audioStreamId, true);
    const oldest = this.durableStreams.keys().next().value;
    if (this.durableStreams.size > MAX_DURABLE_STREAM_CACHE && oldest !== undefined) {
      this.durableStreams.delete(oldest);
    }
  }
}
