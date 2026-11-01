# opencode-fork-context

Give forked OpenCode sessions their own task without losing the conversation's context.

When you fork a session, the agent inherits its history, including unfinished plans and earlier requests. This plugin adds instructions to your first prompt in the fork that tell the agent to use inherited history as background, not as an assignment.

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

For forked sessions, the plugin prepends a `<fork-context>` block to the first user prompt admitted to the fork through OpenCode's prompt hook. The block identifies the fork and its source session and tells the agent:

- The prompt establishes the fork's task, and later prompts refine or redirect it.
- Inherited conversation history is background, not an assignment. Unfinished source work resumes only when you request it.
- Fork context blocks naming another session were copied from an earlier fork and do not apply.
- Delegated work goes to fresh subagents owned by the fork. Subagents in inherited history belong to their original sessions and stay untouched unless you explicitly authorize coordination with them.

The block becomes part of the saved prompt text, so it appears in the transcript and stays in the conversation until compaction summarizes it. The plugin adjusts attachment mention offsets and skips an exact duplicate prefix if the hook runs again. It does not label synthetic prompts, shell inputs, or compaction controls that bypass the prompt hook.

A prompt is the fork's first when the session's active context holds no user prompt or compaction created after the fork. Forked history keeps its original timestamps, so inherited prompts do not count. If you install the plugin in a fork that already has prompts of its own, it adds no block.

Ordinary sessions and subagents with only a parent session ID remain unchanged.

These instructions are advisory, not a security boundary. The plugin does not block tools or rewrite existing history. You can still ask a fork to continue the original task.

## License

[MIT](LICENSE)
