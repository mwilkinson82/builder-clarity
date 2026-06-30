import type { ScheduleActivityRow, ScheduleWbsSectionRow } from "@/lib/schedule.functions";

export const WBS_PATH_SEPARATOR = " / ";

export type WbsDivisionRow = {
  id: string | null;
  division: string;
  title: string;
  parentId: string | null;
  parentPath: string | null;
  level: number;
  activityCount: number;
  directActivityCount: number;
  firstStart: string | null;
  lastFinish: string | null;
  childCount: number;
  isPlaceholder: boolean;
  isPersisted: boolean;
};

export type WbsSectionDescriptor = {
  id: string;
  title: string;
  path: string;
  parentId: string | null;
  parentPath: string | null;
  level: number;
  sortOrder: number;
  isDerived: boolean;
};

export function compareWbsDivision(
  a: string | null | undefined,
  b: string | null | undefined,
  order: string[] = [],
) {
  const leftLabel = normalizeWbsDivisionName(a);
  const rightLabel = normalizeWbsDivisionName(b);
  const leftIndex = getWbsOrderIndex(leftLabel, order);
  const rightIndex = getWbsOrderIndex(rightLabel, order);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;

  const left = getWbsDivisionSortKey(a);
  const right = getWbsDivisionSortKey(b);
  return left.rank - right.rank || naturalWbsCompare(left.label, right.label);
}

export function normalizeWbsDivisionName(value?: string | null) {
  return joinWbsPath(splitWbsPath(value));
}

export function cleanWbsDivisionInput(value?: string | null) {
  return (value ?? "").trim();
}

