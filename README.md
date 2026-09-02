# Agentic selective tracked changes

This standalone React proof of concept uses `superdoc@1.46.3` (the latest stable v1 release) to demonstrate selective tracked-change presentation in one SuperDoc client:

- a visible human client whose edits are authored as tracked changes but projected with final-looking, author-scoped CSS;
- a Node agent that joins the shared document through `@superdoc-dev/sdk` and performs a tracked Document API mutation under its own identity.

The browser and SDK agent share a Hocuspocus room hosted on the Fastify WebSocket endpoint. The button calls a normal HTTP endpoint that triggers the SDK mutation; document changes arrive through collaboration. The activity panel reads the real tracked-change list and displays author and timestamp metadata.

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5195>, type in the document, and click **Run agent edit**.

For deployment, set `VITE_BACKEND_URL` when building the frontend and set
`FRONTEND_ORIGINS` on the backend to a comma-separated list of allowed browser origins.

The demo command builds before serving so SuperDoc's browser workers are emitted with production-safe URLs.

## Important limitation

SuperDoc's supported `modules.trackChanges.mode` setting is document-wide; it does not currently filter rendering by author. This demo uses painter-emitted `data-track-change-author-email` attributes and CSS to selectively project simple human text changes. Treat that as a proof of concept, not a supported configuration contract. A production solution should expose an engine-level tracked-change visibility predicate and cover structural, overlapping, paragraph-mark, header/footer, and non-text revisions.

In production, authenticate the collaboration room and authorize agent actions before opening an SDK session.
