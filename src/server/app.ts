import Fastify, { type FastifyInstance } from 'fastify';
import type { Monitor } from './monitor';
import { eventsQuerySchema, measurementInputSchema } from './schema';

export function buildApp(monitor: Monitor): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post('/api/measurements', async (request, reply) => {
    const parsed = measurementInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    return reply.code(201).send(monitor.ingest(parsed.data));
  });

  app.get('/api/status', async () => monitor.getStatus());

  app.get('/api/events', async (request, reply) => {
    const parsed = eventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    return monitor.listEvents(parsed.data.limit, parsed.data.before);
  });

  return app;
}
