import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, type Principal, Roles } from '../auth/auth.guard.js';
import { DtoPipe } from '../common/validation.js';
import { bookingDto, BookingsService, listDto } from './bookings.service.js';
@Controller('bookings')
@Roles('CUSTOMER')
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}
  @Post() create(
    @Body(new DtoPipe(bookingDto)) input: z.infer<typeof bookingDto>,
    @Actor() actor: Principal,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.create(input, actor, key);
  }
  @Get() list(
    @Actor() actor: Principal,
    @Query(new DtoPipe(listDto)) input: z.infer<typeof listDto>,
  ) {
    return this.bookings.list(actor, input);
  }
  @Get(':id') find(@Param('id') id: string, @Actor() actor: Principal) {
    return this.bookings.find(id, actor);
  }
  @Patch(':id/cancel') cancel(
    @Param('id') id: string,
    @Actor() actor: Principal,
  ) {
    return this.bookings.transition(id, 'CANCELLED', actor);
  }
}
