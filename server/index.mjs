import { createApp } from "./app.mjs";

const app = createApp();
const port = Number(process.env.SERVER_PORT || 4000);
app.listen(port, () => {
  console.log(`[logtime] API server listening on http://localhost:${port}`);
});
