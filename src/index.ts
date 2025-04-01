import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize MCP server
const server = new McpServer({
  name: "github-commit-mcp",
  version: "1.0.0"
});

// Resource for reading GitHub commits
server.resource(
  "github-commits",
  "github://{owner}/{repo}/commits",
  async (uri, extra) => {
    const owner = (extra as any).owner as string;
    const repo = (extra as any).repo as string;
    
    try {
      const { data: commits } = await octokit.repos.listCommits({
        owner,
        repo,
        per_page: 10 // Limit to last 10 commits
      });

      return {
        contents: commits.map(commit => ({
          uri: uri.href,
          text: `Commit: ${commit.sha}\nAuthor: ${commit.commit.author?.name}\nMessage: ${commit.commit.message}\nDate: ${commit.commit.author?.date}`
        }))
      };
    } catch (error) {
      console.error('Error fetching commits:', error);
      throw error;
    }
  }
);

// Tool for generating commit messages
server.tool(
  "generate-commit-message",
  {
    changes: z.string(),
    context: z.string().optional()
  },
  async ({ changes, context }) => {
    // This will be enhanced with MCP's LLM capabilities
    return {
      content: [{
        type: "text",
        text: `Please generate a clear and descriptive commit message for the following changes:\n\n${changes}\n\n${context ? `Additional context:\n${context}` : ''}`
      }]
    };
  }
);

// Prompt for commit message generation
server.prompt(
  "commit-message",
  {
    changes: z.string(),
    context: z.string().optional()
  },
  ({ changes, context }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please generate a clear and descriptive commit message for the following changes:\n\n${changes}\n\n${context ? `Additional context:\n${context}` : ''}`
      }
    }]
  })
);

async function main() {
  try {
    console.log('Starting GitHub Commit MCP Server...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Server is ready to handle requests');
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

main(); 