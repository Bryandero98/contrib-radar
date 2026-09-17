import { forwardRef, Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Global, same as DatabaseModule/GithubModule/SentimentModule - guards
// referenced by class (JwtCookieAuthGuard, ApiKeyAuthGuard) are resolved
// against the *consuming* module's own injector, not AuthModule's, so
// UsersService needs to be reachable from every module that uses either
// guard (watched-repos, refresh, issues, mcp, dashboard, billing) without
// each of them importing UsersModule individually.
@Global()
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
