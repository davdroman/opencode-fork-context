import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "opencode-fork-context";

const forkedAt = 1_000;

async function sessionHooks(sessions, contexts = new Map()) {
  const hooks = new Map();
  await plugin.setup({
    session: {
      async get({ sessionID }) {
        assert.ok(sessions.has(sessionID), "looks up the current session");
        return sessions.get(sessionID);
      },
      async context({ sessionID }) {
        return contexts.get(sessionID) ?? [];
      },
      async hook(name, callback) {
        assert.ok(["context", "prompt"].includes(name));
        assert.ok(!hooks.has(name));
        hooks.set(name, callback);
      },
    },
  });
  assert.equal(hooks.size, 2);
  return Object.fromEntries(hooks);
}

function fork(sessionID, extra = {}) {
  return { fork: { sessionID }, time: { created: forkedAt }, ...extra };
}

function promptEvent(sessionID, text, messageID = "msg_prompt") {
  return { sessionID, messageID, prompt: { text }, delivery: "steer" };
}

function contextEvent(sessionID, messages) {
  return {
    sessionID,
    agent: "build",
    model: { providerID: "openai", id: "test-model" },
    system: [{ type: "text", text: "Existing instructions" }],
    messages,
    tools: { read: { description: "Read a file", input: { type: "object" } } },
    options: {},
  };
}

function userMessage(id, text) {
  return { id, role: "user", content: [{ type: "text", text }] };
}

function sessionMessage(id, created, type = "user", text = "") {
  return type === "user" ? { id, type, text, time: { created } } : { id, type, status: "completed", time: { created } };
}

const label = (sessionID) => `[Fork user prompt for session ${sessionID}]\n\n`;

test("only forks receive instructions and prompt labels, without changing messages or tools", async () => {
  const sessions = new Map([
    ["ses_normal", { time: { created: forkedAt } }],
    ["ses_child", { parentID: "ses_source", time: { created: forkedAt } }],
    ["ses_fork", fork("ses_source")],
  ]);
  const hooks = await sessionHooks(sessions);

  for (const [sessionID, session] of sessions) {
    const prompt = promptEvent(sessionID, "My task");
    await hooks.prompt(prompt);
    assert.equal(prompt.prompt.text, (session.fork ? label(sessionID) : "") + "My task");
    const event = contextEvent(sessionID, [userMessage("msg_task", prompt.prompt.text)]);
    const before = structuredClone(event);
    await hooks.context(event);

    assert.deepEqual(event.messages, before.messages);
    assert.deepEqual(event.tools, before.tools);
    assert.deepEqual(event.options, before.options);
    assert.deepEqual(event.system[0], before.system[0]);
    assert.equal(event.system.length, session.fork ? 2 : 1);
    if (session.fork) {
      assert.equal(event.system[1].type, "text");
      assert.match(event.system[1].text, /fork of session ses_source/);
      assert.match(event.system[1].text, /marks the first user prompt admitted to this session/);
      assert.match(event.system[1].text, /does not reset the task/);
    }
  }
});

test("labels only the first prompt admitted after the fork", async () => {
  const context = [
    sessionMessage("msg_copied_1", forkedAt - 20, "user", "Unfinished source task"),
    sessionMessage("msg_copied_compaction", forkedAt - 10, "compaction"),
  ];
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));

  for (const [index, text] of ["New fork task", "Refine the fork task", "Redirect the fork task"].entries()) {
    const event = promptEvent("ses_fork", text, `msg_new_${index}`);
    await hooks.prompt(event);
    assert.equal(event.prompt.text, (index === 0 ? label("ses_fork") : "") + text);
    context.push(sessionMessage(event.messageID, forkedAt + index, "user", event.prompt.text));
  }
});

test("ignores the admitted prompt itself when it already appears in context", async () => {
  const context = [sessionMessage("msg_prompt", forkedAt, "user", "My task")];
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));
  const event = promptEvent("ses_fork", "My task", "msg_prompt");
  await hooks.prompt(event);
  assert.equal(event.prompt.text, label("ses_fork") + "My task");
});

test("a post-fork compaction marks the fork task as established", async () => {
  const context = [sessionMessage("msg_compaction", forkedAt + 5, "compaction"), sessionMessage("msg_idle", forkedAt + 6, "idle")];
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));
  const event = promptEvent("ses_fork", "Continue");
  await hooks.prompt(event);
  assert.equal(event.prompt.text, "Continue");
});

