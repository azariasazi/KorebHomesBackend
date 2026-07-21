import { Module } from '@nestjs/common';
import { ListingInactivityJob } from './listing-inactivity.job';

@Module({
  providers: [ListingInactivityJob],
})
export class JobsModule {}
