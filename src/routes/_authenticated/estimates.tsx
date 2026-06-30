import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft, Calculator, FileSpreadsheet, Library, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
  listEstimateRegions,
  listEstimates,
  MASTER_ESTIMATE_PROJECT_TYPE,
} from "@/lib/estimates.functions";
import { fmtUSD } from "@/lib/format";

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

function EstimatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const list = useServerFn(listEstimates);
  const create = useServerFn(createEstimate);
  const regionList = useServerFn(listEstimateRegions);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRegion, setNewRegion] = useState("national");

  const estimatesQuery = useQuery({
    queryKey: ["estimates"],
    queryFn: () => list(),
  });
  const regionsQuery = useQuery({
    queryKey: ["estimate-regions"],
    queryFn: () => regionList(),
  });

  const visibleEstimates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (estimatesQuery.data ?? [])
      .filter((estimate) => estimate.project_type !== MASTER_ESTIMATE_PROJECT_TYPE)
      .filter((estimate) => {
        if (!q) return true;
        return [
          estimate.name,
          estimate.description,
          estimate.status,
          estimate.project_name,
          estimate.opportunity_name,
          estimate.region,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [estimatesQuery.data, search]);

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
                  Overwatch
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
              placeholder="Search estimates, projects, opportunities, status, or region"
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-surface [&>th]:whitespace-nowrap">
                <TableHead>Name</TableHead>
                <TableHead>Client / Opportunity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Line Items</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimatesQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : estimatesQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-danger">
                    {estimatesQuery.error instanceof Error
                      ? estimatesQuery.error.message
                      : "Estimates did not load"}
                  </TableCell>
                </TableRow>
              ) : visibleEstimates.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No project estimates found. Create a new estimate, or start from a master sheet.
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
    </div>
  );
}
