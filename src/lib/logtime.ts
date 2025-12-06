export interface RawFight {
  id: number;
  name: string;
  encounterID?: number;
  startTime: number;
  endTime: number;
  kill: boolean;
  bossPercentage?: number;
  fightPercentage?: number;
  lastPhase?: number | null;
  lastPhaseIsIntermission?: boolean | null;
  phaseTransitions?: Array<PhaseTransitionData>;
  deaths?: Array<GraphQLDeathEvent>;
  bloodlusts?: Array<GraphQLBloodlustEvent>;
  phaseMetadata?: Record<string, PhaseMetadataEntry>;
}

interface PhaseTransitionData {
  phase?: number | null;
  startTime?: number | null;
  isIntermission?: boolean | null;
  label?: string | null;
  id?: number | null;
}

interface GraphQLDeathEvent {
  timestamp: number;
  target?: { name?: string };
}

interface GraphQLBloodlustEvent {
  timestamp: number;
  source?: { name?: string };
  ability?: { name?: string };
}

export interface ReportPayload {
  fights: RawFight[];
  title?: string;
  owner?: string;
  zone?: { id: number; name?: string } | number;
  actors?: ActorInfo[];
}

export interface FightRow {
  pull: number;
  bossName: string;
  kill: boolean;
  result: "KILL" | "Wipe";
  timestamp: string;
  videoSeconds: number;
  bossHpLeft?: number;
  bossProgress?: number;
  durationSeconds: number;
  durationText: string;
  phases: PhaseInfo[];
  phaseSegments: PhaseSegment[];
  phaseMarkers: PhaseMarker[];
  deaths: DeathMarker[];
  bloodlusts: BloodlustMarker[];
}

export interface PhaseInfo {
  label: string;
  percentage?: number | null;
}

export interface PhaseSegment {
  label: string;
  startSeconds: number;
  endSeconds: number;
  isIntermission?: boolean;
}

export interface PhaseMarker {
  label: string;
  offsetSeconds: number;
  isIntermission?: boolean;
}

interface PhaseMetadataEntry {
  id: number;
  name?: string | null;
  isIntermission?: boolean | null;
}

export interface DeathMarker {
  player: string;
  offsetSeconds: number;
  offsetText: string;
}

export interface BloodlustMarker {
  caster: string;
  ability: string;
  offsetSeconds: number;
  offsetText: string;
}

export interface ReportMeta {
  title?: string;
  owner?: string;
  zone?: { id: number; name?: string } | number;
}

export interface ActorInfo {
  id: number;
  name?: string | null;
  type?: string | null;
  subType?: string | null;
}

