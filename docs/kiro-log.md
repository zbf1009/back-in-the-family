# Kiro usage log

A running record of how Kiro was used on this project: spec iterations, hook catches, steering fixes, and problems with Kiro itself. Entries are written when things happen and are not edited afterwards except to fix typos. Later corrections are added as new entries.

## 2026-11-04

### Session setup
- Kiro CLI 3.0.0, V3 agent engine, model Claude Opus 5.5 (used for planning and architecture decisions).
- This first session was launched from the home directory, not from the repository. As a result the repository's `.kiro/` (steering, hooks) was not loaded in this session; the docs (Configuration scopes, Session Management) confirm that project configuration and sessions are scoped to the launch directory. From now on, sessions are started inside the repository.

### Plan review before any code
The author's pre-period design notes were reviewed with Kiro before writing code, explicitly to check whether earlier decisions still held. Outcomes:
- **Dropped ECS for the simulation core.** The design calls for 40–60 residents settled daily or weekly; ECS scheduling gives nothing in single-threaded WASM and adds size and ID-ordering hazards. Kiro proposed plain Rust vs all-TypeScript with trade-offs; the author chose plain Rust + WASM.
- **Frontend decided early: TypeScript web app.** The notes had deferred this until after the LLM probe; the review found the dependency did not hold, since either probe outcome favors a web frontend.
- **Integers only in the simulation**, so native and WASM builds produce identical checksums (the notes only promised same-build determinism, but seed batches run natively and replays run in the browser).
- **Demo defaults to live play**, with a replay gallery and the video for curated seeds. The notes had defaulted to recorded playback, which would hide the LLM from judges.
- **LLM scope widened.** Kiro first argued the in-browser LLM should not stay the first choice, based on an earlier failed test of small decision models. The author pushed back: only direct decisions had been tested, not structured fact synthesis. Kiro withdrew the conclusion; the probe now tests both task types, on both in-browser and server-side runtimes.
- **Late LLM results**: wait up to 10 s by default, configurable or switchable off.
- **Design gap closed**: the notes did not define what the player does while alive. Decision: major decisions at each life stage that bias traits and interests.
- **Scope**: one life in 5–10 minutes; first life starts as an adult; town of 40–60 residents; outsiders allowed via "imported vessels" and costly "rebuilt bodies". Build one vertical slice end to end first.
- A tick-cost estimate in the notes was based on a much heavier per-hour simulation and does not apply here; tick granularity will be chosen on design needs after a quick measurement.

### Agent mistake caught by the author
- Kiro said a decision had been "written into tech.md" before the repository existed. The author asked where. Nothing had been written; Kiro corrected the statement. Lesson: report only what has been written to disk.

### Repository and disclosure
- Repository created; first commit contains only `LICENSE` (Apache-2.0, canonical text from apache.org), `README.md` and `.gitignore`. Verified with `git check-ignore` that `.kiro/` is not ignored.
- The prior-work disclosure was reworded on review to state what can be checked (pre-period design notes, research consulted, a repository history that starts empty). The unpushed initial commit was amended so the first commit carries the final wording. Nothing had been pushed.

### Steering
- Added `.kiro/steering/product.md`, `tech.md`, `structure.md` (all `inclusion: always`), encoding the decisions above.
- Global steering fix (outside this repository, `~/.kiro/steering/web-research.md`): the same query (Workers AI pricing) was run through both search routes. Exa returned the official docs page first with usable excerpts; the other route ranked three documentation preview-branch mirrors above the official page and returned about 150k characters for one batch. Steering now makes Exa the default and requires checking official sources.

### Kiro feature notes
- The built-in `introspect` sub-agent could not answer questions about Kiro CLI because it had no web access in this setup (built-in web tools are denied by the user's permissions, and MCP tools were not available to it). Workaround: the main agent fetched `kiro.dev/llms.txt` and the relevant `.md` pages directly.
- Docs confirm custom agents accept a `model` field, which allows cheaper fixed-model agents for routine work. Not yet tested as a sub-agent.

### Third-party evaluation
- Looked at LGUI (game UI framework for agents) as a frontend option. Not adopted: source-available PolyForm Shield license rather than OSI open source, created three weeks earlier with one main contributor, and built for FairyGUI/Unity-style menu screens rather than our scene-and-dialogue UI. Idea kept: agents verifying UI through real-browser screenshots and headless flow tests.

### Evaluation cards
- The LLM probe's evaluation cards are authored and locked outside this repository by the author with a separate tool, following a schema drafted here. They will be imported after locking, with the manifest hash logged here before any model run.
