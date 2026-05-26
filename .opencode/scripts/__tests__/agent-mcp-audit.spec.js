const fs = require('fs');
const path = require('path');

describe('Agent MCP Audit', () => {
  const agentsDir = path.join(__dirname, '../../agents');
  
  test('Coder-BE should not have GitHub MCP', () => {
    const content = fs.readFileSync(path.join(agentsDir, 'coder-be.md'), 'utf8');
    expect(content).not.toContain('- GitHub');
  });
  
  test('Coder-FE should not have GitHub MCP', () => {
    const content = fs.readFileSync(path.join(agentsDir, 'coder-fe.md'), 'utf8');
    expect(content).not.toContain('- GitHub');
  });
});
