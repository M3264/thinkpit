# ThinkPit reset — working proposal

Status: proposal for discussion, not an approved specification or shipped behavior.

## The experience to build

Open a room, bring something on your mind, and think it through with a few chosen models. Joining the conversation should feel immediate. Models listen, react to particular points, investigate when useful, and leave room for you.

The product should earn its value in the exchange itself. A summary or saved note can help, but neither is required to use it.

## What the current implementation gets wrong

Source review on 2026-10-02:

- Scheduling is dominated by rounds. Addressing another model only changes the next speaker when that model has not spoken in the current round. Every eligible participant must signal readiness before the conversation becomes idle. This encourages a mechanical exchange; whether a contribution is useful is left to a short general instruction.
- Automatic participant selection takes the first two catalog entries of a usable provider. Catalog order is not a reason to recommend a model, and having a credential is not proof of availability.
- Conversational text, routing, human questions, and tools depend on a model correctly emitting a custom control trailer. A malformed control record can derail a useful response.
- The interface primarily presents a transcript and execution controls. Direct replies, mentions, and following a particular point are missing from the central interaction.
- Passing deterministic tests establishes execution correctness. The available real-provider evaluation has not yet established a consistently useful complete discussion.

These findings explain plausible sources of frustration; they do not substitute for the user's account of what feels wrong.

## Proposed changes

1. **Start immediately.** Offer a small, explicit default group drawn from configured, usable models. Show identities and free/paid status when known; retain model choice without making provider setup the ordinary entry path. If no service is available, explain the actual missing connection. Never promise unlimited free access.
2. **Make conversation responsive.** Replace obligatory speaking rounds with bounded exchanges. Participants can respond to a particular message, contribute new information, or pass without posting filler. Prefer a direct addressee when eligible. Yield naturally to the human and allow an explicit request to keep going.
3. **Make joining effortless.** Reply to a message, mention a model, interrupt, and ask a follow-up from the same composer. Model identities and reply relationships should remain obvious in a busy discussion.
4. **Make research part of a contribution.** Search and reading activity belong to the message being researched, with inspectable sources and understandable failures. A source cannot grant tool permissions. Current-information questions need verified evidence or an explicit limitation.
5. **Recover without making the user operate the engine.** Bound retries, let another selected participant continue when one is unavailable, and preserve the unfinished contribution honestly. Distinguish provider outages from metadata parsing errors; never replace a model silently or execute malformed tool instructions.
6. **Design the room around reading and participation.** Use a compact participant header, clear conversational grouping, a persistent composer, and optional detail panels. Preserve the logo. Choose the replacement visual direction after the core interaction is understood.

## First build and acceptance

Build one complete room before expanding the rest of the product: enter a question, see a short substantive exchange between two models, reply to a particular point, watch a sourced lookup, encounter one unavailable model, and continue without losing the thread.

Verify with deterministic scheduling/interruption/permission tests and complete real-provider conversations. Include a decision with tradeoffs, a creative idea, and a current-information question. Inspect whether the second model responds to a specific point, whether later messages add anything, whether an interruption changes the discussion, and whether the conversation stops at a useful moment. Record failures and latency as well as successes. Do not infer conversational quality from test counts.

Keep the deployed application and stored conversations intact while developing the replacement. Reuse working storage, credential protection, event replay, and provider adapters where they support the new behavior. Document migration needs before changing persisted conversation semantics.

## Decision still needed

One concrete example of the user's intended experience: what they type, what the models do together, and what they want to see. Use it to test this proposed direction before another wholesale interface replacement.
