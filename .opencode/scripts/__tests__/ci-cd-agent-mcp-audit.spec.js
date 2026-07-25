const fs = require('fs');
const path = require('path');

describe('CI-CD-Agent MCP Audit', () => {
  test('CI-CD-Agent should not have GitHub MCP', () => {
    const agentPath = path.join(__dirname, '../../agents/CI-CD-Agent.md');
    // Legacy agent removed in current 5-agent architecture; skip if absent.
    if (!fs.existsSync(agentPath)) {
      return;
    }
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).not.toContain('- GitHub');
  });
});
