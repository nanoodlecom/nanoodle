/**
 * gptdiff-js — generate and apply git diffs using LLMs, in the browser.
 *
 * Public API mirrors the gptdiff Python package, scoped to generateDiff +
 * smartapply and their building blocks.
 */

export { generateDiff, smartapply, buildEnvironment, callLlmForDiff, callLlmForApply, callLlmForApplyWithThink } from './gptdiff.js';
export { parseDiffPerFile, applyDiff, applyPatchToFile } from './applydiff.js';
export { colorCodeDiff, swallowReasoning, stripBadOutput, extractDiffBlocks, stripThinkTags } from './text.js';
export { callLlm, resolveApiKey, resolveBaseUrl } from './llm.js';
export { getEnv, setEnv, DEFAULT_MODEL, DEFAULT_BASE_URL } from './env.js';
export * as oauth from './oauth.js';
