import { Plugin } from "@opencode/plugin";

// Forking copies messages with their original creation times, so only work
// admitted to the fork itself is created at or after the fork.
async function hasForkPrompt(ctx, event, session) {
  const forkedAt = session.time.created;
  const messages = await ctx.session.context({ sessionID: event.sessionID });
  return messages.some((message) =>
    message.id !== event.messageID &&
    (message.type === "user" || message.type === "compaction") &&
    message.time.created >= forkedAt
  );
}

function forkContext(sessionID, sourceID) {
  return [
    `<fork-context session="${sessionID}">`,
    `This session (${sessionID}) is a fork of session ${sourceID}. This is the first user prompt admitted to this session, and it establishes this session's task. Later prompts in this session may refine or redirect it.`,
    "Use inherited conversation history as background, not as an assignment. Resume unfinished work from the source session only if the user explicitly requests it.",
    "Fork context blocks naming another session were copied from an earlier fork and do not apply to this session.",
    "Create fresh subagents owned by this session when delegating work for this fork. Subagent IDs and running agents in inherited history belong to their original sessions.",
    "Do not resume, steer, interrupt, or message inherited agents through subagent tools, session APIs, or relay tools unless the user explicitly authorizes coordination with those agents. Do not use other tools to bypass an ownership error. A request to continue the source task alone does not authorize taking over its agents.",
    "</fork-context>",
  ].join("\n") + "\n\n";
}

export default Plugin.define({
  id: "fork-context",
  async setup(ctx) {
    await ctx.session.hook("prompt", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (!session.fork) return;

      const prefix = forkContext(event.sessionID, session.fork.sessionID);
      if (event.prompt.text.startsWith(prefix)) return;
      if (await hasForkPrompt(ctx, event, session)) return;

      event.prompt.text = prefix + event.prompt.text;
      for (const attachments of [event.prompt.files, event.prompt.agents, event.prompt.skills]) {
        for (const attachment of attachments ?? []) {
          if (!attachment.mention) continue;
          attachment.mention.start += prefix.length;
          attachment.mention.end += prefix.length;
        }
      }
    });
  },
});
