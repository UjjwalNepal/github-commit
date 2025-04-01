import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['GITHUB_TOKEN', 'PORT'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} environment variable is required`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize MCP server
const server = new McpServer({
  name: "github-commit-mcp",
  version: "1.0.0"
});

// Helper function to get git status
async function getGitStatus(repoPath: string) {
  try {
    const { stdout: status } = await execAsync('git status --porcelain', { cwd: repoPath });
    const { stdout: diff } = await execAsync('git diff', { cwd: repoPath });
    return { status, diff };
  } catch (error) {
    console.error('Error getting git status:', error);
    throw new Error('Failed to get git status');
  }
}

// Helper function to get current branch
async function getCurrentBranch(repoPath: string) {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd: repoPath });
    return stdout.trim();
  } catch (error) {
    console.error('Error getting current branch:', error);
    throw new Error('Failed to get current branch');
  }
}

// Resource for reading GitHub commits
server.resource(
  "github-commits",
  "github://{owner}/{repo}/commits/{branch?}",
  async (uri, extra) => {
    const owner = (extra as any).owner as string;
    const repo = (extra as any).repo as string;
    const branch = (extra as any).branch as string | undefined;
    
    if (!owner || !repo) {
      throw new Error('Owner and repository parameters are required');
    }
    
    try {
      const { data: commits } = await octokit.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 10
      });

      return {
        contents: commits.map(commit => ({
          uri: uri.href,
          text: `Commit: ${commit.sha}\nAuthor: ${commit.commit.author?.name}\nMessage: ${commit.commit.message}\nDate: ${commit.commit.author?.date}`
        }))
      };
    } catch (error) {
      if (error instanceof Error) {
        console.error('Error fetching commits:', error.message);
        if ('status' in error && error.status === 404) {
          throw new Error(`Repository ${owner}/${repo} not found`);
        }
        if ('status' in error && error.status === 403) {
          throw new Error('Access denied. Please check your GitHub token permissions');
        }
      }
      throw new Error('Failed to fetch commits. Please try again later.');
    }
  }
);

// Resource for reading pull requests
server.resource(
  "github-pulls",
  "github://{owner}/{repo}/pulls",
  async (uri, extra) => {
    const owner = (extra as any).owner as string;
    const repo = (extra as any).repo as string;
    
    if (!owner || !repo) {
      throw new Error('Owner and repository parameters are required');
    }
    
    try {
      const { data: pulls } = await octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc'
      });

      return {
        contents: pulls.map(pr => ({
          uri: uri.href,
          text: `PR #${pr.number}: ${pr.title}\nAuthor: ${pr.user?.login}\nStatus: ${pr.state}\nCreated: ${pr.created_at}\nUpdated: ${pr.updated_at}`
        }))
      };
    } catch (error) {
      console.error('Error fetching pull requests:', error);
      throw new Error('Failed to fetch pull requests');
    }
  }
);

// Tool for generating commit messages
server.tool(
  "generate-commit-message",
  "Generate a commit message based on changes and optional context",
  async (extra) => {
    try {
      const params = extra as unknown as { 
        changes?: string;
        context?: string;
        repoPath?: string;
      };
      
      let changes = params.changes;
      
      // If no changes provided, try to get them from git
      if (!changes && params.repoPath) {
        const { status, diff } = await getGitStatus(params.repoPath);
        changes = `Git Status:\n${status}\n\nDiff:\n${diff}`;
      }

      if (!changes) {
        throw new Error('Changes parameter is required or repo path must be provided');
      }

      return {
        content: [{
          type: "text",
          text: `Please generate a clear and descriptive commit message for the following changes:\n\n${changes}\n\n${params.context ? `Additional context:\n${params.context}` : ''}`
        }]
      };
    } catch (error) {
      console.error('Error generating commit message:', error);
      throw new Error('Failed to generate commit message. Please try again.');
    }
  }
);

// Tool for merging pull requests
server.tool(
  "merge-pull-request",
  "Merge a GitHub pull request",
  async (extra) => {
    try {
      const params = extra as unknown as {
        owner: string;
        repo: string;
        pullNumber: number;
        mergeMethod?: 'merge' | 'squash' | 'rebase';
        commitMessage?: string;
      };

      if (!params.owner || !params.repo || !params.pullNumber) {
        throw new Error('Owner, repo, and pull request number are required');
      }

      const { data: mergeResult } = await octokit.pulls.merge({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pullNumber,
        merge_method: params.mergeMethod || 'merge',
        commit_message: params.commitMessage
      });

      return {
        content: [{
          type: "text",
          text: `Pull request #${params.pullNumber} merged successfully.\nMerge SHA: ${mergeResult.sha}\nMessage: ${mergeResult.message}`
        }]
      };
    } catch (error) {
      console.error('Error merging pull request:', error);
      throw new Error('Failed to merge pull request');
    }
  }
);

// Tool for creating pull requests
server.tool(
  "create-pull-request",
  "Create a new GitHub pull request",
  async (extra) => {
    try {
      const params = extra as unknown as {
        owner: string;
        repo: string;
        title: string;
        body?: string;
        head: string;
        base: string;
      };

      if (!params.owner || !params.repo || !params.title || !params.head || !params.base) {
        throw new Error('Owner, repo, title, head branch, and base branch are required');
      }

      const { data: pr } = await octokit.pulls.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base
      });

      return {
        content: [{
          type: "text",
          text: `Pull request created successfully.\nNumber: #${pr.number}\nURL: ${pr.html_url}`
        }]
      };
    } catch (error) {
      console.error('Error creating pull request:', error);
      throw new Error('Failed to create pull request');
    }
  }
);

// Tool for committing changes
server.tool(
  "commit-changes",
  "Commit changes to the repository",
  async (extra) => {
    try {
      const params = extra as unknown as {
        repoPath: string;
        message: string;
        files?: string[];
      };

      if (!params.repoPath || !params.message) {
        throw new Error('Repository path and commit message are required');
      }

      // Add files
      if (params.files && params.files.length > 0) {
        await execAsync(`git add ${params.files.join(' ')}`, { cwd: params.repoPath });
      } else {
        await execAsync('git add .', { cwd: params.repoPath });
      }

      // Commit changes
      await execAsync(`git commit -m "${params.message}"`, { cwd: params.repoPath });

      const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: params.repoPath });

      return {
        content: [{
          type: "text",
          text: `Changes committed successfully.\nCommit Hash: ${commitHash.trim()}`
        }]
      };
    } catch (error) {
      console.error('Error committing changes:', error);
      throw new Error('Failed to commit changes');
    }
  }
);

// Store active transports
const transports: { [sessionId: string]: SSEServerTransport } = {};

const app = express();

// Handle SSE connections
app.get('/sse', async (_: Request, res: Response) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  
  res.on('close', () => {
    delete transports[transport.sessionId];
  });
  
  await server.connect(transport);
});

// Handle client messages
app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).send('Internal Server Error');
});

async function shutdown(exitCode: number = 0) {
  console.log('\nShutting down gracefully...');
  try {
    // Close all active transports
    await Promise.all(
      Object.values(transports).map(transport => 
        new Promise<void>(resolve => {
          transport.close();
          resolve();
        })
      )
    );
    console.log('All transports closed successfully');
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    process.exit(exitCode);
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal');
  shutdown(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT signal');
  shutdown(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown(1);
});

async function main() {
  try {
    console.log('Starting GitHub Commit MCP Server...');
    
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log(`SSE endpoint available at http://localhost:${PORT}/sse`);
      console.log(`Message endpoint available at http://localhost:${PORT}/messages`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    await shutdown(1);
  }
}

main(); 