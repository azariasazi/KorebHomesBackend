export interface InitiatePaymentInput {
  txRef: string;
  amountEtb: number;
  customerPhone: string;
  customerName?: string;
  customerEmail?: string;
  description: string;
}

export interface InitiatePaymentResult {
  checkoutUrl: string;
  providerRef: string;
}

export interface VerifyPaymentResult {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  providerChargeId?: string;
  amountEtb?: number;
  raw?: unknown;
}

/**
 * Generic payment gateway contract. Chapa is the first implementation
 * (see payments/providers/chapa.provider.ts), but this interface lets a
 * future provider (or a direct Telebirr/CBE integration) be swapped in
 * without touching PaymentsService or any controller.
 */
export interface PaymentProvider {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  /** Re-verifies a transaction server-side — never trust the webhook body alone. */
  verify(txRef: string): Promise<VerifyPaymentResult>;
  /** Validates an inbound webhook's signature/authenticity. */
  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
