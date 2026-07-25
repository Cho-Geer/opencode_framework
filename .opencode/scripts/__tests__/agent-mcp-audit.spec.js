const fs = require('fs');
const path = require('path');

describe('Agent MCP Audit', () => {
  const agentsDir = path.join(__dirname, '../../agents');

  test('Coder-BE should not have GitHub MCP', () => {
    const agentPath = path.join(agentsDir, 'coder-be.md');
    // Legacy agent removed in current 5-agent architecture; skip if absent.
    if (!fs.existsSync(agentPath)) {
      return;
    }
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).not.toContain('- GitHub');
  });

  test('Coder-FE should not have GitHub MCP', () => {
    const agentPath = path.join(agentsDir, 'coder-fe.md');
    // Legacy agent removed in current 5-agent architecture; skip if absent.
    if (!fs.existsSync(agentPath)) {
      return;
    }
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).not.toContain('- GitHub');
  });
});
