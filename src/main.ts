import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { resolveUploadsDir, UPLOADS_URL_PREFIX } from './common/uploads.path';

async function bootstrap() {
  console.log('BOOT CHECK — JWT_ACCESS_SECRET:', process.env.JWT_ACCESS_SECRET ? 'present, ' + process.env.JWT_ACCESS_SECRET.length + ' chars' : 'MISSING');
  // rawBody: true lets the Chapa webhook handler access the unparsed request
  // body needed to verify the signature (req.rawBody).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  // helmet's default Cross-Origin-Resource-Policy is "same-origin", which would
  // block the web/mobile frontend (running on a different origin in dev) from
  // loading listing images served below. "cross-origin" lets images load while
  // keeping helmet's other protections.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // --- Serve uploaded listing photos as static files at /uploads ---
  // resolveUploadsDir() is the SAME helper PhotosService uses to decide where to
  // WRITE files, so the served folder and the saved folder can never diverge.
  // This sits OUTSIDE the global API prefix on purpose: images live at
  // /uploads/... while the API lives at /api/v1/... .
  const uploadsDir = resolveUploadsDir(config.get<string>('STORAGE_LOCAL_PATH'));
  app.useStaticAssets(uploadsDir, { prefix: `${UPLOADS_URL_PREFIX}/` });
  new Logger('Bootstrap').log(`Serving uploads from ${uploadsDir} at ${UPLOADS_URL_PREFIX}/`);

  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  });

  app.setGlobalPrefix(config.get<string>('API_PREFIX') ?? 'api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Koreb Homes API listening on port ${port}`);
}

bootstrap();
