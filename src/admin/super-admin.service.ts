import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';

/**
 * SUPER_ADMIN-only operations: creating and removing ADMIN accounts.
 *
 * All methods here are reached through routes guarded to SUPER_ADMIN, but the
 * service re-checks the important invariants itself (defense in depth): the
 * super admin can't be created or deleted through here, and admins always have
 * a verified-capable email since email is required for staff accounts.
 */
@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService) {}

  async createAdmin(dto: CreateAdminDto) {
    // Email is required for admins (product decision) — the DTO enforces
    // presence; here we enforce uniqueness with a clear message.
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new BadRequestException('An account with this email already exists.');
    }
    if (dto.phone) {
      const existingPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (existingPhone) {
        throw new BadRequestException('An account with this phone number already exists.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const admin = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        name: `${dto.firstName} ${dto.lastName}`.trim(),
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash,
        role: UserRole.ADMIN,
        // Staff accounts are created already-verified — they're set up by the
        // super admin directly, not through public signup.
        emailVerified: true,
        phoneVerified: !!dto.phone,
      },
    });

    return this.toAdminSummary(admin);
  }

  async listAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } },
      orderBy: { createdAt: 'asc' },
    });
    return admins.map((a) => this.toAdminSummary(a));
  }

  async removeAdmin(targetUserId: string, actingSuperAdminId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Admin not found.');

    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('The super admin account cannot be removed.');
    }
    if (target.role !== UserRole.ADMIN) {
      throw new BadRequestException('That account is not an admin.');
    }
    if (target.id === actingSuperAdminId) {
      // Belt-and-braces: a super admin isn't an ADMIN, but never let anyone
      // delete their own acting account here.
      throw new ForbiddenException('You cannot remove your own account.');
    }

    // Demote rather than hard-delete, so their audit trail (approvals,
    // verifications) stays intact. They lose all admin access immediately.
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: UserRole.BUYER_RENTER },
    });

    return { message: 'Admin access revoked.' };
  }

  private toAdminSummary(user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    role: UserRole;
    isSuspended: boolean;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isSuspended: user.isSuspended,
      createdAt: user.createdAt,
    };
  }
}
