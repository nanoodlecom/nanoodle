# Implicit state-machine audit

Audited app main: `47744e0bba75ee23b6e7cd4950484ff4976df3c1` (6 November 2026).
The app is a static editor (`index.html`), builder/player/export runtime
(`play.html`), service worker, recovery page, and vendored browser helpers.
There is no application server or database migration in this repository.

The rows below group related transitions by the state they own. A source
anchor names the actual implementation, rather than a proposed replacement
architecture. A row can contain several coupled machines. Existing checks
exercise many of these; an inventory is not a proof over every interleaving.

## Confirmed defects and regression evidence

| Defect | Reproduction on unchanged main | Correction and regression |
| --- | --- | --- |
| Cancelled editor ancestor does not poison downstream execution | In a three-node chain, abort the first node's work controller while the leaf's Play remains live. Both abort rejection and a response arriving after Stop still launch two dependent generation spies. The rejection path consumes `STALE_PRIOR_RUN`. | Add the stopped ancestor to this run's invalid-input set in both completion and exception branches. Keep its neutral Stop UI and release all locks. `check-stale-input-charge.mjs` now proves zero downstream calls and transitive skipping for both races; existing joined-sibling Stop cases remain intact. |
| Fixed-seed parallel lanes reserve too late | Run eight cloned graphs with the same node ID, inputs and fixed seed. All eight read an empty cache before awaiting model preflight; all eight submit. | Cache the promise covering preflight **and** generation synchronously. A random-seed run still makes eight calls; a fixed-seed run makes one. `check-seed-cache.mjs` exercises both and checks genuine-generation counts used by keep mode. |
| Aborted fixed-seed waiters retain lane work | Stop eight fixed-seed lanes while seven await the owner. The next Run leaves seven lanes skipped because their settled-empty work reservations remain in `NODE_WORK`. | Delete each owned lane reservation in `finally`, including the abort-throw path. `check-seed-cache.mjs` now proves all eight lanes produce output after a stopped run, with one fresh generation. |
| Obsolete balance refresh crosses account transitions | Begin check-balance as account A, sign out or replace the key before the HTTP reply or JSON resolves. The old success paints/caches A's balance; a corrective failure can mark the replacement account stale. | Require the captured request key to still be current, alongside the existing settlement sequence guard. Apply to editor, builder, and standalone export runtime. `check-balance-session-race.mjs` covers success, failure, delayed JSON and coalesced replacement-account refresh. Embedded exports continue asking their parent to refresh; they receive no key. |
| Initial 3D catalog failure becomes permanent | Fail the first lazy 3D catalog request, then reopen a 3D surface. The fulfilled single-flight promise is retained forever, so no retry occurs; the stale watcher does not watch a kind that never loaded successfully. | Retain only in-flight work, reuse successful fresh data, and allow failed/stale loads to retry. `check-model3d-catalog-retry.mjs` proves coalescing, failure recovery, freshness reuse and stale revalidation. |

All reproductions use synthetic graphs, keys and provider responses. No
generation, payment, top-up, real sign-in, or user-storage mutation is used.
The generated SDK artifact and its embedded twin are refreshed with the official
generator after SDK PR #56 merged during app verification. No generated payload
is edited by hand.

## Execution and provider lifecycles

