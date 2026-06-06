# OpenCode Policies Documentation
Source: https://opencode.ai/docs/policies/
Fetched: 2026-06-05
Tool: webfetch

## Overview
Policies control whether OpenCode may perform an action on a named resource. This feature is **experimental** and configured with the `experimental.policies` array in `opencode.json`.

Policies are separate from permissions. Permissions control what tools can do during a session, while policies control whether OpenCode may use a resource such as an LLM provider.

## Configuration
Each policy statement has:
- `effect`: Either `"allow"` or `"deny"`
- `action`: The operation being controlled
- `resource`: The resource ID or wildcard pattern

### Example: Deny OpenAI Provider
```json
{
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "openai"
      }
    ]
  }
}
```

A provider denied by policy is not available for model selection or model use, even if configured correctly.

## Available Policies
OpenCode currently supports one policy action:

| Action | Resource | Description |
|--------|----------|-------------|
| `provider.use` | Provider ID (e.g., `openai`) | Allow or deny use of an LLM provider |

More policy actions may be added in the future.

## Matching
Resource field supports wildcard matching:
- `*` matches zero or more characters
- `?` matches one character

```json
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "company-*" }
    ]
  }
}
```

## Rule Order
Last matching statement wins. Put broad rules first, then specific exceptions.

### Allow Only Anthropic Example
```json
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" }
    ]
  }
}
```

If no policy matches, provider use is allowed by default.

### Global vs Project Policies
Policies may be set in both global and project config. If both match the same provider, **global policy takes priority** — prevents a repository from re-enabling a provider denied globally.

## Provider Lists (Replacement)
Use policies instead of older `disabled_providers` and `enabled_providers` settings:

### Replace disabled_providers
```json
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "deny", "action": "provider.use", "resource": "google" }
    ]
  }
}
```

### Replace enabled_providers
```json
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "openai" }
    ]
  }
}
```
