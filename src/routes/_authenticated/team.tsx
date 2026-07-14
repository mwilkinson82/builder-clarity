import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileImage,
  Gauge,
  Globe,
  MailPlus,
  MapPin,
  Phone,
  Send,
  Save,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AppFooter } from "@/components/layout/AppFooter";
import { PortfolioTopBar } from "@/components/layout/PortfolioTopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMPANY_ASSET_BUCKET, companyLogoPath, versionAssetUrl } from "@/lib/company-assets";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { sendOverwatchMagicLink } from "@/lib/auth/magic-link";
import type { StripeConnectDetails } from "@/lib/stripe-connect-status";
import { CapabilityPicker } from "@/components/team/CapabilityPicker";
import { GettingPaidSection } from "@/components/billing/GettingPaidSection";
import { StripeConnectingScreen } from "@/components/billing/StripeConnectingScreen";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ROLE_PRESETS, accessLabelForMember, type CapabilitySet } from "@/lib/capabilities";
import {
  grantClientProjectAccess,
  revokeClientProjectAccess,
  updateClientProjectAccess,
  upsertClientContact,
  type ProjectClientAccessRow,
} from "@/lib/client-portal.functions";
import {
  assignProjectMember,
  createTeamInvite,
  getTeamWorkspace,
  removeProjectMember,
  revokeTeamInvite,
  updateMyProfile,
  updateOrganization,
  updateProjectMember,
  updateTeamMember,
  type AccountRole,
  type MemberStatus,
  type ProjectMemberRole,
} from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/team")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your Company — Overwatch" },
      {
        name: "description",
        content: "Manage Overwatch company profile, seats, roles, and project access.",
      },
    ],
  }),
  component: TeamPage,
});

const roleOptions: { value: AccountRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "executive", label: "Executive" },
  { value: "project_manager", label: "Project manager" },
  { value: "member", label: "Company member" },
  { value: "viewer", label: "Viewer" },
];

