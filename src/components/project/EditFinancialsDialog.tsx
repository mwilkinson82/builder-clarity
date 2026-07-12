// Edit-project dialog: name/number/client/PM, contract + cost budget, phase,
// % complete, default billing document, baseline/forecast dates (with live
// calculated schedule variance), and the hold-guidance note. Extracted from
// the project route during the PROJECTDECOMP1 mechanical split; verbatim, no
// behavior change.
import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fmtUSD } from "@/lib/format";
import { computeScheduleVarianceWeeks, type Phase, type Rollup } from "@/lib/ior";
import type { BillingOutputFormat, ProjectRow } from "@/lib/projects.functions";

export type EditableProject = {
  name: string;
  job_number: string;
  client: string;
  project_manager: string;
  original_contract: number;
  original_cost_budget: number;
  phase: Phase;
  percent_complete: number;
  hold_variance_note: string;
  forecast_completion_date: string | null;
  baseline_completion_date: string | null;
  default_output_format: BillingOutputFormat;
};

export function EditFinancialsDialog({
  project,
  rollup,
  guidance,
  onSave,
  pending,
}: {
  project: ProjectRow;
  rollup: Rollup;
  guidance: { ePct: number; cPct: number; eTarget: number; cTarget: number };
  onSave: (patch: Partial<EditableProject>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const defaultHoldNote = () => {
    const belowGuidance =
      rollup.exposureHolds < guidance.eTarget || rollup.contingencyHold < guidance.cTarget;
    const posture = belowGuidance
      ? "Below guidance: document why the project can safely carry less hold than the target."
      : "At or above guidance: document what is driving the hold and what must happen to release dollars.";
    return `${posture} Current holds: E-Hold ${fmtUSD(rollup.exposureHolds)} vs ${fmtUSD(guidance.eTarget)} guidance (${guidance.ePct}%) and C-Hold ${fmtUSD(rollup.contingencyHold)} vs ${fmtUSD(guidance.cTarget)} guidance (${guidance.cPct}%).`;
  };
  const init = (): EditableProject => ({
    name: project.name,
    job_number: project.job_number,
    client: project.client,
    project_manager: project.project_manager,
    original_contract: project.original_contract,
    original_cost_budget: project.original_cost_budget,
    phase: project.phase,
    percent_complete: project.percent_complete,
    hold_variance_note: project.hold_variance_note || defaultHoldNote(),
    forecast_completion_date: project.forecast_completion_date,
    baseline_completion_date: project.baseline_completion_date,
    default_output_format: project.default_output_format ?? "invoice",
  });
  const [form, setForm] = useState<EditableProject>(init);
  const calculatedScheduleVariance = computeScheduleVarianceWeeks(
    form.baseline_completion_date,
    form.forecast_completion_date,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(init());
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeaderV2 eyebrow="Project" title="Edit project" />
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Job number</Label>
              <Input
                value={form.job_number}
                onChange={(e) => setForm({ ...form, job_number: e.target.value })}
                placeholder="e.g. 26-014"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Input
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Project manager</Label>
            <Input
              value={form.project_manager}
              onChange={(e) => setForm({ ...form, project_manager: e.target.value })}
              placeholder="e.g. Marshall Wilkinson"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Original contract</Label>
              <MoneyInput
                value={form.original_contract}
                onValueChange={(v) => setForm({ ...form, original_contract: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Original cost budget</Label>
              <MoneyInput
                value={form.original_cost_budget}
                onValueChange={(v) => setForm({ ...form, original_cost_budget: v })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phase</Label>
              <Select
                value={form.phase}
                onValueChange={(v) => setForm({ ...form, phase: v as Phase })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Early">Early</SelectItem>
                  <SelectItem value="Middle">Middle</SelectItem>
                  <SelectItem value="Late">Late</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>% complete</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.percent_complete}
                onChange={(e) => setForm({ ...form, percent_complete: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Default billing document</Label>
            <Select
              value={form.default_output_format}
              onValueChange={(v) =>
                setForm({ ...form, default_output_format: v as BillingOutputFormat })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Client invoice</SelectItem>
                <SelectItem value="aia_g702">AIA G702/G703 (AIA-native project)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              New pay applications start in this format. Choose AIA G702/G703 for lender- or
              owner's-rep-driven jobs so the biller never has to flip it each time.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Baseline completion</Label>
              <Input
                type="date"
                value={form.baseline_completion_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, baseline_completion_date: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Forecast completion</Label>
              <Input
                type="date"
                value={form.forecast_completion_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, forecast_completion_date: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Calculated variance</Label>
              <div
                className={`flex h-10 items-center rounded-md border border-input bg-surface px-3 text-sm tabular ${
                  (calculatedScheduleVariance ?? 0) > 0
                    ? "text-danger"
                    : (calculatedScheduleVariance ?? 0) < 0
                      ? "text-success"
                      : "text-foreground"
                }`}
              >
                {calculatedScheduleVariance == null
                  ? "Set dates"
                  : calculatedScheduleVariance > 0
                    ? `+${calculatedScheduleVariance} wk`
                    : calculatedScheduleVariance < 0
                      ? `${calculatedScheduleVariance} wk`
                      : "On plan"}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              Hold guidance note{" "}
              <span className="text-muted-foreground">
                (why current E-Hold/C-Hold posture is appropriate)
              </span>
            </Label>
            <Textarea
              rows={2}
              value={form.hold_variance_note}
              placeholder={defaultHoldNote()}
              onChange={(e) => setForm({ ...form, hold_variance_note: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              onSave({
                ...form,
                hold_variance_note: form.hold_variance_note.trim() || defaultHoldNote(),
              });
              setOpen(false);
            }}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
