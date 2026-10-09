import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PilotConfig } from '../config.js';
import { tokenHash, verifyPassword } from './security.js';

export const safeUser = (
  user: Pick<User, 'id' | 'name' | 'phone' | 'email' | 'role'>,
) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  email: user.email,
  role: user.role,
});

export interface OtpProvider {
  request(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<boolean>;
}

// Adapter contract: POST /request {phone}, POST /verify {phone,code} -> {verified:boolean}.
@Injectable()
export class HttpOtpProvider implements OtpProvider {
  constructor(@Inject('PILOT_CONFIG') private readonly config: PilotConfig) {}
  private async call(path: string, input: object) {
    if (!this.config.OTP_PROVIDER_URL || !this.config.OTP_PROVIDER_TOKEN)
      throw new ServiceUnavailableException(
        'Phone verification is not configured',
      );
    try {
      const response = await fetch(
        `${this.config.OTP_PROVIDER_URL.replace(/\/$/, '')}/${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.OTP_PROVIDER_TOKEN}`,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error('ProviderFailure');
      return path === 'verify'
        ? ((await response.json()) as { verified?: boolean })
        : null;
    } catch {
      throw new ServiceUnavailableException(
        'Phone verification is temporarily unavailable',
      );
    }
  }
  async request(phone: string) {
    await this.call('request', { phone: `+91${phone}` });
  }
  async verify(phone: string, code: string) {
    return (
      (await this.call('verify', { phone: `+91${phone}`, code }))?.verified ===
      true
    );
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('PILOT_CONFIG') private readonly config: PilotConfig,
    @Inject(HttpOtpProvider) readonly otp: HttpOtpProvider,
  ) {}
  async customer(phone: string, name: string) {
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, name, role: Role.CUSTOMER },
    });
    // Staff may be provisioned concurrently; check the returned record before issuing a customer session.
    if (user.role !== Role.CUSTOMER || !user.active)
      throw new UnauthorizedException('This account is unavailable');
    return this.prisma.user.update({ where: { id: user.id, role: Role.CUSTOMER, active: true }, data: { name } });
  }
  async session(user: User) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.SESSION_HOURS * 3600000,
    );
    await this.prisma.session.create({
      data: { tokenHash: tokenHash(token), userId: user.id, expiresAt },
    });
    return { token, expiresAt: expiresAt.toISOString(), user: safeUser(user) };
  }
  async passwordLogin(
    identifier: string,
    password: string,
    role: 'ADMIN' | 'TECHNICIAN',
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        role,
        OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
      },
      include: { technician: true },
    });
    // A dummy hash keeps missing-account work comparable to invalid-password work.
    const valid = verifyPassword(
      password,
      user?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`,
    );
    if (
      !valid ||
      !user?.active ||
      (role === 'TECHNICIAN' && !user.technician?.active)
    )
      throw new UnauthorizedException('Invalid sign-in details');
    return this.session(user);
  }
}
