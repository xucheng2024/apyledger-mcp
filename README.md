# APY Ledger MCP server

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants current US CD rates they can check: the highest certificate of deposit and credit union share certificate APYs by term, deposit and state, each with the institution's own rate page and the time it was read, plus the national median CD rate by term.

It is a thin client for the free, keyless [APY Ledger open data](https://apyledger.com/data) (CC BY 4.0). APY Ledger reads every quote from the bank's or credit union's own rate page and re-verifies it as rates change; quotes older than seven days are left out of the downloads.

## Tools

| Tool | What it returns |
| --- | --- |
| `find_best_cd_rates` | Highest current APYs, one per institution, filtered by term (exact or a range of months), deposit, the saver's state and bank vs credit union. Without a state it returns offers open nationwide; with one it adds local banks and credit unions serving that state. Each result has the APY, term, minimum and maximum deposit, offer type, where it can be opened, `verified_at` and the institution's `source_url` |
| `get_institution_cd_rates` | Every current quote at one bank or credit union, by name or slug |
| `get_cd_rate_index` | Median and 90th-percentile APY by exact term for a $10,000 deposit, sample size, bank vs credit union medians, the gap to the Treasury yield, and optional daily history |

Example questions it answers: *"What's the best 12-month CD for $10,000 right now?"*, *"Best 5-year CD from a credit union I can join in Texas?"*, *"What does Marcus pay on CDs today?"*, *"Is 4.2% on a 1-year CD a good rate?"*

Relationship offers (those needing another account) are left out unless you ask for them. Results are information, not financial advice: rates change, and membership, residency and opening requirements apply, so confirm on `source_url` before opening an account.

## Install

Requires Node.js 18 or later.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apyledger": {
      "command": "npx",
      "args": ["-y", "apyledger-mcp"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add apyledger -- npx -y apyledger-mcp
```

### Cursor, Windsurf, VS Code and others

Use the same command, `npx -y apyledger-mcp`, as a stdio server.

## Data

- Source: [apyledger.com/data](https://apyledger.com/data) (`rates.json`, `index.json`), CC BY 4.0. Please keep the attribution that each response carries.
- How quotes are collected and verified: [verification methodology](https://apyledger.com/methodology); how the index is built: [CD rate index](https://apyledger.com/index#methodology).
- Availability (`where`) follows the same rule as APY Ledger's own state filters: nationwide for online or editorially checked institutions, otherwise the states the institution serves. Credit unions still require membership.
- The downloads are cached for five minutes, so the server fetches each file at most once per five minutes.
- Links back to apyledger.com carry `utm_source=mcp` so APY Ledger can count visits that come through the server. Nothing about you or your questions is sent; the server only downloads the public files.

Set `APYLEDGER_URL` to point the server at another deployment of the same data.

## Development

```sh
npm install
npm test
npm run build
```

## Licence

MIT. Data from [APY Ledger](https://apyledger.com), CC BY 4.0.
