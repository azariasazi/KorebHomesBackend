import { IsEnum, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { UserRole } from '@prisma/client';

export enum AuthFlow {
  SIGNUP = 'signup',
  LOGIN = 'login',
}

export class VerifyOtpDto {
  @IsPhoneNumber(undefined, { message: 'Please provide a valid phone number, e.g. +251912345678' })
  phone: string;

  @IsString()
  @Length(4, 8)
  code: string;

  /**
   * The caller's intent, so the backend can distinguish "I'm creating an
   * account" from "I'm logging in":
   *   - signup: create the account if it doesn't exist (permissive).
   *   - login:  never create — return 404 if there's no account (strict).
   *
   * Optional for backward compatibility: an older frontend build that omits it
   * defaults to signup (today's permissive behavior) so nothing breaks
   * mid-rollout. Remove the fallback once the frontend always sends `flow`.
   *
   * Ignored on the "attach phone to a logged-in account" path (that's neither
   * signup nor login).
   */
  @IsOptional()
  @IsEnum(AuthFlow, { message: "flow must be either 'signup' or 'login'." })
  flow?: AuthFlow;

  /**
   * Only relevant the first time a phone number verifies (i.e. sign up).
   * Ignored on subsequent logins for an existing user.
   */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  name?: string;
}
