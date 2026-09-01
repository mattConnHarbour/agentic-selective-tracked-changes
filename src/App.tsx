import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SuperDocEditor, type SuperDocEditorCreateEvent, type SuperDocRef } from '@superdoc/react';
import '@superdoc/react/style.css';

const HUMAN = { name: 'Human Editor', email: 'human@example.com' };
const AGENT = { name: 'Contract Review Agent', email: 'agent@example.com' };
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type ChangeItem = {
  id: string;
  type: string;
  author?: string;
  authorEmail?: string;
  date?: string;
  excerpt?: string;
};

export default function App() {
  const humanRef = useRef<SuperDocRef>(null);
  const editorRef = useRef<SuperDocEditorCreateEvent['editor'] | null>(null);
  const agentFrameRef = useRef<HTMLIFrameElement>(null);
  const roomIdRef = useRef(`agentic-selective-track-changes-${crypto.randomUUID()}`);
  const [source, setSource] = useState<Blob | null>(null);
  const [humanReady, setHumanReady] = useState(false);
  const [humanConnected, setHumanConnected] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/sample.docx')
      .then((response) => {
        if (!response.ok) throw new Error(`Sample document returned ${response.status}.`);
        return response.blob();
      })
      .then(setSource)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const humanDocuments = useMemo(
    () =>
      source
        ? [
            {
              id: 'human-document',
              type: MIME,
              data: source,
              v2Collaboration: {
                providerType: 'hocuspocus' as const,
                documentId: roomIdRef.current,
                serverUrl: 'ws://127.0.0.1:1245',
                roomMode: 'create' as const,
              },
            },
          ]
        : [],
    [source],
  );
  const refreshChanges = useCallback(async () => {
    try {
      const result = await editorRef.current?.doc?.trackChanges.list({
        limit: 250,
        offset: 0,
      });
      const items = ((result?.items ?? []) as ChangeItem[]).sort(
        (left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime(),
      );
      setChanges(items);
    } catch {
      // Updates can race a document-session handoff during collaboration startup.
    }
  }, []);

  useEffect(() => {
    if (!source || humanReady || !humanConnected) return;
    const interval = window.setInterval(() => {
      const instance = humanRef.current?.getInstance();
      const editor = instance?.activeEditor;
      if (!editor?.doc) return;
      editorRef.current = editor;
      setHumanReady(true);
      window.clearInterval(interval);
      void refreshChanges();
    }, 250);
    return () => window.clearInterval(interval);
  }, [humanConnected, humanReady, refreshChanges, source]);

  useEffect(() => {
    const onAgentMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== 'superdoc-agent-demo') return;
      if (event.data.type === 'agent-ready') setAgentReady(true);
      if (event.data.type === 'agent-complete') {
        setRunning(false);
        window.setTimeout(() => void refreshChanges(), 500);
      }
      if (event.data.type === 'agent-error') {
        setRunning(false);
        setError(event.data.detail || 'The dummy agent failed.');
      }
    };
    window.addEventListener('message', onAgentMessage);
    return () => window.removeEventListener('message', onAgentMessage);
  }, [refreshChanges]);

  useEffect(() => {
    const editorRoot = document.querySelector('.human-editor');
    if (!editorRoot) return;

    const changesById = new Map(changes.map((change) => [change.id, change]));
    const tagTrackedChangeBubbles = () => {
      editorRoot.querySelectorAll<HTMLElement>('.comment-placeholder[data-comment-thread-id]').forEach((bubble) => {
        const change = changesById.get(bubble.dataset.commentThreadId ?? '');
        if (change?.authorEmail) bubble.dataset.trackChangeAuthorEmail = change.authorEmail;
        else delete bubble.dataset.trackChangeAuthorEmail;
      });
    };

    tagTrackedChangeBubbles();
    const observer = new MutationObserver(tagTrackedChangeBubbles);
    observer.observe(editorRoot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [changes]);

  const runAgent = async () => {
    setRunning(true);
    setError(null);
    if (!agentFrameRef.current?.contentWindow) {
      setRunning(false);
      setError('The agent client is not ready.');
      return;
    }
    agentFrameRef.current.contentWindow.postMessage(
      { source: 'superdoc-agent-demo', type: 'run-agent' },
      window.location.origin,
    );
  };

  if (error && !source) return <p className="fatal">Could not start the demo: {error}</p>;
  if (!source) return <p className="loading">Loading sample document…</p>;

  return (
    <main className="app-shell">
      <header className="demo-header">
        <div>
          <p className="eyebrow">Agentic collaboration proof of concept</p>
          <h1>Invisible human revisions, visible agent suggestions</h1>
          <p className="subtitle">
            Type in the document as {HUMAN.name}. Your revisions remain tracked but look like direct edits. Then ask the
            dummy agent to append a visibly tracked suggestion.
          </p>
        </div>
        <button disabled={!agentReady || running} onClick={() => void runAgent()} type="button">
          {running ? 'Agent is editing…' : 'Run dummy agent'}
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace">
        <div className="editor-panel human-editor">
          <div className="panel-heading">
            <strong>Shared document</strong>
            <span>{humanReady ? 'Human connected' : 'Connecting…'}</span>
          </div>
          <SuperDocEditor
            documentMode="suggesting"
            documents={humanDocuments}
            hideToolbar
            onCollaborationReady={() => setHumanConnected(true)}
            onEditorUpdate={() => window.setTimeout(() => void refreshChanges(), 100)}
            onException={(payload) => {
              if ('diagnosticCode' in payload) return;
              setError(payload.error instanceof Error ? payload.error.message : String(payload.error));
            }}
            ref={humanRef}
            user={HUMAN}
          />
        </div>

        <aside className="activity-panel">
          <div className="panel-heading">
            <strong>Tracked activity</strong>
            <button className="text-button" onClick={() => void refreshChanges()} type="button">
              Refresh
            </button>
          </div>
          <p className="activity-note">Both kinds are stored. Only agent revisions use the standard review rendering.</p>
          {changes.length === 0 ? (
            <p className="empty-state">Make a human edit or run the agent to see attributed revisions.</p>
          ) : (
            <ol className="change-list">
              {changes.map((change) => {
                const isAgent = change.authorEmail === AGENT.email;
                return (
                  <li key={change.id}>
                    <div className="change-title">
                      <span className={isAgent ? 'badge agent' : 'badge human'}>{isAgent ? 'Agent' : 'Human'}</span>
                      <strong>{change.author ?? 'Unknown author'}</strong>
                    </div>
                    <p>{change.excerpt || '(No text excerpt)'}</p>
                    <small>
                      {change.type} · {change.date ? new Date(change.date).toLocaleString() : 'No timestamp'}
                    </small>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </section>

      {humanReady ? (
        <iframe
          className="agent-runtime"
          ref={agentFrameRef}
          src={`/agent.html?room=${encodeURIComponent(roomIdRef.current)}`}
          title="Dummy agent runtime"
        />
      ) : null}
    </main>
  );
}
