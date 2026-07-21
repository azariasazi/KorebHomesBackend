import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

  async add(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');

    // Idempotent: upsert on the (userId, listingId) unique constraint.
    return this.prisma.favorite.upsert({
      where: { userId_listingId: { userId, listingId } },
      update: {},
      create: { userId, listingId },
    });
  }

  async remove(userId: string, listingId: string) {
    await this.prisma.favorite
      .delete({ where: { userId_listingId: { userId, listingId } } })
      .catch(() => undefined); // idempotent — no error if it wasn't favorited
    return { message: 'Removed from favorites.' };
  }

  async list(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId, listing: { status: ListingStatus.LIVE } },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          include: { photos: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        },
      },
    });
  }
}
