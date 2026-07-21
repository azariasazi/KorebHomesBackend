import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class RejectListingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class SuspendUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class RejectVerificationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class UpdateSettingDto {
  @IsString()
  value: string;
}

export class ReviewQueueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