export function splitWbsPath(value?: string | null) {
  return (value || "General")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinWbsPath(parts: string[]) {
  return (parts.length > 0 ? parts : ["General"]).join(WBS_PATH_SEPARATOR);
}

export function getWbsDisplayMeta(value?: string | null) {
  const parts = splitWbsPath(value);
  const title = parts[parts.length - 1] ?? "General";
  const parentPath = parts.length > 1 ? joinWbsPath(parts.slice(0, -1)) : null;
  return {
    title,
    parentPath,
    level: Math.max(0, parts.length - 1),
  };
}

export function getImmediateChildWbsTitle(parentPath: string, value?: string | null) {
  const parentParts = splitWbsPath(parentPath);
  const parts = splitWbsPath(value);
  if (parts.length <= parentParts.length) return null;
  const actualParent = joinWbsPath(parts.slice(0, parentParts.length));
  if (actualParent !== joinWbsPath(parentParts)) return null;
  return parts[parentParts.length] ?? null;
}

export function hasWbsDivision(divisions: string[], division: string) {
  const target = normalizeWbsDivisionName(division).toLocaleLowerCase();
  return divisions.some((item) => normalizeWbsDivisionName(item).toLocaleLowerCase() === target);
}

export function buildWbsDivisionOrder(
  activities: ScheduleActivityRow[],
  sections: ScheduleWbsSectionRow[],
) {
  const sectionOrder = buildWbsSectionDescriptors(sections).map((section) => section.path);
  const activityDivisions = Array.from(
    new Set(activities.map((activity) => normalizeWbsDivisionName(activity.division))),
  ).sort((a, b) => compareWbsDivision(a, b));
  return [
    ...sectionOrder,
    ...activityDivisions.filter((division) => !hasWbsDivision(sectionOrder, division)),
  ];
}

export function moveWbsDivisionInOrder(
  order: WbsDivisionRow[],
  division: string,
  direction: -1 | 1,
) {
  const row = order.find((item) => item.division === division);
  if (!row?.id) return [];
  const siblings = getWbsSiblingRows(order, row);
  const index = siblings.findIndex((item) => item.division === division);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return siblings;
  const nextOrder = [...siblings];
  const [item] = nextOrder.splice(index, 1);
  nextOrder.splice(targetIndex, 0, item);
  return nextOrder;
}

export function getWbsSiblingRows(rows: WbsDivisionRow[], row: WbsDivisionRow) {
  return rows.filter((candidate) => candidate.id && isSameWbsParent(candidate, row));
}

export function getWbsChildRows(rows: WbsDivisionRow[], parentId: string | null) {
  const parent = parentId ? rows.find((row) => row.id === parentId) : null;
  return rows.filter((row) => {
    if (parentId) {
      return row.parentId === parentId || (!row.parentId && row.parentPath === parent?.division);
    }
    return !row.parentId && !row.parentPath;
  });
}

export function getWbsSiblingPosition(rows: WbsDivisionRow[], row: WbsDivisionRow) {
  const siblings = getWbsSiblingRows(rows, row);
  return {
    index: siblings.findIndex((candidate) => candidate.division === row.division),
    count: siblings.length,
  };
}

export function isSameWbsParent(a: WbsDivisionRow, b: WbsDivisionRow) {
  return (a.parentId ?? null) === (b.parentId ?? null);
}

export function getValidWbsParentRows(rows: WbsDivisionRow[], row: WbsDivisionRow) {
  return rows.filter((candidate) => {
    if (!candidate.id || candidate.id === row.id) return false;
    return !candidate.division.startsWith(`${row.division}${WBS_PATH_SEPARATOR}`);
  });
}

export function isWbsDescendantPath(candidate: WbsDivisionRow, parent: WbsDivisionRow) {
  return (
    candidate.division === parent.division ||
    candidate.division.startsWith(`${parent.division}${WBS_PATH_SEPARATOR}`)
  );
}

export function buildWbsDivisionRows(
  activities: ScheduleActivityRow[],
  sections: ScheduleWbsSectionRow[],
  wbsDivisionOrder: string[] = [],
): WbsDivisionRow[] {
  const rows = new Map<string, WbsDivisionRow>();
  for (const section of buildWbsSectionDescriptors(sections)) {
    rows.set(section.path, {
      id: section.isDerived ? null : section.id,
      division: section.path,
      title: section.title,
      parentId: section.parentId,
      parentPath: section.parentPath,
      level: section.level,
      activityCount: 0,
      directActivityCount: 0,
      firstStart: null,
      lastFinish: null,
      childCount: 0,
      isPlaceholder: true,
      isPersisted: !section.isDerived,
    });
  }
  for (const activity of activities) {
    const division = normalizeWbsDivisionName(activity.division);
    const parts = splitWbsPath(division);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parentPath = joinWbsPath(parts.slice(0, depth));
      if (!rows.has(parentPath)) {
        rows.set(parentPath, {
          id: null,
          division: parentPath,
          title: parts[depth - 1] ?? parentPath,
          parentId: null,
          parentPath: depth > 1 ? joinWbsPath(parts.slice(0, depth - 1)) : null,
          level: depth - 1,
          activityCount: 0,
          directActivityCount: 0,
          firstStart: null,
          lastFinish: null,
          childCount: 0,
          isPlaceholder: true,
          isPersisted: false,
        });
      }
    }
    const existing =
      rows.get(division) ??
      ({
        id: null,
        division,
        title: parts[parts.length - 1] ?? division,
        parentId: null,
        parentPath: parts.length > 1 ? joinWbsPath(parts.slice(0, -1)) : null,
        level: Math.max(0, parts.length - 1),
        activityCount: 0,
        directActivityCount: 0,
        firstStart: null,
        lastFinish: null,
        childCount: 0,
        isPlaceholder: false,
        isPersisted: false,
      } satisfies WbsDivisionRow);
    rows.set(division, {
      ...existing,
      activityCount: existing.activityCount + 1,
      directActivityCount: existing.directActivityCount + 1,
      firstStart: earlierDate(existing.firstStart, activity.start_date),
      lastFinish: laterDate(existing.lastFinish, activity.finish_date),
      isPlaceholder: existing.isPersisted ? false : existing.activityCount + 1 === 0,
    });
  }
  const rowList = Array.from(rows.values());
  const childCounts = new Map<string, number>();
  for (const row of rowList) {
    if (!row.parentPath) continue;
    childCounts.set(row.parentPath, (childCounts.get(row.parentPath) ?? 0) + 1);
  }
  const rollups = new Map<
    string,
    { activityCount: number; firstStart: string | null; lastFinish: string | null }
  >();
  for (const row of rowList) {
    if (row.directActivityCount === 0) continue;
    const parts = splitWbsPath(row.division);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const path = joinWbsPath(parts.slice(0, depth));
      const current = rollups.get(path) ?? {
        activityCount: 0,
        firstStart: null,
        lastFinish: null,
      };
      rollups.set(path, {
        activityCount: current.activityCount + row.directActivityCount,
        firstStart: earlierDate(current.firstStart, row.firstStart),
        lastFinish: laterDate(current.lastFinish, row.lastFinish),
      });
    }
  }
  return rowList
    .map((row) => {
      const rollup = rollups.get(row.division);
      return {
        ...row,
        activityCount: rollup?.activityCount ?? row.activityCount,
        firstStart: rollup?.firstStart ?? row.firstStart,
        lastFinish: rollup?.lastFinish ?? row.lastFinish,
        childCount: childCounts.get(row.division) ?? 0,
      };
    })
    .sort((a, b) => compareWbsDivision(a.division, b.division, wbsDivisionOrder));
}

