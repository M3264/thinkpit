import { useRef, useState } from "react";
import {
  Paperclip,
  Globe,
  Search,
  X,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { post, ApiError } from "../api";
import type { PreparedEvidence } from "../types";
export function ContextInput({
  items,
  onChange,
  onBusy,
}: {
  items: PreparedEvidence[];
  onChange: (items: PreparedEvidence[]) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const file = useRef<HTMLInputElement>(null),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [url, setURL] = useState(""),
    [results, setResults] = useState<
      { title: string; url: string; content: string }[]
    >([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function work(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  async function addURL(value: string) {
    await work(async () => {
      const item = await post<PreparedEvidence>("/sources", { url: value });
      onChange([...items, item]);
      setURL("");
    });
  }
  return (
    <div className="context-input">
      <div className="context-actions">
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={busy}
        >
          <Paperclip aria-hidden="true" size={16} />
          Attach file
        </button>
        <button type="button" onClick={() => setOpen(true)}>
          <Globe aria-hidden="true" size={16} />
          Web sources
        </button>
        {busy && <LoaderCircle aria-hidden="true" size={15} className="spin" />}
        <input
          ref={file}
          type="file"
          name="file"
          aria-label="Attach context file"
          accept=".txt,.md,.csv,.json,.tsv,.log,.pdf"
          hidden
          onChange={(e) => {
            const upload = e.target.files?.[0];
            if (!upload) return;
            const input = e.currentTarget;
            work(async () => {
              const body = new FormData();
              body.set("file", upload);
              const response = await fetch("/api/attachments", {
                method: "POST",
                body,
                headers: { Accept: "application/json" },
                credentials: "same-origin",
              });
              if (!response.ok)
                throw new ApiError(response.status, await response.text());
              onChange([...items, await response.json()]);
            }).finally(() => { input.value = ""; });
          }}
        />
      </div>
      {items.length > 0 && (
        <ul className="pending-context">
          {items.map((item) => (
            <li key={item.evidence.id}>
              {item.evidence.kind === "file" ? (
                <Paperclip aria-hidden="true" size={13} />
              ) : (
                <Globe aria-hidden="true" size={13} />
              )}
              <span>
                {item.evidence.name}
                {item.evidence.truncated ? " (excerpt)" : ""}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item.evidence.name}`}
                onClick={() => onChange(items.filter((x) => x !== item))}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && !open && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {open && (
        <Dialog title="Web sources" close={() => setOpen(false)}>
          <div className="source-search">
            <p>
              Search, then choose pages to share with your models. Only pages
              you add enter the conversation.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                work(async () => {
                  const response = await post<{
                    results: typeof results;
                    warnings: string[];
                  }>("/search", { query });
                  setResults(response.results);
                  setWarnings(response.warnings);
                });
              }}
            >
              <label>
                Search the web
                <input
                  name="web-search"
                  autoComplete="off"
                  required
                  maxLength={500}
                  value={query}
                  placeholder="A question or topic…"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                <Search aria-hidden="true" size={16} />
                {busy ? "Searching…" : "Search"}
              </button>
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addURL(url);
              }}
            >
              <label>
                Or add a page URL
                <input
                  name="source-url"
                  type="url"
                  required
                  autoComplete="off"
                  placeholder="https://example.com/article…"
                  value={url}
                  onChange={(e) => setURL(e.target.value)}
                />
              </label>
              <button className="button secondary" disabled={busy}>
                Add page
              </button>
            </form>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            {warnings.map((w) => (
              <p key={w} className="source-warning">
                {w}
              </p>
            ))}
            <ul className="source-results">
              {results.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.title}
                    <ArrowUpRight aria-hidden="true" size={14} />
                  </a>
                  <p>{r.content}</p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={
                      busy || items.some((x) => x.evidence.url === r.url)
                    }
                    onClick={() => addURL(r.url)}
                  >
                    {items.some((x) => x.evidence.url === r.url)
                      ? "Added"
                      : "Add source"}
                  </button>
                </li>
              ))}
            </ul>
            <p role="status">
              {items.filter((i) => i.evidence.kind === "web").length} web
              sources selected.
            </p>
            <button
              type="button"
              className="button primary"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
