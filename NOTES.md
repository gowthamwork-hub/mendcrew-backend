# MendCrew Backend — Run Notes

## Project Overview

MendCrew Backend is a REST API built with NestJS, TypeScript, Prisma ORM, and PostgreSQL.

It powers the MendCrew home-services platform, initially serving Nagercoil and Suchindram, Tamil Nadu.

## Technology Stack

- Node.js
- NestJS
- TypeScript
- Prisma ORM 6
- PostgreSQL 16
- Docker Compose

## 1. Start PostgreSQL

From the backend project directory containing `docker-compose.yml`:

```cmd
docker compose up -d
```

Check the container:

```cmd
docker compose ps
```

## 2. Configure Environment

Create `.env` in the backend root.

For the existing local development database:

```env
DATABASE_URL="postgresql://mendcrew:mendcrew_dev@localhost:5432/mendcrew?schema=public"
```

These are development-only credentials. Never use them in production or commit `.env` to GitHub.

## 3. Install Dependencies

```cmd
npm install
```

## 4. Generate Prisma Client

```cmd
npx prisma generate
```

## 5. Apply Database Migrations

```cmd
npx prisma migrate deploy
```

Use existing committed migrations. Do not reset the database.

## 6. Start Backend API

```cmd
npm run start:dev
```

Expected API URL:

`http://localhost:3000`

## 7. Test API Endpoints

### Get Services

```http
GET http://localhost:3000/services
```

Expected: List of six seeded services, provided the database has been seeded.

### Create Booking

```http
POST http://localhost:3000/bookings
Content-Type: application/json
```

Example request:

```json
{
  "serviceId": "REPLACE_WITH_ACTUAL_SERVICE_ID",
  "customerName": "Test Customer",
  "phone": "9876543210",
  "address": "Nagercoil, Tamil Nadu",
  "description": "Test service request",
  "preferredDate": "2026-12-15T10:30:00+05:30"
}
```

### Get Booking

```http
GET http://localhost:3000/bookings/BOOKING_ID
```

Note: This endpoint must be protected by authentication and ownership checks before production use.

## 8. Prisma Studio

```cmd
npx prisma studio
```

Inspect Service and Booking records.

## 9. Useful Commands

```cmd
npm run build
npx prisma validate
npx prisma migrate status
docker compose logs
docker compose down
```

`docker compose down` stops and removes Compose-managed containers and networks, but does not remove named database volumes unless `-v` is used.

## 10. Mobile App Connection

The Expo app uses:

```env
EXPO_PUBLIC_API_URL=http://YOUR_PC_LAN_IP:3000
```

Use the computer's current LAN IP when testing on a physical Android phone.

Do not append `/services` to the base URL.

## Important Notes

- Keep PostgreSQL running before starting the API.
- Never commit `.env` files or credentials.
- Keep Prisma migrations in Git.
- Avoid destructive database resets.
- Do not expose customer booking information through public endpoints.
- Admin and technician APIs require authentication and authorization before production deployment.

---

**MendCrew — Local Service. Lasting Care.**