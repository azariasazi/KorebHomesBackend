import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async create(listingId: string, reportedById: string | undefined, dto: CreateReportDto) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');

    return this.prisma.report.create({
      data: {
        listingId,
        reportedById,
        reason: dto.reason,
        details: dto.details,
      },
    });
  }
}
