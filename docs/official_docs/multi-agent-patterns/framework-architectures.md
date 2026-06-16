# Multi-Agent Framework Architectures: AutoGen, CrewAI, LangGraph, OpenAI Swarm

**Compiled**: 2026-06-16  
**Sources**: Context7 queries for /microsoft/autogen, /crewaiinc/crewai, /langchain-ai/langgraph, /openai/swarm  
**Accessed**: 2026-06-16

---

## 1. Microsoft AutoGen

### Core Abstraction: Conversations
AutoGen models multi-agent systems as **conversations** between agents. The key primitive is the GroupChat.

### Architecture Patterns

#### 1.1 Sequential Group Chat
- Agents execute in **fixed sequential order**
- Each agent processes the previous agent's output
- Simple pipeline, predictable execution
- **Interface**: `SequentialGroupChat` (AutoGen.Net)

#### 1.2 Dynamic Group Chat
- LLM-based **GroupChatManager** selects next speaker
- Uses participant descriptions to make routing decisions
- Prevents same speaker from going twice in a row
- **Interface**: `GroupChat` / `SelectorGroupChat`

#### 1.3 GroupChatManager Implementation
- Inherits from `RoutedAgent`
- Maintains chat history
- Formats participant descriptions as "roles"
- Uses LLM to select next speaker from conversation context
- Publishes `RequestToSpeak` to selected participant's topic

#### 1.4 Hierarchical Composition
- Group chats can be **nested** — each participant can itself be a group chat
- Enables recursive decomposition of complex tasks
- Useful for large-scale task breakdown

### Key Design Decisions
- **Conversation as state**: The message history IS the shared state
- **LLM-driven routing**: Next speaker selection is itself an LLM call
- **Topic-based messaging**: Agents communicate via typed topics
- **User-in-the-loop**: Can be configured to require user approval

### Code Pattern (SelectorGroupChat)
```python
team = SelectorGroupChat(
    participants=[travel_advisor, hotel_agent, flight_agent],
    model_client=model_client,
    termination_condition=TextMentionTermination("TERMINATE"),
    allow_repeated_speaker=False,
)
```

---

## 2. CrewAI

### Core Abstraction: Crews with Roles
CrewAI models multi-agent systems as **crews** of agents with defined roles, goals, and backstories.

### Architecture Patterns

#### 2.1 Sequential Process
- Tasks executed in order, each building on previous output
- `context=[previous_task]` passes output forward
- Simple, predictable pipeline
- **Best for**: Research → Write → Edit workflows

#### 2.2 Hierarchical Process
- Manager agent coordinates specialist agents
- Manager has `allow_delegation=True`
- Manager LLM specified separately (`manager_llm="gpt-4o"`)
- Specialists focus on expertise (`allow_delegation=False`)
- **Best for**: Complex projects requiring coordination

#### 2.3 Collaborative Single Task
- One task assigned to lead agent
- Task description explicitly guides other agents' contributions
- Lead agent delegates sub-parts
- **Best for**: Tasks that benefit from multiple perspectives

#### 2.4 Flow-Based Orchestration (Multi-Crew Pipeline)
- Pydantic-based state management across crews
- Each step can invoke a different crew
- `@start()` and `@listen()` decorators define pipeline
- **Best for**: End-to-end pipelines with multiple agent teams

### Key Design Decisions
- **Role-based identity**: Agents defined by role, goal, backstory
- **Delegation as first-class**: `allow_delegation` flag per agent
- **Task context chains**: Explicit `context=[task]` references
- **Process enum**: `Process.sequential` or `Process.hierarchical`
- **Verbose mode**: Built-in execution tracing

### Code Pattern (Hierarchical Crew)
```python
crew = Crew(
    agents=[manager, researcher, writer],
    tasks=[project_task],
    process=Process.hierarchical,
    manager_llm="gpt-4o",
)
```

---

## 3. LangGraph

### Core Abstraction: State Graphs
LangGraph models multi-agent systems as **typed state graphs** with nodes (agents/functions) and edges (routing logic).

### Architecture Patterns

#### 3.1 Linear Graph
- Sequential node execution
- State passed between nodes via typed `State` class
- Simplest pattern, equivalent to prompt chaining

#### 3.2 Conditional Routing
- `set_conditional_entry_point()` for dynamic routing
- Router functions inspect state and return next node name
- Equivalent to Anthropic's "Routing" pattern

