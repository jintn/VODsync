import express from "express";
import dotenv from "dotenv";

dotenv.config({ path: process.env.LOGTIME_ENV ?? ".env" });

const WCL_CLIENT_ID = process.env.WCL_CLIENT_ID ?? process.env.wcl_client_id ?? null;
const WCL_CLIENT_SECRET = process.env.WCL_CLIENT_SECRET ?? process.env.wcl_client_secret ?? null;
const WOW_CLIENT_ID = process.env.WOW_CLIENT_ID ?? process.env.wow_CID ?? process.env.wow_client_id ?? null;
const WOW_CLIENT_SECRET =
  process.env.WOW_CLIENT_SECRET ?? process.env.wow_secret ?? process.env.wow_client_secret ?? null;
const WOW_REGION = process.env.WOW_REGION ?? process.env.wow_region ?? "us";
const WOW_LOCALE = process.env.WOW_LOCALE ?? process.env.wow_locale ?? "en_US";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? process.env.youtube_api_key ?? null;

if (!WCL_CLIENT_ID || !WCL_CLIENT_SECRET) {
  console.warn(
    "[logtime] Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET. GraphQL requests will fail until they are set.",
  );
}

const OAUTH_URL = "https://www.warcraftlogs.com/oauth/token";
const GRAPHQL_URL = "https://www.warcraftlogs.com/api/v2/client";

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

const wowTokenCache = {
  accessToken: null,
  expiresAt: 0,
};

let abilityIconCache = null;
const itemIconCache = new Map();
const youtubeLiveStartCache = new Map();

const rawAllowedOrigins =
  process.env.LOGTIME_ALLOWED_ORIGINS ??
  process.env.logtime_allowed_origins ??
  process.env.ALLOWED_ORIGINS ??
  process.env.allowed_origins ??
  "";
const allowedOriginSet = new Set(
  rawAllowedOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
);
const allowAllOrigins = allowedOriginSet.size === 0;
const devOriginPrefixes = [
  "http://localhost",
  "https://localhost",
  "http://127.0.0.1",
  "https://127.0.0.1",
  "http://[::1]",
  "https://[::1]",
];

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

async function callGraphQL(token, query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
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

  return payload.data;
}

const REPORT_QUERY = `
  query ReportFights($code: String!) {
    reportData {
      report(code: $code) {
        startTime
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

const BLOODLUST_ABILITY_IDS = [2825, 32182, 80353, 90355, 178207, 204361, 264667, 390386];
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

const DEFENSIVE_ABILITY_IDS = [
  48743, 49039, 48792, 51052, 48707, 49998, 196718, 196555, 198589, 319454, 108238, 22812,
  22842, 5487, 61336, 374227, 363916, 374348, 360827, 186265, 109304, 264735, 272679,
  414658, 45438, 55342, 110960, 414660, 342245, 342247, 235450, 235313, 235219, 11426,
  115203, 122783, 122470, 471195, 633, 1022, 642, 6940, 498, 403876, 184662, 108968, 15286,
  19236, 586, 47585, 5277, 31224, 185311, 1966, 198103, 108271, 108281, 108270, 104773,
  108416, 452930, 6789, 234153, 383762, 97462, 202168, 23920, 386208, 118038, 190456,
  184364, 6262, 431416, 1238009,
];
const DEFENSIVE_FILTER = `ability.id IN (${DEFENSIVE_ABILITY_IDS.join(", ")})`;

const DEFENSIVE_TABLE_QUERY = `
  query DefensiveUsage($code: String!, $fightIDs: [Int!]!) {
    reportData {
      report(code: $code) {
        table(
          dataType: Casts
          viewBy: Source
          fightIDs: $fightIDs
          translate: true
          filterExpression: "${DEFENSIVE_FILTER}"
        )
      }
    }
  }
`;

const DEFENSIVE_SUMMARY_QUERY = `
  query DefensiveAbilitySummary($code: String!, $fightIDs: [Int!]!) {
    reportData {
      report(code: $code) {
        table(
          dataType: Casts
          viewBy: Ability
          fightIDs: $fightIDs
          translate: true
          filterExpression: "${DEFENSIVE_FILTER}"
        )
      }
    }
  }
