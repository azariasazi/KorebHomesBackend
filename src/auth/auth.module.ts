import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GoogleAuthService } from './providers/google-auth.service';
import { SMS_PROVIDER } from '../common/interfaces/sms-provider.interface';
import { ConsoleSmsProvider } from './providers/sms/console-sms.provider';
import { EMAIL_PROVIDER } from '../common/interfaces/email-provider.interface';
import { ConsoleEmailProvider } from './providers/email/console-email.provider';
// import { SmtpEmailProvider } from './providers/email/smtp-email.provider';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    VerificationService,
    GoogleAuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    // Swap ConsoleSmsProvider for a real SmsProvider when the SMS account is ready.
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
    // Email: ConsoleEmailProvider logs to the server for development. When the
    // hosting mailbox's SMTP settings are in .env, swap the line below for
    // `{ provide: EMAIL_PROVIDER, useClass: SmtpEmailProvider }` — nothing else
    // in the app changes.
    { provide: EMAIL_PROVIDER, useClass: ConsoleEmailProvider },
  ],
  exports: [AuthService, VerificationService],
})
export class AuthModule {}
