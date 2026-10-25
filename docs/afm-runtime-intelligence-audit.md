# AFM browser agent reliability audit

23 October 2026. Scope: the TypeScript model adapter, engine loop and browser session used by the interview-preparation agent.

## Conclusion

The user should describe the agent's purpose and preferences. They should not have to reproduce a runtime operating manual in every agent definition. The observed behavior has several integration and orchestration contributors. A longer instruction section and larger budgets do not establish that those contributors have been corrected.

This audit establishes defects and missing mechanisms from code and controlled tests. It does not establish equivalence with ChatGPT or quantify improvement in a real model's decisions.

## Confirmed findings

| Finding | Evidence | Consequence |
|---|---|---|
| Provider-native continuation was discarded | The model adapter converted only text, tool calls and usage into AFM events, then reconstructed every subsequent SDK request from the portable transcript | Opaque reasoning items, provider signatures and assistant message phase were unavailable on later tool steps |
| No shared browser operating guidance | `buildSystemPrompt` joins Role and Instructions; the browser appended attachment guidance only | Generic tool discipline, recovery, evidence handling and completion behavior had to be repeated in individual agents |
| Every selected tool schema is sent on every model round | `runAgentTurn` lists tools once and passes the complete list to each `model.stream`; `toToolSet` converts every descriptor | Large tool selections add context and cost regardless of relevance. This is a plausible contributor to inefficient selection, not proof of the cause of each extra call |
| A fixed iteration ceiling can end immediately after a tool batch | The engine defaults to ten model rounds and ends the loop without a separate completion step | Research or an asynchronous status check can consume the last round before a useful final answer |
| No asynchronous job scheduler | The runtime executes tools and returns their results; it has no general wait/resume capability | A model's promise to wait is not a scheduled continuation. Premature status checks consume model rounds |
| Generic budget notices and hidden completed tools obscured progress | Previously, the browser combined token/time stops and showed completed tool footnotes only when an assistant text answer followed | A productive but interrupted research turn could look empty. These UI/budget issues were corrected earlier in this session |

The AFM Role and Instructions are not being silently removed. Existing request tests and the new runtime integration test confirm that the authored purpose reaches the provider. Switching model IDs alone cannot repair discarded state or add orchestration mechanisms.

## Implemented foundation

### Preserve native context without changing the AFM file format

The model adapter now retains SDK-native response messages in memory and reuses them when the next request has a matching visible conversation prefix and the same system instructions. The engine still receives its existing portable text/tool transcript.

- OpenAI uses stateless responses with encrypted reasoning continuity. Complete SDK messages retain provider metadata, including message phase.
- The cache is local to a model-port instance. It does not add opaque provider content to exported AFM files or user-visible loop events.
- A changed conversation or system prompt cannot inherit an unrelated continuation. Recent branch checkpoints allow matching earlier prefixes during regeneration.
- Reloading or rebuilding the model instance intentionally loses the in-memory native checkpoint. The visible transcript remains portable. Cross-session native persistence is not implemented.

The tests use synthetic SSE responses through the real installed SDK and real agent loop. They check the actual next API request, not a mocked call to the adapter's own helper.

### Shared browser guidance

The browser adds a generic operating layer before the authored agent definition. It covers proportionate tool use, reuse of existing context, meaningful clarification, error recovery, asynchronous pending status, evidence and truthful completion.

It contains no interview-specific stages, service names, project IDs or fixed call sequence. It does not change permission enforcement or rewrite saved agent definitions.

### Browser integration

The browser consumes a pinned git dependency rather than this local model source. The source fix has been installed through `patches/afm-adapter-model-continuity.patch`, declared in `pnpm-workspace.yaml` and recorded with a patch hash in the lockfile. The installed adapter matches the updated source. Its package version and pinned upstream commit remain unchanged. This is a local dependency patch, not an upstream release.

## Validation and limits

- Model tests verify encrypted reasoning and commentary/final-answer phase replay next to function-call outputs.
- Follow-up tests verify that native items are not duplicated.
- Isolation tests verify that edited conversations and changed system instructions do not inherit unrelated provider state.
- The TypeScript interpreter suite passes 536 tests with four workers; all five packages typecheck. An unrestricted parallel run hit the existing five-second per-test timeout in the first SDK fixture on this machine, so resource-bounded execution was used.
- The browser suite passed 1,295 tests. The subsequent Anthropic regression also passed in both projects; the final targeted browser run passes all six provider-continuity/runtime-guidance tests. Browser typechecking and the production build pass.
- No real-model before/after quality or latency benchmark was performed. Passing deterministic SDK tests establishes data preservation and integration correctness; it does not prove that every model will choose fewer tools or produce better content.
- The recording guide now offers a short purpose-and-preferences definition. Saved live agent definitions were not rewritten. Reload the browser and start a fresh run to use the installed runtime, then evaluate the concise definition separately from any old long prompt.

## Next mechanisms to evaluate

1. On-demand tool discovery for large selections, with the same tool filters and permission checks. Avoid provider- or task-specific hardcoded allowlists.
2. Extend the bounded Canva job polling mechanism below to other asynchronous services, with service-specific contracts and the same permission boundaries.
3. Graceful completion near the iteration budget, with an honest partial result when work remains.
4. Checkpointing completed external actions across mid-turn model failures so a retry cannot lose knowledge of an already successful write.
5. Behavioral evaluations using the same model, tool fixtures, inputs and brief agent instructions. Measure task success, supported claims, unnecessary reads, duplicate writes, premature polls, latency and tokens. Change one mechanism at a time.

Do not use model age as the sole explanation, hide failures in a recorded workflow, or promise general ChatGPT parity without a controlled comparison.

## Canva polling follow-up

The subsequent live trace showed a completed Canva job immediately before the engine stopped at 1,132,349 cumulative tokens against its 1,000,000-token turn budget. Canva generation had succeeded; the model did not get a final request to report its returned design link. The active agent exposed 169 MCP tools, and their complete schemas were sent on each model request. Budget accounting adds input and output usage across requests, so repeated context contributes to this cumulative total.

The browser's `canva-jobs.ts` now wraps the official Canva MCP port after tool filtering. The originally requested, permission-checked status call can perform bounded read-only polling within that same action, respecting `polling_policy.wait_seconds` and using each returned continuation token. It does not create another design or dispatch other tool operations. Polling stops after two minutes or eight checks, returns the actual latest result, and is cancelled by Stop or connection disposal. Completed results are reused within the connection. Other servers and operations are passed through unchanged.

The regression uses the real engine loop and controlled service responses: six status checks plus creation complete with three model requests and a final design link inside the existing token budget. It also covers cancellation, disposal, terminal failures, long intervals, token rotation, incomplete policies and unrelated jobs. This is a deterministic regression, not a new live-generation benchmark. The complete browser suite passes 1,351 tests in 88 files; typechecking and the production build pass. The existing build chunk-size warning remains.

Large tool catalogs and graceful synthesis at an already exhausted budget remain broader runtime concerns; the Canva polling fix does not remove either general limit.

## Primary references

- [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning): preserve reasoning items alongside tool outputs; conversation history and reasoning continuity serve different purposes.
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling): tool schemas are model context, and large tool collections can benefit from deferred discovery.
- [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices): assess tool selection, argument precision and functional correctness separately.
- [Canva asynchronous job guidance](https://www.canva.dev/docs/apps/mcp/tools/get-create-design-async-job/): use the returned job/token and respect the returned polling interval.
