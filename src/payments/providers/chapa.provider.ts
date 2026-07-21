import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentProvider,
  VerifyPaymentResult,
} from '../../common/interfaces/payment-provider.interface';

/**
 * Chapa implementation of the PaymentProvider contract.
 * Chapa aggregates Telebirr, CBE Birr, HelloCash and card payments behind a
 * single integration. Because everything goes through the PaymentProvider
 * interface, this class can be swapped for another gateway without touching
 * PaymentsService or any controller.
 *
 * Docs: https://developer.chapa.co
 */
@Injectable()
export class ChapaProvider implements PaymentProvider {
  private readonly logger = new Logger('ChapaProvider');

  constructor(private config: ConfigService) {}

  private get baseUrl() {
    return this.config.get<string>('CHAPA_BASE_URL') ?? 'https://api.chapa.co/v1';
  }

  private get secretKey() {
    return this.config.get<string>('CHAPA_SECRET_KEY') ?? '';
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const payload = {
      amount: input.amountEtb.toString(),
      currency: 'ETB',
      tx_ref: input.txRef,
      phone_number: input.customerPhone,
      first_name: input.customerName ?? 'Koreb',
      email: input.customerEmail,
      callback_url: this.config.get<string>('CHAPA_CALLBACK_URL'),
      return_url: this.config.get<string>('CHAPA_RETURN_URL'),
      customization: {
        title: 'Koreb Homes',
        description: input.description,
      },
    };

    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data: any = await res.json();
    if (!res.ok || data?.status !== 'success') {
      this.logger.error(`Chapa initialize failed: ${JSON.stringify(data)}`);
      throw new Error(data?.message ?? 'Failed to initialize payment.');
    }

    return {
      checkoutUrl: data.data.checkout_url,
      providerRef: input.txRef,
    };
  }

  async verify(txRef: string): Promise<VerifyPaymentResult> {
    const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(txRef)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });

    const data: any = await res.json();
    if (!res.ok || data?.status !== 'success') {
      return { status: 'FAILED', raw: data };
    }

    const chapaStatus = data.data?.status;
    const mapped: VerifyPaymentResult['status'] =
      chapaStatus === 'success' ? 'SUCCESS' : chapaStatus === 'pending' ? 'PENDING' : 'FAILED';

    return {
      status: mapped,
      providerChargeId: data.data?.reference ?? data.data?.tx_ref,
      amountEtb: data.data?.amount ? Number(data.data.amount) : undefined,
      raw: data,
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
    const webhookSecret = this.config.get<string>('CHAPA_WEBHOOK_SECRET');
    if (!webhookSecret || !signatureHeader) return false;

    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const computed = createHmac('sha256', webhookSecret).update(body).digest('hex');

    try {
      const a = Buffer.from(computed);
      const b = Buffer.from(signatureHeader);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
