import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { AuthController } from './auth.controller';
import { GITHUB_OAUTH_CLIENT } from './github-oauth-client.token';
import { GithubOauthProvider } from './github-oauth.provider';
import { JwtCookieAuthGuard } from './jwt-cookie-auth.guard';

// forwardRef both ways with UsersModule: AuthController needs UsersService
// (to upsert on login), and UsersController needs JwtCookieAuthGuard (to
// require login before generating an API key) - a genuine cycle, resolved
// Nest's standard way rather than folding the two modules into one.
@Module({
  imports: [
    forwardRef(() => UsersModule),
    JwtModule.registerAsync({
      useFactory: () => {
        if (!process.env.JWT_SECRET) {
          throw new Error('JWT_SECRET is required (see .env.example).');
        }
        return {
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '30d' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: GITHUB_OAUTH_CLIENT, useClass: GithubOauthProvider },
    JwtCookieAuthGuard,
    ApiKeyAuthGuard,
  ],
  exports: [JwtModule, JwtCookieAuthGuard, ApiKeyAuthGuard],
})
export class AuthModule {}
