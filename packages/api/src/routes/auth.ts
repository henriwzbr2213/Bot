import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppService } from '../services/app';

export async function authRoutes(app: FastifyInstance) {
  const service = new AppService();

  app.post('/auth/discord', async (req, reply) => {
    const { userId } = z.object({ userId: z.string().min(3) }).parse(req.body);
    return reply.send(await service.authDiscord(userId));
  });
}
