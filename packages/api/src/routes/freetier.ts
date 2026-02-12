import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppService } from '../services/app';

export async function freeTierRoutes(app: FastifyInstance) {
  const service = new AppService();

  app.post('/freetier/services', async (req) => {
    const body = z.object({
      ownerDiscordId: z.string(),
      type: z.enum(['bot', 'minecraft', 'hytale']),
      targetAppId: z.string().optional()
    }).parse(req.body);

    return service.createFreeTier(body);
  });

  app.get('/freetier/services', async (req) => {
    const query = z.object({ ownerDiscordId: z.string() }).parse(req.query);
    return service.listFreeTier(query.ownerDiscordId);
  });

  app.post('/freetier/services/:id/report-abuse', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ reason: z.string().min(3).default('abuso de recursos') }).parse(req.body);
    return service.reportFreeTierAbuse(id, body.reason);
  });
}
