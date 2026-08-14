import { IsOptional, IsPhoneNumber, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * The INSTANT tier of profile editing — fields a user can change freely with no
 * re-verification. Email and phone are deliberately NOT here: those are login
 * identifiers and are changed through the verified flows in AuthController
 * (/auth/phone/request+verify, /auth/email/request+verify).
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  profilePhotoUrl?: string;

  /**
   * Public contact number shown on the user's listings (Call / WhatsApp).
   * Separate from the login phone. Send an empty string to clear it and fall
   * back to the account phone. Validated as a real phone number when present.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== '')
  @IsPhoneNumber(undefined, {
    message: 'Public contact number must be a valid phone number, e.g. +251912345678.',
  })
  publicContactPhone?: string;
}
