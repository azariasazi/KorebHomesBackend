import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
/**
 * Attach to any controller/handler to restrict access to specific roles.
 * Must be combined with JwtAuthGuard + RolesGuard.
 *
 * Example: @Roles(UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
