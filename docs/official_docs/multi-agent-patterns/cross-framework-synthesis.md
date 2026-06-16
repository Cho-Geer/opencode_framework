# Multi-Agent Architecture Patterns: Cross-Framework Synthesis

**Compiled**: 2026-06-16  
**Sources**: Anthropic, Microsoft AutoGen, CrewAI, LangGraph, Google A2A, OpenAI Swarm  
**Domain**: multi-agent-patterns  
**Audience**: @Architect (for multi-agent system design decisions)

---

## 1. Executive Summary

Across all major frameworks and thought leaders, a **universal consensus** emerges: **start simple, add complexity only when measured improvement justifies it**. Anthropic's formulation is the most explicit: "the most successful implementations use simple, composable patterns rather than complex frameworks." This principle holds across all 6 sources researched.

The industry has converged on a **spectrum of architectures** from single-agent to fully distributed multi-agent systems, with clear decision criteria for when to move up the complexity ladder.

---

## 2. Architecture Pattern Taxonomy (Universal)

All frameworks describe variations of these **6 canonical patterns**, ordered by complexity:

### Pattern 1: Augmented Single Agent
- **Description**: One LLM with tools (retrieval, functions, memory)
- **When to use**: Most tasks. The default starting point.
- **Framework equivalents**: 
  - Anthropic: "The augmented LLM" (building block)
  - OpenAI Swarm: Single agent with routines
  - LangGraph: Single-node graph
  - AutoGen: Single AssistantAgent
  - CrewAI: Single Agent crew

### Pattern 2: Prompt Chaining (Pipeline)
- **Description**: Sequential LLM calls where each processes the previous output
- **When to use**: Tasks cleanly decomposable into fixed, ordered subtasks
- **Tradeoff**: Latency ↑, Accuracy ↑ (each step is simpler)
- **Framework equivalents**:
  - CrewAI: `Process.sequential` with `context=[previous_task]`
  - LangGraph: Linear StateGraph
  - Anthropic: "Prompt chaining" with gates

### Pattern 3: Routing (Classifier + Specialist)
- **Description**: Input classifier directs to specialized handler
- **When to use**: Distinct input categories needing different processing
- **Tradeoff**: Adds classification step, but each specialist is optimized
- **Framework equivalents**:
  - OpenAI Swarm: Triage agent with handoff functions
  - LangGraph: Conditional edges + routing functions
  - Anthropic: "Routing" with specialized prompts
  - AutoGen: SelectorGroupChat with role-based selection

### Pattern 4: Parallelization (Sectioning / Voting)
- **Description**: Same task run concurrently by multiple agents, results aggregated
- **Variants**: Sectioning (different subtasks) vs Voting (same task, diverse outputs)
- **When to use**: Independent subtasks, or when multiple perspectives improve confidence
- **Tradeoff**: Speed ↑ (parallel), Cost ↑ (multiple LLM calls)
- **Framework equivalents**:
  - LangGraph: `Send` objects for dynamic parallel spawning
  - Anthropic: "Parallelization" workflow
  - AutoGen: Parallel group chat execution

### Pattern 5: Orchestrator-Workers (Dynamic Delegation)
- **Description**: Central orchestrator dynamically decomposes tasks, delegates to workers
- **When to use**: Complex tasks where subtasks can't be predicted upfront
- **Key difference from parallelization**: Subtasks are NOT pre-defined
- **Framework equivalents**:
  - CrewAI: `Process.hierarchical` with manager agent
  - AutoGen: GroupChat with GroupChatManager (LLM selects next speaker)
  - LangGraph: Command + Send for hierarchical delegation
  - Anthropic: "Orchestrator-workers" workflow
  - OpenCode framework: @Orchestrator + @Meta-Planner + worker agents

### Pattern 6: Evaluator-Optimizer (Adversarial Loop)
- **Description**: Generator + Evaluator in iterative refinement loop
- **When to use**: Clear evaluation criteria, iterative improvement provides measurable value
- **Tradeoff**: Highest quality, but highest latency and cost
- **Framework equivalents**:
  - Anthropic: "Evaluator-optimizer" workflow
  - LangGraph: Self-RAG pattern with grading nodes
  - AutoGen: Two-agent debate patterns

