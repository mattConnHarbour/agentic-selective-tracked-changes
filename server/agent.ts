import { createSuperDocClient, type SuperDocDocument } from '@superdoc-dev/sdk';
import { fileURLToPath } from 'node:url';

const AGENT = {
  name: 'Contract Review Agent',
  email: 'agent@example.com',
} as const;

const SERVER_PORT = process.env.PORT ?? '1245';
const COLLABORATION_URL = process.env.COLLABORATION_URL ?? `ws://127.0.0.1:${SERVER_PORT}/collaboration`;
const SAMPLE_DOCUMENT = fileURLToPath(new URL('../public/sample.docx', import.meta.url));

const client = createSuperDocClient({
  user: AGENT,
  defaultChangeMode: 'tracked',
});
const documents = new Map<string, Promise<SuperDocDocument>>();
let connected: Promise<void> | null = null;

const connect = () => {
  connected ??= client.connect();
  return connected;
};

const openRoom = async (room: string) => {
  await connect();
  return client.open({
    doc: SAMPLE_DOCUMENT,
    userName: AGENT.name,
    userEmail: AGENT.email,
    collaboration: {
      providerType: 'hocuspocus',
      url: COLLABORATION_URL,
      documentId: room,
      onMissing: 'error',
      syncTimeoutMs: 30_000,
    },
  });
};

const getRoom = (room: string) => {
  let document = documents.get(room);
  if (!document) {
    document = openRoom(room).catch((error) => {
      documents.delete(room);
      throw error;
    });
    documents.set(room, document);
  }
  return document;
};

export const runAgentEdit = async (room: string) => {
  const doc = await getRoom(room);
  const paragraphs = await doc.find({
    type: 'paragraph',
    limit: 250,
  });
  const target = paragraphs.items.at(0)?.address;
  if (!target || target.kind !== 'block') {
    throw new Error('The agent could not find a paragraph insertion point.');
  }

  const receipt = await doc.create.paragraph({
    at: { kind: 'before', target },
    text: 'Agent suggestion: add a 30-day written notice requirement before termination.',
    changeMode: 'tracked',
  });
  return receipt;
};

export const disposeAgent = async () => {
  const openDocuments = await Promise.allSettled(documents.values());
  await Promise.allSettled(
    openDocuments.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value.close({ discard: true })] : [],
    ),
  );
  documents.clear();
  if (connected) await client.dispose();
};
