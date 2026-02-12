import { FastifyInstance } from 'fastify';
import { Region } from '@prisma/client';
import { z } from 'zod';
import { AppService } from '../services/app';

export async function appRoutes(app: FastifyInstance) {
  const service = new AppService();

  app.post('/apps', async (req) => {
    const body = z.object({ ownerDiscordId: z.string(), name: z.string().min(2), region: z.enum(['br', 'us']) }).parse(req.body);
    return service.create({ ...body, region: body.region as Region });
  });

  app.get('/apps', async (req) => {
    const query = z.object({ ownerDiscordId: z.string().optional() }).parse(req.query);
    return service.list(query.ownerDiscordId);
  });

  app.get('/apps/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return service.get(id);
  });

  app.post('/apps/:id/upload', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const file = await req.file();
    if (!file) throw new Error('Anexe um arquivo .zip');
    if (!file.filename.endsWith('.zip')) throw new Error('Apenas .zip é suportado');
    return service.uploadZip(id, await file.toBuffer());
  });

  app.post('/apps/:id/deploy', async (req) => service.deploy(z.object({ id: z.string() }).parse(req.params).id));
  app.post('/apps/:id/restart', async (req) => service.restart(z.object({ id: z.string() }).parse(req.params).id));
  app.post('/apps/:id/stop', async (req) => service.stop(z.object({ id: z.string() }).parse(req.params).id));
  app.get('/apps/:id/logs', async (req) => service.logs(z.object({ id: z.string() }).parse(req.params).id));

  app.post('/apps/:id/move', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { region } = z.object({ region: z.enum(['br', 'us']) }).parse(req.body);
    return service.move(id, region as Region);
  });
}
