# OpenCode Session Storage & Retrieval APIs

**Date**: 2026-06-17
**Sources**: Context7 (anomalyco/opencode source), webfetch (opencode.ai/docs), local cache compilation
**Covers**: Session storage backend, Task() tool task_id parameter, programmatic session ID retrieval, session APIs

---

## 1. Session Storage Backend: File-Based JSON (NOT a database)

OpenCode does **NOT** use a traditional database (SQL, SQLite, etc.) for session storage. Instead, it uses a **file-based JSON storage system** under a `storage/` directory.

### Storage Directory Structure

From `packages/opencode/src/storage/storage.ts`:

```
storage/
  session/{projectID}/{sessionID}.json
  message/{sessionID}/{messageID}.json
  part/{messageID}/{partID}.json
  session_diff/{sessionID}.json
```

- **Sessions** are organized by `projectID`
- **Messages** are organized by `sessionID`
- **Parts** (message content chunks) are organized by `messageID`
- **Session diffs** track file changes within a session

### Concurrency: Transactional Locks

The storage layer uses `TxReentrantLock` (transactional re-entrant locks) for safe concurrent access:

```typescript
const withResolved = <A, E>(
  key: string[],
  fn: (target: string, rw: TxReentrantLock.TxReentrantLock) => Effect.Effect<A, E>,
): Effect.Effect<A, E | FSUtil.Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = file((yield* state).dir, key)
      return yield* fn(target, yield* RcMap.get(locks, target))
    }),
  )
```

Each file operation acquires a lock for the target file path before reading/writing.

### Storage Root

Files are stored under `Global.Path.data/storage` — this is typically the OpenCode data directory (e.g., `~/.local/share/opencode/` or similar, depending on OS).

---

## 2. Session API (SDK Facade)

OpenCode exposes a `sessions` facade with three core operations:

### `sessions.create({ id?, location, ... })`

Creates a new session or retrieves an existing one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Optional | Session ID. If omitted, one is generated. If supplied and absent, creates new. If supplied and present, returns existing. |
| `location` | string | Required | Location identifier for the session (e.g., directory path) |
| `...` | any | Optional | Additional session properties |

**Behavior**:
- No ID → generates an internal Session ID
- Supplied ID + absent → creates the Session
- Supplied ID + present → returns existing Session identity (idempotent)

```javascript
sessions.create({ id: "my-session-123", location: "/path/to/project" })
sessions.create({ location: "/path/to/project" }) // auto-generates ID
```

### `sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })`

Submits a prompt to a session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Optional | Message ID. If omitted, one is generated. |
| `sessionID` | string | Required | Target session ID |
| `prompt` | string | Required | The prompt content |
| `delivery` | string | Optional | Delivery mode |
| `resume` | boolean | Optional | If `true` (default), schedules execution after admission. If `false`, admits only. |

```javascript
sessions.prompt({ sessionID: "my-session-123", prompt: "Hello, world!" })
sessions.prompt({ id: "msg-456", sessionID: "my-session-123", prompt: "...", resume: false })
```

### `sessions.interrupt(sessionID)`

Interrupts a running session. Preserves durable inbox rows for later resume. Idle or missing sessions are a no-op.

### REST SDK (Server Mode)

When running OpenCode in server mode, a REST API is available:

```javascript
// Create session via REST client
const session = await client.session.create({
  body: { title: "My session" },
})

// List all sessions
const sessions = await client.session.list()

// Send prompt via REST
await client.session.prompt({
  path: { id: session.id },
  body: {
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    parts: [{ type: "text", text: "Hello!" }],
  },
})
```

---

## 3. Session Execution Flow

When a session is resumed, the following flow occurs:

```
SessionExecution.resume(sessionID)
  → SessionStore.get(sessionID)          // Read session JSON from file storage
  → LocationServiceMap.get(session.location)  // Determine runner by location
  → SessionRunner.run({ sessionID, force? }) // Execute the session
```

---

## 4. Task() Tool — `task_id` Parameter

### Complete Parameter Schema

From `packages/opencode/src/tool/task.ts`:

```typescript
export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run the agent in the background. You will be notified when it completes.",
  }),
})

const BaseParameterFields = {
  description: Schema.String.annotate({
    description: "A short (3-5 words) description of the task"
  }),
  prompt: Schema.String.annotate({
    description: "The task for the agent to perform"
  }),
  subagent_type: Schema.String.annotate({
    description: "The type of specialized agent to use for this task"
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "This should only be set if you mean to resume a previous task " +
      "(you can pass a prior task_id and the task will continue the same " +
      "subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "The command that triggered this task"
  }),
}
```

### `task_id` Semantics

| Scenario | Behavior |
|----------|----------|
| `task_id` **omitted** | Creates a **new** subagent session with fresh context |
| `task_id` **provided** (prior session ID) | **Resumes** the existing subagent session — continues with its previous messages, tool outputs, and context |

