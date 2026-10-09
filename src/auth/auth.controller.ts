import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DtoPipe, indianPhone, nameField } from '../common/validation.js';
import { AuthService, safeUser } from './auth.service.js';
import {
  Actor,
  type AuthedRequest,
  type Principal,
  Public,
} from './auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PilotConfig } from '../config.js';

const customerDto = z.object({ phone: indianPhone, name: nameField }).strict();
const verifyDto = customerDto.extend({ code: z.string().regex(/^\d{4,8}$/) });
const passwordDto = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('PILOT_CONFIG') private readonly config: PilotConfig,
  ) {}
  @Public()
  @Get('config')
  configInfo() {
    return {
      mode: this.config.AUTH_MODE,
      otpConfigured:
        !!this.config.OTP_PROVIDER_URL && !!this.config.OTP_PROVIDER_TOKEN,
    };
  }
  @Public()
  @Post('development')
  async development(
    @Body(new DtoPipe(customerDto)) input: z.infer<typeof customerDto>,
  ) {
    if (
      this.config.NODE_ENV === 'production' ||
      this.config.AUTH_MODE !== 'development'
    )
      throw new ForbiddenException('Development authentication is disabled');
    return this.auth.session(await this.auth.customer(input.phone, input.name));
  }
  @Public()
  @Post('otp/request')
  async requestOtp(
    @Body(new DtoPipe(z.object({ phone: indianPhone }).strict()))
    input: {
      phone: string;
    },
  ) {
    if (this.config.AUTH_MODE !== 'otp')
      throw new ForbiddenException('OTP authentication is not enabled');
    await this.auth.otp.request(input.phone);
    return { message: 'Verification code requested' };
  }
  @Public()
  @Post('otp/verify')
  async verifyOtp(
    @Body(new DtoPipe(verifyDto)) input: z.infer<typeof verifyDto>,
  ) {
    if (
      this.config.AUTH_MODE !== 'otp' ||
      !(await this.auth.otp.verify(input.phone, input.code))
    )
      throw new UnauthorizedException('Invalid or expired code');
    return this.auth.session(await this.auth.customer(input.phone, input.name));
  }
  private setCookie(
    response: Response,
    session: Awaited<ReturnType<AuthService['session']>>,
  ) {
    response.cookie('mendcrew_session', session.token, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(session.expiresAt),
    });
    return { user: session.user, expiresAt: session.expiresAt };
  }
  @Public()
  @Post('admin/login')
  async adminLogin(
    @Body(new DtoPipe(passwordDto)) input: z.infer<typeof passwordDto>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setCookie(
      response,
      await this.auth.passwordLogin(input.identifier, input.password, 'ADMIN'),
    );
  }
  @Public()
  @Post('technician/login')
  async technicianLogin(
    @Body(new DtoPipe(passwordDto)) input: z.infer<typeof passwordDto>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setCookie(
      response,
      await this.auth.passwordLogin(
        input.identifier,
        input.password,
        'TECHNICIAN',
      ),
    );
  }
  @Get('me') me(@Actor() actor: Principal) {
    return safeUser(actor);
  }
  @Post('logout')
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.prisma.session.deleteMany({ where: { id: req.sessionId } });
    response.clearCookie('mendcrew_session', {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { message: 'Signed out' };
  }
}
