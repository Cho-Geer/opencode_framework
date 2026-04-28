---
name: "brainstorming"
description: "Turns vague ideas, requirement notes, and architecture discussions into clear, implementation-ready designs. Invoke when user has ambiguous requirements, needs design clarification, or wants to explore solution approaches for technical problems."
---

# Brainstorming Skill

## Description
Transforms vague ideas, requirement notes, and architecture discussions into clear, implementation-ready designs through structured analysis and option evaluation.

## Core Workflow
Follow this sequence:

1. **Understand the input mode**: Classify as vague idea, requirement/spec, or architecture discussion in an existing codebase.
2. **Gather context**: Collect information from conversation history, uploaded files, and available connectors before asking detailed questions.
3. **Ask clarifying questions**: Ask the minimum number of questions needed to remove ambiguity. Prefer one question per message when the task is interactive.
4. **Propose approaches**: Once the problem shape is clear, propose 2-3 viable approaches with trade-offs.
5. **Recommend approach**: Recommend one approach and explain why it wins for the stated goals and constraints.
6. **Produce design document**: Create an implementation-ready design document without jumping into coding or low-level implementation.

## Enhanced Input Analysis and Feedback Loop

In addition to the core workflow, the brainstorming skill now includes enhanced capabilities for precise requirement understanding and iterative refinement:

### 1. Question Content Analysis and Summarization
**Function**: Accurately identify the core requirements, key information, and potential intent within user questions, performing structured organization.

**Implementation**:
- Analyze the user's input to extract explicit requirements and implicit needs
- Identify key constraints, success criteria, and boundary conditions
- Detect potential ambiguities and conflicting requirements
- Categorize information into functional requirements, non-functional requirements, constraints, and assumptions
- Create a structured summary that captures the essence of the request

### 2. Structured Summary Output
**Function**: Present the summarized key points in a clear, well-organized format with explicit labeling for user confirmation.

**Implementation**:
- Present analysis results using a consistent structured format
- Clearly mark each section with descriptive headers
- Use bullet points, numbered lists, and tables for clarity
- Explicitly label sections requiring user confirmation or clarification
- Highlight assumptions, open questions, and decision points
- Provide a concise executive summary at the beginning

### 3. Confirmation Feedback Processing Mechanism
**Function**: When receiving user confirmation containing additional or updated content, automatically trigger a new round of key point analysis and summarization.

**Implementation**:
- Monitor user responses for confirmation patterns with modifications
- Identify new information, changed requirements, or clarifications
- Compare against previous analysis to detect deltas
- Trigger re-analysis of the updated input
- Preserve valid previous analysis while incorporating changes
- Maintain conversation context and history throughout iterations

### 4. Task Flow Control
**Function**: When receiving user confirmation without additional or updated content, automatically terminate the current skill flow and smoothly transition to subsequent task execution phases.

**Implementation**:
- Detect simple confirmation responses without substantive changes
- Validate that all key points have been addressed and confirmed
- Prepare a transition summary capturing the agreed understanding
- Hand off to subsequent tasks with clear context and requirements
- Ensure continuity by passing relevant analysis and decisions
- Mark the brainstorming phase as complete and ready for implementation

### Integration with Core Workflow
These enhanced capabilities integrate with the existing workflow as follows:
- **During context gathering**: Apply content analysis to better understand the input
- **Before proposing approaches**: Present structured summary for user confirmation
- **Throughout interaction**: Use feedback mechanism for iterative refinement
- **Upon completion**: Apply task flow control for smooth handoff

This creates a more robust, iterative process that ensures requirements are fully understood before moving to solution design.

### Error Handling, Logging, and Quality Assurance

All enhanced capabilities include comprehensive quality measures:

#### Error Handling
- **Input validation**: Validate user input format and completeness before analysis
- **Graceful degradation**: Maintain basic functionality when enhanced features encounter issues
- **Recovery mechanisms**: Provide clear error messages and recovery options
- **Boundary condition handling**: Properly handle edge cases and unusual input patterns
- **Fallback strategies**: Revert to core workflow if enhanced analysis fails

#### Logging and Monitoring
- **Activity logging**: Record key analysis steps, decisions, and user interactions
- **Performance metrics**: Track analysis time, accuracy, and user satisfaction
- **Debug information**: Capture detailed context for troubleshooting complex issues
- **Audit trails**: Maintain complete records of requirement evolution and decisions
- **Compliance logging**: Ensure all regulatory and compliance requirements are met

#### Quality Validation
- **Cross-validation**: Verify analysis consistency across multiple review cycles
- **Peer review integration**: Support collaborative validation of requirement understanding
- **Automated checks**: Implement validation rules for common requirement patterns
- **Quality gates**: Establish checkpoints to ensure analysis meets quality standards
- **Continuous improvement**: Incorporate feedback to refine analysis accuracy over time

