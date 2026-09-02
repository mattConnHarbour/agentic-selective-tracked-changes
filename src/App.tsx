import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { SuperDoc, type Editor } from 'superdoc';
import { createSuperDocUI, type SuperDocUI, type TrackChangeInfo } from 'superdoc/ui';
import * as Y from 'yjs';
import 'superdoc/style.css';
import { TrackedChangesController } from './TrackedChangesController';

const HUMAN = { name: 'Human Editor', email: 'human@example.com' };
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BACKEND_HTTP_URL = (import.meta.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:1245').replace(/\/$/, '');
const BACKEND_WS_URL = BACKEND_HTTP_URL.replace(/^http/, 'ws');

const hasSuperDocContent = (ydoc: Y.Doc) =>
  ydoc.getXmlFragment('supereditor').length > 0 ||
  ydoc.getMap('parts').size > 0 ||
  ydoc.getMap('meta').has('docx');

const resolveRoom = () => {
  const url = new URL(window.location.href);
  const existingRoomId = url.searchParams.get('room');
  const id = existingRoomId ?? `agentic-selective-track-changes-${crypto.randomUUID()}`;
  url.searchParams.delete('fresh');
  url.searchParams.set('room', id);
  window.history.replaceState({}, '', url);
  return { id };
};

const ROOM = resolveRoom();

export default function App() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const superdocRef = useRef<SuperDoc | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const uiRef = useRef<SuperDocUI | null>(null);
  const trackedChangesControllerRef = useRef<TrackedChangesController | null>(null);
  const bubbleLayerRef = useRef<HTMLDivElement>(null);
  const [roomMode, setRoomMode] = useState<'create' | 'join' | null>(null);
  const [humanReady, setHumanReady] = useState(false);
  const [humanConnected, setHumanConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [hideHumanTrackedChanges, setHideHumanTrackedChanges] = useState(true);
  const [trackedChanges, setTrackedChanges] = useState<TrackChangeInfo[]>([]);
  const [trackedChangeBubblePositions, setTrackedChangeBubblePositions] = useState<Record<string, number>>({});
  const [bubbleGeometryReady, setBubbleGeometryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The controller owns attribution and filtering. This projection is used by
  // both the custom bubbles and the tracked-change activity count.
  const visibleTrackedChanges = useMemo(
    () =>
      trackedChangesControllerRef.current?.filterVisibleTrackedChanges(
        trackedChanges,
        hideHumanTrackedChanges,
      ) ?? [],
    [hideHumanTrackedChanges, trackedChanges],
  );

  useEffect(() => {
    void fetch(`${BACKEND_HTTP_URL}/rooms/${encodeURIComponent(ROOM.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Room lookup returned ${response.status}.`);
        return (await response.json()) as { exists: boolean };
      })
      .then(({ exists }) => setRoomMode(exists ? 'join' : 'create'))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const refreshTrackedChanges = useCallback(async () => {
    try {
      const controller = trackedChangesControllerRef.current;
      if (!controller) return;
      setTrackedChanges(await controller.getTrackedChanges());
    } catch {
      // Updates can race editor initialization or an in-flight mutation.
    }
  }, []);

  useEffect(() => {
    if (!roomMode || !editorHostRef.current) return;

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${BACKEND_WS_URL}/collaboration`,
      name: ROOM.id,
      document: ydoc,
    });
    let superdoc: SuperDoc | null = null;
    let ui: SuperDocUI | null = null;
    let stopTrackedChanges: (() => void) | null = null;

    const handleStatus = ({ status }: { status: string }) => {
      setHumanConnected(status === 'connected');
    };
    const handleSynced = () => {
      if (superdoc || !editorHostRef.current) return;
      const shouldSeedDefaultDocument = !hasSuperDocContent(ydoc);
      superdoc = new SuperDoc({
        selector: editorHostRef.current,
        documentMode: 'suggesting',
        document: shouldSeedDefaultDocument
          ? {
              id: ROOM.id,
              type: MIME,
              url: '/sample.docx',
              name: 'sample.docx',
              isNewFile: true,
            }
          : undefined,
        user: HUMAN,
        modules: {
          // Disable SuperDoc's native comment/track-change bubbles because they
          // cannot be filtered by author. The demo renders filterable bubbles below.
          comments: false,
          collaboration: { ydoc, provider },
        },
        onEditorCreate: ({ editor }) => {
          editorRef.current = editor;
        },
        onReady: ({ superdoc: readySuperdoc }) => {
          if (!editorRef.current) editorRef.current = readySuperdoc.activeEditor;
          if (!editorRef.current || !editorHostRef.current) return;
          const trackedChangesController = new TrackedChangesController({
            editor: editorRef.current,
            editorHost: editorHostRef.current,
            human: HUMAN,
          });
          trackedChangesController.setHumanTrackedChangesVisible(!hideHumanTrackedChanges);
          trackedChangesControllerRef.current = trackedChangesController;
          ui = createSuperDocUI({ superdoc: readySuperdoc });
          uiRef.current = ui;
          stopTrackedChanges = ui.trackChanges.observe(() => void refreshTrackedChanges());
          setHumanReady(true);
          void refreshTrackedChanges();
        },
        onEditorUpdate: () => window.setTimeout(() => void refreshTrackedChanges(), 100),
        onException: (payload) => {
          if ('diagnosticCode' in payload) return;
          const reason = 'error' in payload ? payload.error : payload;
          setError(reason instanceof Error ? reason.message : String(reason));
        },
      });
      superdocRef.current = superdoc;
    };

    provider.on('status', handleStatus);
    provider.on('synced', handleSynced);
    return () => {
      provider.off('status', handleStatus);
      provider.off('synced', handleSynced);
      stopTrackedChanges?.();
      ui?.destroy();
      trackedChangesControllerRef.current?.destroy();
      superdoc?.destroy();
      provider.destroy();
      ydoc.destroy();
      superdocRef.current = null;
      editorRef.current = null;
      uiRef.current = null;
      trackedChangesControllerRef.current = null;
      setHumanReady(false);
      setHumanConnected(false);
    };
  }, [refreshTrackedChanges, roomMode]);

  const positionBubbles = useCallback(() => {
    const layer = bubbleLayerRef.current;
    const ui = uiRef.current;
    if (!layer || !ui) return;

    const layerBounds = layer.getBoundingClientRect();
    const anchored = visibleTrackedChanges.flatMap((trackedChange) => {
      try {
        const rectResult = ui.viewport.getRect({ target: trackedChange.address });
        if (!rectResult.success) return [];
        const rect = rectResult.rects.find(
          (candidate) => candidate.top + candidate.height >= 0 && candidate.top <= window.innerHeight,
        );
        return rect ? [{ id: trackedChange.id, top: rect.top - layerBounds.top }] : [];
      } catch {
        return [];
      }
    });
    const nextPositions = Object.fromEntries(
      anchored.map(({ id, top }) => [id, top]),
    );
    setTrackedChangeBubblePositions(nextPositions);
    setBubbleGeometryReady(true);
  }, [visibleTrackedChanges]);

  useEffect(() => {
    if (!humanReady) return;
    const ui = uiRef.current;
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

  const runAgent = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND_HTTP_URL}/agent/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room: ROOM.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `The agent returned ${response.status}.`);
      [100, 300, 750, 1500].forEach((delay) => {
        window.setTimeout(() => void refreshTrackedChanges(), delay);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };

  const focusTrackedChange = async (id: string) => {
    const ui = uiRef.current;
    if (!ui || !ui.trackChanges.setActive(id)) return;
    await ui.trackChanges.scrollTo(id);
  };

  if (error && !roomMode) return <p className="fatal">Could not start the demo: {error}</p>;
  if (!roomMode) return <p className="loading">Loading sample document…</p>;
  return (
    <main className="app-shell">
      <header className="demo-header">
        <div className="header-actions">
          <button disabled={!humanReady || !humanConnected || running} onClick={() => void runAgent()} type="button">
            {running ? 'Agent is editing…' : 'Run agent edit'}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace">
        <div className="editor-panel human-editor">
          <div className="panel-heading">
            <strong>Shared document</strong>
            <div className="mode-control">
              <div className="mode-key">
                <span>
                  {hideHumanTrackedChanges
                    ? 'Only agent tracked changes are visible.'
                    : 'Both user and agent tracked changes are visible.'}
                </span>
                <span>Both user and agent tracked changes are recorded.</span>
              </div>
              <label className="mode-selector">
                <span>Mode</span>
                {/*
                  One toggle controls both projections: the author-scoped
                  inline markup class and the custom bubble collection.
                */}
                <select
                  aria-label="Document display mode"
                  onChange={(event) => {
                    const hideHumanTrackedChanges = event.target.value === 'editing';
                    setHideHumanTrackedChanges(hideHumanTrackedChanges);
                    trackedChangesControllerRef.current?.setHumanTrackedChangesVisible(
                      !hideHumanTrackedChanges,
                    );
                  }}
                  value={hideHumanTrackedChanges ? 'editing' : 'suggesting'}
                >
                  <option value="editing">Editing</option>
                  <option value="suggesting">Suggesting</option>
                </select>
              </label>
            </div>
          </div>
          <div className="superdoc-host" ref={editorHostRef} />
          <div className="bubble-layer" ref={bubbleLayerRef}>
            {/* Only the already-filtered tracked changes receive custom bubbles. */}
            {visibleTrackedChanges.map((trackedChange, index) => {
              const top = trackedChangeBubblePositions[trackedChange.id];
              if (top === undefined && bubbleGeometryReady) return null;
              const isAgent =
                !trackedChangesControllerRef.current?.isHumanTrackedChange(trackedChange);
              return (
                <button
                  className="custom-tracked-change-bubble"
                  key={trackedChange.id}
                  onClick={() => void focusTrackedChange(trackedChange.id)}
                  style={{ top: top ?? 132 + index * 132 }}
                  type="button"
                >
                  <span className="tracked-change-title">
                    <span className={isAgent ? 'badge agent' : 'badge human'}>{isAgent ? 'Agent' : 'Human'}</span>
                    <strong>{trackedChange.author ?? 'Unknown author'}</strong>
                  </span>
                  <span className="bubble-excerpt">{trackedChange.excerpt || '(No text excerpt)'}</span>
                  <small>
                    {trackedChange.type} ·{' '}
                    {trackedChange.date ? new Date(trackedChange.date).toLocaleString() : 'No timestamp'}
                  </small>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="activity-panel">
          <div className="panel-heading">
            <strong>Tracked changes</strong>
            <button className="text-button" onClick={() => void refreshTrackedChanges()} type="button">
              Refresh
            </button>
          </div>
          <p className="activity-note">Tracked changes will appear here.</p>
          <p className="empty-state">
            {visibleTrackedChanges.length === 0
              ? 'Make a human edit or run the agent to see attributed revisions.'
              : `${visibleTrackedChanges.length} visible ${visibleTrackedChanges.length === 1 ? 'tracked change' : 'tracked changes'}.`}
          </p>
        </aside>
      </section>

    </main>
  );
}
