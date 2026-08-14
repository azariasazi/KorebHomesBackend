import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VerificationPurpose } from '@prisma/client';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './providers/google-auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyCodeDto,
} from './dto/password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { JwtRefreshGuard } from '../common/guards/jwt-refresh.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleAuthService: GoogleAuthService,
  ) {}

  // ---- Signup + verification ----
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  /**
   * Verify the code sent at signup. `userId` comes from the signup response.
   * The purpose (email vs phone) is whichever channel signup used.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyCodeDto & { userId: string }) {
    return this.authService.verifySignup(dto.userId, VerificationPurpose.EMAIL_VERIFY, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-phone-signup')
  verifyPhoneSignup(@Body() dto: VerifyCodeDto & { userId: string }) {
    return this.authService.verifySignup(dto.userId, VerificationPurpose.PHONE_VERIFY, dto.code);
  }

  // ---- Login ----
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identifier, dto.password);
  }

  // ---- Password reset ----
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.identifier);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.identifier, dto.code, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  // ---- Phone verification for a logged-in user (pre-posting gate / change) ----
  @UseGuards(JwtAuthGuard)
  @Post('phone/request')
  requestPhone(@CurrentUser('id') userId: string, @Body('phone') phone: string) {
    return this.authService.requestPhoneVerification(userId, phone);
  }

  @UseGuards(JwtAuthGuard)
  @Post('phone/verify')
  confirmPhone(@CurrentUser('id') userId: string, @Body() dto: VerifyCodeDto) {
    return this.authService.confirmPhoneVerification(userId, dto.code);
  }

  // ---- Email change for a logged-in user (verify new address first) ----
  @UseGuards(JwtAuthGuard)
  @Post('email/request')
  requestEmail(@CurrentUser('id') userId: string, @Body('email') email: string) {
    return this.authService.requestEmailChange(userId, email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('email/verify')
  confirmEmail(@CurrentUser('id') userId: string, @Body() dto: VerifyCodeDto) {
    return this.authService.confirmEmailChange(userId, dto.code);
  }

  // ---- Google ----
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('google')
  async googleSignIn(@Body() dto: GoogleSignInDto) {
    const profile = await this.googleAuthService.verifyIdToken(dto.idToken);
    return this.authService.signInWithGoogle(profile);
  }

  // ---- Session ----
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