| Machine / source anchor | States and transitions | Critical invariant / existing evidence |
| --- | --- | --- |
| Editor scheduling: `runGroup`, `ancestors`, `topoOrder` | idle → locked → dependency wait → execute/reuse/join → done/error/skip/stop → unlock; cycles enter error and poison descendants | Invalid ancestors never reach a paid dependent. `check-stale-input-charge`, `check-connect-wires`, `check-run-compat`. Stop propagation repaired above. |
| Shared editor work: `nodeWork`, `seedCtl`, `runLockCount`, `dropWorkHolder` | first Play owns work → sibling joins holder set → one seed stops → last holder may abort → all holders release | One shared ancestor call; stopping B preserves A for C. Locks outlive every holder. `check-stale-input-charge`. |
| Deterministic editor reuse: `nodeSig`, `isSeeded` | absent signature → generate → success signature → reuse when inputs match; explicit unseeded target rerolls; changed fields invalidate | Failed/demo work cannot mint a valid real signature. `check-seed-cache`, `check-stale-input-charge`. |
| Player graph/lane work: `runGraph`, `NODE_WORK` | materialize lane → order graph → await inputs/shared work → preflight → execute → isolated node error or lane abort → settle work | Lane-scoped work keeps random generations separate. Cycles/failures skip dependents. `check-run-compat`, `check-njs-delegation`. |
| Player fixed-seed cache: `RUN_CACHE` | missing → reserved promise → resolved output; failure removes owned reservation; different signature misses | Identical fixed-seed lanes share preflight and generation. Repaired and tested above. |
| Player multi-count/keep mode: `run`, `worker`, `cancelRun` | idle → N workers → per-lane completion/backoff → repeat while enabled and genuinely generating → drained; Stop aborts | Cached-only runs cannot spin forever. Cancellation prevents new dependent work. `check-seed-cache`, `check-run-gating`. |
| Conditional execution: `decideRun`, `decideGateError`, `setGated` | request → probability judgment → gate open/result or gate closed → transitive skip | A closed gate is settled, not a provider error; descendants stay unbilled. `check-decide`, `check-decide-edges`. |
| Video/3D pending jobs: `PENDING_VIDEO`, `genVideo` | signature miss → submit → remember run ID → poll → timeout/Stop retains job; terminal failure forgets; success retains URL until media delivery | Retry unchanged work resumes its paid job, including a failed content download. `check-video-resume`, `check-njs-3d-run-edges`. |
| Audio pending jobs: `PENDING_AUDIO`, `pollAudio` | submit → remember job/cost/refund metadata → polling → completion URL → delivery; timeout/Stop retain; provider failure removes | Request signature and lane identify the resumable job. `check-audio-resume`, `check-audio-billing`. |
| Media delivery: `deliverResolvedMedia`, `contentFetch*` | raw result URL → origin/redirect validation → bounded inline fetch → delivered or retained URL/error | Delivery failure must not resubmit a paid job; bearer/custom headers do not escape allowed content origins. `check-content-url`, `check-media-privacy`. |
| SDK delegation: `njsRunFor`, generated `njs-engine` | feature/type support → delegate or built-in veto; foreign pending jobs remain with their original engine | Switching implementation cannot lose/double-submit a pending job. Generated twin must match SDK source closure. `check-njs-delegation`, `check-njs-editor-delegation`, `check-js-parity`. |
| Model preflight and dynamic ports: `mdl`, `assertModelAvailable`, `refresh*Inputs`, model option filters | catalog absent → permissive authored ID; loaded → supported/retired; model/input change → reconcile roles, ports and options | Obsolete reference/end-frame/audio inputs are omitted before paid calls. Existing model/port, drift, LoRA, mode and option checks. |
| Prompt budgeting: `withFittedPrompt`, `learnPromptCap` | authored text → known cap → fitted request → provider rejection may teach tighter cap → next run refits | Signature describes the actual request. Never silently mislabel trimmed paid input. `check-prompt-caps`. |
| Local media transforms: `resizeCropImage`, `combine*`, trim/extract/soundtrack helpers | validate media → load metadata/decode → process → output → revoke/close; error/Stop cleans temporary resources | No provider spend for local nodes; invalid media cannot leak downstream. Existing resize, combine, audio and frame checks. |
| Demo execution: `demoMode`, `DEMO_CTX`, `markDemoResult` | signed out + supported starter → canned preview; unsupported topology → sign-in choice; real sign-in invalidates demo reuse | A sample never becomes a real generation cache entry. `smoke-first-run`, `check-stale-input-charge`. |

## Authentication, consent and accounting

