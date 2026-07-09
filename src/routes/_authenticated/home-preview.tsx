import { createFileRoute, redirect } from "@tanstack/react-router";

// RETIRED. The redesigned Portfolio / Home (option 6a) was promoted onto / at the
// cutover, so this preview route is gone — anyone hitting an old /home-preview
// bookmark or QA link lands on the real home. Kept as a redirect (not deleted) so
// those links keep resolving instead of 404-ing.
export const Route = createFileRoute("/_authenticated/home-preview")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
