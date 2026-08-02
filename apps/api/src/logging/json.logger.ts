import { type LoggerService } from '@nestjs/common';

type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export class JsonLogger implements LoggerService {
  public debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  public error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  public fatal(message: unknown, context?: string): void {
    this.write('error', message, context);
  }

  public log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  public verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  public warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    const entry = {
      actor_id: null,
      error_code: null,
      event: 'application.log',
      latency_ms: null,
      level,
      message: this.safeMessage(message),
      module: this.safeContext(context),
      project_id: null,
      provider_request_id: null,
      request_id: null,
      session_id: null,
      timestamp: new Date().toISOString(),
      ...(trace === undefined ? {} : { trace_present: true }),
    };
    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  }

  private safeMessage(message: unknown): string {
    if (typeof message === 'string') {
      return 'Application message redacted';
    }
    if (message instanceof Error) {
      return 'Application error';
    }
    return 'Structured application event';
  }

  private safeContext(context: string | undefined): string {
    return context !== undefined && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(context)
      ? context
      : 'application';
  }
}