| Machine / source anchor | States and transitions | Critical invariant / existing evidence |
| --- | --- | --- |
| Paste-key acceptance: `cleanKey`, `keySendable`, `probeKey`, save handlers | raw paste → normalized/sendable → checking → accepted/rejected/unverified → stored or visible correction | Only 401/403 reject the probe; network failure is explicitly unverified. `check-auth-lifecycle`, `check-login-state`. |
| OAuth redirect: `clientId`, `signIn`, `handleRedirect` | cached/register client → verifier/state → stash graph/app → redirect → validate state → exchange code → consume resume | Editor/builder preserve current work over full-page navigation. `check-login-state`, `smoke-first-run`. No live OAuth performed in this audit. |
| Embedded OAuth popup: builder `signIn`, `pkce_popup`, `finishSignIn` | synchronous blank popup → register/challenge → navigate popup → poll shared storage → key/closed/timeout | Registration failure closes blank popup; key reflection is idempotent. Existing login/browser checks. |
| Runtime authentication: `hasAuth`, `parentAuthed`, `flagAuth`, `setKey` | standalone key or parent auth message → runnable; rejected key/sign-out → disconnected UI | Embedded app cannot read parent key. `check-auth-lifecycle`, `check-bridge-consent`. |
| Imported-app spend consent: `consentAllowsCharge`, `curImported`, `curArmed`, `armImportedApp` | imported/unarmed → explicit viewer action → armed → persisted; new app recomputes gate | Catalog/poll GETs are free; unarmed code cannot autonomously spend through bridge. `check-bridge-consent`, `check-run-gating`. |
| Balance refresh: `refreshBalance`, `refreshBal`, `refreshPlayBalance` | cached/unknown → one pending refresh → queued follow-up → fresh/stale/discarded | Settlement sequence prevents older balance overwrites; request account guard now prevents cross-account refresh replies. New regression above plus `check-cost-accrue`. |
| Metering: `accrue`, `bumpCost`, `noteBalance`, `applyPollSettlement` | unknown/estimated/exact cost; real charge increments spend; terminal poll updates balance without charging again | Zero is known free; refund/completion poll cannot double-accrue. `check-cost-accrue`, `check-audio-billing`. |
| Low-funds/error mapping: `httpRunError`, `friendlyRunError` | HTTP/body/prompt failure → classified message; auth failure clears key; insufficient funds suggests top-up | 402/429/network failures must not become invalid-key logout. `check-auth-lifecycle`, `check-endpoint`. |
| Top-up UI: `offerRefuel`, `refuelPoll`, `_refuelToken` | closed → address/QR → poll baseline → observed increase/close/reopen invalidates old token | Closing/reopening cancels old polling authority. Only code/tests inspected; no financial transaction was made. |

## Persistence, recovery and app identity