---

## 3. When to Use Single Agent vs Multi-Agent

### Decision Matrix (Consensus across all sources)

| Signal | Use Single Agent | Use Multi-Agent |
|--------|:---------------:|:---------------:|
| Task decomposable into fixed steps? | ✅ | — |
| Subtasks require different expertise? | — | ✅ |
| Predictable number of steps? | ✅ | — |
| Open-ended, unpredictable steps? | — | ✅ |
| Verifiable output (tests, assertions)? | ✅ | ✅ (agents iterate) |
| Needs diverse perspectives/voting? | — | ✅ |
| Latency-sensitive? | ✅ | — |
| Cost-sensitive? | ✅ | — |
| Quality > speed/cost? | — | ✅ |
| Scale/trust environment? | ✅ | ✅ (autonomous scaling) |

### Anthropic's Key Insight
> "For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough."

### OpenAI Swarm's Philosophy
> Swarm is explicitly "educational" — demonstrating that multi-agent can be implemented in ~100 lines of code without complex frameworks. The simplicity IS the feature.

### CrewAI's Position
> CrewAI adds structure (roles, goals, backstories) to make multi-agent collaboration **declarative** rather than imperative. The overhead is in configuration, not code complexity.

---

## 4. Role Decomposition Strategies

### Strategy 1: Expertise-Based (CrewAI model)
- Define agents by domain expertise: Researcher, Writer, Editor
- Each agent has: `role`, `goal`, `backstory`, `tools`
- Delegation enabled per-agent (`allow_delegation: bool`)
- **Best for**: Content creation, research pipelines

### Strategy 2: Function-Based (Swarm model)
- Define agents by function: Triage, Billing, Technical Support
- Handoff via simple function returns
- Context variables carry state across handoffs
- **Best for**: Customer support, routing scenarios

### Strategy 3: Graph-Node-Based (LangGraph model)
- Define agents as graph nodes with typed state
- Routing via conditional edges (programmatic or LLM-decided)
- State reducers for parallel aggregation
- **Best for**: Complex workflows with conditional logic, loops

### Strategy 4: Conversation-Based (AutoGen model)
- Define agents as conversation participants
- GroupChatManager uses LLM to select next speaker
- Sequential or dynamic orchestration
- **Best for**: Collaborative problem-solving, brainstorming

### Strategy 5: Protocol-Based (A2A model)
- Define agents as opaque services with Agent Cards
- Discovery via capability declarations
- Communication via standardized messages
- **Best for**: Cross-organization, cross-framework interop

### Strategy 6: Hierarchical (OpenCode model)
- Meta-Planner → Orchestrator → Specialist agents
- DAG-based dependency tracking
- Compliance gates at each transition
- **Best for**: Full-lifecycle software development with quality gates

---

## 5. Attention Focus vs Dispatch Cost Tradeoffs

### The Core Tradeoff

| Factor | Single Agent (Focused Attention) | Multi-Agent (Distributed Attention) |
|--------|:-------------------------------:|:----------------------------------:|
| **Context window utilization** | Full window for one task | Partitioned across agents |
| **Attention quality** | High (undivided) | Per-agent high, but coordination overhead |
| **Dispatch cost** | Zero | Network/serialization/LLM calls |
| **Error propagation** | Single chain | Isolated per-agent, but synthesis risk |
| **Token cost** | Lower | Higher (each agent has system prompt + context) |
| **Latency** | Lower (sequential) | Potentially lower (parallel) or higher (coordination) |
| **Debuggability** | Easier (one trace) | Harder (distributed traces needed) |

### Anthropic's Guidance
> "Agentic systems often trade latency and cost for better task performance."
> "For complex tasks with multiple considerations, LLMs generally perform better when each consideration is handled by a separate LLM call, allowing focused attention on each specific aspect."

### Key Insight: The "Attention Focus" Advantage
Multi-agent systems excel NOT because of parallelism per se, but because each agent can devote its **full context window** to a single aspect. A single agent trying to handle 5 concerns simultaneously divides its attention. Five specialized agents each give 100% attention to their concern.

