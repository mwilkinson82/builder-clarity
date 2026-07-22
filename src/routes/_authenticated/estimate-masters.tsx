import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
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
  createBlankLineItems,
  createEstimate,
  listEstimateRegions,
  listMasterSheets,
} from "@/lib/estimates.functions";
import { fmtUSD } from "@/lib/format";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import { cn } from "@/lib/utils";

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

// House mono label (v2): 8.5px, .12em tracking, muted. Shared with the estimates
// list so the two tables read as one system.
const MONO_LABEL =
  "font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground";

const segmentClass = (active: boolean) =>
  cn(
    "whitespace-nowrap rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
    active
      ? "bg-primary text-primary-foreground"
      : "border border-hairline text-foreground hover:bg-muted",
  );

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function EstimateMastersPage() {
  const list = useServerFn(listMasterSheets);
  const create = useServerFn(createEstimate);
  const createBlankLines = useServerFn(createBlankLineItems);
  const regionList = useServerFn(listEstimateRegions);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRegion, setNewRegion] = useState("national");
  const [newBlankRows, setNewBlankRows] = useState("10");

  const estimatesQuery = useQuery({
    queryKey: ["estimate-masters"],
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

  const allMasters = useMemo(() => estimatesQuery.data ?? [], [estimatesQuery.data]);
  const visibleMasters = useMemo(() => {
    const q = search.trim().toLowerCase();
    // listMasterSheets returns only master sheets, filtered server-side.
    return allMasters.filter((estimate) => {
      if (!q) return true;
      return [estimate.name, estimate.description, estimate.region]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [allMasters, search]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await create({
        data: {
          name: newName,
          description: newDescription,
          kind: "master_sheet",
          region: newRegion === "national" ? "" : newRegion,
        },
      });
      const rowCount = Number(newBlankRows);
      if (Number.isFinite(rowCount) && rowCount > 0) {
        await createBlankLines({ data: { estimate_id: result.id, count: rowCount } });
      }
      return result;
    },
    onSuccess: (result) => {
      setNewOpen(false);
      setNewName("");
      setNewDescription("");
      setNewRegion("national");
      setNewBlankRows("10");
      window.location.assign(`/estimates/${result.id}`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Master sheet did not save"),
  });

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <PortfolioTopBar
        active="estimates"
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Master Sheet
          </Button>
        }
      />

      <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-5 px-6 py-8 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className={MONO_LABEL}>{companyName}</p>
            <h1 className="mt-2 font-serif text-3xl text-foreground">Master estimate sheets</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-muted-foreground">
              Your prep room for repeatable pricing — keep company rates here, update material and
              labor unit costs, copy for alternates, then spin a clean project estimate from the
              master. Open the Harbor sample first to see a finished sheet.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Estimating sections">
            <Link to="/estimates" className={segmentClass(false)}>
              Estimates
            </Link>
            <Link to="/estimate-masters" className={segmentClass(true)}>
              Master sheets
            </Link>
            <Link to="/cost-library" className={segmentClass(false)}>
              Cost library
            </Link>
          </nav>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search master sheets, trades, regions, or notes"
            className="bg-surface pl-9"
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-muted [&>th]:whitespace-nowrap">
                <TableHead className={MONO_LABEL}>Name</TableHead>
                <TableHead className={MONO_LABEL}>Purpose</TableHead>
                <TableHead className={cn(MONO_LABEL, "text-right")}>Lines</TableHead>
                <TableHead className={cn(MONO_LABEL, "text-right")}>Direct Cost</TableHead>
                <TableHead className={cn(MONO_LABEL, "text-right")}>Total Model</TableHead>
                <TableHead className={MONO_LABEL}>Last Updated</TableHead>
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
                    className="cursor-pointer [&>td]:py-4"
                    onClick={() => window.location.assign(`/estimates/${estimate.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        window.location.assign(`/estimates/${estimate.id}`);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="font-serif text-base">{estimate.name}</div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {estimate.region || "National"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[38ch] text-[12.5px] text-muted-foreground">
                      {estimate.description || "Reusable estimating master"}
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <AppFooter context={`Master sheets · ${allMasters.length}`} />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeaderV2
            eyebrow="Estimating"
            title="New Master Sheet"
            description="This creates the saved worksheet inside Overwatch. The import format download is only a column guide for Excel or CSV files."
          />
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
            <div className="space-y-1.5">
              <Label>Start with blank rows</Label>
              <Select value={newBlankRows} onValueChange={setNewBlankRows}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No blank rows</SelectItem>
                  <SelectItem value="5">5 blank rows</SelectItem>
                  <SelectItem value="10">10 blank rows</SelectItem>
                  <SelectItem value="15">15 blank rows</SelectItem>
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
