import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SuperDocEditor, type SuperDocEditorCreateEvent, type SuperDocRef } from '@superdoc/react';
import type { TrackChangeInfo } from 'superdoc/ui';
import '@superdoc/react/style.css';

const HUMAN = { name: 'Human Editor', email: 'human@example.com' };
const AGENT = { name: 'Contract Review Agent', email: 'agent@example.com' };
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const HUMAN_UI = { comments: false } as const;

const resolveRoom = () => {
  const url = new URL(window.location.href);
  const existingRoomId = url.searchParams.get('room');
  const id = existingRoomId ?? `agentic-selective-track-changes-${crypto.randomUUID()}`;
  url.searchParams.delete('fresh');
  url.searchParams.set('room', id);
  window.history.replaceState({}, '', url);
  return { id, mode: existingRoomId ? ('join' as const) : ('create' as const) };
};

const ROOM = resolveRoom();

type ChangeItem = TrackChangeInfo;
const isHumanChange = (change: ChangeItem) =>
  change.authorEmail === HUMAN.email || change.author === HUMAN.name;
const isAgentChange = (change: ChangeItem) => !isHumanChange(change);

export default function App() {
  const humanRef = useRef<SuperDocRef>(null);
  const editorRef = useRef<SuperDocEditorCreateEvent['editor'] | null>(null);
  const agentFrameRef = useRef<HTMLIFrameElement>(null);
  const bubbleLayerRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Blob | null>(null);
  const [humanReady, setHumanReady] = useState(false);
  const [humanConnected, setHumanConnected] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [hideHumanChanges, setHideHumanChanges] = useState(true);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [bubblePositions, setBubblePositions] = useState<Record<string, number>>({});
  const [bubbleGeometryReady, setBubbleGeometryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleChanges = useMemo(
    () => (hideHumanChanges ? changes.filter((change) => !isHumanChange(change)) : changes),
    [changes, hideHumanChanges],
  );

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
                documentId: ROOM.id,
                serverUrl: 'ws://127.0.0.1:1245',
                roomMode: ROOM.mode,
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
    if (!humanReady) return;
    const ui = humanRef.current?.getInstance()?.ui;
    if (!ui) return;

    return ui.trackChanges.observe((snapshot) => {
      setChanges(
        [...snapshot.items].sort(
          (left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime(),
        ),
      );
    });
  }, [humanReady]);

  const positionBubbles = useCallback(() => {
    const layer = bubbleLayerRef.current;
    const ui = humanRef.current?.getInstance()?.ui;
    if (!layer || !ui) return;

    const layerBounds = layer.getBoundingClientRect();
    const paintedChanges = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.human-editor [data-track-change-id], .human-editor [data-track-change-preferred-target-id]',
      ),
    );
    const anchored = visibleChanges.flatMap((change) => {
      try {
        const apiRects = ui.viewport.getRect({ target: change.address }).rects;
        const paintedRects = paintedChanges
          .filter((element) => {
            const ids = element.dataset.trackChangeIds?.split(',') ?? [];
            return (
              element.dataset.trackChangeId === change.id ||
              element.dataset.trackChangePreferredTargetId === change.id ||
              ids.includes(change.id)
            );
          })
          .map((element) => element.getBoundingClientRect());
        const rect = [...apiRects, ...paintedRects].find(
          (candidate) => candidate.bottom >= 0 && candidate.top <= window.innerHeight,
        );
        return rect ? [{ id: change.id, top: rect.top - layerBounds.top }] : [];
      } catch {
        return [];
      }
    });
    const nextPositions = Object.fromEntries(
      anchored.map(({ id, top }) => [id, top]),
    );
    setBubblePositions(nextPositions);
    setBubbleGeometryReady(true);
  }, [visibleChanges]);

  useEffect(() => {
    if (!humanReady) return;
    const ui = humanRef.current?.getInstance()?.ui;
    if (!ui) return;

    const frame = window.requestAnimationFrame(positionBubbles);
    const stopViewport = ui.viewport.observe(positionBubbles);
    window.addEventListener('resize', positionBubbles);
    window.addEventListener('scroll', positionBubbles, true);
    return () => {
      window.cancelAnimationFrame(frame);
      stopViewport();
      window.removeEventListener('resize', positionBubbles);
      window.removeEventListener('scroll', positionBubbles, true);
    };
  }, [humanReady, positionBubbles]);

  useEffect(() => {
    const onAgentMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== 'superdoc-agent-demo') return;
      if (event.data.type === 'agent-ready') setAgentReady(true);
      if (event.data.type === 'agent-complete') {
        setRunning(false);
        [250, 750, 1500, 3000].forEach((delay) => {
          window.setTimeout(() => void refreshChanges(), delay);
        });
      }
      if (event.data.type === 'agent-error') {
        setRunning(false);
        setError(event.data.detail || 'The dummy agent failed.');
      }
    };
    window.addEventListener('message', onAgentMessage);
    return () => window.removeEventListener('message', onAgentMessage);
  }, [refreshChanges]);

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

  const focusChange = async (id: string) => {
    const ui = humanRef.current?.getInstance()?.ui;
    if (!ui || !ui.trackChanges.setActive(id)) return;
    await ui.trackChanges.scrollTo(id);
  };

  if (error && !source) return <p className="fatal">Could not start the demo: {error}</p>;
  if (!source) return <p className="loading">Loading sample document…</p>;
  return (
    <main className="app-shell">
      <header className="demo-header">
        <div className="header-actions">
          <button disabled={!agentReady || running} onClick={() => void runAgent()} type="button">
            {running ? 'Agent is editing…' : 'Run agent edit'}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace">
        <div className={`editor-panel human-editor${hideHumanChanges ? ' hide-human-changes' : ''}`}>
          <div className="panel-heading">
            <strong>Shared document</strong>
            <div className="mode-control">
              <div className="mode-key">
                <span>
                  {hideHumanChanges ? 'Only agent changes are visible.' : 'Both user and agent changes are visible.'}
                </span>
                <span>Both user and agent changes are tracked.</span>
              </div>
              <label className="mode-selector">
                <span>Mode</span>
                <select
                  aria-label="Document display mode"
                  onChange={(event) => setHideHumanChanges(event.target.value === 'editing')}
                  value={hideHumanChanges ? 'editing' : 'suggesting'}
                >
                  <option value="editing">Editing</option>
                  <option value="suggesting">Suggesting</option>
                </select>
              </label>
            </div>
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
            ui={HUMAN_UI}
            user={HUMAN}
          />
          <div className="bubble-layer" ref={bubbleLayerRef}>
            {visibleChanges.map((change, index) => {
              const top = bubblePositions[change.id];
              if (top === undefined && bubbleGeometryReady) return null;
              const isAgent = isAgentChange(change);
              return (
                <button
                  className="custom-change-bubble"
                  key={change.id}
                  onClick={() => void focusChange(change.id)}
                  style={{ top: top ?? 132 + index * 132 }}
                  type="button"
                >
                  <span className="change-title">
                    <span className={isAgent ? 'badge agent' : 'badge human'}>{isAgent ? 'Agent' : 'Human'}</span>
                    <strong>{change.author ?? 'Unknown author'}</strong>
                  </span>
                  <span className="bubble-excerpt">{change.excerpt || '(No text excerpt)'}</span>
                  <small>
                    {change.type} · {change.date ? new Date(change.date).toLocaleString() : 'No timestamp'}
                  </small>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="activity-panel">
          <div className="panel-heading">
            <strong>Tracked changes</strong>
            <button className="text-button" onClick={() => void refreshChanges()} type="button">
              Refresh
            </button>
          </div>
          <p className="activity-note">Tracked changes will appear here.</p>
          <p className="empty-state">
            {visibleChanges.length === 0
              ? 'Make a human edit or run the agent to see attributed revisions.'
              : `${visibleChanges.length} visible tracked ${visibleChanges.length === 1 ? 'change' : 'changes'}.`}
          </p>
        </aside>
      </section>

      {humanReady ? (
        <iframe
          className="agent-runtime"
          ref={agentFrameRef}
          src={`/agent.html?room=${encodeURIComponent(ROOM.id)}`}
          title="Dummy agent runtime"
        />
      ) : null}
    </main>
  );
}