#### 3.3 Dynamic Parallel Spawning (Send)
- `Send` objects for dynamic agent spawning
- Dispatcher returns `list[Send]` to invoke same node in parallel
- `operator.add` reducer for result aggregation
- Equivalent to Anthropic's "Parallelization" pattern

#### 3.4 Hierarchical Delegation (Command)
- `Command` with `goto=[Send(...)]` for parent→children delegation
- Parent node dynamically creates multiple child tasks
- State updates + result aggregation
- Equivalent to Anthropic's "Orchestrator-Workers"

#### 3.5 Self-RAG (Evaluator-Optimizer)
- Grading nodes evaluate retrieval quality and generation quality
- Conditional edges for retry/transform/accept decisions
- Multi-dimensional evaluation: relevance, hallucination, answer quality

### Key Design Decisions
- **Typed state**: `TypedDict` with explicit field types
- **Reducers**: `Annotated[list, operator.add]` for parallel aggregation
- **Conditional edges**: Functions that return next node names
- **Persistence**: Built-in state checkpointing and human-in-the-loop
- **Streaming**: First-class streaming support for node outputs

### Code Pattern (Dynamic Parallel)
```python
def continue_to_weather(state) -> list[Send]:
    return [Send("get_weather", {"location": loc}) for loc in state["locations"]]
```

---

## 4. OpenAI Swarm

### Core Abstraction: Handoffs
Swarm models multi-agent systems as **agent-to-agent handoffs** via function returns.

### Architecture Patterns

#### 4.1 Triage + Specialists
- Triage agent with handoff functions for each specialist
- Handoff = function that returns an Agent instance
- Simplest multi-agent pattern (~20 lines of code)
- **Best for**: Customer support routing

#### 4.2 Context Variables
- Shared `context_variables` dict passed to all agents
- Functions receive context via `context_variables: dict` parameter
- Handoffs can update context via `Result(value, agent, context_variables)`
- Context is hidden from model's tool schema
- **Best for**: Carrying metadata across agent boundaries

#### 4.3 Routines
- Agent `instructions` (system prompt) + `functions` (tools)
- Each agent is a self-contained routine
- No complex orchestration layer
- **Best for**: Simple, composable agent designs

### Key Design Decisions
- **Radical simplicity**: Entire framework is ~100 lines
- **Functions as handoffs**: Return Agent instance → runtime switches active agent
- **Flat context**: `context_variables` dict, no hierarchy
- **No persistence**: Each `client.run()` is independent
- **Educational purpose**: Explicitly designed to teach patterns, not production use

### Code Pattern (Handoff)
```python
def transfer_to_billing():
    return billing_agent

triage_agent = Agent(
    name="Triage",
    functions=[transfer_to_billing, transfer_to_technical],
)
```

---

## 5. Cross-Framework Comparison

| Dimension | AutoGen | CrewAI | LangGraph | Swarm |
|-----------|---------|--------|-----------|-------|
| **Primary metaphor** | Conversation | Team/Crew | Graph/State Machine | Handoff chain |
| **Orchestration** | LLM selects speaker | Process enum | Graph topology | Function returns |
| **State model** | Chat history | Task context | Typed dict + reducers | context_variables |
| **Composition** | Nested group chats | Multi-crew flows | Subgraphs | N/A (flat) |
| **Persistence** | Conversation store | Pydantic state | Checkpoints | None |
| **Complexity ceiling** | High (recursive) | Medium (enum) | Very High (arbitrary graphs) | Low (linear chains) |
| **Learning curve** | Medium | Low | High | Very Low |
| **Production use** | Yes | Yes | Yes | Educational |
| **Framework lock-in** | High | High | High | None (trivial to reimplement) |

---

## 6. Key Takeaways

1. **All frameworks implement the same 5-6 canonical patterns** (chaining, routing, parallelization, orchestration, evaluation)
2. **They differ in abstraction level**: Swarm (minimal) → CrewAI (declarative) → AutoGen (conversational) → LangGraph (graph-based)
3. **State management is the key differentiator**: How shared state is modeled determines scalability and debuggability
4. **No framework is universally best**: Choice depends on team expertise, task complexity, and production requirements
5. **Anthropic's advice holds**: Start simple, understand the underlying patterns before adopting a framework
