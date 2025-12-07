import { createApp } from "../server/app.mjs";

const app = createApp();

export default function handler(req, res) {
  // Ensure Express sees the path without the /api prefix
  if (req.url.startsWith("/api")) {
    req.url = req.url.slice(4) || "/";
  }
  return app(req, res);
}
