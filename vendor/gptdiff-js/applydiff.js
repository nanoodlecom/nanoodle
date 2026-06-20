/**
 * Diff parsing and in-memory diff application, ported from gptdiff's
 * applydiff.py. The browser has no filesystem, so `applyDiff` operates on a
 * plain `{ path: content }` map instead of a project directory on disk.
 */

import { splitLines } from './text.js';

/**
 * Parse unified diff text into individual per-file patches.
 *
 * Handles file creations (`+++ /dev/null`), deletions (`--- /dev/null` or
 * "deleted file mode"), standard modifications, headerless LLM diffs, and the
 * `*** Begin Patch` / `*** Update File:` delimiter style.
 *
 * @param {string} diffText
 * @returns {Array<[string, string]>} list of [filePath, patch] tuples
 */
export function parseDiffPerFile(diffText) {
  const dedupDiffs = (diffs) => {
    const groups = new Map();
    for (const [key, value] of diffs) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(value);
    }
    return Array.from(groups.entries()).map(([key, values]) => [key, values.join('\n')]);
  };

  // Special case: handle LLM-style patch delimiters.
  if (diffText.includes('*** Begin Patch')) {
    const lines = splitLines(diffText);
    const diffs = [];
    let currentLines = [];
    let currentFile = null;
    let inPatch = false;
    for (const line of lines) {
      const stripped = line.trim();
      if (stripped === '*** Begin Patch') {
        inPatch = true;
        currentLines = [];
        currentFile = null;
      } else if (stripped === '*** End Patch') {
        if (currentFile !== null) diffs.push([currentFile, currentLines.join('\n')]);
        inPatch = false;
      } else if (inPatch) {
        if (stripped.startsWith('*** Update File:')) {
          currentFile = stripped.split(':').slice(1).join(':').trim();
        } else {
          currentLines.push(line);
        }
      }
    }
    return dedupDiffs(diffs);
  }

  const headerRe = /^(?:diff --git\s+)?(a\/[^ ]+)\s+(b\/[^ ]+)\s*$/;
  const lines = splitLines(diffText);

  // Check if any header line exists.
  if (!lines.some((line) => headerRe.test(line))) {
    // Fallback strategy: detect file headers from '---' / '+++' pairs.
    const diffs = [];
    let currentLines = [];
    let currentFile = null;
    let deletionMode = false;
    let fromHeader = null;
    // File headers tolerate 2-3 markers because LLMs emit malformed `--`/`++`
    // headers. To avoid misreading a hunk body line that deletes/adds content
    // starting with `-`/`+` (e.g. a markdown list item `- [ ] ...` appears as
    // `-- [ ] ...` in the diff) as a new file header, a `---`/`--` line only
    // counts as a from-header when the *next* line is a `+++`/`++` to-header —
    // unified diffs always pair them. A real deletion body line is followed by
    // an ordinary `+`/context line instead, so it stays in the patch body.
    const headerFromRe = /^-{2,3}\s+(.*)$/;
    const headerToRe = /^\+{2,3}\s+(.*)$/;

    const stripPrefix = (p) => (p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p);

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const fromMatch = line.match(headerFromRe);
      const next = idx + 1 < lines.length ? lines[idx + 1] : null;
      const nextTo = next !== null ? next.match(headerToRe) : null;

      if (fromMatch && nextTo) {
        if (currentFile !== null && currentLines.length) {
          if (deletionMode && !currentLines.some((l) => l.startsWith('+++ /dev/null'))) {
            currentLines.push('+++ /dev/null');
          }
          diffs.push([currentFile, currentLines.join('\n')]);
        }
        // Start the new file and consume the paired to-header in one step.
        currentLines = [line, next];
        deletionMode = false;
        currentFile = null;
        fromHeader = fromMatch[1].trim();
        const fileTo = nextTo[1].trim();
        if (fileTo === '/dev/null') {
          deletionMode = true;
          if (fromHeader && fromHeader !== '/dev/null') {
            currentFile = stripPrefix(fromHeader);
          }
        } else {
          currentFile = stripPrefix(fileTo);
        }
        idx += 1; // skip the to-header line we just consumed
        continue;
      }

      currentLines.push(line);
      if (line.includes('deleted file mode')) deletionMode = true;
    }

    if (currentFile !== null && currentLines.length) {
      if (deletionMode && !currentLines.some((l) => l.startsWith('+++ '))) {
        currentLines.push('+++ /dev/null');
      }
      diffs.push([currentFile, currentLines.join('\n')]);
    }
    return dedupDiffs(diffs);
  }

  // Header-based strategy.
  const diffs = [];
  let currentLines = [];
  let currentFile = null;
  let deletionMode = false;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      if (currentFile !== null && currentLines.length) {
        if (deletionMode && !currentLines.some((l) => l.startsWith('+++ '))) {
          currentLines.push('+++ /dev/null');
        }
        diffs.push([currentFile, currentLines.join('\n')]);
      }
      currentLines = [line];
      deletionMode = false;
      const fileTo = m[2]; // e.g. "b/index.html"
      currentFile = fileTo.startsWith('b/') ? fileTo.slice(2) : fileTo;
    } else {
      currentLines.push(line);
      if (line.includes('deleted file mode')) deletionMode = true;
      if (line.startsWith('+++ ')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const fileTo = parts[1].trim();
          if (fileTo !== '/dev/null') {
            currentFile = fileTo.startsWith('a/') || fileTo.startsWith('b/') ? fileTo.slice(2) : fileTo;
          }
        }
      }
    }
  }
  if (currentFile !== null && currentLines.length) {
    if (deletionMode && !currentLines.some((l) => l.startsWith('+++ '))) {
      currentLines.push('+++ /dev/null');
    }
    diffs.push([currentFile, currentLines.join('\n')]);
  }
  return dedupDiffs(diffs);
}

