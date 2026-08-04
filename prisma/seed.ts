/**
 * Prisma seed script.
 * Run with: npm run prisma:seed
 *
 * Creates:
 *  - Default platform settings (listing fees, penalty multiplier) so the
 *    Admin Panel has real values to display/edit from day one.
 *  - One ADMIN user, one AGENT (verified), one OWNER, and one BUYER_RENTER.
 *  - A couple of sample listings in different statuses.
 *
 * Safe to re-run: uses upsert wherever a natural unique key exists.
 */
import { PrismaClient, UserRole, VerificationStatus, PropertyType, ListingType, ListingStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding platform settings...');
  await prisma.platformSetting.upsert({
    where: { key: 'LISTING_FEE_ENABLED' },
    update: {},
    create: {
      key: 'LISTING_FEE_ENABLED',
      value: 'false',
      description:
        'Master switch for listing fees. "false" = listings are free and skip the payment step (admin review still applies). Set to "true" when the free launch period ends.',
    },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'OWNER_LISTING_FEE_ETB' },
    update: {},
    create: {
      key: 'OWNER_LISTING_FEE_ETB',
      value: process.env.DEFAULT_OWNER_LISTING_FEE_ETB ?? '250',
      description: 'Flat fee (ETB) an individual Owner pays before a listing goes live.',
    },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'AGENT_LISTING_FEE_ETB' },
    update: {},
    create: {
      key: 'AGENT_LISTING_FEE_ETB',
      value: process.env.DEFAULT_AGENT_LISTING_FEE_ETB ?? '250',
      description: 'Flat fee (ETB) an Agent pays per listing in Phase 1 (pre-subscription).',
    },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'PENALTY_MULTIPLIER' },
    update: {},
    create: {
      key: 'PENALTY_MULTIPLIER',
      value: process.env.DEFAULT_PENALTY_MULTIPLIER ?? '1.5',
      description: 'Multiplier applied to the next listing fee for repeat inactivity offenders.',
    },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'LISTING_INACTIVITY_DAYS' },
    update: {},
    create: {
      key: 'LISTING_INACTIVITY_DAYS',
      value: process.env.LISTING_INACTIVITY_DAYS ?? '30',
      description: 'Days a listing can stay live without renewal before it is auto-unpublished.',
    },
  });

  console.log('Seeding demo users...');
  const admin = await prisma.user.upsert({
    where: { phone: '+251900000001' },
    update: {},
    create: {
      phone: '+251900000001',
      name: 'Koreb Admin',
      role: UserRole.ADMIN,
    },
  });

  const agent = await prisma.user.upsert({
    where: { phone: '+251911234567' },
    update: {},
    create: {
      phone: '+251911234567',
      name: 'Selam Tesfaye',
      role: UserRole.AGENT,
      agencyName: 'Habesha Realty',
      city: 'Addis Ababa',
      publicContactPhone: '+251911777888', // business line shown on listings
      verificationStatus: VerificationStatus.APPROVED,
      verifiedAt: new Date(),
      verifiedByAdminId: admin.id,
    },
  });

  const owner = await prisma.user.upsert({
    where: { phone: '+251922345678' },
    update: {},
    create: {
      phone: '+251922345678',
      name: 'Dawit Alemu',
      role: UserRole.OWNER,
      city: 'Addis Ababa',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+251933456789' },
    update: {},
    create: {
      phone: '+251933456789',
      name: 'Marta Bekele',
      role: UserRole.BUYER_RENTER,
      city: 'Addis Ababa',
    },
  });

  console.log('Seeding demo listings...');
  const existingListing = await prisma.listing.findFirst({
    where: { ownerId: agent.id, city: 'Addis Ababa', subCity: 'Bole' },
  });

  if (!existingListing) {
    await prisma.listing.create({
      data: {
        ownerId: agent.id,
        propertyType: PropertyType.APARTMENT,
        listingType: ListingType.RENT,
        priceEtb: 28000,
        region: 'Addis Ababa',
        city: 'Addis Ababa',
        subCity: 'Bole',
        areaName: 'Near Edna Mall',
        latitude: 8.9954,
        longitude: 38.7894,
        bedrooms: 3,
        bathrooms: 2,
        sizeSqm: 180,
        buildingName: 'Zefmesh Grand',
        unitNumber: '4B',
        floorNumber: 2,
        furnished: true,
        amenities: ['parking', 'water_tank', 'generator', 'security'],
        descriptionEn: 'Bright, well-ventilated apartment on a quiet compound close to Edna Mall.',
        status: ListingStatus.LIVE,
        publishedAt: new Date(),
      },
    });

    await prisma.listing.create({
      data: {
        ownerId: owner.id,
        propertyType: PropertyType.COMMERCIAL,
        listingType: ListingType.RENT,
        priceEtb: 45000,
        region: 'Addis Ababa',
        city: 'Addis Ababa',
        subCity: 'Kazanchis',
        sizeSqm: 310,
        descriptionEn: 'Furnished office space in Kazanchis.',
        status: ListingStatus.AWAITING_REVIEW,
      },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
