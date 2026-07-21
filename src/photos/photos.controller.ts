import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PhotosService } from './photos.service';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // keep in sync with MAX_PHOTO_UPLOAD_SIZE_MB default

@Controller('listings/:listingId/photos')
export class PhotosController {
  constructor(private photosService: PhotosService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Only image files are allowed.'), false);
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @Param('listingId') listingId: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.photosService.addPhoto(listingId, userId, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Post('reorder')
  reorder(
    @Param('listingId') listingId: string,
    @CurrentUser('id') userId: string,
    @Body('orderedPhotoIds') orderedPhotoIds: string[],
  ) {
    return this.photosService.reorder(listingId, userId, orderedPhotoIds);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.AGENT)
  @Delete(':photoId')
  remove(@Param('photoId') photoId: string, @CurrentUser('id') userId: string) {
    return this.photosService.removePhoto(photoId, userId);
  }
}
