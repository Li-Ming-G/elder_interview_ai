import type {
  ConsentResponse,
  InterviewSessionResponse,
  ProjectResponse,
  ServiceTermResponse,
  SpeakerCalibrationSnapshot,
} from '@elder-interview/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ProjectFoundationService } from './project-foundation.service.js';
import { ProjectRequestActorService } from './project-request-actor.service.js';
import { SessionCaptureService } from './session-capture.service.js';
import { SessionFinalizationService } from './session-finalization.service.js';
import { SpeakerCalibrationService } from './speaker-calibration.service.js';
import {
  validateAbandonEmptyCapture,
  validateConfirmCaptureActive,
  validateConsent,
  validateCreateProject,
  validateDeviceCheck,
  validateIdempotentRequest,
  validateReportCaptureInterrupted,
  validateServiceTerm,
  validateStartSession,
  validateStopSession,
  validateRecoverSession,
  validateBeginSpeakerCalibration,
  validateResolveSpeakerCalibration,
  validateUuid,
} from './project.validation.js';

@Controller()
export class ProjectFoundationController {
  public constructor(
    private readonly projects: ProjectFoundationService,
    private readonly actors: ProjectRequestActorService,
    private readonly finalization: SessionFinalizationService,
    private readonly captures: SessionCaptureService,
    private readonly speakerCalibration: SpeakerCalibrationService,
  ) {}

  @Post('projects')
  public async createProject(
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProjectResponse> {
    return this.projects.createProject(
      await this.actors.from(request),
      validateCreateProject(body),
    );
  }

  @Get('projects')
  public async listProjects(@Req() request: AuthenticatedRequest): Promise<ProjectResponse[]> {
    return this.projects.listProjects(await this.actors.from(request));
  }

  @Get('projects/:id')
  public async getProject(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProjectResponse> {
    return this.projects.getProject(await this.actors.from(request), validateUuid(id));
  }

  @Post('projects/:id/service-terms')
  public async createServiceTerm(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceTermResponse> {
    return this.projects.appendServiceTerm(
      await this.actors.from(request),
      validateUuid(id),
      validateServiceTerm(body),
    );
  }

  @Get('projects/:id/service-terms')
  public async listServiceTerms(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceTermResponse[]> {
    return this.projects.listServiceTerms(await this.actors.from(request), validateUuid(id));
  }

  @Post('projects/:id/consents')
  public async createConsent(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentResponse> {
    return this.projects.appendConsent(
      await this.actors.from(request),
      validateUuid(id),
      validateConsent(body),
    );
  }

  @Get('projects/:id/consents')
  public async listConsents(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentResponse[]> {
    return this.projects.listConsents(await this.actors.from(request), validateUuid(id));
  }

  @Post('consents/:id/revoke')
  public async revokeConsent(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentResponse> {
    return this.projects.revokeConsent(
      await this.actors.from(request),
      validateUuid(id),
      validateIdempotentRequest(body).request_id,
    );
  }

  @Post('projects/:id/sessions')
  public async createSession(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.projects.createSession(await this.actors.from(request), validateUuid(id));
  }

  @Get('sessions/:id')
  public async getSession(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.finalization.get(await this.actors.from(request), validateUuid(id));
  }

  @Post('sessions/:id/device-check')
  public async deviceCheck(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.projects.deviceCheck(
      await this.actors.from(request),
      validateUuid(id),
      validateDeviceCheck(body),
    );
  }

  @Post('sessions/:id/start')
  public async startSession(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.projects.startSession(
      await this.actors.from(request),
      validateUuid(id),
      validateStartSession(body),
    );
  }

  @Get('sessions/:id/speaker-calibration')
  public async getSpeakerCalibration(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SpeakerCalibrationSnapshot> {
    return this.speakerCalibration.get(await this.actors.from(request), validateUuid(id));
  }

  @Post('sessions/:id/speaker-calibrations')
  public async beginSpeakerCalibration(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<SpeakerCalibrationSnapshot> {
    return this.speakerCalibration.begin(
      await this.actors.from(request),
      validateUuid(id),
      validateBeginSpeakerCalibration(body),
    );
  }

  @Post('speaker-calibrations/:id/resolve')
  public async resolveSpeakerCalibration(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<SpeakerCalibrationSnapshot> {
    return this.speakerCalibration.resolve(
      await this.actors.from(request),
      validateUuid(id),
      validateResolveSpeakerCalibration(body),
    );
  }

  @Post('sessions/:id/capture/confirm-active')
  public async confirmCaptureActive(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.captures.confirmActive(
      await this.actors.from(request),
      validateUuid(id),
      validateConfirmCaptureActive(body),
    );
  }

  @Post('sessions/:id/capture/interrupted')
  public async reportCaptureInterrupted(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.captures.reportInterrupted(
      await this.actors.from(request),
      validateUuid(id),
      validateReportCaptureInterrupted(body),
    );
  }

  @Post('sessions/:id/capture/abandon-empty')
  public async abandonEmptyCapture(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.captures.abandonEmpty(
      await this.actors.from(request),
      validateUuid(id),
      validateAbandonEmptyCapture(body),
    );
  }

  @Post('sessions/:id/stop')
  @HttpCode(202)
  public async stopSession(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    return this.finalization.stop(
      await this.actors.from(request),
      validateUuid(id),
      validateStopSession(body),
    );
  }

  @Post('sessions/:id/recover')
  @HttpCode(200)
  public async recoverSession(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ): Promise<InterviewSessionResponse> {
    const actor = await this.actors.from(request);
    const sessionId = validateUuid(id);
    const input = validateRecoverSession(body);
    return input.action === 'resume_capture'
      ? this.captures.resume(actor, sessionId, input)
      : this.finalization.recover(actor, sessionId, input);
  }
}
