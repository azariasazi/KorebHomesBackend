import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Usage: @CurrentUser() user, or @CurrentUser('id') userId
 * Populated by JwtAuthGuard/JwtStrategy, which attaches the validated
 * user payload ({ id, phone, role }) to request.user.
 */
export const CurrentUser = createParamDecorator((data: string | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user;
  return data ? user?.[data] : user;
});
