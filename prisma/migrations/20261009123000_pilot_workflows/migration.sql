BEGIN;
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'ADMIN', 'TECHNICIAN');
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED');
-- Casting preserves existing statuses and fails safely for unrecognised legacy values.
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus" USING "status"::"BookingStatus";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "Booking" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "customerId" TEXT, ADD COLUMN "technicianId" TEXT,
  ADD COLUMN "serviceArea" TEXT, ADD COLUMN "idempotencyKey" TEXT, ADD COLUMN "requestHash" TEXT;
CREATE TABLE "User" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT, "email" TEXT,
 "passwordHash" TEXT, "role" "Role" NOT NULL DEFAULT 'CUSTOMER', "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "Session" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "Technician" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE,
 "active" BOOLEAN NOT NULL DEFAULT true, "available" BOOLEAN NOT NULL DEFAULT true, "serviceAreas" TEXT[] NOT NULL
);
CREATE UNIQUE INDEX "Technician_userId_key" ON "Technician"("userId");
CREATE TABLE "TechnicianService" (
 "technicianId" TEXT NOT NULL REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "serviceId" TEXT NOT NULL REFERENCES "Service"("id") ON UPDATE CASCADE,
 PRIMARY KEY ("technicianId", "serviceId")
);
CREATE INDEX "TechnicianService_serviceId_idx" ON "TechnicianService"("serviceId");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Booking_customerId_idempotencyKey_key" ON "Booking"("customerId", "idempotencyKey");
CREATE INDEX "Booking_customerId_createdAt_idx" ON "Booking"("customerId", "createdAt");
CREATE INDEX "Booking_technicianId_status_idx" ON "Booking"("technicianId", "status");
CREATE INDEX "Booking_status_createdAt_idx" ON "Booking"("status", "createdAt");
CREATE INDEX "Booking_preferredDate_idx" ON "Booking"("preferredDate");
CREATE TABLE "BookingEvent" (
 "id" TEXT PRIMARY KEY, "bookingId" TEXT NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE,
 "fromStatus" "BookingStatus", "toStatus" "BookingStatus" NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");
ALTER TABLE "Booking" ALTER COLUMN "updatedAt" DROP DEFAULT;
COMMIT;
