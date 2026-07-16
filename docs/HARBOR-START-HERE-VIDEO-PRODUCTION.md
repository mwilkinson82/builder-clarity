# Harbor Start Here video production

The Harbor Residence Start Here course has eleven lessons. The application owns the course flow and
plays finished media; Remotion owns the reusable motion system; ElevenLabs supplies narration during
production only.

## What is already wired

- `video/content/harbor-storyboards.ts` contains eleven complete storyboards and narration scripts.
- `video/HarborLessonComposition.tsx` is the shared 1920x1080 OverWatch motion template.
- `src/lib/harbor-onboarding-media.ts` maps each course lesson to its media status and public assets.
- `HarborLessonVideo.tsx` uses a native captioned player and never autoplays audio.
- Lesson 1 includes a silent 60-second motion pilot, poster, and English captions.
- The remaining ten lessons show an honest storyboard-ready state until final media exists.

## Commands

```bash
npm run video:install
npm run video:studio
npm run video:captions
npm run test:onboarding-video
npm run video:poster:pilot
npm run video:render:pilot
```

## Generate narration

Keep the API key and voice ID in secure environment variables. Never expose either value through a
`VITE_` variable or client-side code.

```bash
export ELEVENLABS_API_KEY="..."
export ELEVENLABS_VOICE_ID="..."
npm run video:voice -- lesson-01-overwatch-operating-loop
```

The script defaults to `eleven_v3` and writes the MP3 to
`public/onboarding/harbor/audio/<lesson-slug>.mp3`. Use `ELEVENLABS_MODEL_ID` only when intentionally
selecting another supported model.

After narration is generated, render with narration enabled:

```bash
npm --prefix video exec -- remotion render index.ts Harbor-01-Operating-Loop \
  ../public/onboarding/harbor/lesson-01-overwatch-operating-loop.mp4 \
  --public-dir=../public \
  --props='{"includeNarration":true}'
```

Then set `hasNarration: true` for that lesson in `src/lib/harbor-onboarding-media.ts`.

## Approval gate before producing lessons 2–11

Approve the Lesson 1 visual language, voice, pacing, and pronunciation first. Once approved, use the
same composition for every remaining storyboard. This prevents eleven inconsistent videos and avoids
spending narration credits before the course tone is settled.
