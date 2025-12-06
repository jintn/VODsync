import express from "express";
import dotenv from "dotenv";

dotenv.config({ path: process.env.LOGTIME_ENV ?? ".env" });

const { WCL_CLIENT_ID, WCL_CLIENT_SECRET } = process.env;

if (!WCL_CLIENT_ID || !WCL_CLIENT_SECRET) {
  console.warn(
    "[logtime] Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET. GraphQL requests will fail until they are set.",
  );
}

const OAUTH_URL = "https://www.warcraftlogs.com/oauth/token";
const GRAPHQL_URL = "https://www.warcraftlogs.com/api/v2/client";

const app = express();
app.use(express.json());

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 10_000) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(`${WCL_CLIENT_ID}:${WCL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to obtain access token: ${response.status} ${text}`);
  }

  const data = await response.json();
  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + data.expires_in * 1000;
  return tokenCache.accessToken;
}

const REPORT_QUERY = `
  query ReportFights($code: String!) {
    reportData {
      report(code: $code) {
        title
        zone { id name }
        owner { name }
        masterData {
          actors {
            id
            name
            type
            subType
          }
        }
        fights {
          id
          name
          encounterID
          startTime
          endTime
          kill
          bossPercentage
          fightPercentage
          lastPhase
          lastPhaseIsIntermission
          phaseTransitions {
            id
            startTime
          }
        }
        phases {
          encounterID
          separatesWipes
          phases {
            id
            name
            isIntermission
          }
        }
      }
    }
  }
`;

