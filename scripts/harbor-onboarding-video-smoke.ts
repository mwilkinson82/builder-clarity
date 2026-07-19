import { HARBOR_ONBOARDING_LESSONS } from "../src/lib/harbor-onboarding.ts";
import { HARBOR_LESSON_MEDIA } from "../src/lib/harbor-onboarding-media.ts";
import {
  getStoryboardDurationSeconds,
  HARBOR_VIDEO_STORYBOARDS,
} from "../video/content/harbor-storyboards.ts";

const fail = (message: string): never => {
  throw new Error(`[harbor-onboarding-video] ${message}`);
};

if (HARBOR_ONBOARDING_LESSONS.length !== 11) fail("expected 11 onboarding lessons");
if (HARBOR_VIDEO_STORYBOARDS.length !== HARBOR_ONBOARDING_LESSONS.length) {
  fail("every onboarding lesson must have one video storyboard");
}

const compositionIds = new Set<string>();
const slugs = new Set<string>();

for (const [index, lesson] of HARBOR_ONBOARDING_LESSONS.entries()) {
  const storyboard = HARBOR_VIDEO_STORYBOARDS[index];
  if (storyboard.lessonNumber !== lesson.number) {
    fail(`storyboard ${storyboard.compositionId} does not match lesson ${lesson.number}`);
  }
  if (compositionIds.has(storyboard.compositionId)) {
    fail(`duplicate composition id ${storyboard.compositionId}`);
  }
  if (slugs.has(storyboard.slug)) fail(`duplicate video slug ${storyboard.slug}`);
  compositionIds.add(storyboard.compositionId);
  slugs.add(storyboard.slug);

  const duration = getStoryboardDurationSeconds(storyboard);
  if (duration < 45 || duration > 90) {
    fail(`${storyboard.compositionId} must stay between 45 and 90 seconds; received ${duration}`);
  }

  const media = HARBOR_LESSON_MEDIA[lesson.moduleKey];
  if (!media?.title || !media.summary) fail(`missing media manifest for ${lesson.moduleKey}`);
}

console.log(
  JSON.stringify(
    {
      lessons: HARBOR_ONBOARDING_LESSONS.length,
      storyboards: HARBOR_VIDEO_STORYBOARDS.length,
      durations: HARBOR_VIDEO_STORYBOARDS.map((storyboard) => ({
        compositionId: storyboard.compositionId,
        seconds: getStoryboardDurationSeconds(storyboard),
      })),
    },
    null,
    2,
  ),
);
