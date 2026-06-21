import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthGate,
});

function AuthGate() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!ready) {
    return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  }

  return <Outlet />;
}
