import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileClock, Plus, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createEstimateCommercialItem,
  createEstimateVersion,
  deleteEstimateCommercialItem,
  getEstimateCommercialWorkspace,
  updateEstimateCommercialItem,
  type AlternateDecision,
  type BidPackageStatus,
  type CommercialNoteType,
  type VendorQuoteStatus,
} from "@/lib/estimate-commercial.functions";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

const money = (cents: number) => fmtUSD(cents / 100);
const dollarsToCents = (value: string) => Math.round((Number(value) || 0) * 100);

export function EstimateCommercialControls({
  estimateId,
  estimateName,
  readOnly = false,
}: {
  estimateId: string;
  estimateName: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const load = useServerFn(getEstimateCommercialWorkspace);
  const create = useServerFn(createEstimateCommercialItem);
  const update = useServerFn(updateEstimateCommercialItem);
  const remove = useServerFn(deleteEstimateCommercialItem);
  const createVersion = useServerFn(createEstimateVersion);
  const [noteType, setNoteType] = useState<CommercialNoteType>("assumption");
  const [noteDescription, setNoteDescription] = useState("");
  const [alternateName, setAlternateName] = useState("");
  const [alternateDescription, setAlternateDescription] = useState("");
  const [alternateAmount, setAlternateAmount] = useState("");
  const [packageName, setPackageName] = useState("");
  const [packageScope, setPackageScope] = useState("");
  const [packageDueDate, setPackageDueDate] = useState("");
  const [quoteVendor, setQuoteVendor] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quotePackageId, setQuotePackageId] = useState("none");
  const [quoteInclusions, setQuoteInclusions] = useState("");
  const [quoteExclusions, setQuoteExclusions] = useState("");
  const [versionNote, setVersionNote] = useState("");

  const queryKey = ["estimate-commercial-workspace", estimateId];
  const query = useQuery({
    queryKey,
    queryFn: () => load({ data: { estimate_id: estimateId } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey });
  const success = (message: string) => {
    toast.success(message);
    refresh();
  };
  const failure = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : "Commercial control did not save");

  const createMutation = useMutation({
    mutationFn: create,
    onSuccess: () => success("Commercial control saved"),
    onError: failure,
  });
  const updateMutation = useMutation({
    mutationFn: update,
    onSuccess: () => success("Commercial control updated"),
    onError: failure,
  });
  const deleteMutation = useMutation({
    mutationFn: remove,
    onSuccess: () => success("Commercial control removed"),
    onError: failure,
  });
  const versionMutation = useMutation({
    mutationFn: () =>
      createVersion({
        data: {
          estimate_id: estimateId,
          name: `${estimateName} · Version ${(query.data?.versions.length ?? 0) + 1}`,
          note: versionNote,
        },
      }),
    onSuccess: () => {
      setVersionNote("");
      success("Immutable estimate version captured");
    },
    onError: failure,
  });

  const data = query.data;
  const lowestQuoteByPackage = useMemo(() => {
    const result = new Map<string, number>();
    for (const quote of data?.vendor_quotes ?? []) {
      if (!quote.bid_package_id || (quote.status !== "qualified" && quote.status !== "selected"))
        continue;
      const current = result.get(quote.bid_package_id);
      if (current == null || quote.amount_cents < current) {
        result.set(quote.bid_package_id, quote.amount_cents);
      }
    }
    return result;
  }, [data?.vendor_quotes]);

  if (query.isLoading) {
    return (
      <div className="rounded-xl border border-hairline p-5 text-sm text-muted-foreground">
        Loading commercial controls…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm text-danger">
        Commercial controls did not load.
      </div>
    );
  }
  if (!data?.ready) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-5">
        <p className="font-semibold">Commercial controls are awaiting the database release.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The worksheet remains available; versions, alternates, assumptions, bid packages, and
          quote leveling will appear once it's available.
        </p>
      </div>
    );
  }

  return (
    <section
      className="rounded-xl border border-hairline bg-surface p-4"
      data-testid="estimate-commercial-controls"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Commercial controls</p>
          <h2 className="mt-1 font-serif text-2xl">Bid scope, versions, and quote leveling</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep assumptions visible, price alternates separately, compare qualified quotes, and
            preserve every release point.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{data.notes.length} scope notes</Badge>
          <Badge variant="outline">{data.alternates.length} alternates</Badge>
          <Badge variant="outline">{data.vendor_quotes.length} quotes</Badge>
          <Badge variant="secondary">v{data.versions[0]?.version_no ?? 0}</Badge>
        </div>
      </div>

      <Tabs defaultValue="scope" className="mt-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="scope">Assumptions & exclusions</TabsTrigger>
          <TabsTrigger value="alternates">Alternates</TabsTrigger>
          <TabsTrigger value="quotes">Bid packages & quotes</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="scope" className="mt-4 space-y-3">
          {!readOnly && (
            <div className="grid gap-2 rounded-lg border border-hairline bg-background p-3 md:grid-cols-[170px_1fr_auto]">
              <Select
                value={noteType}
                onValueChange={(value) => setNoteType(value as CommercialNoteType)}
              >
                <SelectTrigger aria-label="Scope note type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assumption">Assumption</SelectItem>
                  <SelectItem value="exclusion">Exclusion</SelectItem>
                  <SelectItem value="clarification">Clarification</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={noteDescription}
                onChange={(event) => setNoteDescription(event.target.value)}
                placeholder="State the bid condition clearly"
              />
              <Button
                disabled={!noteDescription.trim() || createMutation.isPending}
                onClick={() => {
                  createMutation.mutate({
                    data: {
                      kind: "note",
                      estimate_id: estimateId,
                      note_type: noteType,
                      description: noteDescription,
                    },
                  });
                  setNoteDescription("");
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add
              </Button>
            </div>
          )}
          {data.notes.length === 0 ? (
            <Empty label="No assumptions, exclusions, or clarifications recorded." />
          ) : (
            data.notes.map((note) => (
              <div
                key={note.id}
                className="flex items-start gap-3 rounded-lg border border-hairline p-3"
              >
                <Badge variant={note.note_type === "exclusion" ? "destructive" : "outline"}>
                  {note.note_type}
                </Badge>
                <p
                  className={cn(
                    "flex-1 text-sm",
                    note.status === "resolved" && "text-muted-foreground line-through",
                  )}
                >
                  {note.description}
                </p>
                {!readOnly && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        updateMutation.mutate({
                          data: {
                            kind: "note",
                            id: note.id,
                            status: note.status === "open" ? "resolved" : "open",
                          },
                        })
                      }
                    >
                      {note.status === "open" ? "Resolve" : "Reopen"}
                    </Button>
                    <IconDelete
                      onClick={() => deleteMutation.mutate({ data: { kind: "note", id: note.id } })}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="alternates" className="mt-4 space-y-3">
          {!readOnly && (
            <div className="grid gap-2 rounded-lg border border-hairline bg-background p-3 lg:grid-cols-[220px_1fr_150px_auto]">
              <Input
                value={alternateName}
                onChange={(event) => setAlternateName(event.target.value)}
                placeholder="Alternate name"
              />
              <Input
                value={alternateDescription}
                onChange={(event) => setAlternateDescription(event.target.value)}
                placeholder="Scope and basis"
              />
              <Input
                type="number"
                value={alternateAmount}
                onChange={(event) => setAlternateAmount(event.target.value)}
                placeholder="Amount $"
              />
              <Button
                disabled={!alternateName.trim()}
                onClick={() => {
                  createMutation.mutate({
                    data: {
                      kind: "alternate",
                      estimate_id: estimateId,
                      name: alternateName,
                      description: alternateDescription,
                      amount_cents: dollarsToCents(alternateAmount),
                    },
                  });
                  setAlternateName("");
                  setAlternateDescription("");
                  setAlternateAmount("");
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add
              </Button>
            </div>
          )}
          {data.alternates.length === 0 ? (
            <Empty label="No bid alternates recorded." />
          ) : (
            data.alternates.map((alternate) => (
              <div
                key={alternate.id}
                className="grid items-center gap-3 rounded-lg border border-hairline p-3 md:grid-cols-[1fr_150px_170px_auto]"
              >
                <div>
                  <p className="font-semibold">{alternate.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {alternate.description || "No scope note"}
                  </p>
                </div>
                <p className="text-right font-serif text-lg">{money(alternate.amount_cents)}</p>
                <Select
                  disabled={readOnly}
                  value={alternate.decision}
                  onValueChange={(decision) =>
                    updateMutation.mutate({
                      data: {
                        kind: "alternate",
                        id: alternate.id,
                        decision: decision as AlternateDecision,
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="included">Included</SelectItem>
                    <SelectItem value="excluded">Excluded</SelectItem>
                  </SelectContent>
                </Select>
                {!readOnly && (
                  <IconDelete
                    onClick={() =>
                      deleteMutation.mutate({ data: { kind: "alternate", id: alternate.id } })
                    }
                  />
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="quotes" className="mt-4 space-y-4">
          {!readOnly && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-hairline bg-background p-3">
                <Label>New bid package</Label>
                <Input
                  value={packageName}
                  onChange={(event) => setPackageName(event.target.value)}
                  placeholder="Division 03 · Concrete"
                />
                <Textarea
                  value={packageScope}
                  onChange={(event) => setPackageScope(event.target.value)}
                  placeholder="Scope issued for pricing"
                  className="min-h-20"
                />
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={packageDueDate}
                    onChange={(event) => setPackageDueDate(event.target.value)}
                  />
                  <Button
                    disabled={!packageName.trim()}
                    onClick={() => {
                      createMutation.mutate({
                        data: {
                          kind: "package",
                          estimate_id: estimateId,
                          name: packageName,
                          scope: packageScope,
                          due_date: packageDueDate || null,
                        },
                      });
                      setPackageName("");
                      setPackageScope("");
                      setPackageDueDate("");
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Package
                  </Button>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-hairline bg-background p-3">
                <Label>New vendor quote</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={quoteVendor}
                    onChange={(event) => setQuoteVendor(event.target.value)}
                    placeholder="Vendor"
                  />
                  <Input
                    type="number"
                    value={quoteAmount}
                    onChange={(event) => setQuoteAmount(event.target.value)}
                    placeholder="Amount $"
                  />
                </div>
                <Select value={quotePackageId} onValueChange={setQuotePackageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Bid package" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {data.bid_packages.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={quoteInclusions}
                    onChange={(event) => setQuoteInclusions(event.target.value)}
                    placeholder="Key inclusions"
                  />
                  <Input
                    value={quoteExclusions}
                    onChange={(event) => setQuoteExclusions(event.target.value)}
                    placeholder="Key exclusions"
                  />
                </div>
                <Button
                  disabled={!quoteVendor.trim()}
                  onClick={() => {
                    createMutation.mutate({
                      data: {
                        kind: "quote",
                        estimate_id: estimateId,
                        bid_package_id: quotePackageId === "none" ? null : quotePackageId,
                        vendor_name: quoteVendor,
                        amount_cents: dollarsToCents(quoteAmount),
                        inclusions: quoteInclusions,
                        exclusions: quoteExclusions,
                      },
                    });
                    setQuoteVendor("");
                    setQuoteAmount("");
                    setQuoteInclusions("");
                    setQuoteExclusions("");
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Quote
                </Button>
              </div>
            </div>
          )}
          {data.bid_packages.length === 0 ? (
            <Empty label="No bid packages created." />
          ) : (
            data.bid_packages.map((pkg) => {
              const quotes = data.vendor_quotes.filter((quote) => quote.bid_package_id === pkg.id);
              const low = lowestQuoteByPackage.get(pkg.id);
              return (
                <div key={pkg.id} className="rounded-lg border border-hairline p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pkg.scope || "No issued scope"}
                        {pkg.due_date ? ` · Due ${pkg.due_date}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        disabled={readOnly}
                        value={pkg.status}
                        onValueChange={(status) =>
                          updateMutation.mutate({
                            data: {
                              kind: "package",
                              id: pkg.id,
                              status: status as BidPackageStatus,
                            },
                          })
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="issued">Issued</SelectItem>
                          <SelectItem value="leveled">Leveled</SelectItem>
                          <SelectItem value="awarded">Awarded</SelectItem>
                        </SelectContent>
                      </Select>
                      {!readOnly && (
                        <IconDelete
                          onClick={() =>
                            deleteMutation.mutate({ data: { kind: "package", id: pkg.id } })
                          }
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 xl:grid-cols-2">
                    {quotes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No quotes assigned.</p>
                    ) : (
                      quotes.map((quote) => (
                        <div
                          key={quote.id}
                          className={cn(
                            "rounded-md border p-3",
                            low === quote.amount_cents && "border-success/40 bg-success/5",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">{quote.vendor_name}</p>
                              <p className="font-serif text-lg">{money(quote.amount_cents)}</p>
                            </div>
                            {low === quote.amount_cents && (
                              <Badge className="bg-success text-success-foreground">
                                Low qualified
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            In: {quote.inclusions || "—"} · Out: {quote.exclusions || "—"}
                          </p>
                          <div className="mt-2 flex justify-end gap-1">
                            <Select
                              disabled={readOnly}
                              value={quote.status}
                              onValueChange={(status) =>
                                updateMutation.mutate({
                                  data: {
                                    kind: "quote",
                                    id: quote.id,
                                    status: status as VendorQuoteStatus,
                                  },
                                })
                              }
                            >
                              <SelectTrigger className="h-8 w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="invited">Invited</SelectItem>
                                <SelectItem value="received">Received</SelectItem>
                                <SelectItem value="qualified">Qualified</SelectItem>
                                <SelectItem value="selected">Selected</SelectItem>
                                <SelectItem value="declined">Declined</SelectItem>
                              </SelectContent>
                            </Select>
                            {!readOnly && (
                              <IconDelete
                                onClick={() =>
                                  deleteMutation.mutate({ data: { kind: "quote", id: quote.id } })
                                }
                              />
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="versions" className="mt-4 space-y-3">
          {!readOnly && (
            <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-background p-3 md:flex-row">
              <Input
                value={versionNote}
                onChange={(event) => setVersionNote(event.target.value)}
                placeholder="What changed in this pricing release?"
              />
              <Button onClick={() => versionMutation.mutate()} disabled={versionMutation.isPending}>
                <FileClock className="mr-1.5 h-4 w-4" /> Capture version
              </Button>
            </div>
          )}
          {data.versions.length === 0 ? (
            <Empty label="No immutable pricing versions captured yet." />
          ) : (
            data.versions.map((version) => (
              <div
                key={version.id}
                className="grid items-center gap-3 rounded-lg border border-hairline p-3 md:grid-cols-[80px_1fr_160px_160px]"
              >
                <Badge variant="secondary">Version {version.version_no}</Badge>
                <div>
                  <p className="font-semibold">{version.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {version.note || "No change note"} ·{" "}
                    {new Date(version.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Direct</p>
                  <p className="font-serif">{money(version.subtotal_cents)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Bid total</p>
                  <p className="font-serif text-lg">{money(version.total_cents)}</p>
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline p-5 text-center text-sm text-muted-foreground">
      <Scale className="mx-auto mb-2 h-5 w-5" />
      {label}
    </div>
  );
}

function IconDelete({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-8 w-8"
      onClick={onClick}
      aria-label="Delete"
    >
      <Trash2 className="h-4 w-4 text-danger" />
    </Button>
  );
}
