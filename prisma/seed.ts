/**
 * Prisma seed script.
 * Run with: npm run prisma:seed
 *
 * Creates:
 *  - Default platform settings (listing fees, penalty multiplier, fee toggle).
 *  - The SUPER_ADMIN account, from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
 *    environment variables (never hardcoded).
 *
 * No demo users/listings — accounts start fresh under the password-auth model.
 * Safe to re-run: settings upsert; the super admin is only created if absent.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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

  // -------------------------------------------------------------------------
  // Super Admin — seeded from environment variables, never hardcoded.
  // Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in the environment before
  // running the seed. The password is bcrypt-hashed here; the plaintext is
  // never stored. Re-running updates nothing if the account already exists.
  // -------------------------------------------------------------------------
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (!superEmail || !superPassword) {
    console.warn(
      'SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping super admin creation. ' +
        'Set them and re-run to create the super admin account.',
    );
  } else {
    const existing = await prisma.user.findUnique({ where: { email: superEmail } });
    if (existing) {
      console.log('Super admin already exists — leaving it untouched.');
    } else {
      const passwordHash = await bcrypt.hash(superPassword, 10);
      await prisma.user.create({
        data: {
          email: superEmail,
          firstName: 'Super',
          lastName: 'Admin',
          name: 'Super Admin',
          passwordHash,
          role: UserRole.SUPER_ADMIN,
          emailVerified: true,
        },
      });
      console.log('Super admin created:', superEmail);
    }
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
