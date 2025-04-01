# GitHub Commit MCP Server for Cursor

This MCP server helps generate commit messages by analyzing your code changes using GitHub's API.

## Setup in Cursor

1. Clone this repository to your local machine
2. Create a `.env` file in the root directory with your GitHub credentials:
   ```
   GITHUB_TOKEN=your_github_token_here
   GITHUB_OWNER=your_github_username
   GITHUB_REPO=your_repo_name
   ```
   To get your GitHub token:
   1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
   2. Generate a new token with `repo` scope
   3. Copy the token and paste it in your `.env` file

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. In Cursor:
   - Open Command Palette (Cmd/Ctrl + Shift + P)
   - Type "MCP: Add Server"
   - Select this project's directory
   - The server will be added to Cursor's MCP servers

## Usage

1. Make your code changes in Cursor
2. Open Command Palette
3. Type "MCP: Generate Commit Message"
4. The server will analyze your changes and generate a commit message

## Features

- Analyzes code changes using GitHub's API
- Generates descriptive commit messages
- Integrates seamlessly with Cursor's MCP system
- Supports both single and batch commits

## Development

To run the server in development mode:
```bash
npm run dev
```

## License

ISC 