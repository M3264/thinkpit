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
  let setups:any[]=[];
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
    if(path==='/api/setups'&&request.method()==='GET')return json(setups);
    if(path.startsWith('/api/setups/')){if(request.method()==='DELETE'){setups=setups.filter(s=>s.id!==path.split('/').at(-1));return route.fulfill({status:204})}const saved={...request.postDataJSON(),id:path.split('/').at(-1)};setups=[saved,...setups];return json(saved)}
    if(path.endsWith('/models')||path==='/api/catalog/openrouter')return json({models:[{id:'cedar',name:'Cedar Reasoner',description:'Fictional deterministic test model for discussing tradeoffs.',free:true,context_length:32000,capabilities:['reasoning','tools']},{id:'orchid',name:'Orchid Vision',description:'Fictional deterministic test model for text and image context.',free:false,context_length:64000,capabilities:['vision']},{id:'unknown',name:'Model with unknown pricing',capabilities:[]}],truncated:false});
    if(path==='/api/attachments')return json({evidence:{id:'file-1',kind:'file',name:'notes.md',text:'Fictional volunteer budget is 40 hours.',truncated:false},token:'prepared-file'});
    if(path==='/api/search')return json({results:[{title:'Fictional library source',url:'https://example.com/library',content:'A test source about the fictional library.'}],warnings:[]});
    if(path==='/api/sources')return json({evidence:{id:'source-1',kind:'web',name:'Fictional library source',url:'https://example.com/library',text:'Fictional trial details.',truncated:false},token:'prepared-source'});
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
        current.context=body.context_tokens?.length?[{id:"file-1",kind:"file",name:"notes.md",text:"Fictional volunteer budget is 40 hours.",truncated:false}]:current.context;
        current.messages.push({
          id: "human",
          speaker_id: "user",
          content: body.text,
          status: "complete",
          created_at: initial.updated_at,
        });
        current.pending_question = null;
        current.state = "running";
      } else if (["start", "resume"].includes(body.action))
        current.state = "running";
      else if (body.action === "pause") current.state = "paused";
      else if (body.action === "stop") current.state = "stopped";
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
async function providers(page: Page) {
  if (test.info().project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Providers", exact: true })
      .click();
  } else
    await page.getByRole("link", { name: "Providers", exact: true }).click();
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => { document.querySelectorAll(".new-main,.settings-main").forEach(el => el.scrollTop = 0); window.scrollTo(0,0); });
  await page.screenshot({
    path: `../.impeccable/review/${test.info().project.name}-${name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test("login and provider onboarding", async ({ page }) => {
  await mock(page, { login: true, empty: true });
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your username");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Put a few minds to work." }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Set up a provider/ }).click();
  await page.getByRole("button", { name: "Try Pollinations — no key" }).click();
  await expect(page.getByText("No key saved")).toBeVisible();
  await capture(page, "providers");
});
test("create a conversation with two instances and optional instructions", async ({
  page,
}) => {
  await mock(page, { empty: false });
  await page.goto("/");
  await page
    .getByLabel("Conversation topic")
    .fill("What should our fictional library try next?");
  await page
    .getByRole("button", { name: "Add your first participant" })
    .click();
  await page.getByLabel("Participant 1 name").fill("Alex");
  await page
    .getByRole("button", { name: "Add participant", exact: true })
    .click();
  await page.getByLabel("Participant 2 name").fill("Blair");
  await expect(page.getByLabel("Model", { exact: true })).toHaveCount(2);
  await capture(page, "setup");
  await page.getByRole("button", { name: "Start conversation" }).click();
  await expect(
    page.getByRole("heading", {
      name: "What should our fictional library try next?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
});
test("read, pause, ask a question, and preserve a failed draft", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/?conversation=test-conversation");
  await expect(
    page.getByText("Saturday hours", { exact: false }),
  ).toBeVisible();
  await capture(page, "conversation");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Stop this conversation?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep conversation" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByLabel("Your message").fill("fail this message");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Your message")).toHaveValue(
    "fail this message",
  );
  await page
    .getByLabel("Your message")
    .fill("Keep the trial within the volunteer budget.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page
      .locator("article")
      .getByText("Keep the trial within the volunteer budget.", {
        exact: true,
      }),
  ).toBeVisible();
  await expect(page.getByLabel("Your message")).toHaveValue("");
  await page.getByLabel("Ask me questions").click();
  await expect(page.getByLabel("Ask me questions")).not.toBeChecked();
});
test("essential question, export, summary and deletion confirmation", async ({
  page,
}) => {
  const state = await mock(page);
  state.question();
  await page.goto("/?conversation=test-conversation");
  await expect(page.getByText("What is the volunteer budget?")).toBeVisible();
  await page.getByRole("button", { name: "Skip this question" }).click();
  await expect(
    page.getByText("What is the volunteer budget?"),
  ).not.toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown" }).click();
  await expect((await download).suggestedFilename()).toBe("thinkpit.md");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Summarize", exact: true }).click();
  await expect(
    page.getByText("A short summary of the trial and the staffing concern."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep conversation" }).click();
  await expect(
    page.getByRole("heading", { name: initial.topic }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Put a few minds to work." }),
  ).toBeVisible();
});

test("stream snapshots replace provisional text and reconnect from the last event", async ({
  page,
}) => {
  await mock(page);
  let first = true;
  let replayCursor = "";
  await page.route("**/api/conversations/*/events", async (route) => {
    if (!first) {
      replayCursor = route.request().headers()["last-event-id"];
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": keepalive\n\n",
      });
    }
    first = false;
    const started = {
      ...structuredClone(initial),
      state: "running",
      active_attempt_id: "stream-attempt",
      attempts: [
        {
          id: "stream-attempt",
          message_id: "stream-message",
          status: "running",
        },
      ],
      messages: [
        ...initial.messages,
        {
          id: "stream-message",
          speaker_id: "a",
          content: "",
          status: "streaming",
          created_at: initial.updated_at,
        },
      ],
    };
    const finished = {
      ...started,
      state: "ready",
      active_attempt_id: "",
      messages: [
        ...initial.messages,
        {
          id: "stream-message",
          speaker_id: "a",
          content: "The final reply replaces provisional text.",
          status: "complete",
          created_at: initial.updated_at,
        },
      ],
    };
    const event = (id: number, kind: string, data: unknown) =>
      `id: ${id}\nevent: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        event(43, "turn_started", started) +
        event(44, "text_delta", {
          attempt_id: "stream-attempt",
          text: "Provisional reply",
        }) +
        event(45, "turn_finished", finished),
    });
  });
  await page.goto("/?conversation=test-conversation");
  await expect(
    page.getByText("The final reply replaces provisional text."),
  ).toBeVisible();
  await expect(
    page.getByText("Provisional reply", { exact: true }),
  ).not.toBeVisible();
  await expect.poll(() => replayCursor).toBe("45");
});

