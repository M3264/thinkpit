# ThinkPit: Whitepaper

## Abstract

ThinkPit is a provider-independent environment for conversations involving humans and multiple AI models. Its central hypothesis is that responsive interaction can help people explore decisions more effectively than collecting separate model answers. This is a hypothesis to evaluate, not a demonstrated performance claim.

## Interaction model

The human and models share a persistent conversation. Models can question, disagree, clarify, and build on previous contributions. Participation requires no predefined role or topic-specific workflow.

Human participation is optional at each moment. Models distinguish questions that block progress from questions that merely invite input. A user-controlled setting disables questions directed to the human.

Structured workflows remain an optional extension of this conversational foundation.

## Execution model

Providers generate contributions and propose conversational actions. An authoritative Go engine validates those actions, schedules turns, enforces limits, and records state.

Models cannot change permissions or execution rules through conversational text. Read-only tool output is treated as untrusted material. A visible conversation-level grant permits public web search, public page reading, and current-time lookups. The engine validates requests and records results, sources, and failures; later tool integrations require their own access boundaries.

The browser observes execution and submits user actions; it does not own the lifetime of a conversation.

## Traceability and limits

Speaker identities, provider/model identifiers, reply relationships, interruptions, and usage accompany the transcript. Requested summaries link conclusions and disagreement back to messages.

A message link establishes provenance, not truth. Model agreement is not independent verification. Multiple participants can repeat the same mistaken assumption, and additional calls increase cost and latency.

Initial evaluation examines conversational responsiveness, useful disagreement, appropriate questions, decision usefulness, latency, and cost against a single-model baseline.

## Privacy

Self-hosting gives the operator control over stored conversations. External model providers still receive the context sent to them. Local-only operation requires local endpoints and no external tools.

The interface identifies each participant's provider before execution. Credentials are protected server-side, and operators can export and delete conversations.

When Web access is enabled, models may send search queries to the configured search service and its engines, and fetch public pages. Operators can disable this per conversation. Model providers receive the returned excerpts as conversation context.
