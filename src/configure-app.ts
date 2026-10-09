import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ApiErrorFilter } from './common/errors.js';
import type { PilotConfig } from './config.js';
export function configureApp(app: INestApplication) {
  const config = app.get<PilotConfig>('PILOT_CONFIG');
  app.use(helmet());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(json({ limit: '32kb' }));
  app.enableCors({
    origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  return config;
}
