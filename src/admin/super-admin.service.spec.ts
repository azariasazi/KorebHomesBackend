import { AdminService } from './admin.service';
import { SuperAdminService } from './super-admin.service';
import { UserRole } from '@prisma/client';

/**
 * Guards the role hierarchy (CR-07):
 *   - a regular ADMIN cannot suspend another ADMIN
 *   - nobody can suspend the SUPER_ADMIN
 *   - only SUPER_ADMIN can create/remove admins
 *   - the super admin account can't be removed
 */

describe('AdminService — suspend permission hierarchy', () => {
  let service: AdminService;
  let prismaMock: any;

  const build = (targetRole: UserRole) => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 't1', role: targetRole }),
        update: jest.fn(async ({ data }: any) => ({ id: 't1', ...data })),
      },
    };
    return new AdminService(prismaMock);
  };

  it('a regular ADMIN cannot suspend another ADMIN', async () => {
    service = build(UserRole.ADMIN);
    await expect(service.suspendUser(UserRole.ADMIN, 't1', 'reason')).rejects.toThrow(/only the super admin/i);
  });

  it('a SUPER_ADMIN can suspend an ADMIN', async () => {
    service = build(UserRole.ADMIN);
    const res: any = await service.suspendUser(UserRole.SUPER_ADMIN, 't1', 'reason');
    expect(res.isSuspended).toBe(true);
  });

  it('nobody can suspend the SUPER_ADMIN', async () => {
    service = build(UserRole.SUPER_ADMIN);
    await expect(service.suspendUser(UserRole.SUPER_ADMIN, 't1', 'x')).rejects.toThrow(/cannot be suspended/i);
  });

  it('a regular ADMIN can suspend a normal user', async () => {
    service = build(UserRole.OWNER);
    const res: any = await service.suspendUser(UserRole.ADMIN, 't1', 'spam');
    expect(res.isSuspended).toBe(true);
  });
});

describe('SuperAdminService — admin management', () => {
  let service: SuperAdminService;
  let prismaMock: any;

  beforeEach(() => {
    jest.spyOn(require('bcrypt'), 'hash').mockResolvedValue('hashed' as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates an admin with a hashed password and verified email', async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 'a1', createdAt: new Date(), ...data })),
      },
    };
    service = new SuperAdminService(prismaMock);
    const res: any = await service.createAdmin({
      firstName: 'Sara', lastName: 'M', email: '[email protected]', password: 'secret12',
    } as any);
    expect(res.role).toBe(UserRole.ADMIN);
    const created = prismaMock.user.create.mock.calls[0][0].data;
    expect(created.passwordHash).toBe('hashed');
    expect(created.emailVerified).toBe(true);
  });

  it('rejects a duplicate admin email', async () => {
    prismaMock = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) },
    };
    service = new SuperAdminService(prismaMock);
    await expect(
      service.createAdmin({ firstName: 'S', lastName: 'M', email: '[email protected]', password: 'secret12' } as any),
    ).rejects.toThrow(/already exists/i);
  });

  it('refuses to remove the super admin', async () => {
    prismaMock = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 's1', role: UserRole.SUPER_ADMIN }) },
    };
    service = new SuperAdminService(prismaMock);
    await expect(service.removeAdmin('s1', 'acting')).rejects.toThrow(/cannot be removed/i);
  });

  it('demotes a removed admin to BUYER_RENTER (keeps audit trail)', async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'a1', role: UserRole.ADMIN }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new SuperAdminService(prismaMock);
    await service.removeAdmin('a1', 'acting-super');
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: UserRole.BUYER_RENTER } }),
    );
  });
});
