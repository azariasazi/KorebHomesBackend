import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailProvider, SendEmailInput, SendEmailResult } from '../../../common/interfaces/email-provider.interface';

/**
 * SMTP email provider. Works with the hosting mailbox (e.g.
 * noreply@korebhomes.com) now, and with almost any transactional provider later
 * by changing only the SMTP_* env values.
 *
 * To activate: set SMTP_HOST/PORT/USER/PASS and EMAIL_FROM in .env, then bind
 * this instead of ConsoleEmailProvider in AuthModule.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly logger = new Logger('SmtpEmailProvider');
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    const port = Number(this.config.get('SMTP_PORT') ?? 587);
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port,
      secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const from = this.config.get<string>('EMAIL_FROM') ?? this.config.get<string>('SMTP_USER');
    try {
      const info = await this.transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (err) {
      this.logger.error(`Failed to send email to ${input.to}: ${(err as Error).message}`);
      return { success: false };
    }
  }
}