export function buildWbsSectionDescriptors(
  sections: ScheduleWbsSectionRow[],
): WbsSectionDescriptor[] {
  const normalizedSections = sections.map((section) => ({
    ...section,
    name: cleanWbsDivisionInput(section.name) || "General",
  }));
  const byParent = new Map<string, ScheduleWbsSectionRow[]>();
  const byId = new Map(normalizedSections.map((section) => [section.id, section]));
  for (const section of normalizedSections) {
    const parentKey = section.parent_id && byId.has(section.parent_id) ? section.parent_id : "root";
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), section]);
  }
  const sortSiblings = (rows: ScheduleWbsSectionRow[]) =>
    [...rows].sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        naturalWbsCompare(normalizeWbsDivisionName(a.name), normalizeWbsDivisionName(b.name)),
    );
  const descriptors: WbsSectionDescriptor[] = [];
  const visit = (
    section: ScheduleWbsSectionRow,
    parentPath: string | null,
    level: number,
    trail = new Set<string>(),
  ) => {
    if (trail.has(section.id)) return;
    const title = cleanWbsDivisionInput(section.name) || "General";
    const path = parentPath ? joinWbsPath([...splitWbsPath(parentPath), title]) : title;
    descriptors.push({
      id: section.id,
      title,
      path,
      parentId: section.parent_id,
      parentPath,
      level,
      sortOrder: section.sort_order,
      isDerived: section.id.startsWith("derived-"),
    });
    const nextTrail = new Set(trail);
    nextTrail.add(section.id);
    for (const child of sortSiblings(byParent.get(section.id) ?? [])) {
      visit(child, path, level + 1, nextTrail);
    }
  };
  for (const root of sortSiblings(byParent.get("root") ?? [])) visit(root, null, 0);
  return descriptors;
}

export function formatIndentedWbsLabel(row: WbsDivisionRow) {
  const indent = row.level > 0 ? `${"· ".repeat(Math.min(row.level, 4))}` : "";
  return `${indent}${row.division}`;
}

function getWbsOrderIndex(division: string, order: string[]) {
  const index = order.findIndex((item) => item === division);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getWbsDivisionSortKey(value?: string | null) {
  const label = normalizeWbsDivisionName(value);
  const numericPrefix = splitWbsPath(label)[0]?.match(/^(\d+)/)?.[1];
  if (numericPrefix) return { rank: Number(numericPrefix), label };
  if (/milestones?/i.test(label)) return { rank: 900, label };
  return { rank: 500, label };
}

function earlierDate(current: string | null, next?: string | null) {
  if (!next) return current;
  if (!current) return next;
  return next < current ? next : current;
}

function laterDate(current: string | null, next?: string | null) {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
}

function naturalWbsCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
