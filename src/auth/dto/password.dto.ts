import { IsEmail, IsOptional, IsPhoneNumber, IsString, Length, MaxLength, MinLength } from 'class-validator';

/** Verify an emailed/SMSed code for the current signup (email or phone). */
export class VerifyCodeDto {
  @IsString()
  @Length(4, 8)
  code: string;
}

/** Kick off a password reset by identifier (phone or email). */
export class ForgotPasswordDto {
  @IsString()
  @MinLength(3)
  identifier: string;
}

/** Complete a password reset with the code sent to the user's channel. */
export class ResetPasswordDto {
  @IsString()
  @MinLength(3)
  identifier: string;

  @IsString()
  @Length(4, 8)
  code: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  newPassword: string;
}

/** Logged-in user changing their password (knows the current one). */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  newPassword: string;
}

/** Request a fresh verification code be re-sent (email or phone) for signup. */
export class ResendVerificationDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;
}
