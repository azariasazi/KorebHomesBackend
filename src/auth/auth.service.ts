import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../common/interfaces/sms-provider.interface';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
  ) {}

  // ---------------------------------------------------------------------
  // OTP request
  // ---------------------------------------------------------------------
  async requestOtp(phone: string) {
    const resendCooldown = Number(this.config.get('OTP_RESEND_COOLDOWN_SECONDS') ?? 60);
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < resendCooldown * 1000) {
      const waitSeconds = Math.ceil(
        (resendCooldown * 1000 - (Date.now() - recent.createdAt.getTime())) / 1000,
      );
      throw new BadRequestException(`Please wait ${waitSeconds}s before requesting another code.`);
    }

    const length = Number(this.config.get('OTP_LENGTH') ?? 6);
    const code = this.generateNumericCode(length);
    const codeHash = await bcrypt.hash(code, 10);
    const ttlSeconds = Number(this.config.get('OTP_TTL_SECONDS') ?? 300);

    const existingUser = await this.prisma.user.findUnique({ where: { phone } });

    await this.prisma.otpCode.create({
      data: {
        phone,
        userId: existingUser?.id,
        codeHash,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });

    await this.smsProvider.send(phone, `Your Koreb Homes verification code is ${code}. It expires in ${Math.round(ttlSeconds / 60)} minutes.`);

    return { message: 'Verification code sent.', expiresInSeconds: ttlSeconds };
  }

  // ---------------------------------------------------------------------
  // OTP verification -> issues tokens, creates user on first verification
  // ---------------------------------------------------------------------
  async verifyOtp(phone: string, code: string, role?: UserRole, name?: string, authenticatedUserId?: string) {
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5);

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new BadRequestException('No active verification code found. Please request a new one.');
    }
    if (otpRecord.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }
    if (otpRecord.attempts >= maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }

    const isValid = await bcrypt.compare(code, otpRecord.codeHash);
    if (!isValid) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect verification code.');
    }

    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    });

    let user;

    if (authenticatedUserId) {
      // "Attach phone" path: a Google-first (or any logged-in) user is adding a
      // phone to their EXISTING account. This is what keeps a Google user to a
      // single account with both googleId and phone, rather than spawning a
      // second phone-only account.
      const authedUser = await this.prisma.user.findUnique({ where: { id: authenticatedUserId } });
      if (!authedUser) {
        throw new UnauthorizedException('Your session is no longer valid. Please sign in again.');
      }

      // Guard against stealing a phone already tied to a different account.
      const phoneOwner = await this.prisma.user.findUnique({ where: { phone } });
      if (phoneOwner && phoneOwner.id !== authedUser.id) {
        throw new BadRequestException(
          'This phone number is already linked to another account.',
        );
      }

      user = await this.prisma.user.update({
        where: { id: authedUser.id },
        data: {
          phone,
          // Only fill name if they didn't already have one.
          name: authedUser.name ?? name,
        },
      });
    } else {
      // Standard phone-first path: find or create an account keyed by phone.
      user = await this.prisma.user.findUnique({ where: { phone } });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            phone,
            name,
            role: role ?? UserRole.BUYER_RENTER,
          },
        });
      }
    }

    if (user.isSuspended) {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    return this.issueTokens(user.id, user.phone, user.role);
  }

  // ---------------------------------------------------------------------
  // Google sign-in -> issues OUR tokens (same shape as OTP verify)
  // ---------------------------------------------------------------------
  async signInWithGoogle(profile: {
    googleId: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
    picture: string | null;
  }) {
    // 1. Already linked by googleId → straight sign-in.
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.googleId } });

    // 2. Not linked yet, but a verified email matches an existing account → link.
    //    Only when Google reports the email VERIFIED, so a matching-but-unverified
    //    email can't be used to hijack an existing account.
    if (!user && profile.email && profile.emailVerified) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: profile.googleId,
            // Backfill photo/name only if the account is missing them.
            profilePhotoUrl: byEmail.profilePhotoUrl ?? profile.picture,
            name: byEmail.name ?? profile.name,
          },
        });
      }
    }

    // 3. Brand-new user → create with no phone yet (they'll attach one later).
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          googleId: profile.googleId,
          email: profile.email,
          name: profile.name,
          profilePhotoUrl: profile.picture,
          phone: null,
          role: UserRole.BUYER_RENTER,
        },
      });
    }

    if (user.isSuspended) {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    const tokens = await this.issueTokens(user.id, user.phone, user.role);

    // needsPhone drives the frontend to run the existing phone+OTP attach step.
    // A user can browse/favorite Google-only, but must have a phone to post.
    return { ...tokens, needsPhone: user.phone === null };
  }

  // ---------------------------------------------------------------------
  // Refresh token rotation
  // ---------------------------------------------------------------------
  async refresh(userId: string, presentedRefreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isSuspended) {
      throw new UnauthorizedException('Invalid session.');
    }

    const candidates = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let matched: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (await bcrypt.compare(presentedRefreshToken, candidate.tokenHash)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      // Presented token doesn't match any active stored token — could indicate
      // token theft/reuse. Revoke all of the user's sessions defensively.
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session is no longer valid. Please log in again.');
    }

    await this.prisma.refreshToken.update({
      where: { id: matched.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user.id, user.phone, user.role);
  }

  async logout(userId: string, presentedRefreshToken?: string) {
    if (presentedRefreshToken) {
      const candidates = await this.prisma.refreshToken.findMany({
        where: { userId, revokedAt: null },
      });
      for (const candidate of candidates) {
        if (await bcrypt.compare(presentedRefreshToken, candidate.tokenHash)) {
          await this.prisma.refreshToken.update({
            where: { id: candidate.id },
            data: { revokedAt: new Date() },
          });
          break;
        }
      }
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logged out.' };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  private async issueTokens(userId: string, phone: string | null, role: UserRole) {
    const payload = { sub: userId, phone: phone ?? null, role };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') ?? '30d',
    });

    const refreshExpiresInDays = this.parseDaysFromDuration(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d',
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: await bcrypt.hash(refreshToken, 10),
        expiresAt: new Date(Date.now() + refreshExpiresInDays * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, phone, role },
    };
  }

  private generateNumericCode(length: number): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return String(randomInt(min, max + 1));
  }

  private parseDaysFromDuration(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration.trim());
    if (!match) return 30;
    const value = Number(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's':
        return value / 86400;
      case 'm':
        return value / 1440;
      case 'h':
        return value / 24;
      case 'd':
      default:
        return value;
    }
  }
}
