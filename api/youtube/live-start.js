import { handleYoutubeLiveStartRequest } from "../../server/app.mjs";

export default function handler(req, res) {
  return handleYoutubeLiveStartRequest(req, res);
}
