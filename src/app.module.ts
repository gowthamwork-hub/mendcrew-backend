import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService, HttpOtpProvider } from './auth/auth.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { readConfig } from './config.js';
import { ServicesController } from './services/services.controller.js';
import { BookingsController } from './bookings/bookings.controller.js';
import { BookingsService } from './bookings/bookings.service.js';
import {
  AdminController,
  TechnicianController,
} from './staff/staff.controller.js';
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [
    AuthController,
    ServicesController,
    BookingsController,
    AdminController,
    TechnicianController,
  ],
  providers: [
    { provide: 'PILOT_CONFIG', useFactory: readConfig },
    AuthService,
    HttpOtpProvider,
    BookingsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
