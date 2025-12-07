import { FormEvent, useMemo, useState } from "react";
import {
  fetchDefensiveUsage,
  type DefensivePlayerUsage,
  type DefensiveUsageResponse,
  type DefensiveAbilityUsage,
} from "../lib/defensives";
import { formatDuration, type ReportMeta } from "../lib/logtime";
import { getClassColor } from "../lib/classColors";

type StatusState =
  | { kind: "idle"; message: "" }
  | { kind: "info" | "success" | "error"; message: string };

function DefensiveUsagePage() {
  const [reportId, setReportId] = useState("");
  const [status, setStatus] = useState<StatusState>({ kind: "idle", message: "" });
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DefensiveUsageResponse | null>(null);

  const reportSubtitle = useMemo(() => buildReportSubtitle(data?.report ?? null), [data]);
  const totalDurationSeconds = useMemo(() => {
    if (!data?.fights?.length) return 0;
    const totalMs = data.fights.reduce((sum, fight) => sum + (fight.duration ?? 0), 0);
    return Math.round(totalMs / 1000);
  }, [data]);

  const statusClass =
    status.kind === "error"
      ? "text-rose-400"
      : status.kind === "success"
        ? "text-emerald-400"
        : "text-slate-300";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reportId.trim()) {
      setStatus({ kind: "error", message: "Enter a report ID or URL." });
      return;
    }
    setStatus({ kind: "info", message: "Loading defensive usage…" });
    setLoading(true);

    try {
      const payload = await fetchDefensiveUsage(reportId.trim());
      setData(payload);
      setStatus({
        kind: "success",
        message: `Loaded ${payload.players.length} player${payload.players.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load defensive usage.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-white/5 bg-slate-950/80 p-6 shadow-xl shadow-black/50">
          <h2 className="text-xl font-semibold">Defensive usage</h2>
          <p className="mt-1 text-sm text-slate-400">
            Paste any Warcraft Logs report ID to see casts vs. potential uses for key defensives. Tanks are
            filtered out automatically.
          </p>
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm text-slate-200">
              Report ID
              <input
                type="text"
                required
                value={reportId}
                onChange={(event) => setReportId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-800/80 bg-slate-950/50 px-4 py-2 text-base text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                placeholder="abc123XYZ"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Loading…" : "Analyze defensives"}
            </button>
          </form>
          <p className={`mt-4 text-sm ${statusClass}`}>{status.message}</p>
        </div>

        <div className="lg:col-span-2 rounded-3xl border border-white/5 bg-slate-950/60 p-6 shadow-xl shadow-black/50">
          {data ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Report</p>
                <p className="text-lg font-semibold text-slate-100">
                  {reportSubtitle || "Untitled report"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                <span className="rounded-full border border-slate-800/50 px-3 py-1">
                  {data.players.length} player{data.players.length === 1 ? "" : "s"}
                </span>
                <span className="rounded-full border border-slate-800/50 px-3 py-1">
                  {data.fights.length} boss fight{data.fights.length === 1 ? "" : "s"}
                </span>
                <span className="rounded-full border border-slate-800/50 px-3 py-1">
                  Total {formatDuration(totalDurationSeconds)}
                </span>
              </div>
              {!!data.fights.length && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                  {data.fights.map((fight) => (
                    <span
                      key={`fight-${fight.id}`}
                      className="rounded-full border border-slate-800/40 bg-slate-900/60 px-3 py-1"
                    >
                      {fight.name} · {formatFightDuration(fight.duration)}
                      {fight.kill ? " · Kill" : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-start justify-center text-sm text-slate-400">
              <p>Enter a report ID to populate fight and player data.</p>
            </div>
          )}
        </div>
      </div>

      {data ? (
        data.players.length ? (
          <div className="space-y-4">
            {data.abilities?.length ? (
              <section className="rounded-3xl border border-white/5 bg-slate-950/70 p-5 shadow-xl shadow-black/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-100">Teamwide defensive usage</h3>
                  <p className="text-xs text-slate-400">
                    Shows total casts vs. potential casts for every defensive in scope.
                  </p>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.abilities.map((ability) => (
                    <AggregatedAbilityCard key={`${ability.id ?? ability.name}`} ability={ability} />
                  ))}
                </div>
              </section>
            ) : null}
            {data.players.map((player) => (
              <DefensivePlayerCard key={`${player.id ?? player.name}`} player={player} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-700/70 bg-slate-950/50 px-6 py-8 text-center text-sm text-slate-400">
            No qualifying defensive casts were found for this report.
          </p>
        )
      ) : (
        <p className="text-sm text-slate-400">
          This tool focuses on defensives such as Ice Block, Exhilaration, Turtle, Darkness, and similar spells
          to help you spot missed cooldowns. Use it alongside the VOD review workspace for deeper analysis.
        </p>
      )}
    </section>
  );
}

export default DefensiveUsagePage;

interface DefensivePlayerCardProps {
  player: DefensivePlayerUsage;
}

function DefensivePlayerCard({ player }: DefensivePlayerCardProps) {
  const classColor = getClassColor(player.className);
  const subtitle = [player.specName, player.className].filter(Boolean).join(" • ");
  return (
    <article className="rounded-3xl border border-white/5 bg-slate-950/70 p-5 shadow-xl shadow-black/40">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: classColor ?? "#94a3b8" }}></div>
            <h3 className="text-lg font-semibold text-slate-100">{player.name}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-400">{subtitle || "Player"}</p>
        </div>
        <div className="text-right text-sm text-slate-300">
          <p className="font-semibold text-slate-100">
            {player.totalUses}
            {player.maxPossibleUses > 0 ? ` / ${player.maxPossibleUses}` : ""} use
            {player.totalUses === 1 ? "" : "s"}
          </p>
          {player.maxPossibleUses > 0 && (
            <p className="text-xs text-slate-400">
              {Math.min(100, Math.round((player.totalUses / player.maxPossibleUses) * 100))}% potential coverage
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {player.abilities.map((ability) => (
          <AbilityUsageRow key={`${player.id ?? player.name}-${ability.id ?? ability.name}`} ability={ability} />
        ))}
      </div>
    </article>
  );
}

interface AbilityUsageRowProps {
  ability: DefensivePlayerUsage["abilities"][number];
}

function AbilityUsageRow({ ability }: AbilityUsageRowProps) {
  const iconUrl = getAbilityIconUrl(ability.icon);
  const percent = ability.possible > 0 ? Math.min(100, Math.round((ability.uses / ability.possible) * 100)) : null;
  const ratioText = ability.possible > 0 ? `${ability.uses}/${ability.possible}` : `${ability.uses}`;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800/60 bg-slate-950/60 p-3">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={ability.name}
          className="h-10 w-10 rounded-full border border-slate-800 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-300">
          {ability.name.slice(0, 1)}
        </div>
      )}
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-100">{ability.name}</p>
        <p className="text-xs text-slate-400">{percent != null ? `Used ${ratioText} • ${percent}%` : `${ratioText} use${ability.uses === 1 ? "" : "s"}`}</p>
        {percent != null && (
          <div className="mt-2 h-1.5 rounded-full bg-slate-900">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${percent}%` }}></div>
          </div>
        )}
      </div>
    </div>
  );
}

