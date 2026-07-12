import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppFooter } from "@/components/layout/AppFooter";
import { PortfolioTopBar } from "@/components/layout/PortfolioTopBar";
import {
  createEstimate,
  deleteEstimate,
  ESTIMATE_FOLDERS,
  listEstimateRegions,
  listEstimates,
  updateEstimate,
  type EstimateFolder,
  type EstimateRow,
  type EstimateStatus,
} from "@/lib/estimates.functions";
import { fmtUSD } from "@/lib/format";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/estimates")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Estimates — Overwatch" },
      {
        name: "description",
        content: "Manual spreadsheet estimating with Overwatch cost library and project handoff.",
      },
    ],
  }),
  component: EstimatesPage,
});

// House mono label (v2): 8.5px, .12em tracking, muted. Reused for KPI labels and
// table headers so the two read as one system.
const MONO_LABEL =
  "font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground";

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Compact serif-figure money for the KPI tiles ($6.5M / $840K). Full dollars go
// to the footer via fmtUSD; whole-cents in, no float dollars kept.
function fmtCompactUSD(cents: number) {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return fmtUSD(dollars);
}

type EstimateFolderFilter = "all" | EstimateFolder;
const folderLabel = (folder: EstimateFolder) =>
  ESTIMATE_FOLDERS.find((item) => item.value === folder)?.label ?? "Sales Process";

// Display-only reconciliation: the enum stays draft/final/awarded/lost; the list
// shows plain-English labels + a semantic tone (no "Overwatch blue" — Submitted
// borrows clay, not the info blue from the mock).
const STATUS_DISPLAY: Record<EstimateStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-warning" },
  final: { label: "Submitted", className: "text-clay" },
  awarded: { label: "Won", className: "text-success" },
  lost: { label: "Lost", className: "text-danger" },
};
const statusDisplay = (status: EstimateStatus) =>
  STATUS_DISPLAY[status] ?? { label: status, className: "text-muted-foreground" };

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        tone === "good" ? "border-success/30 bg-success/5" : "border-hairline bg-surface",
      )}
    >
      <div className={MONO_LABEL}>{label}</div>
      <div
        className={cn(
          "mt-1.5 font-serif text-[22px] leading-none",
          tone === "good" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FolderPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-clay bg-clay/10 text-clay"
          : "border-hairline bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular opacity-70">{count}</span>
    </button>
  );
}

const segmentClass = (active: boolean) =>
  cn(
    "whitespace-nowrap rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
    active
      ? "bg-primary text-primary-foreground"
      : "border border-hairline text-foreground hover:bg-muted",
  );

function EstimatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listEstimates);
  const create = useServerFn(createEstimate);
  const update = useServerFn(updateEstimate);
  const deleteEstimateFn = useServerFn(deleteEstimate);
  const regionList = useServerFn(listEstimateRegions);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<EstimateFolderFilter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRegion, setNewRegion] = useState("national");
  const [deleteTarget, setDeleteTarget] = useState<EstimateRow | null>(null);

  const estimatesQuery = useQuery({
    queryKey: ["estimates"],
    queryFn: () => list(),
  });
  const regionsQuery = useQuery({
    queryKey: ["estimate-regions"],
    queryFn: () => regionList(),
  });
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });
  const companyName = companyContext?.name || "Company";

  // listEstimates filters master sheets out server-side.
  const projectEstimates = useMemo(() => estimatesQuery.data ?? [], [estimatesQuery.data]);

  const folderCounts = useMemo(() => {
    const counts = new Map<EstimateFolder, number>();
    for (const estimate of projectEstimates) {
      counts.set(estimate.folder, (counts.get(estimate.folder) ?? 0) + 1);
    }
    return counts;
  }, [projectEstimates]);

  // KPI roll-up, all derived client-side from listEstimates (no new server fn):
  //  • Bid value out  = Σ total_with_markups of estimates still out to bid
  //    (folder === sales_process — the clean "in play, not won/lost/archived" set)
  //  • Won this year   = Σ total_with_markups of Won-folder estimates touched this year
  //  • Win rate        = won ÷ (won + not_won), guarded against ÷0 (null → "—")
  const kpis = useMemo(() => {
    const currentYear = new Date().getFullYear();
    let bidValueOutCents = 0;
    let wonThisYearCents = 0;
    let wonCount = 0;
    let notWonCount = 0;
    for (const estimate of projectEstimates) {
      if (estimate.folder === "sales_process") {
        bidValueOutCents += estimate.total_with_markups_cents;
      }
      if (estimate.folder === "won") {
        wonCount += 1;
        const touched = new Date(estimate.updated_at);
        if (!Number.isNaN(touched.getTime()) && touched.getFullYear() === currentYear) {
          wonThisYearCents += estimate.total_with_markups_cents;
        }
      }
      if (estimate.folder === "not_won") {
        notWonCount += 1;
      }
    }
    const decided = wonCount + notWonCount;
    const winRate = decided > 0 ? Math.round((wonCount / decided) * 100) : null;
    return {
      count: projectEstimates.length,
      bidValueOutCents,
      wonThisYearCents,
      winRate,
    };
  }, [projectEstimates]);

  const visibleEstimates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projectEstimates
      .filter((estimate) => folderFilter === "all" || estimate.folder === folderFilter)
      .filter((estimate) => {
        if (!q) return true;
        return [
          estimate.name,
          estimate.description,
          estimate.status,
          folderLabel(estimate.folder),
          estimate.project_name,
          estimate.opportunity_name,
          estimate.region,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [folderFilter, projectEstimates, search]);

  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          name: newName,
          description: newDescription,
          project_type: "commercial",
          region: newRegion === "national" ? "" : newRegion,
        },
      }),
    onSuccess: (result) => {
      setNewOpen(false);
      setNewName("");
      setNewDescription("");
      setNewRegion("national");
      navigate({ to: "/estimates/$estimateId", params: { estimateId: result.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate did not save"),
  });

  const folderMutation = useMutation({
    mutationFn: ({ id, folder }: { id: string; folder: EstimateFolder }) =>
      update({ data: { id, patch: { folder } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Estimate moved");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate folder did not update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEstimateFn({ data: { id } }),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Estimate deleted");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate did not delete"),
  });

  if (/^\/estimates\/[^/]+(?:\/.*)?$/.test(location.pathname)) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <PortfolioTopBar
        active="estimates"
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Estimate
          </Button>
        }
      />

      <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-5 px-6 py-8 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className={MONO_LABEL}>{companyName}</p>
            <h1 className="mt-2 font-serif text-3xl text-foreground">Estimates</h1>
            <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">
              Manual spreadsheet estimating with the Overwatch cost library — win a bid and hand it
              straight off to a project.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Estimating sections">
            <Link to="/estimates" className={segmentClass(true)}>
              Estimates
            </Link>
            <Link to="/estimate-masters" className={segmentClass(false)}>
              Master sheets
            </Link>
            <Link to="/cost-library" className={segmentClass(false)}>
              Cost library
            </Link>
          </nav>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Estimates" value={String(kpis.count)} />
          <StatCard label="Bid value out" value={fmtCompactUSD(kpis.bidValueOutCents)} />
          <StatCard
            label="Won this year"
            value={fmtCompactUSD(kpis.wonThisYearCents)}
            tone="good"
          />
          <StatCard label="Win rate" value={kpis.winRate === null ? "—" : `${kpis.winRate}%`} />
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search estimates, folders, projects, opportunities, status, or region"
            className="bg-surface pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <FolderPill
            label="All"
            count={projectEstimates.length}
            active={folderFilter === "all"}
            onClick={() => setFolderFilter("all")}
          />
          {ESTIMATE_FOLDERS.map((folder) => (
            <FolderPill
              key={folder.value}
              label={folder.label}
              count={folderCounts.get(folder.value) ?? 0}
              active={folderFilter === folder.value}
              onClick={() => setFolderFilter(folder.value)}
            />
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="bg-muted [&>th]:whitespace-nowrap">
                <TableHead className={MONO_LABEL}>Name</TableHead>
                <TableHead className={MONO_LABEL}>Client / Opportunity</TableHead>
                <TableHead className={MONO_LABEL}>Folder</TableHead>
                <TableHead className={MONO_LABEL}>Status</TableHead>
                <TableHead className={cn(MONO_LABEL, "text-right")}>Line Items</TableHead>
                <TableHead className={cn(MONO_LABEL, "text-right")}>Subtotal</TableHead>
                <TableHead className={cn(MONO_LABEL, "text-right")}>Total</TableHead>
                <TableHead className={MONO_LABEL}>Last Updated</TableHead>
                <TableHead className={cn(MONO_LABEL, "w-[72px] text-right")}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimatesQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : estimatesQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-danger">
                    {estimatesQuery.error instanceof Error
                      ? estimatesQuery.error.message
                      : "Estimates did not load"}
                  </TableCell>
                </TableRow>
              ) : visibleEstimates.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {folderFilter === "all"
                      ? "No project estimates found. Create a new estimate, or start from a master sheet."
                      : "No estimates in this folder yet. Move an estimate here when it belongs in this bucket."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleEstimates.map((estimate) => {
                  const status = statusDisplay(estimate.status);
                  const client = estimate.description?.trim();
                  const region = estimate.region || "National";
                  return (
                    <TableRow
                      key={estimate.id}
                      role="link"
                      tabIndex={0}
                      className="cursor-pointer [&>td]:py-4"
                      onClick={() =>
                        navigate({
                          to: "/estimates/$estimateId",
                          params: { estimateId: estimate.id },
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate({
                            to: "/estimates/$estimateId",
                            params: { estimateId: estimate.id },
                          });
                        }
                      }}
                    >
                      <TableCell>
                        <div className="font-serif text-base">{estimate.name}</div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {client ? `${client} · ${region}` : region}
                        </div>
                      </TableCell>
                      <TableCell className="text-[12.5px] text-muted-foreground">
                        {estimate.opportunity_name || estimate.project_name || "—"}
                      </TableCell>
                      <TableCell>
                        <div
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <Select
                            value={estimate.folder}
                            onValueChange={(folder) =>
                              folderMutation.mutate({
                                id: estimate.id,
                                folder: folder as EstimateFolder,
                              })
                            }
                            disabled={folderMutation.isPending}
                          >
                            <SelectTrigger className="h-9 w-[160px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ESTIMATE_FOLDERS.map((folder) => (
                                <SelectItem key={folder.value} value={folder.value}>
                                  {folder.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md border border-current px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.05em]",
                            status.className,
                          )}
                        >
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">
                        {estimate.line_item_count ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-serif text-sm tabular">
                        {fmtUSD(estimate.subtotal_cents / 100)}
                      </TableCell>
                      <TableCell className="text-right font-serif text-[15px] font-semibold tabular">
                        {fmtUSD(estimate.total_with_markups_cents / 100)}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">
                        {shortDate(estimate.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-danger"
                          title="Delete estimate"
                          aria-label="Delete estimate"
                          disabled={deleteMutation.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(estimate);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <AppFooter
        context={`Estimates · ${projectEstimates.length} · ${fmtUSD(
          kpis.bidValueOutCents / 100,
        )} out to bid`}
      />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Estimate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use this for a real bid or project estimate. For repeatable company pricing, build a
              master sheet first.
            </p>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Client / Description</Label>
              <Input
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={newRegion} onValueChange={setNewRegion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(regionsQuery.data?.regions ?? []).map((region) => (
                    <SelectItem key={region.code} value={region.code}>
                      {region.name} ({region.multiplier_decimal.toFixed(2)}x)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Estimate?</DialogTitle>
            <DialogDescription>
              This permanently removes{" "}
              {deleteTarget?.name ? `"${deleteTarget.name}"` : "this estimate"} and its line items
              from Overwatch. This does not move it to Archived.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={!deleteTarget || deleteMutation.isPending}
            >
              Delete Estimate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