### Dispatch Cost Mitigation Patterns
1. **Minimal context passing**: Only pass essential information between agents (Swarm's context_variables)
2. **Hierarchical summarization**: Orchestrator summarizes, not raw-dumps, to workers
3. **Selective parallelism**: Only parallelize when subtasks are truly independent
4. **Early termination**: Stop agents when their specific contribution is complete

---

## 6. Context Window Management in Multi-Agent Systems

### Challenge
Each agent has a finite context window. In multi-agent systems, the challenge is:
- What context to share between agents?
- How to prevent context overflow in long-running tasks?
- How to maintain coherence across agent boundaries?

### Solutions by Framework

| Framework | Context Strategy |
|-----------|-----------------|
| **Swarm** | Shared `context_variables` dict — flat, lightweight, passed to all agents |
| **AutoGen** | Full conversation history in GroupChat; configurable `maxRounds` |
| **CrewAI** | Task `context=[previous_task]` — explicit context chains |
| **LangGraph** | Typed `State` with reducers — structured, composable state management |
| **A2A** | Opaque agents — context stays INTERNAL to each agent; only Messages/Artifacts are exchanged |
| **OpenCode** | HANDOVER.md files + TASK_LOG.md — file-based context persistence across agents |

### Best Practices
1. **Minimize shared state**: Pass only what the next agent needs
2. **Use typed state schemas**: Prevent drift and ensure consistency (LangGraph approach)
3. **Persist context externally**: Files, databases — not just in-memory (OpenCode approach)
4. **Set context budgets**: Max tokens per handoff to prevent overflow
5. **Summarize, don't duplicate**: Orchestrator should synthesize, not forward raw outputs

---

## 7. Practical Simplification Patterns

### Pattern A: "Just Use Tools" (Anthropic recommendation)
Before building multi-agent, try giving a single agent more/better tools. Most "multi-agent" needs can be solved with:
- Better tool descriptions (ACI design)
- More specialized retrieval
- Structured output formats

### Pattern B: "Framework-Free Agents" (OpenAI Swarm philosophy)
Multi-agent patterns can be implemented in ~100 lines of code:
```python
def transfer_to_specialist():
    return specialist_agent  # That's the whole handoff mechanism
```
No framework needed. The pattern is trivial; the value is in the design.

### Pattern C: "Declarative Crews" (CrewAI philosophy)
Define agents, tasks, and process type. The framework handles orchestration:
```python
crew = Crew(agents=[researcher, writer], tasks=[research_task, writing_task], process=Process.sequential)
```

### Pattern D: "Graph Everything" (LangGraph philosophy)
Model the entire workflow as a state graph. Every pattern (sequential, parallel, routing, orchestrator) is just a graph topology.

### Pattern E: "Protocol Over Framework" (A2A philosophy)
Instead of one framework orchestrating everything, define a protocol for agents to discover and communicate. Each agent can use any framework internally.

---

## 8. Framework Comparison Matrix

| Feature | Anthropic Patterns | AutoGen | CrewAI | LangGraph | Swarm | A2A |
|---------|:-----------------:|:-------:|:------:|:---------:|:-----:|:---:|
| **Primary abstraction** | Workflows + Agents | Conversations | Crews | Graphs | Handoffs | Protocol |
| **Multi-agent orchestration** | Manual composition | GroupChat | Process enum | Graph topology | Function returns | Agent Cards |
| **State management** | User-managed | Chat history | Pydantic state | Typed reducers | context_variables | Task lifecycle |
| **Discovery mechanism** | N/A | Agent descriptions | Role/backstory | Node definitions | Function names | Agent Cards (JSON) |
| **Inter-framework interop** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (core purpose) |
| **Learning curve** | Low (conceptual) | Medium | Low | High | Very Low | Medium |
| **Production readiness** | High (pattern-level) | High | High | High | Educational | v1.0 (2026) |
| **Opinionatedness** | Low (patterns) | Medium | High | Low | Very Low | Low (protocol) |

---

## 9. Recommendations for System Design

### 9.1 Start Here (Decision Tree)
```
Can a single LLM call + tools solve it?
  → YES: Use augmented single agent. Stop.
  → NO: Can the task be decomposed into fixed steps?
    → YES: Use prompt chaining (sequential pipeline)
    → NO: Are there distinct input categories?
      → YES: Use routing (classifier + specialists)
      → NO: Can subtasks run in parallel?
        → YES: Use parallelization (sectioning/voting)
        → NO: Do you need dynamic task decomposition?
          → YES: Use orchestrator-workers
          → NO: Do you need iterative refinement?
            → YES: Use evaluator-optimizer
            → NO: Use autonomous agent (full loop)
```

### 9.2 When Multi-Agent Adds Value (Summary)
1. **Specialization**: Different expertise requires different prompts/tools/context
2. **Attention focus**: Each concern gets full context window
3. **Parallelism**: Independent subtasks for speed
4. **Reliability**: Voting/evaluation for higher confidence
5. **Scale**: Tasks too large for single context window
6. **Separation of concerns**: Maintainability and debuggability

### 9.3 When Multi-Agent is Overhead (Summary)
1. **Simple tasks**: Single call + tools suffices
2. **Tight latency budgets**: Each handoff adds 1-5 seconds
3. **Cost sensitivity**: Each agent costs tokens (system prompt + context)
4. **Tight coupling**: Agents need each other's internal state
5. **Simple coordination**: A few if/else branches, not a complex graph

### 9.4 Three Core Principles (Anthropic)
1. Maintain **simplicity** in agent design
2. Prioritize **transparency** by showing planning steps
3. Carefully craft **agent-computer interface (ACI)** through tool documentation and testing

---

## 10. Relevance to OpenCode Multi-Agent Architecture

The project's current architecture (@Meta-Planner → @Orchestrator → Specialist agents) maps most closely to:

| OpenCode Component | Industry Equivalent |
|-------------------|-------------------|
| @Meta-Planner | Orchestrator (LangGraph), Manager Agent (CrewAI) |
| @Orchestrator | GroupChatManager (AutoGen), Graph Router (LangGraph) |
| @Architect | Specialist agent (expertise-based decomposition) |
| @Coder-BE / @Coder-FE | Worker agents (function-based decomposition) |
| @Guardian | Evaluator (evaluator-optimizer pattern) |
| @Arbiter | Meta-evaluator (evaluates evaluations) |
| compliance_gate_check/confirm/complete | Protocol-level state machine (A2A-inspired) |
| HANDOVER.md / TASK_LOG.md | Context passing mechanism (similar to Swarm's context_variables) |
| Task.DAG.json | Graph topology definition (LangGraph-inspired) |

### Strengths of Current Architecture
- Clear role decomposition (expertise-based)
- Compliance gates (quality-focused, like evaluator-optimizer)
- File-based context persistence (robust across agent boundaries)
- DAG-based dependency tracking (explicit, verifiable)

### Potential Improvements (Based on Research)
- **Consider selective parallelism**: Independent tasks could run concurrently (LangGraph Send pattern)
- **Minimize handoff context**: Ensure HANDOVER.md contains only essential info (Swarm philosophy)
- **Add voting/evaluation loops**: For critical tasks, consider multiple Guardian reviews (Anthropic's voting pattern)
- **Protocol-based discovery**: For cross-organization scenarios, consider A2A Agent Cards

---

## Source References

| # | Source | URL | Access Date |
|---|--------|-----|-------------|
| 1 | Anthropic "Building Effective Agents" | https://www.anthropic.com/research/building-effective-agents | 2026-06-16 |
| 2 | Microsoft AutoGen (Context7: /microsoft/autogen) | https://github.com/microsoft/autogen | 2026-06-16 |
| 3 | CrewAI (Context7: /crewaiinc/crewai) | https://github.com/crewaiinc/crewai | 2026-06-16 |
| 4 | LangGraph (Context7: /langchain-ai/langgraph) | https://github.com/langchain-ai/langgraph | 2026-06-16 |
| 5 | Google A2A Protocol v1.0 | https://a2a-protocol.org/latest/specification/ | 2026-06-16 |
| 6 | OpenAI Swarm (Context7: /openai/swarm) | https://github.com/openai/swarm | 2026-06-16 |
