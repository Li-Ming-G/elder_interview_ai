import type {
  ConsentResponse,
  InterviewSessionResponse,
  ProjectResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ProjectFoundationService } from './project-foundation.service.js';
import { ProjectRequestActorService } from './project-request-actor.service.js';
import {
  validateConsent,
  validateCreateProject,
  validateDeviceCheck,
  validateIdempotentRequest,
  validateServiceTerm,
  validateUuid,
} from './project.validation.js';

@Controller()
export class ProjectFoundationController {
  public constructor(
    private readonly projects: ProjectFoundationService,
    private readonly actors: ProjectRequestActorService,
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
    return this.projects.getSession(await this.actors.from(request), validateUuid(id));
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
      validateIdempotentRequest(body).request_id,
    );
  }
}
