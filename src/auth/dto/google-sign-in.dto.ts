import { IsString, IsNotEmpty } from 'class-validator';

export class GoogleSignInDto {
  /** The Google ID token obtained by the frontend's Google SDK. */
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
