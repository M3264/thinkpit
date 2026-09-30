# ThinkPit

A conversation with your choice of AI models.

Pick the participants, give them a topic, and join in whenever you like. Pause the discussion, ask for a summary, or come back to it later.

Self-hosted, with support for free model endpoints, local models, OpenAI-compatible APIs, and Anthropic.

## Run

```sh
python3 scripts/setup.py
docker compose up -d --build
```

Open [localhost:8080](http://localhost:8080). Your login is in `.env`.

[Setup & development](docs/DEVELOPMENT.md) · [API](docs/API.md) · [Roadmap](ROADMAP.md)
