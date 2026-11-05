# A little space to think

Heart of Gold is a cursor playground with a mission composer. The work should be visible before the controls become complicated.

The visual reference is [Dhvanil Patel’s swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors), which credits [Joel Califa’s Swarm](https://califa.github.io/swarm-site/). The important idea is choreography: small labeled cursors gather, separate, and construct an interface. This implementation was written from scratch; upstream code and assets were not copied.

## ProjectForty2 identity

Use the owning site’s midnight background (`#050509`), ivory headings (`#f4efe4`), gold (`#e0a43a`), and bright gold (`#efc06a`). Cormorant Garamond supplies the editorial headings, DM Sans the controls and prose, and JetBrains Mono the metadata. Fonts are served locally; their separate OFL notices are bundled with the files. The small ring-and-42 mark is ProjectForty2’s existing favicon.

## The field

The opening rehearsal has seven named cursors, thin drafting guides, and deliberate travel between work areas. It does not represent model calls or generated artifacts. Its label and accessible descriptions make that distinction explicit.

During a flight, the scene changes to actual task nodes and parent-child relationships. Children emerge from their parent; running nodes have a small presence gesture. Completed nodes settle. The renderer does not invent agents, progress, tools, or output. Pause, reduced-motion preference, background visibility, and teardown all stop animation appropriately.

The composer stays near the bottom. Crew details, settings, history, logs, and reports open on demand in named native dialogs. The composer always shows whether the next flight is simulated or will use a provider account. On phones, the cursor tree uses two lanes and details become a bottom sheet. The renderer observes the composer’s size to keep labels clear of changing controls and notices.

## Contributing

Keep motion tied to task identity, keep useful text legible, and preserve focus when snapshots arrive. Do not replace the canvas with a permanent wall of status panels. Do not imply a cursor is physically operating a browser or that a rehearsal completed real work. Test both an empty opening scene and a seven-node flight, including a stop and an expanded composer notice.
