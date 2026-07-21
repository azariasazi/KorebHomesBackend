import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ListingStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto, ListingSort } from './dto/search-listings.dto';

const PUBLIC_LISTING_INCLUDE = {
  photos: { orderBy: { sortOrder: 'asc' as const } },
  owner: {
    select: {
      id: true,
      name: true,
      profilePhotoUrl: true,
      role: true,
      agencyName: true,
      verificationStatus: true,
    },
  },
};

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

  async markReadyForPayment(listingId: string, userId: string) {
    const listing = await this.getOwnedListingOrThrow(listingId, userId);
    if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.REJECTED) {
      throw new ForbiddenException('Only draft or rejected listings can be submitted for payment.');
    }
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.AWAITING_PAYMENT, rejectionReason: null },
    });
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
      status: ListingStatus.LIVE,
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

    const orderBy: Prisma.ListingOrderByWithRelationInput =
      dto.sort === ListingSort.PRICE_ASC
        ? { priceEtb: 'asc' }
        : dto.sort === ListingSort.PRICE_DESC
          ? { priceEtb: 'desc' }
          : { publishedAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PUBLIC_LISTING_INCLUDE,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items,
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
      include: PUBLIC_LISTING_INCLUDE,
    });
    if (!listing || listing.status !== ListingStatus.LIVE) {
      throw new NotFoundException('Listing not found.');
    }

    this.prisma.listing
      .update({ where: { id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    return listing;
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
    if (listing.status === ListingStatus.LIVE) {
      // Edits to a live listing go back through review to prevent
      // bait-and-switch listings (post approved, then edit to something else).
      return this.prisma.listing.update({
        where: { id },
        data: { ...dto, status: ListingStatus.AWAITING_REVIEW },
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
