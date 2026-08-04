import { ForbiddenException, Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginMiddleware implements NestMiddleware {
  public constructor(@Inject(API_CONFIG) private readonly config: ApiConfigValue) {}

  public use(request: Request, _response: Response, next: NextFunction): void {
    const origin = request.header('origin');
    const mustHaveOrigin = !SAFE_METHODS.has(request.method.toUpperCase());
    if (
      (mustHaveOrigin && origin === undefined) ||
      (origin !== undefined && !this.config.authAllowedOrigins.includes(origin))
    ) {
      throw new ForbiddenException({
        code: 'INVALID_ORIGIN',
        details: {},
        message: 'Request origin is not allowed',
      });
    }
    next();
  }
}
