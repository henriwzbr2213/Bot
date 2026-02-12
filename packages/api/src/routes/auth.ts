import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppService } from '../services/app';

export async function authRoutes(app: FastifyInstance) {
  const service = new AppService();

  app.post('/auth/discord', async (req, reply) => {
    const { userId } = z.object({ userId: z.string().min(3) }).parse(req.body);
    return reply.send(await service.authDiscord(userId));
  });

  app.post('/auth/register', async (req, reply) => {
    const body = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10) }).parse(req.body);
    return reply.send(await service.registerUser(body));
  });

  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    return reply.send(await service.loginUser(body));
  });
}
