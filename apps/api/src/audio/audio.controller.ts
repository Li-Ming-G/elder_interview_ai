import type {
  AudioChunkResponse,
  AudioManifestResponse,
  AudioObjectResponse,
} from '@elder-interview/contracts';
import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ProjectRequestActorService } from '../project-foundation/project-request-actor.service.js';
import { AudioService } from './audio.service.js';
import {
  readAudioBody,
  validateAudioChunkRequest,
  validateCompleteAudioObject,
  validateCreateAudioObject,
  validateUuid,
} from './audio.validation.js';

@Controller()
export class AudioController {
  public constructor(
    private readonly audio: AudioService,
    private readonly actors: ProjectRequestActorService,
    @Inject(API_CONFIG) private readonly config: ApiConfigValue,
  ) {}

  @Post('projects/:id/audio-objects')
  public async createObject(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<AudioObjectResponse> {
    return this.audio.createObject(
      await this.actors.from(request),
      validateUuid(id),
      validateCreateAudioObject(body),
    );
  }

  @Put('audio-objects/:id/chunks/:sequenceNo')
  public async uploadChunk(
    @Param('id') id: string,
    @Param('sequenceNo') sequenceNo: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AudioChunkResponse> {
    const actor = await this.actors.from(request);
    const input = validateAudioChunkRequest(request, sequenceNo);
    const bytes = await readAudioBody(request, this.config.audioChunkMaxBytes);
    return this.audio.uploadChunk(actor, validateUuid(id), input, bytes);
  }

  @Post('audio-objects/:id/complete')
  public async completeObject(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<AudioManifestResponse> {
    return this.audio.completeObject(
      await this.actors.from(request),
      validateUuid(id),
      validateCompleteAudioObject(body),
    );
  }

  @Get('audio-objects/:id/manifest')
  public async getManifest(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AudioManifestResponse> {
    return this.audio.getManifest(await this.actors.from(request), validateUuid(id));
  }
}