const HUNK_HEADER_RE = /^@@(?: -(\d+)(?:,(\d+))?)?(?: \+(\d+)(?:,(\d+))?)? @@/;

/**
 * Apply a single-file unified diff patch to `originalContent`.
 *
 * Each hunk is located by matching its context+deletion lines against the
 * original rather than trusting the `@@` line numbers, which LLM-generated
 * diffs frequently get slightly wrong. The `@@` start line is used only as a
 * hint to disambiguate between multiple matching positions. The full block of
 * context and deletion lines must match exactly, so a hunk that does not apply
 * cleanly returns `null` instead of silently corrupting the file.
 *
 * @param {string} originalContent
 * @param {string} patch
 * @returns {string | null} the patched content, or null if the patch fails
 */
export function applyPatchToFile(originalContent, patch) {
  // Work with newline-free lines and re-join with '\n' at the end. This keeps a
  // file's last line (which may lack a trailing newline) on equal footing with
  // the rest, so additions after it do not swallow a blank line.
  const originalLines = splitLines(originalContent || '');
  const patchLines = splitLines(patch);

  // Parse the patch into hunks: { hint, ops: [{ kind, text }] } where kind is
  // 'context' | 'del' | 'add'.
  const hunks = [];
  let i = 0;
  while (i < patchLines.length) {
    const line = patchLines[i];
    if (line.replace(/^\s+/, '').startsWith('@@')) {
      let origStart;
      if (line.trim() === '@@') {
        origStart = 1;
      } else {
        const m = line.trim().match(HUNK_HEADER_RE);
        if (!m) return null;
        origStart = m[1] !== undefined ? parseInt(m[1], 10) : 1;
      }
      const ops = [];
      i += 1;
      while (i < patchLines.length && !patchLines[i].replace(/^\s+/, '').startsWith('@@')) {
        const pline = patchLines[i];
        if (pline.startsWith('\\')) {
          // "\ No newline at end of file" marker — ignore.
        } else if (pline.startsWith(' ')) {
          ops.push({ kind: 'context', text: pline.slice(1) });
        } else if (pline.startsWith('-')) {
          ops.push({ kind: 'del', text: pline.slice(1) });
        } else if (pline.startsWith('+')) {
          ops.push({ kind: 'add', text: pline.slice(1) });
        } else {
          // Bare context line without a leading space (LLM-style).
          ops.push({ kind: 'context', text: pline });
        }
        i += 1;
      }
      hunks.push({ hint: origStart - 1, ops });
    } else {
      i += 1;
    }
  }

  // The lines that must already exist in the original, in order, for a hunk.
  const oldBlockOf = (ops) =>
    ops.filter((o) => o.kind !== 'add').map((o) => o.text);

  // Find where `block` occurs in originalLines at index >= minPos, choosing the
  // occurrence nearest to `hint`. Returns null if there is no exact match.
  const findBlock = (block, minPos, hint) => {
    if (block.length === 0) {
      // Pure-addition hunk (e.g. new file / append): anchor at the hint.
      return Math.min(Math.max(hint, minPos), originalLines.length);
    }
    let best = null;
    for (let p = minPos; p + block.length <= originalLines.length; p++) {
      let matched = true;
      for (let j = 0; j < block.length; j++) {
        if (originalLines[p + j] !== block[j]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (best === null || Math.abs(p - hint) < Math.abs(best - hint)) best = p;
    }
    return best;
  };

  const newLines = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const block = oldBlockOf(hunk.ops);
    const pos = findBlock(block, cursor, hunk.hint);
    if (pos === null) return null;

    // Copy untouched lines between the previous hunk and this one.
    for (let k = cursor; k < pos; k++) newLines.push(originalLines[k]);

    let idx = pos;
    for (const op of hunk.ops) {
      if (op.kind === 'add') {
        newLines.push(op.text);
      } else if (op.kind === 'del') {
        idx += 1; // consume the original line without emitting it
      } else {
        newLines.push(originalLines[idx]); // context: keep the original line
        idx += 1;
      }
    }
    cursor = idx;
  }

  // Append remaining original lines.
  for (let k = cursor; k < originalLines.length; k++) newLines.push(originalLines[k]);

  let content = newLines.join('\n');
  if (content) content += '\n';
  return content;
}

/**
 * Apply a unified diff to an in-memory file map.
 *
 * @param {Record<string, string>} files map of path -> content
 * @param {string} diffText unified diff string
 * @returns {{ changed: boolean, files: Record<string, string> }}
 *   `changed` is true iff at least one file was created, modified, or deleted.
 *   `files` is a new map; on failure it equals the input (no partial changes).
 */
export function applyDiff(files, diffText) {
  const filePatches = parseDiffPerFile(diffText);
  if (!filePatches.length) {
    return { changed: false, files: { ...files } };
  }

  const original = { ...files };
  const working = { ...files };

  for (const [filePath, patch] of filePatches) {
    if (patch.includes('+++ /dev/null')) {
      // Deletion patch.
      delete working[filePath];
    } else {
      const result = applyPatchToFile(
        Object.prototype.hasOwnProperty.call(working, filePath) ? working[filePath] : '',
        patch,
      );
      if (result === null) {
        return { changed: false, files: { ...original } };
      }
      working[filePath] = result;
    }
  }

  // Verify that at least one file actually changed.
  let anyChange = false;
  for (const [filePath, patch] of filePatches) {
    if (patch.includes('+++ /dev/null')) {
      if (!Object.prototype.hasOwnProperty.call(working, filePath)) anyChange = true;
    } else {
      const had = Object.prototype.hasOwnProperty.call(original, filePath);
      if (!had || original[filePath] !== working[filePath]) anyChange = true;
    }
  }

  if (!anyChange) {
    return { changed: false, files: { ...original } };
  }
  return { changed: true, files: working };
}
