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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
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
    };
  }

  private toPublicProfile(user: {
    id: string;
    phone: string;
    name: string | null;
    profilePhotoUrl: string | null;
    city: string | null;
    role: UserRole;
    verificationStatus: VerificationStatus;
    agencyName: string | null;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      profilePhotoUrl: user.profilePhotoUrl,
      city: user.city,
      role: user.role,
      verificationStatus: user.verificationStatus,
      agencyName: user.agencyName,
      createdAt: user.createdAt,
    };
  }
}
