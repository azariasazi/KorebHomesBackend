import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

/**
 * Handles listing photo uploads: validates the per-listing photo cap,
 * compresses/resizes with sharp for fast loading on slow connections
 * (per the spec's 3G-performance requirement), and generates a thumbnail.
 *
 * STORAGE_DRIVER=local writes to disk under STORAGE_LOCAL_PATH for
 * development. Swap in an S3-compatible driver (e.g. DigitalOcean Spaces)
 * before production by implementing the same saveBuffer()/publicUrl()
 * contract used below.
 */
@Injectable()
export class PhotosService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async addPhoto(listingId: string, userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded.');

    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');
    if (listing.ownerId !== userId) throw new ForbiddenException('You do not own this listing.');

    const maxPhotos = Number(this.config.get('MAX_PHOTOS_PER_LISTING') ?? 10);
    const existingCount = await this.prisma.photo.count({ where: { listingId } });
    if (existingCount >= maxPhotos) {
      throw new BadRequestException(`A listing can have at most ${maxPhotos} photos.`);
    }

    const id = randomUUID();
    const { fullUrl, thumbUrl } = await this.storeCompressed(id, file.buffer);

    return this.prisma.photo.create({
      data: {
        listingId,
        url: fullUrl,
        thumbUrl,
        sortOrder: existingCount,
      },
    });
  }

  async removePhoto(photoId: string, userId: string) {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: { listing: true },
    });
    if (!photo) throw new NotFoundException('Photo not found.');
    if (photo.listing.ownerId !== userId) throw new ForbiddenException('You do not own this listing.');

    await this.prisma.photo.delete({ where: { id: photoId } });
    return { message: 'Photo removed.' };
  }

  async reorder(listingId: string, userId: string, orderedPhotoIds: string[]) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');
    if (listing.ownerId !== userId) throw new ForbiddenException('You do not own this listing.');

    await this.prisma.$transaction(
      orderedPhotoIds.map((photoId, index) =>
        this.prisma.photo.update({ where: { id: photoId }, data: { sortOrder: index } }),
      ),
    );
    return { message: 'Photo order updated.' };
  }

  /**
   * Compresses the original to a web-friendly JPEG (max width 1600px) and
   * produces a small thumbnail (max width 480px) for feed/card views.
   */
  private async storeCompressed(id: string, buffer: Buffer): Promise<{ fullUrl: string; thumbUrl: string }> {
    const driver = this.config.get<string>('STORAGE_DRIVER') ?? 'local';

    const fullBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();

    const thumbBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 480, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    if (driver === 'local') {
      const basePath = this.config.get<string>('STORAGE_LOCAL_PATH') ?? './uploads';
      const listingsDir = path.join(basePath, 'listings');
      fs.mkdirSync(listingsDir, { recursive: true });

      const fullFile = `${id}.jpg`;
      const thumbFile = `${id}_thumb.jpg`;
      fs.writeFileSync(path.join(listingsDir, fullFile), fullBuffer);
      fs.writeFileSync(path.join(listingsDir, thumbFile), thumbBuffer);

      return {
        fullUrl: `/uploads/listings/${fullFile}`,
        thumbUrl: `/uploads/listings/${thumbFile}`,
      };
    }

    // Placeholder for an S3-compatible driver — implement upload here and
    // return the resulting public URLs, keeping the same return shape.
    throw new BadRequestException(`Storage driver "${driver}" is not yet implemented.`);
  }
}
