import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { SMS_PROVIDER } from '../common/interfaces/sms-provider.interface';
import { ConsoleSmsProvider } from './providers/sms/console-sms.provider';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    // Swap ConsoleSmsProvider for a real implementation of SmsProvider when a
    // production SMS account is ready — nothing else in the app changes.
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
  ],
  exports: [AuthService],
})
export class AuthModule {}