const memberStatusOptions: { value: MemberStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

const projectRoleOptions: { value: ProjectMemberRole; label: string }[] = [
  { value: "owner", label: "Project owner" },
  { value: "manager", label: "Manager" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

const clientPermissionFields = [
  { field: "can_view_change_orders", label: "Change orders" },
  { field: "can_view_daily_reports", label: "Daily" },
  { field: "can_view_billing", label: "Billing" },
] as const;

type ClientPermissionField = (typeof clientPermissionFields)[number]["field"];

const COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const COMPANY_LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

const emptyClientInvite = {
  projectId: "",
  name: "",
  email: "",
  company: "",
  title: "",
  phone: "",
  notes: "",
  can_view_change_orders: true,
  can_view_daily_reports: false,
  can_view_billing: false,
};

function roleLabel(role: string) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function projectRoleLabel(role: string) {
  return projectRoleOptions.find((option) => option.value === role)?.label ?? role;
}

function shortDate(value: string) {
  return value ? value.replace("T", " ").slice(0, 10) : "";
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(Math.max(0, Math.round(value)));
}

function formatBytes(bytes: number) {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${formatNumber(safeBytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = safeBytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatUsageValue(used: number, limit: number) {
  const limitLabel = limit > 0 ? formatNumber(limit) : "No cap";
  return `${formatNumber(used)} / ${limitLabel}`;
}

function companyInitials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "OW";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalizeWebsiteInput(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

function meterPercent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

type UsageTone = "default" | "warning" | "danger";

function usageTone(used: number, limit: number): UsageTone {
  if (limit <= 0) return "default";
  const pct = used / limit;
  if (pct >= 1) return "danger";
  if (pct >= 0.8) return "warning";
  return "default";
}

type TeamUsageSnapshot = {
  activeSeats: number;
  pendingInvites: number;
  seatsUsed: number;
  seatLimit: number;
  projectsUsed: number;
  projectLimit: number;
  dailyReports: number;
  dailyReportsTotal: number;
  dailyReportLimit: number;
  attachmentCount: number;
  storageBytes: number;
  storageLimitBytes: number;
  storageUsedLabel: string;
  storageLimitLabel: string;
};

type StripeConnectPayload = {
  accountId?: string;
  accountLinkUrl?: string;
  dashboardUrl?: string;
  activated?: boolean;
  connectStatus?: string;
  mode?: "test" | "live";
  organizationId: string;
  paymentProcessorReady?: boolean;
  connectDetails?: StripeConnectDetails;
};

type StripeConnectAction = {
  action: "onboard" | "activate" | "dashboard" | "status";
  mode: "test" | "live";
  targetWindow?: Window | null;
};

type UsageStatus = {
  tone: UsageTone;
  label: string;
  detail: string;
};

function titleizeCode(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPlanCode(value: string) {
  if (!value) return "Plan not set";
  if (value === "contractor_circle_free") return "Contractor Circle";
  return titleizeCode(value);
}

function formatBillingStatus(value: string) {
  if (!value) return "Billing not set";
  return titleizeCode(value);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.round(value))}%`;
}

function usageStatus(used: number, limit: number, grantActive: boolean): UsageStatus {
  if (limit <= 0) {
    return {
      tone: "default",
      label: "No cap",
      detail: "No plan limit is set for this account yet.",
    };
  }

  const pct = used / limit;
  if (pct >= 1) {
    return {
      tone: grantActive ? "warning" : "danger",
      label: grantActive ? "Over advisory limit" : "Limit reached",
      detail: grantActive
        ? "Contractor Circle grant keeps this company working while paid plan terms are finalized."
        : "Upgrade or reduce usage before adding more work here.",
    };
  }

  if (pct >= 0.8) {
    return {
      tone: "warning",
      label: "Near limit",
      detail: "This account is close enough to plan ahead before onboarding more work.",
    };
  }

  return {
    tone: "default",
    label: "Healthy",
    detail: "Usage is inside the current plan guidance.",
  };
}

type ConsoleSection =
  "people" | "clients" | "plan" | "paid" | "assignments" | "company" | "profile";

const CONSOLE_SECTIONS = new Set<ConsoleSection>([
  "people",
  "clients",
  "plan",
  "paid",
  "assignments",
  "company",
  "profile",
]);

function initialConsoleSection(): ConsoleSection {
  if (typeof window === "undefined") return "people";
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section") as ConsoleSection | null;
  if (requested && CONSOLE_SECTIONS.has(requested)) return requested;
  return params.has("stripe") ? "paid" : "people";
}

function stripeOpeningContext() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("stripe") !== "opening") return null;
  return {
    businessName: (params.get("business") || "your company").slice(0, 120),
    action: params.get("action") === "dashboard" ? ("dashboard" as const) : ("onboard" as const),
  };
}

function TeamPage() {
  const queryClient = useQueryClient();
  const loadTeam = useServerFn(getTeamWorkspace);
  const saveProfile = useServerFn(updateMyProfile);
  const saveOrganization = useServerFn(updateOrganization);
  const createInvite = useServerFn(createTeamInvite);
  const updateMember = useServerFn(updateTeamMember);
  const revokeInvite = useServerFn(revokeTeamInvite);
  const assignMember = useServerFn(assignProjectMember);
  const updateProjectAccess = useServerFn(updateProjectMember);
  const removeProjectAccess = useServerFn(removeProjectMember);
  const saveClientContact = useServerFn(upsertClientContact);
  const grantClientAccess = useServerFn(grantClientProjectAccess);
  const updateClientAccess = useServerFn(updateClientProjectAccess);
  const revokeClientAccess = useServerFn(revokeClientProjectAccess);

  const { data: team, isLoading } = useQuery({
    queryKey: ["team-workspace"],
    queryFn: () => loadTeam(),
  });

  const [profileForm, setProfileForm] = useState({
    full_name: "",
    phone: "",
    company_title: "",
  });
  const [orgForm, setOrgForm] = useState({
    name: "",
    slug: "",
    legal_name: "",
    website_url: "",
    office_phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    license_number: "",
    tax_identifier: "",
    logo_url: "",
    logo_path: "",
    billing_email: "",
    billing_contact_name: "",
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AccountRole>("project_manager");
  const [inviteCapabilities, setInviteCapabilities] = useState<CapabilitySet>({
    ...ROLE_PRESETS.project_manager,
  });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [projectRole, setProjectRole] = useState<ProjectMemberRole>("viewer");
  const [logoInputKey, setLogoInputKey] = useState(0);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoImageFailedUrl, setLogoImageFailedUrl] = useState("");
  const [clientInviteForm, setClientInviteForm] = useState(emptyClientInvite);
  // Client-only: which console section the left nav is showing.
  const [section, setSection] = useState<ConsoleSection>(initialConsoleSection);
  const stripeOpening = stripeOpeningContext();
  const stripeReturnHandled = useRef(false);

  useEffect(() => {
    if (stripeReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const stripeReturn = params.get("stripe");
    if (stripeReturn !== "return" && stripeReturn !== "refresh") return;
    stripeReturnHandled.current = true;
    setSection("paid");
    toast.info("Checking the connected Stripe account", {
      description: "OverWatch is retrieving Stripe's current review and payment-capability status.",
    });
  }, []);

  useEffect(() => {
    if (!team) return;
    setProfileForm({
      full_name: team.currentProfile.full_name,
      phone: team.currentProfile.phone,
      company_title: team.currentProfile.company_title,
    });
    setOrgForm({
      name: team.organization.name,
      slug: team.organization.slug,
      legal_name: team.organization.legal_name,
      website_url: team.organization.website_url,
      office_phone: team.organization.office_phone,
      address_line1: team.organization.address_line1,
      address_line2: team.organization.address_line2,
      city: team.organization.city,
      state: team.organization.state,
      postal_code: team.organization.postal_code,
      country: team.organization.country,
      license_number: team.organization.license_number,
      tax_identifier: team.organization.tax_identifier,
      logo_url: team.organization.logo_url,
      logo_path: team.organization.logo_path,
      billing_email: team.organization.billing_email,
      billing_contact_name: team.organization.billing_contact_name,
    });
    setSelectedProjectId((current) => current || team.projects[0]?.id || "");
    setClientInviteForm((current) => ({
      ...current,
      projectId: current.projectId || team.projects[0]?.id || "",
    }));
    setSelectedUserId(
      (current) =>
        current || team.members.find((member) => member.status === "active")?.user_id || "",
    );
  }, [team]);

  const usage = useMemo(() => {
    if (!team) return null;
    const seatsUsed = team.usage.activeSeats + team.usage.pendingInvites;
    const storageLimitBytes = team.organization.storage_limit_mb * 1024 * 1024;
    return {
      activeSeats: team.usage.activeSeats,
      pendingInvites: team.usage.pendingInvites,
      seatsUsed,
      seatLimit: team.organization.seat_limit,
      projectsUsed: team.usage.projects,
      projectLimit: team.organization.project_limit,
      dailyReports: team.usage.dailyReportsThisMonth,
      dailyReportsTotal: team.usage.dailyReports,
      dailyReportLimit: team.organization.daily_report_limit_per_month,
      attachmentCount: team.usage.dailyReportAttachmentCount,
      storageBytes: team.usage.dailyReportStorageBytes,
      storageLimitBytes,
      storageUsedLabel: formatBytes(team.usage.dailyReportStorageBytes),
      storageLimitLabel: formatBytes(storageLimitBytes),
    };
  }, [team]);

  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["team-workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  };

  const requestStripeConnect = async ({ action, mode }: StripeConnectAction) => {
    if (!team?.organization.id) throw new Error("Company workspace is still loading.");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sign in again before connecting Stripe.");

    const response = await fetch("/api/stripe/connect/account-link", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: team.organization.id,
        action,
        mode,
        returnPath: `/team?section=paid&stripe=return&mode=${mode}`,
        refreshPath: `/team?section=paid&stripe=refresh&mode=${mode}`,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as
      (StripeConnectPayload & { ok?: boolean; error?: string }) | { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Stripe setup did not open.");
    }
    return payload as StripeConnectPayload;
  };

  const profileMutation = useMutation({
    mutationFn: () => saveProfile({ data: profileForm }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Profile saved");
    },
    onError: (error) => {
      toast.error("Profile did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const orgMutation = useMutation({
    mutationFn: () =>
      saveOrganization({
        data: {
          ...orgForm,
          website_url: normalizeWebsiteInput(orgForm.website_url),
        },
      }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Company saved");
    },
    onError: (error) => {
      toast.error("Company did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!team?.organization.id) throw new Error("Company workspace is still loading.");
      if (!COMPANY_LOGO_TYPES.has(file.type)) {
        throw new Error("Company logos must be PNG or JPG files.");
      }
      if (file.size > COMPANY_LOGO_MAX_BYTES) {
        throw new Error("Company logos must be 2 MB or smaller.");
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again before uploading the company logo.");

      const formData = new FormData();
      formData.append("organizationId", team.organization.id);
      formData.append("oldPath", orgForm.logo_path || team.organization.logo_path || "");
      formData.append("logo", file);

      const response = await fetch("/api/company/assets/logo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        logoUrl?: string;
        path?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.ok || !payload.logoUrl || !payload.path) {
        throw new Error(payload?.error || "Company logo upload failed.");
      }

      return { logoUrl: payload.logoUrl, path: payload.path };
    },
    onSuccess: async ({ logoUrl, path }) => {
      setOrgForm((current) => ({ ...current, logo_url: logoUrl, logo_path: path }));
      setLogoImageFailedUrl("");
      setLogoInputKey((key) => key + 1);
      await refreshWorkspace();
      toast.success("Company logo saved");
    },
    onError: (error) => {
      setLogoInputKey((key) => key + 1);
      toast.error("Company logo did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const stripeConnectMutation = useMutation({
    mutationFn: requestStripeConnect,
    onSuccess: async (payload, variables) => {
      if (payload.accountLinkUrl) {
        toast.success(
          variables.mode === "live" ? "Live Stripe setup opened" : "Sandbox setup opened",
          {
            description: "Finish the secure Stripe onboarding screen, then return to Overwatch.",
          },
        );
        variables.targetWindow?.location.replace(payload.accountLinkUrl);
        return;
      }
      if (payload.dashboardUrl) {
        variables.targetWindow?.location.replace(payload.dashboardUrl);
        return;
      }
      if (payload.activated) {
        await refreshWorkspace();
        toast.success("Live payments activated", {
          description: "New invoice checkout sessions now use this company's live Stripe account.",
        });
      }
    },
    onError: (error, variables) => {
      variables.targetWindow?.close();
      toast.error("Stripe setup did not open", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const stripeStatusQuery = useQuery({
    queryKey: ["stripe-connect-status", team?.organization.id, "live"],
    queryFn: () => requestStripeConnect({ action: "status", mode: "live" }),
    enabled: section === "paid" && Boolean(team?.organization.stripe_connect_account_id_live),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const syncedStripeStatus = stripeStatusQuery.data?.connectDetails?.status;
  useEffect(() => {
    if (!syncedStripeStatus) return;
    void queryClient.invalidateQueries({ queryKey: ["team-workspace"] });
  }, [queryClient, syncedStripeStatus]);

  const openStripeInNewTab = (action: "onboard" | "dashboard", mode: "test" | "live") => {
    const openingUrl = new URL("/team", window.location.origin);
    openingUrl.searchParams.set("section", "paid");
    openingUrl.searchParams.set("stripe", "opening");
    openingUrl.searchParams.set("mode", mode);
    openingUrl.searchParams.set("action", action);
    openingUrl.searchParams.set(
      "business",
      stripeStatusQuery.data?.connectDetails?.businessName ||
        team?.organization.name ||
        "your company",
    );
    const targetWindow = window.open(
      `${openingUrl.pathname}${openingUrl.search}`,
      "overwatch-stripe",
    );
    if (!targetWindow) {
      toast.error("Allow pop-ups to open Stripe", {
        description: "OverWatch keeps this page open and launches Stripe in a separate tab.",
      });
      return;
    }
    targetWindow.opener = null;
    targetWindow.focus();
    stripeConnectMutation.mutate({ action, mode, targetWindow });
  };

  const selectSection = (next: ConsoleSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    url.searchParams.delete("stripe");
    url.searchParams.delete("mode");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  // Billing contact lives in Getting Paid but writes through the same
  // updateOrganization call as the company record. The validator blanks any
  // omitted field, so send the full organization payload from server truth.
  const billingContactMutation = useMutation({
    mutationFn: (next: { name: string; email: string }) => {
      if (!team) throw new Error("Company workspace is still loading.");
      const organization = team.organization;
      return saveOrganization({
        data: {
          name: organization.name,
          slug: organization.slug,
          legal_name: organization.legal_name,
          website_url: normalizeWebsiteInput(organization.website_url),
          office_phone: organization.office_phone,
          address_line1: organization.address_line1,
          address_line2: organization.address_line2,
          city: organization.city,
          state: organization.state,
          postal_code: organization.postal_code,
          country: organization.country,
          license_number: organization.license_number,
          tax_identifier: organization.tax_identifier,
          logo_url: organization.logo_url,
          logo_path: organization.logo_path,
          billing_contact_name: next.name,
          billing_email: next.email,
        },
      });
    },
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Billing contact saved");
    },
    onError: (error) => {
      toast.error("Billing contact did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase();
      if (!email) throw new Error("Enter an email address.");
      await createInvite({
        data: { email, role: inviteRole, capabilities: inviteCapabilities },
      });
      await sendOverwatchMagicLink({ email, next: "/", context: "company_invite" });
      return email;
    },
    onSuccess: async (email) => {
      await refreshWorkspace();
      toast.success("Company invite sent", {
        description: `${email} can sign in to Overwatch.`,
      });
      setInviteEmail("");
      setInviteRole("project_manager");
      setInviteCapabilities({ ...ROLE_PRESETS.project_manager });
    },
    onError: (error) => {
      toast.error("Invite did not send", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const memberMutation = useMutation({
    mutationFn: (payload: {
      membershipId: string;
      role?: AccountRole;
      status?: "active" | "disabled";
      capabilities?: CapabilitySet;
    }) => updateMember({ data: payload }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Company member updated");
    },
    onError: (error) => {
      toast.error("Company member did not update", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Invite revoked");
    },
    onError: (error) => {
      toast.error("Invite did not revoke", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => {
      if (!selectedProjectId) throw new Error("Choose a project.");
      if (!selectedUserId) throw new Error("Choose a company member.");
      return assignMember({
        data: { projectId: selectedProjectId, userId: selectedUserId, role: projectRole },
      });
    },
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Project access updated");
    },
    onError: (error) => {
      toast.error("Project access did not update", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const projectAccessMutation = useMutation({
    mutationFn: (payload: {
      membershipId: string;
      role?: ProjectMemberRole;
      status?: "active" | "disabled";
    }) => updateProjectAccess({ data: payload }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Project member updated");
    },
    onError: (error) => {
      toast.error("Project member did not update", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const removeProjectAccessMutation = useMutation({
    mutationFn: (membershipId: string) => removeProjectAccess({ data: { membershipId } }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Project access removed");
    },
    onError: (error) => {
      toast.error("Project access did not remove", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const clientInviteMutation = useMutation({
    mutationFn: async () => {
      const projectId = clientInviteForm.projectId;
      const email = clientInviteForm.email.trim().toLowerCase();
      if (!projectId) throw new Error("Choose the project this client should access.");
      if (!clientInviteForm.name.trim()) throw new Error("Enter the client contact name.");
      if (!email) throw new Error("Enter the client email address.");

      const contactResult = await saveClientContact({
        data: {
          projectId,
          name: clientInviteForm.name,
          email,
          company: clientInviteForm.company,
          title: clientInviteForm.title,
          phone: clientInviteForm.phone,
          notes: clientInviteForm.notes,
        },
      });
      const accessResult = await grantClientAccess({
        data: { projectId, contactId: contactResult.contact.id },
      });
      const access = accessResult.access as ProjectClientAccessRow;
      await updateClientAccess({
        data: {
          accessId: access.id,
          can_view_change_orders: clientInviteForm.can_view_change_orders,
          can_view_daily_reports: clientInviteForm.can_view_daily_reports,
          can_view_billing: clientInviteForm.can_view_billing,
        },
      });
      await sendOverwatchMagicLink({
        email,
        next: `/client/projects/${projectId}`,
        context: "client_portal",
      });
      await updateClientAccess({
        data: { accessId: access.id, last_sent_at: new Date().toISOString() },
      });
      return { email, projectId };
    },
    onSuccess: async ({ email, projectId }) => {
      await refreshWorkspace();
      toast.success("Client portal invite sent", {
        description: `${email} can open the selected project portal.`,
      });
      setClientInviteForm({
        ...emptyClientInvite,
        projectId,
      });
    },
    onError: (error) => {
      toast.error("Client invite did not send", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const clientAccessPermissionMutation = useMutation({
    mutationFn: (payload: { accessId: string; field: ClientPermissionField; value: boolean }) =>
      updateClientAccess({ data: { accessId: payload.accessId, [payload.field]: payload.value } }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Client access updated");
    },
    onError: (error) => {
      toast.error("Client access did not update", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const clientAccessRevokeMutation = useMutation({
    mutationFn: (accessId: string) => revokeClientAccess({ data: { accessId } }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Client access removed");
    },
    onError: (error) => {
      toast.error("Client access did not remove", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const clientAccessSendLinkMutation = useMutation({
    mutationFn: async (access: {
      id: string;
      email: string;
      project_id: string;
      project_name: string;
    }) => {
      await sendOverwatchMagicLink({
        email: access.email,
        next: `/client/projects/${access.project_id}`,
        context: "client_portal",
      });
      await updateClientAccess({
        data: { accessId: access.id, last_sent_at: new Date().toISOString() },
      });
      return access;
    },
    onSuccess: async (access) => {
      await refreshWorkspace();
      toast.success("Client portal link sent", {
        description: `${access.email} can open ${access.project_name}.`,
      });
    },
    onError: (error) => {
      toast.error("Client portal link did not send", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const storageLogoUrl = useMemo(() => {
    if (!team?.organization.id) return "";
    const { data } = supabase.storage
      .from(COMPANY_ASSET_BUCKET)
      .getPublicUrl(companyLogoPath(team.organization.id));
    return versionAssetUrl(data.publicUrl, team.organization.updated_at);
  }, [team?.organization.id, team?.organization.updated_at]);
  const logoPreviewUrl = orgForm.logo_url || team?.organization.logo_url || storageLogoUrl;
  const visibleLogoPreviewUrl =
    logoPreviewUrl && logoImageFailedUrl !== logoPreviewUrl ? logoPreviewUrl : "";
  const clientPermissionSavingKey =
    clientAccessPermissionMutation.isPending && clientAccessPermissionMutation.variables
      ? `${clientAccessPermissionMutation.variables.accessId}:${clientAccessPermissionMutation.variables.field}`
      : "";
  const isClientPermissionSaving = (accessId: string, field: ClientPermissionField) =>
    clientPermissionSavingKey === `${accessId}:${field}`;
  // One admin list: the workspace payload asks the database's is_super_admin().
  const canOpenOverwatchAdmin = Boolean(team?.isSuperAdmin);
  const subscriptionReady = Boolean(
    team?.organization.stripe_customer_id && team?.organization.stripe_subscription_id,
  );
  const subscriptionNote = subscriptionReady
    ? `Overwatch subscription: connected${
        team?.organization.subscription_current_period_end
          ? ` through ${shortDate(team.organization.subscription_current_period_end)}`
          : ""
      }. Client invoice payments run separately from the subscription.`
    : team?.organization.stripe_price_id
      ? "Overwatch subscription: price staged — ready for Stripe Checkout Sessions once live plan prices are connected. Client invoice payments run separately from the subscription."
      : "Overwatch subscription: not connected. Ready for Stripe Checkout Sessions once live plan prices are connected; client invoice payments run separately from the subscription.";
  const memberSummary = useMemo(() => {
    if (!team) {
      return { active: 0, disabled: 0, owners: 0 };
    }

    return team.members.reduce(
      (summary, member) => {
        if (member.status === "active") summary.active += 1;
        if (member.status === "disabled") summary.disabled += 1;
        if (member.role === "owner" || member.role === "admin") summary.owners += 1;
        return summary;
      },
      { active: 0, disabled: 0, owners: 0 },
    );
  }, [team]);
  const clientAccessSummary = useMemo(() => {
    if (!team) {
      return { seats: 0, projects: 0, billing: 0, daily: 0, changeOrders: 0 };
    }

    const projectIds = new Set<string>();
    return team.clientProjectAccess.reduce(
      (summary, access) => {
        summary.seats += 1;
        projectIds.add(access.project_id);
        if (access.can_view_billing) summary.billing += 1;
        if (access.can_view_daily_reports) summary.daily += 1;
        if (access.can_view_change_orders) summary.changeOrders += 1;
        summary.projects = projectIds.size;
        return summary;
      },
      { seats: 0, projects: 0, billing: 0, daily: 0, changeOrders: 0 },
    );
  }, [team]);

  // Left-nav model. Sub-labels derive from live data where cheap, else the
  // static mock strings. Only built when the workspace has loaded.
  const navItems: { id: ConsoleSection; title: string; sub: string; icon: ReactNode }[] = team
    ? [
        {
          id: "people",
          title: "People & roles",
          sub: `${formatNumber(memberSummary.active)} ${
            memberSummary.active === 1 ? "seat" : "seats"
          } · invites · access`,
          icon: <Users className="h-4 w-4" />,
        },
        {
          id: "clients",
          title: "Client access",
          sub: `${formatNumber(clientAccessSummary.seats)} portal ${
            clientAccessSummary.seats === 1 ? "user" : "users"
          }`,
          icon: <ShieldCheck className="h-4 w-4" />,
        },
        {
          id: "plan",
          title: "Plan & usage",
          sub: team.organization.contractor_circle_grant
            ? "Circle grant · usage"
            : formatPlanCode(team.organization.plan_code),
          icon: <Gauge className="h-4 w-4" />,
        },
        {
          id: "paid",
          title: "Getting paid",
          sub: "Bank + Stripe",
          icon: <CreditCard className="h-4 w-4" />,
        },
        {
          id: "assignments",
          title: "Project assignments",
          sub: "who's on what job",
          icon: <ClipboardList className="h-4 w-4" />,
        },
        {
          id: "company",
          title: "Company profile",
          sub: "logo · license · tax",
          icon: <BriefcaseBusiness className="h-4 w-4" />,
        },
        {
          id: "profile",
          title: "Your profile",
          sub: "your account",
          icon: <UserCog className="h-4 w-4" />,
        },
      ]
    : [];

  if (stripeOpening) {
    return (
      <StripeConnectingScreen
        businessName={stripeOpening.businessName}
        action={stripeOpening.action}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <PortfolioTopBar
        active="team"
        actions={
          canOpenOverwatchAdmin ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin">
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin
              </Link>
            </Button>
          ) : undefined
        }
      />
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto max-w-[1600px] px-6 py-5 lg:px-10">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-clay">
              <span className="inline-block h-px w-7 bg-accent" />
              {team?.organization.name || "Company Workspace"}
            </div>
            <h1 className="mt-1 font-serif text-3xl text-foreground lg:text-4xl">Your Company</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Who works here, what each person can do, what clients can see, and how this company
              gets paid.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-7 lg:px-10">
        {isLoading ? (
          <div className="rounded-lg border border-hairline bg-card p-8 text-sm text-muted-foreground shadow-card">
            Loading company workspace...
          </div>
        ) : !team ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-8 text-sm text-danger shadow-card">
            Company workspace did not load.
          </div>
        ) : (
          <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
            <nav
              aria-label="Company settings sections"
              className="flex gap-2 overflow-x-auto rounded-xl border border-hairline bg-surface p-2 lg:sticky lg:top-20 lg:w-[272px] lg:flex-none lg:flex-col lg:gap-1 lg:self-start lg:overflow-visible lg:p-3"
            >
              {navItems.map((item) => {
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectSection(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`flex shrink-0 items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition lg:shrink ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 ${
                        active ? "text-primary-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-sm font-semibold lg:whitespace-normal">
                        {item.title}
                      </span>
                      <span
                        className={`mt-0.5 block truncate text-[11px] ${
                          active ? "text-primary-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        {item.sub}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 flex-1 space-y-6">
              {!team.canManageTeam && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                  Your access is{" "}
                  {accessLabelForMember(
                    team.currentUserRole ?? "member",
                    team.currentUserCapabilities,
                  )}
                  . Only people with the "Manage people" capability can change company access.
                </div>
              )}

              {section === "plan" && (
                <section
                  data-testid="company-command-center"
                  className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline shadow-card md:grid-cols-3 xl:grid-cols-6"
                >
                  <UsageCard
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Access"
                    value={accessLabelForMember(
                      team.currentUserRole ?? "member",
                      team.currentUserCapabilities,
                    )}
                    sub={team.canManageTeam ? "can manage people" : "limited access"}
                  />
                  <UsageCard
                    icon={<Users className="h-4 w-4" />}
                    label="Seats"
                    value={
                      usage
                        ? formatUsageValue(usage.seatsUsed, usage.seatLimit)
                        : formatUsageValue(0, 0)
                    }
                    sub={`${usage?.activeSeats ?? 0} active, ${usage?.pendingInvites ?? 0} pending`}
                    meterValue={usage ? meterPercent(usage.seatsUsed, usage.seatLimit) : 0}
                    tone={usage ? usageTone(usage.seatsUsed, usage.seatLimit) : "default"}
                  />
                  <UsageCard
                    icon={<BriefcaseBusiness className="h-4 w-4" />}
                    label="Projects"
                    value={
                      usage
                        ? formatUsageValue(usage.projectsUsed, usage.projectLimit)
                        : formatUsageValue(0, 0)
                    }
                    sub="active jobs"
                    meterValue={usage ? meterPercent(usage.projectsUsed, usage.projectLimit) : 0}
                    tone={usage ? usageTone(usage.projectsUsed, usage.projectLimit) : "default"}
                  />
                  <UsageCard
                    icon={<ClipboardList className="h-4 w-4" />}
                    label="Daily reports"
                    value={
                      usage
                        ? formatUsageValue(usage.dailyReports, usage.dailyReportLimit)
                        : formatUsageValue(0, 0)
                    }
                    sub={`${usage?.dailyReportsTotal ?? 0} all-time logs`}
                    meterValue={
                      usage ? meterPercent(usage.dailyReports, usage.dailyReportLimit) : 0
                    }
                    tone={usage ? usageTone(usage.dailyReports, usage.dailyReportLimit) : "default"}
                  />
                  <UsageCard
                    icon={<Gauge className="h-4 w-4" />}
                    label="Plan"
                    value={
                      team.organization.contractor_circle_grant
                        ? "Circle grant"
                        : formatPlanCode(team.organization.plan_code)
                    }
                    sub={formatBillingStatus(team.organization.billing_status)}
                  />
                  <UsageCard
                    icon={<CreditCard className="h-4 w-4" />}
                    label="Payments"
                    value={
                      team.organization.stripe_mode === "live" &&
                      team.organization.payment_processor_ready
                        ? "Live ready"
                        : team.organization.stripe_connect_account_id_live
                          ? "Live setup pending"
                          : "Sandbox only"
                    }
                    sub={
                      team.organization.stripe_mode === "live"
                        ? "Real payments active"
                        : "Live activation required"
                    }
                  />
                </section>
              )}

              {section === "people" && (
                <section
                  data-testid="company-users-access"
                  className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"
                >
                  <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                    <SectionHeader
                      icon={<MailPlus className="h-4 w-4" />}
                      eyebrow="Seats"
                      title="Invite company users"
                      description="Send a sign-in link by email and set exactly what the new person can do before it goes out."
                    />
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <SummaryMetric
                        label="Seats used"
                        value={usage ? formatUsageValue(usage.seatsUsed, usage.seatLimit) : "0 / 0"}
                        sub="active plus pending"
                      />
                      <SummaryMetric
                        label="Active users"
                        value={formatNumber(memberSummary.active)}
                        sub={`${formatNumber(memberSummary.owners)} owner/admin`}
                      />
                      <SummaryMetric
                        label="Pending invites"
                        value={formatNumber(team.invites.length)}
                        sub="magic links waiting"
                      />
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_190px_auto] md:items-end">
                      <div className="space-y-1.5">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={inviteEmail}
                          disabled={!team.canManageTeam}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          placeholder="pm@company.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Access preset</Label>
                        <Select
                          value={inviteRole}
                          disabled={!team.canManageTeam}
                          onValueChange={(value) => {
                            const role = value as AccountRole;
                            setInviteRole(role);
                            // Choosing a preset fills the checkboxes below.
                            setInviteCapabilities({ ...ROLE_PRESETS[role] });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        disabled={
                          !team.canManageTeam || !inviteEmail.trim() || inviteMutation.isPending
                        }
                        onClick={() => inviteMutation.mutate()}
                        className="gap-1.5"
                      >
                        <MailPlus className="h-3.5 w-3.5" />
                        {inviteMutation.isPending ? "Sending..." : "Send invite"}
                      </Button>
                    </div>

                    <div className="mt-4 rounded-md border border-hairline p-3">
                      <div className="mb-3 flex items-baseline justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          What this invite can do
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {accessLabelForMember(inviteRole, inviteCapabilities)}
                        </div>
                      </div>
                      <CapabilityPicker
                        idPrefix="invite"
                        value={inviteCapabilities}
                        onChange={setInviteCapabilities}
                        disabled={!team.canManageTeam}
                      />
                    </div>

                    <div className="mt-5 rounded-md border border-hairline">
                      <div className="border-b border-hairline bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Pending invites
                      </div>
                      {team.invites.length === 0 ? (
                        <div className="px-3 py-6 text-sm text-muted-foreground">
                          No pending invites. Send one above — the person gets a sign-in link by
                          email and lands in this company with the access you chose.
                        </div>
                      ) : (
                        <div className="divide-y divide-hairline">
                          {team.invites.map((invite) => (
                            <div
                              key={invite.id}
                              className="grid gap-2 px-3 py-3 md:grid-cols-[1fr_150px_120px_auto] md:items-center"
                            >
                              <div>
                                <div className="font-medium">{invite.email}</div>
                                <div className="text-xs text-muted-foreground">
                                  Expires {shortDate(invite.expires_at)}
                                </div>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {accessLabelForMember(invite.role, invite.capabilities)}
                              </div>
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-warning">
                                {invite.status}
                              </div>
                              {team.canManageTeam && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={revokeMutation.isPending}
                                  onClick={() => revokeMutation.mutate(invite.id)}
                                >
                                  Revoke
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                    <SectionHeader
                      icon={<Users className="h-4 w-4" />}
                      eyebrow="Members"
                      title="Company users and roles"
                      description="Everyone with a seat in this company. Open a person's access to adjust what they can do."
                    />
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <SummaryMetric
                        label="Total users"
                        value={formatNumber(team.members.length)}
                        sub="company seats"
                      />
                      <SummaryMetric
                        label="Active"
                        value={formatNumber(memberSummary.active)}
                        sub="can work now"
                      />
                      <SummaryMetric
                        label="Disabled"
                        value={formatNumber(memberSummary.disabled)}
                        sub="locked out"
                      />
                    </div>
                    <div className="mt-4 divide-y divide-hairline rounded-md border border-hairline">
                      {team.members.map((member) => {
                        const isOwnerRow = member.role === "owner";
                        const isSelf = member.user_id === team.currentProfile.id;
                        const canEditRow = team.canManageTeam && !isOwnerRow;
                        const accessLabel = accessLabelForMember(member.role, member.capabilities);
                        return (
                          <div key={member.id} className="space-y-3 px-3 py-3">
                            <div className="grid gap-3 lg:grid-cols-[1fr_190px_150px] lg:items-center">
                              <div>
                                <div className="font-medium">
                                  {member.full_name || member.email}
                                </div>
                                <div className="text-xs text-muted-foreground">{member.email}</div>
                              </div>
                              {canEditRow ? (
                                <>
                                  <Select
                                    value={member.role}
                                    onValueChange={(value) =>
                                      // Choosing a preset fills the capability
                                      // boxes with that preset's set.
                                      memberMutation.mutate({
                                        membershipId: member.id,
                                        role: value as AccountRole,
                                        capabilities: { ...ROLE_PRESETS[value as AccountRole] },
                                      })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {roleOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={member.status === "pending" ? "active" : member.status}
                                    onValueChange={(value) =>
                                      memberMutation.mutate({
                                        membershipId: member.id,
                                        status: value as "active" | "disabled",
                                      })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {memberStatusOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </>
                              ) : (
                                <>
                                  <div className="text-sm text-muted-foreground">{accessLabel}</div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                    {member.status}
                                  </div>
                                </>
                              )}
                            </div>
                            {isOwnerRow ? (
                              <div className="text-xs text-muted-foreground">
                                Company owner — full access. Owner access can't be edited.
                              </div>
                            ) : (
                              <Collapsible>
                                <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                                  <span>
                                    Access: <span className="text-foreground">{accessLabel}</span>
                                  </span>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-3">
                                  <CapabilityPicker
                                    idPrefix={`member-${member.id}`}
                                    value={member.capabilities}
                                    disabled={!team.canManageTeam || memberMutation.isPending}
                                    lockedKeys={
                                      isSelf
                                        ? {
                                            "company.manage_team":
                                              "You can't remove your own people-management access.",
                                          }
                                        : undefined
                                    }
                                    onChange={(next) =>
                                      memberMutation.mutate({
                                        membershipId: member.id,
                                        capabilities: next,
                                      })
                                    }
                                  />
                                </CollapsibleContent>
                              </Collapsible>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}

              {section === "clients" && (
                <section
                  data-testid="client-access-priority-panel"
                  className="rounded-lg border border-hairline bg-card p-5 shadow-card"
                >
                  <SectionHeader
                    icon={<ShieldCheck className="h-4 w-4" />}
                    eyebrow="Client Portal"
                    title="Client project access"
                    description="Give a client a view of their own project. You pick which modules they see — nothing else is visible."
                  />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <SummaryMetric
                      label="Client seats"
                      value={formatNumber(clientAccessSummary.seats)}
                      sub="portal users"
                    />
                    <SummaryMetric
                      label="Shared projects"
                      value={formatNumber(clientAccessSummary.projects)}
                      sub="client-visible"
                    />
                    <SummaryMetric
                      label="Billing on"
                      value={formatNumber(clientAccessSummary.billing)}
                      sub="invoice access"
                    />
                    <SummaryMetric
                      label="Daily reports"
                      value={formatNumber(clientAccessSummary.daily)}
                      sub="field logs shared"
                    />
                    <SummaryMetric
                      label="Change orders"
                      value={formatNumber(clientAccessSummary.changeOrders)}
                      sub="CO access"
                    />
                  </div>
                  <div className="mt-4 grid gap-3 rounded-md border border-hairline bg-surface p-3 xl:grid-cols-[1fr_1fr_1fr]">
                    <div className="space-y-1.5">
                      <Label>Project</Label>
                      <Select
                        value={clientInviteForm.projectId}
                        disabled={!team.canManageTeam}
                        onValueChange={(projectId) =>
                          setClientInviteForm((current) => ({ ...current, projectId }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose project" />
                        </SelectTrigger>
                        <SelectContent>
                          {team.projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.job_number
                                ? `${project.job_number} - ${project.name}`
                                : project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Client name</Label>
                      <Input
                        value={clientInviteForm.name}
                        disabled={!team.canManageTeam}
                        onChange={(event) =>
                          setClientInviteForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="Owner or client rep"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={clientInviteForm.email}
                        disabled={!team.canManageTeam}
                        onChange={(event) =>
                          setClientInviteForm((current) => ({
                            ...current,
                            email: event.target.value,
                          }))
                        }
                        placeholder="client@company.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Client company</Label>
                      <Input
                        value={clientInviteForm.company}
                        disabled={!team.canManageTeam}
                        onChange={(event) =>
                          setClientInviteForm((current) => ({
                            ...current,
                            company: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Title</Label>
                      <Input
                        value={clientInviteForm.title}
                        disabled={!team.canManageTeam}
                        onChange={(event) =>
                          setClientInviteForm((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Phone</Label>
                      <Input
                        value={clientInviteForm.phone}
                        disabled={!team.canManageTeam}
                        onChange={(event) =>
                          setClientInviteForm((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5 xl:col-span-2">
                      <Label>Notes</Label>
                      <Input
                        value={clientInviteForm.notes}
                        disabled={!team.canManageTeam}
                        onChange={(event) =>
                          setClientInviteForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        placeholder="Owner rep, lender, architect, billing contact"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1.5">
                        <Label>Portal modules</Label>
                        <div className="flex flex-wrap gap-2">
                          {clientPermissionFields.map(({ field, label }) => {
                            const active = clientInviteForm[field];
                            return (
                              <Button
                                key={field}
                                type="button"
                                size="sm"
                                variant={active ? "default" : "outline"}
                                disabled={!team.canManageTeam}
                                onClick={() =>
                                  setClientInviteForm((current) => ({
                                    ...current,
                                    [field]: !current[field],
                                  }))
                                }
                              >
                                {label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      <Button
                        disabled={
                          !team.canManageTeam ||
                          !clientInviteForm.projectId ||
                          !clientInviteForm.name.trim() ||
                          !clientInviteForm.email.trim() ||
                          clientInviteMutation.isPending
                        }
                        onClick={() => clientInviteMutation.mutate()}
                        className="gap-1.5"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {clientInviteMutation.isPending ? "Sending..." : "Invite client"}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-md border border-hairline">
                    {team.clientProjectAccess.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <div className="font-serif text-xl text-foreground">
                          No clients have portal access yet
                        </div>
                        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                          Invite a client above to share progress on their project. They only see
                          the modules you turn on — change orders, daily reports, or billing.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-hairline">
                        <div className="hidden gap-3 bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground xl:grid xl:grid-cols-[minmax(190px,1.2fr)_minmax(170px,1fr)_minmax(130px,0.72fr)_minmax(190px,1.05fr)_minmax(110px,0.58fr)_110px]">
                          <div>Client</div>
                          <div>Project</div>
                          <div>Status</div>
                          <div>Modules</div>
                          <div>Last sent</div>
                          <div className="text-right">Actions</div>
                        </div>
                        {team.clientProjectAccess.map((access) => (
                          <div
                            key={access.id}
                            className="grid gap-3 px-3 py-3 text-sm md:grid-cols-2 xl:grid-cols-[minmax(190px,1.2fr)_minmax(170px,1fr)_minmax(130px,0.72fr)_minmax(190px,1.05fr)_minmax(110px,0.58fr)_110px] xl:items-center"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {access.contact_name || access.email}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {access.email}
                              </div>
                              {access.contact_company && (
                                <div className="truncate text-xs text-muted-foreground">
                                  {access.contact_company}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {access.project_name}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {access.project_job_number || "No job number"}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <span className="inline-flex max-w-full rounded-full border border-hairline px-2 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                <span className="truncate">{access.status}</span>
                              </span>
                              <div className="mt-1 truncate text-xs text-muted-foreground">
                                {access.accepted_at
                                  ? `Accepted ${shortDate(access.accepted_at)}`
                                  : "Not accepted"}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {clientPermissionFields.map(({ field, label }) => {
                                const active = access[field];
                                return (
                                  <Button
                                    key={field}
                                    type="button"
                                    size="sm"
                                    variant={active ? "default" : "outline"}
                                    disabled={
                                      !team.canManageTeam ||
                                      isClientPermissionSaving(access.id, field)
                                    }
                                    onClick={() =>
                                      clientAccessPermissionMutation.mutate({
                                        accessId: access.id,
                                        field,
                                        value: !active,
                                      })
                                    }
                                    className="h-7 px-2 text-xs"
                                  >
                                    {label}
                                  </Button>
                                );
                              })}
                            </div>
                            <div className="min-w-0 truncate text-sm text-muted-foreground">
                              {access.last_sent_at ? shortDate(access.last_sent_at) : "Not sent"}
                            </div>
                            <div className="flex justify-start gap-1.5 xl:justify-end">
                              <Button
                                variant="outline"
                                size="icon"
                                title="Send portal link"
                                disabled={
                                  !team.canManageTeam || clientAccessSendLinkMutation.isPending
                                }
                                onClick={() => clientAccessSendLinkMutation.mutate(access)}
                              >
                                <Send className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Remove client access"
                                disabled={
                                  !team.canManageTeam || clientAccessRevokeMutation.isPending
                                }
                                onClick={() => clientAccessRevokeMutation.mutate(access.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {section === "plan" && usage && (
                <PlanReadinessPanel
                  planCode={team.organization.plan_code}
                  billingStatus={team.organization.billing_status}
                  grantActive={team.organization.contractor_circle_grant}
                  usage={usage}
                  subscriptionCurrentPeriodEnd={team.organization.subscription_current_period_end}
                  subscriptionCancelAtPeriodEnd={
                    team.organization.subscription_cancel_at_period_end
                  }
                  showPaymentsLink={Boolean(team.canManageSettings || team.canManageBilling)}
                />
              )}

              {section === "paid" && (
                <GettingPaidSection
                  canManage={Boolean(team.canManageSettings || team.canManageBilling)}
                  stripe={{
                    mode: team.organization.stripe_mode,
                    accountId: team.organization.stripe_connect_account_id,
                    connectStatus: team.organization.stripe_connect_status,
                    processorReady: team.organization.payment_processor_ready,
                    testAccountId: team.organization.stripe_connect_account_id_test,
                    testConnectStatus: team.organization.stripe_connect_status_test,
                    liveAccountId: team.organization.stripe_connect_account_id_live,
                    liveConnectStatus: team.organization.stripe_connect_status_live,
                  }}
                  connectDetails={stripeStatusQuery.data?.connectDetails}
                  onConnectStripe={(mode) => openStripeInNewTab("onboard", mode)}
                  onActivateLiveStripe={() => {
                    if (
                      window.confirm(
                        "Activate live Stripe payments for this company? New invoice checkout sessions will move real money.",
                      )
                    ) {
                      stripeConnectMutation.mutate({ action: "activate", mode: "live" });
                    }
                  }}
                  onOpenStripeDashboard={(mode) => openStripeInNewTab("dashboard", mode)}
                  onRefreshStripeStatus={() => void stripeStatusQuery.refetch()}
                  stripeConnectPending={stripeConnectMutation.isPending}
                  stripeStatusPending={stripeStatusQuery.isFetching}
                  subscriptionNote={subscriptionNote}
                  billingContactName={team.organization.billing_contact_name}
                  billingContactEmail={team.organization.billing_email}
                  canEditBillingContact={Boolean(team.canManageSettings)}
                  onSaveBillingContact={(next) => billingContactMutation.mutate(next)}
                  billingContactSaving={billingContactMutation.isPending}
                />
              )}

              {section === "assignments" && (
                <section
                  data-testid="project-asset-access-assignments"
                  className="rounded-lg border border-hairline bg-card p-5 shadow-card"
                >
                  <SectionHeader
                    icon={<ShieldCheck className="h-4 w-4" />}
                    eyebrow="Asset Access"
                    title="Project access assignments"
                    description="Put a company member on a specific job with a project role. Company-wide access stays as set above."
                  />
                  <div className="mt-5 grid gap-3 rounded-md border border-hairline bg-surface p-3 lg:grid-cols-[1fr_1fr_180px_auto] lg:items-end">
                    <div className="space-y-1.5">
                      <Label>Project</Label>
                      <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose project" />
                        </SelectTrigger>
                        <SelectContent>
                          {team.projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.job_number
                                ? `${project.job_number} - ${project.name}`
                                : project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Company member</Label>
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose person" />
                        </SelectTrigger>
                        <SelectContent>
                          {team.members
                            .filter((member) => member.status === "active")
                            .map((member) => (
                              <SelectItem key={member.user_id} value={member.user_id}>
                                {member.full_name || member.email}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Project role</Label>
                      <Select
                        value={projectRole}
                        onValueChange={(value) => setProjectRole(value as ProjectMemberRole)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {projectRoleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      disabled={!selectedProjectId || !selectedUserId || assignMutation.isPending}
                      onClick={() => assignMutation.mutate()}
                    >
                      {assignMutation.isPending ? "Saving..." : "Assign"}
                    </Button>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-md border border-hairline">
                    {team.projectMembers.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <div className="font-serif text-xl text-foreground">
                          No project assignments yet
                        </div>
                        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                          Use the pickers above to put a company member on a specific job — useful
                          for supers and PMs who should only see their own projects.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-hairline">
                        {team.projectMembers.map((member) => {
                          const project = team.projects.find((p) => p.id === member.project_id);
                          return (
                            <div
                              key={member.id}
                              className="grid gap-3 px-3 py-3 lg:grid-cols-[1.1fr_1fr_170px_140px_auto] lg:items-center"
                            >
                              <div>
                                <div className="font-medium">{project?.name || "Project"}</div>
                                <div className="text-xs text-muted-foreground">
                                  {project?.job_number || "No job number"}
                                </div>
                              </div>
                              <div>
                                <div className="font-medium">
                                  {member.full_name || member.email}
                                </div>
                                <div className="text-xs text-muted-foreground">{member.email}</div>
                              </div>
                              <Select
                                value={member.role}
                                onValueChange={(value) =>
                                  projectAccessMutation.mutate({
                                    membershipId: member.id,
                                    role: value as ProjectMemberRole,
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {projectRoleOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {member.status}
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={`Remove ${projectRoleLabel(member.role)} access`}
                                disabled={removeProjectAccessMutation.isPending}
                                onClick={() => removeProjectAccessMutation.mutate(member.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {section === "profile" && (
                <section>
                  <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                    <SectionHeader
                      icon={<UserCog className="h-4 w-4" />}
                      eyebrow="Profile"
                      title="Your Overwatch profile"
                      description="Your name and contact details as they appear on invites, reports, and daily logs."
                    />
                    <div className="mt-5 grid gap-4">
                      <div className="space-y-1.5">
                        <Label>Email</Label>
                        <Input value={team.currentProfile.email} disabled />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                          value={profileForm.full_name}
                          onChange={(event) =>
                            setProfileForm({ ...profileForm, full_name: event.target.value })
                          }
                        />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input
                            value={profileForm.phone}
                            onChange={(event) =>
                              setProfileForm({ ...profileForm, phone: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Title</Label>
                          <Input
                            value={profileForm.company_title}
                            onChange={(event) =>
                              setProfileForm({ ...profileForm, company_title: event.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          onClick={() => profileMutation.mutate()}
                          disabled={profileMutation.isPending}
                          className="gap-1.5"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {profileMutation.isPending ? "Saving..." : "Save profile"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {section === "company" && (
                <section data-testid="company-profile-record">
                  <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                    <SectionHeader
                      icon={<BriefcaseBusiness className="h-4 w-4" />}
                      eyebrow="Company"
                      title={team.organization.name}
                      description="The company identity that shows up on estimates, invoices, and client pages."
                    />
                    <div className="mt-5 grid gap-4">
                      <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
                        <div className="space-y-3">
                          <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface text-xl font-semibold text-muted-foreground">
                            {visibleLogoPreviewUrl ? (
                              <img
                                src={visibleLogoPreviewUrl}
                                alt={`${orgForm.name || "Company"} logo`}
                                className="h-full w-full object-contain p-2"
                                onError={() => setLogoImageFailedUrl(visibleLogoPreviewUrl)}
                              />
                            ) : (
                              companyInitials(orgForm.name)
                            )}
                          </div>
                          {team.canManageSettings && (
                            <div className="space-y-2">
                              <Label htmlFor="company-logo-upload">Logo</Label>
                              {/* Native input: the styled Input's w-full fights sr-only's 1px width
                              and (depending on compiled CSS order) renders a viewport-wide
                              invisible box that forces page-level horizontal scroll. */}
                              <input
                                key={logoInputKey}
                                ref={logoInputRef}
                                id="company-logo-upload"
                                type="file"
                                accept="image/png,image/jpeg"
                                disabled={logoUploadMutation.isPending}
                                className="sr-only"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) logoUploadMutation.mutate(file);
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start gap-2"
                                disabled={logoUploadMutation.isPending}
                                onClick={() => logoInputRef.current?.click()}
                              >
                                <Upload className="h-3.5 w-3.5" />
                                {logoUploadMutation.isPending
                                  ? "Uploading..."
                                  : visibleLogoPreviewUrl
                                    ? "Replace logo"
                                    : "Upload logo"}
                              </Button>
                              <p className="text-xs leading-5 text-muted-foreground">
                                PNG or JPG, up to 2 MB.
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="grid gap-4">
                          <div className="grid gap-4 md:grid-cols-[1fr_1fr_160px]">
                            <div className="space-y-1.5">
                              <Label>Company name</Label>
                              <Input
                                value={orgForm.name}
                                disabled={!team.canManageSettings}
                                onChange={(event) =>
                                  setOrgForm({ ...orgForm, name: event.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Legal name</Label>
                              <Input
                                value={orgForm.legal_name}
                                disabled={!team.canManageSettings}
                                onChange={(event) =>
                                  setOrgForm({ ...orgForm, legal_name: event.target.value })
                                }
                                placeholder={orgForm.name}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Slug</Label>
                              <Input
                                value={orgForm.slug}
                                disabled={!team.canManageSettings}
                                onChange={(event) =>
                                  setOrgForm({ ...orgForm, slug: event.target.value })
                                }
                              />
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label>Website</Label>
                              <Input
                                value={orgForm.website_url}
                                disabled={!team.canManageSettings}
                                onChange={(event) =>
                                  setOrgForm({ ...orgForm, website_url: event.target.value })
                                }
                                placeholder="company.com"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Office phone</Label>
                              <Input
                                value={orgForm.office_phone}
                                disabled={!team.canManageSettings}
                                onChange={(event) =>
                                  setOrgForm({ ...orgForm, office_phone: event.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Country</Label>
                              <Input
                                value={orgForm.country}
                                disabled={!team.canManageSettings}
                                onChange={(event) =>
                                  setOrgForm({ ...orgForm, country: event.target.value })
                                }
                                placeholder="United States"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-4 rounded-md border border-hairline bg-surface p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Office address
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Address line 1</Label>
                            <Input
                              value={orgForm.address_line1}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, address_line1: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Address line 2</Label>
                            <Input
                              value={orgForm.address_line2}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, address_line2: event.target.value })
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[1fr_120px_140px]">
                          <div className="space-y-1.5">
                            <Label>City</Label>
                            <Input
                              value={orgForm.city}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, city: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>State</Label>
                            <Input
                              value={orgForm.state}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, state: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>ZIP</Label>
                            <Input
                              value={orgForm.postal_code}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, postal_code: event.target.value })
                              }
                            />
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-4 rounded-md border border-hairline bg-surface p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          License and tax
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>License number</Label>
                            <Input
                              value={orgForm.license_number}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, license_number: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Tax identifier</Label>
                            <Input
                              value={orgForm.tax_identifier}
                              disabled={!team.canManageSettings}
                              onChange={(event) =>
                                setOrgForm({ ...orgForm, tax_identifier: event.target.value })
                              }
                            />
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3 md:grid-cols-3">
                        <ContactFact
                          icon={<Building2 className="h-3.5 w-3.5" />}
                          label="Display"
                          value={orgForm.name || "Company"}
                        />
                        <ContactFact
                          icon={<Globe className="h-3.5 w-3.5" />}
                          label="Website"
                          value={orgForm.website_url || "Not set"}
                        />
                        <ContactFact
                          icon={<Phone className="h-3.5 w-3.5" />}
                          label="Phone"
                          value={orgForm.office_phone || "Not set"}
                        />
                        <ContactFact
                          icon={<MapPin className="h-3.5 w-3.5" />}
                          label="Location"
                          value={
                            [orgForm.city, orgForm.state].filter(Boolean).join(", ") || "Not set"
                          }
                        />
                        <ContactFact
                          icon={<FileImage className="h-3.5 w-3.5" />}
                          label="Logo"
                          value={visibleLogoPreviewUrl ? "Ready" : "Not set"}
                        />
                        <ContactFact
                          icon={<ShieldCheck className="h-3.5 w-3.5" />}
                          label="Role"
                          value={roleLabel(team.currentUserRole ?? "member")}
                        />
                      </div>
                      <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3 md:grid-cols-3 xl:grid-cols-6">
                        <MiniStat label="Plan" value={team.organization.plan_code} />
                        <MiniStat label="Billing" value={team.organization.billing_status} />
                        <MiniStat
                          label="Stripe"
                          value={
                            team.organization.stripe_mode === "live" &&
                            team.organization.payment_processor_ready
                              ? "Live ready"
                              : team.organization.stripe_connect_account_id_live
                                ? "Live setup started"
                                : team.organization.stripe_connect_account_id_test
                                  ? "Sandbox only"
                                  : "Not connected"
                          }
                        />
                        <MiniStat
                          label="Payments"
                          value={
                            team.organization.stripe_mode === "live" &&
                            team.organization.payment_processor_ready
                              ? "Online live"
                              : "Manual / sandbox"
                          }
                        />
                        <MiniStat
                          label="Role"
                          value={roleLabel(team.currentUserRole ?? "member")}
                        />
                        <MiniStat
                          label="Grant"
                          value={team.organization.contractor_circle_grant ? "Active" : "None"}
                        />
                      </div>
                      {team.canManageSettings && (
                        <div className="flex justify-end">
                          <Button
                            onClick={() => orgMutation.mutate()}
                            disabled={
                              orgMutation.isPending ||
                              logoUploadMutation.isPending ||
                              !orgForm.name.trim()
                            }
                            className="gap-1.5"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {orgMutation.isPending ? "Saving..." : "Save company"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </main>
      <AppFooter context={`${team?.organization.name || "Company"} · settings console`} />
    </div>
  );
}

function PlanReadinessPanel({
  planCode,
  billingStatus,
  grantActive,
  usage,
  subscriptionCurrentPeriodEnd,
  subscriptionCancelAtPeriodEnd,
  showPaymentsLink,
}: {
  planCode: string;
  billingStatus: string;
  grantActive: boolean;
  usage: TeamUsageSnapshot;
  subscriptionCurrentPeriodEnd: string;
  subscriptionCancelAtPeriodEnd: boolean;
  showPaymentsLink: boolean;
}) {
  const planLabel = formatPlanCode(planCode);
  const billingLabel = formatBillingStatus(billingStatus);
  const rows = [
    {
      label: "Seats",
      value: formatUsageValue(usage.seatsUsed, usage.seatLimit),
      detail: `${usage.activeSeats} active, ${usage.pendingInvites} pending invite${
        usage.pendingInvites === 1 ? "" : "s"
      }`,
      percent: meterPercent(usage.seatsUsed, usage.seatLimit),
      status: usageStatus(usage.seatsUsed, usage.seatLimit, grantActive),
    },
    {
      label: "Active projects",
      value: formatUsageValue(usage.projectsUsed, usage.projectLimit),
      detail: "Open jobs currently attached to this company workspace.",
      percent: meterPercent(usage.projectsUsed, usage.projectLimit),
      status: usageStatus(usage.projectsUsed, usage.projectLimit, grantActive),
    },
    {
      label: "Daily reports this month",
      value: formatUsageValue(usage.dailyReports, usage.dailyReportLimit),
      detail: `${formatNumber(usage.dailyReportsTotal)} lifetime job log${
        usage.dailyReportsTotal === 1 ? "" : "s"
      }`,
      percent: meterPercent(usage.dailyReports, usage.dailyReportLimit),
      status: usageStatus(usage.dailyReports, usage.dailyReportLimit, grantActive),
    },
    {
      label: "Storage and attachments",
      value: `${usage.storageUsedLabel} / ${usage.storageLimitLabel}`,
      detail: `${formatNumber(usage.attachmentCount)} uploaded attachment${
        usage.attachmentCount === 1 ? "" : "s"
      } from daily reports.`,
      percent: meterPercent(usage.storageBytes, usage.storageLimitBytes),
      status: usageStatus(usage.storageBytes, usage.storageLimitBytes, grantActive),
    },
  ];

  const highestPressure = rows.reduce((highest, row) =>
    row.percent > highest.percent ? row : highest,
  );

  return (
    <section className="rounded-lg border border-hairline bg-card shadow-card">
      <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="border-b border-hairline p-5 lg:border-b-0 lg:border-r">
          <SectionHeader
            icon={<Gauge className="h-4 w-4" />}
            eyebrow="Plan and payment readiness"
            title="Commercial setup"
            description="Where this company stands on plan limits and billing status."
          />
          <div className="mt-5 grid gap-3 text-sm">
            <PlanFact label="Plan" value={planLabel} />
            <PlanFact label="Billing status" value={billingLabel} />
            <PlanFact
              label="Current access"
              value={grantActive ? "Contractor Circle grant" : "Plan enforcement"}
            />
            <PlanFact
              label="Renewal posture"
              value={
                subscriptionCancelAtPeriodEnd
                  ? "Cancels at period end"
                  : subscriptionCurrentPeriodEnd
                    ? `Current through ${shortDate(subscriptionCurrentPeriodEnd)}`
                    : "No paid cycle"
              }
            />
          </div>
          <div
            className={`mt-5 rounded-md border px-4 py-3 text-sm ${
              grantActive
                ? "border-success/25 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning"
            }`}
          >
            {grantActive
              ? "Contractor Circle grant keeps this company working. Current trial assumptions are 10 projects, 10 seats, 10GB storage, and 1,000 monthly daily logs until paid plans are finalized."
              : "Plan limits can enforce seats, jobs, reports, and storage once billing is active."}
          </div>
          {showPaymentsLink && (
            <div className="mt-4 rounded-md border border-hairline bg-surface px-4 py-3">
              <a
                href="#getting-paid"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition hover:text-accent/80"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Payments are managed in Getting Paid →
              </a>
            </div>
          )}
          <div className="mt-4 rounded-md border border-hairline bg-surface px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Highest pressure
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <div className="font-medium text-foreground">{highestPressure.label}</div>
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {formatPercent(highestPressure.percent)}
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {highestPressure.status.detail}
            </div>
          </div>
        </div>

        <div className="divide-y divide-hairline">
          {rows.map((row) => (
            <UsageReadinessRow key={row.label} {...row} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline pb-2 last:border-b-0 last:pb-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="text-right font-medium text-foreground">{value}</div>
    </div>
  );
}

function UsageReadinessRow({
  label,
  value,
  detail,
  percent,
  status,
}: {
  label: string;
  value: string;
  detail: string;
  percent: number;
  status: UsageStatus;
}) {
  const statusClass =
    status.tone === "danger"
      ? "border-danger/30 bg-danger/10 text-danger"
      : status.tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-success/25 bg-success/10 text-success";
  const meterClass =
    status.tone === "danger"
      ? "bg-danger"
      : status.tone === "warning"
        ? "bg-warning"
        : "bg-success";
  const Icon = status.tone === "default" ? CheckCircle2 : AlertTriangle;

  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(160px,1fr)_170px_180px] md:items-center">
      <div>
        <div className="font-medium text-foreground">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
      <div>
        <div className="text-lg font-medium tabular-nums text-foreground">{value}</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${meterClass}`}
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      </div>
      <div
        className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 ${statusClass}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.1em]">{status.label}</div>
          <div className="mt-0.5 text-[11px] leading-snug opacity-85">{formatPercent(percent)}</div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {eyebrow}
      </div>
      <h2 className="mt-1 font-serif text-2xl text-foreground">{title}</h2>
      {description && (
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

function SummaryMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-h-20 min-w-0 rounded-md border border-hairline bg-surface px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 truncate font-serif text-2xl leading-none tabular text-foreground">
        {value}
      </div>
      <div className="mt-1.5 truncate text-xs leading-snug text-muted-foreground">{sub}</div>
    </div>
  );
}

function UsageCard({
  icon,
  label,
  value,
  sub,
  meterValue,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  meterValue?: number;
  tone?: UsageTone;
}) {
  const toneBarClass =
    tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-foreground/60";
  const valueClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";
  const meterClass =
    tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-success";
  return (
    <div className="relative flex min-h-[112px] min-w-0 flex-col justify-between bg-card px-4 py-4">
      <span className={`absolute left-0 top-0 h-full w-px ${toneBarClass}`} />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="min-w-0">
        <div
          title={value}
          className={`mt-2 truncate font-serif text-2xl leading-none tabular ${valueClass}`}
        >
          {value}
        </div>
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{sub}</div>
        {meterValue !== undefined && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${meterClass}`}
              style={{ width: `${Math.max(0, Math.min(100, meterValue))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ContactFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
