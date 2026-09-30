# Backend API

The browser signs in through `POST /api/login` with JSON `username` and `password`, receiving an eight-hour HttpOnly, SameSite=Strict session cookie. `GET /api/session` checks the session; `POST /api/logout` clears the browser cookie. Other `/api` routes require that session or the single-user HTTP Basic login. The health check is unauthenticated. JSON mutation endpoints require `Content-Type: application/json`; unknown fields are rejected. Cross-origin browser mutations are rejected. Credentials belong in an authorization header, never in a URL.

The examples use curl's password prompt (`-u admin`) so secrets do not enter shell history.

## Provider settings

```sh
curl -u admin -X PUT http://localhost:8080/api/providers/pollinations \
  -H 'Content-Type: application/json' \
  -d '{"name":"Pollinations","kind":"openai_compat","base_url":"https://text.pollinations.ai","endpoint_path":"/openai","api_key":""}'
```

Supported kinds are `openai_compat` and `anthropic`. A base URL normally ends in `/v1`; adapters append `/chat/completions` or `/messages`. `endpoint_path` overrides that suffix for compatible endpoints with different routes. URLs must use HTTP or HTTPS and cannot contain embedded credentials or query parameters.

Use `api_key` for keyed providers. `PUT` replaces provider settings. Omitting `api_key` preserves an existing saved key; an empty key explicitly removes it. Reads and writes return `has_key` without returning the key value. `GET /api/providers` lists configured providers.

## Create and start

```sh
curl -u admin -X POST http://localhost:8080/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"topic":"How should a fictional library trial longer weekend hours?","ask_questions":true,"participants":[{"id":"access","name":"Access","provider_id":"pollinations","model":"openai-fast"},{"id":"staffing","name":"Staffing","provider_id":"pollinations","model":"openai-fast"}],"limits":{"max_turns":6,"max_tokens":100000,"max_output_tokens":1024}}'
```

The result is a ready conversation. Participant IDs must be unique; names and instructions are optional. Use its `id` below:

```sh
curl -u admin -X POST http://localhost:8080/api/conversations/CONVERSATION_ID/controls \
  -H 'Content-Type: application/json' -d '{"action":"start"}'
```

Creation defaults: questions enabled, 24 turn attempts, 100,000 token budget units, and 512 output tokens per call. Failed/interrupted attempts count toward limits. A deployment may configure up to 64 participants; resource caps are finite even though the product has no fixed model count.

## Controls

`POST /api/conversations/{id}/controls` accepts:

| Action | Additional fields | Behavior |
| --- | --- | --- |
| `start`, `resume` | None | Runs a ready/paused conversation; a pending essential question still blocks |
| `message` | `text` | Adds human input, interrupts active work, answers a pending question, wakes an idle conversation |
| `retry` | None | Retries a failed contribution with the same participant and context; previous incomplete attempts remain recorded |
| `pause` | None | Interrupts active work; retains any pending question |
| `stop` | None | Interrupts work and stops permanently |
| `skip_question` | None | Records an explicit skip and releases the pending question |
| `questions` | `ask_questions` boolean | Changes question policy, interrupts active work, releases a pending question when disabled |
| `summary` | None | Requests a cited summary from the next participant while ready, paused, or stopped; caps still apply |

A failed conversation can use `retry` directly, or an explicit human message followed by resume after changing context or provider settings. Already-stopped conversations can be exported, deleted, or summarized but cannot resume ordinary discussion. A requested summary ends paused, or returns to stopped if the conversation was stopped.

## Read, export, delete

- `GET /api/conversations` returns the latest 100 records.
- `GET /api/conversations/{id}` returns the authoritative snapshot, including participant identities, message statuses, attempts, usage, a pending essential question, and `last_event_id`. The snapshot and cursor are read atomically; use this cursor when first subscribing to avoid replaying older snapshots.
- `GET /api/conversations/{id}/export` downloads Markdown.
- `DELETE /api/conversations/{id}` removes the record and all associated events. Active calls cancel when their worker observes the deletion.

## Events and reconnects

```sh
curl -N -u admin http://localhost:8080/api/conversations/CONVERSATION_ID/events
curl -N -u admin -H 'Last-Event-ID: 42' \
  http://localhost:8080/api/conversations/CONVERSATION_ID/events
```

Events have monotonic database IDs, a named `event`, and a JSON `data` payload. IDs are global, so gaps within a conversation are expected. Reconnect replays only that conversation's events after the supplied ID, then follows new events.

`created`, `control`, `turn_started`, `turn_finished`, and `recovered` contain authoritative conversation snapshots. `text_delta` contains `attempt_id` and `text`; match it to the active attempt before updating a UI. Snapshots replace provisional streaming content. Provider control JSON is removed from text deltas and stored as validated message metadata after completion.

The engine states are `ready`, `running`, `waiting_for_user`, `paused`, `stopped`, and `failed`. Ready with reason `idle` means the discussion has completed a quiet round. Failed turns retain an incomplete reply and a safe error in their attempt record.

HTTP 400 means malformed input, 401 means authentication is required, 403 means a rejected origin, 404 means a missing record, 409 means an invalid state transition, and 500 means a storage operation failed. Upstream provider failures appear in conversation state rather than in the initiating HTTP response because generation happens in the background.

## Model discovery and saved setups

`GET /api/providers/{id}/models` reads the saved provider's catalog using its server-side key. `GET /api/catalog/openrouter` browses OpenRouter's public catalog without saving a provider. Results contain IDs, names, descriptions, context lengths, advertised capabilities, and optional `free` status. Unknown pricing stays unknown; catalog availability does not imply that generation needs no key. Catalogs are bounded to 5,000 records.

`GET /api/setups` lists saved participant configurations. `PUT /api/setups/{id}` saves `name`, `participants`, `ask_questions`, and `limits`. `DELETE /api/setups/{id}` removes one. Setups contain no provider credentials or conversation context.

## Files and web evidence

`POST /api/attachments` accepts multipart field `file`, up to 2 MB: UTF-8 text, Markdown, CSV, TSV, JSON, logs, or text-based PDFs. PDF extraction needs `pdftotext`, included in the app image. Scanned PDFs need text extraction elsewhere.

`POST /api/search` takes JSON `query` and returns search results and partial-engine warnings. `POST /api/sources` takes JSON `url`, fetches a public HTTP(S) page, and extracts readable text. Private network addresses and redirects to them are rejected.

Uploads and fetched pages return `evidence` and a signed `token`, valid for 24 hours. Send those strings in `context_tokens` when creating a conversation or submitting a `message` control. Each item is limited to a 16 KB excerpt; conversations hold at most 20 items and 96 KB of context. Evidence persists with the conversation, appears in snapshots and exports, and is deleted with it. Context is marked as untrusted reference material in model prompts. Search only runs when requested by the human; models do not autonomously browse or run tools.

Transient connection errors, HTTP 408/429, and 5xx responses before any streamed text get up to two automatic retries (three attempts total), with 2s/4s backoff or a longer provider `Retry-After`. Each retry creates a separate recorded attempt and reserves tokens; existing global turn/token caps still apply. Partial replies and permanent failures (such as 400/401) require manual retry. Retry timestamps and counts persist in snapshots; workers skip future retry jobs, including after restart. Pause, stop, or human interruption cancel a queued retry. `retry` after exhaustion starts a fresh bounded retry sequence while preserving global caps.
