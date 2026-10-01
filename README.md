# opencode-fork-context

Give forked OpenCode sessions a fresh task without losing the conversation’s context.

When you fork a session, the agent inherits its history—including unfinished plans and earlier requests. This plugin tells the agent that your first prompt after the fork establishes the new task, so you don’t have to keep saying “don’t continue what you were doing.”

## Installation

Requires **OpenCode V2**.

Install through OpenCode’s CLI:

```sh
opencode plugin add opencode-fork-context
```

Or add the package to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-fork-context"]
}
```

You can also install directly from GitHub:

```sh
opencode plugin add github:davdroman/opencode-fork-context
```

## How it works

Before each agent model request, the plugin checks the session’s fork metadata. For forked sessions, it adds these instructions:

> Treat inherited conversation history as background context, not an active assignment.
>
> The first user prompt after the fork establishes this session’s task. Do not resume unfinished work from the source session unless explicitly requested.
>
> Subsequent prompts follow the task established in this fork; this reminder does not reset that task on each turn or tool continuation.
>
> When delegating work for this fork, create fresh subagents owned by this session. Subagent IDs and running agents mentioned in inherited history belong to their original sessions; leave them untouched unless the user explicitly authorizes coordination with those agents.
>
> Do not resume, steer, interrupt, or send messages to inherited agents through subagent tools, session APIs, or relay tools. A cross-session ownership error is a boundary to respect, not a reason to switch tools. Continuing the source task does not by itself authorize taking over its agents.

The instruction also identifies the source session. It stays present across turns and tool calls, while ordinary sessions receive no additional instructions.

The plugin guides the agent through its system instructions; it does not delete history or block tools. You can still ask a fork to continue the original task.

## License

[MIT](LICENSE)
