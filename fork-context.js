import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "fork-context",
  async setup(ctx) {
    await ctx.session.hook("context", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (!session.fork) return;

      event.system.push({
        type: "text",
        text: [
          `This session is a fork of session ${session.fork.sessionID}.`,
          "Treat inherited conversation history as background context, not an active assignment.",
          "The first user prompt after the fork establishes this session's task. Do not resume unfinished work from the source session unless explicitly requested.",
          "Subsequent prompts follow the task established in this fork; this reminder does not reset that task on each turn or tool continuation.",
          "When delegating work for this fork, create fresh subagents owned by this session. Subagent IDs and running agents mentioned in inherited history belong to their original sessions; leave them untouched unless the user explicitly authorizes coordination with those agents.",
          "Do not resume, steer, interrupt, or send messages to inherited agents through subagent tools, session APIs, or relay tools. A cross-session ownership error is a boundary to respect, not a reason to switch tools. Continuing the source task does not by itself authorize taking over its agents.",
        ].join("\n"),
      });
    });
  },
});
