import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      throw redirect({
        to: "/auth",
        search: { next: location.href },
        replace: true,
      });
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      console.warn("Supabase user verification failed; continuing with restored session", error);
      return { user: sessionData.session.user };
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
