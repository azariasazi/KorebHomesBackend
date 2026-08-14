import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendEmailInput, SendEmailResult } from '../../../common/interfaces/email-provider.interface';

/**
 * Development-only email provider: logs the message instead of sending it, the
 * same way ConsoleSmsProvider does for SMS. Lets the full signup / verification
 * / password-reset flow be built and tested before real SMTP credentials exist.
 *
 * Swap for SmtpEmailProvider in AuthModule once the hosting mailbox's SMTP
 * settings are in .env — nothing else in the app changes.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('ConsoleEmailProvider');

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.logger.log(`[DEV EMAIL to ${input.to}] ${input.subject} :: ${input.text}`);
    return { success: true, providerMessageId: `console-${Date.now()}` };
  }
}
