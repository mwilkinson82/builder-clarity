import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { calculateSelectionDates, selectionInstallDate } from "@/lib/selections-domain";
import type {
  ProjectSelectionRow,
  SelectionClientSeat,
  SelectionScheduleActivity,
} from "@/lib/selections.functions";

export interface SelectionEditorDraft {
  title: string;
  category: string;
  room_area: string;
  description: string;
  schedule_activity_id: string | null;
  schedule_override_acknowledged: boolean;
  need_on_site_date: string | null;
  procurement_lead_days: number;
  delivery_buffer_days: number;
  client_review_days: number;
  assigned_client_contact_id: string | null;
  allowance_cents: number;
  options: Array<{
    localId: string;
    title: string;
    description: string;
    manufacturer: string;
    model_number: string;
    finish: string;
    price_cents: number;
    is_recommended: boolean;
  }>;
}

interface SelectionEditorDialogProps {
  open: boolean;
  selection: ProjectSelectionRow | null;
  scheduleActivities: SelectionScheduleActivity[];
  clientSeats: SelectionClientSeat[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: SelectionEditorDraft) => void;
}

const emptyOption = () => ({
  localId: crypto.randomUUID(),
  title: "",
  description: "",
  manufacturer: "",
  model_number: "",
  finish: "",
  price_cents: 0,
  is_recommended: false,
});

function initialDraft(selection: ProjectSelectionRow | null): SelectionEditorDraft {
  if (!selection) {
    return {
      title: "",
      category: "",
      room_area: "",
      description: "",
      schedule_activity_id: null,
      schedule_override_acknowledged: false,
      need_on_site_date: null,
      procurement_lead_days: 42,
      delivery_buffer_days: 7,
      client_review_days: 7,
      assigned_client_contact_id: null,
      allowance_cents: 0,
      options: [emptyOption(), emptyOption()],
    };
  }
  return {
    title: selection.title,
    category: selection.category,
    room_area: selection.room_area,
    description: selection.description,
    schedule_activity_id: selection.schedule_activity_id,
    schedule_override_acknowledged: selection.schedule_override_acknowledged,
    need_on_site_date: selection.need_on_site_date,
    procurement_lead_days: selection.procurement_lead_days,
    delivery_buffer_days: selection.delivery_buffer_days,
    client_review_days: selection.client_review_days,
    assigned_client_contact_id: selection.assigned_client_contact_id,
    allowance_cents: selection.allowance_cents,
    options: selection.options.map((option) => ({
      localId: option.id,
      title: option.title,
      description: option.description,
      manufacturer: option.manufacturer,
      model_number: option.model_number,
      finish: option.finish,
      price_cents: option.price_cents,
      is_recommended: option.is_recommended,
    })),
  };
}

const dollars = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
const cents = (value: string) => Math.round(Math.max(0, Number(value) || 0) * 100);

