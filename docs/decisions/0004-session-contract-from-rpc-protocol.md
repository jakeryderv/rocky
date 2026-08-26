# ADR 0004: Derive the Rocky session contract from the harness RPC protocol

- Status: Accepted
- Date: 2026-08-25
- Implements the client-architecture decision in [ADR 0003](0003-bun-platform-and-harness-fork.md).

## Context

ADR 0003 decided that Rocky's agent core stays headless behind a Rocky-owned contract with serializable
commands/events/state and no Pi types leaking, with an OpenTUI + Solid client consuming only that contract.
[`roadmap.md`](../roadmap.md) sequenced the contract as the next step, framed as new design work.

The fork already contains a serializable protocol serving exactly this purpose:
`packages/harness/src/modes/rpc/` defines JSON-line commands, events, and state (`rpc-types.ts`, 289 lines),
a server (`rpc-mode.ts`), and a working consumer (`rpc-client.ts`). It is proven by the RPC mode Rocky ships
today. Its only leaks of upstream Pi types are four imports: `AgentMessage` and `ThinkingLevel` from
`pi-agent-core`, `ImageContent` and `Model` from `pi-ai`. Everything else it references
(`SessionStats`, `BashResult`, `SessionEntry`, `SourceInfo`) is fork-owned code.

Designing a contract from scratch would discard that evidence and invite over-modeling: a contract with no
consumer tends to specify state and events no client reads.

## Decision

- **Derive the contract from the RPC protocol's shapes** rather than designing greenfield. The contract lives
  in `src/contract/` in the root package — Rocky-owned, not in the harness.
- **Replace the four Pi type leaks with Rocky-owned equivalents**: `ThinkingLevel` (a Rocky string union),
  `ModelRef` (provider/id plus display and capability fields, replacing `Model<Api>` and its generics and
  non-serializable capability values), `ImageBlock` (replacing `ImageContent`), and `SessionMessage`
  (replacing `AgentMessage`).
- **Scope the first cut to a vertical slice** — what a terminal client needs to drive and render a session:
  prompt/steer/follow-up/abort, state and message queries, model and thinking-level control, queue modes, and
  compaction. Session management (fork, clone, switch), bash execution, and extension UI stay in the harness
  RPC protocol and are promoted into the contract when a client actually consumes them.
- **Translation lives in `src/adapter/`**, never in the contract. `map-to-contract.ts` holds pure functions;
  `PiAgentSessionAdapter` wires a live `AgentSession` and depends on a structural `AgentSessionLike` interface
  rather than the harness class, so it is testable without a session and does not force clients to resolve
  harness types.
- **Enforce isolation mechanically**: `test/contract-isolation.test.ts` fails if any contract module imports
  from `@earendil-works/*`, from `@jakeryderv/rocky-harness`, or from outside the contract directory at all,
  and round-trips every fixture through both `JSON` and `structuredClone`.
- **Unmapped harness events and message kinds are dropped, not leaked.** The harness emits more granularity
  than the contract exposes; mapping functions return `undefined` for anything without a contract shape.

## Consequences

The contract starts smaller than the RPC protocol and grows as clients demand, which is the intended
direction: the OpenTUI client and the contract advance together rather than the contract being finished
first. The RPC protocol and the contract now describe overlapping ground — that duplication is accepted while
the inherited `InteractiveMode` still ships, and resolves when `modes/interactive` and `modes/rpc` are
reconsidered against the Rocky client.

Because the adapter takes a structural interface, harness signature changes surface as type errors in
`AgentSessionLike` rather than throughout client code. Enum values arriving from the harness are normalized
with explicit fallbacks (`toThinkingLevel`, `toStopReason`), so an upstream enum addition degrades to a safe
default instead of emitting a value no client can interpret.

## Corrections from the first adversarial review (2026-08-25)

An adversarial review of the first cut against a planned OpenTUI client found six defects that would each have
produced visibly wrong output, and one worthless test. All are fixed; each has a regression test built from the
shape the harness actually emits rather than an invented one:

- **Tool results were unreadable.** `ToolResultMessage` has no `output` field and its `content` is a
  `(TextContent | ImageContent)[]`, so the mapper stringified the wrapper and a client would render
  `[{"type":"text","text":"…"}]`. Results are now flattened to text, with image blocks described rather than
  dumped. The original test used `result: "done"` — a shape the harness never emits — which hid this.
- **Phantom assistant bubbles.** `message_start` was hardcoded to `role: "assistant"`, but the harness opens a
  message for the user prompt and for every tool result too. The role now comes from the event, and the
  contract's `message_start` admits `"user" | "assistant" | "tool_result"`.
- **Deltas could not be attributed to a content block.** Upstream carries `contentIndex` on every streaming
  event and the harness's own wire form preserves it; Rocky was the only layer dropping it. `MessageDelta`
  now carries `index`, so interleaved text/thinking/tool-call blocks reconstruct correctly.
- **Tool-call streaming was ambiguous.** Fragments and the terminal event both mapped to `tool_call_delta`, so
  a client could not tell "concatenate this" from "replace with this". Split into `tool_call_delta`
  (a fragment) and `tool_call_end` (authoritative).
- **A permanently frozen token counter.** Usage was read only from `event.usage`, which exists on the JSON/RPC
  wire form but not on the live `subscribe` path, where it sits on the cumulative message. Both are read now.
- **Failed turns gave no reason.** `AssistantMessage.errorMessage` was dropped; it is now carried.
- **The exhaustiveness test was vacuous.** Its union scan stopped at the first semicolon, but variants are
  written `{ type: "turn_end"; stopReason: StopReason }` — so it checked 2 of 16 event types and passed. Fixed
  to terminate at the declaration's end, extended to the `MessageDelta` union and the `message_start` roles,
  and given a lower-bound assertion so a future truncation fails instead of passing quietly.

The general lesson, recorded because it will recur: a mapping layer tested only against fixtures the mapper's
own author invented will agree with itself. The regression tests now derive from the upstream `.d.ts` shapes.

Verified against a live session on both runtimes: a real turn driven through `PiAgentSessionAdapter` produces
identical contract events under Node 24 and Bun 1.4.0, with every emitted value surviving JSON and
`structuredClone` round-trips.
