import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft, Calculator, FileSpreadsheet, Library, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
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

export const Route = createFileRoute("/_authenticated/estimate-masters")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Master Estimate Sheets — Overwatch" },
      {
        name: "description",
        content: "Reusable master estimating sheets for Overwatch project estimates.",
      },
    ],
  }),
  component: EstimateMastersPage,
});

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function EstimateMastersPage() {
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

  const visibleMasters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (estimatesQuery.data ?? [])
      .filter((estimate) => estimate.project_type === MASTER_ESTIMATE_PROJECT_TYPE)
      .filter((estimate) => {
        if (!q) return true;
        return [estimate.name, estimate.description, estimate.region]
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
          project_type: MASTER_ESTIMATE_PROJECT_TYPE,
          region: newRegion === "national" ? "" : newRegion,
        },
      }),
    onSuccess: (result) => {
      setNewOpen(false);
      setNewName("");
      setNewDescription("");
      setNewRegion("national");
      window.location.assign(`/estimates/${result.id}`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Master sheet did not save"),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-6 py-5 lg:px-10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="ghost" size="icon" title="Back to estimates">
                <Link to="/estimates">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Estimating
                </p>
                <h1 className="mt-1 font-serif text-3xl text-foreground">Master Estimate Sheets</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/estimates">
                  <Calculator className="h-3.5 w-3.5" /> Project Estimates
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
                <Plus className="h-3.5 w-3.5" /> New Master Sheet
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-6 py-8 lg:px-10">
        <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 font-medium">
                <FileSpreadsheet className="h-4 w-4" />
                Prep room for repeatable pricing
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Keep your company master estimate here, update material and labor unit costs, copy
                it for alternates, then create a project estimate from the clean master.
              </p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New Master Sheet
            </Button>
          </div>
        </section>

        <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search master sheets, trades, regions, or notes"
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-surface [&>th]:whitespace-nowrap">
                <TableHead>Name</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Direct Cost</TableHead>
                <TableHead className="text-right">Total Model</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimatesQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : estimatesQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-danger">
                    {estimatesQuery.error instanceof Error
                      ? estimatesQuery.error.message
                      : "Master sheets did not load"}
                  </TableCell>
                </TableRow>
              ) : visibleMasters.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No master sheets yet. Create one from your current Excel estimate or copy the
                    Harbor sample into a reusable master.
                  </TableCell>
                </TableRow>
              ) : (
                visibleMasters.map((estimate) => (
                  <TableRow
                    key={estimate.id}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-surface/60 [&>td]:py-4"
                    onClick={() => window.location.assign(`/estimates/${estimate.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        window.location.assign(`/estimates/${estimate.id}`);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="font-serif text-lg">{estimate.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {estimate.region || "National"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[420px] text-sm text-muted-foreground">
                      {estimate.description || "Reusable estimating master"}
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
            <DialogTitle>New Master Sheet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This is your reusable estimating workbook inside Overwatch. Add lines manually or
              import your existing Excel/CSV master sheet after it opens.
            </p>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Company master estimate"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Purpose / Notes</Label>
              <Input
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Baseline pricing, alternates, or trade package"
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
              Create Master Sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