### Usage Pattern (from tests)

```typescript
// Create new task (fresh context)
const result = yield* def.execute(
  {
    description: "inspect bug",
    prompt: "look into the cache key path",
    subagent_type: "general",
  },
  context
)

// Resume existing task
const result = yield* def.execute(
  {
    description: "inspect bug",
    prompt: "look into the cache key path",
    subagent_type: "general",
    task_id: child.id,  // ← Resumes existing subagent session
  },
  context
)
```

### Task Tool Usage Notes (from task.txt)

> Each agent invocation begins with a **fresh context** unless a `task_id` is supplied to resume an existing subagent session. When starting fresh, your prompt must include a highly detailed task description.

> Upon completion, an agent will return a single message containing a `task_id`. The agent's direct output is not visible to the user; therefore, you should send a text message summarizing the result to the user. The provided `task_id` can be reused to continue the same subagent session later.

---

## 5. Programmatic Session ID Retrieval

### Via Tool `execute()` Context

Every custom tool's `execute()` function receives a context object:

**Official `Tool.Context` interface** (from `specs/v2/tools.md`):

```typescript
interface Tool.Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly assistantMessageID: Session.MessageID
  readonly toolCallID: ToolCall.ID
}
```

**Extended context in practice** (from custom tools docs):

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Get project information",
  args: {},
  async execute(args, context) {
    const { agent, sessionID, messageID, directory, worktree } = context
    return `Agent: ${agent}, Session: ${sessionID}, Message: ${messageID}`
  }
})
```

The context object includes:
- `sessionID` — The current session ID
- `agent` — The current agent name/ID
- `messageID` / `assistantMessageID` — The current message ID
- `directory` — The project directory
- `worktree` — The worktree (git worktree context)
- `toolCallID` — The specific tool call ID

### Via Frontend SyncStore

The frontend UI maintains a `SyncStore` that maps sessions:

```typescript
type SyncStore = {
  contexts: Record<ContextKey, {
    session: SessionID[]                    // Session IDs per context
    session_status: Record<SessionID, SessionStatus>
  }>
  session: Record<SessionID, Session & { context: RuntimeContext }>
  message: Record<SessionID, Message[]>
  // ...
}
```

---

## 6. Session Lifecycle

### Session States

A session's lifecycle in the SyncStore is tracked by `SessionStatus`. The exact states are not fully documented but include concepts like `loading`, `partial`, `complete`.

### Child Sessions

When a primary agent invokes a subagent via `Task()`:
1. A **new child session** is created (linked to the parent)
2. The child session has its own `sessionID`
3. The child session is accessible via UI navigation (`session_child_first`, `session_child_cycle`)
4. The `task_id` returned by Task() is the child session's ID

---

## 7. Summary: Answers to Key Questions

### Q1: Does OpenCode have a built-in session database/table?

**No.** OpenCode uses **file-based JSON storage**, not a traditional database. Sessions are stored as JSON files under `storage/session/{projectID}/{sessionID}.json`. Messages are stored as `storage/message/{sessionID}/{messageID}.json`. No SQL tables, no migrations, no query engine.

### Q2: How is Task()'s `task_id` parameter documented?

The `task_id` parameter is an **optional string** on the Task() tool. Its description states: *"This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)."* Each Task() invocation creates a new child session by default; `task_id` enables session resumption.

### Q3: How can session metadata (sessionID) be retrieved programmatically?

There are **three ways**:

1. **Custom tool `execute()` context**: Every custom tool receives `context.sessionID`, `context.agent`, `context.messageID`, `context.directory`, and `context.worktree`.
2. **Plugin hooks**: `tool.execute.before` and `tool.execute.after` hooks receive `{ tool, sessionID, callID }` in their input.
3. **REST API**: When running in server mode, `client.session.list()` returns all sessions.

### Q4: Is there any official API to query session state?

**Limited.** The `sessions` facade provides `create`, `prompt`, and `interrupt` — but no `query` or `list` method in the local SDK. The REST API (`client.session.list()`) is available in server mode. Within custom tools, you only get the **current** session's ID via the context object — there's no built-in way to enumerate or query other sessions from within a tool.

---

## 8. Key Takeaways

1. **File-based, not database-based**: Sessions live as JSON files, not in SQL/NoSQL tables
2. **Session ID is the key**: All session operations (resume, prompt, interrupt) use the `sessionID` string
3. **`task_id` = session ID**: The Task() tool's `task_id` parameter is the child session's ID for resumption
4. **Context object is the primary API**: Custom tools get `sessionID` via `context.sessionID` in `execute()`
5. **No cross-session query API**: Within a tool, you can only access the current session; cross-session queries require the REST API or direct file reads
6. **Concurrency-safe**: File-based storage uses transactional locks per file path
