import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Plus,
  PanelLeft,
  Settings2,
  LogOut,
  Pause,
  Play,
  Square,
  Download,
  Trash2,
  X,
  Check,
  ChevronDown,
  MessageCircle,
  LoaderCircle,
  ArrowLeft,
  ArrowUpRight,
  Shapes,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, post, stream, ApiError } from "./api";
import type {
  Conversation,
  Participant,
  Provider,
  Model,
  PreparedEvidence,
  Setup,
} from "./types";
import { Textarea } from "./components/Textarea";
import { ContextInput } from "./components/ContextInput";
import { ModelLibrary } from "./components/ModelLibrary";
import { Dialog } from "./components/Dialog";
const stateName: Record<Conversation["state"], string> = {
  ready: "Ready",
  running: "Discussing",
  waiting_for_user: "Your turn",
  paused: "Paused",
  stopped: "Stopped",
  failed: "Needs attention",
};
const id = () => crypto.randomUUID().replaceAll("-", "");
function Link({
  href,
  children,
  onNavigate,
  className = "",
}: {
  href: string;
  children: ReactNode;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(e) => {
        if (
          e.button === 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey
        ) {
          e.preventDefault();
          history.pushState({}, "", href);
          window.dispatchEvent(new PopStateEvent("popstate"));
          onNavigate?.();
        }
      }}
    >
      {children}
    </a>
  );
}
function Seal({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span aria-hidden="true" className={`seal seal-${index % 5}`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export default function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [providers, setProviders] = useState<Provider[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [current, setCurrent] = useState<Conversation | null>(null),
    [url, setURL] = useState(location.search),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [menu, setMenu] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem("thinkpit:sidebar-collapsed") === "true"; } catch { return false; } }),
    [connected, setConnected] = useState(true),
    [remove, setRemove] = useState(false),
    [stopping, setStopping] = useState(false),
    [draftParticipants, setDraftParticipants] = useState<Participant[]>([]),
    [draftContext, setDraftContext] = useState<PreparedEvidence[]>([]),
    [sourcesOpen, setSourcesOpen] = useState(false),
    [participantsOpen, setParticipantsOpen] = useState(false),
    [historyQuery, setHistoryQuery] = useState("");
  const params = new URLSearchParams(url),
    selected = params.get("conversation"),
    settings = params.get("view") === "providers",
    library = params.get("view") === "models",
    currentID = current?.id,
    last = useRef(""),
    scrollRef = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<Provider[]>("/providers"),
      api<Conversation[]>("/conversations"),
    ]);
    setProviders(p);
    setConversations(c);
  }, []);
  useEffect(() => {
    api("/session")
      .then(() => setAuth(true))
      .catch(() => setAuth(false));
    const listener = () => setURL(location.search);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    if (auth) refresh().catch((e) => setError(e.message));
  }, [auth, refresh]);
  useEffect(() => {
    setError("");
    setCurrent(null);
    last.current = "";
    follow.current = true;
    if (!auth || !selected || settings || library) return;
    let live = true;
    setLoading(true);
    api<Conversation>(`/conversations/${encodeURIComponent(selected)}`)
      .then((c) => {
        if (live) {
          last.current = String(c.last_event_id || "");
          setCurrent(c);
        }
      })
      .catch((e) => {
        if (live) {
          setError(
            e.status === 404
              ? "This conversation is no longer available. Start a new one."
              : e.message,
          );
          if (e.status === 401) setAuth(false);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [auth, selected, settings, library]);
  useEffect(() => {
    if (!auth || !currentID) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const update = (c: Conversation) => {
      setCurrent(c);
      setConversations((old) =>
        [c, ...old.filter((x) => x.id !== c.id)].slice(0, 100),
      );
    };
    const connect = async () => {
      try {
        await stream(
          currentID,
          last.current,
          controller.signal,
          (event) => {
            if (controller.signal.aborted) return;
            last.current = event.id;
            setConnected(true);
            if (event.kind === "text_delta") {
              const delta = event.data as { attempt_id: string; text: string };
              setCurrent((c) => {
                if (!c || c.active_attempt_id !== delta.attempt_id) return c;
                const attempt = c.attempts.find(
                  (a) => a.id === delta.attempt_id,
                );
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === attempt?.message_id
                      ? { ...m, content: m.content + delta.text }
                      : m,
                  ),
                };
              });
            } else update(event.data as Conversation);
          },
          () => setConnected(true),
        );
        if (!controller.signal.aborted) {
          setConnected(false);
          retry = setTimeout(connect, 1200);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          setAuth(false);
          return;
        }
        setConnected(false);
        retry = setTimeout(connect, 1500);
      }
    };
    connect();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, [auth, currentID]);
  useEffect(() => {
    if (follow.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [current?.messages]);
  async function run(work: () => Promise<void>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await work();
      return true;
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 409
          ? "That action is no longer available. The conversation may have changed."
          : err.message,
      );
      if (err.status === 401) setAuth(false);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function control(action: string, extra: Record<string, unknown> = {}) {
    if (!current) return false;
    return run(async () => {
      const c = await post<Conversation>(
        `/conversations/${current.id}/controls`,
        { action, ...extra },
      );
      setCurrent(c);
      await refresh().catch(() => {});
    });
  }
  async function chooseModel(provider: Provider, model: Model) {
    if (!providers.some((p) => p.id === provider.id)) {
      await api(`/providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: "OpenRouter",
          kind: provider.kind,
          base_url: provider.base_url,
        }),
      });
      await refresh();
    }

    setDraftParticipants((old) =>
      old.length >= 64
        ? old
        : [
            ...old,
            {
              id: id(),
              name: model.name.slice(0,128),
              provider_id: provider.id,
              model: model.id,
              instructions: "",
            },
          ],
    );
  }
  const sidebar = (
    <>
      <Link href="/" className="brand" onNavigate={() => setMenu(false)}>
        <img className="brand-mark" src="/brand/thinkpit-mark.svg" alt="" width="38" height="30" />
        <span translate="no">ThinkPit</span>
      </Link>
      <Link href="/" className="new-chat" onNavigate={() => setMenu(false)}>
        <Plus aria-hidden="true" size={18} />
        New conversation
      </Link>
      <Link
        href="/?view=models"
        className={`models-nav ${library ? "selected" : ""}`}
        onNavigate={() => setMenu(false)}
      >
        <Shapes aria-hidden="true" size={18} />
        Model library
        <ArrowUpRight aria-hidden="true" size={15} />
      </Link>
      <nav aria-label="Conversation history" className="history">
        <h2>Conversations</h2>
        <input
          className="history-search"
          name="history-search"
          autoComplete="off"
          aria-label="Search conversations"
          placeholder="Search conversations…"
          value={historyQuery}
          onChange={(e) => setHistoryQuery(e.target.value)}
        />
        {conversations.length === 0 ? (
          <p className="history-empty">Your conversations will appear here.</p>
        ) : (
          conversations
            .filter((c) =>
              c.topic.toLowerCase().includes(historyQuery.toLowerCase()),
            )
            .map((c) => (
              <Link
                key={c.id}
                href={`/?conversation=${c.id}`}
                className={`history-link ${selected === c.id ? "selected" : ""}`}
                onNavigate={() => setMenu(false)}
              >
                <span>{c.topic}</span>
                {c.state === "running" && (
                  <span className="live-dot" aria-label="Running" />
                )}
              </Link>
            ))
        )}
      </nav>
      <footer className="rail-footer">
        <Link
          href="/?view=providers"
          className={settings ? "selected" : ""}
          onNavigate={() => setMenu(false)}
        >
          <Settings2 aria-hidden="true" size={17} />
          Providers
        </Link>
        <button
          onClick={() =>
            run(async () => {
              await post("/logout", {});
              try {
                for (const key of Object.keys(sessionStorage))
                  if (key.startsWith("thinkpit:"))
                    sessionStorage.removeItem(key);
              } catch {
                /* Storage may be disabled. */
              }
              setAuth(false);
              setCurrent(null);
              setConversations([]);
              setProviders([]);
            })
          }
        >
          <LogOut aria-hidden="true" size={17} />
          Sign out
        </button>
      </footer>
    </>
  );
  if (auth === null)
    return (
      <div className="loading-screen">
        <LoaderCircle aria-hidden="true" className="spin" size={22} />
        <span>Opening ThinkPit…</span>
      </div>
    );
  if (!auth) return <Login onLogin={() => setAuth(true)} />;
  return (
    <div className={`app ${sidebarCollapsed ? "rail-collapsed" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to conversation
      </a>
      <aside className="rail">{sidebar}</aside>
      {menu && (
        <Dialog title="ThinkPit" close={() => setMenu(false)}>
          <div className="mobile-rail">{sidebar}</div>
        </Dialog>
      )}
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button desktop-menu" aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!sidebarCollapsed} onClick={() => { const next = !sidebarCollapsed; setSidebarCollapsed(next); try { localStorage.setItem("thinkpit:sidebar-collapsed", String(next)); } catch {} }}><PanelLeft aria-hidden="true" size={20} /></button>
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(true)}
            aria-label="Open navigation"
          >
            <PanelLeft aria-hidden="true" size={20} />
          </button>
          <div className="breadcrumb">
            {library
              ? "Model library"
              : settings
                ? "Providers"
                : current
                  ? "Conversation"
                  : "New conversation"}
          </div>
          {current && (
            <div className="top-actions">
              <span role="status" className="status">
                <span className={`status-dot ${current.state}`} />
                {current.retry_at ? "Waiting to retry" : stateName[current.state]}
              </span>
              <button
                className="icon-button"
                onClick={() =>
                  run(async () => {
                    const response = await fetch(
                      `/api/conversations/${current.id}/export`,
                      { headers: { Accept: "application/json" } },
                    );
                    if (!response.ok)
                      throw new Error("Could not export. Try again.");
                    const blob = await response.blob();
                    const href = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = href;
                    a.download = "thinkpit.md";
                    a.click();
                    URL.revokeObjectURL(href);
                  })
                }
                aria-label="Export Markdown"
              >
                <Download aria-hidden="true" size={18} />
              </button>
              <button
                className="icon-button"
                onClick={() => setRemove(true)}
                aria-label="Delete conversation"
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
            </div>
          )}
        </header>
        <main
          id="main"
          className={
            settings || library
              ? "settings-main"
              : current
                ? "chat-main"
                : "new-main"
          }
        >
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          )}
          {library ? (
            <div className="standalone-library">
              <ModelLibrary providers={providers} onChoose={chooseModel} />
              <Link className="button primary" href="/">
                Build conversation
                {draftParticipants.length > 0
                  ? ` (${draftParticipants.length})`
                  : ""}
                <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            </div>
          ) : settings ? (
            <Providers providers={providers} refresh={refresh} />
          ) : loading ? (
            <div className="loading-screen">
              <LoaderCircle aria-hidden="true" className="spin" size={22} />
              <span>Opening conversation…</span>
            </div>
          ) : !current ? (
            <NewConversation
              providers={providers}
              context={draftContext}
              setContext={setDraftContext}
              participants={draftParticipants}
              setParticipants={setDraftParticipants}
              chooseModel={chooseModel}
              create={async (body) => {
                await run(async () => {
                  const c = await post<Conversation>("/conversations", body);
                  history.pushState({}, "", `/?conversation=${c.id}`);
                  setURL(location.search);
                  setConversations((old) => [c, ...old]);
                  setDraftParticipants([]);
                  setDraftContext([]);
                  sessionStorage.removeItem("thinkpit:topic");
                  await post(`/conversations/${c.id}/controls`, {
                    action: "start",
                  });
                });
              }}
              busy={busy}
            />
          ) : (
            <div className="conversation-layout">
              <div className="conversation-reading">
              <div className="conversation-heading">
                <h1>{current.topic}</h1>
                <div className="run-info">
                  <span>
                    {current.attempts.length}/{current.limits.max_turns} turns
                  </span>
                  <span>
                    {new Intl.NumberFormat().format(current.charged_tokens)} /{" "}
                    {new Intl.NumberFormat().format(current.limits.max_tokens)}{" "}
                    budget units
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setSourcesOpen(true)}
                  >
                    Sources ({current.context?.length || 0})
                  </button>
                </div>
                <button className="text-button roster-toggle" onClick={() => setParticipantsOpen(true)}>Participants ({current.participants.length})</button>
              </div>
              <div
                ref={scrollRef}
                className="transcript"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                }}
              >
                {current.messages.slice(1).map((m) => {
                  const index = current.participants.findIndex(
                      (p) => p.id === m.speaker_id,
                    ),
                    human = index === -1,
                    p = current.participants[index];
                  return (
                    <article
                      key={m.id}
                      id={`message-${m.id}`}
                      className={`message ${human ? "human" : ""}`}
                    >
                      <header>
                        {!human && <Seal name={p.name} index={index} />}
                        <strong>{human ? "You" : p.name}</strong>
                        {m.status === "incomplete" && (
                          <span className="incomplete">Unfinished</span>
                        )}
                        {m.status === "streaming" && (
                          <span className="writing" aria-label="Writing">
                            Writing…
                          </span>
                        )}
                      </header>
                      <div className="message-body">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ children, href }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {m.content ||
                            (m.status === "streaming"
                              ? "Thinking…"
                              : "No text was received.")}
                        </ReactMarkdown>
                      </div>
                    </article>
                  );
                })}
                {current.state === "failed" && (
                  <div className="turn-error" role="alert">
                    <strong>A reply could not finish.</strong>
                    <p>
                      {
                        [...current.attempts].reverse().find((a) => a.error)
                          ?.error
                      }
                      . Check the provider settings or retry this reply.
                    </p>
                    <button className="button secondary" disabled={busy} onClick={() => control("retry")}>Retry reply</button>
                    <Link href="/?view=providers">
                      Open providers <ArrowUp aria-hidden="true" size={14} />
                    </Link>
                  </div>
                )}
                {current.retry_at && current.state === "running" && <div className="turn-error" role="status">Provider temporarily unavailable. Automatic retry {current.automatic_retry_count}/2 is scheduled for {new Date(current.retry_at).toLocaleTimeString()}. You can pause or stop while waiting.</div>}
                {current.reason === "turn_limit" ||
                current.reason === "token_limit" ? (
                  <p className="limit-note">
                    This conversation reached its{" "}
                    {current.reason === "turn_limit" ? "turn" : "token"} limit.
                  </p>
                ) : null}
                {current.messages.length === 1 &&
                  current.state !== "running" && (
                    <p className="empty-transcript">Ready when you are.</p>
                  )}
              </div>
              <div className="composer-area">
                {!connected && (
                  <p role="status" className="connection-note">
                    Connection interrupted. Reconnecting…
                  </p>
                )}
                {current.pending_question && (
                  <div className="pending-question">
                    <strong>A question for you</strong>
                    <p>{current.pending_question.text}</p>
                    <button
                      className="text-button"
                      onClick={() => control("skip_question")}
                      disabled={busy}
                    >
                      Skip this question
                    </button>
                  </div>
                )}
                <div className="conversation-controls">
                  <label className="question-toggle">
                    <input
                      type="checkbox"
                      checked={current.ask_questions}
                      onChange={(e) =>
                        control("questions", {
                          ask_questions: e.target.checked,
                        })
                      }
                      disabled={busy}
                    />
                    Ask me questions
                  </label>
                  <div>
                    {current.state === "running" ||
                    current.state === "waiting_for_user" ? (
                      <button onClick={() => control("pause")} disabled={busy}>
                        <Pause aria-hidden="true" size={15} />
                        Pause
                      </button>
                    ) : current.state === "paused" ||
                      current.state === "ready" ? (
                      <button onClick={() => control("resume")} disabled={busy}>
                        <Play aria-hidden="true" size={15} />
                        Resume
                      </button>
                    ) : null}
                    {current.state !== "stopped" && (
                      <button onClick={() => setStopping(true)} disabled={busy}>
                        <Square aria-hidden="true" size={13} />
                        Stop
                      </button>
                    )}
                    {["ready", "paused", "stopped"].includes(current.state) &&
                      !current.pending_question && (
                        <button
                          onClick={() => control("summary")}
                          disabled={busy}
                        >
                          Summarize
                        </button>
                      )}
                  </div>
                </div>
                <Composer
                  key={current.id}
                  conversationID={current.id}
                  busy={busy}
                  stopped={current.state === "stopped"}
                  onSend={async (text, tokens) =>
                    control("message", { text, context_tokens: tokens })
                  }
                />
                <p className="composer-hint">
                  {current.state === "running"
                    ? "Your message will interrupt the current reply."
                    : current.state === "stopped"
                      ? "This conversation has stopped."
                      : "Enter to send · Shift + Enter for a new line"}
                </p>
              </div>
              </div>
              <aside className="conversation-roster" aria-label="Conversation participants">
                <h2>Participants <span>({current.participants.length})</span></h2>
                <div className="participant-strip">
                  {current.participants.map((p, i) => (
                    <span key={p.id}>
                      <Seal name={p.name} index={i} />
                      <span>
                        {p.name}
                        <small>
                          {p.model} ·{" "}
                          {providers.find((x) => x.id === p.provider_id)
                            ?.name || p.provider_id}
                        </small>
                      </span>
                    </span>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </main>
      </div>
      {participantsOpen && current && (<Dialog title="Participants" close={() => setParticipantsOpen(false)}>                <div className="participant-strip">
                  {current.participants.map((p, i) => (
                    <span key={p.id}>
                      <Seal name={p.name} index={i} />
                      <span>
                        {p.name}
                        <small>
                          {p.model} ·{" "}
                          {providers.find((x) => x.id === p.provider_id)
                            ?.name || p.provider_id}
                        </small>
                      </span>
                    </span>
                  ))}
                </div></Dialog>)}
      {sourcesOpen && current && (
        <Dialog
          title="Conversation sources"
          close={() => setSourcesOpen(false)}
        >
          <div className="context-view">
            {current.context?.length ? (
              current.context.map((source) => (
                <details key={source.id}>
                  <summary>
                    {source.name}
                    {source.truncated ? " · excerpt" : ""}
                  </summary>
                  {source.url && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.url}
                    </a>
                  )}
                  <small>Evidence {source.id}</small>
                  <pre>{source.text}</pre>
                </details>
              ))
            ) : (
              <p>
                No sources yet. Attach a file or add a web page beside the
                message field.
              </p>
            )}
          </div>
        </Dialog>
      )}
      {stopping && current && (
        <Dialog
          title="Stop this conversation?"
          close={() => setStopping(false)}
        >
          <p>
            Replies will stop permanently. You can still export the conversation
            or request a summary.
          </p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setStopping(false)}
            >
              Keep conversation
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (await control("stop")) setStopping(false);
              }}
            >
              Stop conversation
            </button>
          </div>
        </Dialog>
      )}
      {remove && current && (
        <Dialog
          title="Delete this conversation?"
          close={() => setRemove(false)}
        >
          <p>The conversation and its replies will be deleted.</p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setRemove(false)}
            >
              Keep conversation
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/conversations/${current.id}`, {
                    method: "DELETE",
                  });
                  setRemove(false);
                  history.pushState({}, "", "/");
                  setURL("");
                  setCurrent(null);
                  await refresh();
                })
              }
            >
              Delete conversation
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-wordmark">
        <img className="brand-mark" src="/brand/thinkpit-mark.svg" alt="" width="46" height="35" />
        <span translate="no">ThinkPit</span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await post("/login", {
              username: f.get("username"),
              password: f.get("password"),
            });
            onLogin();
          } catch {
            setError("Check your username and password, then try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Welcome back.</h1>
        <p>Your conversations are waiting.</p>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            defaultValue="admin"
            required
            spellCheck={false}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle aria-hidden="true" className="spin" size={17} />
          ) : null}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <small>Self-hosted. Your space.</small>
    </main>
  );
}
function Composer({
  conversationID,
  onSend,
  busy,
  stopped,
}: {
  conversationID: string;
  onSend: (text: string, tokens: string[]) => Promise<boolean>;
  busy: boolean;
  stopped: boolean;
}) {
  const draftKey = `thinkpit:draft:${conversationID}`;
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(draftKey, text);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* Storage may be disabled. */
    }
    if (!text.trim()) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftKey, text]);
  const [context, setContext] = useState<PreparedEvidence[]>([]);
  const [contextBusy, setContextBusy] = useState(false);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if ((!text.trim() && !context.length) || busy || contextBusy || stopped) return;
    if (
      await onSend(
        text || "Please consider the attached context.",
        context.map((x) => x.token),
      )
    ) {
      setText("");
      setContext([]);
    }
  }
  return (
    <div>
      <ContextInput items={context} onChange={setContext} onBusy={setContextBusy} />
      <form className="composer" onSubmit={submit}>
        <Textarea
          name="message"
          aria-label="Your message"
          placeholder="Add a thought, ask a question…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={stopped}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
        />
        <button
          className="send-button"
          aria-label="Send message"
          disabled={busy || contextBusy || stopped || (!text.trim() && !context.length)}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="spin" size={18} />
          ) : (
            <ArrowUp aria-hidden="true" size={20} />
          )}
        </button>
      </form>
    </div>
  );
}
function NewConversation({
  context,
  setContext,
  participants,
  setParticipants,
  chooseModel,
  providers,
  create,
  busy,
}: {
  providers: Provider[];
  context: PreparedEvidence[];
  setContext: (context: PreparedEvidence[]) => void;
  participants: Participant[];
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
  chooseModel: (provider: Provider, model: Model) => void;
  create: (body: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [topic, setTopic] = useState(()=>{try{return sessionStorage.getItem("thinkpit:topic")||""}catch{return ""}}),
    [ask, setAsk] = useState(true),
    [error, setError] = useState(""),
    [turns, setTurns] = useState(24),
    [tokens, setTokens] = useState(150000),
    [output, setOutput] = useState(1024),
    [setups, setSetups] = useState<Setup[]>([]),
    [setupName, setSetupName] = useState(""),
    [setupNotice, setSetupNotice] = useState(""),
    [contextBusy, setContextBusy] = useState(false),
    [modelsOpen, setModelsOpen] = useState(false);
  useEffect(() => {
    api<Setup[]>("/setups")
      .then(setSetups)
      .catch(() => {});
  }, []);
  useEffect(()=>{try{sessionStorage.setItem("thinkpit:topic",topic)}catch{};if(!topic.trim()&&!participants.length&&!context.length)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[topic,participants,context]);
  async function saveSetup() {
    setError("");
    try {
      const saved = await api<Setup>(`/setups/${id()}`, {
        method: "PUT",
        body: JSON.stringify({
          name: setupName,
          participants,
          ask_questions: ask,
          limits: {
            max_turns: turns,
            max_tokens: tokens,
            max_output_tokens: output,
          },
        }),
      });
      setSetups((old) => [saved, ...old]);
      setSetupName("");
      setSetupNotice("Setup saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function add() {
    const p = providers[0];
    if (!p) return;
    setParticipants((old) => [
      ...old,
      {
        id: id(),
        name: `Participant ${old.length + 1}`,
        provider_id: p.id,
        model: p.id === "pollinations" ? "openai-fast" : "",
        instructions: "",
      },
    ]);
  }
  function change(index: number, patch: Partial<Participant>) {
    setParticipants((old) =>
      old.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );
  }
  return (
    <div className="setup-workbench">
      <div className="new-conversation">
        <h1>Put a few minds to work.</h1>
        <p className="intro">
          Pick your models. Bring a question. See where they take it.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!participants.length) {
              setError("Add a participant to start.");
              return;
            }
            const missing=participants.find(p=>{const provider=providers.find(v=>v.id===p.provider_id);return provider&&!provider.has_key&&['api.openai.com','api.anthropic.com','openrouter.ai'].includes(new URL(provider.base_url).hostname)});
            if(missing){setError(`Add an API key for ${providers.find(p=>p.id===missing.provider_id)?.name} in Providers before starting.`);return}
            setError("");
            await create({
              topic,
              context_tokens: context.map((x) => x.token),
              ask_questions: ask,
              participants,
              limits: {
                max_turns: turns,
                max_tokens: tokens,
                max_output_tokens: output,
              },
            });
          }}
        >
          <div className="topic-field">
            <Textarea
              aria-label="Conversation topic"
              name="topic"
              placeholder="An idea to explore, a decision to make…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              required
              maxLength={32000}
            />
          </div>
          <ContextInput items={context} onChange={setContext} onBusy={setContextBusy} />
          <div className="topic-starters" aria-label="Topic starters">
            {[
              "Pressure-test an idea",
              "Compare my options",
              "Explore a question",
            ].map((label, i) => (
              <button
                type="button"
                key={label}
                onClick={() =>
                  setTopic(
                    [
                      "Help me pressure-test this idea: ",
                      "Help me compare these options: ",
                      "I’d like to explore this question: ",
                    ][i],
                  )
                }
              >
                {label}
                <ArrowUpRight aria-hidden="true" size={14} />
              </button>
            ))}
          </div>
          {setups.length > 0 && (
            <label className="saved-setups">
              Use a saved setup
              <select
                name="saved-setup"
                defaultValue=""
                onChange={(e) => {
                  const setup = setups.find((s) => s.id === e.target.value);
                  if (setup) {
                    setParticipants(
                      setup.participants.map((p) => ({ ...p, id: id() })),
                    );
                    setAsk(setup.ask_questions);
                    setTurns(setup.limits.max_turns);
                    setTokens(setup.limits.max_tokens);
                    setOutput(setup.limits.max_output_tokens);
                    setSetupNotice(`Loaded ${setup.name}.`);
                  }
                }}
              >
                <option value="">Choose a setup…</option>
                {setups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <section
            className="participants-setup"
            aria-labelledby="participants-title"
          >
            <header>
              <h2 id="participants-title">At the table</h2>
              <button type="button" className="button secondary browse-models" onClick={() => setModelsOpen(true)}><Shapes aria-hidden="true" size={16} />Browse models</button>
              {providers.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={add}
                  disabled={participants.length >= 64}
                >
                  <Plus aria-hidden="true" size={15} />
                  Add participant
                </button>
              )}
            </header>
            {providers.length === 0 ? (
              <div className="provider-empty">
                <p>Connect a provider to invite your first model.</p>
                <Link className="button secondary" href="/?view=providers">
                  Set up a provider <ArrowUp aria-hidden="true" size={15} />
                </Link>
              </div>
            ) : participants.length === 0 ? (
              <button className="participant-add" type="button" onClick={add}>
                <Plus aria-hidden="true" size={20} />
                <span>
                  Add your first participant
                  <small>You can use the same model more than once.</small>
                </span>
              </button>
            ) : (
              participants.map((p, index) => (
                <div className="participant-editor" key={p.id}>
                  <div className="participant-fields">
                    <Seal name={p.name || "P"} index={index} />
                    <label className="name-field">
                      <span className="sr-only">Participant name</span>
                      <input
                        aria-label={`Participant ${index + 1} name`}
                        autoComplete="off"
                        name={`name-${p.id}`}
                        value={p.name}
                        onChange={(e) =>
                          change(index, { name: e.target.value })
                        }
                        placeholder="Name…"
                        maxLength={128}
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove participant ${index + 1}`}
                      onClick={() =>
                        setParticipants((old) =>
                          old.filter((x) => x.id !== p.id),
                        )
                      }
                    >
                      <X aria-hidden="true" size={17} />
                    </button>
                  </div>
                  <div className="model-fields">
                    <label>
                      Provider
                      <select
                        value={p.provider_id}
                        onChange={(e) => {
                          const provider = providers.find(
                            (x) => x.id === e.target.value,
                          );
                          change(index, {
                            provider_id: e.target.value,
                            model:
                              provider?.id === "pollinations"
                                ? "openai-fast"
                                : "",
                          });
                        }}
                      >
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name || provider.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Model
                      <input
                        required
                        name={`model-${p.id}`}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Model ID…"
                        value={p.model}
                        onChange={(e) =>
                          change(index, { model: e.target.value })
                        }
                        maxLength={256}
                      />
                    </label>
                  </div>
                  <details>
                    <summary>
                      Instructions <span>optional</span>
                      <ChevronDown aria-hidden="true" size={14} />
                    </summary>
                    <Textarea
                      aria-label={`Instructions for participant ${index + 1}`}
                      name={`instructions-${p.id}`}
                      placeholder="A perspective or approach…"
                      value={p.instructions}
                      onChange={(e) =>
                        change(index, { instructions: e.target.value })
                      }
                      maxLength={8000}
                      rows={2}
                    />
                  </details>
                </div>
              ))
            )}
          </section>
          <div className="setup-footer">
            <label className="question-toggle">
              <input
                name="ask_questions"
                type="checkbox"
                checked={ask}
                onChange={(e) => setAsk(e.target.checked)}
              />
              Ask me questions
            </label>
            <button
              className="button primary"
              disabled={busy || contextBusy || providers.length === 0}
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="spin" size={16} />
              ) : (
                <ArrowUp aria-hidden="true" size={17} />
              )}{" "}
              {busy ? "Starting…" : "Start conversation"}
            </button>
          </div>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <details className="limits-settings">
            <summary>
              Run settings
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            <label>
              Maximum turns
              <input
                name="max-turns"
                type="number"
                min={1}
                max={1000}
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
                required
              />
            </label>
            <label>
              Token budget
              <input
                name="token-budget"
                type="number"
                min={256}
                max={10000000}
                required
                value={tokens}
                onChange={(e) => setTokens(Number(e.target.value))}
              />
            </label>
            <label>
              Maximum output per reply
              <input
                name="reply-tokens"
                type="number"
                min={64}
                max={8192}
                required
                value={output}
                onChange={(e) => setOutput(Number(e.target.value))}
              />
            </label>
          </details>
          {setups.length > 0 && (
            <details className="manage-setups">
              <summary>Manage saved setups</summary>
              {setups.map((setup) => (
                <div key={setup.id}>
                  <span>{setup.name}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${setup.name}?`)) return;
                      try {
                        await api(`/setups/${setup.id}`, { method: "DELETE" });
                        setSetups((old) =>
                          old.filter((x) => x.id !== setup.id),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Delete<span className="sr-only"> {setup.name}</span>
                  </button>
                </div>
              ))}
            </details>
          )}
          {participants.length > 0 && (
            <div className="save-setup">
              <label>
                Save these participants
                <input
                  name="setup-name"
                  autoComplete="off"
                  placeholder="Setup name…"
                  value={setupName}
                  maxLength={128}
                  onChange={(e) => setSetupName(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={!setupName.trim()}
                onClick={saveSetup}
              >
                Save setup
              </button>
            </div>
          )}
          <p role="status" className="setup-notice">
            {setupNotice}
          </p>
        </form>
      </div>
      {modelsOpen && <Dialog title="Choose models" className="model-picker" close={() => setModelsOpen(false)}>
        <ModelLibrary providers={providers} onChoose={chooseModel} compact />
        <div className="picker-footer"><span>{participants.length} participants selected</span><button type="button" className="button primary" onClick={() => setModelsOpen(false)}>Done choosing models</button></div>
      </Dialog>}
    </div>
  );
}
function Providers({
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
      <h1>Your providers.</h1>
      <p className="intro">Choose where your models come from.</p>
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
