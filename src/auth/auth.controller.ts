import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './providers/google-auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { JwtRefreshGuard } from '../common/guards/jwt-refresh.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleAuthService: GoogleAuthService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.phone);
  }

  /**
   * Verifies an OTP. If the caller is already authenticated (valid access token),
   * the verified phone is ATTACHED to their existing account — this is how a
   * Google-first user ends up with one account holding both googleId and phone.
   * Anonymous callers get the normal create/find-by-phone behaviour.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto, @CurrentUser('id') authenticatedUserId?: string) {
    return this.authService.verifyOtp(dto.phone, dto.code, dto.role, dto.name, authenticatedUserId, dto.flow);
  }

  /**
   * "Continue with Google." The frontend runs the Google SDK and posts the
   * resulting ID token here. We verify it server-side, find/create/link the
   * Koreb account, and return OUR OWN session tokens (same shape as OTP verify)
   * plus `needsPhone` — true when the account has no phone yet.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('google')
  async googleSignIn(@Body() dto: GoogleSignInDto) {
    const profile = await this.googleAuthService.verifyIdToken(dto.idToken);
    return this.authService.signInWithGoogle(profile);
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  refresh(@CurrentUser() user: { id: string; refreshToken: string }, @Body() _dto: RefreshTokenDto) {
    return this.authService.refresh(user.id, user.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser('id') userId: string, @Body() dto: RefreshTokenDto) {
    return this.authService.logout(userId, dto.refreshToken);
  }
}
