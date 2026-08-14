export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body. Providers may also send it as a simple HTML wrapper. */
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
}

/**
 * Any email vendor can be plugged in by implementing this interface and swapping
 * the provider bound in AuthModule — nothing else in the app changes. The first
 * real implementation will be SMTP (via the hosting mailbox, e.g.
 * noreply@korebhomes.com), later swappable for a transactional provider.
 */
export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';
