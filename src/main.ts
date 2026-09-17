import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PgExceptionFilter } from './database/pg-exception.filter';

async function bootstrap() {
  // rawBody:true - not manual express.raw() middleware - so
  // BillingController's webhook handler can read req.rawBody for Stripe's
  // signature check, while every other route still gets the normal parsed
  // JSON body.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.useGlobalFilters(new PgExceptionFilter());
  // CreateWatchedRepoDto only carried @ApiProperty() for Swagger docs - no
  // class-validator decorators, and nothing registered to enforce them even
  // if it had. `whitelist` strips unknown properties instead of rejecting
  // them (kept lenient); `transform` matches packetforge's identical fix.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('contrib-radar')
    .setDescription(
      'Scores good-first-issue candidates by real current availability ' +
        '(assignee, competing/abandoned PRs, staleness, maintainer sentiment) ' +
        'instead of just a label.',
    )
    .setVersion('0.0.1')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
