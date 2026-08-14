import { AuthService } from './auth.service';
import { UserRole, VerificationPurpose } from '@prisma/client';

/**
 * Tests for the password-based auth model (CR-07):
 *   - signup routes verification to email (if given) else SMS
 *   - login rejects unknown accounts and wrong passwords uniformly
 *   - login is blocked until the account is verified
 *   - password reset requires a valid code
 *   - Google sign-in mapping still holds (verified-email linking only)
 */

const jwtMock = { sign: jest.fn().mockReturnValue('signed-token') };
const configMock = { get: jest.fn().mockReturnValue('30d') };
const smsMock = { send: jest.fn() };

// A stand-in VerificationService whose issue/verify we can assert on.
const makeVerification = () => ({
  issueAndSend: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }),
  verify: jest.fn().mockResolvedValue({ destination: '[email protected]' }),
});

describe('AuthService — signup', () => {
  let service: AuthService;
  let prismaMock: any;
  let verification: any;

  beforeEach(() => {
    verification = makeVerification();
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null), // nothing exists yet
        create: jest.fn(async ({ data }: any) => ({ id: 'u1', isSuspended: false, ...data })),
      },
    };
    jest.spyOn(require('bcrypt'), 'hash').mockResolvedValue('hashed' as any);
    service = new AuthService(prismaMock, jwtMock as any, configMock as any, verification as any, smsMock as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const base = { firstName: 'Dawit', lastName: 'Alemu', phone: '+251912345678', password: 'secret12' };

  it('sends verification by EMAIL when an email is provided', async () => {
    const res: any = await service.signup({ ...base, email: '[email protected]' } as any);
    expect(res.channel).toBe('email');
    expect(verification.issueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', purpose: VerificationPurpose.EMAIL_VERIFY }),
    );
  });

  it('falls back to SMS when no email is provided', async () => {
    const res: any = await service.signup({ ...base } as any);
    expect(res.channel).toBe('sms');
    expect(verification.issueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'sms', purpose: VerificationPurpose.PHONE_VERIFY }),
    );
  });

  it('rejects a duplicate phone', async () => {
    prismaMock.user.findUnique = jest.fn().mockResolvedValue({ id: 'existing' });
    await expect(service.signup({ ...base } as any)).rejects.toThrow(/already exists/i);
  });

  it('does not let a user self-assign ADMIN', async () => {
    const res: any = await service.signup({ ...base, role: UserRole.ADMIN } as any);
    // Created role falls back to BUYER_RENTER.
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: UserRole.BUYER_RENTER }) }),
    );
    expect(res.userId).toBeDefined();
  });
});

describe('AuthService — login', () => {
  let service: AuthService;
  let prismaMock: any;

  const buildUser = (over: any = {}) => ({
    id: 'u1',
    phone: '+251912345678',
    email: '[email protected]',
    passwordHash: 'hashed',
    role: UserRole.OWNER,
    isSuspended: false,
    emailVerified: true,
    phoneVerified: false,
    ...over,
  });

  const build = (user: any) => {
    prismaMock = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };
    return new AuthService(prismaMock, jwtMock as any, configMock as any, makeVerification() as any, smsMock as any);
  };

  afterEach(() => jest.restoreAllMocks());

  it('logs in with a correct password', async () => {
    service = build(buildUser());
    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
    const res: any = await service.login('[email protected]', 'secret12');
    expect(res.accessToken).toBeDefined();
  });

  it('rejects a wrong password', async () => {
    service = build(buildUser());
    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(false as any);
    await expect(service.login('[email protected]', 'nope')).rejects.toThrow(/incorrect/i);
  });

  it('rejects an unknown account with the same generic error', async () => {
    service = build(null);
    await expect(service.login('[email protected]', 'x')).rejects.toThrow(/incorrect/i);
  });

  it('blocks login until the account is verified', async () => {
    service = build(buildUser({ emailVerified: false, phoneVerified: false }));
    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
    await expect(service.login('[email protected]', 'secret12')).rejects.toThrow(/verify/i);
  });

  it('rejects a suspended account', async () => {
    service = build(buildUser({ isSuspended: true }));
    jest.spyOn(require('bcrypt'), 'compare').mockResolvedValue(true as any);
    await expect(service.login('[email protected]', 'secret12')).rejects.toThrow(/suspended/i);
  });
});

describe('AuthService — password reset', () => {
  let service: AuthService;
  let prismaMock: any;
  let verification: any;

  beforeEach(() => {
    verification = makeVerification();
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1', email: '[email protected]', emailVerified: true, phone: '+251912345678',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
    };
    jest.spyOn(require('bcrypt'), 'hash').mockResolvedValue('hashed' as any);
    service = new AuthService(prismaMock, jwtMock as any, configMock as any, verification as any, smsMock as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('forgot-password sends the code by EMAIL when the email is verified', async () => {
    await service.forgotPassword('[email protected]');
    expect(verification.issueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', purpose: VerificationPurpose.PASSWORD_RESET }),
    );
  });

  it('forgot-password returns a generic reply for an unknown account (no enumeration)', async () => {
    prismaMock.user.findUnique = jest.fn().mockResolvedValue(null);
    const res: any = await service.forgotPassword('[email protected]');
    expect(res.message).toMatch(/if an account exists/i);
    expect(verification.issueAndSend).not.toHaveBeenCalled();
  });

  it('reset revokes all sessions after changing the password', async () => {
    await service.resetPassword('[email protected]', '123456', 'newpass12');
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
    );
  });
});

describe('AuthService — Google sign-in mapping (still holds under CR-07)', () => {
  let service: AuthService;
  let prismaMock: any;
  let usersByGoogleId: Record<string, any>;
  let usersByEmail: Record<string, any>;

  beforeEach(() => {
    usersByGoogleId = {};
    usersByEmail = {};
    prismaMock = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.googleId) return usersByGoogleId[where.googleId] ?? null;
          if (where.email) return usersByEmail[where.email] ?? null;
          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const u = { id: 'new', isSuspended: false, ...data };
          if (data.googleId) usersByGoogleId[data.googleId] = u;
          return u;
        }),
        update: jest.fn(async ({ data }: any) => ({ id: 'linked', isSuspended: false, ...data })),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new AuthService(prismaMock, jwtMock as any, configMock as any, makeVerification() as any, smsMock as any);
  });

  const profile = (over: any = {}) => ({
    googleId: 'g-123', email: '[email protected]', emailVerified: true,
    name: 'Dawit', picture: null, ...over,
  });

  it('creates a new phone-less account for a first-time Google user', async () => {
    const res: any = await service.signInWithGoogle(profile());
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(res.needsPhone).toBe(true);
  });

  it('does NOT link by an unverified email', async () => {
    usersByEmail['[email protected]'] = { id: 'e1', googleId: null, isSuspended: false, phone: '+2519' };
    await service.signInWithGoogle(profile({ emailVerified: false }));
    expect(prismaMock.user.create).toHaveBeenCalled();
  });
});
