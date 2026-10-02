import { test, expect, type Page } from "@playwright/test";
const provider = {
  id: "pollinations",
  name: "Pollinations",
  kind: "openai_compat",
  base_url: "https://text.pollinations.ai",
  endpoint_path: "/openai",
  has_key: false,
};
const initial = {
  id: "test-conversation",
  topic: "Should our fictional library extend its weekend hours?",
  state: "ready",
  reason: "idle",
  participants: [
    {
      id: "a",
      name: "Alex",
      provider_id: "pollinations",
      model: "openai-fast",
    },
    {
      id: "b",
      name: "Blair",
      provider_id: "pollinations",
      model: "openai-fast",
    },
  ],
  ask_questions: true,
  messages: [
    {
      id: "topic",
      speaker_id: "user",
      content: "Library question",
      status: "complete",
      created_at: "2026-09-30T00:00:00Z",
    },
    {
      id: "reply-a",
      speaker_id: "a",
      content:
        "Try **Saturday hours** for two weekends. Count visitors and ask volunteers about the workload.",
      status: "complete",
      created_at: "2026-09-30T00:00:01Z",
    },
    {
      id: "reply-b",
      speaker_id: "b",
      content:
        "Alex’s trial is useful. Keep the shift short enough for the volunteers to cover, and compare it with the current weekend.",
      status: "complete",
      created_at: "2026-09-30T00:00:02Z",
    },
  ],
  attempts: [],
  charged_tokens: 900,
  limits: { max_turns: 24, max_tokens: 150000, max_output_tokens: 1024 },
  updated_at: "2026-09-30T00:00:02Z",
  last_event_id: 42,
};
async function mock(page: Page, { login = false, empty = false } = {}) {
  let setups: any[] = [];
  let authed = !login,
    providers: any[] = empty ? [] : [provider],
    conversations: any[] = empty ? [] : [structuredClone(initial)],
    current: any = structuredClone(initial);
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/session")
      return json({ username: "admin" }, authed ? 200 : 401);
    if (path === "/api/login") {
      const body = request.postDataJSON();
      if (body.password === "test-password") {
        authed = true;
        return json({ username: "admin" });
      }
      return json({ error: "incorrect login" }, 401);
    }
    if (path === "/api/logout") {
      authed = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/providers" && request.method() === "GET")
      return json(providers);
    if (path === "/api/setups" && request.method() === "GET")
      return json(setups);
    if (path.startsWith("/api/setups/")) {
      if (request.method() === "DELETE") {
        setups = setups.filter((s) => s.id !== path.split("/").at(-1));
        return route.fulfill({ status: 204 });
      }
      const saved = { ...request.postDataJSON(), id: path.split("/").at(-1) };
      setups = [saved, ...setups];
      return json(saved);
    }
    if (path.endsWith("/models") || path === "/api/catalog/openrouter")
      return json({
        models: [
          {
            id: "cedar",
            name: "Cedar Reasoner",
            description:
              "Fictional deterministic test model for discussing tradeoffs.",
            free: true,
            context_length: 32000,
            capabilities: ["reasoning", "tools"],
          },
          {
            id: "orchid",
            name: "Orchid Vision",
            description:
              "Fictional deterministic test model for text and image context.",
            free: false,
            context_length: 64000,
            capabilities: ["vision"],
          },
          {
            id: "unknown",
            name: "Model with unknown pricing",
            capabilities: [],
          },
        ],
        truncated: false,
      });
    if (path === "/api/attachments")
      return json({
        evidence: {
          id: "file-1",
          kind: "file",
          name: "notes.md",
          text: "Fictional volunteer budget is 40 hours.",
          truncated: false,
        },
        token: "prepared-file",
      });
    if (path === "/api/search")
      return json({
        results: [
          {
            title: "Fictional library source",
            url: "https://example.com/library",
            content: "A test source about the fictional library.",
          },
        ],
        warnings: [],
      });
    if (path === "/api/sources")
      return json({
        evidence: {
          id: "source-1",
          kind: "web",
          name: "Fictional library source",
          url: "https://example.com/library",
          text: "Fictional trial details.",
          truncated: false,
        },
        token: "prepared-source",
      });
    if (path.startsWith("/api/providers/")) {
      const body = request.postDataJSON();
      const saved = {
        ...body,
        id: path.split("/").at(-1),
        has_key: Boolean(body.api_key),
      };
      delete saved.api_key;
      providers = [saved];
      return json(saved);
    }
    if (path === "/api/conversations" && request.method() === "GET")
      return json(conversations);
    if (path === "/api/conversations" && request.method() === "POST") {
      const body = request.postDataJSON();
      current = {
        ...structuredClone(initial),
        ...body,
        id: "new-conversation",
        state: "ready",
        reason: "",
        messages: [
          {
            id: "topic",
            speaker_id: "user",
            content: body.topic,
            status: "complete",
            created_at: initial.updated_at,
          },
        ],
      };
      conversations = [current];
      return json(current, 201);
    }
    if (path.endsWith("/controls")) {
      const body = request.postDataJSON();
      if (body.action === "message") {
        if (body.text === "fail this message")
          return json({ error: "failed" }, 500);
        current.context = body.context_tokens?.length
          ? [
              {
                id: "file-1",
                kind: "file",
                name: "notes.md",
                text: "Fictional volunteer budget is 40 hours.",
                truncated: false,
              },
            ]
          : current.context;
        current.messages.push({
          id: "human",
          speaker_id: "user",
          content: body.text,
          status: "complete",
          created_at: initial.updated_at,
        });
        current.pending_question = null;
        current.state = "running";
      } else if (["start", "resume", "retry"].includes(body.action))
        current.state = "running";
      else if (body.action === "pause") current.state = "paused";
      else if (body.action === "stop") current.state = "stopped";
      else if (body.action === "tools")
        current.tools_enabled = body.tools_enabled;
      else if (body.action === "questions")
        current.ask_questions = body.ask_questions;
      else if (body.action === "skip_question") {
        current.pending_question = null;
        current.state = "running";
      } else if (body.action === "summary") {
        current.state = "paused";
        current.messages.push({
          id: "summary",
          speaker_id: "a",
          content: "A short summary of the trial and the staffing concern.",
          status: "complete",
          created_at: initial.updated_at,
        });
      }
      return json(current);
    }
    if (path.endsWith("/events")) {
      expect(request.headers()["last-event-id"]).toBe("42");
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": keepalive\n\n",
      });
    }
    if (path.endsWith("/export"))
      return route.fulfill({
        contentType: "text/markdown",
        body: "# ThinkPit\nFictional library trial",
      });
    if (request.method() === "DELETE") {
      conversations = [];
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/api/conversations/")) return json(current);
    return route.fulfill({ status: 404 });
  });
  return {
    question() {
      current = {
        ...current,
        state: "waiting_for_user",
        reason: "essential_question",
        pending_question: {
          text: "What is the volunteer budget?",
          essential: true,
          message_id: "reply-b",
        },
      };
    },
  };
}
async function capture(page: Page, name: string) {
  await page.screenshot({
    path: `../.impeccable/review/rebuild/${test.info().project.name}-${name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("home puts topic and models first and hides advanced setup", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What’s on your mind?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Conversation topic")).toBeVisible();
  await expect(page.getByText("Cedar Reasoner", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Base URL")).toHaveCount(0);
  await expect(page.getByText("Token budget", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Conversation topic")
    .fill("Help me plan a fictional community event.");
  await capture(page, "home");
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const body = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("thinkpit:participants") || "[]"),
  );
  expect(body).toHaveLength(2);
});
test("model picker adds distinct instances and options keep technical fields away", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/");
  await expect(page.getByText("Cedar Reasoner", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose models" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add Cedar Reasoner", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.getByRole("button", { name: "Conversation options" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation options" });
  await expect(dialog.getByText("Discussion length")).toBeVisible();
  await dialog.locator(".participant-option summary").first().click();
  await dialog
    .locator(".participant-option")
    .first()
    .getByLabel("Display name")
    .fill("Critic");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Critic", exact: true }),
  ).toBeVisible();
});
test("send interrupts while failed sends retain the draft; pause and resume work", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/?conversation=test-conversation");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByLabel("Your message").fill("fail this message");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Your message")).toHaveValue(
    "fail this message",
  );
  await page.getByLabel("Your message").fill("Try a short weekend trial.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Your message")).toHaveValue("");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await capture(page, "chat");
});
test("essential question, summary, export, and deletion remain available", async ({
  page,
}) => {
  const state = await mock(page);
  state.question();
  await page.goto("/?conversation=test-conversation");
  await expect(page.getByText("What is the volunteer budget?")).toBeVisible();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Summarize", exact: true }).click();
  await expect(
    page.getByText("A short summary of the trial and the staffing concern."),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export Markdown" }).click();
  expect((await download).suggestedFilename()).toBe("thinkpit.md");
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep conversation" }).click();
  await expect(
    page.getByRole("heading", { name: initial.topic }),
  ).toBeVisible();
});
test("tools show sources in transcript and web access can be disabled", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/api/conversations/test-conversation", (r) =>
    r.fulfill({
      json: {
        ...initial,
        tools_enabled: true,
        tools: [
          {
            id: "tool-1",
            participant_id: "a",
            message_id: "reply-a",
            call: { name: "web_search", query: "current library research" },
            status: "complete",
            created_at: initial.updated_at,
            sources: [
              {
                id: "web-1",
                kind: "web",
                name: "Library source",
                url: "https://example.com/report",
                text: "Fictional current search excerpt",
                truncated: true,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/?conversation=test-conversation");
  await page.getByText("Searched the web", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Library source" }),
  ).toBeVisible();
  await capture(page, "tools");
  const request = page.waitForRequest(
    (r) =>
      r.url().endsWith("/controls") &&
      r.postDataJSON().action === "tools" &&
      r.postDataJSON().tools_enabled === false,
  );
  await page.getByRole("button", { name: "Web access On" }).click();
  await request;
  await expect(
    page.getByRole("button", { name: "Web access Off" }),
  ).toBeVisible();
});
test("failed models stay visible and can be brought back", async ({
  page,
}, info) => {
  await mock(page);
  await page.route("**/api/conversations/test-conversation", (r) =>
    r.fulfill({
      json: {
        ...initial,
        state: "running",
        next: 1,
        unavailable_participants: { a: "provider returned HTTP 401" },
      },
    }),
  );
  await page.goto("/?conversation=test-conversation");
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "Participants", exact: true })
      .click();
  const root =
    info.project.name === "mobile"
      ? page.getByRole("dialog", { name: "Participants" })
      : page.locator(".conversation-roster");
  await expect(root.getByText("Sitting out")).toBeVisible();
  const request = page.waitForRequest(
    (r) =>
      r.url().endsWith("/controls") &&
      r.postDataJSON().action === "restore_model",
  );
  await root.getByRole("button", { name: "Bring back", exact: true }).click();
  await request;
});
test("settings and login keep connection setup out of the home screen", async ({
  page,
}, info) => {
  await mock(page, { login: true, empty: true });
  await page.goto("/");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What’s on your mind?" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Connect models", exact: true }).click();
  await page.getByRole("button", { name: "OpenAI", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await page.getByLabel("API key", { exact: true }).fill("fictional-test-key");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByText("Provider saved.")).toBeVisible();
});
test("saved groups and attachments still work", async ({ page }) => {
  await mock(page);
  await page.goto("/");
  await expect(page.getByText("Cedar Reasoner", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Conversation options" }).click();
  await page.getByLabel("Save this model group").fill("Fictional group");
  await page.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByText("Group saved.")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByLabel("Attach context file")
    .setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Fictional notes"),
    });
  await expect(page.getByText("notes.md", { exact: true })).toBeVisible();
});
test("desktop sidebar toggle persists and chat has reading room", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile");
  await mock(page);
  await page.goto("/?conversation=test-conversation");
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand navigation" }).click();
  for (const [width, height] of [
    [1440, 844],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    const size = await page.locator(".transcript").boundingBox();
    expect(size!.height).toBeGreaterThan(height * 0.4);
    await capture(page, `chat-${width}`);
  }
});
