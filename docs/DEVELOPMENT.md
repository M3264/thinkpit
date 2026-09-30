# Development

Run PostgreSQL, then set `DATABASE_URL`, `THINKPIT_PASSWORD`, and `THINKPIT_KEY_FILE`. The deployment key is created by `python3 scripts/setup.py`.

```sh
go run ./cmd/thinkpit serve
cd web
npm ci
npm run dev
```

Vite proxies API requests to the backend. Set `THINKPIT_BACKEND` when it is running somewhere other than `http://127.0.0.1:8080`.

```sh
go vet ./...
go test -race ./...
cd web
npm run build
npx playwright install --with-deps chromium
npm test
```

PostgreSQL integration tests require `THINKPIT_TEST_DATABASE_URL` pointing to a dedicated database named `thinkpit_test`. Tests clear its ThinkPit tables.

For a headless conversation:

```sh
go build -o bin/thinkpit ./cmd/thinkpit
./bin/thinkpit run -config examples/pollinations.json -out data/conversation.json
```

For free OpenRouter models, set `OPENROUTER_API_KEY` and use `examples/openrouter.json`. The eight-scenario evaluation runner is `scripts/evaluate.py`.

Back up PostgreSQL and `secrets/deployment.key` together. Keep the deployment bound to loopback or serve it behind an HTTPS proxy. `THINKPIT_PORT` changes the Compose host port. `THINKPIT_BIND` defaults to `127.0.0.1`; set it to `0.0.0.0` in `.env` to expose that port publicly. Set `THINKPIT_PUBLIC_ORIGIN` to the external origin (for example `https://thinkpit.example`) when using a reverse proxy, so browser mutation checks and secure session cookies match that origin. Local endpoints must be reachable from the application container.

The live HTTPS proxy configuration is in `deploy/nginx/thinkpit.conf`. It routes `tp.kennyy.tech` to the loopback application on port 18080 and leaves streaming unbuffered. Its Let’s Encrypt certificate renews through the system Certbot timer; `deploy/certbot/reload-thinkpit-nginx.sh` reloads Nginx after renewal. Keep `THINKPIT_PUBLIC_ORIGIN=https://tp.kennyy.tech` in the deployment environment.
