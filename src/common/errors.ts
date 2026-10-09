import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (
      error &&
      typeof error === 'object' &&
      'type' in error &&
      'status' in error &&
      ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))
    )
      return response
        .status(Number(error.status))
        .json({
          message:
            error.type === 'entity.too.large'
              ? 'Request body is too large'
              : 'Invalid JSON request body',
        });
    if (error instanceof HttpException) {
      const result = error.getResponse();
      return response
        .status(error.getStatus())
        .json(typeof result === 'string' ? { message: result } : result);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        return response
          .status(409)
          .json({ message: 'A record with these details already exists' });
      if (error.code === 'P2003' || error.code === 'P2025')
        return response
          .status(400)
          .json({ message: 'Related record is unavailable' });
    }
    // Log only the error class, never request bodies, tokens or Prisma query details.
    this.logger.error(error instanceof Error ? error.name : 'UnknownError');
    return response
      .status(500)
      .json({ message: 'Unable to process this request' });
  }
}