test('discover, filter, compare, and add models; save and reload a setup',async({page})=>{
 await mock(page);await page.goto('/');
 await expect(page.getByRole('heading',{name:'Discover models'})).toBeVisible();
 await page.getByRole('button',{name:'Free',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Cedar Reasoner'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Orchid Vision'})).not.toBeVisible();
 await page.getByRole('button',{name:'All models',exact:true}).click();
 await page.getByRole('button',{name:'Compare Cedar Reasoner'}).click();
 await page.getByRole('button',{name:'Compare Orchid Vision'}).click();
 await expect(page.getByRole('table')).toContainText('32,000');
 await page.getByRole('button',{name:'Add Cedar Reasoner'}).click();
 await expect(page.getByLabel('Participant 1 name')).toHaveValue('Cedar Reasoner');
 await page.getByRole('button',{name:'Add Orchid Vision'}).click();
 await page.getByLabel('Save these participants').fill('Fictional research team');
 await page.getByRole('button',{name:'Save setup',exact:true}).click();
 await expect(page.getByText('Setup saved.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Remove participant 2'}).click();
 await page.getByLabel('Use a saved setup').selectOption({label:'Fictional research team'});
 await expect(page.getByLabel('Participant 2 name')).toHaveValue('Orchid Vision');
 await page.getByRole('button',{name:'Clear comparison'}).click();
 await capture(page,'discovery');
 await page.goto('/?view=models');
 await expect(page.getByRole('heading',{name:'Model library'})).toBeVisible();
 await capture(page,'models');
});

test('attach a file, search and select web evidence, then preserve sources in conversation',async({page})=>{
 await mock(page);await page.goto('/?conversation=test-conversation');
 await expect(page.getByLabel('Your message')).toBeVisible();
 await page.getByLabel('Attach context file').setInputFiles({name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('Fictional volunteer budget is 40 hours.')});
 await expect(page.getByText('notes.md',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Web sources',exact:true}).click();
 await page.getByLabel('Search the web').fill('fictional library hours');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect(page.getByRole('link',{name:'Fictional library source'})).toBeVisible();
 await page.getByRole('button',{name:'Add source',exact:true}).click();
 await expect(page.getByText('1 web sources selected.')).toBeVisible();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByLabel('Your message').fill('Use this context in the discussion.');
 await page.getByRole('button',{name:'Send message'}).click();
 await expect(page.getByLabel('Your message')).toHaveValue('');
 await page.getByRole('button',{name:'Sources (1)'}).click();
 await page.getByRole('dialog').getByText('notes.md',{exact:true}).click();
 await expect(page.getByText('Fictional volunteer budget is 40 hours.',{exact:true})).toBeVisible();
});
