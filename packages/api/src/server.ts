import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import { authRoutes } from './routes/auth';
import { appRoutes } from './routes/apps';
import { freeTierRoutes } from './routes/freetier';

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: env.UPLOAD_MAX_MB * 1024 * 1024,
      files: 1
    }
  });

  await app.register(authRoutes);
  await app.register(appRoutes);
  await app.register(freeTierRoutes);

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