| Machine / source anchor | States and transitions | Critical invariant / existing evidence |
| --- | --- | --- |
| Boot authority: boot IIFE, `wsRestorePending`, `importHashOnce` | durable restore → OAuth resume/shared hash/local graph/starter priority → interactive | Late starter/restore cannot overwrite a user-selected graph. `check-workspaces-restore-race`, `smoke-first-run`. |
| Graph persistence: `serializeGraph`, `applyGraphData`, `save`, `load` | in-memory edit → normalized snapshot → durable write; malformed/legacy import → validate/migrate/prune or reject | Invalid payload cannot wipe a good graph. `check-graph-persistence`, `check-workflow-compat`. |
| Durable workspace backend: `initWorkspaceStorage`, `wsBeginOverflow`, `wsQueuePersist` | local storage → quota/availability failure → IndexedDB restore/overflow → pending/saved/error → retry | A reported save must correspond to durable data; serialize writes and revisions. `check-workspaces-full-storage`, `check-workspaces-restore-race`. |
| Workspace recovery authority: `wsAuthorityEpoch`, `wsRecordToken`, `wsMergeRecovery` | unread database + visit edits → isolated recovery branch → later readable saved state → merge preserving both → verify/clear backup | Never replace unread saved tabs with an older recovery visit. `check-workspaces-full-storage`, `workspace-recovery.html`. |
| Workspace tab mutations: `switchWorkspace`, `openWorkspaceWithGraph`, `renameWorkspace`, `closeWorkspace` | park current graph/results/history → validate target → persist selection → reapply; restore pending blocks/defer mutations | No partial index can delete another tab during restoration. `check-workspaces`, `check-workspaces-restore-race`, `check-workspace-contextmenu`. |
| Workspace close undo: `recordClosedWorkspace`, `restoreClosedWorkspace` | close snapshot → bounded notice → paused on hidden/hover → restore or expire; later mutations invalidate incompatible redo | Closing a tab has a recoverable state and does not overwrite newer work. Existing workspace and undo checks. |
| Editor undo/redo: `pushUndo`, `_restore`, `undoMuted` | edit → snapshot → undo parks current → redo; programmatic restore suppresses new snapshots | Running nodes cannot be removed by history restoration. `check-undo-history`. |
| Result/history parking: `captureResults`, `restoreResults`, `parkWorkspaceHistory` | active in-memory result → parked tab snapshot → restored tab; reload drops non-durable paid results | This repository's documented result/undo scope is memory, not a server ledger. Existing workspace tests. |
| Editor/app binding: `setPendingApp`, `stampActiveApp`, `EDITOR_APP_KEY` | new workflow → app ID binding → workflow edit → update same app; reload/OAuth restores binding | Editing a bound workflow must not create duplicate apps. `check-create-app`, `check-apps-storage`. |
| App library persistence: `loadApps`, `saveApps`, `writeState`, `installApp` | current working state + named app record → park/commit/open/delete; malformed/full storage → fail without truncating good records | Stable app identity and version history survive switches/reloads. `check-apps-storage`. |
| Append-only customization history: `pushVersion`, `selectVersion`, `drawVersion` | current version → park edits/media → append new version; selecting older version does not truncate future versions | Media and forward history survive branching edits. `check-version-history`, `check-describe-apply`. |
| Recovery export/import page: `readSaved`, `refresh`, `show`, `download` | read owned local/session/IndexedDB keys → choose available recovery source → download | Read/export recovery does not clear source storage. Existing full-storage recovery checks. |

## Loading, sharing and user interactions

