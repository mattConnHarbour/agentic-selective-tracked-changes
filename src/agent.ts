import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const SOURCE = 'superdoc-agent-demo';
const roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) throw new Error('The agent collaboration room ID is missing.');
const send = (type: string, detail?: string) =>
  window.parent.postMessage({ source: SOURCE, type, detail }, window.location.origin);

const response = await fetch('/sample.docx');
if (!response.ok) throw new Error(`Sample document returned ${response.status}.`);

let collaborationReady = false;
const superdoc = new SuperDoc({
  selector: '#agent-editor',
  documents: [
    {
      id: 'agent-document',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: await response.blob(),
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: roomId,
        serverUrl: 'ws://127.0.0.1:1245',
        roomMode: 'join',
      },
    },
  ],
  documentMode: 'suggesting',
  user: { name: 'Contract Review Agent', email: 'agent@example.com' },
  onCollaborationReady: () => {
    collaborationReady = true;
  },
  onException: (payload) => {
    if ('diagnosticCode' in payload) return;
    send('agent-error', payload.error instanceof Error ? payload.error.message : String(payload.error));
  },
});

const readyPoll = window.setInterval(() => {
  if (!collaborationReady || !superdoc.activeEditor?.doc) return;
  window.clearInterval(readyPoll);
  send('agent-ready');
}, 250);

window.addEventListener('message', async (event) => {
  if (event.origin !== window.location.origin || event.data?.source !== SOURCE || event.data?.type !== 'run-agent') return;
  try {
    const doc = superdoc.activeEditor?.doc;
    if (!doc) throw new Error('The agent document API is not ready.');
    const paragraphs = await doc.find({ select: { type: 'node', nodeType: 'paragraph' }, limit: 250 });
    const target = paragraphs.items.at(-1)?.address;
    if (!target || target.kind !== 'block') throw new Error('The agent could not find a paragraph insertion point.');
    const receipt = await doc.create.paragraph(
      {
        at: { kind: 'after', target },
        text: 'Agent suggestion: add a 30-day written notice requirement before termination.',
      },
      { changeMode: 'tracked' },
    );
    if (!receipt.success) throw new Error(receipt.failure?.message ?? 'The tracked agent insert failed.');
    send('agent-complete');
  } catch (error) {
    send('agent-error', error instanceof Error ? error.message : String(error));
  }
});

window.addEventListener('beforeunload', () => superdoc.destroy());
