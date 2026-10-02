import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowUpRight,
  ArrowUp,
  Plus,
  Minus,
  Maximize2,
  Map as MapIcon,
  List,
  Pause,
  Play,
  Globe,
  X,
  GitBranch,
  MessageCircle,
  GripVertical,
  Check,
  Square,
  BookOpen,
  SlidersHorizontal,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Conversation,
  Message,
  Participant,
  PreparedEvidence,
} from "../types";
import { Textarea } from "./Textarea";
import { ContextInput } from "./ContextInput";
import "./atlas.css";

const kinds: Record<string, string> = {
  explore: "Idea",
  develop: "Development",
  challenge: "Challenge",
  research: "Evidence",
  synthesize: "Direction",
  ask: "Question",
  user: "Your thought",
};
export const titleOf = (m: Message) =>
  m.content
    .trim()
    .split("\n")
    .find(Boolean)
    ?.replace(/^#+\s*|\*\*/g, "")
    .slice(0, 100) || "A thought is taking shape…";
function bodyOf(m: Message) {
  const lines = m.content.trim().split("\n");
  return (
    lines.length > 1 ? lines.slice(1).join("\n").trim() : m.content
  ).replace(/[#*`]/g, "");
}
function kindOf(m: Message) {
  return m.speaker_id === "user" ? "user" : m.kind || "develop";
}
function speaker(c: Conversation, m: Message) {
  return m.speaker_id === "user"
    ? "You"
    : c.participants.find((p) => p.id === m.speaker_id)?.name || "Participant";
}
const readable = (c: Conversation) =>
  c.messages.filter((m) => m.content.trim() && !m.control?.tool);
function layout(messages: Message[]) {
  const seen = new Map<string, { x: number; y: number; depth: number }>(),
    slots = new Map<number, number>();
  return messages.map((m, i) => {
    const parent =
      seen.get(m.reply_to || "") || (i ? seen.get(messages[0].id) : undefined);
    const depth = parent ? Math.min(parent.depth + 1, 12) : 0,
      slot = slots.get(depth) || 0;
    slots.set(depth, slot + 1);
    const point = { x: 52 + depth * 290, y: 52 + slot * 198, depth };
    seen.set(m.id, point);
    return {
      m,
      ...point,
      parent: parent ? { x: parent.x + 224, y: parent.y + 70 } : undefined,
    };
  });
}
function IdeaMap({
  messages,
  selected,
  onSelect,
  names,
  example = false,
}: {
  messages: Message[];
  selected: string;
  onSelect: (id: string) => void;
  names: Record<string, string>;
  example?: boolean;
}) {
  const points = useMemo(() => layout(messages), [messages]);
  const [zoom, setZoom] = useState(example ? 0.8 : 0.85),
    container = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const width = Math.max(760, ...points.map((n) => n.x + 280)),
    height = Math.max(440, ...points.map((n) => n.y + 195));
  const related = new Set([
    selected,
    ...messages.filter((m) => m.reply_to === selected).map((m) => m.id),
    messages.find((m) => m.id === selected)?.reply_to,
  ]);
  function fit() {
    if (container.current)
      setZoom(
        Math.min(
          1,
          Math.max(0.45, (container.current.clientWidth - 12) / width),
        ),
      );
  }
  return (
    <div className={`atlas-map-wrap ${example ? "example-map" : ""}`}>
      <div
        className="atlas-map"
        ref={container}
        tabIndex={0}
        onPointerDown={(e) => {
          if (
            e.pointerType !== "mouse" ||
            e.button !== 0 ||
            (e.target as HTMLElement).closest("button")
          )
            return;
          const el = e.currentTarget;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
          };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          e.currentTarget.scrollLeft =
            drag.current.left + drag.current.x - e.clientX;
          e.currentTarget.scrollTop =
            drag.current.top + drag.current.y - e.clientY;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        role="region"
        aria-label={
          example ? "Example idea map" : "Idea map; scroll to explore"
        }
      >
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div
            className="atlas-plane"
            style={{ width, height, transform: `scale(${zoom})` }}
          >
            <svg
              className="atlas-links"
              width={width}
              height={height}
              aria-hidden="true"
            >
              {points.map(
                (n) =>
                  n.parent && (
                    <path
                      key={n.m.id}
                      className={related.has(n.m.id) ? "connected" : ""}
                      d={`M ${n.parent.x} ${n.parent.y} C ${n.parent.x + 34} ${n.parent.y}, ${n.x - 34} ${n.y + 70}, ${n.x} ${n.y + 70}`}
                    />
                  ),
              )}
            </svg>
            {points.map(({ m, x, y }, i) => (
              <button
                key={m.id}
                className={`idea-node kind-${kindOf(m)} ${selected === m.id ? "selected" : ""} ${m.status === "streaming" ? "writing" : ""}`}
                style={{ left: x, top: y }}
                onClick={() => onSelect(m.id)}
                aria-pressed={selected === m.id}
                aria-label={`Open ${kinds[kindOf(m)] || "thought"}: ${titleOf(m)}`}
              >
                <span className="node-meta">
                  <span className="node-dot" />
                  {i === 0
                    ? "Starting question"
                    : kinds[kindOf(m)] || "Thought"}
                  {m.status === "incomplete" && <span> · Incomplete</span>}
                </span>
                <strong>{titleOf(m)}</strong>
                <span className="node-excerpt">{bodyOf(m).slice(0, 155)}</span>
                <span className="node-footer">
                  {names[m.speaker_id] || "You"}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.45, z - 0.1))}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
        >
          <Plus size={16} />
        </button>
        <button aria-label="Fit map" onClick={fit}>
          <Maximize2 size={16} />
        </button>
      </div>
      <span className="map-instruction">
        Select a thought to follow its thread
      </span>
    </div>
  );
}
const exampleMessages: Message[] = [
  {
    id: "seed",
    speaker_id: "user",
    content: "How could a neighborhood feel more connected?",
    status: "complete",
    created_at: "",
  },
  {
    id: "idea",
    speaker_id: "a",
    kind: "explore",
    reply_to: "seed",
    content:
      "A shared Sunday table\nOne long table in the park. Everyone brings something; nobody has to host.",
    status: "complete",
    created_at: "",
  },
  {
    id: "other",
    speaker_id: "b",
    kind: "explore",
    reply_to: "seed",
    content:
      "Trade a little know-how\nNeighbors exchange a skill: fix a bike, grow herbs, learn a recipe.",
    status: "complete",
    created_at: "",
  },
  {
    id: "test",
    speaker_id: "b",
    kind: "challenge",
    reply_to: "idea",
    content:
      "Who feels welcome?\nA shared meal can still feel like a closed circle. Invite newcomers personally and make bringing food optional.",
    status: "complete",
    created_at: "",
  },
];
export function AtlasStart({
  topic,
  setTopic,
  draft,
  remove,
  choose,
  options,
  start,
  busy,
  web,
  setWeb,
  context,
  setContext,
  onContextBusy,
  connected,
}: {
  topic: string;
  setTopic: (v: string) => void;
  draft: Participant[];
  remove: (id: string) => void;
  choose: () => void;
  options: () => void;
  start: () => void;
  busy: boolean;
  web: boolean;
  setWeb: (v: boolean) => void;
  context: PreparedEvidence[];
  setContext: (v: PreparedEvidence[]) => void;
  onContextBusy: (v: boolean) => void;
  connected: boolean;
}) {
  const [demo, setDemo] = useState("idea");
  return (
    <div className="atlas-start">
      <section className="atlas-invitation">
        <h1>
          One question.
          <br />
          <span>Uncharted possibilities.</span>
        </h1>
        <p>
          Give a few minds something to work on.
          <br />
          Follow the ideas. Challenge a direction. Find your next move.
        </p>
        <div className="atlas-start-input">
          <Textarea
            aria-label="Conversation topic"
            name="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What would you like to think through?"
            rows={3}
            maxLength={32000}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                start();
              }
            }}
          />
          <ContextInput
            items={context}
            onChange={setContext}
            onBusy={onContextBusy}
          />
          <div className="start-tools">
            <button aria-pressed={web} onClick={() => setWeb(!web)}>
              <Globe size={16} />
              Web {web ? "on" : "off"}
            </button>
            <button className="atlas-primary" disabled={busy} onClick={start}>
              {busy ? "Opening…" : "Start exploring"}
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
        <div className="atlas-model-selection">
          <span>In the room</span>
          {draft.map((p, i) => (
            <div className="atlas-person" key={p.id}>
              <span className={`person-orb orb-${i % 4}`} />
              <button onClick={options}>{p.name}</button>
              <button
                aria-label={`Remove ${p.name}`}
                onClick={() => remove(p.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button className="atlas-add" onClick={choose}>
            <Plus size={14} />
            Add model
          </button>
          <button
            className="icon-button"
            aria-label="Conversation options"
            onClick={options}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
        <p className="atlas-cost">
          Jev coordination is billed through OpenRouter, separately from your
          selected models.
        </p>
        {!connected && (
          <p className="atlas-connect">
            Connect OpenRouter once in <a href="/?view=providers">Settings</a>{" "}
            to start an atlas.
          </p>
        )}
        <div className="atlas-starters">
          <span>A place to begin</span>
          {[
            "An idea I want to make better",
            "A decision with no obvious answer",
            "Something I want to understand",
          ].map((t) => (
            <button key={t} onClick={() => setTopic(t + ": ")}>
              {t}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </section>
      <section className="atlas-preview" aria-label="Example atlas">
        <div className="example-heading">
          <GitBranch size={17} />
          <span>An idea rarely travels in a straight line.</span>
        </div>
        <IdeaMap
          messages={exampleMessages}
          selected={demo}
          onSelect={setDemo}
          names={{ user: "You", a: "Mind A", b: "Mind B" }}
          example
        />
        <div className="example-caption">
          <span>Illustrative example</span>
          <p>
            {exampleMessages
              .find((m) => m.id === demo)
              ?.content.split("\n")
              .at(-1)}
          </p>
        </div>
      </section>
    </div>
  );
}
export function AtlasRoom({
  c,
  busy,
  control,
  people,
  sources,
  connection,
}: {
  c: Conversation;
  busy: boolean;
  control: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
  people: () => void;
  sources: () => void;
  connection: string;
}) {
  const messages = readable(c),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<"map" | "list">("map");
  const [draft, setDraft] = useState(
      () => sessionStorage.getItem(`thinkpit:atlas-draft:${c.id}`) || "",
    ),
    [context, setContext] = useState<PreparedEvidence[]>([]),
    [contextBusy, setContextBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const focus = messages.find((m) => m.id === selected),
    latest = messages.at(-1),
    shown = focus || latest;
  useEffect(() => {
    sessionStorage.setItem(`thinkpit:atlas-draft:${c.id}`, draft);
  }, [draft, c.id]);
  const names = Object.fromEntries(c.participants.map((p) => [p.id, p.name]));
  names.user = "You";
  const pending = c.pending_question,
    active = c.participants[c.next || 0];
  const status = c.brainstorm?.pending_id
    ? "Finding the next useful move"
    : c.pending_tool_id
      ? "Checking sources"
      : c.retry_at
        ? "Retrying the connection"
        : c.state === "running"
          ? `${active?.name || "The group"} is thinking`
          : c.reason === "brainstorm_complete"
            ? "A direction to take forward"
            : c.state === "waiting_for_user"
              ? "The group needs your perspective"
              : c.state === "failed"
                ? "The room needs attention"
                : c.state === "paused"
                  ? "Room paused"
                  : c.state === "stopped"
                    ? "Exploration stopped"
                    : "Ready to explore";
  async function send() {
    if (!draft.trim() || busy || contextBusy) return;
    const ok = await control("message", {
      text: draft,
      reply_to: focus?.status === "complete" ? focus.id : "",
      context_tokens: context.map((e) => e.token),
    });
    if (ok) {
      setDraft("");
      setContext([]);
      setSelected("");
    }
  }
  function select(id: string) {
    setSelected(id);
    setCopied(false);
  }
  const detail: ReactNode = (
    <aside className="atlas-detail" aria-label="Focused discussion">
      <div className="detail-label">
        <span>{focus ? "Focused discussion" : "Latest contribution"}</span>
        {focus && (
          <button
            aria-label="Follow latest contribution"
            onClick={() => setSelected("")}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {shown ? (
        <>
          <div className={`detail-kind kind-${kindOf(shown)}`}>
            <span className="node-dot" />
            {kinds[kindOf(shown)] || "Thought"} · {speaker(c, shown)}
          </div>
          <div className="atlas-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {shown.content}
            </ReactMarkdown>
          </div>
          {shown.status === "incomplete" && (
            <p className="atlas-notice">
              This contribution was interrupted or did not finish.
            </p>
          )}
          {shown.reply_to && (
            <button
              className="thread-link"
              onClick={() => select(shown.reply_to!)}
            >
              <GitBranch size={14} />
              Responding to{" "}
              {titleOf(
                c.messages.find((m) => m.id === shown.reply_to) || shown,
              )}
            </button>
          )}
          <div className="detail-actions">
            <button
              disabled={shown.status !== "complete"}
              onClick={() => {
                select(shown.id);
                input.current?.focus();
              }}
            >
              <MessageCircle size={15} />
              Build on this
            </button>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(shown.content)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(c.tools || [])
            .filter(
              (t) =>
                t.message_id === shown.id ||
                (t.participant_id === shown.speaker_id &&
                  c.messages.find((m) => m.id === t.message_id)?.decision_id ===
                    shown.decision_id &&
                  shown.decision_id),
            )
            .map((t) => (
              <details
                key={t.id}
                className="atlas-tool"
                open={t.status === "running"}
              >
                <summary>
                  <Globe size={14} />
                  {t.call.name.replaceAll("_", " ")} · {t.status}
                </summary>
                <p>{t.call.query || t.call.url || t.call.timezone}</p>
                {t.error && <p>{t.error}</p>}
                {t.sources?.map((s) => (
                  <a
                    key={s.id}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {s.name}
                    <ArrowUpRight size={12} />
                  </a>
                ))}
              </details>
            ))}
          {messages.some((m) => m.reply_to === shown.id) && (
            <div className="related-thoughts">
              <h3>Where this led</h3>
              {messages
                .filter((m) => m.reply_to === shown.id)
                .map((m) => (
                  <button key={m.id} onClick={() => select(m.id)}>
                    <span>{kinds[kindOf(m)]}</span>
                    {titleOf(m)}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
            </div>
          )}
        </>
      ) : (
        <div className="detail-empty">
          <GitBranch size={28} />
          <h2>The first idea starts here.</h2>
          <p>
            Contributions will connect as the group explores your question.
            Select one to see it up close.
          </p>
        </div>
      )}
    </aside>
  );
  const map = (
    <section className="atlas-map-section" aria-label="Atlas workspace">
      {view === "map" ? (
        <IdeaMap
          messages={messages}
          selected={shown?.id || ""}
          onSelect={select}
          names={names}
        />
      ) : (
        <div className="atlas-reading-list">
          {messages.map((m) => (
            <button
              key={m.id}
              onClick={() => select(m.id)}
              aria-pressed={shown?.id === m.id}
              className={`kind-${kindOf(m)}`}
            >
              <span className="node-meta">
                <span className="node-dot" />
                {kinds[kindOf(m)]} · {speaker(c, m)}
              </span>
              <strong>{titleOf(m)}</strong>
              <p>{bodyOf(m).slice(0, 200)}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
  return (
    <div className="atlas-room">
      <header className="atlas-room-heading">
        <div>
          <h1>{c.topic}</h1>
          <div className="atlas-room-people">
            {c.participants.map((p, i) => (
              <button
                onClick={people}
                key={p.id}
                className={`atlas-person ${c.unavailable_participants?.[p.id] ? "unavailable" : ""}`}
              >
                <span className={`person-orb orb-${i % 4}`} />
                {p.name}
                {c.unavailable_participants?.[p.id] && " · sitting out"}
              </button>
            ))}
          </div>
        </div>
        <button className="atlas-source-button" onClick={sources}>
          <BookOpen size={16} />
          Sources
        </button>
      </header>
      <div className="atlas-toolbar">
        <div className="atlas-view-switch" aria-label="Workspace view">
          <button aria-pressed={view === "map"} onClick={() => setView("map")}>
            <MapIcon size={15} />
            Map
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={15} />
            Read
          </button>
        </div>
        <span className="atlas-live" role="status">
          <span className={c.state === "running" ? "live-dot" : "rest-dot"} />
          {status}
        </span>
        <div className="atlas-run-controls">{c.state==='paused' && <button disabled={busy} onClick={()=>void control('summary')}><Check size={15}/>Find a direction</button>}
          {c.state === "running" || c.state === "waiting_for_user" ? (
            <button disabled={busy} onClick={() => void control("pause")}>
              <Pause size={15} />
              Pause
            </button>
          ) : c.state === "failed" ? (
            <button disabled={busy} onClick={() => void control("retry")}>
              <Play size={15} />
              Retry
            </button>
          ) : (
            c.state !== "stopped" && (
              <button disabled={busy} onClick={() => void control("resume")}>
                <Play size={15} />
                {c.reason === "brainstorm_complete"
                  ? "Explore further"
                  : "Continue"}
              </button>
            )
          )}
          <button
            disabled={busy || c.state === "stopped"}
            aria-label="Stop exploration"
            onClick={() => void control("stop")}
          >
            <Square size={14} />
          </button>
        </div>
      </div>
      <div className="atlas-desktop-panels">
        {/* Panel/handle composition adapted from preetsuthar17/Resizable via 21st.dev. */}
        <PanelGroup direction="horizontal" autoSaveId="thinkpit-atlas-panel">
          <Panel defaultSize={67} minSize={40}>
            {map}
          </Panel>
          <PanelResizeHandle
            className="atlas-resizer"
            aria-label="Resize focused discussion"
          >
            <GripVertical size={14} />
          </PanelResizeHandle>
          <Panel defaultSize={33} minSize={24} maxSize={52}>
            {detail}
          </Panel>
        </PanelGroup>
      </div>
      <div className="atlas-small-panels">
        {map}
        {detail}
      </div>
      <footer className="atlas-composer-area">
        {connection === "reconnecting" && (
          <p className="atlas-notice" role="status">
            Reconnecting. Your saved ideas are safe.
          </p>
        )}
        {c.state === "failed" && (
          <p className="atlas-notice" role="alert">
            {c.reason === "coordination_failure"
              ? "Jev could not coordinate the next move. Retry when the connection is available."
              : "The selected models could not continue. Open the participants to bring a model back, then retry."}
          </p>
        )}
        {pending && (
          <div className="atlas-question">
            <strong>The group has a question</strong>
            <p>{pending.text}</p>
            <button
              disabled={busy}
              onClick={() => void control("skip_question")}
            >
              Skip and use assumptions
            </button>
          </div>
        )}
        <div className="atlas-composer">
          {focus && (
            <div className="reply-target">
              <GitBranch size={14} />
              <span>Building on: {titleOf(focus)}</span>
              <button
                aria-label="Reply to the whole room"
                onClick={() => setSelected("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <Textarea
            ref={input}
            aria-label="Your contribution"
            placeholder={
              c.reason === "brainstorm_complete"
                ? "Take a direction further, or bring a new perspective…"
                : "Add a thought. Change the direction. Ask a question…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={32000}
            disabled={c.state === "stopped"}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <ContextInput
            items={context}
            onChange={setContext}
            onBusy={setContextBusy}
          />
          <div className="atlas-composer-tools">
            <button
              aria-pressed={!!c.tools_enabled}
              disabled={busy}
              onClick={() =>
                void control("tools", { tools_enabled: !c.tools_enabled })
              }
            >
              <Globe size={15} />
              Web {c.tools_enabled ? "on" : "off"}
            </button>
            <button
              aria-pressed={c.ask_questions}
              disabled={busy}
              onClick={() =>
                void control("questions", { ask_questions: !c.ask_questions })
              }
            >
              <MessageCircle size={15} />
              {c.ask_questions ? "Questions welcome" : "Use assumptions"}
            </button>
            <button
              className="atlas-send"
              disabled={
                !draft.trim() || busy || contextBusy || c.state === "stopped"
              }
              aria-label="Send contribution"
              onClick={() => void send()}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        <div className="atlas-footnote">
          <span>
            {c.reason === "brainstorm_complete" ? (
              <>
                <Check size={12} />
                The group has handed the conversation back to you.
              </>
            ) : (
              "You can steer the room at any time."
            )}
          </span>
          <span>Coordinated by Jev</span>
        </div>
      </footer>
    </div>
  );
}
