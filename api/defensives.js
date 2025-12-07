import { handleDefensivesRequest } from "../server/app.mjs";

export default function handler(req, res) {
  return handleDefensivesRequest(req, res);
}
