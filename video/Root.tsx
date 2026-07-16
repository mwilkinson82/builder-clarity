import { Composition } from "remotion";
import { HarborLessonComposition } from "./HarborLessonComposition";
import {
  getStoryboardDurationSeconds,
  HARBOR_VIDEO_STORYBOARDS,
} from "./content/harbor-storyboards";
import "./theme.css";

const FPS = 30;

export function RemotionRoot() {
  return (
    <>
      {HARBOR_VIDEO_STORYBOARDS.map((storyboard) => (
        <Composition
          key={storyboard.compositionId}
          id={storyboard.compositionId}
          component={HarborLessonComposition}
          durationInFrames={getStoryboardDurationSeconds(storyboard) * FPS}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{ storyboard, includeNarration: false }}
        />
      ))}
    </>
  );
}
