export interface SendSmsResult {
  success: boolean;
  providerMessageId?: string;
}

/**
 * Any SMS vendor (a local aggregator, Twilio, etc.) can be plugged in by
 * implementing this interface and swapping the provider bound in AuthModule —
 * no changes needed anywhere else in the app.
 */
export interface SmsProvider {
  send(toPhone: string, message: string): Promise<SendSmsResult>;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
