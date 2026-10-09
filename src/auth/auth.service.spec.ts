import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';
import { AuthService, HttpOtpProvider } from './auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PilotConfig } from '../config.js';
describe('Customer authentication role boundary', () => {
  it.each([{ role: Role.ADMIN, active: true }, { role: Role.TECHNICIAN, active: true }, { role: Role.CUSTOMER, active: false }])('does not authenticate a concurrently created $role account (active=$active)', async user => {
    const update = vi.fn();
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'concurrent-account', ...user }), update } } as unknown as PrismaService;
    const config = { SESSION_HOURS: 24 } as PilotConfig;
    const auth = new AuthService(prisma, config, new HttpOtpProvider(config));
    await expect(auth.customer('9876543210', 'Customer')).rejects.toThrow('This account is unavailable');
    expect(update).not.toHaveBeenCalled();
  });
});
