import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FavoritesService } from './favorites.service';

@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private favoritesService: FavoritesService) {}

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.favoritesService.list(userId);
  }

  @Post(':listingId')
  add(@Param('listingId') listingId: string, @CurrentUser('id') userId: string) {
    return this.favoritesService.add(userId, listingId);
  }

  @Delete(':listingId')
  remove(@Param('listingId') listingId: string, @CurrentUser('id') userId: string) {
    return this.favoritesService.remove(userId, listingId);
  }
}