const DEATH_EVENTS_QUERY = `
  query DeathEvents($code: String!, $fightIDs: [Int!]!) {
    reportData {
      report(code: $code) {
        events(dataType: Deaths, fightIDs: $fightIDs, translate: true) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

const BLOODLUST_ABILITY_IDS = [2825, 32182, 80353, 90355, 178207, 204361, 264667];
const BLOODLUST_FILTER = `ability.id IN (${BLOODLUST_ABILITY_IDS.join(", ")})`;

const BLOODLUST_EVENTS_QUERY = `
  query BloodlustEvents($code: String!, $fightIDs: [Int!]!) {
    reportData {
      report(code: $code) {
        events(
          dataType: Casts
          fightIDs: $fightIDs
          translate: true
          filterExpression: "${BLOODLUST_FILTER}"
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

async function fetchReport(reportId) {
  const token = await getAccessToken();
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: REPORT_QUERY,
      variables: { code: reportId },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const message = payload.errors.map((err) => err.message).join("; ");
    throw new Error(`GraphQL error: ${message}`);
  }

  const report = payload.data?.reportData?.report;
  if (!report) {
    throw new Error("Report not found or inaccessible.");
  }

  const fights = report.fights ?? [];
  const bossFightIDs = fights.filter((fight) => (fight.encounterID ?? 0) > 0).map((fight) => fight.id);
  const actors = report.masterData?.actors ?? [];
  const actorMap = new Map();
  for (const actor of actors) {
    if (typeof actor?.id === "number") {
      actorMap.set(actor.id, actor);
    }
  }
  const deathMap = await fetchDeathEvents(reportId, token, bossFightIDs, actorMap);
  const bloodlustMap = await fetchBloodlustEvents(reportId, token, bossFightIDs, actorMap);

  const phaseMetadata = buildPhaseMetadata(report.phases ?? []);
  const enrichedFights = fights.map((fight) => ({
    ...fight,
    deaths: deathMap.get(fight.id) ?? [],
    bloodlusts: bloodlustMap.get(fight.id) ?? [],
    phaseMetadata: serializePhaseMetadata(phaseMetadata.get(fight.encounterID ?? null)),
  }));

  const simplifiedActors = actors.map((actor) => ({
    id: actor?.id ?? null,
    name: actor?.name ?? null,
    type: actor?.type ?? null,
    subType: actor?.subType ?? null,
  }));

  return {
    title: report.title ?? null,
    owner: report.owner?.name ?? null,
    zone: report.zone ?? null,
    fights: enrichedFights,
    actors: simplifiedActors,
  };
}

async function fetchDeathEvents(reportId, token, fightIDs, actorMap) {
  if (!fightIDs.length) {
    return new Map();
  }
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: DEATH_EVENTS_QUERY,
      variables: { code: reportId, fightIDs },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Death events request failed: ${response.status} ${text}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    const message = payload.errors.map((err) => err.message).join("; ");
    throw new Error(`Death events error: ${message}`);
  }
  const events = payload.data?.reportData?.report?.events?.data ?? [];
  const byFight = new Map();
  for (const event of events) {
    const fightId = event.fightID ?? event.fight ?? null;
    if (!fightId) continue;
    let resolvedName = event?.target?.name;
    if (!resolvedName) {
      const actorId = event?.targetID ?? event?.target?.id ?? null;
      const actor = actorId != null ? actorMap.get(actorId) : null;
      resolvedName = actor?.name || event?.target?.guid || "Unknown";
    }
    if (!event.target) {
      event.target = {};
    }
    event.target.name = resolvedName || "Unknown";
    if (!byFight.has(fightId)) {
      byFight.set(fightId, []);
    }
    byFight.get(fightId).push(event);
  }
  return byFight;
}

async function fetchBloodlustEvents(reportId, token, fightIDs, actorMap) {
  if (!fightIDs.length) {
    return new Map();
  }
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: BLOODLUST_EVENTS_QUERY,
      variables: { code: reportId, fightIDs },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bloodlust events request failed: ${response.status} ${text}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    const message = payload.errors.map((err) => err.message).join("; ");
    throw new Error(`Bloodlust events error: ${message}`);
  }
  const events = payload.data?.reportData?.report?.events?.data ?? [];
  const byFight = new Map();
  for (const event of events) {
    const fightId = event.fightID ?? event.fight ?? null;
    if (!fightId || typeof event.timestamp !== "number") continue;
    const sourceId = event?.sourceID ?? event?.source?.id ?? null;
    const actor = sourceId != null ? actorMap.get(sourceId) : null;
    const sourceName = event?.source?.name || actor?.name || event?.source?.guid || "Unknown";
    const abilityName = event?.ability?.name || "Bloodlust";
    if (!byFight.has(fightId)) {
      byFight.set(fightId, []);
    }
    byFight.get(fightId).push({
      timestamp: event.timestamp,
      source: { name: sourceName },
      ability: { name: abilityName },
    });
  }
  return byFight;
}

function buildPhaseMetadata(phasesList) {
  const map = new Map();
  phasesList.forEach((entry) => {
    if (!entry || typeof entry.encounterID !== "number") return;
    const phaseMap = new Map();
    (entry.phases ?? []).forEach((phase) => {
      if (!phase || typeof phase.id !== "number") return;
      phaseMap.set(phase.id, {
        id: phase.id,
        name: phase.name ?? null,
        isIntermission: Boolean(phase.isIntermission),
      });
    });
    map.set(entry.encounterID, phaseMap);
  });
  return map;
}

function serializePhaseMetadata(metadata) {
  if (!metadata) return undefined;
  const result = {};
  metadata.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

app.post("/api/report", async (req, res) => {
  const reportId = (req.body?.reportId || "").trim();
  if (!reportId) {
    return res.status(400).json({ error: "reportId is required." });
  }
  if (!WCL_CLIENT_ID || !WCL_CLIENT_SECRET) {
    return res.status(500).json({ error: "Server missing WCL OAuth credentials." });
  }

  try {
    const data = await fetchReport(reportId);
    res.json(data);
  } catch (error) {
    console.error("[logtime] /api/report error:", error);
    res.status(500).json({ error: error.message || "Unexpected server error." });
  }
});

const port = Number(process.env.SERVER_PORT || 4000);
app.listen(port, () => {
  console.log(`[logtime] API server listening on http://localhost:${port}`);
});
