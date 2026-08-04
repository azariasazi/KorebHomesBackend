import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but does NOT reject the request when no (or an invalid)
 * token is present — it simply leaves request.user undefined.
 *
 * Used by POST /auth/otp/verify so the one endpoint serves two cases:
 *   - anonymous caller  -> create/find an account by phone (normal signup/login)
 *   - authenticated call -> attach the verified phone to the current account
 *                           (a Google-first user adding their phone)
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Always allow the request through; population of request.user is best-effort.
  handleRequest(_err: any, user: any) {
    return user || undefined;
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
