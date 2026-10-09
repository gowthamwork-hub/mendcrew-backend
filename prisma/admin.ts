import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../src/auth/security.js';
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const input = z
  .object({
    ADMIN_EMAIL: z.email().transform((s) => s.toLowerCase()),
    ADMIN_PASSWORD: z.string().min(12).max(128),
    ADMIN_NAME: z.string().trim().min(2).max(100),
  })
  .safeParse(process.env);
if (!input.success)
  throw new Error(
    'Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (12+ characters) locally before provisioning an administrator',
  );
const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({
    where: { email: input.data.ADMIN_EMAIL },
  });
  if (existing && existing.role !== 'ADMIN')
    throw new Error('Email already belongs to another account');
  await prisma.user.upsert({
    where: { email: input.data.ADMIN_EMAIL },
    create: {
      name: input.data.ADMIN_NAME,
      email: input.data.ADMIN_EMAIL,
      role: 'ADMIN',
      passwordHash: hashPassword(input.data.ADMIN_PASSWORD),
    },
    update: {
      name: input.data.ADMIN_NAME,
      active: true,
      passwordHash: hashPassword(input.data.ADMIN_PASSWORD),
    },
  });
  if (existing)
    await prisma.session.deleteMany({ where: { userId: existing.id } });
  console.log(
    'Administrator provisioned. Keep the password private and remove ADMIN_PASSWORD from your shell/environment after use.',
  );
} finally {
  await prisma.$disconnect();
}
