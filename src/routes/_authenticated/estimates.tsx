import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Calculator,
  FileSpreadsheet,
  FolderOpen,
  Library,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  createEstimate,
  deleteEstimate,
  ESTIMATE_FOLDERS,
  listEstimateRegions,
  listEstimates,
  MASTER_ESTIMATE_PROJECT_TYPE,
  updateEstimate,
  type EstimateFolder,
  type EstimateRow,
} from "@/lib/estimates.functions";
import { fmtUSD } from "@/lib/format";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";

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

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type EstimateFolderFilter = "all" | EstimateFolder;
const folderLabel = (folder: EstimateFolder) =>
  ESTIMATE_FOLDERS.find((item) => item.value === folder)?.label ?? "Sales Process";

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

  const projectEstimates = useMemo(
    () =>
      (estimatesQuery.data ?? []).filter(
        (estimate) => estimate.project_type !== MASTER_ESTIMATE_PROJECT_TYPE,
      ),
    [estimatesQuery.data],
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<EstimateFolder, number>();
    for (const estimate of projectEstimates) {
      counts.set(estimate.folder, (counts.get(estimate.folder) ?? 0) + 1);
    }
    return counts;
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

  if (/^\/estimates\/[^/]+\/?$/.test(location.pathname)) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-6 py-5 lg:px-10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="ghost" size="icon" title="Back to portfolio">
                <Link to="/">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {companyName}
                </p>
                <h1 className="mt-1 font-serif text-3xl text-foreground">Estimates</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/">
                  <Calculator className="h-3.5 w-3.5" /> Portfolio
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/estimate-masters">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Master Sheets
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/cost-library">
                  <Library className="h-3.5 w-3.5" /> Cost Library
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/team">
                  <Users className="h-3.5 w-3.5" /> Company
                </Link>
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> New Estimate
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-6 py-8 lg:px-10">
        <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search estimates, folders, projects, opportunities, status, or region"
              className="pl-9"
            />
          </div>
        </div>

        <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 rounded-md border border-hairline bg-surface p-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Estimate Folders</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Keep active bids, won work, and not-won estimates separated before they become
                  projects or get cleaned out. Archived keeps a record; Delete permanently removes
                  it.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={folderFilter === "all" ? "default" : "outline"}
                onClick={() => setFolderFilter("all")}
              >
                All ({projectEstimates.length})
              </Button>
              {ESTIMATE_FOLDERS.map((folder) => (
                <Button
                  key={folder.value}
                  size="sm"
                  variant={folderFilter === folder.value ? "default" : "outline"}
                  onClick={() => setFolderFilter(folder.value)}
                >
                  {folder.label} ({folderCounts.get(folder.value) ?? 0})
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="bg-surface [&>th]:whitespace-nowrap">
                <TableHead>Name</TableHead>
                <TableHead>Client / Opportunity</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Line Items</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="w-[72px] text-right">Actions</TableHead>
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
                visibleEstimates.map((estimate) => (
                  <TableRow
                    key={estimate.id}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-surface/60 [&>td]:py-4"
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
                      <div className="font-serif text-lg">{estimate.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {estimate.region || "National"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {estimate.opportunity_name || estimate.project_name || "-"}
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
                      <Badge variant="outline" className="capitalize">
                        {estimate.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {estimate.line_item_count ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {fmtUSD(estimate.subtotal_cents / 100)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular">
                      {fmtUSD(estimate.total_with_markups_cents / 100)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

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
