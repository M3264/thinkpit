# ThinkPit

A shared conversation between you and any chosen set of AI models. Participants respond to each other, challenge assumptions, and develop ideas together. Roles and structured workflows are optional.

The first backend slice is implemented: a Go conversation engine, a headless runner, PostgreSQL persistence, authenticated HTTP controls, streamed events, OpenAI-compatible and Anthropic adapters, and Markdown export. The browser interface is the next milestone.

## Try a free conversation

Install Go 1.25 or later, then:

```sh
go build -o bin/thinkpit ./cmd/thinkpit
./bin/thinkpit run -config examples/pollinations.json -out data/conversation.json
```

The Pollinations example uses two distinct identities on the same anonymous model endpoint. It was exercised against the live endpoint on September 30, 2026. Availability can change. Contributions must include a valid control record; malformed output, truncated streams, and reported token overruns fail visibly without a model substitution. JSON and Markdown transcripts are saved after each streamed contribution.

For two different free models, use `examples/openrouter.json` with an `OPENROUTER_API_KEY` in your environment. The example selects explicit `:free` models rather than a random router. Model availability was checked against the live catalog; generation through OpenRouter requires your key and has not been evaluated here. See the [OpenRouter documentation](https://openrouter.ai/docs/guides/routing/routers/free-router).

To answer a saved essential question:

```sh
./bin/thinkpit run -config examples/pollinations.json \
  -resume data/conversation.json -out data/conversation.json \
  -action message -text 'Our budget is fixed at 100 units.'
```

Other saved-conversation actions are `skip_question`, `pause`, `resume`, `stop`, `summary`, and `questions` (with `-questions=false`). A stopped conversation returns to stopped after a requested summary; caps also apply to summaries.

## Run the backend

```sh
python3 scripts/setup.py
docker compose up -d --build
curl http://localhost:8080/healthz
```

Setup creates `.env` and `secrets/deployment.key` without printing their values or replacing existing credentials. Retrieve your login password from `.env` locally. The application binds to host loopback; PostgreSQL is reachable only on the Compose network. Use HTTPS at your reverse proxy if you expose the authenticated API beyond the host.

Back up the database **and** the deployment key. Losing the key prevents decrypting saved provider credentials. Provider keys are encrypted using AES-GCM with provider IDs bound as authenticated data. They are never returned from settings reads or included in exports. Conversation content itself is stored in PostgreSQL as plaintext.

The backend uses single-user HTTP Basic authentication (`THINKPIT_USERNAME`, `THINKPIT_PASSWORD`). Every `/api` endpoint requires it. The browser login experience will be built with the frontend. See [the API guide](docs/API.md) for provider setup, conversations, controls, and SSE replay.

For local development, run PostgreSQL and set `DATABASE_URL`, `THINKPIT_PASSWORD`, and `THINKPIT_KEY_FILE`, then `go run ./cmd/thinkpit serve`. `THINKPIT_ADDR` defaults to `127.0.0.1:8080`. A local model endpoint must be reachable from the application process; inside Compose, `localhost` refers to the app container.

## Verify

```sh
go vet ./...
go test -race ./...
```

PostgreSQL integration tests require a dedicated database named `thinkpit_test`; they clear that database's ThinkPit tables:

```sh
THINKPIT_TEST_DATABASE_URL='postgres://postgres:password@localhost:5432/thinkpit_test?sslmode=disable' \
  go test -race ./...
```

CI runs these tests with a PostgreSQL service and builds the container. Tests cover shared context across two provider adapters, duplicate workers, required/optional/disabled questions, interruption, stopping, caps, expired lease recovery, persisted pending questions, authentication, credential encryption, and event replay.

Run the eight-scenario comparison with:

```sh
python3 scripts/evaluate.py --config examples/pollinations.json
```

This records single-participant and conversation transcripts, timings, usage, and failures for human review. It does not automatically score usefulness or prove that multiple participants improve decisions. See [evaluation findings](docs/EVALUATION.md).

## Design and current limits

The engine schedules one participant at a time, preserves identities even when the same model appears twice, and prevents addressed turns from starving anyone within a round. A complete round of participants ready to pause makes the conversation idle. A new human message wakes an idle discussion, releases a pending question, or interrupts an active generation. Messages sent while paused or stopped do not start new calls.

State changes, transcript snapshots, attempts, reservations, and events commit transactionally. Each active turn owns a renewable 30-second database lease. Expired calls remain incomplete and retain their token reservation; late workers cannot commit into a new lease. Calls are not blindly retried and provider errors do not trigger fallback. Browser connections do not own execution.

Conversation records currently use PostgreSQL JSONB snapshots, with separate ordered event and encrypted provider tables. The event stream persists text deltas and complete snapshots. Each application process runs one worker, so another conversation waits while that process generates a turn; multiple application processes can claim different conversations safely.

Before a call, the engine reserves a conservative byte-based input estimate plus output capacity. Final provider usage reconciles that reservation when available; unknown or interrupted calls retain it. Input estimates are not a tokenizer guarantee for arbitrary endpoints. A provider can report more usage than requested, in which case the engine fails and schedules no successor. No dollar estimates or dollar guarantees are offered.

The current prompt-based control protocol works without tool-calling support but can fail on models that do not follow instructions. This is an explicit evaluation issue. There is no browser UI, model discovery UI, attachment handling, search, tool execution, or account OAuth integration yet.

[PLAN.md](PLAN.md), [WHITEPAPER.md](WHITEPAPER.md), and [ROADMAP.md](ROADMAP.md) define the product and milestone gates. [Provider connections](docs/PROVIDERS.md) records the free-first setup and planned account connection paths.
