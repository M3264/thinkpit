import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Check,
  Plus,
  X,
  LoaderCircle,
} from "lucide-react";
import { api } from "../api";
import { clearCatalogs } from "../catalog";
import { ProviderModels } from "./ModelSelect";
import type { Provider } from "../types";
const id = () => crypto.randomUUID().replaceAll("-", "");
function Link({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
export function Providers({
  providers,
  refresh,
}: {
  providers: Provider[];
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Provider | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [kind, setKind] = useState<Provider["kind"]>("openai_compat");
  async function free() {
    setBusy(true);
    setError("");
    try {
      await api("/providers/pollinations", {
        method: "PUT",
        body: JSON.stringify({
          name: "Pollinations",
          kind: "openai_compat",
          base_url: "https://text.pollinations.ai",
          endpoint_path: "/openai",
          api_key: "",
        }),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="provider-page">
      <Link href="/" className="back-link">
        <ArrowLeft aria-hidden="true" size={16} />
        New conversation
      </Link>
      <h1>Model connections</h1>
      <p className="intro">
        Connect an AI service once. Its models will appear when you start a
        conversation.
      </p>
      <div className="provider-shortcuts" aria-label="Provider shortcuts">
        {[
          {
            id: "openrouter",
            name: "OpenRouter",
            kind: "openai_compat",
            base_url: "https://openrouter.ai/api/v1",
          },
          {
            id: "openai",
            name: "OpenAI",
            kind: "openai_compat",
            base_url: "https://api.openai.com/v1",
          },
          {
            id: "anthropic",
            name: "Anthropic",
            kind: "anthropic",
            base_url: "https://api.anthropic.com/v1",
          },
          {
            id: "ollama",
            name: "Ollama",
            kind: "openai_compat",
            base_url: "http://host.docker.internal:11434/v1",
          },
        ].map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => {
              setEditing(
                providers.find((x) => x.id === p.id) || {
                  ...p,
                  kind: p.kind as Provider["kind"],
                  has_key: false,
                },
              );
              setKind(p.kind as Provider["kind"]);
              setOpen(true);
              setSaved(false);
            }}
          >
            {p.name}
            <ArrowUpRight aria-hidden="true" size={15} />
          </button>
        ))}
      </div>
      <div className="provider-list">
        {providers.map((p) => (
          <div className="provider-row" key={p.id}>
            <div className="provider-initial" aria-hidden="true">
              {(p.name || p.id).slice(0, 1)}
            </div>
            <div>
              <strong>{p.name || p.id}</strong>
              <small>{new URL(p.base_url).host}</small>
              <ProviderModels provider={p} />
            </div>
            <span className="key-status">
              {p.has_key ? (
                <>
                  <Check aria-hidden="true" size={14} />
                  Key saved
                </>
              ) : (
                "No key saved"
              )}
            </span>
            <button
              className="text-button"
              onClick={() => {
                setEditing(p);
                setKind(p.kind);
                setOpen(true);
                setSaved(false);
              }}
            >
              Edit<span className="sr-only"> {p.name || p.id}</span>
            </button>
          </div>
        ))}
      </div>
      {!open && (
        <div className="provider-add-actions">
          <button
            className="button secondary"
            onClick={() => {
              setEditing(null);
              setKind("openai_compat");
              setOpen(true);
              setSaved(false);
            }}
          >
            <Plus aria-hidden="true" size={17} />
            Add provider
          </button>
          {!providers.some((p) => p.id === "pollinations") && (
            <button className="text-button" onClick={free} disabled={busy}>
              Try Pollinations — no key
            </button>
          )}
        </div>
      )}
      {open && (
        <form
          key={editing?.id || "new"}
          className="provider-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = new FormData(e.currentTarget),
              key = String(data.get("api_key") || ""),
              body: Record<string, unknown> = {
                name: data.get("name"),
                kind,
                base_url: data.get("base_url"),
                endpoint_path: data.get("endpoint_path"),
              };
            if (key || !editing || data.get("remove_key")) body.api_key = key;
            try {
              clearCatalogs();
              await api(`/providers/${editing?.id || id()}`, {
                method: "PUT",
                body: JSON.stringify(body),
              });
              setOpen(false);
              setSaved(true);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <header>
            <h2>{editing ? "Edit provider" : "Add provider"}</h2>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="Cancel provider changes"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </header>
          <label>
            Name
            <input
              name="name"
              required
              defaultValue={editing?.name || ""}
              placeholder="OpenRouter, local server…"
              autoComplete="off"
              maxLength={128}
            />
          </label>
          <label>
            API type
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Provider["kind"])}
            >
              <option value="openai_compat">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label>
            Base URL
            <input
              name="base_url"
              type="url"
              defaultValue={
                editing?.base_url ||
                (kind === "anthropic" ? "https://api.anthropic.com/v1" : "")
              }
              key={kind}
              placeholder="https://openrouter.ai/api/v1…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label>
            API key{" "}
            {editing?.has_key && (
              <small>Leave blank to keep the saved key.</small>
            )}
            <input
              name="api_key"
              type="password"
              placeholder="Optional for local and free endpoints…"
              autoComplete="new-password"
            />
          </label>
          {editing?.has_key && (
            <label className="question-toggle">
              <input type="checkbox" name="remove_key" />
              Remove saved key
            </label>
          )}
          <details>
            <summary>
              Custom endpoint
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            <label>
              Endpoint path
              <input
                name="endpoint_path"
                defaultValue={editing?.endpoint_path || ""}
                placeholder="/chat/completions…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </details>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : null}
            {busy ? "Saving…" : "Save provider"}
          </button>
        </form>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error} Check the provider details and try again.
        </p>
      )}
      {saved && (
        <p className="saved-note" role="status">
          <Check aria-hidden="true" size={16} />
          Provider saved.
        </p>
      )}
      <p className="provider-note">
        Conversation context is sent to the providers you choose.
      </p>
    </div>
  );
}
