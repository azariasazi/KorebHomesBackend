import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ListingsModule } from '../listings/listings.module';
import { PAYMENT_PROVIDER } from '../common/interfaces/payment-provider.interface';
import { ChapaProvider } from './providers/chapa.provider';

@Module({
  imports: [ListingsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    // Swap ChapaProvider for another gateway implementing PaymentProvider
    // (or a direct Telebirr/CBE integration) without touching PaymentsService.
    { provide: PAYMENT_PROVIDER, useClass: ChapaProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
