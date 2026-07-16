import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HARBOR_VIDEO_STORYBOARDS } from "../video/content/harbor-storyboards.ts";

const formatTimestamp = (seconds: number) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(`.${String(remainder).padStart(3, "0")}`);
};

const outputDirectory = resolve("public/onboarding/harbor");
await mkdir(outputDirectory, { recursive: true });

for (const storyboard of HARBOR_VIDEO_STORYBOARDS) {
  let elapsed = 0;
  const cues = storyboard.beats.map((beat, index) => {
    const start = elapsed;
    elapsed += beat.durationSeconds;
    return `${index + 1}\n${formatTimestamp(start)} --> ${formatTimestamp(elapsed)}\n${beat.narration}\n`;
  });
  const destination = resolve(outputDirectory, `${storyboard.slug}.vtt`);
  await writeFile(destination, `WEBVTT\n\n${cues.join("\n")}`, "utf8");
  console.log(`Wrote ${destination}`);
}
