# opencode-fork-context

Give forked OpenCode sessions their own task without losing the conversation's context.

When you fork a session, the agent inherits its history, including unfinished plans and earlier requests. This plugin labels your first prompt in the fork with the fork's session ID and tells the agent to use inherited history as background, not as an assignment.

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

For forked sessions, the plugin prepends a label to the first user prompt admitted to the fork through OpenCode's prompt hook:

```text
[Fork user prompt for session <sessionID>]
```

The label becomes part of the saved prompt text. The plugin adjusts attachment mention offsets and skips an exact duplicate prefix if the hook runs again. It does not label synthetic prompts, shell inputs, or compaction controls that bypass the prompt hook.

A prompt is the fork's first when the session's active context holds no user prompt or compaction created after the fork. Forked history keeps its original timestamps, so inherited prompts do not count. If you install the plugin in a fork that already has prompts of its own, it adds no label.

Before each primary model request, including tool continuations, the plugin adds instructions that identify the current session and its source. The labeled prompt establishes the fork's task, and later prompts refine or redirect it. The reminder does not reset that task on each turn. The agent should resume unfinished source work only when you request it.

A later fork can inherit a label from its source, so a label naming another session does not mark the current fork's task.

Compaction can remove the label or combine inherited work with the fork's work. The plugin's instructions tell the agent to clarify only when the task is ambiguous, not on every turn.

The plugin also gives the agent these ownership rules:

> Create fresh subagents owned by this session when delegating work for this fork. Subagent IDs and running agents in inherited history belong to their original sessions.
>
> Do not resume, steer, interrupt, or message inherited agents through subagent tools, session APIs, or relay tools unless the user explicitly authorizes coordination with those agents. Do not use other tools to bypass an ownership error. A request to continue the source task alone does not authorize taking over its agents.

Ordinary sessions and subagents with only a parent session ID remain unchanged.

These instructions are advisory, not a security boundary. The plugin does not block tools or rewrite existing history, and adds no compaction hook. You can still ask a fork to continue the original task.

## License

[MIT](LICENSE)
