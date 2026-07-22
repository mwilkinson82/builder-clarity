import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Bell, CheckCheck, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { cn } from "@/lib/utils";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  read_at: string | null;
  created_at: string;
};

function ageLabel(createdAt: string) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function NotificationBell({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,type,title,body,url,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const notifications = query.data ?? [];
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  const readMutation = useMutation({
    mutationFn: async (notification: NotificationRow) => {
      if (!notification.read_at) {
        const { error } = await supabase
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", notification.id);
        if (error) throw new Error(error.message);
      }
      return notification;
    },
    onSuccess: (notification) => {
      queryClient.setQueryData<NotificationRow[]>(["notifications"], (current = []) =>
        current.map((row) =>
          row.id === notification.id
            ? { ...row, read_at: row.read_at ?? new Date().toISOString() }
            : row,
        ),
      );
      // notification.url is DB data any org member can seed via
      // create_notification — never navigate to it unvalidated. Only a
      // same-origin relative path is followed; anything else goes home. The
      // sanitization is unchanged — we just navigate client-side (no full page
      // reload) via the router instead of window.location.assign.
      if (notification.url) void router.history.push(safeInternalPath(notification.url));
    },
    onError: (error) => {
      console.error("Mark notification read failed:", error);
      toast.error("Couldn't update that notification", { description: "Try again." });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_all_notifications_read", {});
      if (error) throw new Error(error.message);
    },
    // Optimistically clear the badge; roll back and tell the user if it fails.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previous = queryClient.getQueryData<NotificationRow[]>(["notifications"]);
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationRow[]>(["notifications"], (current = []) =>
        current.map((row) => ({ ...row, read_at: row.read_at ?? readAt })),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<NotificationRow[]>(["notifications"], context.previous);
      }
      console.error("Mark all notifications read failed:", error);
      toast.error("Couldn't mark all as read", { description: "Try again." });
    },
  });

  return (
    <DropdownMenu onOpenChange={(open) => open && void query.refetch()}>
      <DropdownMenuTrigger
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-card text-muted-foreground transition hover:text-foreground",
          className,
        )}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold leading-none text-danger-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              disabled={markAllMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                markAllMutation.mutate();
              }}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-[420px] overflow-y-auto p-1">
          {query.isLoading ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : query.isError ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-2 hover:text-foreground/80"
                disabled={query.isFetching}
                onClick={(event) => {
                  event.preventDefault();
                  void query.refetch();
                }}
              >
                {query.isFetching ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing needs your attention.
            </div>
          ) : (
            notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={cn(
                  "items-start gap-3 rounded-md px-3 py-3",
                  !notification.read_at && "bg-accent/10",
                )}
                onSelect={() => readMutation.mutate(notification)}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                  {notification.type === "billing.paid" ? (
                    <CircleDollarSign className="h-4 w-4" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {notification.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {ageLabel(notification.created_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {notification.body}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
