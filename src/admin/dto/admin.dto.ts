import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingRejectionCode } from '@prisma/client';

export class RejectListingDto {
  /** Required. One of the ListingRejectionCode values. */
  @IsEnum(ListingRejectionCode, {
    message: `code must be one of: ${Object.values(ListingRejectionCode).join(', ')}`,
  })
  code: ListingRejectionCode;

  /** Optional free-text context from the admin, shown to the owner. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
