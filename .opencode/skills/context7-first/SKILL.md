---
name: "context7-first"
description: "Forces the model to call context7 MCP tool before any investigation, design, coding, debugging, or architecture tasks to get latest tech stack documentation and context. Invoke when user asks about technology stack usage, code development, debugging, architecture design, or dependency management."
---

# context7-first Skill

## Description
Forces the model to call the context7 MCP tool before executing any investigation, design, coding, debugging, or architecture tasks to obtain the latest technology stack documentation and context. This ensures outputs are based on the latest versions of libraries and frameworks, not outdated training data.

## Trigger Conditions
Applies to any tasks involving technology stack usage, including but not limited to:
- Code development and debugging
- Architecture design and evaluation
- Technical documentation writing
- Dependency management and version control

## Execution Flow
1. Before starting a task, automatically call the context7 MCP tool
2. Obtain the latest technology stack documentation and context information
3. Execute the task based on the acquired information
4. Ensure output results comply with the latest technical standards

## Core Functions
- Ensures technical decisions are based on the latest library and framework versions
- Avoids technical bias caused by outdated training data
- Provides accurate technology stack usage guidance
- Supports documentation acquisition for multiple technology stacks

## Applicable Scenarios
- New project initialization and technology selection
- Technology upgrade and migration of existing projects
- Diagnosis and resolution of technical problems
- Design and evaluation of technical solutions