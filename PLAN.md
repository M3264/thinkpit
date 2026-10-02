# ThinkPit: Implementation Plan

## Product

ThinkPit is a shared conversation between you and any chosen set of AI models. Participants respond to each other, ask questions, challenge assumptions, and develop ideas together.

Conversations work with any topic. Roles, structured protocols, and final reports are optional.

## First release

A single-user, self-hosted browser app where you can:

- Connect OpenAI-compatible providers and Anthropic, including reachable local model endpoints.
- Create a conversation with any number of participants, including multiple instances of the same model.
- Give participants optional names and instructions.
- Start with a topic, watch replies stream, and speak whenever you want.
- Toggle **Ask me questions**.
- Pause, resume, stop, or request a summary.
- Reopen saved conversations and export Markdown.

Start evaluation with free endpoints and explicit free model choices. Provider failures must remain visible; do not silently switch models.

The web release adds attachments and optional read-only web search, public page reading, and current-time tools. MCP, reusable skills, and advanced protocol editing remain later extensions. Supported OpenAI/ChatGPT and Claude account connection paths are planned alongside API-key connections; see [provider connection notes](docs/PROVIDERS.md).

## Stack

- **Frontend:** React, TypeScript, Vite, Tailwind.
- **Backend:** Go, using standard HTTP handlers and explicit provider adapters.
- **Database:** PostgreSQL, accessed through `pgx`, with versioned SQL migrations.
- **Streaming:** SSE for backend events; HTTP requests for messages and controls.
- **Deployment:** Docker Compose with an application container and PostgreSQL. Go serves the compiled frontend.
- **Architecture:** One Go application with separate conversation, provider, storage, and HTTP modules. Background execution stays independent of browser connections.

## Conversation engine

A conversation has explicit states: ready, running, waiting for user, paused, stopped, and failed.

One model speaks at a time initially. Participants receive the shared conversation with clear speaker identities. Replies default to brief conversational contributions; longer explanations remain possible when the topic needs them.

Each turn produces streamed text and a validated control record indicating:

- Whether another participant is addressed.
- Whether a question is directed to you and requires your answer.
- Whether the participant considers the discussion ready to pause.

The engine selects an addressed participant next. Otherwise, it rotates through eligible participants. Self-selection cannot create an endless speaking loop. Models influence turn-taking; the engine owns scheduling and permissions.

An essential question pauses execution until you answer or explicitly skip it. An optional question lets discussion continue. When questions are disabled, participants state assumptions instead of asking you.

Your message interrupts the current generation. The interrupted reply remains marked as incomplete; the next turn uses your message and completed conversation history.

A complete round in which every participant indicates no further contribution makes the conversation idle. Configurable turn and token caps provide a separate hard stop.

## Persistence and controls

Store participants, messages, turn attempts, pending questions, usage, and ordered events in PostgreSQL.

Use leased database jobs to prevent duplicate workers from advancing the same conversation. Persist completed turns before scheduling successors. Expired leases are recoverable after restart; interrupted model calls are marked explicitly rather than treated as successful.

SSE reconnects replay persisted events after the client's last event ID. Streaming text can be transient; persisted message snapshots restore the authoritative transcript.

API operations cover provider settings, conversation creation, messages, execution controls, summaries, exports, and event subscriptions. Provider secrets stay server-side, encrypted with a deployment key stored outside the database. Require a single-user login for access.

Enforce token budgets before calls by reserving output capacity. Show dollar estimates only when pricing is known; do not advertise exact dollar guarantees for unpriced endpoints.

## Acceptance tests

- Two different providers converse about a topic and respond to each other's specific points.
- The same model can participate twice with distinct identities.
- Essential questions pause; optional questions continue; disabling questions prevents new user questions.
- Human interruption cancels generation and changes the next turn's context.
- Pause, stop, and limits prevent further calls.
- Browser reconnects and application restarts preserve completed messages and pending questions.
- Provider failures surface clearly without duplicate completed turns or silent model substitution.
- Credentials never appear in browser responses, exports, or logs.

Use deterministic fake providers for engine tests and real providers for end-to-end conversational evaluation.


### Everyday interface and current information

Start with a topic and visible model choices. Keep connection settings, instructions, and limits outside the normal conversation flow. Read replies in a dedicated column with an independent participant roster, inline failure recovery, source activity, and a persistent composer.

Web access is a visible per-conversation grant. Models may request public web search, page reading, and current time; the engine validates requests and returns results to the requesting participant. Record sources, retrieval times, failures, and interruptions. Bound lookups separately from generation budgets and cancel them when humans interrupt or revoke access. Retrieved data cannot grant permissions or trigger write actions.
