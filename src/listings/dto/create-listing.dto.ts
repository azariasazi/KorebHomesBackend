import { PropertyType, ListingType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateListingDto {
  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @IsEnum(ListingType)
  listingType: ListingType;

  @IsNumber()
  @IsPositive()
  priceEtb: number;

  @IsString()
  region: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  subCity?: string;

  @IsOptional()
  @IsString()
  areaName?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeSqm?: number;

  // --- Building / unit identification ---

  /** PUBLIC. Strongly encouraged in the UI for apartments. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(120)
  buildingName?: string;

  /**
   * PRIVATE — captured but never published (see §2 of the change request).
   * Required when propertyType === APARTMENT, optional otherwise.
   */
  @ValidateIf((o) => o.propertyType === PropertyType.APARTMENT)
  @IsString({ message: 'Unit number is required for apartments.' })
  @IsNotEmpty({ message: 'Unit number is required for apartments.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(20)
  unitNumber?: string;

  /** PUBLIC. -1 = basement, 0 = ground, 1+ = upper floors. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1, { message: 'Floor number cannot be below -1.' })
  @Max(100, { message: 'Floor number looks like a typo — must be 100 or below.' })
  floorNumber?: number;

  @IsOptional()
  @IsBoolean()
  furnished?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  descriptionAm?: string;
}
