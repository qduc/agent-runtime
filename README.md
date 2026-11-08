# Agent Runtime

**Give your agent host and its clients a shared language.**

An agent can stream reasoning, ask for approval, run background work, and finish
a turn—all while a browser or terminal client disconnects and reconnects. Those
clients need to agree on what each event means, which changes belong together,
and what is accepted work versus temporary progress.

Agent Runtime provides TypeScript packages for that boundary. Start with
**`@qduc/agent-wire`** for versioned event types and structural validation. The
companion **`@qduc/agent-core`** provides registry factories and a preliminary
headless session API.

## Why use it?

If your backend and clients each define their own agent-event JSON, you have to
keep them aligned as the product grows. A TypeScript type alone does not check
what actually arrives over the network.

`agent-wire` gives you:

- **A shared contract instead of duplicated event shapes.** Import the same
  types and parsers in your host and clients.
- **An explicit line between accepted work and live progress.** V2 separates
  accepted batches with a sequence from cursorless live updates, so your app
  can handle persistence and transient display differently.
- **A validation boundary for incoming data.** Reject malformed envelopes,
  wrong-session packets, and incompatible schema versions before using them.
  Selected payload structures are validated too; application domain rules remain yours.
- **Room to keep your own architecture.** Wire has no runtime dependencies and
  does not choose your model provider, UI, transport, or storage.

## Is it for my project?

**Good fit:** you are building an agent host with a browser, terminal, or other
client, and want a common event contract with clear acceptance and replay
responsibilities. It also works as a contract between independently developed
producers and consumers.

**Probably not:** you want a ready-made chatbot, hosted service, agent loop, or
an SDK that turns a prompt into an answer with one call. These packages do not
provide that experience.

| Package                                       | Use it for                                                              | Readiness                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@qduc/agent-wire`](packages/wire/README.md) | Event/interaction types, structural parsers, and configuration receipts | Standalone contract API with retained v1 and explicit v2 support                |
| [`@qduc/agent-core`](packages/core/README.md) | Separate provider/search registries and account stores                  | Factories are usable; external session construction still needs public-API work |

Both packages are ESM-only, require Node.js 20+, and are MIT licensed. Wire is
independent of core—you do not need the runtime package to use its contracts.

## Sold? Try it in your project

**[Follow the Getting Started guide →](docs/getting-started.md)**

Build a wire tarball, install it into a separate Node.js project, and run a
complete example that distinguishes accepted events from live updates and
rejects invalid packets. No model account or API key is needed.

The documented installation route is a source-built tarball: the package names
were not publicly resolvable on npm when this guide was verified. Do not assume
`npm install @qduc/agent-wire` is available yet.

For a taste of the API, after installing wire:

```ts
import { parseAgentEventEnvelopeV2 } from "@qduc/agent-wire";

const event = parseAgentEventEnvelopeV2(
  {
    schemaVersion: 2,
    kind: "live",
    sessionId: "session-1",
    changes: [
      { type: "reasoning_delta", payload: { delta: "Considering options" } },
    ],
  },
  "session-1"
);

console.log(event.kind); // live — not an accepted checkpoint
```

The parser checks the packet; your application still owns event acceptance,
authentication, state updates, persistence, and replay. See the
[wire contract](packages/wire/docs/v2.md) for the precise boundary.

## Go deeper

- [Getting Started](docs/getting-started.md): install and run the examples.
- [Wire package](packages/wire/README.md): choose a schema and understand its scope.
- [Wire migration guide](packages/wire/docs/migration-v1-v2.md): version compatibility and consumer migration.
- [Core package](packages/core/README.md): registry examples and session API limitations.
- [Core API boundaries](docs/core-migration-scope.md): internal dependencies and process-wide state.
- [Release runbook](docs/release.md): maintainers' validation and publication workflow.

## Contributing

Building the checkout requires Node.js 22.13+ and pnpm 11.7.0; Node.js 24 is
recommended and used by CI. This is separate from the packages' declared
Node.js 20+ runtime requirement.

Public entries live at `packages/core/src/index.ts` and
`packages/wire/src/index.ts`. Core's implementation and prompt assets live under
`packages/core/src/source/`; those files are not a supported deep-import API.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm smoke
pnpm smoke:checkout
```

`smoke` verifies packed packages in a separate consumer, including strict public
TypeScript declarations. `smoke:checkout` checks committed HEAD in an isolated
clone; it needs network access and does not include uncommitted edits. These
checks help catch dependencies accidentally supplied by a parent workspace.
Publication is separate and manual; see the release runbook.
