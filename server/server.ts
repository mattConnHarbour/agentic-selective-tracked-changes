import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { disposeAgent, runAgentEdit } from './agent.js';

const port = Number(process.env.PORT ?? 1245);
const allowedOrigins = new Set(
  ['http://127.0.0.1:5195', ...(process.env.FRONTEND_ORIGINS ?? '').split(',')]
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
);
const server = Fastify({ logger: true });
const storedRooms = new Map<string, Uint8Array>();
const collaboration = new Hocuspocus({
  quiet: true,
  stopOnSignals: false,
  debounce: 0,
  maxDebounce: 0,
  onConnect: async ({ documentName }) => {
    server.log.info({ documentName }, 'collaboration client connected');
  },
  onLoadDocument: async ({ document, documentName }) => {
    const storedRoom = storedRooms.get(documentName);
    if (storedRoom) Y.applyUpdate(document, storedRoom);
    return document;
  },
  onStoreDocument: async ({ document, documentName }) => {
    storedRooms.set(documentName, Y.encodeStateAsUpdate(document));
  },
});

await server.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) callback(null, true);
    else callback(new Error(`Origin ${origin} is not allowed.`), false);
  },
});
await server.register(websocket);

server.get('/health', async () => ({ status: 'ok' }));

server.get('/collaboration', { websocket: true }, (socket, request) => {
  collaboration.handleConnection(socket, request.raw);
});

server.get<{ Params: { room: string } }>('/rooms/:room', async (request) => {
  const documentName = request.params.room;
  const document = collaboration.documents.get(documentName);
  return {
    exists: storedRooms.has(documentName) || Boolean(document),
    connections: document?.getConnectionsCount() ?? 0,
  };
});

server.post<{ Body: { room?: string } }>('/agent/edit', async (request, reply) => {
  const room = request.body?.room;
  if (!room) return reply.code(400).send({ error: 'A room ID is required.' });
  const receipt = await runAgentEdit(room);
  return { success: true, receipt };
});

await server.listen({ host: '0.0.0.0', port });

const stop = async () => {
  await disposeAgent();
  await collaboration.destroy();
  await server.close();
  process.exit();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
