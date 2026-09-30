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
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, post, stream, ApiError } from "./api";
import type { Conversation, Participant, Provider } from "./types";
import { Textarea } from "./components/Textarea";
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
    [connected, setConnected] = useState(true),
    [remove, setRemove] = useState(false),
    [stopping, setStopping] = useState(false);
  const params = new URLSearchParams(url),
    selected = params.get("conversation"),
    settings = params.get("view") === "providers",
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
    if (!auth || !selected || settings) return;
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
  }, [auth, selected, settings]);
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
  const sidebar = (
    <>
      <Link href="/" className="brand" onNavigate={() => setMenu(false)}>
        <MessageCircle aria-hidden="true" size={24} strokeWidth={1.7} />
        <span translate="no">ThinkPit</span>
      </Link>
      <Link href="/" className="new-chat" onNavigate={() => setMenu(false)}>
        <Plus aria-hidden="true" size={18} />
        New conversation
      </Link>
      <nav aria-label="Conversation history" className="history">
        <h2>Conversations</h2>
        {conversations.length === 0 ? (
          <p className="history-empty">Your conversations will appear here.</p>
        ) : (
          conversations.map((c) => (
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
                  if (key.startsWith("thinkpit:draft:"))
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
    <div className="app">
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
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(true)}
            aria-label="Open navigation"
          >
            <PanelLeft aria-hidden="true" size={20} />
          </button>
          <div className="breadcrumb">
            {settings
              ? "Providers"
              : current
                ? "Conversation"
                : "New conversation"}
          </div>
          {current && (
            <div className="top-actions">
              <span role="status" className="status">
                <span className={`status-dot ${current.state}`} />
                {stateName[current.state]}
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
            settings ? "settings-main" : current ? "chat-main" : "new-main"
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
          {settings ? (
            <Providers providers={providers} refresh={refresh} />
          ) : loading ? (
            <div className="loading-screen">
              <LoaderCircle aria-hidden="true" className="spin" size={22} />
              <span>Opening conversation…</span>
            </div>
          ) : !current ? (
            <NewConversation
              providers={providers}
              create={async (body) => {
                await run(async () => {
                  const c = await post<Conversation>("/conversations", body);
                  history.pushState({}, "", `/?conversation=${c.id}`);
                  setURL(location.search);
                  setConversations((old) => [c, ...old]);
                  await post(`/conversations/${c.id}/controls`, {
                    action: "start",
                  });
                });
              }}
              busy={busy}
            />
          ) : (
            <>
              <div className="conversation-heading">
                <h1>{current.topic}</h1>
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
                      . Check the provider settings, add a message, and resume.
                    </p>
                    <Link href="/?view=providers">
                      Open providers <ArrowUp aria-hidden="true" size={14} />
                    </Link>
                  </div>
                )}
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
                  onSend={async (text) => control("message", { text })}
                />
                <p className="composer-hint">
                  {current.state === "running"
                    ? "Your message will interrupt the current reply."
                    : current.state === "stopped"
                      ? "This conversation has stopped."
                      : "Enter to send · Shift + Enter for a new line"}
                </p>
              </div>
            </>
          )}
        </main>
      </div>
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
        <MessageCircle aria-hidden="true" size={29} strokeWidth={1.6} />
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
  onSend: (text: string) => Promise<boolean>;
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
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim() || busy || stopped) return;
    if (await onSend(text)) setText("");
  }
  return (
    <form className="composer" onSubmit={submit}>
      <Textarea
        name="message"
        aria-label="Your message"
        placeholder="Add a thought, ask a question…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={stopped}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
      />
      <button
        className="send-button"
        aria-label="Send message"
        disabled={busy || stopped || !text.trim()}
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="spin" size={18} />
        ) : (
          <ArrowUp aria-hidden="true" size={20} />
        )}
      </button>
    </form>
  );
}
function NewConversation({
  providers,
  create,
  busy,
}: {
  providers: Provider[];
  create: (body: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [topic, setTopic] = useState(""),
    [ask, setAsk] = useState(true),
    [participants, setParticipants] = useState<Participant[]>([]),
    [error, setError] = useState(""),
    [turns, setTurns] = useState(24);
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
    <div className="new-conversation">
      <div className="welcome-mark" aria-hidden="true">
        <MessageCircle aria-hidden="true" size={34} strokeWidth={1.2} />
      </div>
      <h1>What’s on your mind?</h1>
      <p className="intro">A few perspectives. One conversation.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!participants.length) {
            setError("Add a participant to start.");
            return;
          }
          setError("");
          await create({
            topic,
            ask_questions: ask,
            participants,
            limits: {
              max_turns: turns,
              max_tokens: 150000,
              max_output_tokens: 1024,
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
        <section
          className="participants-setup"
          aria-labelledby="participants-title"
        >
          <header>
            <h2 id="participants-title">Who’s joining?</h2>
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
                      onChange={(e) => change(index, { name: e.target.value })}
                      placeholder="Name…"
                      maxLength={128}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove participant ${index + 1}`}
                    onClick={() =>
                      setParticipants((old) => old.filter((x) => x.id !== p.id))
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
                      onChange={(e) => change(index, { model: e.target.value })}
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
            disabled={busy || providers.length === 0}
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
            Conversation limit
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
        </details>
      </form>
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
