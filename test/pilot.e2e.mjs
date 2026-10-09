// Runs against unique fixtures in a migrated development/test database. Never resets data.
import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
if (process.env.NODE_ENV === 'production') throw new Error('Run integration tests against a development/test database, never production');
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.AUTH_MODE = 'development';
const { AppModule } = await import('../dist/app.module.js');
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const { AuthService } = await import('../dist/auth/auth.service.js');
const { configureApp } = await import('../dist/configure-app.js');
const { hashPassword } = await import('../dist/auth/security.js');
const { readConfig } = await import('../dist/config.js');
let app,
  prisma,
  http,
  auth,
  customer,
  other,
  admin,
  technician,
  technician2,
  booking,
  service,
  techId;
const users = [];
const suffix = randomUUID();
const password = `Test-${suffix}`;
const actor = async (role, phone, tech = false) => {
  const user = await prisma.user.create({
    data: {
      name: `Test ${suffix}`,
      role,
      ...(phone ? { phone } : { email: `${randomUUID()}@example.invalid` }),
      ...(role !== 'CUSTOMER' ? { passwordHash: hashPassword(password) } : {}),
      ...(tech
        ? {
            technician: {
              create: {
                serviceAreas: ['Nagercoil'],
                available: true,
                services: { create: { serviceId: service.id } },
              },
            },
          }
        : {}),
    },
    include: { technician: true },
  });
  users.push(user.id);
  return { user, token: (await auth.session(user)).token };
};
const withAuth = (method, path, who) =>
  request(http)[method](path).set('Authorization', `Bearer ${who.token}`);
