import { AuthService } from './auth.service';
import { UserRole } from '@prisma/client';

/**
 * Covers the Google sign-in account mapping (CR-05) and the phone-attach flow.
 * The two failure modes we most want to prevent:
 *   - duplicate accounts (Google user ends up with two records)
 *   - account hijacking (linking by an UNVERIFIED email)
 */
describe('AuthService — Google sign-in mapping', () => {
  let service: AuthService;
  let prismaMock: any;
  let usersByGoogleId: Record<string, any>;
  let usersByEmail: Record<string, any>;

  const jwtMock = { sign: jest.fn().mockReturnValue('signed-token') };
  const configMock = { get: jest.fn().mockReturnValue('30d') };
  const smsMock = { send: jest.fn() };

  beforeEach(() => {
    usersByGoogleId = {};
    usersByEmail = {};

    prismaMock = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.googleId) return usersByGoogleId[where.googleId] ?? null;
          if (where.email) return usersByEmail[where.email] ?? null;
          if (where.id) {
            return (
              Object.values(usersByGoogleId).find((u: any) => u.id === where.id) ??
              Object.values(usersByEmail).find((u: any) => u.id === where.id) ??
              null
            );
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const user = { id: 'new-user-id', isSuspended: false, ...data };
          if (data.googleId) usersByGoogleId[data.googleId] = user;
          if (data.email) usersByEmail[data.email] = user;
          return user;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const existing =
            Object.values(usersByGoogleId).find((u: any) => u.id === where.id) ??
            Object.values(usersByEmail).find((u: any) => u.id === where.id);
          const merged = { ...existing, ...data };
          if (merged.googleId) usersByGoogleId[merged.googleId] = merged;
          if (merged.email) usersByEmail[merged.email] = merged;
          return merged;
        }),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };

    service = new AuthService(prismaMock, jwtMock as any, configMock as any, smsMock as any);
  });

  const googleProfile = (over: Partial<any> = {}) => ({
    googleId: 'google-sub-123',
    email: '[email protected]',
    emailVerified: true,
    name: 'Dawit Alemu',
    picture: 'https://photo',
    ...over,
  });

  it('creates a new phone-less account for a first-time Google user', async () => {
    const result: any = await service.signInWithGoogle(googleProfile());
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(result.needsPhone).toBe(true); // no phone yet
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  it('signs a returning Google user straight in (no duplicate created)', async () => {
    usersByGoogleId['google-sub-123'] = {
      id: 'existing-1',
      googleId: 'google-sub-123',
      phone: '+251911111111',
      role: UserRole.OWNER,
      isSuspended: false,
    };
    const result: any = await service.signInWithGoogle(googleProfile());
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(result.needsPhone).toBe(false); // already has a phone
  });

  it('links Google to an existing account when the email is VERIFIED', async () => {
    usersByEmail['[email protected]'] = {
      id: 'phone-user-1',
      phone: '+251911111111',
      email: '[email protected]',
      googleId: null,
      role: UserRole.OWNER,
      isSuspended: false,
      name: 'Dawit',
      profilePhotoUrl: null,
    };
    const result: any = await service.signInWithGoogle(googleProfile({ emailVerified: true }));
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(result.needsPhone).toBe(false); // linked account already had a phone
  });

  it('does NOT link by an UNVERIFIED email — creates a fresh account instead', async () => {
    usersByEmail['[email protected]'] = {
      id: 'phone-user-1',
      phone: '+251911111111',
      email: '[email protected]',
      googleId: null,
      role: UserRole.OWNER,
      isSuspended: false,
    };
    await service.signInWithGoogle(googleProfile({ emailVerified: false }));
    // Must not hijack the existing account; a new one is created.
    expect(prismaMock.user.create).toHaveBeenCalled();
  });
});

