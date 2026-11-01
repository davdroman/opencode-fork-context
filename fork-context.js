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

export default Plugin.define({
  id: "fork-context",
  async setup(ctx) {
    await ctx.session.hook("prompt", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (!session.fork) return;

      const prefix = `[Fork user prompt for session ${event.sessionID}]\n\n`;
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

    await ctx.session.hook("context", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (!session.fork) return;

      event.system.push({
        type: "text",
        text: [
          `This session is ${event.sessionID}, a fork of session ${session.fork.sessionID}.`,
          `The label "[Fork user prompt for session ${event.sessionID}]" marks the first user prompt admitted to this session. That prompt establishes this session's task, and every later prompt belongs to this session.`,
          "Labels naming another session were copied from an earlier fork. They do not mark this session's task.",
          "Use inherited conversation history as background, not as an assignment. Resume unfinished work from the source session only if the user explicitly requests it.",
          "Later prompts may refine or redirect the established task. This reminder does not reset the task on later turns or tool continuations.",
          "Compaction may remove the label or combine inherited work with this session's work. Ask for clarification only when the task is ambiguous.",
          "Create fresh subagents owned by this session when delegating work for this fork. Subagent IDs and running agents in inherited history belong to their original sessions.",
          "Do not resume, steer, interrupt, or message inherited agents through subagent tools, session APIs, or relay tools unless the user explicitly authorizes coordination with those agents. Do not use other tools to bypass an ownership error. A request to continue the source task alone does not authorize taking over its agents.",
        ].join("\n"),
      });
    });
  },
});