export function SelectionEditorDialog({
  open,
  selection,
  scheduleActivities,
  clientSeats,
  saving,
  onOpenChange,
  onSave,
}: SelectionEditorDialogProps) {
  const [draft, setDraft] = useState(() => initialDraft(selection));

  useEffect(() => {
    if (open) setDraft(initialDraft(selection));
  }, [open, selection]);

  const linkedActivity = scheduleActivities.find(
    (activity) => activity.id === draft.schedule_activity_id,
  );
  const needOnSiteDate = linkedActivity
    ? selectionInstallDate(linkedActivity)
    : draft.need_on_site_date;
  const dates = useMemo(
    () =>
      calculateSelectionDates({
        needOnSiteDate,
        procurementLeadDays: draft.procurement_lead_days,
        deliveryBufferDays: draft.delivery_buffer_days,
        clientReviewDays: draft.client_review_days,
      }),
    [
      needOnSiteDate,
      draft.procurement_lead_days,
      draft.delivery_buffer_days,
      draft.client_review_days,
    ],
  );
  const valid =
    draft.title.trim().length > 0 &&
    draft.options.some((option) => option.title.trim().length > 0) &&
    Boolean(needOnSiteDate) &&
    Boolean(draft.schedule_activity_id || draft.schedule_override_acknowledged);

  const patchOption = (index: number, patch: Partial<SelectionEditorDraft["options"][number]>) =>
    setDraft((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option,
      ),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <p className="eyebrow">Selection package</p>
          <DialogTitle className="font-serif text-2xl">
            {selection ? "Edit selection" : "Add selection"}
          </DialogTitle>
          <DialogDescription>
            Link the install activity, work the procurement dates backward, and give the owner clear
            options to approve.
          </DialogDescription>
        </DialogHeader>

        {selection && selection.decision_status !== "draft" ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Editing creates version {selection.version + 1} and returns this package to draft so the
            client cannot approve stale information.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Selection title" className="md:col-span-2">
            <Input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Kitchen appliance package"
            />
          </Field>
          <Field label="Category">
            <Input
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              placeholder="Appliances, plumbing, tile…"
            />
          </Field>
          <Field label="Room / area">
            <Input
              value={draft.room_area}
              onChange={(event) => setDraft({ ...draft, room_area: event.target.value })}
              placeholder="Main kitchen"
            />
          </Field>
          <Field label="What the owner is deciding" className="md:col-span-2">
            <Textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="Scope, constraints, and what changes between the options."
            />
          </Field>
        </div>

        <section className="space-y-4 border-t border-hairline pt-5">
          <div>
            <p className="eyebrow">Schedule-driven dates</p>
            <h3 className="font-serif text-xl">Start with the CPM install activity</h3>
          </div>
          <Field label="CPM schedule activity">
            <Select
              value={draft.schedule_activity_id ?? "manual"}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  schedule_activity_id: value === "manual" ? null : value,
                  schedule_override_acknowledged:
                    value === "manual" ? draft.schedule_override_acknowledged : false,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">No CPM link — schedule manually</SelectItem>
                {scheduleActivities.map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.activity_id} · {activity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {!draft.schedule_activity_id ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
              <div className="flex gap-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="space-y-3">
                  <p className="text-sm text-foreground">
                    A CPM activity should exist so schedule movement automatically changes the
                    approval and order deadlines. You can override this when the schedule is not
                    built yet.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.schedule_override_acknowledged}
                      onCheckedChange={(checked) =>
                        setDraft({ ...draft, schedule_override_acknowledged: checked === true })
                      }
                    />
                    Continue with a manually controlled need-on-site date
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Need on site">
              <Input
                type="date"
                value={needOnSiteDate ?? ""}
                disabled={Boolean(linkedActivity)}
                onChange={(event) =>
                  setDraft({ ...draft, need_on_site_date: event.target.value || null })
                }
              />
            </Field>
            <NumberField
              label="Lead time (days)"
              value={draft.procurement_lead_days}
              onChange={(value) => setDraft({ ...draft, procurement_lead_days: value })}
            />
            <NumberField
              label="Delivery buffer (days)"
              value={draft.delivery_buffer_days}
              onChange={(value) => setDraft({ ...draft, delivery_buffer_days: value })}
            />
            <NumberField
              label="Owner review (days)"
              value={draft.client_review_days}
              onChange={(value) => setDraft({ ...draft, client_review_days: value })}
            />
          </div>

          <div className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3">
            <DateResult label="Owner decision due" value={dates.clientDecisionDueDate} />
            <DateResult label="Order by" value={dates.orderByDate} />
            <DateResult label="Need on site" value={dates.needOnSiteDate} />
          </div>
        </section>

        <section className="space-y-4 border-t border-hairline pt-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Client approver">
              <Select
                value={draft.assigned_client_contact_id ?? "unassigned"}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    assigned_client_contact_id: value === "unassigned" ? null : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Choose before sending</SelectItem>
                  {clientSeats
                    .filter((seat) => seat.contactId)
                    .map((seat) => (
                      <SelectItem key={seat.accessId} value={seat.contactId!}>
                        {seat.name} · {seat.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {clientSeats.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Add the owner in Client Portal first so Overwatch can send a secure approval link.
                </p>
              ) : null}
            </Field>
            <Field label="Allowance / budget">
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">$</span>
                <Input
                  className="pl-7"
                  inputMode="decimal"
                  value={dollars(draft.allowance_cents)}
                  onChange={(event) =>
                    setDraft({ ...draft, allowance_cents: cents(event.target.value) })
                  }
                />
              </div>
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Owner options</p>
              <h3 className="font-serif text-xl">What can they choose?</h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft({ ...draft, options: [...draft.options, emptyOption()] })}
            >
              <Plus className="h-4 w-4" /> Add option
            </Button>
          </div>

          <div className="space-y-3">
            {draft.options.map((option, index) => (
              <div key={option.localId} className="rounded-xl border border-hairline bg-card p-4">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_auto]">
                  <Field label={`Option ${index + 1}`}>
                    <Input
                      value={option.title}
                      onChange={(event) => patchOption(index, { title: event.target.value })}
                      placeholder="White oak, natural finish"
                    />
                  </Field>
                  <Field label="Manufacturer">
                    <Input
                      value={option.manufacturer}
                      onChange={(event) => patchOption(index, { manufacturer: event.target.value })}
                      placeholder="Brand"
                    />
                  </Field>
                  <Field label="Model">
                    <Input
                      value={option.model_number}
                      onChange={(event) => patchOption(index, { model_number: event.target.value })}
                      placeholder="Model number"
                    />
                  </Field>
                  <Field label="Finish">
                    <Input
                      value={option.finish}
                      onChange={(event) => patchOption(index, { finish: event.target.value })}
                      placeholder="Color / finish"
                    />
                  </Field>
                  <Field label="Price">
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        className="pl-7"
                        inputMode="decimal"
                        value={dollars(option.price_cents)}
                        onChange={(event) =>
                          patchOption(index, { price_cents: cents(event.target.value) })
                        }
                      />
                    </div>
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6"
                    aria-label={`Remove option ${index + 1}`}
                    disabled={draft.options.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: draft.options.filter((_, optionIndex) => optionIndex !== index),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <Input
                    className="min-w-[240px] flex-1"
                    value={option.description}
                    onChange={(event) => patchOption(index, { description: event.target.value })}
                    placeholder="Details, finish, included items, or tradeoffs"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={option.is_recommended}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          options: current.options.map((item, optionIndex) => ({
                            ...item,
                            is_recommended: checked === true && optionIndex === index,
                          })),
                        }))
                      }
                    />
                    Contractor recommended
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="signal"
            disabled={!valid || saving}
            onClick={() => onSave({ ...draft, need_on_site_date: needOnSiteDate })}
          >
            {saving ? "Saving…" : selection ? "Save new version" : "Create selection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
      />
    </Field>
  );
}

function DateResult({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-card p-3">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-serif text-lg">{value ?? "Not scheduled"}</p>
    </div>
  );
}
