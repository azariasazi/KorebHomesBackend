import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ListingStatus, ListingType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto, ListingSort } from './dto/search-listings.dto';

/**
 * Statuses that may appear in public search / detail.
 *
 * Explicit allow-list, deliberately not "everything except DRAFT". Same
 * fail-closed reasoning as the field select: a status added to the enum later
 * (e.g. a future ARCHIVED-but-visible idea) stays invisible to the public until
 * someone consciously lists it here. SOLD/RENTED are included so they show with
 * a badge; they are sorted to the bottom (see search()).
 */
const PUBLICLY_VISIBLE_STATUSES: ListingStatus[] = [
  ListingStatus.LIVE,
  ListingStatus.SOLD,
  ListingStatus.RENTED,
];

/**
 * Explicit allow-list of fields returned by PUBLIC endpoints.
 *
 * This is deliberately a `select` (name every field that goes out) rather than
 * an `include` or an omit-a-few approach. Prisma returns every scalar by
 * default, so an omit-list would silently leak any field added to the model
 * later. This fails CLOSED: a new field is invisible publicly until someone
 * consciously adds it here.
 *
 * DO NOT ADD: unitNumber, rejectionCode, rejectionReason, rejectedAt.
 * Those are private to the listing's owner and Admin. See the "Response
 * shaping" section of backend-changes-listings-v1.md.
 */
