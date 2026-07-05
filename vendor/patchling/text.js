/**
 * Pure text utilities ported from gptdiff's Python implementation.
 *
 * These have no I/O and run identically in the browser and Node.
 */

/**
 * Split a string into lines while keeping the line-ending characters attached,
 * mirroring Python's `str.splitlines(keepends=True)` for `\n`, `\r`, `\r\n`.
 *
 * @param {string} s
 * @returns {string[]}
 */
export function splitLinesKeepEnds(s) {
  if (s === '') return [];
  const lines = [];
  let i = 0;
  let start = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') {
      lines.push(s.slice(start, i + 1));
      i += 1;
      start = i;
    } else if (ch === '\r') {
      if (s[i + 1] === '\n') {
        lines.push(s.slice(start, i + 2));
        i += 2;
      } else {
        lines.push(s.slice(start, i + 1));
        i += 1;
      }
      start = i;
    } else {
      i += 1;
    }
  }
  if (start < s.length) lines.push(s.slice(start));
  return lines;
}

/**
 * Split a string into lines WITHOUT keeping line endings, mirroring Python's
 * `str.splitlines()` — notably, a single trailing newline does not produce a
 * trailing empty element.
 *
 * @param {string} s
 * @returns {string[]}
 */
export function splitLines(s) {
  if (s === '') return [];
  const parts = s.split(/\r\n|\r|\n/);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Color-code a diff for terminal output: lines starting with '-' in red and
 * lines starting with '+' in green. Other lines are untouched.
 *
 * @param {string} diffText
 * @returns {string}
 */
export function colorCodeDiff(diffText) {
  const red = '\x1b[31m';
  const green = '\x1b[32m';
  const reset = '\x1b[0m';

  return diffText
    .split('\n')
    .map((line) => {
      if (line.startsWith('-')) return `${red}${line}${reset}`;
      if (line.startsWith('+')) return `${green}${line}${reset}`;
      return line;
    })
    .join('\n');
}

/**
 * Extract and remove the chain-of-thought reasoning block from an LLM response.
 *
 * The reasoning block begins with a line containing "> Reasoning" and ends with
 * a "Reasoned ... seconds" marker. Multiple blocks are supported.
 *
 * @param {string} fullResponse
 * @returns {[string, string]} tuple of [finalContent, reasoning]
 */
export function swallowReasoning(fullResponse) {
  const pattern = />\s*Reasoning[\s\S]*?Reasoned[\s\S]*?seconds/g;
  const reasoningList = [];

  const finalContent = fullResponse.replace(pattern, (match) => {
    const reasoning = match
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/^\++/, '').trim())
      .join('\n')
      .trim();
    reasoningList.push(reasoning);
    return '';
  });

  return [finalContent.trim(), reasoningList.join('\n')];
}

/**
 * If the LLM wrapped the file content in a Markdown code fence, unwrap it.
 *
 * Uses line-based fence detection (open on the first ``` line, close on the
 * LAST ``` line) so inner triple-backticks inside the file content do not
 * truncate the result. File content — including a trailing newline — is
 * preserved verbatim.
 *
 * @param {string} updated
 * @param {string} original
 * @returns {string}
 */
export function stripBadOutput(updated, original) {
  // If the file itself starts with a code fence, don't try to unwrap.
  if (original.replace(/^\s+/, '').startsWith('```')) {
    return updated;
  }

  const lines = splitLinesKeepEnds(updated);

  // Find the first line that opens a fence (possibly after a preamble).
  let openIdx = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/^\s+/, '').startsWith('```')) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === null) return updated;

  // Find the LAST line that is exactly a closing fence after the opener.
  let closeIdx = null;
  for (let i = lines.length - 1; i > openIdx; i--) {
    if (lines[i].trim() === '```') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === null) return updated;

  let inner = lines.slice(openIdx + 1, closeIdx).join('');

  // If the opener was a bare ``` and the model put the language on the next
  // line instead (e.g. "```\npython\n..."), drop that stray language tag.
  if (lines[openIdx].trim() === '```') {
    const innerLines = splitLinesKeepEnds(inner);
    if (innerLines.length > 1) {
      const firstInner = innerLines[0].trim();
      if (firstInner && !firstInner.includes(' ') && firstInner.toLowerCase() !== 'diff') {
        inner = innerLines.slice(1).join('');
      }
    }
  }

  return inner;
}

/**
 * Extract the bodies of all ```diff fenced code blocks from `text`.
 * Mirrors the MarkdownParser + "diff" tool collection in the Python source.
 *
 * @param {string} text
 * @returns {string[]} block bodies in document order
 */
export function extractDiffBlocks(text) {
  const blocks = [];
  const lines = text.split(/\r\n|\r|\n/);
  let inBlock = false;
  let current = [];
  const flush = () => {
    // Mirror the Markdown tool parser: the captured block body keeps the
    // newline that precedes the closing fence.
    blocks.push(current.length ? current.join('\n') + '\n' : '');
  };
  for (const line of lines) {
    const stripped = line.trim();
    if (!inBlock) {
      // Only fences whose language is exactly "diff" open a collected block,
      // matching the Python source (which routes solely the "diff" tool).
      if (stripped.startsWith('```') && stripped.slice(3).trim() === 'diff') {
        inBlock = true;
        current = [];
      }
      continue;
    }
    if (stripped.startsWith('```')) {
      flush();
      inBlock = false;
      current = [];
      continue;
    }
    current.push(line);
  }
  // Force-close an unterminated block (the parser keeps the trailing buffer).
  if (inBlock) flush();
  return blocks;
}

/**
 * Remove `<think>...</think>` blocks from a response, returning the content
 * outside any think tool. Mirrors call_llm_for_apply_with_think_tool_available.
 *
 * @param {string} response
 * @returns {string}
 */
export function stripThinkTags(response) {
  const [withoutReasoning] = swallowReasoning(response);
  let withoutThink = withoutReasoning.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Force-close a dangling, unterminated <think> tag (mirrors the XML parser,
  // which swallows everything after an unclosed tag) so chain-of-thought is not
  // written into the file.
  withoutThink = withoutThink.replace(/<think>[\s\S]*$/, '');
  return withoutThink.trim();
}
