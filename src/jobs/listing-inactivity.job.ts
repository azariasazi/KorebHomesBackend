import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ListingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Handles listing inactivity per the agreed policy:
 *   - A live listing is considered "stale" once it hasn't been renewed for
 *     LISTING_INACTIVITY_DAYS.
 *   - Before unpublishing, owners get a nudge (recorded via
 *     inactivityNudgeSentAt so we don't spam them every run).
 *   - After the grace period, the listing is auto-UNPUBLISHED (never deleted),
 *     so the owner can renew it back to LIVE later.
 *
 * Admin can override any stage manually from the Admin Panel.
 *
 * The actual nudge delivery (SMS/push) is left as a hook — wire it to the
 * SmsProvider / a future notifications service when those channels are ready.
 */
@Injectable()
export class ListingInactivityJob {
  private readonly logger = new Logger('ListingInactivityJob');

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleInactivity() {
    const inactivityDays = await this.getSettingNumber('LISTING_INACTIVITY_DAYS', 30);
    const graceDays = Number(this.config.get('LISTING_GRACE_PERIOD_DAYS') ?? 7);

    const now = Date.now();
    const staleThreshold = new Date(now - inactivityDays * 24 * 60 * 60 * 1000);
    const unpublishThreshold = new Date(now - (inactivityDays + graceDays) * 24 * 60 * 60 * 1000);

    await this.sendNudges(staleThreshold, unpublishThreshold);
    await this.autoUnpublish(unpublishThreshold);
  }

  private async sendNudges(staleThreshold: Date, unpublishThreshold: Date) {
    // Live listings that have gone stale, still within grace, not yet nudged.
    const toNudge = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.LIVE,
        inactivityNudgeSentAt: null,
        OR: [
          { lastRenewedAt: { lte: staleThreshold, gt: unpublishThreshold } },
          { lastRenewedAt: null, publishedAt: { lte: staleThreshold, gt: unpublishThreshold } },
        ],
      },
      include: { owner: { select: { id: true, phone: true, name: true } } },
      take: 500,
    });

    for (const listing of toNudge) {
      // TODO: deliver via SmsProvider / notifications service when available.
      this.logger.log(
        `Nudge: listing ${listing.id} (owner ${listing.owner.phone}) is inactive and will be unpublished soon.`,
      );
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { inactivityNudgeSentAt: new Date() },
      });
    }

    if (toNudge.length) {
      this.logger.log(`Sent ${toNudge.length} inactivity nudge(s).`);
    }
  }

  private async autoUnpublish(unpublishThreshold: Date) {
    const result = await this.prisma.listing.updateMany({
      where: {
        status: ListingStatus.LIVE,
        OR: [
          { lastRenewedAt: { lte: unpublishThreshold } },
          { lastRenewedAt: null, publishedAt: { lte: unpublishThreshold } },
        ],
      },
      data: { status: ListingStatus.UNPUBLISHED },
    });

    if (result.count) {
      this.logger.log(`Auto-unpublished ${result.count} inactive listing(s).`);
    }
  }

  private async getSettingNumber(key: string, fallback: number): Promise<number> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key } });
    return setting ? Number(setting.value) : fallback;
  }
}