`;


async function fetchReport(reportId) {
  const token = await getAccessToken();
  const data = await callGraphQL(token, REPORT_QUERY, { code: reportId });
  const report = data?.reportData?.report;
  if (!report) {
    throw new Error("Report not found or inaccessible.");
  }

  const fights = report.fights ?? [];
  const bossFightIDs = fights.filter((fight) => (fight.encounterID ?? 0) > 0).map((fight) => fight.id);
  const actors = report.masterData?.actors ?? [];
  const actorMap = createActorMap(actors);
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
    startTime: report.startTime ?? null,
  };
}

async function fetchDeathEvents(reportId, token, fightIDs, actorMap) {
  if (!fightIDs.length) {
    return new Map();
  }
  const data = await callGraphQL(token, DEATH_EVENTS_QUERY, { code: reportId, fightIDs });
  const events = data?.reportData?.report?.events?.data ?? [];
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
  const data = await callGraphQL(token, BLOODLUST_EVENTS_QUERY, { code: reportId, fightIDs });
  const events = data?.reportData?.report?.events?.data ?? [];
  const byFight = new Map();
  for (const event of events) {
    const fightId = event.fightID ?? event.fight ?? null;
    if (!fightId || typeof event.timestamp !== "number") continue;
    const sourceId = event?.sourceID ?? event?.source?.id ?? null;
    const actor = sourceId != null ? actorMap.get(sourceId) : null;
    const sourceName = event?.source?.name || actor?.name || event?.source?.guid || "Unknown";
    const abilityName = event?.ability?.name || "Bloodlust";
    const abilityId = getNumericId(
      event?.abilityGameID ??
        event?.ability?.id ??
        event?.ability?.abilityGameID ??
        event?.ability?.guid ??
        event?.abilityID ??
        event?.ability?.ability,
    );
    if (!byFight.has(fightId)) {
      byFight.set(fightId, []);
    }
    byFight.get(fightId).push({
      timestamp: event.timestamp,
      source: { name: sourceName },
      ability: { name: abilityName, id: abilityId ?? null },
    });
  }
  return byFight;
}

function createActorMap(actors) {
  const map = new Map();
  (actors ?? []).forEach((actor) => {
    if (actor && typeof actor.id === "number") {
      map.set(actor.id, actor);
    }
  });
  return map;
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

async function fetchDefensiveUsage(reportId) {
  console.log(`[logtime] Defensive usage request for ${reportId}`);
  const token = await getAccessToken();
  const data = await callGraphQL(token, REPORT_QUERY, { code: reportId });
  const report = data?.reportData?.report;
  if (!report) {
    throw new Error("Report not found or inaccessible.");
  }

  const fights = report.fights ?? [];
  const bossFights = fights.filter((fight) => (fight?.encounterID ?? 0) > 0);
  if (!bossFights.length) {
    throw new Error("Report contains no boss fights.");
  }

  const fightIDs = bossFights
    .map((fight) => (typeof fight.id === "number" ? fight.id : null))
    .filter((id) => typeof id === "number");
  if (!fightIDs.length) {
    throw new Error("Unable to determine boss fight IDs for defensive summary.");
  }

  const tableResponse = await callGraphQL(token, DEFENSIVE_TABLE_QUERY, {
    code: reportId,
    fightIDs,
  });
  const tableData = tableResponse?.reportData?.report?.table ?? null;
  const parsedTable = parseJsonField(tableData);
  const entries = extractTableEntries(parsedTable);
  if (entries.length) {
    console.log("[logtime] Defensive table sample entry:", JSON.stringify(entries[0]).slice(0, 500));
  }
  const abilityIconMap = await getAbilityIconMap();
  const actorMap = createActorMap(report.masterData?.actors ?? []);
  const normalizedPlayers = await Promise.all(
    entries.map((entry) => normalizeDefensivePlayer(entry, actorMap, abilityIconMap)),
  );
  const players = normalizedPlayers
    .filter((player) => player && player.abilities.length > 0 && !isTankRole(player.role))
    .sort((a, b) => {
      const totalDelta = (b?.totalUses ?? 0) - (a?.totalUses ?? 0);
      if (totalDelta !== 0) {
        return totalDelta;
      }
      return a.name.localeCompare(b.name);
    });
  console.log(
    `[logtime] Defensive usage parsed ${players.length} players (${entries.length} raw entries).`,
  );
  const sampleAbility = players
    .flatMap((player) => player.abilities)
    .find((ability) => ability?.icon);
  if (sampleAbility) {
    console.log(
      `[logtime] Sample defensive icon -> ${sampleAbility.name}: ${sampleAbility.icon.slice(0, 80)}`,
    );
  } else {
    console.warn("[logtime] No defensive ability icons available in payload.");
  }

  const abilitySummary = await fetchAbilitySummary(token, reportId, fightIDs, abilityIconMap);

  const fightSummaries = bossFights.map((fight) => {
    const duration =
      typeof fight.startTime === "number" && typeof fight.endTime === "number"
        ? Math.max(0, fight.endTime - fight.startTime)
        : null;
    return {
      id: fight.id,
      name: fight.name ?? "Unknown",
      encounterID: fight.encounterID ?? null,
      kill: Boolean(fight.kill),
      duration,
    };
  });

  return {
    report: {
      title: report.title ?? null,
      owner: report.owner?.name ?? null,
      zone: report.zone ?? null,
    },
    fights: fightSummaries,
    players,
    abilities: abilitySummary,
  };
}

function parseJsonField(raw) {
  if (!raw) {
    return null;
  }
  if (typeof raw === "object") {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("[logtime] Failed to parse JSON field:", error);
      return null;
    }
  }
  return null;
}

function extractTableEntries(table) {
  if (!table) return [];
  if (Array.isArray(table.entries)) {
    return table.entries;
  }
  if (Array.isArray(table.data?.entries)) {
    return table.data.entries;
  }
  if (Array.isArray(table.series)) {
    return table.series;
  }
  return [];
}

async function fetchAbilitySummary(token, reportId, fightIDs, abilityIconMap) {
  if (!fightIDs?.length) return [];
  const response = await callGraphQL(token, DEFENSIVE_SUMMARY_QUERY, {
    code: reportId,
    fightIDs,
  });
  const tableData = response?.reportData?.report?.table ?? null;
  const parsed = parseJsonField(tableData);
  const entries = extractTableEntries(parsed);
  if (entries.length) {
    console.log(
      "[logtime] Defensive ability summary sample:",
      JSON.stringify(entries[0]).slice(0, 500),
    );
  }
  const normalized = await Promise.all(
    entries.map((entry) => normalizeAbilitySummary(entry, abilityIconMap)),
  );
  return normalized
    .filter((ability) => ability && (ability.totalUses > 0 || ability.maxPossibleUses > 0))
    .sort((a, b) => b.totalUses - a.totalUses);
}

async function normalizeAbilitySummary(entry, abilityIconMap) {
  if (!entry) return null;
  const abilityId = getNumericId(entry.guid ?? entry.id ?? entry.abilityID ?? entry.ability);
  const totalUses = asNumber(entry.totalUses ?? entry.total ?? entry.uses ?? entry.casts ?? 0);
  const maxPossible = asNumber(
    entry.maxPossibleUses ??
      entry.maxPossible ??
      entry.max ??
      entry.totalPossibleUses ??
      entry.possibleUses ??
      0,
  );
  const icon = await extractAbilityIcon(entry, abilityIconMap, abilityId);
  return {
    id: abilityId,
    name: entry.name ?? (abilityId != null ? `Ability ${abilityId}` : "Ability"),
    uses: totalUses,
    possible: maxPossible,
    icon,
  };
}

async function getAbilityIconMap() {
  if (abilityIconCache) {
    console.log(
      `[logtime] Using cached spell icons (${abilityIconCache.byName.size} names / ${abilityIconCache.byId.size} ids).`,
    );
    return abilityIconCache;
  }
  if (!WOW_CLIENT_ID || !WOW_CLIENT_SECRET) {
    console.warn("[logtime] WOW API credentials missing; spell icons unavailable.");
    abilityIconCache = { byId: new Map(), byName: new Map() };
    return abilityIconCache;
  }
  const mapById = new Map();
  const mapByName = new Map();
  await Promise.all(
    DEFENSIVE_ABILITY_IDS.map(async (spellId) => {
      try {
        const spellData = await fetchWowSpellData(spellId);
        if (spellData?.icon) {
          mapById.set(spellId, spellData.icon);
          if (spellData.name) {
            mapByName.set(spellData.name.toLowerCase(), spellData.icon);
          }
        }
      } catch (error) {
        console.warn(`[logtime] Failed to fetch spell icon for ${spellId}:`, error?.message || error);
      }
    }),
  );
  abilityIconCache = { byId: mapById, byName: mapByName };
  console.log(
    `[logtime] Cached ${mapById.size} spell icons (${mapByName.size} name lookups available).`,
  );
  return abilityIconCache;
}

async function normalizeDefensivePlayer(entry, actorMap, abilityIconMap) {
  if (!entry) return null;
  const playerId = getNumericId(entry.guid ?? entry.id);
  const actor = playerId != null ? actorMap.get(playerId) : null;
  const specInfo = extractSpecInfo(entry);
  const abilitiesRaw = extractAbilityList(entry);
  if (!abilitiesRaw.length) {
    console.warn("[logtime] Player entry missing abilities:", entry.name || entry.id);
  }
  const abilities = (
    await Promise.all(abilitiesRaw.map((ability) => normalizeAbilityUsage(ability, abilityIconMap)))
  ).filter((ability) => ability && (ability.uses > 0 || ability.possible > 0));
  const totalUses = asNumber(entry.totalUses ?? entry.total ?? entry.uses ?? entry.casts ?? 0);
  const computedUses = abilities.reduce((sum, ability) => sum + (ability?.uses ?? 0), 0);

  return {
    id: playerId,
    name: entry.name ?? actor?.name ?? "Unknown",
    className: actor?.subType ?? entry.class ?? entry.subType ?? null,
    specName: specInfo.name,
    role: specInfo.role,
    totalUses: totalUses || computedUses,
    maxPossibleUses: asNumber(
      entry.maxPossibleUses ?? entry.max ?? entry.possibleUses ?? entry.totalPossibleUses ?? 0,
    ),
    abilities,
  };
}

function extractAbilityList(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.abilities)) {
    return entry.abilities;
  }
  if (entry.abilities && Array.isArray(entry.abilities.abilities)) {
    return entry.abilities.abilities;
  }
  if (entry.abilities && Array.isArray(entry.abilities.entries)) {
    return entry.abilities.entries;
  }
  if (entry.abilities && Array.isArray(entry.abilities.data)) {
    return entry.abilities.data;
  }
  if (Array.isArray(entry.spells)) {
    return entry.spells;
  }
  return [];
}

async function normalizeAbilityUsage(raw, abilityIconMap) {
  if (!raw) return null;
  if (typeof raw !== "object") {
    console.warn("[logtime] Unexpected ability entry", raw);
    return null;
  }
  console.log("[logtime] Ability payload sample:", JSON.stringify(raw).slice(0, 200));
  const abilityId = getNumericId(raw.guid ?? raw.id ?? raw.abilityID ?? raw.ability);
  if (abilityId == null) {
    console.warn("[logtime] Ability missing numeric id", raw?.name || raw);
  }
  const uses = asNumber(raw.totalUses ?? raw.total ?? raw.uses ?? raw.casts ?? 0);
  const possible = asNumber(
    raw.maxUses ??
      raw.max ??
      raw.maxPossibleUses ??
      raw.maxPotentialUses ??
      raw.possibleUses ??
      raw.totalPossibleUses ??
      0,
  );
  const icon = await extractAbilityIcon(raw, abilityIconMap, abilityId);
  return {
    id: abilityId,
    name: raw.name ?? (abilityId != null ? `Ability ${abilityId}` : "Ability"),
    icon,
    uses,
    possible,
  };
}

function extractSpecInfo(entry) {
  const specs = Array.isArray(entry?.specs) ? entry.specs : [];
  if (specs.length) {
    const primary = specs[0];
    const name = typeof primary?.spec === "string" ? primary.spec : typeof primary?.name === "string" ? primary.name : null;
    const role = typeof primary?.role === "string" ? primary.role.toLowerCase() : null;
    return { name, role };
  }
  const name = typeof entry?.spec === "string" ? entry.spec : null;
  const role = typeof entry?.role === "string" ? entry.role.toLowerCase() : null;
  return { name, role };
}

function isTankRole(role) {
  return typeof role === "string" && role.toLowerCase() === "tank";
}

async function extractAbilityIcon(raw, abilityIconMap, abilityId) {
  if (!raw) {
    return null;
  }
  const nameKey = typeof raw.name === "string" ? raw.name.trim().toLowerCase() : null;
  if (nameKey && abilityIconMap?.byName?.has(nameKey)) {
    return abilityIconMap.byName.get(nameKey);
  }
  const candidates = [
    raw.abilityIcon,
    raw.icon,
    raw.iconName,
    raw.iconFile,
    raw.abilityIconName,
    raw.ability?.icon,
    raw.ability?.abilityIcon,
    raw.spell?.icon,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (abilityId != null && abilityIconMap?.byId?.size) {
    const cached = abilityIconMap.byId.get(abilityId);
    if (cached) {
      return cached;
    }
  }
  if (nameKey && shouldUseItemApi(raw, nameKey)) {
    const itemIcon = await fetchWowItemIconByName(raw.name);
    if (itemIcon) {
      return itemIcon;
    }
  }
  if (nameKey && abilityIconMap?.byName?.size) {
    const cachedName = abilityIconMap.byName.get(nameKey);
    if (cachedName) {
      return cachedName;
    }
  }
  if (nameKey) {
    const override = findIconOverrideByName(nameKey);
    if (override) {
      return override;
    }
  }
  return null;
}

function normalizeIconSlug(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed.toLowerCase();
}

async function fetchWowItemIconByName(name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!key) return null;
  if (itemIconCache.has(key)) {
    return itemIconCache.get(key);
  }
  try {
    const token = await getWowAccessToken();
    const region = (WOW_REGION || "us").toLowerCase();
    const namespace = `static-${region}`;
    const locale = WOW_LOCALE || "en_US";
    const params = new URLSearchParams();
    params.set("namespace", namespace);
    params.set("locale", locale);
    params.set("orderby", "id");
    params.set("_page", "1");
    params.set(`name.${locale}`, name);
    const searchUrl = `https://${region}.api.blizzard.com/data/wow/search/item?${params.toString()}`;
    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Item search failed: ${response.status} ${text}`);
    }
    const payload = await response.json();
    const firstResult = payload?.results?.[0];
    const itemId = firstResult?.data?.id ?? firstResult?.data?.item?.id ?? null;
    if (!itemId) {
      itemIconCache.set(key, null);
      return null;
    }
    const mediaUrl = `https://${region}.api.blizzard.com/data/wow/media/item/${itemId}?namespace=${namespace}&locale=${locale}`;
    const mediaResp = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!mediaResp.ok) {
      const text = await mediaResp.text();
      throw new Error(`Item media failed: ${mediaResp.status} ${text}`);
    }
    const media = await mediaResp.json();
    const iconUrl = (media?.assets ?? []).find((asset) => asset?.key === "icon" || asset?.value)?.value ?? null;
    itemIconCache.set(key, iconUrl ?? null);
    return iconUrl;
  } catch (error) {
    console.warn(`[logtime] Item icon lookup failed for ${name}:`, error?.message || error);
    itemIconCache.set(key, null);
    return null;
  }
}

