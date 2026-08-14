import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class SignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName: string;

  @IsPhoneNumber(undefined, { message: 'Please provide a valid phone number, e.g. +251912345678' })
  phone: string;

  /** Optional for regular users; the service requires it for ADMIN/SUPER_ADMIN. */
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;

  /** Buyer/renter, owner, or agent. Cannot self-assign ADMIN/SUPER_ADMIN. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
