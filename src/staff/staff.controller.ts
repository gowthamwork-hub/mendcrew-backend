import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, type Principal, Roles } from '../auth/auth.guard.js';
import {
  DtoPipe,
  indianPhone,
  nameField,
  passwordField,
  paginationSchema,
} from '../common/validation.js';
import { serviceAreas } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/security.js';
import {
  BookingsService,
  listDto,
  statusDto,
} from '../bookings/bookings.service.js';

const serviceDto = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,100}$/),
    name: nameField,
    icon: z.string().min(1).max(100),
    description: z.string().trim().min(5).max(1000),
    active: z.boolean().default(true),
  })
  .strict();
const technicianDto = z
  .object({
    name: nameField,
    phone: indianPhone,
    password: passwordField,
    serviceIds: z.array(z.string().min(1).max(100)).min(1).max(20),
    serviceAreas: z.array(z.enum(serviceAreas)).min(1).max(2),
    active: z.boolean().default(true),
    available: z.boolean().default(true),
  })
  .strict();
const technicianPatch = technicianDto.partial();
const techInclude = {
  user: { select: { id: true, name: true, phone: true } },
  services: { include: { service: true } },
};

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}
  @Get('bookings') list(
    @Actor() actor: Principal,
    @Query(new DtoPipe(listDto)) input: z.infer<typeof listDto>,
  ) {
    return this.bookings.list(actor, input);
  }
  @Get('bookings/:id') find(
    @Param('id') id: string,
    @Actor() actor: Principal,
  ) {
    return this.bookings.find(id, actor);
  }
  @Patch('bookings/:id/status') status(
    @Param('id') id: string,
    @Body(new DtoPipe(statusDto)) input: z.infer<typeof statusDto>,
    @Actor() actor: Principal,
  ) {
    return this.bookings.transition(id, input.status, actor);
  }
  @Patch('bookings/:id/assign') assign(
    @Param('id') id: string,
    @Body(new DtoPipe(z.object({ technicianId: z.uuid() }).strict()))
    input: { technicianId: string },
    @Actor() actor: Principal,
  ) {
    return this.bookings.transition(id, 'ASSIGNED', actor, input.technicianId);
  }
  @Patch('bookings/:id/area') area(
    @Param('id') id: string,
    @Body(new DtoPipe(z.object({ serviceArea: z.enum(serviceAreas) }).strict()))
    input: { serviceArea: string },
  ) {
    return this.bookings.setArea(id, input.serviceArea);
  }
  @Get('services') services() {
    return this.prisma.service.findMany({ orderBy: { name: 'asc' } });
  }
  @Post('services') createService(
    @Body(new DtoPipe(serviceDto)) input: z.infer<typeof serviceDto>,
  ) {
    return this.prisma.service.create({ data: input });
  }
  @Patch('services/:id') updateService(
    @Param('id') id: string,
    @Body(new DtoPipe(serviceDto.omit({ id: true }).partial()))
    input: Partial<Omit<z.infer<typeof serviceDto>, 'id'>>,
  ) {
    return this.prisma.service.update({ where: { id }, data: input });
  }
  @Get('technicians') async technicians(
    @Query(new DtoPipe(paginationSchema))
    input: z.infer<typeof paginationSchema>,
  ) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.technician.findMany({
        include: techInclude,
        orderBy: { id: 'asc' },
        take: input.limit,
        skip: (input.page - 1) * input.limit,
      }),
      this.prisma.technician.count(),
    ]);
    return { items, total, ...input };
  }
  @Post('technicians') createTechnician(
    @Body(new DtoPipe(technicianDto)) input: z.infer<typeof technicianDto>,
  ) {
    return this.prisma.technician.create({
      data: {
        active: input.active,
        available: input.available,
        serviceAreas: input.serviceAreas,
        user: {
          create: {
            name: input.name,
            phone: input.phone,
            role: 'TECHNICIAN',
            active: input.active,
            passwordHash: hashPassword(input.password),
          },
        },
        services: {
          create: [...new Set(input.serviceIds)].map((serviceId) => ({
            serviceId,
          })),
        },
      },
      include: techInclude,
    });
  }
  @Patch('technicians/:id') updateTechnician(
    @Param('id') id: string,
    @Body(new DtoPipe(technicianPatch)) input: z.infer<typeof technicianPatch>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.technician.findUniqueOrThrow({ where: { id } });
      await tx.user.update({
        where: { id: profile.userId },
        data: {
          name: input.name,
          phone: input.phone,
          active: input.active,
          ...(input.password
            ? { passwordHash: hashPassword(input.password) }
            : {}),
        },
      });
      if (input.password || input.active === false)
        await tx.session.deleteMany({ where: { userId: profile.userId } });
      if (input.serviceIds)
        await tx.technicianService.deleteMany({ where: { technicianId: id } });
      return tx.technician.update({
        where: { id },
        data: {
          active: input.active,
          available: input.available,
          serviceAreas: input.serviceAreas,
          ...(input.serviceIds
            ? {
                services: {
                  create: [...new Set(input.serviceIds)].map((serviceId) => ({
                    serviceId,
                  })),
                },
              }
            : {}),
        },
        include: techInclude,
      });
    });
  }
}
@Controller('technician')
@Roles('TECHNICIAN')
export class TechnicianController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}
  @Get('jobs') list(
    @Actor() actor: Principal,
    @Query(new DtoPipe(listDto)) input: z.infer<typeof listDto>,
  ) {
    return this.bookings.list(actor, input);
  }
  @Get('jobs/:id') find(@Param('id') id: string, @Actor() actor: Principal) {
    return this.bookings.find(id, actor);
  }
  @Patch('jobs/:id/status') status(
    @Param('id') id: string,
    @Body(new DtoPipe(statusDto)) input: z.infer<typeof statusDto>,
    @Actor() actor: Principal,
  ) {
    return this.bookings.transition(id, input.status, actor);
  }
}
