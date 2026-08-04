import { ListingsService } from './listings.service';
import { ListingStatus } from '@prisma/client';

/**
 * Guards the privacy decision in backend-changes-listings-v1.md §2/§5:
 * unitNumber, rejectionCode, rejectionReason and rejectedAt must NEVER appear
 * in a public API response.
 *
 * This is the single highest-value test in the change set. Prisma returns every
 * scalar field by default, so the day someone swaps the explicit `select` back
 * to an `include` — or adds a private field to the model without thinking —
 * this test fails instead of a real home address quietly going public.
 *
 * Runs without a database: PrismaService is mocked.
 */

const PRIVATE_FIELDS = ['unitNumber', 'rejectionCode', 'rejectionReason', 'rejectedAt'] as const;

describe('ListingsService — public responses must not leak private fields', () => {
  let service: ListingsService;
  let prismaMock: any;

  /**
   * The full database row, private fields and all. This is what Prisma has in
   * hand — the question every test below asks is how much of it escapes.
   */
  const fullDbRow = {
    id: 'listing-uuid',
    ownerId: 'owner-uuid',
    propertyType: 'APARTMENT',
    listingType: 'RENT',
    priceEtb: '28000',
    region: 'Addis Ababa',
    city: 'Addis Ababa',
    subCity: 'Bole',
    buildingName: 'Zefmesh Grand',
    floorNumber: 4,
    status: ListingStatus.LIVE,
    photos: [],
    owner: {
      id: 'owner-uuid',
      name: 'Selam Tesfaye',
      role: 'AGENT',
      // Both phone fields as Prisma would now return them from the owner select.
      // The login `phone` must be stripped from public output; `contactPhone`
      // (resolved from these two) is what may appear.
      phone: '+251911111111',
      publicContactPhone: '+251922222222',
    },
    // --- private: must never reach a public response ---
    unitNumber: '4B',
    rejectionCode: 'DUPLICATE',
    rejectionReason: 'Same unit as listing #1183.',
    rejectedAt: new Date('2026-07-01'),
  };

  /**
   * Mimics Prisma's actual behaviour, which is the whole point of the test:
   *   - `select`  -> returns ONLY the named fields (applied at top level AND to
   *     the nested owner select, so the owner arrives with its phone fields
   *     exactly as the real query would deliver them)
   *   - `include` -> returns EVERY scalar on the model, plus the relations
   * Without this, a mock would just echo back whatever we handed it and the
   * return-shape assertions would pass even against leaking code.
   */
  const applyPrismaShaping = (args: any) => {
    if (args?.select) {
      return Object.keys(args.select).reduce((acc: any, key) => {
        if (key === 'owner' && args.select.owner?.select) {
          // Nested owner select: return only the owner fields that were asked for.
          acc.owner = Object.keys(args.select.owner.select).reduce((o: any, k) => {
            if (fullDbRow.owner && k in fullDbRow.owner) o[k] = (fullDbRow.owner as any)[k];
            return o;
          }, {});
        } else if (key in fullDbRow) {
          acc[key] = (fullDbRow as any)[key];
        }
        return acc;
      }, {});
    }
    return { ...fullDbRow };
  };

  beforeEach(() => {
    prismaMock = {
      listing: {
        findUnique: jest.fn(async (args: any) => applyPrismaShaping(args)),
        findMany: jest.fn(async (args: any) => [applyPrismaShaping(args)]),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn(async () => ({ ...fullDbRow })),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    service = new ListingsService(prismaMock);
  });

  describe('GET /listings/:id (findOnePublic)', () => {
    it('does not return unitNumber or any other private field', async () => {
      const result: any = await service.findOnePublic('listing-uuid');
      for (const field of PRIVATE_FIELDS) {
        expect(result).not.toHaveProperty(field);
      }
    });

    it('queries Prisma with an explicit select, not an include', async () => {
      await service.findOnePublic('listing-uuid');
      const args = prismaMock.listing.findUnique.mock.calls[0][0];

      // An `include` would return every scalar on the model — including unitNumber.
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
    });

    it('never names a private field in the select allow-list', async () => {
      await service.findOnePublic('listing-uuid');
      const select = prismaMock.listing.findUnique.mock.calls[0][0].select;

      for (const field of PRIVATE_FIELDS) {
        expect(select[field]).toBeUndefined();
      }
    });
  });

  describe('GET /listings (search)', () => {
    it('queries Prisma with an explicit select that omits private fields', async () => {
      await service.search({});
      const args = prismaMock.listing.findMany.mock.calls[0][0];

      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      for (const field of PRIVATE_FIELDS) {
        expect(args.select[field]).toBeUndefined();
      }
    });

    it('does not return private fields on any item', async () => {
      const result: any = await service.search({});
      for (const item of result.items) {
        for (const field of PRIVATE_FIELDS) {
          expect(item).not.toHaveProperty(field);
        }
      }
    });
  });

  describe('owner contact number (Change Request 02)', () => {
    it('exposes contactPhone on the owner of a listing detail', async () => {
      const result: any = await service.findOnePublic('listing-uuid');
      expect(result.owner.contactPhone).toBe('+251922222222'); // the public number
    });

    it('NEVER exposes the raw login `phone` on a public owner object', async () => {
      const detail: any = await service.findOnePublic('listing-uuid');
      expect(detail.owner).not.toHaveProperty('phone');
      expect(detail.owner).not.toHaveProperty('publicContactPhone');

      const search: any = await service.search({});
      for (const item of search.items) {
        expect(item.owner).not.toHaveProperty('phone');
        expect(item.owner).not.toHaveProperty('publicContactPhone');
      }
    });

    it('falls back to the account phone when no public number is set', async () => {
      // Point the mock owner at a null public number for this case.
      (fullDbRow.owner as any).publicContactPhone = null;
      const result: any = await service.findOnePublic('listing-uuid');
      expect(result.owner.contactPhone).toBe('+251911111111'); // account phone
      // restore for other tests
      (fullDbRow.owner as any).publicContactPhone = '+251922222222';
    });

    it('still never leaks the login phone even when it is the fallback source', async () => {
      (fullDbRow.owner as any).publicContactPhone = null;
      const result: any = await service.findOnePublic('listing-uuid');
      // contactPhone equals the account number, but there is no bare `phone` key
      expect(result.owner).not.toHaveProperty('phone');
      expect(result.owner.contactPhone).toBe('+251911111111');
      (fullDbRow.owner as any).publicContactPhone = '+251922222222';
    });
  });
});
