import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { UserRole, VerificationStatus } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return this.toPublicProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Record<string, unknown> = { ...dto };

    // An empty string means "clear my public number and fall back to my account
    // phone" — store it as null rather than an empty string.
    if (dto.publicContactPhone === '') {
      data.publicContactPhone = null;
    }

    // Keep the composed `name` in sync when either name part changes.
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      const current = await this.prisma.user.findUnique({ where: { id: userId } });
      const first = dto.firstName ?? current?.firstName ?? '';
      const last = dto.lastName ?? current?.lastName ?? '';
      data.name = `${first} ${last}`.trim();
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toPublicProfile(user);
  }

  async submitVerification(userId: string, dto: SubmitVerificationDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== UserRole.AGENT) {
      throw new BadRequestException('Only Agent accounts can submit verification documents.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        verificationDocUrl: dto.documentUrl,
        agencyName: dto.agencyName ?? user.agencyName,
        verificationNote: dto.note,
        verificationStatus: VerificationStatus.PENDING,
      },
    });

    return this.toPublicProfile(updated);
  }

  /** Public-facing agent/owner info shown on a listing detail page. */
  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return {
      id: user.id,
      name: user.name,
      profilePhotoUrl: user.profilePhotoUrl,
      role: user.role,
      agencyName: user.agencyName,
      isVerifiedAgent: user.role === UserRole.AGENT && user.verificationStatus === VerificationStatus.APPROVED,
      // Public contact number if the user set one, else their account phone.
      // Powers the Call / WhatsApp buttons on Listing Detail.
      contactPhone: user.publicContactPhone ?? user.phone ?? null,
    };
  }

  private toPublicProfile(user: {
    id: string;
    phone: string | null;
    phoneVerified: boolean;
    email: string | null;
    emailVerified: boolean;
    googleId: string | null;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
    profilePhotoUrl: string | null;
    city: string | null;
    role: UserRole;
    verificationStatus: VerificationStatus;
    agencyName: string | null;
    publicContactPhone: string | null;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      email: user.email,
      emailVerified: user.emailVerified,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      profilePhotoUrl: user.profilePhotoUrl,
      city: user.city,
      role: user.role,
      verificationStatus: user.verificationStatus,
      agencyName: user.agencyName,
      publicContactPhone: user.publicContactPhone,
      // What actually shows on this user's listings today: their public number
      // if set, otherwise their account phone (the informed-default behaviour).
      effectiveContactPhone: user.publicContactPhone ?? user.phone,
      // Account-state flags for the frontend:
      hasGoogleLinked: user.googleId !== null,
      // True when the account has no phone yet — the frontend must verify a
      // phone before this user can post a listing.
      needsPhone: user.phone === null,
      createdAt: user.createdAt,
    };
  }
}
