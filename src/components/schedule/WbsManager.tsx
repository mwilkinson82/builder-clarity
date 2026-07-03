import { useState, useEffect, useRef, type ReactNode } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ListTree, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cleanWbsDivisionInput,
  formatIndentedWbsLabel,
  getValidWbsParentRows,
  getWbsChildRows,
  getWbsDisplayMeta,
  getWbsSiblingPosition,
  getWbsSiblingRows,
  isSameWbsParent,
  isWbsDescendantPath,
  normalizeWbsDivisionName,
  type WbsDivisionRow,
} from "@/lib/constructline-wbs";
import { shortDate } from "./scheduleShared";

export function WbsManagerDialog({
  open,
  divisions,
  isSaving,
  isSavingOrder,
  onOpenChange,
  onAddDivision,
  onRenameDivision,
  onMoveDivisionParent,
  onMoveDivision,
  onReorderDivisions,
  isPersistenceReady,
  isPathFallback,
}: {
  open: boolean;
  divisions: WbsDivisionRow[];
  isSaving: boolean;
  isSavingOrder: boolean;
  isPersistenceReady: boolean;
  isPathFallback: boolean;
  onOpenChange: (open: boolean) => void;
  onAddDivision: (division: string, parentId?: string | null) => void;
  onRenameDivision: (fromDivision: string, toDivision: string) => Promise<void>;
  onMoveDivisionParent: (division: string, parentId: string | null) => Promise<void>;
  onMoveDivision: (division: string, direction: -1 | 1) => void;
  onReorderDivisions: (orderedDivisions: string[]) => void;
}) {
  const [newDivision, setNewDivision] = useState("");
  const [newDivisionParentId, setNewDivisionParentId] = useState<string>("root");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [savingDivision, setSavingDivision] = useState<string | null>(null);
  const [movingParentDivision, setMovingParentDivision] = useState<string | null>(null);
  const [draggingDivision, setDraggingDivision] = useState<string | null>(null);
  const [dropTargetDivision, setDropTargetDivision] = useState<string | null>(null);
  const [dropParentTargetId, setDropParentTargetId] = useState<string | null>(null);
  const newDivisionInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);
  const isLocked = !isPersistenceReady;
  const selectedParentRow =
    newDivisionParentId === "root"
      ? null
      : (divisions.find((row) => row.id === newDivisionParentId) ?? null);
  const parentDivisionCount = divisions.filter((row) => row.level === 0).length;
  const childDivisionCount = divisions.filter((row) => row.level > 0).length;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    setDraftNames((current) =>
      Object.fromEntries(
        divisions.map((row) => [row.division, current[row.division] ?? row.title]),
      ),
    );
    if (!wasOpenRef.current) {
      setNewDivisionParentId("root");
      setSavingDivision(null);
      setMovingParentDivision(null);
      setDraggingDivision(null);
      setDropTargetDivision(null);
      setDropParentTargetId(null);
      wasOpenRef.current = true;
    }
  }, [divisions, open]);

  const addDivision = () => {
    if (isLocked) return;
    const division = cleanWbsDivisionInput(newDivision);
    if (!division) return;
    onAddDivision(division, newDivisionParentId === "root" ? null : newDivisionParentId);
    setNewDivision("");
  };
  const startChildDivision = (row: WbsDivisionRow) => {
    if (!row.id || isLocked) return;
    setNewDivisionParentId(row.id);
    setNewDivision("");
    window.requestAnimationFrame(() => newDivisionInputRef.current?.focus());
  };

  const renameDivision = async (division: string) => {
    if (isLocked) return;
    const nextDivision = cleanWbsDivisionInput(draftNames[division]);
    if (!nextDivision || nextDivision === division) return;
    setSavingDivision(division);
    try {
      await onRenameDivision(division, nextDivision);
    } finally {
      setSavingDivision(null);
    }
  };
  const moveDivisionParent = async (division: string, parentId: string | null) => {
    if (isLocked) return;
    setMovingParentDivision(division);
    try {
      await onMoveDivisionParent(division, parentId);
    } finally {
      setMovingParentDivision(null);
    }
  };
  const reorderDivision = (targetDivision: string) => {
    if (isLocked || !draggingDivision || draggingDivision === targetDivision) return;
    const draggingRow = divisions.find((row) => row.division === draggingDivision);
    const targetRow = divisions.find((row) => row.division === targetDivision);
    if (!draggingRow?.id || !targetRow?.id || !isSameWbsParent(draggingRow, targetRow)) return;
    const orderedDivisions = getWbsSiblingRows(divisions, draggingRow).map((row) => row.division);
    const fromIndex = orderedDivisions.indexOf(draggingDivision);
    const toIndex = orderedDivisions.indexOf(targetDivision);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextOrder = [...orderedDivisions];
    const [movedDivision] = nextOrder.splice(fromIndex, 1);
    if (!movedDivision) return;
    nextOrder.splice(toIndex, 0, movedDivision);
    onReorderDivisions(nextOrder);
  };
  const canDropIntoParent = (parentId: string | null) => {
    const draggingRow = divisions.find((row) => row.division === draggingDivision);
    if (!draggingRow?.id || (draggingRow.parentId ?? null) === parentId) return false;
    const parentRow = parentId ? divisions.find((row) => row.id === parentId) : null;
    if (parentId && !parentRow?.id) return false;
    if (parentRow && isWbsDescendantPath(parentRow, draggingRow)) return false;
    return true;
  };
  const moveDraggingDivisionToParent = async (parentId: string | null) => {
    const draggingRow = divisions.find((row) => row.division === draggingDivision);
    if (!draggingRow?.id || !canDropIntoParent(parentId)) {
      resetDragState();
      return;
    }
    await moveDivisionParent(draggingRow.division, parentId);
    resetDragState();
  };
  const resetDragState = () => {
    setDraggingDivision(null);
    setDropTargetDivision(null);
    setDropParentTargetId(null);
  };
  const renderParentDropZone = (
    parentId: string | null,
    title: string,
    description: string,
    depth = 0,
  ) => {
    const dropKey = parentId ?? "root";
    const isActive = dropParentTargetId === dropKey && canDropIntoParent(parentId);
    const canDrop = Boolean(draggingDivision) && canDropIntoParent(parentId);
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-hairline bg-surface/60 px-3 py-2 text-xs text-muted-foreground transition",
          canDrop && "border-accent/50 bg-accent/10 text-foreground",
          isActive && "border-foreground/50 bg-muted text-foreground shadow-sm",
        )}
        style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
        onDragOver={(event) => {
          if (!canDropIntoParent(parentId) || isSaving || isLocked) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropParentTargetId(dropKey);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
            setDropParentTargetId((current) => (current === dropKey ? null : current));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void moveDraggingDivisionToParent(parentId);
        }}
      >
        <div className="flex min-w-0 items-start gap-2">
          <ListTree className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-foreground">{title}</div>
            <div className="mt-0.5 leading-4">{description}</div>
          </div>
        </div>
      </div>
    );
  };
  const renderChildDropTarget = (row: WbsDivisionRow) => {
    if (
      !row.id ||
      !draggingDivision ||
      draggingDivision === row.division ||
      !canDropIntoParent(row.id)
    ) {
      return null;
    }
    const isActive = dropParentTargetId === row.id;
    return (
      <div
        className={cn(
          "rounded border border-dashed border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-foreground transition",
          isActive && "border-foreground/50 bg-card shadow-sm",
        )}
        onDragOver={(event) => {
          if (isSaving || isLocked || !canDropIntoParent(row.id)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropTargetDivision(null);
          setDropParentTargetId(row.id);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
            setDropParentTargetId((current) => (current === row.id ? null : current));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void moveDraggingDivisionToParent(row.id);
        }}
      >
        Nest under {row.title}
      </div>
    );
  };
  const getChildRowsForRender = (parentId: string | null, parentPath: string | null = null) => {
    if (parentId) return getWbsChildRows(divisions, parentId);
    if (parentPath) {
      return divisions.filter((row) => !row.parentId && row.parentPath === parentPath);
    }
    return getWbsChildRows(divisions, null);
  };
  const renderDivisionRows = (
    parentId: string | null,
    depth = 0,
    parentPath: string | null = null,
  ): ReactNode => {
    const childRows = getChildRowsForRender(parentId, parentPath);
    if (childRows.length === 0) {
      if (parentId === null) return null;
      return (
        <div
          className="rounded-md border border-dashed border-hairline bg-surface/35 px-3 py-2 text-xs text-muted-foreground"
          style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
        >
          No child areas yet. Add one above or drag another WBS onto this parent.
        </div>
      );
    }

    return childRows.map((row) => {
      const draftName = draftNames[row.division] ?? row.title;
      const cleanDraftName = cleanWbsDivisionInput(draftName);
      const hasNameChange =
        normalizeWbsDivisionName(draftName) !== normalizeWbsDivisionName(row.title);
      const isRowSaving =
        savingDivision === row.division || movingParentDivision === row.division || isSaving;
      const canPersistRow = Boolean(row.id);
      const siblingPosition = getWbsSiblingPosition(divisions, row);
      const canMoveUp = canPersistRow && siblingPosition.index > 0;
      const canMoveDown =
        canPersistRow &&
        siblingPosition.index >= 0 &&
        siblingPosition.index < siblingPosition.count - 1;
      const parentOptions = getValidWbsParentRows(divisions, row);
      const childRowsForRow = getChildRowsForRender(row.id ?? null, row.division);
      const hasChildren = childRowsForRow.length > 0;
      const selectedParentId =
        row.parentId ??
        (row.parentPath
          ? (divisions.find((candidate) => candidate.division === row.parentPath)?.id ?? null)
          : null);

      return (
        <div key={row.division} className="grid gap-2">
          <div
            className={cn(
              "grid min-w-0 gap-3 rounded-md border border-hairline bg-card p-3 transition xl:grid-cols-[40px_minmax(260px,1fr)_minmax(220px,0.82fr)_minmax(150px,0.56fr)]",
              row.level > 0 && "border-l-4 border-l-accent/45",
              selectedParentRow?.id === row.id && "border-foreground/40 bg-muted/30",
              draggingDivision === row.division && "opacity-55",
              dropTargetDivision === row.division &&
                draggingDivision !== row.division &&
                "border-foreground/35 bg-muted/40 shadow-sm",
              dropParentTargetId === row.id &&
                draggingDivision !== row.division &&
                "border-accent/60 bg-accent/10 shadow-sm",
            )}
            style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
            onDragOver={(event) => {
              if (
                !draggingDivision ||
                draggingDivision === row.division ||
                isSaving ||
                isLocked ||
                !canPersistRow
              )
                return;
              const draggingRow = divisions.find((item) => item.division === draggingDivision);
              if (!draggingRow?.id) return;
              if (!isSameWbsParent(draggingRow, row)) {
                if (!row.id || !canDropIntoParent(row.id)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetDivision(null);
                setDropParentTargetId(row.id);
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetDivision(row.division);
              setDropParentTargetId(null);
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget as Node | null;
              if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                setDropTargetDivision((current) => (current === row.division ? null : current));
                setDropParentTargetId((current) => (current === row.id ? null : current));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const draggingRow = divisions.find((item) => item.division === draggingDivision);
              if (!canPersistRow || !draggingRow?.id) {
                resetDragState();
                return;
              }
              if (!isSameWbsParent(draggingRow, row)) {
                if (row.id && canDropIntoParent(row.id)) {
                  void moveDraggingDivisionToParent(row.id);
                  return;
                }
                resetDragState();
                return;
              }
              reorderDivision(row.division);
              resetDragState();
            }}
          >
            <button
              type="button"
              draggable={!isSaving && !isLocked && canPersistRow}
              className="flex h-9 w-9 cursor-grab items-center justify-center rounded border border-hairline bg-surface text-muted-foreground transition hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 xl:self-center"
              aria-label={`Drag ${row.division} to reorder WBS`}
              title="Drag onto another row to reorder. Use the Nest target to make it a child area."
              disabled={isSaving || isLocked || !canPersistRow}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.division);
                setDraggingDivision(row.division);
                setDropTargetDivision(null);
                setDropParentTargetId(null);
              }}
              onDragEnd={resetDragState}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span>{row.level > 0 ? "Child WBS / area" : "Parent WBS"}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  Level {row.level + 1}
                </span>
              </div>
              <Input
                value={draftName}
                onChange={(event) =>
                  setDraftNames((current) => ({
                    ...current,
                    [row.division]: event.target.value,
                  }))
                }
                className="h-9 min-w-0"
                disabled={isRowSaving || isLocked}
              />
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {row.parentPath ? `Path: ${row.division}` : "Top-level schedule WBS"}
              </div>
            </div>
            <LabeledField label="Parent WBS">
              <Select
                value={selectedParentId ?? "root"}
                disabled={!canPersistRow || isRowSaving || isLocked}
                onValueChange={(value) => {
                  void moveDivisionParent(row.division, value === "root" ? null : value);
                }}
              >
                <SelectTrigger className="h-9 min-w-0 bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Top level WBS</SelectItem>
                  {parentOptions.map((parentRow) => (
                    <SelectItem key={parentRow.id!} value={parentRow.id!}>
                      {formatIndentedWbsLabel(parentRow)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <div className="min-w-0 rounded border border-hairline bg-surface px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Activities
              </div>
              <div className="mt-1 text-sm font-semibold tabular text-foreground">
                {row.activityCount}
              </div>
              <div className="text-[11px] leading-4 text-muted-foreground">
                {row.childCount > 0
                  ? `${row.directActivityCount} direct · ${row.childCount} child ${
                      row.childCount === 1 ? "area" : "areas"
                    }`
                  : !row.isPersisted
                    ? "derived from activities"
                    : row.isPlaceholder
                      ? "empty"
                      : `${shortDate(row.firstStart)} to ${shortDate(row.lastFinish)}`}
              </div>
            </div>
            <div className="grid min-w-0 gap-2 xl:col-span-3 xl:col-start-2">
              {renderChildDropTarget(row)}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  disabled={!canPersistRow || isSaving || isLocked}
                  onClick={() => startChildDivision(row)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add child area
                </Button>
                <Button
                  type="button"
                  variant={selectedParentRow?.id === row.id ? "default" : "outline"}
                  className="h-9 whitespace-nowrap"
                  disabled={!canPersistRow || isSaving || isLocked}
                  onClick={() => setNewDivisionParentId(row.id ?? "root")}
                >
                  Use as parent
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  disabled={
                    !canPersistRow || !cleanDraftName || !hasNameChange || isRowSaving || isLocked
                  }
                  onClick={() => renameDivision(row.division)}
                >
                  {savingDivision === row.division ? "Saving..." : "Save title"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={!canMoveUp || isSaving || isLocked}
                  onClick={() => onMoveDivision(row.division, -1)}
                  aria-label={`Move ${row.division} up`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={!canMoveDown || isSaving || isLocked}
                  onClick={() => onMoveDivision(row.division, 1)}
                  aria-label={`Move ${row.division} down`}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {hasChildren && (
            <div className="grid gap-2 border-l border-hairline/70 pl-3">
              {renderDivisionRows(row.id ?? null, depth + 1, row.division)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSaving && onOpenChange(nextOpen)}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-2rem),72rem)] sm:max-w-[72rem]">
        <DialogHeader className="border-b border-hairline px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="font-serif text-2xl">WBS / area manager</DialogTitle>
          <DialogDescription>
            Build parent WBS sections, child areas, and the order each level appears in the CPM
            grid.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {isLocked && (
            <div className="rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
              This project is using activity WBS paths for grouping. Existing paths still display as
              WBS groups, and activity-level WBS edits can still adjust the schedule structure.
            </div>
          )}
          {isPathFallback && !isLocked && (
            <div className="rounded-md border border-hairline bg-card px-4 py-3 text-sm text-muted-foreground">
              Activity-path WBS mode is active. Parent and child areas save as schedule paths, so
              Concrete / Northwest corner, campus zones, rooms, trades, or subcontractor sequences
              can be grouped immediately.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.55fr)]">
            <div className="rounded-md border border-hairline bg-card px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                WBS hierarchy
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                Create a parent WBS such as{" "}
                <span className="font-semibold text-foreground">Concrete</span>, then add child
                areas like <span className="font-semibold text-foreground">Northwest corner</span>,{" "}
                <span className="font-semibold text-foreground">Southwest corner</span>, or{" "}
                <span className="font-semibold text-foreground">Eastern corner</span>. Activities
                assigned to child areas roll up under the parent WBS.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-hairline bg-card px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Parent WBS
                </div>
                <div className="mt-1 text-2xl font-semibold tabular text-foreground">
                  {parentDivisionCount}
                </div>
              </div>
              <div className="rounded-md border border-hairline bg-card px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Child areas
                </div>
                <div className="mt-1 text-2xl font-semibold tabular text-foreground">
                  {childDivisionCount}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-hairline bg-surface p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <LabeledField
                  label={selectedParentRow ? "New child WBS / area" : "New top-level WBS"}
                >
                  <Input
                    ref={newDivisionInputRef}
                    value={newDivision}
                    onChange={(event) => setNewDivision(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addDivision();
                      }
                    }}
                    placeholder={selectedParentRow ? "Northwest corner" : "Concrete"}
                    className="h-10 min-w-0"
                    disabled={isSaving || isLocked}
                  />
                </LabeledField>
                <Button
                  type="button"
                  className="h-10 gap-2"
                  disabled={!newDivision.trim() || isSaving || isLocked}
                  onClick={addDivision}
                >
                  <Plus className="h-4 w-4" />
                  {selectedParentRow ? "Add child area" : "Add WBS"}
                </Button>
              </div>
              <LabeledField label="Parent / child relationship">
                <Select
                  value={newDivisionParentId}
                  onValueChange={setNewDivisionParentId}
                  disabled={isSaving || isLocked}
                >
                  <SelectTrigger className="h-10 min-w-0 bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">Top level WBS</SelectItem>
                    {divisions
                      .filter((row) => row.id)
                      .map((row) => (
                        <SelectItem key={row.id!} value={row.id!}>
                          {formatIndentedWbsLabel(row)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </LabeledField>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0 rounded border border-hairline bg-card px-3 py-2">
                <span className="font-semibold text-foreground">Path preview:</span>{" "}
                {selectedParentRow
                  ? `${selectedParentRow.division} / ${newDivision.trim() || "New child area"}`
                  : newDivision.trim() || "New top-level WBS"}
              </div>
              {selectedParentRow && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  onClick={() => setNewDivisionParentId("root")}
                  disabled={isSaving || isLocked}
                >
                  Add at top level
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            {renderParentDropZone(
              null,
              "Drop here to make top-level WBS",
              "Use this when a section should sit beside General Requirements, Concrete, Finishes, or Milestones.",
            )}
            {divisions.length === 0 ? (
              <div className="rounded-md border border-hairline bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No WBS sections yet.
              </div>
            ) : (
              renderDivisionRows(null)
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-hairline px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-xs text-muted-foreground">
            {isSavingOrder
              ? "Order already changed in the grid; final save is confirming in the background."
              : isLocked
                ? "This project is grouped by the WBS field on each activity."
                : "Drag rows to reorder. Drop onto a parent to build child areas such as Concrete / Northwest corner."}
          </div>
          <Button type="button" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

export function ActivityDivisionInput({
  value,
  onChange,
  options,
  listId: _listId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  listId: string;
}) {
  const [customMode, setCustomMode] = useState(false);
  const normalizedOptions = Array.from(
    new Set(options.map((option) => normalizeWbsDivisionName(option)).filter(Boolean)),
  );
  const normalizedValue = normalizeWbsDivisionName(value);
  const selectedOption = normalizedOptions.find(
    (option) => option.toLocaleLowerCase() === normalizedValue.toLocaleLowerCase(),
  );
  const isCustom = customMode || !selectedOption;
  const selectValue = isCustom ? "__custom__" : (selectedOption ?? "__custom__");

  if (normalizedOptions.length === 0) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Concrete / Northwest corner"
        className="h-10 min-w-0"
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      <Select
        value={selectValue}
        onValueChange={(nextValue) => {
          if (nextValue === "__custom__") {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onChange(nextValue);
        }}
      >
        <SelectTrigger className="h-10 min-w-0 bg-card">
          <SelectValue placeholder="Choose WBS / child area" />
        </SelectTrigger>
        <SelectContent className="max-h-[22rem]">
          <SelectItem value="__custom__">Custom WBS / child area path</SelectItem>
          {normalizedOptions.map((option) => {
            const meta = getWbsDisplayMeta(option);
            return (
              <SelectItem key={option} value={option}>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                    style={{ width: `${Math.min(meta.level, 4) * 14}px` }}
                  />
                  <span className="min-w-0 truncate">{meta.level > 0 ? meta.title : option}</span>
                  {meta.parentPath && (
                    <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                      {meta.parentPath}
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {isCustom ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Concrete / Northwest corner"
          className="h-10 min-w-0"
        />
      ) : (
        <div className="truncate text-xs text-muted-foreground">
          {getWbsDisplayMeta(selectedOption).parentPath
            ? `Child area under ${getWbsDisplayMeta(selectedOption).parentPath}`
            : "Top-level WBS"}
        </div>
      )}
    </div>
  );
}