export async function fetchReportFights(reportIdOrUrl: string): Promise<ReportPayload> {
  const reportId = extractReportId(reportIdOrUrl);
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to load report (${response.status} ${response.statusText}): ${text || "No details"}`,
    );
  }
  return (await response.json()) as ReportPayload;
}

function extractReportId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/reports\/([A-Za-z0-9]{16})/);
  if (urlMatch) {
    return urlMatch[1];
  }
  if (/^[A-Za-z0-9]{16}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error("Report ID or URL is invalid.");
}

export function parseHhmmss(value: string): number {
  const parts = value.trim().split(":");
  if (parts.length !== 3) {
    throw new Error("Timestamp must be in HH:MM:SS format.");
  }
  const [h, m, s] = parts.map((part) => {
    const num = Number(part);
    if (!Number.isFinite(num)) {
      throw new Error("Timestamp must contain numbers only.");
    }
    return num;
  });
  if (h < 0 || m < 0 || m >= 60 || s < 0 || s >= 60) {
    throw new Error("Hours must be >= 0, minutes/seconds between 0 and 59.");
  }
  return h * 3600 + m * 60 + s;
}

export function formatHhmmss(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function extractBossPercentage(fight: RawFight): number | undefined {
  const candidates = [
    fight.fightPercentage,
    fight.bossPercentage,
  ];
  for (const percentage of candidates) {
    if (typeof percentage === "number" && Number.isFinite(percentage)) {
      return percentage;
    }
  }
  return undefined;
}

export function buildBossFightRows(
  fights: RawFight[],
  vodStartSeconds: number,
): FightRow[] {
  const bossFights = fights.filter((fight) => (fight.encounterID ?? 0) > 0);
  if (!bossFights.length) {
    throw new Error("Report contains no boss fights.");
  }
  bossFights.sort((a, b) => a.startTime - b.startTime);
  const firstStartSeconds = bossFights[0].startTime / 1000;
  const videoOffset = vodStartSeconds - firstStartSeconds;

  return bossFights.map((fight, index) => {
    const startSeconds = fight.startTime / 1000;
    const videoSeconds = Math.max(0, startSeconds + videoOffset);
    const duration = Math.max(0, (fight.endTime - fight.startTime) / 1000);
    const bossHpLeft = extractBossPercentage(fight);
    const bossProgress =
      typeof bossHpLeft === "number" ? Math.max(0, 100 - bossHpLeft) : undefined;
    const { segments, markers } = buildPhaseSegmentsAndMarkers(fight, duration);
    return {
      pull: index + 1,
      bossName: fight.name || "Unknown Boss",
      kill: Boolean(fight.kill),
      result: fight.kill ? "KILL" : "Wipe",
      timestamp: formatHhmmss(videoSeconds),
      videoSeconds,
      bossHpLeft,
      bossProgress,
      durationSeconds: duration,
      durationText: formatDuration(duration),
      phases: buildPhaseInfo(fight),
      phaseSegments: segments,
      phaseMarkers: markers,
      deaths: buildDeathMarkers(fight, duration),
      bloodlusts: buildBloodlustMarkers(fight, duration),
    };
  });
}

function buildPhaseInfo(fight: RawFight): PhaseInfo[] {
  const label = fight.kill
    ? "Kill"
    : fight.lastPhase != null
      ? fight.lastPhaseIsIntermission
        ? `I${Math.max(1, fight.lastPhase)}`
        : `P${Math.max(1, fight.lastPhase)}`
      : "P1";
  return [
    {
      label,
      percentage: fight.kill ? null : fight.bossPercentage ?? fight.fightPercentage ?? null,
    },
  ];
}

interface PhaseTransitionInfo {
  seconds: number;
  label?: string;
  isIntermission?: boolean;
  phaseId?: number;
}

function buildPhaseSegmentsAndMarkers(
  fight: RawFight,
  durationSeconds: number,
): { segments: PhaseSegment[]; markers: PhaseMarker[] } {
  const raw = Array.isArray(fight.phaseTransitions) ? fight.phaseTransitions : [];
  if (!raw.length || durationSeconds <= 0) {
    return {
      segments: [
        {
          label: fight.kill ? "Kill" : "P1",
          startSeconds: 0,
          endSeconds: durationSeconds,
        },
      ],
      markers: [],
    };
  }

  const fightStartMs = typeof fight.startTime === "number" ? fight.startTime : 0;
  const metadataMap = buildPhaseMetadataMap(fight.phaseMetadata);
  const transitions = raw
    .map((value) => normalizeTransition(value, fightStartMs, metadataMap))
    .filter((entry): entry is PhaseTransitionInfo => typeof entry?.seconds === "number")
    .sort((a, b) => a.seconds - b.seconds);

  const segments: PhaseSegment[] = [];
  const markers: PhaseMarker[] = [];
  let lastStart = 0;
  let currentLabel: string | undefined = "P1";
  let currentIsIntermission = false;
  let phaseCount = 1;
  let intermissionCount = 0;

  transitions.forEach((entry) => {
    const transitionSeconds = clampSeconds(entry.seconds, durationSeconds);
    const start = Math.max(0, lastStart);
    const end = Math.min(durationSeconds, transitionSeconds);
    if (end > start) {
      segments.push({
        label: currentLabel || `P${segments.length + 1}`,
        startSeconds: start,
        endSeconds: end,
        isIntermission: currentIsIntermission,
      });
    }

    const isIntermissionEntry =
      Boolean(entry.isIntermission) || labelIndicatesIntermission(entry.label);

    let markerLabel: string;
    if (isIntermissionEntry) {
      intermissionCount += 1;
      markerLabel = `I${intermissionCount}`;
    } else {
      markerLabel = `P${phaseCount}`;
      phaseCount += 1;
    }

    if (transitionSeconds >= 0 && transitionSeconds <= durationSeconds) {
      markers.push({
        label: markerLabel,
        offsetSeconds: transitionSeconds,
        isIntermission: entry.isIntermission,
      });
    }

    currentLabel = markerLabel;
    currentIsIntermission = isIntermissionEntry;
    lastStart = transitionSeconds;
  });

  if (lastStart < durationSeconds) {
    segments.push({
      label: fight.kill ? "Kill" : currentLabel || `P${segments.length + 1}`,
      startSeconds: Math.max(0, lastStart),
      endSeconds: durationSeconds,
      isIntermission: fight.kill ? false : currentIsIntermission,
    });
  }

  if (!segments.length) {
    segments.push({
      label: fight.kill ? "Kill" : "P1",
      startSeconds: 0,
      endSeconds: durationSeconds,
    });
  }

  return { segments, markers };
}

function normalizeTransition(
  value: unknown,
  fightStartMs: number,
  metadataMap: Map<number, PhaseMetadataEntry> | null,
): PhaseTransitionInfo | undefined {
  let milliseconds: number | undefined;
  let label: string | undefined;
  let phaseId: number | undefined;
  let isIntermission = false;
  let isAbsolute = false;

  if (typeof value === "number") {
    milliseconds = value;
  } else if (typeof value === "object" && value !== null) {
    const maybe = value as Record<string, unknown>;
    const raw = getNumber(maybe.startTime ?? maybe.time ?? maybe.timestamp);
    if (typeof raw === "number") {
      milliseconds = raw;
    }
    label = typeof maybe.label === "string" ? normalizePhaseLabel(maybe.label) : undefined;
    phaseId =
      typeof maybe.phase === "number"
        ? maybe.phase
        : typeof maybe.id === "number"
          ? maybe.id
          : undefined;
    isIntermission = Boolean(maybe.isIntermission ?? maybe.intermission);
    isAbsolute = typeof maybe.startTime === "number";
  }

  if (typeof milliseconds !== "number") {
    return undefined;
  }

  const relativeMs = isAbsolute ? milliseconds - fightStartMs : milliseconds;
  const seconds = Math.max(0, relativeMs) / 1000;
  const metadata = phaseId != null ? metadataMap?.get(phaseId) : undefined;
  if (!label && typeof metadata?.name === "string") {
    label = metadata.name.trim();
  }
  if (!isIntermission && metadata?.isIntermission) {
    isIntermission = true;
  }
  return {
    seconds,
    label,
    isIntermission,
    phaseId,
  };
}

function normalizePhaseLabel(label: string): string {
  const match = label.match(/intermission\s+(\d+)/i);
  if (match) {
    return `I${match[1]}`;
  }
  return label;
}

function labelIndicatesIntermission(label?: string): boolean {
  if (!label) return false;
  const normalized = normalizePhaseLabel(label).trim();
  return /^I\d+$/i.test(normalized);
}

function clampSeconds(value: number, maxSeconds: number): number {
  if (Number.isNaN(value)) return 0;
  if (!Number.isFinite(value)) return maxSeconds;
  return Math.max(0, Math.min(maxSeconds, value));
}

function buildPhaseMetadataMap(
  metadata?: Record<string, PhaseMetadataEntry>,
): Map<number, PhaseMetadataEntry> | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const map = new Map<number, PhaseMetadataEntry>();
  Object.entries(metadata).forEach(([key, value]) => {
    if (!value) return;
    const id = typeof value.id === "number" ? value.id : Number(key);
    if (typeof id === "number" && Number.isFinite(id)) {
      map.set(id, value);
    }
  });
  return map.size ? map : null;
}

function getNumber(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : undefined;
  return typeof num === "number" && Number.isFinite(num) ? num : undefined;
}

function buildDeathMarkers(fight: RawFight, durationSeconds: number): DeathMarker[] {
  const rawDeaths = Array.isArray((fight as any).deaths) ? (fight as any).deaths : [];
  return rawDeaths
    .map((event: any) => {
      const timestamp = typeof event?.timestamp === "number" ? event.timestamp : undefined;
      if (timestamp == null) return null;
      const offsetMs = timestamp - fight.startTime;
      const offsetSeconds = Math.max(0, Math.min(durationSeconds, offsetMs / 1000));
      const player = event?.target?.name || event?.target?.guid || "Unknown";
      return {
        player,
        offsetSeconds,
        offsetText: formatDuration(offsetSeconds),
      };
    })
    .filter((marker): marker is DeathMarker => Boolean(marker))
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}

function buildBloodlustMarkers(fight: RawFight, durationSeconds: number): BloodlustMarker[] {
  const rawEvents = Array.isArray((fight as any).bloodlusts) ? (fight as any).bloodlusts : [];
  return rawEvents
    .map((event: GraphQLBloodlustEvent) => {
      const timestamp = typeof event?.timestamp === "number" ? event.timestamp : undefined;
      if (timestamp == null) return null;
      const offsetMs = timestamp - fight.startTime;
      const offsetSeconds = Math.max(0, Math.min(durationSeconds, offsetMs / 1000));
      const caster = event?.source?.name || "Unknown";
      const ability = event?.ability?.name || "Bloodlust";
      return {
        caster,
        ability,
        offsetSeconds,
        offsetText: formatDuration(offsetSeconds),
      };
    })
    .filter((marker): marker is BloodlustMarker => Boolean(marker))
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}
