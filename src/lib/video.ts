export type VideoSource =
  | { kind: "youtube"; videoId: string }
  | { kind: "html5"; url: string };

export async function fetchYoutubeLiveStart(videoId: string): Promise<{ startEpochSeconds: number | null } | null> {
  if (!videoId) return null;
  const response = await fetch(`/api/youtube/live-start?videoId=${encodeURIComponent(videoId)}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YouTube metadata error (${response.status} ${response.statusText}): ${text || "No details"}`);
  }
  return (await response.json()) as { startEpochSeconds: number | null };
}

export function detectVideoSource(rawUrl: string): VideoSource | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    const videoId = extractYoutubeId(parsed);
    return videoId ? { kind: "youtube", videoId } : null;
  }
  if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) {
    return { kind: "html5", url: parsed.toString() };
  }
  return null;
}

export function extractYoutubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  if (host.includes("youtu.be")) {
    const [, slug] = path.split("/");
    if (isYoutubeId(slug)) {
      return slug!;
    }
  }
  if (host.includes("youtube.com")) {
    if (path === "/watch" || path === "/") {
      const id = url.searchParams.get("v");
      if (isYoutubeId(id)) {
        return id!;
      }
    }
    const embedMatch = path.match(/\/(embed|shorts|live)\/([\w-]{11})/);
    if (embedMatch && isYoutubeId(embedMatch[2])) {
      return embedMatch[2];
    }
  }
  return null;
}

function isYoutubeId(value: string | null): value is string {
  return !!value && /^[\w-]{11}$/.test(value);
}
