import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ListingStatus, PaymentPurpose, PaymentStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../common/interfaces/payment-provider.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('PaymentsService');

  constructor(
    private prisma: PrismaService,
    private listingsService: ListingsService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Initiate a listing-fee payment -> returns a checkout URL for the client
  // ---------------------------------------------------------------------
  async initiateListingPayment(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');
    if (listing.ownerId !== userId) throw new ForbiddenException('You do not own this listing.');
    if (listing.status !== ListingStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('This listing is not awaiting payment.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const amountEtb = await this.resolveListingFee(user.role);
    const txRef = `koreb-${listingId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        listingId,
        purpose: PaymentPurpose.LISTING_FEE,
        amountEtb,
        status: PaymentStatus.PENDING,
        provider: 'chapa',
        providerRef: txRef,
      },
    });

    const result = await this.provider.initiate({
      txRef,
      amountEtb: Number(amountEtb),
      customerPhone: user.phone,
      customerName: user.name ?? undefined,
      description: `Listing fee for listing ${listingId}`,
    });

    return {
      paymentId: payment.id,
      checkoutUrl: result.checkoutUrl,
      amountEtb: Number(amountEtb),
    };
  }

  // ---------------------------------------------------------------------
  // Webhook — NEVER trust the payload alone. Verify signature, then
  // independently re-verify the transaction with the provider before
  // marking anything paid.
  // ---------------------------------------------------------------------
  async handleWebhook(rawBody: Buffer, signature: string | undefined, parsed: any) {
    const signatureValid = this.provider.verifyWebhookSignature(rawBody, signature);
    if (!signatureValid) {
      this.logger.warn('Rejected webhook with invalid signature.');
      throw new ForbiddenException('Invalid webhook signature.');
    }

    const txRef = parsed?.tx_ref ?? parsed?.data?.tx_ref;
    if (!txRef) {
      throw new BadRequestException('Webhook missing tx_ref.');
    }

    return this.settleByTxRef(txRef, parsed);
  }

  /** Also callable from a client-side "return_url" confirmation as a fallback. */
  async verifyAndSettle(userId: string, txRef: string) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: txRef } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.userId !== userId) throw new ForbiddenException('Not your payment.');
    return this.settleByTxRef(txRef, null);
  }

  private async settleByTxRef(txRef: string, rawPayload: any) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: txRef } });
    if (!payment) throw new NotFoundException('Payment not found for tx_ref.');

    // Idempotency: if we've already settled this one, don't double-process.
    if (payment.status === PaymentStatus.SUCCESS) {
      return { status: PaymentStatus.SUCCESS, alreadyProcessed: true };
    }

    const verification = await this.provider.verify(txRef);

    if (verification.status === 'SUCCESS') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESS,
          providerChargeId: verification.providerChargeId,
          rawWebhookPayload: rawPayload ?? undefined,
        },
      });

      // Move the associated listing forward into the review queue.
      if (payment.listingId && payment.purpose === PaymentPurpose.LISTING_FEE) {
        await this.listingsService.markAwaitingReview(payment.listingId);
      }

      return { status: PaymentStatus.SUCCESS };
    }

    if (verification.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, rawWebhookPayload: rawPayload ?? undefined },
      });
      return { status: PaymentStatus.FAILED };
    }

    return { status: PaymentStatus.PENDING };
  }

  async getMyPayments(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Reads the current listing fee from admin-editable PlatformSettings,
   * falling back to env defaults. Lets pricing change with no code deploy.
   */
  private async resolveListingFee(role: UserRole): Promise<number> {
    const key = role === UserRole.AGENT ? 'AGENT_LISTING_FEE_ETB' : 'OWNER_LISTING_FEE_ETB';
    const setting = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (setting) return Number(setting.value);
    return role === UserRole.AGENT
      ? Number(process.env.DEFAULT_AGENT_LISTING_FEE_ETB ?? 250)
      : Number(process.env.DEFAULT_OWNER_LISTING_FEE_ETB ?? 250);
  }
}
