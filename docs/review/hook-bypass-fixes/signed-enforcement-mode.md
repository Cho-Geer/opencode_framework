# Signed Enforcement Mode — FIX-014

**Version**: 1.0.0  
**Created**: 2026-06-21  
**Author**: @Super-Admin  
**Status**: Design proposal — lower priority after P0/P1 runtime guards  
**Priority**: P2  
**Reference**: `docs/review/framework-refactor/pre-commit-hook-bypass-root-cause.md` § FIX-014

---

## §1 Problem Statement

Currently, enforcement mode changes (`advisory` ↔ `strict` ↔ `locked`) in `project.config.json` are protected by:

1. **OpenCode write path**: `json-validate.ts` blocks downgrades through `safe_edit`
2. **Environment override**: `ENFORCEMENT_MODE=advisory` can silently downgrade strict mode
3. **Raw Git path**: A committed change to `project.config.json` can downgrade the mode with a simple commit

The gap: a malicious or careless actor with repository write access could change the enforcement mode via a direct Git commit (bypassing OpenCode), and there is no cryptographic signature to detect tampering.

---

## §2 Proposed Solution: Signed Configuration

### §2.1 Concept

Add a cryptographic signature to `project.config.json` that validates:

1. The enforcement mode was set by an authorized agent
2. The configuration has not been tampered with since signing

### §2.2 Signature Format

```json
{
  "template_resolution": {
    "develop_enforcement_mode": "strict",
    "runtime_enforcement_mode": "strict",
    "enforcement_config": { ... },
    "enforcement_signature": {
      "algorithm": "ed25519",
      "public_key": "base64-encoded-public-key",
      "signature": "base64-encoded-signature",
      "signed_by": "@Arbiter",
      "signed_at": "2026-06-21T12:00:00Z",
      "signed_fields": [
        "develop_enforcement_mode",
        "runtime_enforcement_mode",
        "enforcement_config.locked.allow_downgrade",
        "enforcement_config.locked.allow_waivers"
      ]
    }
  }
}
```

### §2.3 Validation Points

| Check Point              | Validation                                          |
| ------------------------ | --------------------------------------------------- |
| Pre-commit hook          | Verify signature before allowing mode change commit |
| CI/remote                | Verify signature matches expected public key        |
| `framework-self-test.ts` | New check: enforcement signature validity           |
| `framework-doctor.ts`    | New check: enforcement signature freshness          |

### §2.4 Key Management

| Key                            | Storage                                  | Access                  |
| ------------------------------ | ---------------------------------------- | ----------------------- |
| @Arbiter signing key (private) | Secure vault / hardware token            | @Arbiter only           |
| Verification key (public)      | `.opencode/state/enforcement-pubkey.pem` | All hooks and CI        |
| Key rotation procedure         | Defined in incident response plan        | @Arbiter + @Super-Admin |

---

## §3 Alternative: Arbiter-Approved Unlock Workflow

If cryptographic signing is too complex for immediate implementation, an alternative workflow-based approach:

### §3.1 Unlock Token

When a legitimate mode downgrade is needed (e.g., emergency framework repair), @Arbiter generates an unlock token:

```
Unlock-Token: sha256:<hash-of-(timestamp+reason+arbiter-id+secret)>
Approved-By: @Arbiter
Reason: Emergency framework repair — incident INC-2026-042
Valid-Until: 2026-06-21T18:00:00Z
```

### §3.2 Validation

1. The unlock token is included in the commit message body
2. Pre-commit hook, CI, and pre-receive (if configured) verify:
   - Token format is valid
   - Token has not expired (`Valid-Until` in the future)
   - Token hash matches the expected hash (computed from the shared secret)
3. The token is single-use — recorded in `.opencode/state/unlock-tokens-used.json`

### §3.3 Token Generation Script

```bash
#!/bin/bash
# generate-unlock-token.sh — @Arbiter only
# Usage: ./generate-unlock-token.sh "<reason>" <validity_hours>

REASON="$1"
VALIDITY_HOURS="${2:-1}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXPIRY=$(date -u -d "+${VALIDITY_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)
SECRET="${ARBITER_SECRET:-$(cat .opencode/state/arbiter-secret.key)}"

TOKEN_INPUT="${TIMESTAMP}:${REASON}:@Arbiter:${SECRET}"
TOKEN_HASH=$(echo -n "$TOKEN_INPUT" | sha256sum | cut -d' ' -f1)

echo "Unlock-Token: sha256:${TOKEN_HASH}"
echo "Approved-By: @Arbiter"
echo "Reason: ${REASON}"
echo "Valid-Until: ${EXPIRY}"
echo ""
echo "# Include the above in your commit message body"
```

---

## §4 Implementation Priority

| Component                     | Effort | Priority                    |
| ----------------------------- | ------ | --------------------------- |
| Enforcement signature schema  | Small  | P2                          |
| Key management infrastructure | Large  | P2                          |
| Signature validation in hooks | Medium | P2                          |
| Workflow-based unlock token   | Medium | P2 (recommended first step) |
| Token validation in CI        | Small  | P2                          |
| Token single-use tracking     | Small  | P2                          |

---

## §5 Acceptance Criteria

| Test                                                 | Expected Result                         |
| ---------------------------------------------------- | --------------------------------------- |
| Mode downgrade commit without signature/unlock token | Pre-commit + CI reject                  |
| Mode downgrade commit with valid unlock token        | Pre-commit + CI accept                  |
| Mode downgrade commit with expired unlock token      | Pre-commit + CI reject                  |
| Reuse of consumed unlock token                       | Pre-commit + CI reject                  |
| Mode upgrade (advisory → strict) without signature   | Accept (upgrades don't require signing) |
