import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitVerificationDto {
  @IsString()
  documentUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  agencyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
