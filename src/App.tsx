import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import VideoPlayer, { type VideoPlayerHandle } from "./components/VideoPlayer";
import {
  buildBossFightRows,
  fetchReportFights,
  formatDuration,
  parseHhmmss,
  type FightRow,
  type ReportMeta,
  type ActorInfo,
} from "./lib/logtime";
import { detectVideoSource, type VideoSource } from "./lib/video";

type StatusState =
  | { kind: "idle"; message: "" }
  | { kind: "info" | "success" | "error"; message: string };

const CLASS_COLORS: Record<string, string> = {
  DeathKnight: "#C41F3B",
  DemonHunter: "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

interface VideoFormEntry {
  url: string;
  firstPull: string;
  label: string;
}

interface VideoOption {
  url: string;
  source: VideoSource;
  firstPullSeconds: number;
  offsetSeconds: number;
  label: string;
  characterName: string | null;
}

const emptyVideoEntry: VideoFormEntry = {
  url: "",
  firstPull: "00:00:00",
  label: "",
};

const createInitialForm = () => ({
  reportId: "",
  videos: [{ ...emptyVideoEntry }],
  liveMode: false,
});

type FormState = ReturnType<typeof createInitialForm>;

function App() {
  const [phase, setPhase] = useState<"landing" | "review">("landing");
  const [form, setForm] = useState<FormState>(createInitialForm);
  const [status, setStatus] = useState<StatusState>({ kind: "idle", message: "" });
  const [loading, setLoading] = useState(false);
  const [fights, setFights] = useState<FightRow[]>([]);
  const [reportMeta, setReportMeta] = useState<ReportMeta | null>(null);
  const [videoOptions, setVideoOptions] = useState<VideoOption[]>([]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [playerSeekRevision, setPlayerSeekRevision] = useState(0);
  const [playerStartSeconds, setPlayerStartSeconds] = useState(0);
  const [actorClassMap, setActorClassMap] = useState<Record<string, string>>({});
  const [liveMode, setLiveMode] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [vodOffsetSeconds, setVodOffsetSeconds] = useState<number | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);

  const hasVideo = videoOptions.length > 0;
  const activeVideo = videoOptions[activeVideoIndex] ?? null;

  useEffect(() => {
    if (!activeVideo) {
      setCurrentVideoTime(0);
      return;
    }
    const interval = setInterval(() => {
      const localTime = playerRef.current?.getCurrentTime?.() ?? 0;
      const globalTime = localTime - activeVideo.offsetSeconds;
      setCurrentVideoTime(Math.max(0, globalTime));
    }, 500);
    return () => clearInterval(interval);
  }, [activeVideo]);

  useEffect(() => {
    if (!liveMode || phase !== "review" || !activeReportId || vodOffsetSeconds == null) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const report = await fetchReportFights(activeReportId);
        const rows = buildBossFightRows(report.fights ?? [], vodOffsetSeconds);
        setFights(rows);
        setReportMeta({
          title: report.title,
          owner: report.owner,
          zone: report.zone,
        });
        setStatus({ kind: "success", message: `Live refresh (${rows.length} pulls).` });
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? `Live refresh failed: ${error.message}` : "Live refresh failed.",
        });
      }
    }, 45000);
    return () => clearInterval(interval);
  }, [liveMode, phase, activeReportId, vodOffsetSeconds]);
  const reportSubtitle = useMemo(() => {
    if (!reportMeta) return "";
    const parts: string[] = [];
    if (reportMeta.title) parts.push(reportMeta.title);
    if (reportMeta.owner) parts.push(`by ${reportMeta.owner}`);
    if (reportMeta.zone) {
      if (typeof reportMeta.zone === "number") {
        parts.push(`Zone #${reportMeta.zone}`);
      } else {
        parts.push(reportMeta.zone.name ?? `Zone #${reportMeta.zone.id}`);
      }
    }
    return parts.join(" • ");
  }, [reportMeta]);

  const timestampList = useMemo(() => {
    return fights.map(
      (fight) => `${fight.timestamp} - ${fight.bossName} - Pull #${fight.pull} - (${fight.result})`,
    );
  }, [fights]);

  const groupedFights = useMemo(() => {
    const map = new Map<string, FightRow[]>();
    fights.forEach((fight) => {
      const key = fight.bossName || "Unknown Boss";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(fight);
    });
    return Array.from(map.entries());
  }, [fights]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ kind: "info", message: "Loading report…" });
    setLoading(true);

    let options: VideoOption[] = [];
    try {
      options = buildVideoOptionsFromInputs(form.videos);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Invalid video settings.",
      });
      setLoading(false);
      return;
    }

    if (!options.length) {
      setStatus({
        kind: "error",
        message: "Add at least one video with a first pull timestamp.",
      });
      setLoading(false);
      return;
    }

    const baseFirstPull = options[0].firstPullSeconds;

    try {
      const trimmedId = form.reportId.trim();
      const report = await fetchReportFights(trimmedId);
      const rows = buildBossFightRows(report.fights ?? [], baseFirstPull);
      setFights(rows);
      setReportMeta({
        title: report.title,
        owner: report.owner,
        zone: report.zone,
      });
      setVideoOptions(options);
      setActiveVideoIndex(0);
      setPlayerStartSeconds(0);
      setPlayerSeekRevision((rev) => rev + 1);
      setActorClassMap(buildActorClassMap(report.actors ?? []));
      setLiveMode(form.liveMode);
      setActiveReportId(trimmedId);
      setVodOffsetSeconds(baseFirstPull);
      setStatus({ kind: "success", message: `Loaded ${rows.length} boss pulls.` });
      setPhase("review");
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load report.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleJump = (seconds: number) => {
    if (!videoOptions.length) {
      setStatus({
        kind: "error",
        message: "Add a video URL to enable jumps.",
      });
      return;
    }
    let targetIndex = activeVideoIndex;
    let targetVideo = videoOptions[targetIndex] ?? videoOptions[0];
    let relativeSeconds = seconds + targetVideo.offsetSeconds;

    if (relativeSeconds < -0.25 || Number.isNaN(relativeSeconds)) {
      targetIndex = 0;
      targetVideo = videoOptions[targetIndex];
      relativeSeconds = seconds + targetVideo.offsetSeconds;
    }

    relativeSeconds = Math.max(0, relativeSeconds);
    setCurrentVideoTime(seconds);

    if (targetIndex !== activeVideoIndex) {
      setActiveVideoIndex(targetIndex);
      setPlayerStartSeconds(relativeSeconds);
      setPlayerSeekRevision((rev) => rev + 1);
    } else {
      playerRef.current?.seekTo(relativeSeconds);
    }
  };

  const handleVideoSelect = (index: number) => {
    if (!videoOptions[index]) return;
    setActiveVideoIndex(index);
    const relativeSeconds = Math.max(0, currentVideoTime + videoOptions[index].offsetSeconds);
    setPlayerStartSeconds(relativeSeconds);
    setPlayerSeekRevision((rev) => rev + 1);
  };

  const handleReset = () => {
    setPhase("landing");
    setForm(createInitialForm());
    setFights([]);
    setReportMeta(null);
    setVideoOptions([]);
    setActiveVideoIndex(0);
    setPlayerStartSeconds(0);
    setPlayerSeekRevision((rev) => rev + 1);
    setActorClassMap({});
    setActiveReportId(null);
    setVodOffsetSeconds(null);
    setStatus({ kind: "idle", message: "" });
    setLoading(false);
    setCurrentVideoTime(0);
  };

  const statusClass =
    status.kind === "error"
      ? "text-rose-400"
      : status.kind === "success"
        ? "text-emerald-400"
        : "text-slate-300";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <nav className="border-b border-white/5 bg-slate-950/70">
        <div className="mx-auto flex w-full items-center justify-between gap-6 px-8 py-4 lg:px-12">
          <button
            type="button"
            onClick={() => setPhase("landing")}
            className="text-lg font-semibold tracking-[0.18em] text-amber-200 transition hover:text-amber-100"
          >
            VODSync
          </button>
          {phase === "review" ? (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3 text-xs text-slate-300">
              <div className="flex flex-col gap-0.5 text-right">
                {reportSubtitle && <span className="text-sm text-slate-200">{reportSubtitle}</span>}
                {status.kind === "success" && status.message ? (
                  <span className="text-xs text-emerald-400">{status.message}</span>
                ) : null}
              </div>
              {!!timestampList.length && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(timestampList.join("\n"))
                      .then(() =>
                        setStatus({
                          kind: "success",
                          message: "Copied timestamps to clipboard.",
                        }),
                      )
                      .catch(() =>
                        setStatus({
                          kind: "error",
                          message: "Clipboard copy failed. Select manually instead.",
                        }),
                      );
                  }}
                  className="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-900"
                >
                  Copy timestamps
                </button>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                New report
              </button>
            </div>
          ) : (
            <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Warcraft Logs Companion
            </span>
          )}
        </div>
      </nav>

      <main className="w-full px-8 py-10 lg:px-12">
        {phase === "landing" ? (
          <LandingHero
            form={form}
            setForm={setForm}
            loading={loading}
            onSubmit={handleSubmit}
            statusClass={statusClass}
            statusMessage={status.message}
          />
        ) : (
          <ReviewWorkspace
            playerRef={playerRef}
            videoSource={activeVideo?.source ?? null}
            fights={fights}
            groupedFights={groupedFights}
            reportSubtitle={reportSubtitle}
            timestampList={timestampList}
            onJump={handleJump}
            currentVideoTime={currentVideoTime}
            setStatus={setStatus}
            statusClass={statusClass}
            statusMessage={status.message}
            hasVideo={hasVideo}
            videoOptions={videoOptions}
            activeVideoIndex={activeVideoIndex}
            onVideoSelect={handleVideoSelect}
            playerStartSeconds={playerStartSeconds}
            playerSeekRevision={playerSeekRevision}
            actorClassMap={actorClassMap}
          />
        )}
      </main>
    </div>
  );
}

