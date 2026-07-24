import { ListingsService } from './listings.service';
import { ListingStatus } from '@prisma/client';

/**
 * Guards the LISTING_FEE_ENABLED toggle.
 *
 * During the free launch period (6-12 months) the fee is OFF, and a listing
 * must go straight to admin review. If this routing broke, every listing would
 * pile up in AWAITING_PAYMENT waiting for a payment that is never coming, and
 * nothing would ever reach the review queue — the platform would silently
 * stop working.
 *
 * The other half of the contract: admin review is MANDATORY either way. The
 * toggle decides whether money changes hands, never whether a human checks
 * the listing.
 */
describe('ListingsService — listing fee toggle', () => {
  let service: ListingsService;
  let prismaMock: any;

  const draftListing = {
    id: 'listing-uuid',
    ownerId: 'owner-uuid',
    status: ListingStatus.DRAFT,
  };

  /** Builds a mock where the LISTING_FEE_ENABLED row holds `settingValue`. */
  const buildService = (settingValue: string | null) => {
    prismaMock = {
      listing: {
        findUnique: jest.fn().mockResolvedValue(draftListing),
        update: jest.fn(async ({ data }: any) => ({ ...draftListing, ...data })),
      },
      platformSetting: {
        findUnique: jest.fn().mockResolvedValue(
          settingValue === null ? null : { key: 'LISTING_FEE_ENABLED', value: settingValue },
        ),
      },
    };
    return new ListingsService(prismaMock);
  };

  describe('when the fee is OFF (free launch period)', () => {
    beforeEach(() => {
      service = buildService('false');
    });

    it('sends the listing straight to admin review, skipping payment', async () => {
      const result: any = await service.submitForReview('listing-uuid', 'owner-uuid');
      expect(result.status).toBe(ListingStatus.AWAITING_REVIEW);
    });

    it('never leaves the listing stuck in AWAITING_PAYMENT', async () => {
      const result: any = await service.submitForReview('listing-uuid', 'owner-uuid');
      expect(result.status).not.toBe(ListingStatus.AWAITING_PAYMENT);
    });

    it('tells the frontend no payment is required', async () => {
      const result: any = await service.submitForReview('listing-uuid', 'owner-uuid');
      expect(result.requiresPayment).toBe(false);
    });
  });

  describe('when the fee is ON (after the free period ends)', () => {
    beforeEach(() => {
      service = buildService('true');
    });

    it('routes the listing to payment first', async () => {
      const result: any = await service.submitForReview('listing-uuid', 'owner-uuid');
      expect(result.status).toBe(ListingStatus.AWAITING_PAYMENT);
    });

    it('tells the frontend payment is required', async () => {
      const result: any = await service.submitForReview('listing-uuid', 'owner-uuid');
      expect(result.requiresPayment).toBe(true);
    });
  });

  describe('fails safe', () => {
    it('treats a missing setting row as FREE, never as chargeable', async () => {
      service = buildService(null);
      expect(await service.isListingFeeEnabled()).toBe(false);
    });

    it('treats an unrecognised value as FREE rather than charging by accident', async () => {
      service = buildService('yes');
      expect(await service.isListingFeeEnabled()).toBe(false);
    });

    it('accepts "TRUE" case-insensitively', async () => {
      service = buildService('TRUE');
      expect(await service.isListingFeeEnabled()).toBe(true);
    });
  });

  describe('admin review is mandatory regardless of the toggle', () => {
    it('never publishes a listing directly to LIVE on submission', async () => {
      for (const value of ['true', 'false']) {
        service = buildService(value);
        const result: any = await service.submitForReview('listing-uuid', 'owner-uuid');
        expect(result.status).not.toBe(ListingStatus.LIVE);
      }
    });
  });
});
