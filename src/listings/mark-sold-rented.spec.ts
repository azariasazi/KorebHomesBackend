import { ListingsService } from './listings.service';
import { ListingStatus, ListingType } from '@prisma/client';

/**
 * Covers the Sold/Rented feature (CR-03 item 2):
 *   - only a LIVE listing can be marked
 *   - SOLD vs RENTED is derived from the listing's type, never the caller
 *   - sold/rented stays publicly visible (with a timestamp for the badge)
 *   - the mark can be reversed back to LIVE
 */
describe('ListingsService — mark sold / rented', () => {
  let service: ListingsService;
  let prismaMock: any;

  const buildService = (listing: any) => {
    prismaMock = {
      listing: {
        findUnique: jest.fn().mockResolvedValue(listing),
        update: jest.fn(async ({ data }: any) => ({ ...listing, ...data })),
      },
    };
    return new ListingsService(prismaMock);
  };

  it('marks a live SALE listing as SOLD', async () => {
    service = buildService({
      id: 'l1',
      ownerId: 'owner-1',
      status: ListingStatus.LIVE,
      listingType: ListingType.SALE,
    });
    const result: any = await service.markSoldOrRented('l1', 'owner-1');
    expect(result.status).toBe(ListingStatus.SOLD);
    expect(result.soldRentedAt).toBeInstanceOf(Date);
  });

  it('marks a live RENT listing as RENTED', async () => {
    service = buildService({
      id: 'l2',
      ownerId: 'owner-1',
      status: ListingStatus.LIVE,
      listingType: ListingType.RENT,
    });
    const result: any = await service.markSoldOrRented('l2', 'owner-1');
    expect(result.status).toBe(ListingStatus.RENTED);
  });

  it('refuses to mark a listing that is not live', async () => {
    service = buildService({
      id: 'l3',
      ownerId: 'owner-1',
      status: ListingStatus.AWAITING_REVIEW,
      listingType: ListingType.SALE,
    });
    await expect(service.markSoldOrRented('l3', 'owner-1')).rejects.toThrow();
  });

  it("refuses when the caller isn't the owner", async () => {
    service = buildService({
      id: 'l4',
      ownerId: 'someone-else',
      status: ListingStatus.LIVE,
      listingType: ListingType.SALE,
    });
    await expect(service.markSoldOrRented('l4', 'owner-1')).rejects.toThrow();
  });

  it('reverses a SOLD listing back to LIVE and clears the timestamp', async () => {
    service = buildService({
      id: 'l5',
      ownerId: 'owner-1',
      status: ListingStatus.SOLD,
      listingType: ListingType.SALE,
    });
    const result: any = await service.markAvailableAgain('l5', 'owner-1');
    expect(result.status).toBe(ListingStatus.LIVE);
    expect(result.soldRentedAt).toBeNull();
  });

  it('refuses to mark-available a listing that is not sold/rented', async () => {
    service = buildService({
      id: 'l6',
      ownerId: 'owner-1',
      status: ListingStatus.LIVE,
      listingType: ListingType.SALE,
    });
    await expect(service.markAvailableAgain('l6', 'owner-1')).rejects.toThrow();
  });
});

describe('ListingsService — sold/rented stay visible in public search', () => {
  it('search filters to a status allow-list that includes SOLD and RENTED', async () => {
    const prismaMock: any = {
      listing: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const service = new ListingsService(prismaMock);
    await service.search({});

    const where = prismaMock.listing.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(
      expect.arrayContaining([ListingStatus.LIVE, ListingStatus.SOLD, ListingStatus.RENTED]),
    );
    // Must NOT expose drafts or in-review listings.
    expect(where.status.in).not.toContain(ListingStatus.DRAFT);
    expect(where.status.in).not.toContain(ListingStatus.AWAITING_REVIEW);
    expect(where.status.in).not.toContain(ListingStatus.REJECTED);
  });

  it('orders available listings above sold/rented ones', async () => {
    const prismaMock: any = {
      listing: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const service = new ListingsService(prismaMock);
    await service.search({});

    const orderBy = prismaMock.listing.findMany.mock.calls[0][0].orderBy;
    // First sort key floats not-yet-sold (null soldRentedAt) to the top.
    expect(orderBy[0]).toEqual({ soldRentedAt: { sort: 'asc', nulls: 'first' } });
  });
});
