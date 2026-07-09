// Real identity for the Portfolio/Home screen (Phase 2): the signed-in user and
// their company, plus a live greeting/dateline. The home's aggregate NUMBERS are
// still placeholder until the next Phase 2 PR — this covers who you are and whose
// software this is (the white-label header). The avatar menu lives in
// ./home-avatar-menu (kept separate so this stays a hooks/util module).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getCompanyWorkspaceContext, getMyProfile } from "@/lib/team.functions";

export type HomeIdentity = {
  loading: boolean;
  companyName: string;
  companyInitials: string;
  companyLogo: string;
  userName: string;
  userFirstName: string;
  userInitials: string;
  userAvatar: string;
  greeting: string;
  dateline: string;
};

export function homeInitials(source: string, fallback = "?") {
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || fallback;
}

export function useHomeIdentity(): HomeIdentity {
  const loadCompany = useServerFn(getCompanyWorkspaceContext);
  const loadProfile = useServerFn(getMyProfile);

  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompany(),
  });
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => loadProfile(),
  });

  return useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const dateline = [
      now.toLocaleDateString(undefined, { weekday: "long" }),
      now.toLocaleDateString(undefined, { month: "long", day: "numeric" }),
      now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    ].join(" · ");

    const companyName = company?.name && company.name !== "Company" ? company.name : "Your company";
    const fullName = profile?.full_name?.trim() || "";
    const email = profile?.email?.trim() || "";
    const userName = fullName || email || "Your account";
    const userFirstName = fullName ? fullName.split(/\s+/)[0] : "there";

    return {
      loading: companyLoading || profileLoading,
      companyName,
      companyInitials: homeInitials(companyName, "CO"),
      companyLogo: company?.logo_url || "",
      userName,
      userFirstName,
      userInitials: homeInitials(fullName || email, "?"),
      userAvatar: profile?.avatar_url || "",
      greeting,
      dateline,
    };
  }, [company, profile, companyLoading, profileLoading]);
}
