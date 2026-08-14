import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** Phone number OR email address — the service figures out which. */
  @IsString()
  @MinLength(3)
  identifier: string;

  @IsString()
  @MinLength(1)
  password: string;
}
