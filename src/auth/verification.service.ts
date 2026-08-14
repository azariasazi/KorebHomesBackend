import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from '../common/interfaces/email-provider.interface';
import { SMS_PROVIDER, SmsProvider } from '../common/interfaces/sms-provider.interface';

/**
 * Central place for issuing and checking verification codes, used by:
 *   - signup email/phone verification
 *   - phone verification before posting
 *   - password reset
 *
 * A short numeric code is generated, hashed (never stored raw), and sent to the
 * chosen channel. `channel` decides email vs SMS; the caller picks it per the
 * cost rule (prefer email, SMS only when there's no email).
 */
@Injectable()
export class VerificationService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(EMAIL_PROVIDER) private emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
  ) {}

  /**
   * Creates a code for (userId, purpose), sends it to `destination` over the
   * given channel, and stores its hash. Any earlier unconsumed codes for the
   * same user+purpose are invalidated so only the newest works.
   */
  async issueAndSend(params: {
    userId: string;
    purpose: VerificationPurpose;
    channel: 'email' | 'sms';
    destination: string;
  }): Promise<{ expiresInSeconds: number }> {
    const { userId, purpose, channel, destination } = params;

    const cooldown = Number(this.config.get('OTP_RESEND_COOLDOWN_SECONDS') ?? 60);
    const recent = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < cooldown * 1000) {
      const wait = Math.ceil((cooldown * 1000 - (Date.now() - recent.createdAt.getTime())) / 1000);
      throw new BadRequestException(`Please wait ${wait}s before requesting another code.`);
    }

    // Invalidate older outstanding codes for this purpose.
    await this.prisma.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const length = Number(this.config.get('OTP_LENGTH') ?? 6);
    const code = this.generateNumericCode(length);
    const ttlSeconds = Number(this.config.get('OTP_TTL_SECONDS') ?? 300);

    await this.prisma.verificationToken.create({
      data: {
        userId,
        purpose,
        destination,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });

    const minutes = Math.round(ttlSeconds / 60);
    const { subject, body } = this.messageFor(purpose, code, minutes);

    if (channel === 'email') {
      await this.emailProvider.send({ to: destination, subject, text: body });
    } else {
      await this.smsProvider.send(destination, body);
    }

    return { expiresInSeconds: ttlSeconds };
  }

  /**
   * Verifies a code for (userId, purpose). Returns the destination it was sent
   * to (useful for "change email" flows), or throws on any failure.
   */
  async verify(userId: string, purpose: VerificationPurpose, code: string): Promise<{ destination: string }> {
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5);

    const token = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) throw new BadRequestException('No active verification code. Please request a new one.');
    if (token.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }
    if (token.attempts >= maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }

    const ok = await bcrypt.compare(code, token.codeHash);
    if (!ok) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect verification code.');
    }

    await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    return { destination: token.destination };
  }

  private messageFor(purpose: VerificationPurpose, code: string, minutes: number) {
    switch (purpose) {
      case VerificationPurpose.PASSWORD_RESET:
        return {
          subject: 'Koreb Homes password reset code',
          body: `Your Koreb Homes password reset code is ${code}. It expires in ${minutes} minutes. If you didn't request this, ignore this message.`,
        };
      case VerificationPurpose.PHONE_VERIFY:
        return {
          subject: 'Koreb Homes phone verification',
          body: `Your Koreb Homes phone verification code is ${code}. It expires in ${minutes} minutes.`,
        };
      case VerificationPurpose.EMAIL_VERIFY:
      default:
        return {
          subject: 'Verify your Koreb Homes email',
          body: `Welcome to Koreb Homes! Your email verification code is ${code}. It expires in ${minutes} minutes.`,
        };
    }
  }

  private generateNumericCode(length: number): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return String(randomInt(min, max + 1));
  }
}