function shouldUseItemApi(raw, nameKey) {
  if (!nameKey) {
    return false;
  }
  if (raw?.type === 40) {
    return true;
  }
  return ITEM_API_NAMES.has(nameKey);
}

const ITEM_API_NAMES = new Set([
  "healthstone",
  "demonic healthstone",
  "invigorating healing potion",
  "healing potion",
]);

async function fetchYoutubeLiveStart(videoId) {
  if (!videoId) {
    return null;
  }
  if (!YOUTUBE_API_KEY) {
    throw new Error("Server missing YOUTUBE_API_KEY for YouTube metadata.");
  }
  if (youtubeLiveStartCache.has(videoId)) {
    const cached = youtubeLiveStartCache.get(videoId);
    if (cached?.startEpochSeconds != null) {
      return cached;
    }
    youtubeLiveStartCache.delete(videoId);
  }
  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  apiUrl.searchParams.set("id", videoId);
  apiUrl.searchParams.set("part", "liveStreamingDetails");
  apiUrl.searchParams.set("key", YOUTUBE_API_KEY);
  const response = await fetch(apiUrl.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YouTube API error: ${response.status} ${text}`);
  }
  const payload = await response.json();
  const details = payload?.items?.[0]?.liveStreamingDetails ?? null;
  const actualStartTime = details?.actualStartTime ?? null;
  const scheduledStartTime = details?.scheduledStartTime ?? null;
  const startIso = actualStartTime ?? scheduledStartTime ?? null;
  const epochSeconds = startIso ? Math.floor(Date.parse(startIso) / 1000) : null;
  const result = {
    actualStartTime: actualStartTime ?? null,
    scheduledStartTime: scheduledStartTime ?? null,
    startEpochSeconds: epochSeconds,
  };
  if (epochSeconds != null) {
    youtubeLiveStartCache.set(videoId, result);
  }
  return result;
}


async function getWowAccessToken() {
  if (!WOW_CLIENT_ID || !WOW_CLIENT_SECRET) {
    throw new Error("Missing WOW_CLIENT_ID/WOW_CLIENT_SECRET for Blizzard API.");
  }
  const now = Date.now();
  if (wowTokenCache.accessToken && wowTokenCache.expiresAt > now + 10_000) {
    return wowTokenCache.accessToken;
  }
  const credentials = Buffer.from(`${WOW_CLIENT_ID}:${WOW_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to obtain WoW access token: ${response.status} ${text}`);
  }
  const data = await response.json();
  wowTokenCache.accessToken = data.access_token;
  wowTokenCache.expiresAt = Date.now() + data.expires_in * 1000;
  return wowTokenCache.accessToken;
}

async function fetchWowSpellData(spellId) {
  const token = await getWowAccessToken();
  const region = (WOW_REGION || "us").toLowerCase();
  const namespace = `static-${region}`;
  const locale = WOW_LOCALE || "en_US";
  const spellUrl = `https://${region}.api.blizzard.com/data/wow/spell/${spellId}?namespace=${namespace}&locale=${locale}`;
  const mediaUrl = `https://${region}.api.blizzard.com/data/wow/media/spell/${spellId}?namespace=${namespace}&locale=${locale}`;
  const [spellResp, mediaResp] = await Promise.all([
    fetch(spellUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
    fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
  ]);
  if (!spellResp.ok) {
    const text = await spellResp.text();
    throw new Error(`Spell data request failed: ${spellResp.status} ${text}`);
  }
  if (!mediaResp.ok) {
    const text = await mediaResp.text();
    throw new Error(`Spell media request failed: ${mediaResp.status} ${text}`);
  }
  const spellData = await spellResp.json();
  const mediaData = await mediaResp.json();
  const asset = (mediaData?.assets ?? []).find((entry) => entry?.key === "icon" || entry?.value);
  return {
    id: spellId,
    name: spellData?.name ?? null,
    icon: asset?.value ?? null,
  };
}

function findIconOverrideByName(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return ICON_NAME_OVERRIDES.get(key) ?? null;
}

const ICON_NAME_OVERRIDES = new Map([
  ["healthstone", "https://wow.zamimg.com/images/wow/icons/large/inv_stone_04.jpg"],
  ["invigorating healing potion", "https://wow.zamimg.com/images/wow/icons/large/inv_alchemy_80_orange.jpg"],
  ["mass barrier", "https://wow.zamimg.com/images/wow/icons/large/spell_mage_massbarrier.jpg"],
  ["ice cold", "https://wow.zamimg.com/images/wow/icons/large/spell_frost_frostarmor.jpg"],
  ["dark pact", "https://wow.zamimg.com/images/wow/icons/large/spell_shadow_deathpact.jpg"],
  ["unending resolve", "https://wow.zamimg.com/images/wow/icons/large/spell_shadow_demonictactics.jpg"],
  ["mortal coil", "https://wow.zamimg.com/images/wow/icons/large/ability_warlock_mortalcoil.jpg"],
  ["demonic healthstone", "https://wow.zamimg.com/images/wow/icons/large/spell_shadow_soulgem.jpg"],
  ["prismatic barrier", "https://wow.zamimg.com/images/wow/icons/large/spell_mage_prismaticshield.jpg"],
  ["alter time", "https://wow.zamimg.com/images/wow/icons/large/spell_mage_altertime.jpg"],
  ["ice barrier", "https://wow.zamimg.com/images/wow/icons/large/spell_ice_lament.jpg"],
  ["fortitude of the bear", "https://wow.zamimg.com/images/wow/icons/large/ability_hunter_survivalinstincts.jpg"],
  ["earth elemental", "https://wow.zamimg.com/images/wow/icons/large/spell_nature_earthelemental_totem.jpg"],
  ["stone bulwark totem", "https://wow.zamimg.com/images/wow/icons/large/spell_nature_stoneclawtotem.jpg"],
  ["zephyr", "https://wow.zamimg.com/images/wow/icons/large/ability_evoker_hover.jpg"],
  ["survival of the fittest", "https://wow.zamimg.com/images/wow/icons/large/ability_hunter_survivalofthefittest.jpg"],
]);

function getNumericId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function createApp() {
  const app = express();
  app.use((req, res, next) => {
    if (!ensureCors(req, res)) {
      return;
    }
    next();
  });
  const jsonParser = express.json();
  app.use((req, res, next) => {
    if (req.body !== undefined || req.method === "GET" || req.method === "HEAD") {
      return next();
    }
    return jsonParser(req, res, next);
  });

  app.post("/api/defensives", handleDefensivesRequest);
  app.get("/api/youtube/live-start", handleYoutubeLiveStartRequest);
  app.post("/api/report", handleReportRequest);

  return app;
}

export async function handleDefensivesRequest(req, res) {
  if (!ensureCors(req, res)) {
    return;
  }
  if (!enforceMethod(req, res, "POST")) {
    return;
  }
  const reportId = (req.body?.reportId || "").trim();
  if (!reportId) {
    return sendJson(res, 400, { error: "reportId is required." });
  }
  if (!WCL_CLIENT_ID || !WCL_CLIENT_SECRET) {
    return sendJson(res, 500, { error: "Server missing WCL OAuth credentials." });
  }
  try {
    const data = await fetchDefensiveUsage(reportId);
    return sendJson(res, 200, data);
  } catch (error) {
    console.error("[logtime] /api/defensives error:", error);
    return sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

export async function handleYoutubeLiveStartRequest(req, res) {
  if (!ensureCors(req, res)) {
    return;
  }
  if (!enforceMethod(req, res, "GET")) {
    return;
  }
  const rawVideoId = getQueryParam(req, "videoId");
  const videoId = (rawVideoId || "").toString().trim();
  if (!videoId) {
    return sendJson(res, 400, { error: "videoId is required." });
  }
  if (!YOUTUBE_API_KEY) {
    return sendJson(res, 500, { error: "Server missing YOUTUBE_API_KEY." });
  }
  try {
    const data = await fetchYoutubeLiveStart(videoId);
    return sendJson(res, 200, data ?? { startEpochSeconds: null });
  } catch (error) {
    console.error("[logtime] /api/youtube/live-start error:", error);
    return sendJson(res, 500, { error: error.message || "Failed to load YouTube live metadata." });
  }
}

export async function handleReportRequest(req, res) {
  if (!ensureCors(req, res)) {
    return;
  }
  if (!enforceMethod(req, res, "POST")) {
    return;
  }
  const reportId = (req.body?.reportId || "").trim();
  if (!reportId) {
    return sendJson(res, 400, { error: "reportId is required." });
  }
  if (!WCL_CLIENT_ID || !WCL_CLIENT_SECRET) {
    return sendJson(res, 500, { error: "Server missing WCL OAuth credentials." });
  }
  try {
    const data = await fetchReport(reportId);
    return sendJson(res, 200, data);
  } catch (error) {
    console.error("[logtime] /api/report error:", error);
    return sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

function enforceMethod(req, res, allowed) {
  const allowedMethods = Array.isArray(allowed)
    ? allowed.map((method) => String(method || "").toUpperCase())
    : [String(allowed || "").toUpperCase()];
  const method = String(req?.method || "GET").toUpperCase();
  if (allowedMethods.includes(method)) {
    return true;
  }
  try {
    if (typeof res?.setHeader === "function") {
      res.setHeader("Allow", allowedMethods.join(", "));
    }
  } catch {
    // ignore header errors in fallback environments
  }
  sendJson(res, 405, { error: "Method not allowed." });
  return false;
}

function sendJson(res, status, payload) {
  if (typeof res?.status === "function" && typeof res?.json === "function") {
    return res.status(status).json(payload);
  }
  if (res) {
    try {
      res.statusCode = status;
      if (typeof res.setHeader === "function") {
        res.setHeader("Content-Type", "application/json");
      }
      if (typeof res.end === "function") {
        res.end(JSON.stringify(payload));
        return;
      }
    } catch (error) {
      console.error("[logtime] Failed to send JSON response:", error);
    }
  }
}

function ensureCors(req, res) {
  if (!req || req.__logtimeCorsHandled) {
    return true;
  }
  const origin = getRequestOrigin(req);
  if (!isOriginAllowed(origin)) {
    console.warn(`[logtime] Blocked CORS origin: ${origin}`);
    sendJson(res, 403, { error: "Origin not allowed." });
    return false;
  }
  setCorsHeaders(res, origin);
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    endCorsPreflight(res);
    req.__logtimeCorsHandled = true;
    return false;
  }
  req.__logtimeCorsHandled = true;
  return true;
}

function getRequestOrigin(req) {
  const origin = req?.headers?.origin ?? req?.headers?.Origin ?? "";
  return typeof origin === "string" ? origin.trim() : "";
}

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }
  if (allowAllOrigins) {
    return true;
  }
  if (allowedOriginSet.has(origin)) {
    return true;
  }
  const lower = origin.toLowerCase();
  if (devOriginPrefixes.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  return false;
}

function setCorsHeaders(res, origin) {
  if (!res || typeof res.setHeader !== "function") {
    return;
  }
  const allowValue = origin || (allowAllOrigins ? "*" : "");
  if (allowValue) {
    res.setHeader("Access-Control-Allow-Origin", allowValue);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Logtime-Token",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function endCorsPreflight(res) {
  try {
    if (typeof res?.status === "function") {
      res.status(204);
      if (typeof res.end === "function") {
        res.end();
        return;
      }
      if (typeof res.send === "function") {
        res.send();
        return;
      }
    } else if (res) {
      res.statusCode = 204;
      if (typeof res.end === "function") {
        res.end();
        return;
      }
    }
  } catch (error) {
    console.error("[logtime] Failed to send CORS preflight response:", error);
  }
}

function getQueryParam(req, key) {
  const query = req?.query;
  if (query && typeof query === "object") {
    const value = query[key];
    if (Array.isArray(value)) {
      return value[0];
    }
    if (value != null) {
      return value;
    }
  }
  const urlValue = typeof req?.url === "string" ? req.url : null;
  if (urlValue) {
    try {
      const parsed = new URL(urlValue, "http://localhost");
      return parsed.searchParams.get(key);
    } catch {
      // ignore malformed URLs
    }
  }
  return null;
}