test("non-prompt messages created after the fork do not count as a fork prompt", async () => {
  const context = [sessionMessage("msg_agent", forkedAt + 1, "agent-selected")];
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));
  const event = promptEvent("ses_fork", "My task");
  await hooks.prompt(event);
  assert.equal(event.prompt.text, label("ses_fork") + "My task");
});

test("shifts file, agent, and skill mention offsets while preserving admission fields", async () => {
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]));
  const text = "Review 🧭 @file with @agent using @skill";
  const mention = (token) => ({ start: text.indexOf(token), end: text.indexOf(token) + token.length, text: token });
  const event = {
    ...promptEvent("ses_fork", text),
    prompt: {
      text,
      files: [{ uri: "file:///project/file.js", mention: mention("@file") }, { uri: "file:///project/other.js" }],
      agents: [{ name: "reviewer", mention: mention("@agent") }, { name: "build" }],
      skills: [{ id: "review", mention: mention("@skill") }, { id: "other" }],
    },
    delivery: "queue",
    metadata: { source: "command", custom: true },
  };
  const expected = structuredClone(event);
  expected.prompt.text = label("ses_fork") + text;
  for (const attachments of [expected.prompt.files, expected.prompt.agents, expected.prompt.skills]) {
    attachments[0].mention.start += label("ses_fork").length;
    attachments[0].mention.end += label("ses_fork").length;
  }
  await hooks.prompt(event);
  assert.deepEqual(event, expected);
  for (const attachments of [event.prompt.files, event.prompt.agents, event.prompt.skills]) {
    const { start, end, text } = attachments[0].mention;
    assert.equal(event.prompt.text.slice(start, end), text);
  }
  await hooks.prompt(event);
  assert.deepEqual(event, expected);
});

test("labels attachment-only fork prompts", async () => {
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]));
  const event = promptEvent("ses_fork", "");
  event.prompt.files = [{ uri: "file:///project/image.png" }];
  await hooks.prompt(event);
  assert.equal(event.prompt.text, label("ses_fork"));
  assert.deepEqual(event.prompt.files, [{ uri: "file:///project/image.png" }]);
});

test("nested forks label their own first prompt despite copied source-session labels", async () => {
  const sessions = new Map([
    ["ses_first", fork("ses_root", { time: { created: forkedAt - 100 } })],
    ["ses_nested", fork("ses_first")],
  ]);
  const contexts = new Map([["ses_nested", [sessionMessage("msg_inherited", forkedAt - 50, "user", label("ses_first") + "Source fork task")]]]);
  const hooks = await sessionHooks(sessions, contexts);
  const next = promptEvent("ses_nested", "Nested fork task");
  await hooks.prompt(next);
  assert.equal(next.prompt.text, label("ses_nested") + "Nested fork task");
  const event = contextEvent("ses_nested", [userMessage("msg_inherited", label("ses_first") + "Source fork task"), userMessage(next.messageID, next.prompt.text)]);
  await hooks.context(event);
  assert.match(event.system[1].text, /The label "\[Fork user prompt for session ses_nested\]"/);
  assert.match(event.system[1].text, /Labels naming another session were copied from an earlier fork/);
});

test("repeated model requests and tool continuations leave transcript and tool exchanges unchanged", async () => {
  const hooks = await sessionHooks(new Map([["ses_fork", fork("ses_source")]]));
  const admission = promptEvent("ses_fork", "Fork task");
  await hooks.prompt(admission);
  const messages = [userMessage("msg_inherited", "Source task"), userMessage(admission.messageID, admission.prompt.text)];
  let instructions;
  for (let turn = 0; turn < 3; turn++) {
    const event = contextEvent("ses_fork", structuredClone(messages));
    const before = structuredClone(event);
    await hooks.context(event);
    assert.deepEqual(event.messages, before.messages);
    assert.deepEqual(event.tools, before.tools);
    assert.equal(event.system.length, 2);
    instructions ??= event.system[1].text;
    assert.equal(event.system[1].text, instructions);
    assert.match(instructions, /does not reset the task on later turns or tool continuations/);
    if (turn === 0) {
      messages.push(
        { id: "msg_assistant", role: "assistant", content: [{ type: "tool-call", id: "call_read", name: "read", input: {} }] },
        { role: "tool", content: [{ type: "tool-result", id: "call_read", name: "read", result: { type: "text", value: "Contents" } }] },
      );
    }
  }
  assert.match(instructions, /Create fresh subagents owned by this session/);
  assert.match(instructions, /unless the user explicitly authorizes coordination with those agents/);
  assert.match(instructions, /Do not use other tools to bypass an ownership error/);
  assert.match(instructions, /A request to continue the source task alone does not authorize taking over its agents/);
});
