// The avatar profile menu for the Portfolio/Home header.
// DECISION (owner): points at Company for now; the full per-user account surface
// (roles/permissions already exist in the DB; targeted notifications land next)
// grows from here. "Your profile" opens the company screen for now — a dedicated
// profile editor is a later step.
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Building2, LogOut, UserRound } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HomeIdentity } from "./home-identity";

export function AvatarMenu({ identity }: { identity: HomeIdentity }) {
  const router = useRouter();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ow-avatar"
        aria-label={`Account — ${identity.userName}`}
        title={identity.userName}
      >
        {identity.userAvatar ? (
          <img
            src={identity.userAvatar}
            alt=""
            style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          identity.userInitials
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="text-sm font-semibold text-foreground">{identity.userName}</div>
          <div className="text-[11px] font-normal text-muted-foreground">
            {identity.companyName}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/team" className="gap-2">
            <UserRound className="h-4 w-4" /> Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/team" className="gap-2">
            <Building2 className="h-4 w-4" /> Company
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="gap-2 text-danger focus:text-danger">
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
