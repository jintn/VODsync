import { handleReportRequest } from "../server/app.mjs";

export default function handler(req, res) {
  return handleReportRequest(req, res);
}
