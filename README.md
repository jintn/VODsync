# Logtime Companion

Tools for turning Warcraft Logs data into VOD timestamps and an interactive review experience.

## Web Companion App (Vite + React + Tailwind)

1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and fill in your Warcraft Logs **client credentials** (`WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`). Create these under *Applications → Client Credentials* on warcraftlogs.com.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the local API proxy (GraphQL + OAuth client credentials):

   ```bash
   npm run server
   ```

   This uses your credentials to obtain OAuth tokens and proxy the GraphQL v2 request.

5. In a separate terminal, start the Vite dev server:

   ```bash
   npm run dev
   ```

6. Open the printed URL (defaults to http://localhost:5173).

### Using the UI

- **Report ID**: The string in your Warcraft Logs URL (`/reports/<ID>`).
- **First Pull Timestamp**: Where the first boss pull appears in your VOD (`HH:MM:SS`).
- **Video URL**: A YouTube link (watch, live, shorts, youtu.be) or a direct `.mp4/.webm` URL.

Hit **Load Report** and the page will:

- Embed your VOD in a large player on the left (YouTube iframe or native `<video>` for direct files).
- Group wipes under each boss and show every pull as a small square tile labeled “Wipe #” (or “Kill”) with duration and progress. Clicking a tile jumps the player to that pull.
- Provide a **Copy timestamps** shortcut that mirrors the CLI’s output for YouTube descriptions.

Long breaks are preserved because timestamps are derived from the absolute fight start times recorded in the log, not from list position.

## CLI Timestamp Generator

Create a ready-to-paste list of timestamps for YouTube descriptions:

```bash
python logtime.py <REPORT_ID> <API_KEY> <HH:MM:SS_OF_FIRST_PULL>
```

Example:

```bash
python logtime.py abc123XYZ sk_test_12345 00:08:51
```

The script prints lines such as `00:12:34 - Boss Name - Pull #2 - (Wipe)`. These can be pasted in your YouTube description (remember to start the list with `00:00:00 – Intro` if you want clickable chapters).
