import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Validates the access token (see auth/strategies/jwt.strategy.ts).
 * Apply with @UseGuards(JwtAuthGuard) on any protected route.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
