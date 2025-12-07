import { extractReportId, type ReportMeta } from "./logtime";

export interface DefensiveAbilityUsage {
  id: number | null;
  name: string;
  icon: string | null;
  uses: number;
  possible: number;
}

export interface DefensivePlayerUsage {
  id: number | null;
  name: string;
  className: string | null;
  specName: string | null;
  role?: string | null;
  totalUses: number;
  maxPossibleUses: number;
  abilities: DefensiveAbilityUsage[];
}

export interface DefensiveFightSummary {
  id: number | null;
  name: string;
  encounterID: number | null;
  kill: boolean;
  duration: number | null;
}

export interface DefensiveUsageResponse {
  report: ReportMeta | null;
  fights: DefensiveFightSummary[];
  players: DefensivePlayerUsage[];
  abilities: DefensiveAbilityUsage[];
}

export async function fetchDefensiveUsage(
  reportIdOrUrl: string,
): Promise<DefensiveUsageResponse> {
  const reportId = extractReportId(reportIdOrUrl);
  const response = await fetch("/api/defensives", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to load defensive usage (${response.status} ${response.statusText}): ${text || "No details"}`,
    );
  }

  const payload = (await response.json()) as DefensiveUsageResponse;
  if (!Array.isArray(payload.abilities)) {
    payload.abilities = [];
  }
  return payload;
}