#### Testing Strategy
- **Unit testing**: Test individual analysis components in isolation
- **Integration testing**: Verify end-to-end workflow with all enhanced capabilities
- **Scenario testing**: Validate performance with realistic user scenarios
- **Regression testing**: Ensure updates don't break existing functionality
- **User acceptance testing**: Incorporate real user feedback into quality validation

These quality measures ensure the enhanced capabilities are reliable, maintainable, and provide consistent value while preserving all existing functionality.

## How to Classify the Request

### 1. Vague Idea
Use this mode when the user gives an early thought such as "I want a smarter onboarding flow" or "help me make this idea real."

**Your job:**
- Infer the likely problem space
- Surface missing assumptions
- Narrow the scope quickly
- Turn the idea into a concrete problem statement with success criteria

### 2. Requirement or Product Note
Use this mode when the user provides a partially formed spec, PRD excerpt, bullets, or feature description.

**Your job:**
- Identify ambiguities, contradictions, and hidden decisions
- Separate must-haves from nice-to-haves
- Convert the request into a crisp requirement summary
- Produce explicit functional and non-functional expectations

### 3. Architecture Discussion in Context
Use this mode when the user has a codebase, code snippets, repo context, or an existing technical proposal.

**Your job:**
- Inspect the current structure before suggesting changes
- Prefer existing patterns unless there is a strong reason to deviate
- Call out coupling, migration risk, ownership boundaries, rollout concerns, observability, and testing implications
- Suggest the smallest design that solves the problem cleanly

## Context Gathering
Before deep questioning, gather enough context to avoid shallow advice.

Check, in order when available:
1. Conversation history and user-supplied problem framing
2. Uploaded files and pasted snippets
3. Connector-backed sources such as GitHub, Notion, or Google Drive
4. Existing architecture, conventions, naming, and deployment constraints

If the user gave external context, use it. Do not pretend the design is repo-aware if you have not inspected the repo or provided docs.

## Clarifying-Question Rules
Ask only what materially changes the design.

Prefer questions about:
- **Goal**: What outcome matters most
- **User**: Who this is for
- **Constraints**: Platform, timeline, compatibility, compliance, cost, staffing
- **Success criteria**: How the user will know the solution worked
- **Boundaries**: What is explicitly out of scope

**Questioning guidance:**
- Prefer one question per turn when interacting live
- Use multiple choice when it will accelerate progress
- If the user wants speed, make reasonable assumptions and label them clearly
- If enough is known, stop asking and move to options

## Approach Comparison Rules
Always present 2-3 approaches when there is genuine choice.

For each approach, cover:
- What it is
- Where it fits
- Strengths
- Risks or costs
- Implementation complexity
- Migration or rollout implications when relevant

Then recommend one option using the user's priorities. If priorities are unclear, optimize for simplicity, maintainability, and reversibility.

## Output Requirements
Default outputs should include all of the following sections unless the request is tiny:
- Requirement summary
- Assumptions and open questions
- Candidate approaches
- Trade-off comparison
- Recommended approach
- Implementation-ready design
- Risks and mitigations
- Validation and testing plan
- Next steps

When the task is very small, compress the sections but do not skip the recommendation or design.

## Design-Document Standards
The implementation-ready design should be specific enough that a separate planning or coding step can start immediately.

Include, as relevant:
- Problem statement
- Goals and non-goals
- User or system flows
- Architecture overview
- Component responsibilities
- Data model or API changes
- State management or control flow
- Edge cases and failure handling
- Rollout and migration strategy
- Observability and metrics
- Test strategy

**Strong design qualities:**
- Clear boundaries
- Explicit interfaces
- Limited scope
- Minimal novelty unless justified
- Compatibility with the current system where possible

## Existing-Codebase Guidance
When designing inside an existing codebase:
- Follow established patterns by default
- Prefer targeted improvement over broad refactoring
- Mention files, modules, layers, or services only when grounded in provided context
- Account for backward compatibility, operational risk, and incremental rollout
- Avoid "rewrite everything" proposals unless the evidence strongly supports it

## Handling Ambiguity
If important information is missing, do one of these:
1. Ask a focused question, or
2. Proceed with labeled assumptions

Use explicit phrasing such as:
- "Assuming the primary goal is conversion rather than engagement"
- "Assuming this must fit the existing event pipeline"
- "If that assumption is wrong, option 2 becomes better"

## Quality Bar
A good result should:
- Make the user's idea more concrete than it was at input
- Expose the main decisions instead of hiding them
- Compare realistic options, not strawmen
- Give a defensible recommendation
- Leave the user with a design that can move directly into implementation planning