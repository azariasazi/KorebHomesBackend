import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { InitiateListingPaymentDto } from './dto/initiate-listing-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('listing/initiate')
  initiateListingPayment(@CurrentUser('id') userId: string, @Body() dto: InitiateListingPaymentDto) {
    return this.paymentsService.initiateListingPayment(userId, dto.listingId);
  }

  /**
   * Public endpoint hit by Chapa's servers. Authenticity is enforced by
   * verifying the signature header + independently re-verifying the tx with
   * Chapa — not by a JWT. Needs the raw body, captured in main.ts/module.
   */
  @Post('webhook')
  handleWebhook(@Req() req: Request & { rawBody?: Buffer }, @Body() body: any) {
    const signature = (req.headers['chapa-signature'] ?? req.headers['x-chapa-signature']) as string | undefined;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    return this.paymentsService.handleWebhook(raw, signature, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify')
  verify(@CurrentUser('id') userId: string, @Body('txRef') txRef: string) {
    return this.paymentsService.verifyAndSettle(userId, txRef);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  myPayments(@CurrentUser('id') userId: string) {
    return this.paymentsService.getMyPayments(userId);
  }
}
