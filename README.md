# Logtime Companion

Tools for turning Warcraft Logs data into VOD timestamps and an interactive review experience.

## Web Companion App

| Tech | Details |
| ---- | ------- |
| Framework | Vite + React + TypeScript |
| Styling | Tailwind CSS |
| Backend | Minimal Express proxy that handles OAuth + Warcraft Logs GraphQL |

### Prerequisites
- Node.js 18+
- Warcraft Logs API application (Client ID/Secret)

### Quick Start
1. **Install deps**
   ```bash
   npm install
   ```
2. **Configure env**
   ```bash
   cp .env.example .env
   # fill WCL_CLIENT_ID / WCL_CLIENT_SECRET
   ```
3. **Run servers**
   ```bash
   npm run server   # OAuth + GraphQL proxy
   npm run dev      # Vite dev server
   ```
4. Visit `http://localhost:5173`.

### Workflow in the UI
1. **Report ID** – Paste the Warcraft Logs report code (`/reports/<ID>`).
2. **Videos list** – Add one row per POV or recording:
   - **Video URL** – YouTube (watch/live/shorts/youtu.be) or direct `.mp4/.webm`.
   - **Label** – Optional name (e.g., “Tank POV”, “Healer”); class colors auto-detected when matching a character name in the log.
   - **First Pull Timestamp** – The timestamp *inside that clip* where the report’s first pull appears (`HH:MM:SS`). Each clip can start at a different offset; the app stitches them into one continuous global clock.
3. Click **Load Report** to fetch pulls and sync the videos.

### What You Get
- **Multi-POV video player** – Swap POVs at any time; the player computes the correct offset so you land on the identical fight moment regardless of clip start times.
- **Boss timeline** – Every pull rendered as a tile (wipe or kill) with phase info, duration, and visual progress.
- **Interactive timeline** – Jump around pulls, see phase markers, deaths, and bloodlust casts directly on the scrubber.
- **Clipboard helper** – Copy formatted timestamps that match the CLI output.
- **Live refresh** – Optional “Live mode” re-fetches the report every 45 seconds.

### Deploy / Build
```bash
npm run build   # production assets in dist/
```
Serve the `dist/` folder behind any static host (Vercel, Netlify, S3, etc.) and run the Express proxy wherever you keep your API credentials.

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
