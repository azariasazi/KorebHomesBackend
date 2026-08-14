import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ListingRejectionCode,
  ListingStatus,
  PaymentStatus,
  ReportStatus,
  UserRole,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewQueueQueryDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Dashboard stats
  // ---------------------------------------------------------------------
  async getDashboardStats() {
    const [totalListings, totalUsers, awaitingReview, revenueAgg, openReports] = await this.prisma.$transaction([
      this.prisma.listing.count(),
      this.prisma.user.count(),
      this.prisma.listing.count({ where: { status: ListingStatus.AWAITING_REVIEW } }),
      this.prisma.payment.aggregate({
        _sum: { amountEtb: true },
        where: { status: PaymentStatus.SUCCESS },
      }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
    ]);

    return {
      totalListings,
      totalUsers,
      awaitingReview,
      revenueCollectedEtb: Number(revenueAgg._sum.amountEtb ?? 0),
      openReports,
    };
  }

  // ---------------------------------------------------------------------
  // Listing review queue
  // ---------------------------------------------------------------------
  async getReviewQueue(query: ReviewQueueQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where: { status: ListingStatus.AWAITING_REVIEW },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          photos: { orderBy: { sortOrder: 'asc' } },
          owner: { select: { id: true, name: true, role: true, agencyName: true } },
        },
      }),
      this.prisma.listing.count({ where: { status: ListingStatus.AWAITING_REVIEW } }),
    ]);

    return { items, total, page, pageSize };
  }

  async approveListing(listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');
    if (listing.status !== ListingStatus.AWAITING_REVIEW) {
      throw new BadRequestException('Only listings awaiting review can be approved.');
    }
    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.LIVE,
        publishedAt: listing.publishedAt ?? new Date(),
        lastRenewedAt: new Date(),
        // Clear any rejection detail from a previous round so a stale reason
        // doesn't linger on a now-live listing.
        rejectionCode: null,
        rejectionReason: null,
        rejectedAt: null,
      },
    });
  }

  async rejectListing(listingId: string, code: ListingRejectionCode, note?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');
    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.REJECTED,
        rejectionCode: code,
        rejectionReason: note ?? null,
        rejectedAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------
  // User management
  // ---------------------------------------------------------------------
  async listUsers(role?: UserRole) {
    return this.prisma.user.findMany({
      where: role ? { role } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        city: true,
        isSuspended: true,
        suspendedReason: true,
        suspendedAt: true,
        verificationStatus: true,
        agencyName: true,
        createdAt: true,
      },
    });
  }

  async suspendUser(actorRole: UserRole, userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    // A SUPER_ADMIN can never be suspended through this endpoint.
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('The super admin account cannot be suspended.');
    }
    // Only a SUPER_ADMIN may suspend an ADMIN. Regular admins can't touch admins.
    if (user.role === UserRole.ADMIN && actorRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only the super admin can suspend an admin account.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isSuspended: true, suspendedReason: reason, suspendedAt: new Date() },
    });
  }

  async unsuspendUser(actorRole: UserRole, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role === UserRole.ADMIN && actorRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only the super admin can manage an admin account.');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { isSuspended: false, suspendedReason: null, suspendedAt: null },
    });
  }

  // ---------------------------------------------------------------------
  // Agent verification queue
  // ---------------------------------------------------------------------
  async getVerificationQueue() {
    return this.prisma.user.findMany({
      where: { verificationStatus: VerificationStatus.PENDING },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        agencyName: true,
        verificationDocUrl: true,
        verificationNote: true,
        updatedAt: true,
      },
    });
  }

  async approveVerification(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.verificationStatus !== VerificationStatus.PENDING) {
      throw new BadRequestException('This user has no pending verification.');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        verificationStatus: VerificationStatus.APPROVED,
        verifiedAt: new Date(),
        verifiedByAdminId: adminId,
      },
    });
  }

  async rejectVerification(userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return this.prisma.user.update({
      where: { id: userId },
      data: { verificationStatus: VerificationStatus.REJECTED, verificationNote: reason },
    });
  }

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------
  async getReports(status: ReportStatus = ReportStatus.OPEN) {
    return this.prisma.report.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: { select: { id: true, city: true, subCity: true, status: true } },
        reportedBy: { select: { id: true, name: true } },
      },
    });
  }

  async resolveReport(reportId: string, status: ReportStatus, note?: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found.');
    return this.prisma.report.update({
      where: { id: reportId },
      data: { status, resolvedNote: note },
    });
  }

  // ---------------------------------------------------------------------
  // Pricing & platform settings (change fees with no code deploy)
  // ---------------------------------------------------------------------
  async getSettings() {
    return this.prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
  }

  async updateSetting(key: string, value: string) {
    const existing = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`Setting "${key}" not found.`);

    // Boolean settings must be exactly "true" or "false". Without this, an
    // admin typing "yes" to switch fees on would silently leave them off,
    // because the reader only treats "true" as enabled.
    const BOOLEAN_KEYS = ['LISTING_FEE_ENABLED'];
    if (BOOLEAN_KEYS.includes(key) && !['true', 'false'].includes(value.toLowerCase())) {
      throw new BadRequestException(`Setting "${key}" must be either "true" or "false".`);
    }

    // Numeric settings must parse as a non-negative number.
    const NUMERIC_KEYS = [
      'OWNER_LISTING_FEE_ETB',
      'AGENT_LISTING_FEE_ETB',
      'PENALTY_MULTIPLIER',
      'LISTING_INACTIVITY_DAYS',
    ];
    if (NUMERIC_KEYS.includes(key) && (isNaN(Number(value)) || Number(value) < 0)) {
      throw new BadRequestException(`Setting "${key}" must be a non-negative number.`);
    }

    return this.prisma.platformSetting.update({
      where: { key },
      data: { value: BOOLEAN_KEYS.includes(key) ? value.toLowerCase() : value },
    });
  }
}
