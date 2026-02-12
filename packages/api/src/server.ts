import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import { authRoutes } from './routes/auth';
import { appRoutes } from './routes/apps';
import { freeTierRoutes } from './routes/freetier';

function statusFromMessage(message: string): number {
  if (message.includes('Email já cadastrado')) return 409;
  if (message.includes('Usuário não encontrado') || message.includes('Senha inválida')) return 401;
  if (message.includes('Senha fraca') || message.includes('As senhas não conferem')) return 422;
  if (message.includes('Banco de dados indisponível')) return 503;
  return 400;
}

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

  app.setErrorHandler((error, _req, reply) => {
    const rawMessage = error instanceof Error ? error.message : 'Erro interno';
    const status = statusFromMessage(rawMessage);
    const message = status === 400 && !rawMessage.includes('Email') && !rawMessage.includes('Senha')
      ? 'Não foi possível processar sua solicitação.'
      : rawMessage;

    reply.status(status).send({ message });
  });

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
