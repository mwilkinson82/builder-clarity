import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  LogOut,
  MailPlus,
  Save,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
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
  head: () => ({
    meta: [
      { title: "Team — Overwatch" },
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
  { value: "member", label: "Team member" },
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

function roleLabel(role: string) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function projectRoleLabel(role: string) {
  return projectRoleOptions.find((option) => option.value === role)?.label ?? role;
}

function shortDate(value: string) {
  return value ? value.replace("T", " ").slice(0, 10) : "";
}

function TeamPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const loadTeam = useServerFn(getTeamWorkspace);
  const saveProfile = useServerFn(updateMyProfile);
  const saveOrganization = useServerFn(updateOrganization);
  const createInvite = useServerFn(createTeamInvite);
  const updateMember = useServerFn(updateTeamMember);
  const revokeInvite = useServerFn(revokeTeamInvite);
  const assignMember = useServerFn(assignProjectMember);
  const updateProjectAccess = useServerFn(updateProjectMember);
  const removeProjectAccess = useServerFn(removeProjectMember);

  const { data: team, isLoading } = useQuery({
    queryKey: ["team-workspace"],
    queryFn: () => loadTeam(),
  });

  const [profileForm, setProfileForm] = useState({
    full_name: "",
    phone: "",
    company_title: "",
  });
  const [orgForm, setOrgForm] = useState({ name: "", slug: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AccountRole>("project_manager");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [projectRole, setProjectRole] = useState<ProjectMemberRole>("viewer");

  useEffect(() => {
    if (!team) return;
    setProfileForm({
      full_name: team.currentProfile.full_name,
      phone: team.currentProfile.phone,
      company_title: team.currentProfile.company_title,
    });
    setOrgForm({ name: team.organization.name, slug: team.organization.slug });
    setSelectedProjectId((current) => current || team.projects[0]?.id || "");
    setSelectedUserId(
      (current) =>
        current || team.members.find((member) => member.status === "active")?.user_id || "",
    );
  }, [team]);

  const usage = useMemo(() => {
    if (!team) return null;
    const seatsUsed = team.usage.activeSeats + team.usage.pendingInvites;
    return {
      seatsUsed,
      seatLimit: team.organization.seat_limit,
      projectsUsed: team.usage.projects,
      projectLimit: team.organization.project_limit,
      dailyReports: team.usage.dailyReports,
      dailyReportLimit: team.organization.daily_report_limit_per_month,
      storageLimitGb: Math.round(team.organization.storage_limit_mb / 1024),
    };
  }, [team]);

  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["team-workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
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
    mutationFn: () => saveOrganization({ data: orgForm }),
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

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase();
      if (!email) throw new Error("Enter an email address.");
      await createInvite({ data: { email, role: inviteRole } });

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      return email;
    },
    onSuccess: async (email) => {
      await refreshWorkspace();
      toast.success("Team invite sent", {
        description: `${email} can sign in to Overwatch.`,
      });
      setInviteEmail("");
      setInviteRole("project_manager");
    },
    onError: (error) => {
      toast.error("Invite did not send", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const memberMutation = useMutation({
    mutationFn: (payload: { membershipId: string; role?: AccountRole; status?: "active" | "disabled" }) =>
      updateMember({ data: payload }),
    onSuccess: async () => {
      await refreshWorkspace();
      toast.success("Team member updated");
    },
    onError: (error) => {
      toast.error("Team member did not update", {
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
      if (!selectedUserId) throw new Error("Choose a team member.");
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

  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-6 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 gap-1.5">
              <Link to="/">
                <ArrowLeft className="h-3.5 w-3.5" />
                Portfolio
              </Link>
            </Button>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Overwatch Company Workspace
            </div>
            <h1 className="mt-1 font-serif text-4xl text-foreground">Team</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/">Portfolio</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8 lg:px-10">
        {isLoading ? (
          <div className="rounded-lg border border-hairline bg-card p-8 text-sm text-muted-foreground shadow-card">
            Loading team workspace...
          </div>
        ) : !team ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-8 text-sm text-danger shadow-card">
            Team workspace did not load.
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <UsageCard
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Access"
                value={
                  team.organization.contractor_circle_grant
                    ? "Circle grant"
                    : team.organization.plan_code
                }
                sub={team.organization.billing_status}
              />
              <UsageCard
                icon={<Users className="h-4 w-4" />}
                label="Seats"
                value={`${usage?.seatsUsed ?? 0}/${usage?.seatLimit ?? 0}`}
                sub={`${team.usage.pendingInvites} pending invites`}
              />
              <UsageCard
                icon={<BriefcaseBusiness className="h-4 w-4" />}
                label="Projects"
                value={`${usage?.projectsUsed ?? 0}/${usage?.projectLimit ?? 0}`}
                sub="active jobs"
              />
              <UsageCard
                icon={<ClipboardList className="h-4 w-4" />}
                label="Daily reports"
                value={`${usage?.dailyReports ?? 0}`}
                sub={`limit ${usage?.dailyReportLimit ?? 0}/mo`}
              />
              <UsageCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Storage plan"
                value={`${usage?.storageLimitGb ?? 0} GB`}
                sub="soft meter"
              />
            </section>

            {!team.canManageTeam && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                Your role is {roleLabel(team.currentUserRole ?? "member")}. Owners, admins, and
                executives can change company access.
              </div>
            )}

            <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                <SectionHeader
                  icon={<UserCog className="h-4 w-4" />}
                  eyebrow="Profile"
                  title="Your Overwatch profile"
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

              <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                <SectionHeader
                  icon={<BriefcaseBusiness className="h-4 w-4" />}
                  eyebrow="Company"
                  title={team.organization.name}
                />
                <div className="mt-5 grid gap-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                    <div className="space-y-1.5">
                      <Label>Company name</Label>
                      <Input
                        value={orgForm.name}
                        disabled={!team.canManageTeam}
                        onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Slug</Label>
                      <Input
                        value={orgForm.slug}
                        disabled={!team.canManageTeam}
                        onChange={(event) => setOrgForm({ ...orgForm, slug: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3 md:grid-cols-4">
                    <MiniStat label="Plan" value={team.organization.plan_code} />
                    <MiniStat label="Billing" value={team.organization.billing_status} />
                    <MiniStat label="Role" value={roleLabel(team.currentUserRole ?? "member")} />
                    <MiniStat
                      label="Grant"
                      value={team.organization.contractor_circle_grant ? "Active" : "None"}
                    />
                  </div>
                  {team.canManageTeam && (
                    <div className="flex justify-end">
                      <Button
                        onClick={() => orgMutation.mutate()}
                        disabled={orgMutation.isPending || !orgForm.name.trim()}
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

            <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                <SectionHeader
                  icon={<MailPlus className="h-4 w-4" />}
                  eyebrow="Seats"
                  title="Invite team members"
                />
                <div className="mt-5 grid gap-3 md:grid-cols-[1fr_190px_auto] md:items-end">
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
                    <Label>Company role</Label>
                    <Select
                      value={inviteRole}
                      disabled={!team.canManageTeam}
                      onValueChange={(value) => setInviteRole(value as AccountRole)}
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

                <div className="mt-5 rounded-md border border-hairline">
                  <div className="border-b border-hairline bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Pending invites
                  </div>
                  {team.invites.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      No pending invites.
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
                            {roleLabel(invite.role)}
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
                  title={`${team.members.length} people`}
                />
                <div className="mt-5 divide-y divide-hairline rounded-md border border-hairline">
                  {team.members.map((member) => (
                    <div
                      key={member.id}
                      className="grid gap-3 px-3 py-3 lg:grid-cols-[1fr_190px_150px] lg:items-center"
                    >
                      <div>
                        <div className="font-medium">{member.full_name || member.email}</div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </div>
                      {team.canManageTeam ? (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(value) =>
                              memberMutation.mutate({
                                membershipId: member.id,
                                role: value as AccountRole,
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
                          <div className="text-sm text-muted-foreground">
                            {roleLabel(member.role)}
                          </div>
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {member.status}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
              <SectionHeader
                icon={<ShieldCheck className="h-4 w-4" />}
                eyebrow="Project Access"
                title="Assignments"
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
                  <Label>Team member</Label>
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
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No project-level access has been assigned yet.
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
                            <div className="font-medium">{member.full_name || member.email}</div>
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
          </div>
        )}
      </main>
    </div>
  );
}

function SectionHeader({
  icon,
  eyebrow,
  title,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {eyebrow}
      </div>
      <h2 className="mt-1 font-serif text-2xl text-foreground">{title}</h2>
    </div>
  );
}

function UsageCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex min-h-[96px] flex-col justify-between rounded-lg border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div>
        <div className="text-xl font-medium tabular text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
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
