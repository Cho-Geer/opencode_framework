const fs = require('fs');
const path = require('path');

describe('CI-CD-Agent MCP Audit', () => {
  test('CI-CD-Agent should not have GitHub MCP', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../agents/ci-cd-agent.md'), 
      'utf8'
    );
    expect(content).not.toContain('- GitHub');
  });
});
