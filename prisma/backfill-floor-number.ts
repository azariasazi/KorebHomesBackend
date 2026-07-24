/**
 * One-off backfill: legacy free-text `floor` -> structured `floorNumber`.
 *
 * Run AFTER the migration that adds `floorNumber`, and BEFORE the follow-up
 * migration that drops `floor`:
 *
 *     npx ts-node prisma/backfill-floor-number.ts
 *
 * Anything it can't confidently parse is left as null and printed at the end
 * for manual review — we'd rather leave a gap than guess wrong about which
 * floor a property is on.
 *
 * Safe to re-run: only touches rows where floorNumber is still null.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Returns a floor number, or null if the text can't be parsed confidently. */
export function parseFloor(raw: string | null): number | null {
  if (!raw) return null;

  const text = raw.trim().toLowerCase();
  if (!text) return null;

  // Ground floor, in the various ways people write it (incl. Amharic).
  if (/^(g|gnd|ground|ground floor|፩ኛ ወለል|ምድር ቤት)$/.test(text)) return 0;

  // Basement.
  if (/^(b|basement|lower ground|lg)$/.test(text)) return -1;

  // "G+2" style, common in Ethiopian listings — the number after G is the floor.
  const gPlus = /^g\s*\+\s*(\d{1,3})$/.exec(text);
  if (gPlus) return Number(gPlus[1]);

  // Plain digits, with or without an ordinal suffix: "2", "2nd", "3rd floor".
  const numeric = /^(\d{1,3})\s*(st|nd|rd|th)?\s*(floor)?$/.exec(text);
  if (numeric) return Number(numeric[1]);

  // Spelled-out ordinals up to twelfth.
  const words: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const wordMatch = /^([a-z]+)\s*(floor)?$/.exec(text);
  if (wordMatch && words[wordMatch[1]] !== undefined) return words[wordMatch[1]];

  return null;
}

async function main() {
  const listings = await prisma.listing.findMany({
    where: { floorNumber: null, NOT: { floor: null } },
    select: { id: true, floor: true },
  });

  console.log(`Found ${listings.length} listing(s) with a legacy floor value to backfill.`);

  let updated = 0;
  const unparseable: { id: string; floor: string | null }[] = [];

  for (const listing of listings) {
    const parsed = parseFloor(listing.floor);
    if (parsed === null) {
      unparseable.push(listing);
      continue;
    }
    await prisma.listing.update({
      where: { id: listing.id },
      data: { floorNumber: parsed },
    });
    updated++;
  }

  console.log(`\nBackfilled ${updated} listing(s).`);

  if (unparseable.length) {
    console.log(`\n${unparseable.length} listing(s) need manual review — floorNumber left null:`);
    for (const l of unparseable) {
      console.log(`  ${l.id}  floor = "${l.floor}"`);
    }
    console.log('\nSet these by hand (or via the Admin Panel) before dropping the `floor` column.');
  } else {
    console.log('\nNothing left unparsed — safe to proceed to the migration that drops `floor`.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
