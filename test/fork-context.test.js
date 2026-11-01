import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "opencode-fork-context";

const forkedAt = 1_000;

async function promptHook(sessions, contexts = new Map()) {
  let hook;
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
        assert.equal(name, "prompt");
        assert.equal(hook, undefined);
        hook = callback;
      },
    },
  });
  assert.ok(hook);
  return hook;
}

function fork(sessionID, extra = {}) {
  return { fork: { sessionID }, time: { created: forkedAt }, ...extra };
}

function promptEvent(sessionID, text, messageID = "msg_prompt") {
  return { sessionID, messageID, prompt: { text }, delivery: "steer" };
}

function sessionMessage(id, created, type = "user", text = "") {
  return type === "user" ? { id, type, text, time: { created } } : { id, type, status: "completed", time: { created } };
}

// Returns the fork context block prepended to `text`, or undefined when the prompt is unchanged.
function forkContextOf(prompt, text) {
  if (prompt === text) return undefined;
  assert.ok(prompt.endsWith(`</fork-context>\n\n${text}`));
  return prompt.slice(0, prompt.length - text.length);
}

test("labels a fork's first prompt with its task and ownership instructions", async () => {
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]));
  const event = promptEvent("ses_fork", "My task");
  await hook(event);
  const context = forkContextOf(event.prompt.text, "My task");
  assert.ok(context.startsWith('<fork-context session="ses_fork">\n'));
  assert.match(context, /This session \(ses_fork\) is a fork of session ses_source/);
  assert.match(context, /establishes this session's task/);
  assert.match(context, /inherited conversation history as background, not as an assignment/);
  assert.match(context, /Create fresh subagents owned by this session/);
  assert.match(context, /unless the user explicitly authorizes coordination with those agents/);
  assert.match(context, /Do not use other tools to bypass an ownership error/);
});

test("leaves prompts in ordinary sessions and subagents unchanged", async () => {
  const hook = await promptHook(new Map([
    ["ses_normal", { time: { created: forkedAt } }],
    ["ses_child", { parentID: "ses_source", time: { created: forkedAt } }],
  ]));
  for (const sessionID of ["ses_normal", "ses_child"]) {
    const event = promptEvent(sessionID, "My task");
    await hook(event);
    assert.equal(event.prompt.text, "My task");
  }
});

test("labels only the first prompt admitted after the fork", async () => {
  const context = [
    sessionMessage("msg_copied_1", forkedAt - 20, "user", "Unfinished source task"),
    sessionMessage("msg_copied_compaction", forkedAt - 10, "compaction"),
  ];
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));

  for (const [index, text] of ["New fork task", "Refine the fork task", "Redirect the fork task"].entries()) {
    const event = promptEvent("ses_fork", text, `msg_new_${index}`);
    await hook(event);
    assert.equal(forkContextOf(event.prompt.text, text) !== undefined, index === 0);
    context.push(sessionMessage(event.messageID, forkedAt + index, "user", event.prompt.text));
  }
});

test("ignores the admitted prompt itself when it already appears in context", async () => {
  const context = [sessionMessage("msg_prompt", forkedAt, "user", "My task")];
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));
  const event = promptEvent("ses_fork", "My task", "msg_prompt");
  await hook(event);
  assert.ok(forkContextOf(event.prompt.text, "My task"));
});

test("a post-fork compaction marks the fork task as established", async () => {
  const context = [sessionMessage("msg_compaction", forkedAt + 5, "compaction"), sessionMessage("msg_idle", forkedAt + 6, "idle")];
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));
  const event = promptEvent("ses_fork", "Continue");
  await hook(event);
  assert.equal(event.prompt.text, "Continue");
});

test("non-prompt messages created after the fork do not count as a fork prompt", async () => {
  const context = [sessionMessage("msg_agent", forkedAt + 1, "agent-selected")];
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]), new Map([["ses_fork", context]]));
  const event = promptEvent("ses_fork", "My task");
  await hook(event);
  assert.ok(forkContextOf(event.prompt.text, "My task"));
});

test("shifts file, agent, and skill mention offsets while preserving admission fields", async () => {
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]));
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
  const before = structuredClone(event);
  await hook(event);
  const prefix = forkContextOf(event.prompt.text, text);
  const expected = structuredClone(before);
  expected.prompt.text = prefix + text;
  for (const attachments of [expected.prompt.files, expected.prompt.agents, expected.prompt.skills]) {
    attachments[0].mention.start += prefix.length;
    attachments[0].mention.end += prefix.length;
  }
  assert.deepEqual(event, expected);
  for (const attachments of [event.prompt.files, event.prompt.agents, event.prompt.skills]) {
    const { start, end, text } = attachments[0].mention;
    assert.equal(event.prompt.text.slice(start, end), text);
  }
  await hook(event);
  assert.deepEqual(event, expected);
});

test("labels attachment-only fork prompts", async () => {
  const hook = await promptHook(new Map([["ses_fork", fork("ses_source")]]));
  const event = promptEvent("ses_fork", "");
  event.prompt.files = [{ uri: "file:///project/image.png" }];
  await hook(event);
  assert.ok(forkContextOf(event.prompt.text, ""));
  assert.deepEqual(event.prompt.files, [{ uri: "file:///project/image.png" }]);
});

test("nested forks label their own first prompt despite a copied source-session block", async () => {
  const sessions = new Map([
    ["ses_first", fork("ses_root", { time: { created: forkedAt - 100 } })],
    ["ses_nested", fork("ses_first")],
  ]);
  const hook = await promptHook(sessions);
  const source = promptEvent("ses_first", "Source fork task");
  await hook(source);
  const inherited = sessionMessage("msg_inherited", forkedAt - 50, "user", source.prompt.text);
  const nestedHook = await promptHook(sessions, new Map([["ses_nested", [inherited]]]));
  const next = promptEvent("ses_nested", "Nested fork task");
  await nestedHook(next);
  const context = forkContextOf(next.prompt.text, "Nested fork task");
  assert.match(context, /This session \(ses_nested\) is a fork of session ses_first/);
  assert.match(context, /Fork context blocks naming another session were copied from an earlier fork/);
});
