import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testServer() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);
    console.log('Connected to MCP server');

    // Test generating a commit message
    console.log('\nTesting commit message generation...');
    try {
      const result = await client.callTool('generate-commit-message', {
        changes: 'Added user authentication with OAuth2, implemented login/logout flows, and added session management',
        context: 'This is part of the user authentication system upgrade'
      }, undefined, { timeout: 30000 }); // 30 second timeout
      console.log('Generated commit message:', result);
    } catch (error) {
      console.error('Error generating commit message:', error.message);
    }

    // Test reading GitHub commits
    console.log('\nTesting GitHub commits reading...');
    try {
      // First, list available resources to confirm the GitHub commits resource
      const resources = await client.listResources({}, { timeout: 10000 });
      console.log('Available resources:', resources);

      // Try reading commits with proper owner/repo
      const commits = await client.readResource('github://ujjwalnepal/wecan/commits', { timeout: 10000 });
      console.log('Recent commits:', JSON.stringify(commits, null, 2));
    } catch (error) {
      console.error('Error reading GitHub commits:', error.message);
    }

  } catch (error) {
    console.error('Connection error:', error.message);
  } finally {
    try {
      await client.close();
      console.log('\nDisconnected from server');
    } catch (error) {
      console.error('Error disconnecting:', error.message);
    }
  }
}

console.log('Starting MCP server test...');
testServer();