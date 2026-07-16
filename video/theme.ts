import type { CSSProperties } from "react";

// Synchronized with the Brand Kit v2 :root tokens in src/styles.css. Keeping
// the values on the Remotion canvas is required because rendered compositions
// do not inherit the authenticated application's document root.
export const OVERWATCH_VIDEO_THEME = {
  "--background": "#faf9f5",
  "--foreground": "#1f1e1b",
  "--secondary": "#f0eee6",
  "--muted-foreground": "#76736b",
  "--hairline": "#e4e1d6",
  "--signal": "#d97757",
  "--signal-foreground": "#231a15",
  "--clay": "#c36e4f",
  "--dark-panel": "#1f1e1b",
  "--dark-panel-foreground": "#fbf6ec",
  "--success": "#4c8055",
} as CSSProperties;
