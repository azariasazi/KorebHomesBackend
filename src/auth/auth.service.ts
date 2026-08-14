import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../common/interfaces/sms-provider.interface';
import { UserRole, VerificationPurpose } from '@prisma/client';
import { VerificationService } from './verification.service';
import { SignupDto } from './dto/signup.dto';

// Roles a user is allowed to self-assign at signup. ADMIN / SUPER_ADMIN are
// created only by a super admin, never through public signup.
const SELF_ASSIGNABLE_ROLES: UserRole[] = [UserRole.BUYER_RENTER, UserRole.OWNER, UserRole.AGENT];

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private verification: VerificationService,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Signup — creates the account, then sends a verification code by EMAIL if
  // one was given (cheap), otherwise by SMS (fallback). The account exists
  // immediately but is unverified until the code is confirmed.
  // ---------------------------------------------------------------------
  async signup(dto: SignupDto) {
    const role = dto.role && SELF_ASSIGNABLE_ROLES.includes(dto.role) ? dto.role : UserRole.BUYER_RENTER;

    // Uniqueness checks up front for clear errors (DB unique also enforces this).
    const existingPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existingPhone) {
      throw new BadRequestException('An account with this phone number already exists. Please log in.');
    }
    if (dto.email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existingEmail) {
        throw new BadRequestException('An account with this email already exists. Please log in.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        name: `${dto.firstName} ${dto.lastName}`.trim(),
        phone: dto.phone,
        email: dto.email ?? null,
        passwordHash,
        role,
      },
    });

    // Route the verification: email if present (free), else SMS.
    const channel: 'email' | 'sms' = dto.email ? 'email' : 'sms';
    const destination = dto.email ?? dto.phone;
    const purpose = dto.email ? VerificationPurpose.EMAIL_VERIFY : VerificationPurpose.PHONE_VERIFY;

    const { expiresInSeconds } = await this.verification.issueAndSend({
      userId: user.id,
      purpose,
      channel,
      destination,
    });

    return {
      message: `Verification code sent by ${channel === 'email' ? 'email' : 'SMS'}.`,
      userId: user.id,
      channel,
      // Where the code went, lightly masked, so the frontend can say
      // "we sent a code to d***@example.com" without echoing the full value.
      sentTo: this.maskDestination(destination, channel),
      expiresInSeconds,
      verifyPurpose: purpose,
    };
  }

  // ---------------------------------------------------------------------
  // Verify the signup code (email or phone). Marks the account verified and
  // issues session tokens so the user is logged in immediately after.
  // ---------------------------------------------------------------------
  async verifySignup(userId: string, purpose: VerificationPurpose, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');

    await this.verification.verify(userId, purpose, code);

    const data: Record<string, unknown> = {};
    if (purpose === VerificationPurpose.EMAIL_VERIFY) data.emailVerified = true;
    if (purpose === VerificationPurpose.PHONE_VERIFY) data.phoneVerified = true;

    const updated = await this.prisma.user.update({ where: { id: userId }, data });

    if (updated.isSuspended) {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    return this.issueTokens(updated.id, updated.phone, updated.role);
  }

  // ---------------------------------------------------------------------
  // Login — identifier is a phone OR email, plus password.
  // ---------------------------------------------------------------------
  async login(identifier: string, password: string) {
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findUnique(
      isEmail ? { where: { email: identifier } } : { where: { phone: identifier } },
    );

    // Uniform error whether the account is missing or the password is wrong, so
    // an attacker can't probe which phones/emails have accounts.
    const invalid = () => new UnauthorizedException('Incorrect phone/email or password.');

    if (!user || !user.passwordHash) throw invalid();

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw invalid();

    if (user.isSuspended) {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    // Block login until the signup channel is verified.
    const verified = user.emailVerified || user.phoneVerified;
    if (!verified) {
      throw new ForbiddenException('Please verify your account before logging in.');
    }

    return this.issueTokens(user.id, user.phone, user.role);
  }

  // ---------------------------------------------------------------------
  // Forgot password — send a reset code to email (preferred) or SMS.
  // Always returns the same shape even if the account doesn't exist, so the
  // endpoint can't be used to discover which phones/emails are registered.
  // ---------------------------------------------------------------------
  async forgotPassword(identifier: string) {
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findUnique(
      isEmail ? { where: { email: identifier } } : { where: { phone: identifier } },
    );

    const genericReply = { message: 'If an account exists, a reset code has been sent.' };
    if (!user) return genericReply;

    // Cost rule: email if the account has a verified email, else SMS.
    const useEmail = !!user.email && user.emailVerified;
    const channel: 'email' | 'sms' = useEmail ? 'email' : 'sms';
    const destination = useEmail ? (user.email as string) : user.phone;
    if (!destination) return genericReply; // nothing to send to

    await this.verification.issueAndSend({
      userId: user.id,
      purpose: VerificationPurpose.PASSWORD_RESET,
      channel,
      destination,
    });

    return genericReply;
  }

  async resetPassword(identifier: string, code: string, newPassword: string) {
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findUnique(
      isEmail ? { where: { email: identifier } } : { where: { phone: identifier } },
    );
    if (!user) throw new BadRequestException('Invalid reset request.');

    await this.verification.verify(user.id, VerificationPurpose.PASSWORD_RESET, code);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    // Revoke all sessions after a password reset, forcing re-login everywhere.
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password updated. Please log in with your new password.' };
  }

  // Logged-in user changing their password (must know the current one).
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new NotFoundException('Account not found.');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Your current password is incorrect.');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    return { message: 'Password changed.' };
  }

  // ---------------------------------------------------------------------
  // Phone verification for an already-logged-in user. Two uses:
  //   - an email-first user verifying their phone before posting a listing
  //   - a user changing their phone (verify the NEW number before saving)
  // ---------------------------------------------------------------------
  async requestPhoneVerification(userId: string, newPhone: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');

    // Block taking a phone already tied to someone else.
    const owner = await this.prisma.user.findUnique({ where: { phone: newPhone } });
    if (owner && owner.id !== userId) {
      throw new BadRequestException('This phone number is already linked to another account.');
    }

    const { expiresInSeconds } = await this.verification.issueAndSend({
      userId,
      purpose: VerificationPurpose.PHONE_VERIFY,
      channel: 'sms',
      destination: newPhone,
    });

    return { message: 'Verification code sent by SMS.', expiresInSeconds };
  }

  async confirmPhoneVerification(userId: string, code: string) {
    const { destination } = await this.verification.verify(
      userId,
      VerificationPurpose.PHONE_VERIFY,
      code,
    );

    // Re-check the number is still free at confirm time (guards a race where two
    // users verify the same number concurrently).
    const owner = await this.prisma.user.findUnique({ where: { phone: destination } });
    if (owner && owner.id !== userId) {
      throw new BadRequestException('This phone number is already linked to another account.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: destination, phoneVerified: true },
    });

    return { message: 'Phone verified.', phone: updated.phone };
  }

  // ---------------------------------------------------------------------
  // Email change for a logged-in user — verify the NEW address before saving,
  // so a typo can't lock someone out and the old email stays active until the
  // new one is confirmed.
  // ---------------------------------------------------------------------
  async requestEmailChange(userId: string, newEmail: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');

    const owner = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (owner && owner.id !== userId) {
      throw new BadRequestException('This email is already linked to another account.');
    }

    const { expiresInSeconds } = await this.verification.issueAndSend({
      userId,
      purpose: VerificationPurpose.EMAIL_VERIFY,
      channel: 'email',
      destination: newEmail,
    });

    return { message: 'Verification code sent to the new email.', expiresInSeconds };
  }

  async confirmEmailChange(userId: string, code: string) {
    const { destination } = await this.verification.verify(
      userId,
      VerificationPurpose.EMAIL_VERIFY,
      code,
    );

    const owner = await this.prisma.user.findUnique({ where: { email: destination } });
    if (owner && owner.id !== userId) {
      throw new BadRequestException('This email is already linked to another account.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { email: destination, emailVerified: true },
    });

    return { message: 'Email updated.', email: updated.email };
  }

  private maskDestination(destination: string, channel: 'email' | 'sms'): string {
    if (channel === 'email') {
      const [local, domain] = destination.split('@');
      if (!domain) return destination;
      const shown = local.slice(0, 1);
      return `${shown}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
    }
    // phone: show last 2 digits
    return `${'*'.repeat(Math.max(0, destination.length - 2))}${destination.slice(-2)}`;
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
