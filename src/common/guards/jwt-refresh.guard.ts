import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Validates the refresh token (see auth/strategies/jwt-refresh.strategy.ts). */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
