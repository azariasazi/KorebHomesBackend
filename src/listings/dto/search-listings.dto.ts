import { PropertyType, ListingType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsNumber, IsString, Max, Min } from 'class-validator';

export enum ListingSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
}

export class SearchListingsDto {
  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  subCity?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @IsOptional()
  @IsEnum(ListingType)
  listingType?: ListingType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minBedrooms?: number;

  // Simple bounding-box map search: swLat/swLng to neLat/neLng
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  swLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  swLng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  neLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  neLng?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(ListingSort)
  sort?: ListingSort = ListingSort.NEWEST;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}
