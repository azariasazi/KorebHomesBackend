import { Injectable, Logger } from '@nestjs/common';
import { SendSmsResult, SmsProvider } from '../../../common/interfaces/sms-provider.interface';

/**
 * Development-only SMS provider: logs the message instead of sending it.
 * Swap the binding in AuthModule for a real provider before production
 * (e.g. a local Ethiopian SMS aggregator or Twilio) — nothing else in the
 * app needs to change since everything talks to the SmsProvider interface.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('ConsoleSmsProvider');

  async send(toPhone: string, message: string): Promise<SendSmsResult> {
    this.logger.log(`[DEV SMS to ${toPhone}]: ${message}`);
    return { success: true, providerMessageId: `console-${Date.now()}` };
  }
}
