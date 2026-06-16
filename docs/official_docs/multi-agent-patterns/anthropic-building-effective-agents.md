# Anthropic: Building Effective Agents — Pattern Summary

**Source**: https://www.anthropic.com/research/building-effective-agents  
**Published**: December 19, 2024  
**Authors**: Erik S. and Barry Zhang (Anthropic)  
**Accessed**: 2026-06-16 via webfetch

---

## Core Thesis

> "Consistently, the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."

## Key Definitions

- **Workflows**: Systems where LLMs and tools are orchestrated through **predefined code paths**
- **Agents**: Systems where LLMs **dynamically direct** their own processes and tool usage

## The 5 Workflow Patterns + Autonomous Agents

### 1. Augmented LLM (Building Block)
- LLM enhanced with: retrieval, tools, memory
- Foundation for all other patterns
- Recommendation: Focus on tailoring capabilities to use case + providing well-documented interfaces

### 2. Prompt Chaining
- Sequential LLM calls with programmatic gates between steps
- **Use when**: Task decomposes into fixed subtasks
- **Tradeoff**: Latency for accuracy
- **Examples**: Generate → Translate; Outline → Check → Write

### 3. Routing
- Input classifier → specialized followup task
- **Use when**: Distinct categories better handled separately
- **Examples**: Customer service routing; Easy→small model, Hard→capable model

### 4. Parallelization
- **Sectioning**: Task broken into independent parallel subtasks
- **Voting**: Same task run multiple times for diverse outputs
- **Use when**: Subtasks can parallelize for speed, or multiple perspectives needed
- **Key insight**: "For complex tasks with multiple considerations, LLMs generally perform better when each consideration is handled by a separate LLM call"

### 5. Orchestrator-Workers
- Central LLM dynamically breaks down tasks, delegates to workers, synthesizes results
- **Use when**: Can't predict subtasks needed upfront
- **Key difference from parallelization**: Flexibility — subtasks NOT pre-defined
- **Examples**: Multi-file coding changes; Multi-source search

### 6. Evaluator-Optimizer
- Generator + Evaluator in iterative refinement loop
- **Use when**: Clear evaluation criteria + iterative refinement adds value
- **Two fit signals**: (1) Responses improve with human feedback, (2) LLM can provide such feedback
- **Examples**: Literary translation; Complex multi-round search

### 7. Autonomous Agents
- LLM uses tools in a loop based on environmental feedback
- **Use when**: Open-ended problems, unpredictable number of steps, trusted environment
- **Crucial**: Gain "ground truth" from environment at each step
- **Include stopping conditions** (max iterations) for control
- **Higher costs and compounding error risk** — extensive testing + guardrails needed

## When NOT to Use Agents

> "For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough."

**Consider NOT building agentic systems when**:
- Simple retrieval + single call suffices
- Latency and cost matter more than marginal performance gains
- Tasks are well-defined and don't need dynamic decomposition

## Framework Guidance

- Frameworks simplify low-level tasks (calling LLMs, defining tools, chaining)
- BUT: They create abstraction layers that obscure prompts/responses → harder to debug
- They tempt adding complexity when simpler would suffice
- **Recommendation**: Start with LLM APIs directly; many patterns = a few lines of code
- If using framework: ensure you understand the underlying code

## Three Core Principles

1. **Maintain simplicity** in agent design
2. **Prioritize transparency** — explicitly show planning steps
3. **Craft agent-computer interface (ACI)** — thorough tool documentation and testing

## Appendix: Tool Design (ACI)

- Give model enough tokens to "think" before writing
- Keep format close to what model sees naturally in text
- Avoid formatting "overhead" (counting lines, string-escaping)
- Invest as much effort in ACI as in HCI
- Test tools with many example inputs; iterate
- Poka-yoke your tools (make mistakes harder)
- **Key example**: Changed tool to require absolute filepaths → model used flawlessly (vs relative paths which caused errors after directory changes)

## Practical Success Domains

1. **Customer Support**: Conversation + tool actions + clear success criteria
2. **Coding Agents**: Verifiable through tests, well-defined problem space, objective quality metrics
