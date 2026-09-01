# Agentic selective tracked changes

This standalone React proof of concept demonstrates two collaborative SuperDoc clients:

- a visible human client whose edits are authored as tracked changes but projected with final-looking, author-scoped CSS;
- a hidden agent client with its own identity that performs a tracked Document API mutation.

Both clients share a local Hocuspocus/Yjs room. The activity panel reads the real tracked-change list and displays author and timestamp metadata.

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5195>, type in the document, and click **Run dummy agent**.

The demo command builds before serving so SuperDoc's browser workers are emitted with production-safe URLs.

## Important limitation

SuperDoc's supported `modules.trackChanges.mode` setting is document-wide; it does not currently filter rendering by author. This demo uses painter-emitted `data-track-change-author-email` attributes and CSS to selectively project simple human text changes. Treat that as a proof of concept, not a supported configuration contract. A production solution should expose an engine-level tracked-change visibility predicate and cover structural, overlapping, paragraph-mark, header/footer, and non-text revisions.

The hidden iframe stands in for a real agent worker. In production, give the agent its own authenticated client/session so its configured identity naturally supplies tracked-change attribution.
