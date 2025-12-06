import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";
import type { VideoSource } from "../lib/video";

export interface VideoPlayerHandle {
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  togglePlayback(): void;
}

interface VideoPlayerProps {
  source?: VideoSource | null;
  className?: string;
  startSeconds?: number;
  seekRevision?: number;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ source, className, startSeconds = 0, seekRevision = 0 }, ref) => {
    const htmlVideoRef = useRef<HTMLVideoElement | null>(null);
    const youtubePlayerRef = useRef<YT.Player | null>(null);
    const containerId = useId();
    const pendingSeekRef = useRef<number | null>(null);
    const htmlMetadataListener = useRef<(() => void) | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        seekTo(seconds: number) {
          if (!source) return;
          if (source.kind === "html5" && htmlVideoRef.current) {
            htmlVideoRef.current.currentTime = seconds;
            void htmlVideoRef.current.play();
          } else if (source.kind === "youtube" && youtubePlayerRef.current) {
            youtubePlayerRef.current.seekTo(seconds, true);
            youtubePlayerRef.current.playVideo();
          }
        },
        getCurrentTime() {
          if (!source) return 0;
          if (source.kind === "html5" && htmlVideoRef.current) {
            return htmlVideoRef.current.currentTime;
          }
          if (source.kind === "youtube" && youtubePlayerRef.current) {
            return youtubePlayerRef.current.getCurrentTime?.() ?? 0;
          }
          return 0;
        },
        togglePlayback() {
          if (!source) return;
          if (source.kind === "html5" && htmlVideoRef.current) {
            if (htmlVideoRef.current.paused) {
              void htmlVideoRef.current.play();
            } else {
              htmlVideoRef.current.pause();
            }
            return;
          }
          if (source.kind === "youtube" && youtubePlayerRef.current) {
            const player = youtubePlayerRef.current;
            const state = player.getPlayerState?.();
            const isPlaying =
              state === window.YT?.PlayerState.PLAYING ||
              state === window.YT?.PlayerState.BUFFERING;
            if (isPlaying) {
              player.pauseVideo();
            } else {
              player.playVideo();
            }
          }
        },
      }),
      [source],
    );

    const applyPendingSeek = useCallback(() => {
      if (!source) return;
      const target = pendingSeekRef.current;
      if (target == null) return;
      if (source.kind === "html5" && htmlVideoRef.current) {
        const video = htmlVideoRef.current;
        const seek = () => {
          if (htmlMetadataListener.current && video) {
            video.removeEventListener("loadedmetadata", htmlMetadataListener.current);
            htmlMetadataListener.current = null;
          }
          if (video) {
            video.currentTime = target;
            pendingSeekRef.current = null;
          }
        };
        if (video.readyState >= 1) {
          seek();
        } else {
          if (htmlMetadataListener.current) {
            video.removeEventListener("loadedmetadata", htmlMetadataListener.current);
          }
          const handler = () => {
            seek();
          };
          htmlMetadataListener.current = handler;
          video.addEventListener("loadedmetadata", handler);
        }
      } else if (source.kind === "youtube" && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(target, true);
        pendingSeekRef.current = null;
      }
    }, [source]);

    useEffect(() => {
      if (!source) return;
      pendingSeekRef.current = startSeconds ?? 0;
      applyPendingSeek();
    }, [source, startSeconds, seekRevision, applyPendingSeek]);

    useEffect(() => {
      return () => {
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
          youtubePlayerRef.current = null;
        }
        if (htmlMetadataListener.current && htmlVideoRef.current) {
          htmlVideoRef.current.removeEventListener("loadedmetadata", htmlMetadataListener.current);
          htmlMetadataListener.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (source?.kind !== "youtube") {
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
          youtubePlayerRef.current = null;
        }
        return;
      }
      let cancelled = false;
      void ensureYoutubeApi().then(() => {
        if (cancelled) return;
        if (!youtubePlayerRef.current) {
          youtubePlayerRef.current = new window.YT.Player(containerId, {
            width: "100%",
            height: "100%",
            videoId: source.videoId,
            playerVars: {
              rel: 0,
              playsinline: 1,
              origin: window.location.origin,
              modestbranding: 1,
            },
            events: {
              onReady: () => {
                applyPendingSeek();
              },
            },
          });
        } else {
          youtubePlayerRef.current.loadVideoById(source.videoId);
          applyPendingSeek();
        }
      });
      return () => {
        cancelled = true;
      };
    }, [source, containerId, applyPendingSeek]);

    return (
      <div className={className || ""}>
        <div className="aspect-video w-full overflow-hidden bg-black">
          {source ? (
            source.kind === "youtube" ? (
              <div id={containerId} className="aspect-video w-full"></div>
            ) : (
              <video
                ref={htmlVideoRef}
                src={source.url}
                controls
                className="h-full w-full rounded-xl"
              />
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
              <p>Add a YouTube link or MP4 URL and load a report to embed the VOD.</p>
              <p className="text-xs text-slate-500">Video controls will unlock once a player is ready.</p>
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default VideoPlayer;

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

function ensureYoutubeApi(): Promise<void> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }
  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }
  youtubeApiPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.append(script);
  });
  return youtubeApiPromise;
}
