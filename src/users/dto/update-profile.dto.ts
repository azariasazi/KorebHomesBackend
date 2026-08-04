import { IsOptional, IsPhoneNumber, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

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
