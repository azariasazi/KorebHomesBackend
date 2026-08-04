import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  googleId: string; // Google's stable `sub` claim
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Verifies Google ID tokens server-side.
 *
 * We NEVER trust a profile the client claims — the ID token is cryptographically
 * verified against Google's public keys (handled by google-auth-library) and its
 * `aud` is checked against our own client ID, so a token minted for a different
 * app is rejected.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger('GoogleAuthService');
  private readonly client: OAuth2Client;

  constructor(private config: ConfigService) {
    this.client = new OAuth2Client(this.config.get<string>('GOOGLE_CLIENT_ID'));
  }

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      // Misconfiguration, not a user error — make it loud but safe.
      this.logger.error('GOOGLE_CLIENT_ID is not set; cannot verify Google sign-in.');
      throw new BadRequestException('Google sign-in is not configured on the server.');
    }

    let ticket;
    try {
      ticket = await this.client.verifyIdToken({ idToken, audience: clientId });
    } catch (err) {
      this.logger.warn(`Rejected invalid Google ID token: ${(err as Error).message}`);
      throw new BadRequestException('Invalid Google sign-in token.');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      throw new BadRequestException('Google sign-in token was missing required fields.');
    }

    return {
      googleId: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  }
}
