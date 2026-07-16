import type { CSSProperties } from "react";
import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadSourceSerif } from "@remotion/google-fonts/SourceSerif4";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { HarborVideoStoryboard } from "./content/harbor-storyboards";
import { OVERWATCH_VIDEO_THEME } from "./theme";

const { fontFamily: archivo } = loadArchivo("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});
const { fontFamily: sourceSerif } = loadSourceSerif("normal", {
  weights: ["500", "600", "700"],
  subsets: ["latin"],
});

export interface HarborLessonCompositionProps {
  storyboard: HarborVideoStoryboard;
  includeNarration: boolean;
}

const beatStartSeconds = (storyboard: HarborVideoStoryboard, beatIndex: number) =>
  storyboard.beats.slice(0, beatIndex).reduce((total, beat) => total + beat.durationSeconds, 0);

export function HarborLessonComposition({
  storyboard,
  includeNarration,
}: HarborLessonCompositionProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentSeconds = frame / fps;
  let beatIndex = 0;

  for (let index = 0; index < storyboard.beats.length; index += 1) {
    if (currentSeconds >= beatStartSeconds(storyboard, index)) beatIndex = index;
  }

  const beat = storyboard.beats[beatIndex];
  const localFrame = frame - beatStartSeconds(storyboard, beatIndex) * fps;
  const entrance = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 95 } });
  const fadeOut = interpolate(
    localFrame,
    [beat.durationSeconds * fps - 12, beat.durationSeconds * fps],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = entrance * fadeOut;
  const translateY = interpolate(entrance, [0, 1], [38, 0]);
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const labelStyle: CSSProperties = {
    color: "var(--clay)",
    fontFamily: archivo,
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  };

  return (
    <AbsoluteFill
      style={{
        ...OVERWATCH_VIDEO_THEME,
        backgroundColor: "var(--dark-panel)",
        color: "var(--dark-panel-foreground)",
        fontFamily: archivo,
        overflow: "hidden",
      }}
    >
      {includeNarration ? (
        <Audio src={staticFile(`onboarding/harbor/audio/${storyboard.slug}.mp3`)} />
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.17,
          backgroundImage:
            "linear-gradient(var(--hairline) 1px, transparent 1px), linear-gradient(90deg, var(--hairline) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 18,
          backgroundColor: "var(--signal)",
        }}
      />

      <header
        style={{
          position: "absolute",
          left: 86,
          right: 86,
          top: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Img
          src={staticFile("overwatch-lockup-reversed.svg")}
          style={{ width: 300, height: "auto" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ ...labelStyle, fontSize: 17 }}>Harbor Residence · Start Here</span>
          <span
            style={{
              border: "1px solid color-mix(in srgb, var(--dark-panel-foreground) 20%, transparent)",
              borderRadius: 999,
              padding: "9px 14px",
              color: "var(--dark-panel-foreground)",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            Lesson {storyboard.lessonNumber}
          </span>
        </div>
      </header>

      <main
        style={{
          position: "absolute",
          left: 118,
          right: 118,
          top: 215,
          bottom: 150,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <p style={labelStyle}>{beat.eyebrow}</p>
        <h1
          style={{
            maxWidth: 1500,
            margin: "22px 0 0",
            fontFamily: sourceSerif,
            fontSize: 94,
            fontWeight: 600,
            letterSpacing: "-0.035em",
            lineHeight: 0.98,
          }}
        >
          {beat.headline}
        </h1>
        <p
          style={{
            maxWidth: 1250,
            margin: "32px 0 0",
            color: "color-mix(in srgb, var(--dark-panel-foreground) 68%, transparent)",
            fontSize: 33,
            lineHeight: 1.42,
          }}
        >
          {beat.body}
        </p>

        {beat.flow ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 46 }}>
            {beat.flow.map((item, index) => {
              const itemEntrance = spring({
                frame: localFrame - index * 5,
                fps,
                config: { damping: 18, stiffness: 110 },
              });
              return (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      minWidth: 190,
                      transform: `scale(${interpolate(itemEntrance, [0, 1], [0.92, 1])})`,
                      opacity: itemEntrance,
                      border:
                        "1px solid color-mix(in srgb, var(--dark-panel-foreground) 18%, transparent)",
                      borderRadius: 18,
                      backgroundColor:
                        index === beat.flow!.length - 1
                          ? "color-mix(in srgb, var(--signal) 20%, transparent)"
                          : "color-mix(in srgb, var(--dark-panel-foreground) 6%, transparent)",
                      padding: "20px 24px",
                      textAlign: "center",
                      fontSize: 23,
                      fontWeight: 700,
                    }}
                  >
                    {item}
                  </div>
                  {index < beat.flow!.length - 1 ? (
                    <span style={{ color: "var(--signal)", fontSize: 28 }}>→</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </main>

      <footer
        style={{
          position: "absolute",
          left: 86,
          right: 86,
          bottom: 54,
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <span style={{ ...labelStyle, minWidth: 250, fontSize: 16 }}>{storyboard.role}</span>
        <div
          style={{
            height: 5,
            flex: 1,
            overflow: "hidden",
            borderRadius: 999,
            backgroundColor: "color-mix(in srgb, var(--dark-panel-foreground) 14%, transparent)",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: "var(--signal)",
            }}
          />
        </div>
        <span style={{ color: "var(--dark-panel-foreground)", fontSize: 18, fontWeight: 700 }}>
          {beatIndex + 1} / {storyboard.beats.length}
        </span>
      </footer>
    </AbsoluteFill>
  );
}