describe('AuthService — attach phone to an authenticated (Google-first) user', () => {
  let service: AuthService;
  let prismaMock: any;

  const jwtMock = { sign: jest.fn().mockReturnValue('signed-token') };
  const configMock = { get: jest.fn().mockReturnValue('30d') };
  const smsMock = { send: jest.fn() };

  const googleUser = {
    id: 'google-user-1',
    googleId: 'g-1',
    phone: null,
    name: 'Dawit',
    role: UserRole.BUYER_RENTER,
    isSuspended: false,
  };

  beforeEach(() => {
    prismaMock = {
      otpCode: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'otp-1',
          codeHash: '$2b$10$hashplaceholder',
          attempts: 0,
          expiresAt: new Date(Date.now() + 60000),
          consumedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === 'google-user-1') return googleUser;
          if (where.phone) return null; // phone not used by anyone else
          return null;
        }),
        update: jest.fn(async ({ data }: any) => ({ ...googleUser, ...data })),
        create: jest.fn(),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new AuthService(prismaMock, jwtMock as any, configMock as any, smsMock as any);
    // bcrypt.compare will fail on the placeholder hash, so stub it to succeed.
    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
    jest.spyOn(require('bcrypt'), 'hash').mockResolvedValue('hashed' as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('attaches the phone to the existing account instead of creating a new one', async () => {
    await service.verifyOtp('+251922222222', '123456', undefined, undefined, 'google-user-1');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'google-user-1' },
        data: expect.objectContaining({ phone: '+251922222222' }),
      }),
    );
  });

  it('refuses to attach a phone already linked to a different account', async () => {
    prismaMock.user.findUnique = jest.fn(async ({ where }: any) => {
      if (where.id === 'google-user-1') return googleUser;
      if (where.phone) return { id: 'someone-else', phone: where.phone };
      return null;
    });
    await expect(
      service.verifyOtp('+251922222222', '123456', undefined, undefined, 'google-user-1'),
    ).rejects.toThrow();
  });
});

describe('AuthService — signup vs login flow (CR-06)', () => {
  let service: AuthService;
  let prismaMock: any;
  let existingUser: any;

  const jwtMock = { sign: jest.fn().mockReturnValue('signed-token') };
  const configMock = { get: jest.fn().mockReturnValue('30d') };
  const smsMock = { send: jest.fn() };

  const buildService = (userForPhone: any) => {
    existingUser = userForPhone;
    prismaMock = {
      otpCode: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'otp-1',
          codeHash: '$2b$10$placeholder',
          attempts: 0,
          expiresAt: new Date(Date.now() + 60000),
          consumedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        // No authenticatedUserId in these tests, so only the phone lookup matters.
        findUnique: jest.fn(async ({ where }: any) => (where.phone ? existingUser : null)),
        create: jest.fn(async ({ data }: any) => ({ id: 'created-id', isSuspended: false, ...data })),
        update: jest.fn(),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };
    const s = new AuthService(prismaMock, jwtMock as any, configMock as any, smsMock as any);
    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
    jest.spyOn(require('bcrypt'), 'hash').mockResolvedValue('hashed' as any);
    return s;
  };

  afterEach(() => jest.restoreAllMocks());

  const { AuthFlow } = require('./dto/verify-otp.dto');

  it('LOGIN + no account → throws 404, does NOT create', async () => {
    service = buildService(null);
    await expect(
      service.verifyOtp('+251912345678', '123456', undefined, undefined, undefined, AuthFlow.LOGIN),
    ).rejects.toThrow(/no account found/i);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('LOGIN + account exists → logs in, no account created', async () => {
    service = buildService({
      id: 'u1',
      phone: '+251912345678',
      role: 'OWNER',
      isSuspended: false,
    });
    const res: any = await service.verifyOtp(
      '+251912345678', '123456', undefined, undefined, undefined, AuthFlow.LOGIN,
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(res.accessToken).toBeDefined();
  });

  it('SIGNUP + no account → creates the account', async () => {
    service = buildService(null);
    await service.verifyOtp(
      '+251912345678', '123456', 'OWNER' as any, 'Dawit', undefined, AuthFlow.SIGNUP,
    );
    expect(prismaMock.user.create).toHaveBeenCalled();
  });

  it('SIGNUP + account exists → logs in without duplicating', async () => {
    service = buildService({
      id: 'u1',
      phone: '+251912345678',
      role: 'OWNER',
      isSuspended: false,
    });
    await service.verifyOtp(
      '+251912345678', '123456', undefined, undefined, undefined, AuthFlow.SIGNUP,
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('flow omitted (old frontend) → defaults to signup, still creates', async () => {
    service = buildService(null);
    // No flow arg at all — mimics a cached frontend build.
    await service.verifyOtp('+251912345678', '123456', 'OWNER' as any, 'Dawit');
    expect(prismaMock.user.create).toHaveBeenCalled();
  });
});