function AggregatedAbilityCard({ ability }: { ability: DefensiveAbilityUsage }) {
  const iconUrl = getAbilityIconUrl(ability.icon);
  const displayPercent = ability.possible > 0 ? Math.min(100, Math.round((ability.uses / ability.possible) * 100)) : null;
  const ratioLabel = ability.possible > 0 ? `${ability.uses}/${ability.possible}` : `${ability.uses}`;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800/60 bg-slate-950/60 p-3">
      {iconUrl ? (
        <img src={iconUrl} alt={ability.name} className="h-10 w-10 rounded-full border border-slate-800 object-cover" loading="lazy" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-300">
          {ability.name.slice(0, 1)}
        </div>
      )}
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-100">{ability.name}</p>
        <p className="text-xs text-slate-400">{displayPercent != null ? `Used ${ratioLabel} • ${displayPercent}%` : `${ratioLabel} use${ability.uses === 1 ? "" : "s"}`}</p>
        {displayPercent != null && (
          <div className="mt-2 h-1.5 rounded-full bg-slate-900">
            <div className="h-full rounded-full bg-indigo-400" style={{ width: `${displayPercent}%` }}></div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildReportSubtitle(report: ReportMeta | null): string {
  if (!report) return "";
  const parts: string[] = [];
  if (report.title) parts.push(report.title);
  if (report.owner) parts.push(`by ${report.owner}`);
  if (report.zone) {
    if (typeof report.zone === "number") {
      parts.push(`Zone #${report.zone}`);
    } else if (report.zone.name) {
      parts.push(report.zone.name);
    }
  }
  return parts.join(" • ");
}

function formatFightDuration(duration: number | null): string {
  if (!duration || duration <= 0) return "00:00";
  return formatDuration(Math.round(duration / 1000));
}

function getAbilityIconUrl(icon: string | null): string | null {
  if (!icon) {
    return null;
  }
  if (/^https?:/i.test(icon)) {
    return icon;
  }
  const cleaned = icon
    .trim()
    .toLowerCase()
    .replace(/\.(png|jpe?g|gif)$/i, "")
    .replace(/[^a-z0-9_]/g, "_");
  if (!cleaned) {
    return null;
  }
  return `https://wow.zamimg.com/images/wow/icons/large/${cleaned}.jpg`;
}
