import { createApp } from "../server/app.mjs";

const app = createApp();

export default function handler(req, res) {
  return app(req, res);
}
