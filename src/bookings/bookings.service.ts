import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  indianPhone,
  nameField,
  paginationSchema,
} from '../common/validation.js';
import { type PilotConfig, serviceAreas } from '../config.js';
import type { Principal } from '../auth/auth.guard.js';
export const bookingDto = z
  .object({
    serviceId: z.string().min(1).max(100),
    customerName: nameField,
    phone: indianPhone,
    address: z.string().trim().min(10).max(1000),
    description: z.string().trim().max(2000).default(''),
    preferredDate: z.iso.datetime({ offset: true }),
    serviceArea: z.enum(serviceAreas),
  })
  .strict();
export const listDto = paginationSchema
  .extend({
    status: z.nativeEnum(BookingStatus).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export const statusDto = z
  .object({ status: z.nativeEnum(BookingStatus) })
  .strict();
const include = {
  service: true,
  technician: { select: { id: true, user: { select: { name: true } } } },
  history: {
    select: { fromStatus: true, toStatus: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
};
const next: Partial<Record<BookingStatus, BookingStatus[]>> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
};
@Injectable()
export class BookingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('PILOT_CONFIG') private readonly config: PilotConfig,
  ) {}
  scope(actor: Principal): Prisma.BookingWhereInput {
    if (actor.role === Role.ADMIN) return {};
    return actor.role === Role.TECHNICIAN
      ? { technicianId: actor.technician?.id ?? 'no-technician' }
      : { customerId: actor.id };
  }
  async find(id: string, actor: Principal) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, ...this.scope(actor) },
      include,
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
  async list(actor: Principal, input: z.infer<typeof listDto>) {
    const where: Prisma.BookingWhereInput = {
      ...this.scope(actor),
      status: input.status,
    };
    if (input.search)
      where.OR = ['id', 'customerName', 'phone', 'address'].map((field) => ({
        [field]: { contains: input.search, mode: 'insensitive' },
      }));
    const [items, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  async create(
    input: z.infer<typeof bookingDto>,
    actor: Principal,
    key?: string,
  ) {
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
      throw new BadRequestException(
        'A valid Idempotency-Key header is required',
      );
    if (input.phone !== actor.phone)
      throw new BadRequestException('Use your signed-in phone number');
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const where = {
      customerId_idempotencyKey: { customerId: actor.id, idempotencyKey: key },
    };
    const previous = await this.prisma.booking.findUnique({ where, include });
    if (previous) {
      if (previous.requestHash !== hash)
        throw new ConflictException(
          'Submission key already used for different details',
        );
      return previous;
    }
    const date = new Date(input.preferredDate);
    if (date.getTime() <= Date.now() + this.config.BOOKING_LEAD_MINUTES * 60000)
      throw new BadRequestException(
        `Choose a future time with at least ${this.config.BOOKING_LEAD_MINUTES} minutes notice`,
      );
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(date),
    );
    if (
      this.config.WORKING_HOUR_START !== undefined &&
      (hour < this.config.WORKING_HOUR_START ||
        hour >= this.config.WORKING_HOUR_END!)
    )
      throw new BadRequestException(
        'Choose a time within working hours (India time)',
      );
    if (
      !(await this.prisma.service.findFirst({
        where: { id: input.serviceId, active: true },
      }))
    )
      throw new BadRequestException('Service unavailable');
    try {
      return await this.prisma.booking.create({
        data: {
          ...input,
          preferredDate: date,
          customerId: actor.id,
          idempotencyKey: key,
          requestHash: hash,
          history: { create: { actorId: actor.id, toStatus: 'PENDING' } },
        },
        include,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const saved = await this.prisma.booking.findUnique({ where, include });
        if (saved?.requestHash === hash) return saved;
        throw new ConflictException('Submission key already used');
      }
      throw error;
    }
  }
  async transition(
    id: string,
    target: BookingStatus,
    actor: Principal,
    technicianId?: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const booking = await tx.booking.findFirst({
            where: { id, ...this.scope(actor) },
          });
          if (!booking) throw new NotFoundException('Booking not found');
          if (!next[booking.status]?.includes(target))
            throw new ConflictException('Status transition is not allowed');
          if (
            actor.role === Role.CUSTOMER &&
            (target !== 'CANCELLED' ||
              booking.status === 'IN_PROGRESS' ||
              booking.preferredDate.getTime() <=
                Date.now() + this.config.CANCELLATION_LEAD_MINUTES * 60000)
          )
            throw new ConflictException(
              'Contact support to cancel this booking',
            );
          if (
            actor.role === Role.TECHNICIAN &&
            !(
              (booking.status === 'ASSIGNED' && target === 'IN_PROGRESS') ||
              (booking.status === 'IN_PROGRESS' && target === 'COMPLETED')
            )
          )
            throw new ConflictException(
              'Technicians may only start and complete assigned work',
            );
          if (target === 'ASSIGNED') {
            if (actor.role !== Role.ADMIN || !technicianId)
              throw new BadRequestException(
                'Use the technician assignment action',
              );
            const technician = await tx.technician.findFirst({
              where: {
                id: technicianId,
                active: true,
                available: true,
                user: { active: true },
                serviceAreas: { has: booking.serviceArea ?? '' },
                services: { some: { serviceId: booking.serviceId } },
              },
            });
            if (!technician)
              throw new BadRequestException(
                'Technician is unavailable or does not cover this service and area',
              );
            if (
              await tx.booking.findFirst({
                where: {
                  technicianId,
                  status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
                  preferredDate: booking.preferredDate,
                },
              })
            )
              throw new ConflictException(
                'Technician already has a job at this requested time',
              );
          }
          if (
            target === 'IN_PROGRESS' &&
            (await tx.booking.findFirst({
              where: {
                technicianId: booking.technicianId,
                status: 'IN_PROGRESS',
                id: { not: id },
              },
            }))
          )
            throw new ConflictException(
              'Complete the technician’s current job first',
            );
          const changed = await tx.booking.updateMany({
            where: { id, status: booking.status },
            data: { status: target, ...(technicianId ? { technicianId } : {}) },
          });
          if (!changed.count)
            throw new ConflictException('Booking changed; refresh and retry');
          await tx.bookingEvent.create({
            data: {
              bookingId: id,
              actorId: actor.id,
              fromStatus: booking.status,
              toStatus: target,
            },
          });
          return tx.booking.findUniqueOrThrow({ where: { id }, include });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException('Booking changed; refresh and retry');
      throw error;
    }
  }
  async setArea(id: string, serviceArea: string) {
    const updated = await this.prisma.booking.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        technicianId: null,
      },
      data: { serviceArea },
    });
    if (!updated.count)
      throw new ConflictException(
        'Area can only be changed before technician assignment',
      );
    return this.prisma.booking.findUniqueOrThrow({ where: { id }, include });
  }
}
