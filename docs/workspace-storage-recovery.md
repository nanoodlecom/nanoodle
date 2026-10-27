# Workspace persistence and data-aware rollback

Before overflow, the legacy localStorage workspace keys remain authoritative.
After an overflow snapshot commits, `nanoodle-workspaces` / `workspaces` / `state`
in IndexedDB is authoritative. Each transaction stores the full graph/index/app
binding snapshot together. The legacy keys are retained as an older backup;
they are never evicted to make room. Generated results and undo stacks remain
in memory only. JSON Save files preserve workflow structure and uploaded inputs,
not generated results.

If initial IndexedDB open/read fails or times out, the editor explicitly enters
recovery mode. It does not promote the older local backup to authority and never
writes over the unread database. Visit edits are kept in a separate, versioned
recovery journal (localStorage, or sessionStorage if necessary). If neither can
store them, the UI remains visit-only and warns before refresh/close. Save still
downloads the live workflow. A late callback after timeout closes its database
connection without changing authority.

On a healthy retry or reload, the saved IDB tabs are retained and recovery-visit
tabs receive fresh IDs. Both versions remain available, including IDB-only tabs
and newer visit edits. The journal is consumed only after the merged snapshot
commits. A recovery ID in the committed record prevents a leftover journal from
replaying over newer state. While recovery is pending, new edits keep updating
the journal; an older commit cannot mark a newer edit saved.
The unload handler flushes a pending edit to that journal synchronously before
refresh can outrun the autosave debounce. Each IDB write also checks the snapshot
generation inside the same transaction: a newer writer causes recovery mode,
not a blind overwrite. Retry then reconciles both branches under fresh tab IDs.

## Export and rollback procedure

1. Prefer a forward repair that retains the storage adapter. **A whole-tree
   revert to pre-adapter HTML is not a data-aware rollback:** that editor can
   only show the older local backup. It cannot see IDB-only tabs or recent edits.
2. If rolling back UI behavior, retain the storage reader/recovery logic and
   `workspace-recovery.html` in the rollback release. Never delete, clear, or
   downgrade either database or the recovery journal. A code revert does not
   restore or migrate user data.
3. The same-origin `/workspace-recovery.html` is a read-only export path. Keep it
   deployed throughout rollback. It lists IDB tabs, recovery journals, and the
   older legacy backup separately. Each workflow download can be opened with
   Load; the full archive preserves scoped storage records for further recovery.
   No authentication keys outside those workspace records are read, and there
   are no network requests or storage writes.
4. Storage belongs to the origin. A workers.dev preview or a downloaded HTML
   file cannot read nanoodle.com's browser data. Recovery must run on the same
   production origin and browser profile. If the database is temporarily
   unavailable, keep its bytes intact and retry; do not treat a local backup as
   the latest copy.

The earlier accidental deploy of `4450173` was reverted to the prior reviewed
tree by `417f5d4`. Any IDB records created during that interval remain untouched.
Deploying the repaired reader makes them available again; the revert itself
does not make those records visible to the old editor.
