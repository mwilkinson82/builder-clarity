import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getStoryboardNarration,
  HARBOR_VIDEO_STORYBOARDS,
} from "../video/content/harbor-storyboards.ts";

const requestedSlug = process.argv[2] ?? HARBOR_VIDEO_STORYBOARDS[0].slug;
const storyboard = HARBOR_VIDEO_STORYBOARDS.find((item) => item.slug === requestedSlug);

if (!storyboard) {
  throw new Error(
    `Unknown Harbor lesson "${requestedSlug}". Use one of: ${HARBOR_VIDEO_STORYBOARDS.map((item) => item.slug).join(", ")}`,
  );
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3";

if (!apiKey || !voiceId) {
  throw new Error(
    "Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID as secure environment variables before generating narration.",
  );
}

const response = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: getStoryboardNarration(storyboard),
      model_id: modelId,
    }),
  },
);

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`ElevenLabs narration failed (${response.status}): ${detail.slice(0, 500)}`);
}

const audioDirectory = resolve("public/onboarding/harbor/audio");
await mkdir(audioDirectory, { recursive: true });
const destination = resolve(audioDirectory, `${storyboard.slug}.mp3`);
await writeFile(destination, Buffer.from(await response.arrayBuffer()));

console.log(`Wrote ${destination}`);
console.log(
  JSON.stringify(
    {
      requestId: response.headers.get("request-id"),
      characterCost: response.headers.get("character-cost"),
      modelId,
    },
    null,
    2,
  ),
);
