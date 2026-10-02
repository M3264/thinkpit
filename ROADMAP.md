# ThinkPit: Roadmap

## Milestone 1: Prove the conversation engine

Build a headless Go runner with provider adapters, turn-taking, human questions, interruption, limits, and transcript recording.

Exercise eight varied decision scenarios against a single-model baseline. Use findings to tune conversational behavior before building the interface.

**Exit:** the engine supports responsive exchanges and all question, interruption, and stopping rules pass deterministic tests. Record usefulness findings without assuming multi-model discussion always wins.

## Milestone 2: Ship the self-hosted web MVP

Add the chat interface, provider setup, participant configuration, question toggle, execution controls, persisted history, summaries, and Markdown export.

Include durable execution, credential protection, reconnect handling, and Docker deployment in this release. Start with free model endpoints and user-supplied provider API keys. Investigate supported OpenAI/ChatGPT and Claude account connection mechanisms, with implementation gated on a verified provider integration path.

**Exit:** a user can install ThinkPit, connect providers, hold a conversation, participate, interrupt, and return later without losing completed work.

## Milestone 3: Add evidence and tools

The web release now includes attachments, evidence links, and optional model-driven web search, public page reading, and current-time lookups with conversation-level permission. Next add MCP connections, per-participant grants, approval handling, and reusable skills.

**Exit:** participants can bring sources into a conversation while the engine preserves permission boundaries and source provenance.

## Milestone 4: Add deeper control

Introduce optional structured protocols, blind contributions, subgroup visibility, configurable turn policies, forks, comparisons, and richer exports.

Keep ordinary conversation as the default.

**Exit:** users can reproduce and compare runs without having to configure a protocol for everyday use.

## Milestone 5: Expand local capabilities

Add attachment handling, local-only data restrictions, project memory, sandboxed code execution, and improved local model setup.

Desktop packaging follows demonstrated demand. Hosted accounts, teams, billing, and marketplaces remain outside the initial roadmap.

## Delivery defaults

Use milestone acceptance gates rather than calendar promises. Preserve the original product document as `plan-original.txt` when replacing `PLAN.md`. Keep competitive, naming, and pricing claims out of the whitepaper until separately verified.
