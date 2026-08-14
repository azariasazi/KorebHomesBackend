import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName: string;

  // Email is REQUIRED for admin accounts (product decision).
  @IsEmail({}, { message: 'A valid email is required for an admin account.' })
  email: string;

  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'Please provide a valid phone number.' })
  phone?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;
}