const PUBLIC_LISTING_SELECT = {
  id: true,
  ownerId: true,
  propertyType: true,
  listingType: true,
  priceEtb: true,
  region: true,
  city: true,
  subCity: true,
  areaName: true,
  latitude: true,
  longitude: true,
  bedrooms: true,
  bathrooms: true,
  sizeSqm: true,
  furnished: true,
  amenities: true,
  buildingName: true,
  floorNumber: true,
  floor: true, // legacy free-text; removed once the backfill to floorNumber is verified
  descriptionEn: true,
  descriptionAm: true,
  status: true,
  viewCount: true,
  isFeatured: true,
  publishedAt: true,
  soldRentedAt: true,
  createdAt: true,
  updatedAt: true,
  photos: {
    select: { id: true, url: true, thumbUrl: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  owner: {
    select: {
      id: true,
      name: true,
      profilePhotoUrl: true,
      role: true,
      agencyName: true,
      verificationStatus: true,
      // Both are selected so the public contact number can be resolved with a
      // fallback. shapePublicOwner() collapses them into a single `contactPhone`
      // and removes the raw login `phone` — it must NEVER leave this service.
      phone: true,
      publicContactPhone: true,
    },
  },
};

/**
 * Resolves the number shown on a listing (public number if set, else the
 * account phone) and strips the raw login `phone` from the owner object.
 *
 * The login phone is selected only to power the fallback; it must never appear
 * in a public response as its own field. This function is the one place that
 * guarantees that, so every public path routes through it.
 */
function shapePublicOwner<T extends { phone?: string | null; publicContactPhone?: string | null }>(
  owner: T | null | undefined,
) {
  if (!owner) return owner;
  const { phone, publicContactPhone, ...rest } = owner;
  return { ...rest, contactPhone: publicContactPhone ?? phone ?? null };
}

/** Applies shapePublicOwner to a full listing row coming out of a public query. */
function shapePublicListing<T extends { owner?: any }>(listing: T): T {
  if (listing && listing.owner) {
    return { ...listing, owner: shapePublicOwner(listing.owner) };
  }
  return listing;
}

@Injectable()
export class ListingsService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Create — starts life as DRAFT, moves to AWAITING_PAYMENT once the
  // owner/agent confirms they're ready to submit (see markReadyForPayment).
  // ---------------------------------------------------------------------
  async create(ownerId: string, dto: CreateListingDto) {
    return this.prisma.listing.create({
      data: {
        ownerId,
        ...dto,
        status: ListingStatus.DRAFT,
      },
    });
  }

  /**
   * Owner/Agent submits a listing for publication.
   *
   * Where it goes next depends on the LISTING_FEE_ENABLED platform setting:
   *   - fee ON  -> AWAITING_PAYMENT (frontend then calls payments/initiate)
   *   - fee OFF -> AWAITING_REVIEW  (payment skipped entirely)
   *
   * Admin review is MANDATORY in both cases — the toggle only controls whether
   * money changes hands, never whether a human checks the listing.
   */
  async submitForReview(listingId: string, userId: string) {
    const listing = await this.getOwnedListingOrThrow(listingId, userId);
    if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.REJECTED) {
      throw new ForbiddenException('Only draft or rejected listings can be submitted.');
    }

    const feeEnabled = await this.isListingFeeEnabled();

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: feeEnabled ? ListingStatus.AWAITING_PAYMENT : ListingStatus.AWAITING_REVIEW,
        // Clear the previous round's rejection detail on resubmission.
        rejectionCode: null,
        rejectionReason: null,
        rejectedAt: null,
      },
    });

    return { ...updated, requiresPayment: feeEnabled };
  }

  /**
   * Reads the admin-editable LISTING_FEE_ENABLED switch.
   * Defaults to FALSE (free) if the setting row is missing, so a fresh or
   * partially-seeded database can never accidentally start charging people.
   */
  async isListingFeeEnabled(): Promise<boolean> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: 'LISTING_FEE_ENABLED' },
    });
    return setting?.value?.toLowerCase() === 'true';
  }

  /** Called by PaymentsService once a listing-fee payment succeeds. */
  async markAwaitingReview(listingId: string) {
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.AWAITING_REVIEW },
    });
  }

  // ---------------------------------------------------------------------
  // Search / browse (public)
  // ---------------------------------------------------------------------
  async search(dto: SearchListingsDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const where: Prisma.ListingWhereInput = {
      status: { in: PUBLICLY_VISIBLE_STATUSES },
      ...(dto.city && { city: { equals: dto.city, mode: 'insensitive' } }),
      ...(dto.subCity && { subCity: { equals: dto.subCity, mode: 'insensitive' } }),
      ...(dto.propertyType && { propertyType: dto.propertyType }),
      ...(dto.listingType && { listingType: dto.listingType }),
      ...(dto.minBedrooms !== undefined && { bedrooms: { gte: dto.minBedrooms } }),
      ...((dto.minPrice !== undefined || dto.maxPrice !== undefined) && {
        priceEtb: {
          ...(dto.minPrice !== undefined && { gte: dto.minPrice }),
          ...(dto.maxPrice !== undefined && { lte: dto.maxPrice }),
        },
      }),
      ...(dto.keyword && {
        OR: [
          { descriptionEn: { contains: dto.keyword, mode: 'insensitive' } },
          { descriptionAm: { contains: dto.keyword, mode: 'insensitive' } },
          { areaName: { contains: dto.keyword, mode: 'insensitive' } },
          { city: { contains: dto.keyword, mode: 'insensitive' } },
        ],
      }),
      ...((dto.swLat !== undefined && dto.swLng !== undefined && dto.neLat !== undefined && dto.neLng !== undefined) && {
        latitude: { gte: dto.swLat, lte: dto.neLat },
        longitude: { gte: dto.swLng, lte: dto.neLng },
      }),
    };

    // Available (LIVE) listings always rank above SOLD/RENTED ones, whatever
    // the user's chosen sort. LIVE listings have soldRentedAt = null, so
    // nulls-first floats them to the top; the chosen sort orders within each group.
    const secondarySort =
      dto.sort === ListingSort.PRICE_ASC
        ? { priceEtb: 'asc' as const }
        : dto.sort === ListingSort.PRICE_DESC
          ? { priceEtb: 'desc' as const }
          : { publishedAt: 'desc' as const };

    const orderBy: Prisma.ListingOrderByWithRelationInput[] = [
      { soldRentedAt: { sort: 'asc', nulls: 'first' } },
      secondarySort,
    ];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: PUBLIC_LISTING_SELECT,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items: items.map(shapePublicListing),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // ---------------------------------------------------------------------
  // Detail (public) — increments view count, fire-and-forget
  // ---------------------------------------------------------------------
  async findOnePublic(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: PUBLIC_LISTING_SELECT,
    });
    if (!listing || !PUBLICLY_VISIBLE_STATUSES.includes(listing.status as ListingStatus)) {
      throw new NotFoundException('Listing not found.');
    }

    this.prisma.listing
      .update({ where: { id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    return shapePublicListing(listing);
  }

  // ---------------------------------------------------------------------
  // Owner/Agent's own listings + dashboard
  // ---------------------------------------------------------------------
  async findMine(ownerId: string) {
    return this.prisma.listing.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async findOneOwned(id: string, userId: string) {
    return this.getOwnedListingOrThrow(id, userId, true);
  }

  async update(id: string, userId: string, dto: UpdateListingDto) {
    const listing = await this.getOwnedListingOrThrow(id, userId);

    // Editing a LIVE or REJECTED listing sends it back through review:
    //  - LIVE: prevents bait-and-switch (post something approved, then quietly
    //    change it to something else).
    //  - REJECTED: an edit IS the fix, so re-queue it and clear the previous
    //    rejection detail — no separate submit() call needed. A redundant
    //    submit() afterwards is harmless (it no-ops on an already-queued listing).
    if (listing.status === ListingStatus.LIVE || listing.status === ListingStatus.REJECTED) {
      return this.prisma.listing.update({
        where: { id },
        data: {
          ...dto,
          status: ListingStatus.AWAITING_REVIEW,
          rejectionCode: null,
          rejectionReason: null,
          rejectedAt: null,
        },
      });
    }
    return this.prisma.listing.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string) {
    await this.getOwnedListingOrThrow(id, userId);
    await this.prisma.listing.delete({ where: { id } });
    return { message: 'Listing removed.' };
  }

  /** Owner/Agent manually renews a listing to reset the inactivity clock. */
  async renew(id: string, userId: string) {
    const listing = await this.getOwnedListingOrThrow(id, userId);
    if (listing.status !== ListingStatus.LIVE && listing.status !== ListingStatus.UNPUBLISHED) {
      throw new ForbiddenException('Only live or unpublished listings can be renewed.');
    }
    return this.prisma.listing.update({
      where: { id },
      data: {
        status: ListingStatus.LIVE,
        lastRenewedAt: new Date(),
        inactivityNudgeSentAt: null,
      },
    });
  }

  /**
   * Owner/Agent marks a listing as sold or rented.
   *
   * Only a LIVE listing can be marked — you can't sell something that isn't
   * published. The listing STAYS in search (greyed out with a badge on the
   * frontend); it does not disappear. `SOLD` vs `RENTED` is inferred from the
   * listing's own listingType so the frontend can't send a mismatched status
   * (a for-rent property marked "SOLD").
   */
  async markSoldOrRented(id: string, userId: string) {
    const listing = await this.getOwnedListingOrThrow(id, userId);
    if (listing.status !== ListingStatus.LIVE) {
      throw new ForbiddenException('Only a live listing can be marked as sold or rented.');
    }
    const newStatus =
      listing.listingType === ListingType.RENT ? ListingStatus.RENTED : ListingStatus.SOLD;

    return this.prisma.listing.update({
      where: { id },
      data: { status: newStatus, soldRentedAt: new Date() },
    });
  }

  /**
   * Owner/Agent reverses a sold/rented mark (e.g. a deal fell through, or they
   * tapped it by mistake). Returns the listing to LIVE and resets the
   * inactivity clock so it isn't immediately caught by the auto-unpublish job.
   */
  async markAvailableAgain(id: string, userId: string) {
    const listing = await this.getOwnedListingOrThrow(id, userId);
    if (listing.status !== ListingStatus.SOLD && listing.status !== ListingStatus.RENTED) {
      throw new ForbiddenException('Only a sold or rented listing can be marked available again.');
    }
    return this.prisma.listing.update({
      where: { id },
      data: {
        status: ListingStatus.LIVE,
        soldRentedAt: null,
        lastRenewedAt: new Date(),
        inactivityNudgeSentAt: null,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Internal helper
  // ---------------------------------------------------------------------
  private async getOwnedListingOrThrow(id: string, userId: string, includePhotos = false) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: includePhotos ? { photos: { orderBy: { sortOrder: 'asc' } } } : undefined,
    });
    if (!listing) throw new NotFoundException('Listing not found.');
    if (listing.ownerId !== userId) {
      throw new ForbiddenException('You do not have access to this listing.');
    }
    return listing;
  }
}
