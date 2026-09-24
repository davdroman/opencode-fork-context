import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "opencode-fork-context";

async function contextHook(sessions) {
  let hook;
  await plugin.setup({
    session: {
      async get({ sessionID }) {
        assert.ok(sessions.has(sessionID), "looks up the current session");
        return sessions.get(sessionID);
      },
      async hook(name, callback) {
        assert.equal(name, "context");
        hook = callback;
      },
    },
  });
  return hook;
}

test("only forks receive instructions, without changing messages or tools", async () => {
  const sessions = new Map([
    ["ses_normal", {}],
    ["ses_child", { parentID: "ses_source" }],
    ["ses_fork", { fork: { sessionID: "ses_source" } }],
  ]);
  const hook = await contextHook(sessions);

  for (const [sessionID, session] of sessions) {
    for (let turn = 0; turn < 2; turn++) {
      const event = {
        sessionID,
        system: [{ type: "text", text: "Existing instructions" }],
        messages: [{ role: "user", content: [{ type: "text", text: "My task" }] }],
        tools: { read: { description: "Read a file" } },
      };
      const before = structuredClone(event);
      await hook(event);

      assert.deepEqual(event.messages, before.messages);
      assert.deepEqual(event.tools, before.tools);
      assert.deepEqual(event.system[0], before.system[0]);
      assert.equal(event.system.length, session.fork ? 2 : 1);
      if (session.fork) {
        assert.equal(event.system[1].type, "text");
        assert.match(event.system[1].text, /fork of session ses_source/);
        assert.match(event.system[1].text, /first user prompt after the fork establishes/);
        assert.match(event.system[1].text, /does not reset that task/);
      }
    }
  }
});
