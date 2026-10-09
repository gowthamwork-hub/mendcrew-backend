import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PilotConfig } from '../config.js';
import { tokenHash } from './security.js';

export type Principal = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  technician: { id: string; active: boolean } | null;
};
export type AuthedRequest = Request & {
  principal: Principal;
  sessionId: string;
};
export const Public = () => SetMetadata('public', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const Actor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<AuthedRequest>().principal,
);

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject('PILOT_CONFIG') private readonly config: PilotConfig,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const now = Date.now();
    const key = `${req.ip}:${req.path.startsWith('/auth/') ? 'auth' : 'api'}`;
    for (const [entry, bucket] of this.attempts)
      if (bucket.until <= now) this.attempts.delete(entry);
    const bucket = this.attempts.get(key) ?? { count: 0, until: now + 60000 };
    const limit =
      req.path.startsWith('/auth/') && req.method === 'POST' ? 10 : 120;
    if (++bucket.count > limit || this.attempts.size >= 10000)
      throw new HttpException('Too many requests; try again later', 429);
    this.attempts.set(key, bucket);
    const cookie = req.headers.cookie
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('mendcrew_session='))
      ?.slice('mendcrew_session='.length);
    if (
      (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) ||
      (req.method === 'POST' &&
        ['/auth/admin/login', '/auth/technician/login'].includes(req.path))
    ) {
      if (
        !req.headers.origin ||
        !this.config.CORS_ORIGINS.split(',')
          .map((s) => s.trim())
          .includes(req.headers.origin)
      )
        throw new ForbiddenException('Invalid request origin');
    }
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const bearer = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    const token = bearer ?? cookie;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Sign in to continue');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            role: true,
            active: true,
            technician: { select: { id: true, active: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= now ||
      !session.user.active ||
      (session.user.role === Role.TECHNICIAN &&
        !session.user.technician?.active)
    )
      throw new UnauthorizedException('Your session expired; sign in again');
    req.principal = session.user;
    req.sessionId = session.id;
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(session.user.role))
      throw new ForbiddenException(
        'You do not have permission for this action',
      );
    return true;
  }
}
