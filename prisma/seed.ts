import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const services = [
    {
      id: 'electrician',
      name: 'Electrician',
      icon: 'flash',
      description: 'Wiring, switches, lights and electrical repairs',
    },
    {
      id: 'plumber',
      name: 'Plumber',
      icon: 'water',
      description: 'Pipe leaks, taps, fittings and plumbing repairs',
    },
    {
      id: 'ac-repair',
      name: 'AC Repair',
      icon: 'snow',
      description: 'AC installation, servicing and repairs',
    },
    {
      id: 'washing-machine',
      name: 'Washing Machine Repair',
      icon: 'settings',
      description: 'Washing machine servicing and repairs',
    },
    {
      id: 'refrigerator',
      name: 'Refrigerator Repair',
      icon: 'thermometer',
      description: 'Fridge cooling issues and repairs',
    },
    {
      id: 'home-cleaning',
      name: 'Home Cleaning',
      icon: 'home',
      description: 'House and apartment cleaning',
    },
  ];

  for (const service of services) {
    await prisma.service.upsert({
      where: { id: service.id },
      update: {},
      create: {
        ...service,
        active: true,
      },
    });
  }

  console.log('MendCrew services seeded successfully');
}

main()
  .catch(() => {
    console.error('Service seed failed; check the database configuration');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