| Machine / source anchor | States and transitions | Critical invariant / existing evidence |
| --- | --- | --- |
| Catalog SWR: `primeCatalogsFromCache`, `refreshCatalogsIfStale`, `_catRefreshInflight` | cached/empty → fetch → normalize/nonempty success → cache/time stamp → interval/visibility/picker revalidation | Malformed/empty responses do not poison persistent cache. `check-catalog-fallback`. |
| Lazy 3D catalog: `ensureModel3dCatalog`, `_model3dCatP` | unrequested → single flight → usable fresh catalog or retryable failure → stale reload | Failure is no longer a permanent fulfilled-flight state. New regression above. |
| Runware content metadata: `ensureRunwareLiveCatalog`, `_runwareLive` | idle → loading/shared promise → ok/err → capability merge | Catalog enrichment is metadata, not a generation. `check-lora-ux`, existing model checks. |
| Viewer/dependency loaders: `loadGlbViewer`, `ensureNodeDeps`, GLB connected/disconnected callbacks | absent → dynamic import → ready/draw; detached → disconnect observers/resources | Viewer loads lazily; failures surface without blocking unrelated nodes. `check-3d-*`, browser journey. |
| Preview iframe lifecycle: `renderApp`, `postToApp`, readiness messages | files/graph change → bundle → new iframe/document → ready → deliver graph/auth/state | Runtime injection, mount repair and sandbox boundaries stay authoritative over customized HTML. `check-export`, `check-run-compat`. |
| Proxy requests: `proxyFetch`, parent `__api__` handler | assign ID → listen + send → response/error/abort → remove listener | Request correlation and cleanup; parent enforces allowed target/body/consent. `check-bridge-consent`, `check-content-url`. |
| Customize and Describe: `applyCustomize`, `stopCustomize`, editor copilot/version handlers | idle → stream diff → validate/apply → append version/preview, or stop/error/no applicable patch → restore controls | Failed/aborted edits cannot overwrite parked history; model fallback is bounded. `check-describe-apply`, `check-version-history`. |
| Share packing and import: `packShareFit`, `loadFromHash`, `decodeShareFragment` | sanitize graph/media → compress/budget → full/smaller/text-only share; decode → validate → import or visible error/retry | Keys/endpoint auth/private uploads never ride outbound shares. `check-share-link`, `check-media-privacy`, `check-linkerr`. |
| Shortening/copy: `shortenWith`, `syncShortenButtons`, `copyText` | long link → optional external shortening → short link/error/fallback; disabled action remains inert | Copy uses the current share; no shortening service contacted during tests. `check-share-link`, browser journey. |
| HTML export: `bundle`, `doExport` | current app snapshot → sanitized standalone document/runtime → blob/download → revoke | Export preserves runtime/auth UX and clears private author inputs. `check-export`, `smoke-first-run`. |
| Inputs and media editors: upload mount handlers, `mountInpaint`, `wireInpaintControl` | pick/read file → validate type/size → source load → paint/crop/mask → change invalidates result signature | Wire-produced inpaint source becomes brushable; unsupported payloads fail before inference. Existing upload/inpaint/frame/resize checks. |
| Pointer transactions: `startNodeDrag`, `startNodeResize`, connect/selection/pan handlers | pointer down → capture/preview → move under zoom → commit or cancel/lost capture → history/save | Cancellation restores pre-gesture geometry; running node protections and mobile touch rules remain active. Existing resize, connect, overlap and first-run journeys. The separately owned comment repair overlaps this area. |
| UI pending selections: picker, menus, context menus, keyboard focus | closed → open/filter/choose → commit/close; Escape/outside click/detached node cancels | Dynamic ports/model knobs reflect current selection, not stale menu state. Existing picker, context-menu and input/port checks. |
| Updates/articles: `renderUpdateRows`, seen flags, archive/clip visibility | unseen → render open panel → mark seen; archive expands older entries; clips load near view and stay paused | Badge counts only configured recent slots; no autoplay spend. Existing updates/presentation/media checks. |
| Recommendation helpers: `vendor/next-action/*` | interaction snapshot → debounce/score → current suggestion/quiet; later action invalidates timer/preview | Recommendations affect existing menus/guides; synthetic fixtures cover abort, collision, wire and selection edges. Existing next-action and edge checks. |
| Smallnet registry: `SmallnetRegistry`, `bootstrapSmallnet` | unknown → registered → ready/missing; fetch/shape failure remains unavailable | No model weights are shipped; local helpers cannot silently require a remote inference service. `check-smallnet`. |
| Service worker: install/activate/fetch handlers, `shellFor` | install precache → activate/claim + retire caches; network-first → eligible cache write → offline route-correct fallback | API/cross-origin requests pass through; query callbacks and partial/error responses are not cached. `check-sw-routing`, `check-deploy-config`. |
| Release lifecycle: `stamp-sw.mjs`, Workers Builds, `smoke-live.mjs` | reviewed exact head → merge main → stamp HTML/SW → build/deploy → wait for both exact stamps → browser smoke | Main merge is production deployment. No separate local deploy, npm release or migration applies. Existing production smoke failure is a pre-audit release concern, not evidence these fixes deployed. |

## Scope and release boundaries

- This inventory covers the app repository. NanoGPT server contracts and the
  sibling SDK/MCP projects have separate source owners.
- Sibling SDK main used for parity:
  `a13f5b7a44dc31b458931115e71e284da2f8ca67` (SDK PR #56). The original
  app audit used `7734e7f6209f153a634b37bd1a691b67cc276817`; the promoted
  SDK is incorporated through the normal generated-bundle freshness workflow.
- The live-catalog check currently identifies the new P-H3 Image LoRA model
  as unhandled on the audited app main. That classification repair has separate
  ownership and is a release prerequisite, rather than a reason to weaken the check.
- Browser crashes, cross-tab competing writes, provider terminal/refund
  contracts, stale auth rejection from an older generation, and service-worker
  termination are additional interleavings, not exhaustively model-checked here.
  These tests do not certify server-side payment reconciliation.
- No data migration is required. Roll back a later release through a focused
  revert and the normal reviewed main deployment path, preserving intervening
  work and browser data.
