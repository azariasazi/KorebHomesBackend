import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

@Controller('listings/:listingId/report')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // Logged in so we can (optionally) attribute the report and rate-limit abuse.
  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('listingId') listingId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(listingId, userId, dto);
  }
}
