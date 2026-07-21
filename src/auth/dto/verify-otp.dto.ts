import { IsEnum, IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';
import { UserRole } from '@prisma/client';

export class VerifyOtpDto {
  @IsPhoneNumber(undefined, { message: 'Please provide a valid phone number, e.g. +251912345678' })
  phone: string;

  @IsString()
  @Length(4, 8)
  code: string;

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
