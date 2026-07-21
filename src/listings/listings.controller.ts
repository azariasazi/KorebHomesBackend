import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';

@Controller('listings')
export class ListingsController {
  constructor(private listingsService: ListingsService) {}

  // ---- Public browsing ----
  @Get()
  search(@Query() query: SearchListingsDto) {
    return this.listingsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listingsService.findOnePublic(id);
  }

  // ---- Owner/Agent ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateListingDto) {
    return this.listingsService.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Get('mine/dashboard')
  findMine(@CurrentUser('id') userId: string) {
    return this.listingsService.findMine(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Get('mine/:id')
  findOneOwned(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.listingsService.findOneOwned(id, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: UpdateListingDto) {
    return this.listingsService.update(id, userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.listingsService.remove(id, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Post(':id/submit-for-payment')
  markReadyForPayment(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.listingsService.markReadyForPayment(id, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Post(':id/renew')
  renew(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.listingsService.renew(id, userId);
  }
}