before(
  async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    http = app.getHttpServer();
    service = await prisma.service.create({
      data: {
        id: `test-${suffix}`,
        name: 'Test service',
        icon: 'home',
        description: 'Integration fixture',
      },
    });
    // Generated valid-format numbers, checked for collision before inserting.
    const number = async () => {
      for (;;) {
        const phone = `9${Math.floor(Math.random() * 1e9)
          .toString()
          .padStart(9, '0')}`;
        if (!(await prisma.user.findUnique({ where: { phone } }))) return phone;
      }
    };
    customer = await actor('CUSTOMER', await number());
    other = await actor('CUSTOMER', await number());
    admin = await actor('ADMIN');
    technician = await actor('TECHNICIAN', await number(), true);
    technician2 = await actor('TECHNICIAN', await number(), true);
    techId = technician.user.technician.id;
  },
  { timeout: 30000 },
);
after(async () => {
  if (prisma && users.length) {
    await prisma.booking.deleteMany({ where: { customerId: { in: users } } });
    await prisma.technicianService.deleteMany({
      where: { technician: { userId: { in: users } } },
    });
    await prisma.technician.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  if (prisma && service)
    await prisma.service.delete({ where: { id: service.id } });
  if (app) await app.close();
});
const input = () => ({
  serviceId: service.id,
  customerName: 'Test Customer',
  phone: customer.user.phone,
  address: 'Test street, Nagercoil',
  description: 'Test fixture only',
  preferredDate: new Date(Date.now() + 86400000 * 7).toISOString(),
  serviceArea: 'Nagercoil',
});
void test('public catalogue and health; booking PII requires authentication', async () => {
  await request(http).get('/health').expect(200);
  await request(http).get('/services').expect(200);
  await request(http).get('/bookings').expect(401);
  await request(http).get(`/bookings/${suffix}`).expect(401);
  await withAuth('get', '/admin/bookings', customer).expect(403);
});
void test('validated creation persists once, retries are idempotent and body cannot set owner/status', async () => {
  const body = input();
  const key = `test_${suffix}`;
  await withAuth('post', '/bookings', customer)
    .set('Idempotency-Key', key)
    .send({ ...body, status: 'COMPLETED' })
    .expect(400);
  await withAuth('post', '/bookings', customer)
    .set('Idempotency-Key', key)
    .send({ ...body, phone: other.user.phone })
    .expect(400);
  const [a, b] = await Promise.all([
    withAuth('post', '/bookings', customer)
      .set('Idempotency-Key', key)
      .send(body),
    withAuth('post', '/bookings', customer)
      .set('Idempotency-Key', key)
      .send(body),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.id, b.body.id);
  booking = a.body;
  assert.equal(
    (await prisma.booking.findUnique({ where: { id: booking.id } })).customerId,
    customer.user.id,
  );
  assert.equal(
    await prisma.booking.count({ where: { customerId: customer.user.id } }),
    1,
  );
  await withAuth('post', '/bookings', customer)
    .set('Idempotency-Key', key)
    .send({ ...body, address: 'Different test address' })
    .expect(409);
});
void test('customer history is private, guessed UUID is insufficient; paging rejects excessive limits', async () => {
  const mine = await withAuth('get', '/bookings', customer).expect(200);
  assert.equal(mine.body.total, 1);
  const others = await withAuth('get', '/bookings', other).expect(200);
  assert.equal(others.body.total, 0);
  await withAuth('get', `/bookings/${booking.id}`, other).expect(404);
  await withAuth('get', '/bookings?limit=10000', customer).expect(400);
  await withAuth('get', `/technician/jobs/${booking.id}`, technician).expect(
    404,
  );
});
void test('admin confirms and assigns only eligible technicians; unauthorized progress is rejected', async () => {
  await withAuth('patch', `/admin/bookings/${booking.id}/status`, admin)
    .send({ status: 'COMPLETED' })
    .expect(409);
  await withAuth('patch', `/admin/bookings/${booking.id}/assign`, admin)
    .send({ technicianId: techId })
    .expect(409);
  await withAuth('patch', `/admin/bookings/${booking.id}/status`, admin)
    .send({ status: 'CONFIRMED' })
    .expect(200);
  await prisma.technician.update({
    where: { id: techId },
    data: { available: false },
  });
  await withAuth('patch', `/admin/bookings/${booking.id}/assign`, admin)
    .send({ technicianId: techId })
    .expect(400);
  await prisma.technician.update({
    where: { id: techId },
    data: { available: true },
  });
  await withAuth('patch', `/admin/bookings/${booking.id}/assign`, admin)
    .send({ technicianId: techId })
    .expect(200);
  await withAuth('get', `/technician/jobs/${booking.id}`, technician2).expect(
    404,
  );
  const jobs = await withAuth('get', '/technician/jobs', technician).expect(
    200,
  );
  assert.equal(jobs.body.total, 1);
  await withAuth('patch', `/technician/jobs/${booking.id}/status`, technician)
    .send({ status: 'CANCELLED' })
    .expect(409);
  await withAuth('patch', `/technician/jobs/${booking.id}/status`, technician)
    .send({ status: 'IN_PROGRESS' })
    .expect(200);
  await withAuth('patch', `/bookings/${booking.id}/cancel`, customer).expect(
    409,
  );
  await withAuth('patch', `/technician/jobs/${booking.id}/status`, technician)
    .send({ status: 'COMPLETED' })
    .expect(200);
  await withAuth('patch', `/admin/bookings/${booking.id}/status`, admin)
    .send({ status: 'PENDING' })
    .expect(409);
  assert.equal(
    await prisma.bookingEvent.count({ where: { bookingId: booking.id } }),
    5,
  );
});
void test('customer cancellation and rejection retain records', async () => {
  const b = (
    await withAuth('post', '/bookings', customer)
      .set('Idempotency-Key', `cancel_${suffix}`)
      .send(input())
      .expect(201)
  ).body;
  await withAuth('patch', `/bookings/${b.id}/cancel`, customer).expect(200);
  assert.equal(
    (await prisma.booking.findUnique({ where: { id: b.id } })).status,
    'CANCELLED',
  );
  const c = (
    await withAuth('post', '/bookings', customer)
      .set('Idempotency-Key', `reject_${suffix}`)
      .send(input())
      .expect(201)
  ).body;
  await withAuth('patch', `/admin/bookings/${c.id}/status`, admin)
    .send({ status: 'REJECTED' })
    .expect(200);
});
void test('staff login uses HttpOnly cookie, CSRF origin is checked, hashes are never returned', async () => {
  const login = await request(http)
    .post('/auth/admin/login')
    .set('Origin', 'http://localhost:5173')
    .send({ identifier: admin.user.email, password })
    .expect(201);
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(login.body.token, undefined);
  assert.equal(login.body.user.passwordHash, undefined);
  await request(http)
    .post('/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', 'https://attacker.invalid')
    .expect(403);
  await request(http)
    .post('/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:5173')
    .expect(201);
  await request(http).get('/admin/bookings').set('Cookie', cookie).expect(401);
});
void test('production refuses development auth; session revocation is enforced', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.throws(readConfig, /Production requires/);
  process.env.NODE_ENV = previous;
  await prisma.session.updateMany({
    where: { userId: other.user.id },
    data: { expiresAt: new Date(0) },
  });
  await withAuth('get', '/bookings', other).expect(401);
});
void test('technician assignment is atomic when two requests compete for the same preferred time', async () => {
  const body=input(); const ids=[];
  for(const key of ['slot_a','slot_b']) {
    const response=await withAuth('post','/bookings',customer).set('Idempotency-Key',`${key}_${suffix}`).send(body).expect(201);ids.push(response.body.id);
    await withAuth('patch',`/admin/bookings/${response.body.id}/status`,admin).send({status:'CONFIRMED'}).expect(200);
  }
  const responses=await Promise.all(ids.map(id=>withAuth('patch',`/admin/bookings/${id}/assign`,admin).send({technicianId:techId})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(await prisma.booking.count({where:{id:{in:ids},status:'ASSIGNED'}}),1);
});
void test('admin changes service visibility and deactivates technician access', async () => {
  await withAuth('patch',`/admin/services/${service.id}`,customer).send({active:false}).expect(403);
  await withAuth('patch',`/admin/services/${service.id}`,admin).send({active:false}).expect(200);
  const catalog=await request(http).get('/services').expect(200);assert.equal(catalog.body.some(s=>s.id===service.id),false);
  await withAuth('post','/bookings',customer).set('Idempotency-Key',`inactive_${suffix}`).send(input()).expect(400);
  await withAuth('patch',`/admin/services/${service.id}`,admin).send({active:true}).expect(200);
  const update=await withAuth('patch',`/admin/technicians/${technician2.user.technician.id}`,admin).send({active:false}).expect(200);
  assert.equal(update.body.user.passwordHash,undefined);
  await withAuth('get','/technician/jobs',technician2).expect(401);
});
void test('configured India working hours, booking notice and cancellation cutoff are enforced', async () => {
  const config = app.get('PILOT_CONFIG');
  const old = {
    BOOKING_LEAD_MINUTES: config.BOOKING_LEAD_MINUTES,
    CANCELLATION_LEAD_MINUTES: config.CANCELLATION_LEAD_MINUTES,
    WORKING_HOUR_START: config.WORKING_HOUR_START,
    WORKING_HOUR_END: config.WORKING_HOUR_END,
  };
  try {
    Object.assign(config, { BOOKING_LEAD_MINUTES: 60, CANCELLATION_LEAD_MINUTES: 120, WORKING_HOUR_START: 9, WORKING_HOUR_END: 18 });
    const tooSoon = await withAuth('post', '/bookings', customer)
      .set('Idempotency-Key', `notice_${suffix}`)
      .send({ ...input(), preferredDate: new Date(Date.now() + 30 * 60000).toISOString() }).expect(400);
    assert.match(tooSoon.body.message, /60 minutes notice/);
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    for (const time of ['03:29:00', '12:30:00']) {
      const closed = await withAuth('post', '/bookings', customer)
        .set('Idempotency-Key', `closed_${time.replaceAll(':', '')}_${suffix}`)
        .send({ ...input(), preferredDate: `${day}T${time}.000Z` }).expect(400);
      assert.match(closed.body.message, /working hours/);
    }
    const ids = [];
    for (const time of ['03:30:00', '12:29:00']) {
      const opened = await withAuth('post', '/bookings', customer)
        .set('Idempotency-Key', `open_${time.replaceAll(':', '')}_${suffix}`)
        .send({ ...input(), preferredDate: `${day}T${time}.000Z` }).expect(201);
      ids.push(opened.body.id);
    }
    await prisma.booking.update({ where: { id: ids[0] }, data: { preferredDate: new Date(Date.now() + 119 * 60000) } });
    await withAuth('patch', `/bookings/${ids[0]}/cancel`, customer).expect(409);
    assert.equal((await prisma.booking.findUnique({ where: { id: ids[0] } })).status, 'PENDING');
    await prisma.booking.update({ where: { id: ids[1] }, data: { preferredDate: new Date(Date.now() + 121 * 60000) } });
    await withAuth('patch', `/bookings/${ids[1]}/cancel`, customer).expect(200);
    assert.equal((await prisma.booking.findUnique({ where: { id: ids[1] } })).status, 'CANCELLED');
  } finally {
    Object.assign(config, old);
  }
});
void test('missing OTP adapter fails closed, without falling back to development authentication', async () => {
  const config=app.get('PILOT_CONFIG');const old={mode:config.AUTH_MODE,url:config.OTP_PROVIDER_URL,token:config.OTP_PROVIDER_TOKEN};
  try {config.AUTH_MODE='otp';config.OTP_PROVIDER_URL=undefined;config.OTP_PROVIDER_TOKEN=undefined;
    await request(http).post('/auth/development').send({phone:customer.user.phone,name:'Test User'}).expect(403);
    await request(http).post('/auth/otp/request').send({phone:customer.user.phone}).expect(503);
    await request(http).post('/auth/otp/verify').send({phone:customer.user.phone,name:'Test User',code:'123456'}).expect(503);
  } finally {config.AUTH_MODE=old.mode;config.OTP_PROVIDER_URL=old.url;config.OTP_PROVIDER_TOKEN=old.token;}
});
