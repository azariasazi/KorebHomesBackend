import { IsString } from 'class-validator';

export class InitiateListingPaymentDto {
  @IsString()
  listingId: string;
}
