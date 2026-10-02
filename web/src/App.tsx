import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  Plus,
  PanelLeft,
  Search,
  Settings2,
  LogOut,
  Globe,
  ArrowUp,
  ArrowUpRight,
  Pause,
  Play,
  Square,
  Download,
  Trash2,
  X,
  Check,
  Copy,
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  SlidersHorizontal,
  Clock,
  BookOpen,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, post, stream } from "./api";
import { loadCatalog, peekCatalog, clearCatalogs } from "./catalog";
import type {
  Conversation,
  Provider,
  Participant,
  PreparedEvidence,
  Model,
  Setup,
  ToolRecord,
} from "./types";
import { Dialog } from "./components/Dialog";
import { ContextInput } from "./components/ContextInput";
import { Providers } from "./components/Connections";
import { ModelLibrary } from "./components/ModelLibrary";
import { AtlasStart, AtlasRoom } from "./components/Atlas";
import { Textarea } from "./components/Textarea";
const uid = () => crypto.randomUUID().replaceAll("-", "");
const labels = {
  ready: "Ready",
  running: "Discussing",
  waiting_for_user: "Your turn",
  paused: "Paused",
  stopped: "Finished",
  failed: "Needs attention",
};
function Link({
  href,
  children,
  className = "",
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      className={className}
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
          onClick?.();
        }
      }}
    >
      {children}
    </a>
  );
}
function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span className={`avatar tone-${index % 5}`} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export default function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [providers, setProviders] = useState<Provider[]>([]),
    [historyList, setHistory] = useState<Conversation[]>([]),
    [current, setCurrent] = useState<Conversation | null>(null),
    [url, setURL] = useState(location.search),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(true),
    [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(
      () => localStorage.getItem("thinkpit:sidebar-collapsed") === "true",
    ),
    [navOpen, setNavOpen] = useState(false),
    [historyQuery, setHistoryQuery] = useState(""),
    [modelsOpen, setModelsOpen] = useState(false),
    [optionsOpen, setOptionsOpen] = useState(false),
    [peopleOpen, setPeopleOpen] = useState(false),
    [sourcesOpen, setSourcesOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false);
  const [topic, setTopic] = useState(
      () => sessionStorage.getItem("thinkpit:topic") || "",
    ),
    [draft, setDraft] = useState<Participant[]>(() => {
      try {
        return JSON.parse(
          sessionStorage.getItem("thinkpit:participants") || "[]",
        );
      } catch {
        return [];
      }
    }),
    [context, setContext] = useState<PreparedEvidence[]>([]),
    [contextBusy, setContextBusy] = useState(false),
    [web, setWeb] = useState(true),
    [ask, setAsk] = useState(true),
    [limits, setLimits] = useState({
      max_turns: 24,
      max_tokens: 150000,
      max_output_tokens: 2048,
    });
  const params = new URLSearchParams(url),
    selected = params.get("conversation"),
    view = params.get("view"),
    last = useRef(""),
    follow = useRef(true),
    transcript = useRef<HTMLDivElement>(null),
    didDefault = useRef(false);
  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<Provider[]>("/providers"),
      api<Conversation[]>("/conversations"),
    ]);
    setProviders(p);
    setHistory(c);
    p.forEach((v) => void loadCatalog(v));
    return p;
  }, []);
  useEffect(() => {
    api("/session")
      .then(() => setAuth(true))
      .catch(() => setAuth(false));
    const fn = () => {
      setURL(location.search);
      setNavOpen(false);
    };
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  useEffect(() => {
    if (auth) void refresh().catch((e) => setError(e.message));
  }, [auth, refresh]);
  useEffect(() => {
    localStorage.setItem("thinkpit:sidebar-collapsed", String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    sessionStorage.setItem("thinkpit:topic", topic);
    sessionStorage.setItem("thinkpit:participants", JSON.stringify(draft));
  }, [topic, draft]);
  useEffect(() => {
    if (!topic && !context.length) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [topic, draft, context]);
  useEffect(() => {
    if (!providers.length || draft.length || didDefault.current) return;
    let live = true;
    Promise.all(providers.map((p) => loadCatalog(p))).then(() => {
      if (!live) return;
      const usable = providers.filter(
        (p) =>
          p.has_key ||
          !["api.openai.com", "api.anthropic.com", "openrouter.ai"].includes(
            new URL(p.base_url).hostname,
          ),
      );
      for (const p of usable) {
        const models = (peekCatalog(p).catalog?.models || []).filter(
          (m) => m.free === true && !/embed|image|audio|guard|jev/i.test(m.id),
        );
        const checkedFree = ['liquid/lfm-2.5-2.6b:free','cohere/north-mini-code:free','inclusionai/ling-3.0-flash-sante:free'];
        const rank=(id:string)=>{const i=checkedFree.indexOf(id);return i<0?99:i};
        models.sort((a,b)=>rank(a.id)-rank(b.id)||a.name.localeCompare(b.name));
        const distinct = models.filter(
          (m, i) =>
            i === 0 || m.id.split("/")[0] !== models[0].id.split("/")[0],
        );
        const defaults = distinct.length > 1 ? distinct : models;
        if (models.length) {
          didDefault.current = true;
          setDraft(
            defaults.slice(0, 2).map((m) => ({
              id: uid(),
              name: m.name.slice(0, 128),
              model: m.id,
              provider_id: p.id,
            })),
          );
          break;
        }
      }
    });
    return () => {
      live = false;
    };
  }, [providers, draft.length]);
  useEffect(() => {
    setCurrent(null);
    last.current = "";
    setError("");
    if (!auth || !selected) return;
    let live = true;
    setLoading(true);
    api<Conversation>(`/conversations/${encodeURIComponent(selected)}`)
      .then((c) => {
        if (live) {
          last.current = String(c.last_event_id || "");
          setCurrent(c);
          follow.current = true;
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [auth, selected]);
  useEffect(() => {
    if (!auth || !current?.id || current.id !== selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const id = current.id;
    const connect = async () => {
      try {
        await stream(
          id,
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
                const a = c.attempts.find((a) => a.id === delta.attempt_id);
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === a?.message_id
                      ? { ...m, content: m.content + delta.text }
                      : m,
                  ),
                };
              });
            } else {
              const c = event.data as Conversation;
              setCurrent(c);
              setHistory((old) => [c, ...old.filter((v) => v.id !== c.id)]);
            }
          },
          () => setConnected(true),
        );
        if (!controller.signal.aborted) {
          setConnected(false);
          timer = setTimeout(connect, 1400);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setConnected(false);
          timer = setTimeout(connect, 1500);
        }
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [auth, current?.id, selected]);
  useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [current?.messages, current?.tools]);
  async function run(fn: () => Promise<void>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
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
      setHistory((old) => [c, ...old.filter((v) => v.id !== c.id)]);
    });
  }
  async function choose(provider: Provider, model: Model) {
    if (!providers.some((p) => p.id === provider.id)) {
      await api(`/providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: provider.name,
          kind: provider.kind,
          base_url: provider.base_url,
        }),
      });
      await refresh();
    }
    setDraft((old) =>
      old.length >= 8
        ? old
        : [
            ...old,
            {
              id: uid(),
              name: model.name.slice(0, 128),
              model: model.id,
              provider_id: provider.id,
            },
          ],
    );
  }
  async function start() {
    if (contextBusy) return;
    await run(async () => {
      if (!topic.trim()) throw Error("Add a topic to start your conversation.");
      if (!draft.length) {
        setModelsOpen(true);
        throw Error("Choose at least one model to join you.");
      }
      const missing = draft.find((p) => {
        const provider = providers.find((v) => v.id === p.provider_id);
        return (
          provider &&
          !provider.has_key &&
          ["api.openai.com", "api.anthropic.com", "openrouter.ai"].includes(
            new URL(provider.base_url).hostname,
          )
        );
      });
      if (missing)
        throw Error(
          `Connect ${providers.find((p) => p.id === missing.provider_id)?.name} in Settings to use this model.`,
        );
      const director = providers.find(
        (p) => p.has_key && new URL(p.base_url).hostname === "openrouter.ai",
      );
      if (!director)
        throw Error(
          "Connect OpenRouter in Settings to coordinate your atlas with Jev.",
        );
      const c = await post<Conversation>("/conversations", {
        director_provider_id: director.id,
        topic,
        participants: draft,
        ask_questions: ask,
        tools_enabled: web,
        limits,
        context_tokens: context.map((v) => v.token),
      });
      await post(`/conversations/${c.id}/controls`, { action: "start" });
      setTopic("");
      setContext([]);
      setHistory((old) => [c, ...old]);
      history.pushState({}, "", `/?conversation=${c.id}`);
      setURL(location.search);
    });
  }
  const allSources = [
    ...(current?.context || []),
    ...(current?.tools || []).flatMap((t) => t.sources || []),
  ].filter(
    (s, i, a) => a.findIndex((v) => (v.url || v.id) === (s.url || s.id)) === i,
  );
  const sidebar = (
    <>
      <Link href="/" className="brand">
        <img src="/brand/thinkpit-mark.svg" alt="" width="34" height="28" />
        <span>ThinkPit</span>
      </Link>
      <Link href="/" className="new-chat">
        <Plus size={17} aria-hidden="true" />
        New conversation
      </Link>
      <div className="history-title">Your conversations</div>
      <div className="history-search-wrap">
        <Search size={14} aria-hidden="true" />
        <input
          aria-label="Search conversations"
          type="search"
          placeholder="Search…"
          value={historyQuery}
          onChange={(e) => setHistoryQuery(e.target.value)}
        />
      </div>
      <nav className="history" aria-label="Conversation history">
        {historyList
          .filter((c) =>
            c.topic.toLowerCase().includes(historyQuery.toLowerCase()),
          )
          .map((c) => (
            <Link
              key={c.id}
              className={`history-link ${selected === c.id ? "selected" : ""}`}
              href={`/?conversation=${c.id}`}
            >
              <MessageCircle size={15} aria-hidden="true" />
              <span>{c.topic}</span>
            </Link>
          ))}
        {!historyList.length && (
          <p className="history-empty">
            Your first conversation will appear here.
          </p>
        )}
      </nav>
      <div className="rail-footer">
        <Link href="/?view=models">
          <Search size={16} aria-hidden="true" />
          Explore models
        </Link>
        <Link href="/?view=providers">
          <Settings2 size={16} aria-hidden="true" />
          Settings
        </Link>
        <button
          onClick={() =>
            void run(async () => {
              await post("/logout", {});
              clearCatalogs();
              setCurrent(null);
              setHistory([]);
              setAuth(false);
            })
          }
        >
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </>
  );
  if (auth === null)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" aria-hidden="true" />
        Opening ThinkPit…
      </div>
    );
  if (!auth) return <Login onLogin={() => setAuth(true)} />;
  return (
    <div className={`app atlas-shell ${collapsed ? "rail-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to conversation
      </a>
      <aside className="rail">{sidebar}</aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button desktop-menu"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft size={19} aria-hidden="true" />
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <PanelLeft size={19} aria-hidden="true" />
          </button>
          <span className="breadcrumb">
            {current
              ? "Conversation"
              : view === "providers"
                ? "Settings"
                : view === "models"
                  ? "Explore models"
                  : "New conversation"}
          </span>
          {current && (
            <div className="header-actions">
              <span role="status" className={`status ${current.state}`}>
                {current.pending_tool_id
                  ? "Looking things up"
                  : current.retry_at
                    ? "Retrying shortly"
                    : labels[current.state]}
              </span>
              <a
                className="icon-button"
                href={`/api/conversations/${current.id}/export`}
                aria-label="Export Markdown"
                download="thinkpit.md"
              >
                <Download size={17} aria-hidden="true" />
              </a>
              <button
                className="icon-button"
                aria-label="Delete conversation"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          )}
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <main
          id="main"
          className={
            view
              ? "settings-main"
              : current && !current.brainstorm
                ? "chat-main"
                : "atlas-main"
          }
        >
          {loading ? (
            <div className="loading-screen">Opening conversation…</div>
          ) : view === "providers" ? (
            <Providers
              providers={providers}
              refresh={async () => {
                await refresh();
              }}
            />
          ) : view === "models" ? (
            <div className="standalone-library">
              <ModelLibrary providers={providers} onChoose={choose} />
              <Link className="button primary" href="/">
                Use selected models ({draft.length})
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : !current ? (
            <AtlasStart
              topic={topic}
              setTopic={setTopic}
              draft={draft}
              remove={(id) => setDraft((old) => old.filter((p) => p.id !== id))}
              choose={() => setModelsOpen(true)}
              options={() => setOptionsOpen(true)}
              start={() => void start()}
              busy={busy || contextBusy}
              web={web}
              setWeb={setWeb}
              context={context}
              setContext={setContext}
              onContextBusy={setContextBusy}
              connected={providers.some(
                (p) =>
                  p.has_key && new URL(p.base_url).hostname === "openrouter.ai",
              )}
            />
          ) : current.brainstorm ? (
            <AtlasRoom
              key={current.id}
              c={current}
              busy={busy}
              control={control}
              people={() => setPeopleOpen(true)}
              sources={() => setSourcesOpen(true)}
              connection={connected ? "connected" : "reconnecting"}
            />
          ) : (
            <div className="conversation-layout">
              <section className="conversation-reading">
                <div className="conversation-heading">
                  <h1 title={current.topic}>{current.topic}</h1>
                  <div className="conversation-subhead">
                    <span>{current.participants.length} models</span>
                    <button onClick={() => setSourcesOpen(true)}>
                      Sources ({allSources.length})
                    </button>
                    <button
                      onClick={() => setPeopleOpen(true)}
                      className="roster-toggle"
                    >
                      Participants
                    </button>
                  </div>
                </div>
                <div
                  ref={transcript}
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
                      human = index < 0,
                      p = current.participants[index];
                    return (
                      <div key={m.id}>
                        {m.status === "incomplete" && !m.content ? (
                          <details className="failed-attempt">
                            <summary>
                              {p?.name || "Model"} · Couldn’t finish this reply
                            </summary>
                            <p>
                              {
                                current.attempts.find(
                                  (a) => a.message_id === m.id,
                                )?.error
                              }
                            </p>
                          </details>
                        ) : (
                          <article
                            className={`message ${human ? "human" : ""}`}
                          >
                            <header>
                              <Avatar
                                name={human ? "You" : p.name}
                                index={index}
                              />
                              <strong>{human ? "You" : p.name}</strong>
                              {m.status === "streaming" && (
                                <span className="writing">Writing…</span>
                              )}
                              {m.status === "incomplete" && (
                                <span className="incomplete">Unfinished</span>
                              )}
                              {m.content && <CopyReply text={m.content} />}
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
                                  (m.status === "streaming" ? "Thinking…" : "")}
                              </ReactMarkdown>
                            </div>
                          </article>
                        )}
                        {current.tools
                          ?.filter((t) => t.message_id === m.id)
                          .map((t) => (
                            <ToolActivity key={t.id} tool={t} />
                          ))}
                      </div>
                    );
                  })}
                  {!current.messages.slice(1).length && (
                    <div className="discussion-empty">
                      <div className="avatar-stack">
                        {current.participants.map((p, i) => (
                          <Avatar key={p.id} name={p.name} index={i} />
                        ))}
                      </div>
                      <p>
                        {current.state === "running"
                          ? "Your models are thinking it through…"
                          : "Ready when you are."}
                      </p>
                    </div>
                  )}
                  {current.state === "failed" && (
                    <div className="recovery-panel">
                      <strong>
                        {current.reason === "all_models_failed"
                          ? "The models couldn’t respond."
                          : "This reply needs attention."}
                      </strong>
                      <p>
                        You can retry, bring a model back, or check its
                        connection in Settings.
                      </p>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void control("retry")}
                      >
                        Retry reply
                      </button>
                      <Link
                        href="/?view=providers"
                        className="button secondary"
                      >
                        Check connections
                      </Link>
                    </div>
                  )}
                  {current.retry_at && (
                    <div className="retry-note" role="status">
                      A model is temporarily unavailable. Retrying shortly.
                      <button onClick={() => void control("skip_model")}>
                        Skip this model
                      </button>
                    </div>
                  )}
                </div>
                <div className="composer-area">
                  {current.pending_question && (
                    <div className="pending-question">
                      <strong>A model needs your input</strong>
                      <p>{current.pending_question.text}</p>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void control("skip_question")}
                      >
                        Skip this question
                      </button>
                    </div>
                  )}
                  {!connected && (
                    <p className="connection-status" role="status">
                      Reconnecting to the conversation…
                    </p>
                  )}
                  <div className="conversation-controls">
                    <button
                      className={`mode-button ${current.tools_enabled ? "enabled" : ""}`}
                      aria-pressed={!!current.tools_enabled}
                      disabled={busy}
                      onClick={() =>
                        void control("tools", {
                          tools_enabled: !current.tools_enabled,
                        })
                      }
                    >
                      <Globe size={15} aria-hidden="true" />
                      Web access {current.tools_enabled ? "On" : "Off"}
                    </button>
                    <div>
                      {current.state === "running" ||
                      current.state === "waiting_for_user" ? (
                        <button
                          disabled={busy}
                          onClick={() => void control("pause")}
                        >
                          <Pause size={14} aria-hidden="true" />
                          Pause
                        </button>
                      ) : ["paused", "ready"].includes(current.state) ? (
                        <button
                          disabled={busy}
                          onClick={() => void control("resume")}
                        >
                          <Play size={14} aria-hidden="true" />
                          Resume
                        </button>
                      ) : null}
                      {current.state !== "stopped" && (
                        <button
                          disabled={busy}
                          onClick={() => void control("stop")}
                        >
                          <Square size={13} aria-hidden="true" />
                          Stop
                        </button>
                      )}
                      {["ready", "paused", "stopped"].includes(current.state) &&
                        !current.pending_question && (
                          <button
                            disabled={busy}
                            onClick={() => void control("summary")}
                          >
                            Summarize
                          </button>
                        )}
                    </div>
                  </div>
                  <ConversationComposer
                    key={current.id}
                    id={current.id}
                    busy={busy}
                    send={(text, tokens) =>
                      control("message", { text, context_tokens: tokens })
                    }
                  />
                  <p className="composer-hint">
                    {current.state === "running"
                      ? "Jump in anytime. Your message takes priority."
                      : "Enter to send · Shift + Enter for a new line"}
                  </p>
                </div>
              </section>
              <aside className="conversation-roster">
                <h2>In this conversation</h2>
                <Roster
                  current={current}
                  providers={providers}
                  busy={busy}
                  control={control}
                />
                <details className="run-details">
                  <summary>
                    Conversation settings
                    <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={current.ask_questions}
                      disabled={busy}
                      onChange={(e) =>
                        void control("questions", {
                          ask_questions: e.target.checked,
                        })
                      }
                    />
                    Ask me questions
                  </label>
                  <p>
                    {current.attempts.length}/{current.limits.max_turns} turns
                  </p>
                </details>
              </aside>
            </div>
          )}
        </main>
      </div>
      {navOpen && (
        <Dialog
          title="Navigation"
          className="nav-dialog"
          close={() => setNavOpen(false)}
        >
          {sidebar}
        </Dialog>
      )}
      {modelsOpen && (
        <Dialog
          title="Choose models"
          className="model-picker"
          close={() => setModelsOpen(false)}
        >
          <ModelLibrary providers={providers} onChoose={choose} compact />
          <div className="picker-footer">
            <span>{draft.length} models selected</span>
            <button
              className="button primary"
              onClick={() => setModelsOpen(false)}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
      {optionsOpen && (
        <Options
          providers={providers}
          draft={draft}
          setDraft={setDraft}
          ask={ask}
          setAsk={setAsk}
          limits={limits}
          setLimits={setLimits}
          close={() => setOptionsOpen(false)}
        />
      )}
      {peopleOpen && current && (
        <Dialog title="Participants" close={() => setPeopleOpen(false)}>
          <Roster
            current={current}
            providers={providers}
            busy={busy}
            control={control}
          />
          <label className="question-toggle">
            <input
              type="checkbox"
              checked={current.ask_questions}
              onChange={(e) =>
                void control("questions", { ask_questions: e.target.checked })
              }
            />
            Ask me questions
          </label>
        </Dialog>
      )}
      {sourcesOpen && (
        <Dialog title="Sources" close={() => setSourcesOpen(false)}>
          <div className="source-drawer">
            {!allSources.length ? (
              <p>
                No sources yet. With web access on, models can find sources as
                they discuss.
              </p>
            ) : (
              allSources.map((s) => (
                <div key={s.id}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.name}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <strong>{s.name}</strong>
                  )}
                  <p>{s.url || "Attached file"}</p>
                  <details>
                    <summary>View excerpt</summary>
                    <p>{s.text}</p>
                  </details>
                </div>
              ))
            )}
          </div>
        </Dialog>
      )}
      {deleteOpen && current && (
        <Dialog title="Delete conversation?" close={() => setDeleteOpen(false)}>
          <p>This deletes the conversation and its saved replies.</p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteOpen(false)}
            >
              Keep conversation
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/conversations/${current.id}`, {
                    method: "DELETE",
                  });
                  setHistory((old) => old.filter((v) => v.id !== current.id));
                  setDeleteOpen(false);
                  history.pushState({}, "", "/");
                  setURL("");
                  setCurrent(null);
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
function ConversationComposer({
  id,
  busy,
  send,
}: {
  id: string;
  busy: boolean;
  send: (text: string, tokens: string[]) => Promise<boolean>;
}) {
  const key = "thinkpit:draft:" + id,
    [text, setText] = useState(() => sessionStorage.getItem(key) || ""),
    [context, setContext] = useState<PreparedEvidence[]>([]),
    [contextBusy, setContextBusy] = useState(false);
  useEffect(() => {
    sessionStorage.setItem(key, text);
  }, [text, key]);
  async function submit() {
    if (!text.trim() || busy || contextBusy) return;
    if (
      await send(
        text,
        context.map((c) => c.token),
      )
    ) {
      setText("");
      setContext([]);
    }
  }
  // Toolbar slots and growing text follow serafimcloud/Input Bar, retrieved via 21st.dev.
  return (
    <div className="conversation-composer">
      <Textarea
        aria-label="Your message"
        name="message"
        rows={2}
        placeholder="Add your perspective…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        maxLength={32000}
      />
      <div className="composer-toolbar">
        <ContextInput
          items={context}
          onChange={setContext}
          onBusy={setContextBusy}
        />
        <button
          className="send-button"
          aria-label="Send message"
          disabled={busy || contextBusy || !text.trim()}
          onClick={() => void submit()}
        >
          <ArrowUp size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
function Roster({
  current,
  providers,
  busy,
  control,
}: {
  current: Conversation;
  providers: Provider[];
  busy: boolean;
  control: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
}) {
  return (
    <div className="participant-strip">
      {current.participants.map((p, i) => {
        const unavailable = current.unavailable_participants?.[p.id],
          active =
            i === (current.next ?? 0) &&
            current.state === "running" &&
            !unavailable;
        return (
          <div
            className={`roster-person ${active ? "active" : ""} ${unavailable ? "unavailable" : ""}`}
            key={p.id}
          >
            <Avatar name={p.name} index={i} />
            <div>
              <strong>{p.name}</strong>
              <small>
                {providers.find((v) => v.id === p.provider_id)?.name ||
                  p.provider_id}
              </small>
              <span className="participant-state">
                {unavailable
                  ? "Sitting out"
                  : active
                    ? current.pending_tool_id
                      ? "Looking things up"
                      : current.retry_at
                        ? "Retrying shortly"
                        : "Responding…"
                    : "Ready"}
              </span>
              {unavailable ? (
                <>
                  <p className="participant-error">{unavailable}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void control("restore_model", { text: p.id })
                    }
                  >
                    Bring back
                  </button>
                </>
              ) : active ? (
                <button
                  disabled={busy}
                  onClick={() => void control("skip_model")}
                >
                  Skip model
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function ToolActivity({ tool }: { tool: ToolRecord }) {
  const Icon =
    tool.call.name === "web_search"
      ? Search
      : tool.call.name === "read_page"
        ? BookOpen
        : Clock;
  const label =
    tool.call.name === "web_search"
      ? "Searched the web"
      : tool.call.name === "read_page"
        ? "Read a page"
        : "Checked the time";
  return (
    <details className="tool-activity">
      <summary>
        <Icon size={14} aria-hidden="true" />
        <span>
          {["pending", "running"].includes(tool.status)
            ? label
                .replace("Searched", "Searching")
                .replace("Read", "Reading")
                .replace("Checked", "Checking")
            : label}
        </span>
        <small>
          {tool.call.query || tool.call.url || tool.call.timezone || "UTC"}
        </small>
        {tool.status === "failed" && <span>Unavailable</span>}
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div>
        {tool.error ? (
          <p>{tool.error}</p>
        ) : tool.sources?.length ? (
          <ul>
            {tool.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                  <ArrowUpRight size={12} aria-hidden="true" />
                </a>
                <p>{s.text.slice(0, 260)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>{tool.result || "Waiting for a result…"}</p>
        )}
      </div>
    </details>
  );
}
function CopyReply({ text }: { text: string }) {
  const [state, setState] = useState("");
  return (
    <button
      className="copy-reply"
      aria-label={state || "Copy reply"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("Copied");
        } catch {
          setState("Copy unavailable");
        }
      }}
    >
      {state === "Copied" ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      <span className="sr-only" role="status">
        {state}
      </span>
    </button>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login-screen">
      <div className="login-brand">
        <img src="/brand/thinkpit-mark.svg" alt="" width="44" height="35" />
        <span>ThinkPit</span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
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
        <h1>Welcome back</h1>
        <p>Pick up where your ideas left off.</p>
        <label>
          Username
          <input
            name="username"
            defaultValue="admin"
            autoComplete="username"
            required
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
        {error && <p role="alert">{error}</p>}
        <button className="button primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
function Options({
  providers,
  draft,
  setDraft,
  ask,
  setAsk,
  limits,
  setLimits,
  close,
}: {
  providers: Provider[];
  draft: Participant[];
  setDraft: React.Dispatch<React.SetStateAction<Participant[]>>;
  ask: boolean;
  setAsk: (v: boolean) => void;
  limits: Conversation["limits"];
  setLimits: (v: Conversation["limits"]) => void;
  close: () => void;
}) {
  const [setups, setSetups] = useState<Setup[]>([]),
    [name, setName] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api<Setup[]>("/setups")
      .then(setSetups)
      .catch(() => {});
  }, []);
  return (
    <Dialog title="Conversation options" close={close}>
      <label className="question-toggle">
        <input
          type="checkbox"
          checked={ask}
          onChange={(e) => setAsk(e.target.checked)}
        />
        Let models ask me questions
      </label>
      {draft.map((p, i) => (
        <details className="participant-option" key={p.id}>
          <summary>
            <Avatar name={p.name} index={i} />
            {p.name}
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <label>
            Display name
            <input
              value={p.name}
              maxLength={128}
              onChange={(e) =>
                setDraft((old) =>
                  old.map((v) =>
                    v.id === p.id ? { ...v, name: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Instructions <span>optional</span>
            <Textarea
              value={p.instructions || ""}
              maxLength={8000}
              onChange={(e) =>
                setDraft((old) =>
                  old.map((v) =>
                    v.id === p.id ? { ...v, instructions: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <p>
            {providers.find((v) => v.id === p.provider_id)?.name} · {p.model}
          </p>
        </details>
      ))}
      <details className="limits-settings">
        <summary>
          Discussion length
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        {[
          ["max_turns", "Maximum turns", 1, 1000],
          ["max_tokens", "Token budget", 1, 10000000],
          ["max_output_tokens", "Maximum reply length", 64, 8192],
        ].map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={Number(min)}
              max={Number(max)}
              value={limits[key as keyof typeof limits]}
              onChange={(e) =>
                setLimits({ ...limits, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </details>
      {setups.length > 0 && (
        <label>
          Saved groups
          <select
            defaultValue=""
            onChange={(e) => {
              const s = setups.find((s) => s.id === e.target.value);
              if (s) {
                setDraft(s.participants.map((p) => ({ ...p, id: uid() })));
                setAsk(s.ask_questions);
                setLimits(s.limits);
              }
            }}
          >
            <option value="">Choose a saved group…</option>
            {setups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="save-setup">
        <label>
          Save this model group
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name…"
            maxLength={128}
          />
        </label>
        <button
          className="button secondary"
          disabled={!name.trim() || !draft.length}
          onClick={async () => {
            try {
              const s = await api<Setup>(`/setups/${uid()}`, {
                method: "PUT",
                body: JSON.stringify({
                  name,
                  participants: draft,
                  ask_questions: ask,
                  limits,
                }),
              });
              setSetups((old) => [s, ...old]);
              setName("");
              setNotice("Group saved.");
            } catch (e) {
              setNotice((e as Error).message);
            }
          }}
        >
          Save group
        </button>
      </div>
      <p role="status">{notice}</p>
      <button className="button primary" onClick={close}>
        Done
      </button>
    </Dialog>
  );
}
