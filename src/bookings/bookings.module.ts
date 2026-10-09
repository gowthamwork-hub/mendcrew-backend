import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller.js';
@Module({ controllers: [BookingsController] })
export class BookingsModule {}
