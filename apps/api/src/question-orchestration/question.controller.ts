import type {
  SuggestionHistoryItemResponse,
  SuggestionHistoryPageResponse,
  SuggestionPresentationResponse,
  SuggestionRequestAcceptedResponse,
  SuggestionRequestStatusResponse,
} from '@elder-interview/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { QuestionPresentationService } from '../question-evidence/question-presentation.service.js';
import { QuestionOrchestrationService } from './question-orchestration.service.js';
import { QuestionRequestActorService } from './question-request-actor.service.js';
import { validateHistoryQuery, validateManualNext, validateUuid } from './question.validation.js';

@Controller()
export class QuestionController {
  public constructor(
    private readonly actors: QuestionRequestActorService,
    private readonly presentations: QuestionPresentationService,
    private readonly orchestration: QuestionOrchestrationService,
  ) {}

  @Get('sessions/:id/suggestions/current')
  public async current(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SuggestionPresentationResponse> {
    const actor = await this.actors.from(request);
    const sessionId = validateUuid(id);
    const current = await this.presentations.current(actor, sessionId);
    const aiStatus = await this.orchestration.automaticStatus(sessionId);
    return { ...current, ai_status: aiStatus };
  }

  @Get('sessions/:id/suggestions/history')
  public async history(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<SuggestionHistoryPageResponse> {
    return this.presentations.history(
      await this.actors.from(request),
      validateUuid(id),
      validateHistoryQuery(query),
    );
  }

  @Get('sessions/:id/suggestions/history/:snapshotId')
  public async historyItem(
    @Param('id') id: string,
    @Param('snapshotId') snapshotId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SuggestionHistoryItemResponse> {
    return this.presentations.historyItem(
      await this.actors.from(request),
      validateUuid(id),
      validateUuid(snapshotId),
    );
  }

  @Post('sessions/:id/suggestions/next')
  @HttpCode(202)
  public async next(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SuggestionRequestAcceptedResponse> {
    try {
      return await this.orchestration.requestManualNext(
        await this.actors.from(request),
        validateUuid(id),
        validateManualNext(body),
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        const retryAfterMs = readRetryAfterMs(error.getResponse());
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1_000))));
      }
      throw error;
    }
  }

  @Get('sessions/:id/suggestion-requests/:requestId')
  public async status(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SuggestionRequestStatusResponse> {
    return this.presentations.status(
      await this.actors.from(request),
      validateUuid(id),
      validateUuid(requestId),
    );
  }
}

function readRetryAfterMs(value: string | object): number {
  if (typeof value !== 'object' || !('details' in value)) return 1_000;
  const details = value.details;
  if (typeof details !== 'object' || details === null || !('retry_after_ms' in details))
    return 1_000;
  const retryAfterMs = details.retry_after_ms;
  return typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? retryAfterMs : 1_000;
}