export default App;

interface LandingHeroProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  loading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  statusClass: string;
  statusMessage: string;
}

function LandingHero({
  form,
  setForm,
  loading,
  onSubmit,
  statusClass,
  statusMessage,
}: LandingHeroProps) {
  const updateVideoEntry = (index: number, field: keyof VideoFormEntry, value: string) => {
    setForm((prev) => {
      const nextVideos = prev.videos.map((video, idx) =>
        idx === index ? { ...video, [field]: value } : video,
      );
      return { ...prev, videos: nextVideos };
    });
  };

  const addVideoEntry = () => {
    setForm((prev) => ({
      ...prev,
      videos: [...prev.videos, { ...emptyVideoEntry }],
    }));
  };

  const removeVideoEntry = (index: number) => {
    setForm((prev) => {
      const nextVideos = prev.videos.filter((_, idx) => idx !== index);
      return { ...prev, videos: nextVideos.length ? nextVideos : [{ ...emptyVideoEntry }] };
    });
  };

  return (
    <section className="flex justify-center">
      <div className="w-full max-w-xl rounded-3xl border border-white/5 bg-slate-950/80 p-8 shadow-2xl shadow-black/50">
        <h2 className="text-xl font-semibold">Load your report</h2>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="text-slate-300">Report ID</span>
            <input
              type="text"
              required
              value={form.reportId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, reportId: event.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-base outline-none ring-offset-slate-950 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
              placeholder="abc123XYZ"
            />
          </label>
          <div className="space-y-3 rounded-2xl border border-white/5 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">Videos</span>
              <button
                type="button"
                onClick={addVideoEntry}
                className="text-xs font-semibold text-indigo-300 transition hover:text-indigo-200"
              >
                + Add video
              </button>
            </div>
            {form.videos.map((video, index) => (
              <div
                key={`video-${index}`}
                className="rounded-xl border border-slate-800/60 bg-slate-950/60 p-3 text-sm text-slate-300"
              >
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Video URL
                  <input
                    type="url"
                    value={video.url}
                    onChange={(event) => updateVideoEntry(index, "url", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-base text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                    placeholder="https://youtu.be/..."
                  />
                </label>
                <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                  Label (optional)
                  <input
                    type="text"
                    value={video.label}
                    onChange={(event) => updateVideoEntry(index, "label", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-base text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                    placeholder="Main POV, Healer, etc."
                  />
                </label>
                <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                  First Pull Timestamp (HH:MM:SS)
                  <input
                    type="text"
                    value={video.firstPull}
                    onChange={(event) => updateVideoEntry(index, "firstPull", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-base text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                    placeholder="00:00:00"
                  />
                </label>
                {index > 0 && (
                  <button
                    type="button"
                    className="mt-3 text-xs font-semibold text-rose-300 transition hover:text-rose-200"
                    onClick={() => removeVideoEntry(index)}
                  >
                    Remove video
                  </button>
                )}
              </div>
            ))}
            <p className="text-xs text-slate-400">
              For each recording, enter the timestamp (from that video) where the first pull in this
              report appears. This lets the app sync every POV to your log timeline.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.liveMode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, liveMode: event.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
            />
            Live logging mode (auto-refresh)
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-3 text-center text-base font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Loading…" : "Start review"}
          </button>
        </form>
        <p className={`mt-4 text-sm ${statusClass}`}>{statusMessage}</p>
      </div>
    </section>
  );
}

interface ReviewWorkspaceProps {
  playerRef: React.RefObject<VideoPlayerHandle>;
  videoSource: VideoSource | null;
  fights: FightRow[];
  groupedFights: Array<[string, FightRow[]]>;
  reportSubtitle: string;
  timestampList: string[];
  onJump: (seconds: number) => void;
  currentVideoTime: number;
  setStatus: React.Dispatch<React.SetStateAction<StatusState>>;
  statusClass: string;
  statusMessage: string;
  hasVideo: boolean;
  videoOptions: VideoOption[];
  activeVideoIndex: number;
  onVideoSelect: (index: number) => void;
  playerStartSeconds: number;
  playerSeekRevision: number;
  actorClassMap: Record<string, string>;
}

function ReviewWorkspace({
  playerRef,
  videoSource,
  fights,
  groupedFights,
  reportSubtitle,
  timestampList,
  onJump,
  currentVideoTime,
  setStatus,
  statusClass,
  statusMessage,
  hasVideo,
  videoOptions,
  activeVideoIndex,
  onVideoSelect,
  playerStartSeconds,
  playerSeekRevision,
  actorClassMap,
}: ReviewWorkspaceProps) {
  const [selectedFight, setSelectedFight] = useState<FightRow | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubVideoSeconds, setScrubVideoSeconds] = useState<number | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedFight && fights.length) {
      setSelectedFight(fights[0]);
    }
  }, [selectedFight, fights]);

  useEffect(() => {
    const activeFight =
      fights.find(
        (fight) =>
          currentVideoTime >= fight.videoSeconds &&
          currentVideoTime < fight.videoSeconds + fight.durationSeconds,
      ) ?? null;
    if (activeFight && activeFight !== selectedFight) {
      setSelectedFight(activeFight);
    }
  }, [currentVideoTime, fights, selectedFight]);

  const displayedVideoSeconds =
    isScrubbing && scrubVideoSeconds != null ? scrubVideoSeconds : currentVideoTime;
  const selectedFightDuration = selectedFight?.durationSeconds ?? 0;
  const relativeCurrentSeconds = selectedFight
    ? clamp(displayedVideoSeconds - selectedFight.videoSeconds, 0, selectedFightDuration)
    : 0;
  const currentPercent =
    selectedFightDuration > 0 ? (relativeCurrentSeconds / selectedFightDuration) * 100 : 0;
  const clampedPercent = clamp(currentPercent, 0, 100);

  const groupedDeathMarkers = useMemo(() => {
    if (!selectedFight) return [];
    const sorted = [...selectedFight.deaths].sort(
      (a, b) => a.offsetSeconds - b.offsetSeconds,
    );
    const groups: Array<{ offsetSeconds: number; offsetText: string; markers: FightRow["deaths"] }> = [];
    sorted.forEach((death) => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && Math.abs(death.offsetSeconds - lastGroup.offsetSeconds) <= 2) {
        lastGroup.markers.push(death);
        lastGroup.offsetSeconds = Math.min(lastGroup.offsetSeconds, death.offsetSeconds);
        lastGroup.offsetText = formatDuration(lastGroup.offsetSeconds);
      } else {
        groups.push({
          offsetSeconds: death.offsetSeconds,
          offsetText: death.offsetText,
          markers: [death],
        });
      }
    });
    return groups;
  }, [selectedFight]);

  const phaseMarkers = useMemo(() => selectedFight?.phaseMarkers ?? [], [selectedFight]);
  const bloodlustMarkers = useMemo(() => selectedFight?.bloodlusts ?? [], [selectedFight]);

  const getVideoSecondsFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !selectedFight) {
      return null;
    }
    const rect = timelineRef.current.getBoundingClientRect();
    if (!rect.width) return selectedFight.videoSeconds;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return selectedFight.videoSeconds + ratio * selectedFight.durationSeconds;
  };

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasVideo) return;
    event.preventDefault();
    const nextSeconds = getVideoSecondsFromPointer(event);
    if (nextSeconds == null) return;
    timelineRef.current?.setPointerCapture(event.pointerId);
    setIsScrubbing(true);
    setScrubVideoSeconds(nextSeconds);
    onJump(nextSeconds);
  };

  const handleTimelinePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing || !hasVideo) return;
    event.preventDefault();
    const nextSeconds = getVideoSecondsFromPointer(event);
    if (nextSeconds == null) return;
    setScrubVideoSeconds(nextSeconds);
    onJump(nextSeconds);
  };

  const endScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    event.preventDefault();
    timelineRef.current?.releasePointerCapture(event.pointerId);
    setIsScrubbing(false);
    setScrubVideoSeconds(null);
  };

  const handleTimelinePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    const nextSeconds = getVideoSecondsFromPointer(event);
    endScrub(event);
    if (hasVideo && nextSeconds != null) {
      onJump(nextSeconds);
    }
  };

  const handleTimelinePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    endScrub(event);
  };

  const handleTimelineKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasVideo || !selectedFight) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 5;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const nextRelative = clamp(
        relativeCurrentSeconds + direction * step,
        0,
        selectedFightDuration,
      );
      const absoluteSeconds = selectedFight.videoSeconds + nextRelative;
      onJump(absoluteSeconds);
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      playerRef.current?.togglePlayback?.();
    }
  };

  return (
    <div className="space-y-6">
      {selectedFight && (
        <section className="3xl border border-black/5 bg-slate-950/80 p-5 shadow-2xl shadow-black/40">
          <div className="space-y-3 text-sm text-slate-300">
            <div
              ref={timelineRef}
              className={`relative h-8 w-full border border-slate-800 bg-slate-950/80 shadow-inner shadow-black/40 transition ${hasVideo ? "cursor-ew-resize" : "cursor-not-allowed opacity-70"}`}
              role="slider"
              aria-label="Selected fight timeline"
              aria-valuemin={0}
              aria-valuemax={selectedFightDuration}
              aria-valuenow={relativeCurrentSeconds}
              aria-disabled={!hasVideo}
              onPointerDown={handleTimelinePointerDown}
              onPointerMove={handleTimelinePointerMove}
              onPointerUp={handleTimelinePointerUp}
              onPointerLeave={handleTimelinePointerLeave}
              onPointerCancel={handleTimelinePointerLeave}
              tabIndex={hasVideo ? 0 : -1}
              onKeyDown={handleTimelineKeyDown}
            >
              <div className="relative h-full w-full overflow-hidden">
                <div className="pointer-events-none absolute inset-0">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400/25 via-emerald-300/15 to-transparent"
                    style={{ width: `${clampedPercent}%` }}
                  ></div>
                  <div className="absolute inset-y-0 left-0 border-l border-emerald-300/60" style={{ width: `${clampedPercent}%` }}></div>
                </div>
                <div className="relative z-10 flex h-full w-full border-x border-white/5">
                  {selectedFight.phaseSegments.map((segment, idx) => {
                    const segDuration = Math.max(0, segment.endSeconds - segment.startSeconds);
                    const widthPercent =
                      selectedFight.durationSeconds > 0
                        ? (segDuration / selectedFight.durationSeconds) * 100
                        : 0;
                    const label = segment.label || `P${idx + 1}`;
                    const cls = segment.isIntermission ? "bg-fuchsia-500/70" : "bg-sky-500/70";
                    return (
                      <div
                        key={`${label}-${idx}`}
                        className={cls}
                        style={{ width: `${Math.max(widthPercent, 4)}%` }}
                        title={label}
                      ></div>
                    );
                  })}
                </div>
              </div>
              <div className="pointer-events-none absolute inset-0">
                {phaseMarkers.map((marker, idx) => {
                  const leftPercent =
                    selectedFight.durationSeconds > 0
                      ? (marker.offsetSeconds / selectedFight.durationSeconds) * 100
                      : 0;
                  const markerClass = marker.isIntermission
                    ? "bg-fuchsia-600/90 border-fuchsia-300/60"
                    : "bg-sky-600/90 border-sky-300/60";
                  return (
                    <div
                      key={`${marker.label}-${idx}-${marker.offsetSeconds}`}
                      className="absolute -top-8 flex -translate-x-1/2 flex-col items-center text-[0.6rem] font-semibold uppercase tracking-tight text-white drop-shadow"
                      style={{ left: `${leftPercent}%` }}
                    >
                      <div className={`rounded border px-1.5 py-0.5 ${markerClass}`}>{marker.label}</div>
                      <span className="mt-1 h-10 w-0.5 bg-white/70"></span>
                    </div>
                  );
                })}
              </div>
              {bloodlustMarkers.map((marker, idx) => (
                <div
                  key={`${selectedFight.pull}-lust-${idx}-${marker.offsetSeconds}`}
                  className="absolute -top-12 z-10 -translate-x-1/2"
                  style={{
                    left:
                      selectedFight.durationSeconds > 0
                        ? `${(marker.offsetSeconds / selectedFight.durationSeconds) * 100}%`
                        : "0%",
                  }}
                >
                  <div className="group flex flex-col items-center text-[0.55rem] font-semibold uppercase tracking-tight text-white">
                    <div className="rounded border border-sky-300 bg-sky-500/90 px-1.5 py-0.5 text-slate-950 shadow">
                      BL
                    </div>
                    <span className="mt-1 h-6 w-0.5 bg-sky-300"></span>
                    <div className="pointer-events-none mt-1 whitespace-nowrap rounded border border-slate-800 bg-slate-900/95 px-2 py-1 text-[0.55rem] text-slate-100 opacity-0 shadow-lg shadow-black/40 transition group-hover:opacity-100">
                      <p className="font-semibold text-sky-200">{marker.ability}</p>
                      <p className="text-slate-300">{marker.caster}</p>
                      <p className="text-slate-400">{marker.offsetText}</p>
                    </div>
                  </div>
                </div>
              ))}
              {groupedDeathMarkers.map((group, idx) => (
                <div
                  key={`${selectedFight.pull}-death-group-${idx}`}
                  className="absolute z-20 top-0 -translate-x-1/2"
                  style={{ left: `${(group.offsetSeconds / selectedFight.durationSeconds) * 100}%` }}
                >
                  <div className="flex h-full flex-col items-center">
                    <div className="group -translate-y-full pb-2 text-xs text-rose-200">
                      <div className="relative text-lg leading-none">
                        <span role="img" aria-label="death">
                        💀
                        </span>
                        {group.markers.length > 1 && (
                          <span className="absolute -right-2 -top-2 rounded-full bg-rose-600 px-1.5 py-0.5 text-[0.55rem] font-bold text-white shadow">
                            {group.markers.length}
                          </span>
                        )}
                        <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-slate-800 bg-slate-900/95 px-2 py-1 text-[0.6rem] font-semibold text-slate-100 opacity-0 shadow-lg shadow-black/40 transition group-hover:opacity-100">
                          <p className="text-rose-200">
                            {group.markers.length > 1
                              ? `${group.markers.length} deaths @ ${group.offsetText}`
                              : `${group.markers[0].player} @ ${group.offsetText}`}
                          </p>
                          {group.markers.length > 1 && (
                            <ul className="mt-1 space-y-0.5 text-left text-[0.55rem] text-slate-200">
                              {group.markers.map((marker, markerIdx) => (
                                <li key={`${marker.player}-${markerIdx}`}>
                                  {marker.player}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="h-full w-0.5 bg-gradient-to-b from-rose-200 to-rose-500"></span>
                  </div>
                </div>
              ))}
              <div className="pointer-events-none absolute inset-0 z-30">
                <span
                  className="absolute inset-y-0 w-0.5 bg-gradient-to-b from-emerald-100 to-emerald-400"
                  style={{
                    left: `${clampedPercent}%`,
                    transform: "translateX(-50%)",
                  }}
                ></span>
                <div
                  className="absolute top-full flex flex-col items-center text-xs text-emerald-100"
                  style={{
                    left: `${clampedPercent}%`,
                    transform: "translate(-50%, 0)",
                    marginTop: "0.5rem",
                  }}
                >
                  <div className="mb-1 rounded-sm border border-emerald-300/60 bg-emerald-400/90 px-2 py-0.5 text-[0.65rem] font-semibold text-slate-950 shadow-lg shadow-emerald-500/30">
                    {formatDuration(relativeCurrentSeconds)}
                  </div>
                  <span className="h-3 w-3 rotate-45 rounded-sm border border-slate-900 bg-emerald-300 shadow shadow-emerald-500/40"></span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="border border-white/5 bg-slate-950/80 p-4 shadow-2xl shadow-black/40">
          <VideoPlayer
            ref={playerRef}
            source={videoSource}
            startSeconds={playerStartSeconds}
            seekRevision={playerSeekRevision}
            className="w-full"
          />
          {videoOptions.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-300">
              {videoOptions.map((option, index) => {
                const classColor = getOptionClassColor(option, actorClassMap);
                const textClass = classColor
                  ? ""
                  : index === activeVideoIndex
                    ? "text-indigo-200"
                    : "text-slate-400 hover:text-indigo-200";
                return (
                  <button
                    key={`${option.url}-${index}`}
                    type="button"
                    onClick={() => onVideoSelect(index)}
                    className={`rounded-full border px-4 py-2 font-semibold transition ${
                      index === activeVideoIndex
                        ? "border-indigo-400 bg-indigo-500/20"
                        : "border-slate-700 hover:border-indigo-400"
                    } ${textClass}`}
                    style={classColor ? { color: classColor } : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <section className="space-y-5">
          {groupedFights.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/40 px-6 py-20 text-center text-slate-400">
              No boss pulls were detected in this report.
            </p>
          ) : (
            groupedFights.map(([bossName, pulls]) => (
              <div
                key={bossName}
                className="border border-white/5 bg-slate-950/70 p-4 shadow-inner shadow-black/30"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {bossName}
                  </p>
                  <span className="text-xs text-slate-500">{pulls.length} pulls</span>
                </div>
                <div className="grid gap-1 sm:grid-cols-5 xl:grid-cols-6">
                  {pulls.map((fight, index) => {
                    const latestPhase = fight.phases?.[fight.phases.length - 1];
                    const phaseLabel = latestPhase?.label ?? null;
                    const phasePercent =
                      latestPhase && typeof latestPhase.percentage === "number"
                        ? `${latestPhase.percentage.toFixed(1)}%`
                        : null;
                    const percentValue =
                      latestPhase && typeof latestPhase.percentage === "number"
                        ? Math.min(100, Math.max(0, latestPhase.percentage))
                        : null;
                    const progressValue =
                      typeof percentValue === "number" ? Math.max(0, 100 - percentValue) : null;
                    const fightEndSeconds = fight.videoSeconds + fight.durationSeconds;
                    const isActive =
                      currentVideoTime >= fight.videoSeconds &&
                      currentVideoTime < fightEndSeconds;
                    const isSelected =
                      selectedFight?.bossName === fight.bossName && selectedFight?.pull === fight.pull;
                    const borderClass = isActive
                      ? "border-emerald-400 shadow-emerald-500/40"
                      : isSelected
                        ? "border-indigo-400 shadow-indigo-500/30"
                        : "border-slate-900";
                    const phaseBadge = phaseLabel ?? (fight.kill ? "Kill" : "P1");
                    const pullNumber = `#${fight.pull ?? index + 1}`;
                    const badgeClass = phaseBadge.startsWith("I")
                      ? "text-fuchsia-300"
                      : "text-amber-200";
                    return (
                      <button
                        key={`${fight.bossName}-${fight.pull}`}
                        type="button"
                        disabled={!hasVideo}
                        onClick={() => {
                          setSelectedFight(fight);
                          onJump(fight.videoSeconds);
                        }}
                        className={`relative flex aspect-square flex-col justify-center gap-2 border bg-gradient-to-br from-slate-900/80 to-slate-950/60 p-2 text-center text-sm transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 ${borderClass}`}
                      >
                        <span className="absolute right-2 top-1 text-xs font-bold text-slate-400">
                          {pullNumber}
                        </span>
                        <p className={`text-[0.95rem] font-semibold uppercase tracking-[0.05em] ${badgeClass}`}>
                          {phaseBadge}
                        </p>
                        <div className="space-y-1 text-base text-slate-100">
                          {phasePercent ? (
                            <p className="font-semibold text-emerald-400">{phasePercent}</p>
                          ) : (
                            <p className="font-semibold text-sky-400">{fight.result}</p>
                          )}
                          <p className="text-[0.8rem] text-slate-200">{fight.durationText}</p>
                        </div>
                        {typeof progressValue === "number" && (
                          <div className="mt-1 h-1 w-full rounded-full bg-slate-800/60">
                            <div
                              className="h-full rounded-full bg-emerald-400"
                              style={{ width: `${progressValue}%` }}
                            ></div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function buildVideoOptionsFromInputs(entries: VideoFormEntry[]): VideoOption[] {
  const trimmed = entries
    .map((entry, index) => ({
      index,
      url: entry.url.trim(),
      firstPull: (entry.firstPull || "00:00:00").trim() || "00:00:00",
      label: (entry.label || "").trim(),
    }))
    .filter((entry) => entry.url.length > 0);
  if (!trimmed.length) {
    return [];
  }
  const parsed = trimmed.map((entry) => {
    let firstPullSeconds: number;
    try {
      firstPullSeconds = parseHhmmss(entry.firstPull);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Video #${entry.index + 1}: ${error.message}`
          : `Video #${entry.index + 1} timestamp is invalid.`,
      );
    }
    const source = detectVideoSource(entry.url);
    if (!source) {
      throw new Error(
        `Video #${entry.index + 1}: Unsupported URL. Use YouTube or a direct .mp4/.webm link.`,
      );
    }
    const displayLabel = entry.label || `Video ${entry.index + 1}`;
    return {
      url: entry.url,
      source,
      firstPullSeconds,
      label: displayLabel,
      characterName: entry.label ? entry.label.trim().toLowerCase() : null,
    };
  });
  parsed.sort((a, b) => a.firstPullSeconds - b.firstPullSeconds);
  const base = parsed[0]?.firstPullSeconds ?? 0;
  return parsed.map((entry) => ({
    ...entry,
    offsetSeconds: entry.firstPullSeconds - base,
  }));
}

function buildActorClassMap(actors: ActorInfo[]): Record<string, string> {
  const map: Record<string, string> = {};
  actors.forEach((actor) => {
    const name = actor?.name?.trim().toLowerCase();
    if (actor?.type === "Player" && name && actor.subType) {
      map[name] = actor.subType;
    }
  });
  return map;
}

function getOptionClassColor(
  option: VideoOption,
  classMap: Record<string, string>,
): string | null {
  const key = option.characterName;
  if (!key) return null;
  const className = classMap[key];
  if (!className) return null;
  return CLASS_COLORS[className] ?? null;
}
