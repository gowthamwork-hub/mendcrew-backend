import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type PilotConfig, serviceAreas } from '../config.js';
@Controller()
@Public()
export class ServicesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('PILOT_CONFIG') private readonly config: PilotConfig,
  ) {}
  @Get('services') list() {
    return this.prisma.service.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }
  @Get('policy') policy() {
    return {
      serviceAreas,
      timeZone: 'Asia/Kolkata',
      workingHourStart: this.config.WORKING_HOUR_START ?? null,
      workingHourEnd: this.config.WORKING_HOUR_END ?? null,
      bookingLeadMinutes: this.config.BOOKING_LEAD_MINUTES,
      cancellationLeadMinutes: this.config.CANCELLATION_LEAD_MINUTES,
      supportContact: this.config.SUPPORT_CONTACT ?? null,
      confirmed: this.config.PILOT_RULES_CONFIRMED === 'true',
      estimateMessage:
        'Appointment requests are subject to confirmation. An estimate will be agreed before work begins.',
    };
  }
  @Get('health') async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
