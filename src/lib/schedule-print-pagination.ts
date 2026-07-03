// 11x17 print pagination for the CPM schedule report. Pure module (no
// env-dependent imports) so node-based smoke tests can load it.
//
// The printed report flows onto ONE sheet whenever it fits. When content
// genuinely exceeds a page, the schedule is chunked into explicit page
// blocks: the table column-header row repeats on every page (each chunk
// renders its own matrix header), group headings repeat when a division
// continues onto the next page, no page carries fewer than a minimum number
// of activity rows (the break moves earlier instead), and the footer sits
// directly under the last content — never on a page of its own.

// Printable area at CSS 96dpi: 11in paper minus 0.22in margins top+bottom.
export const PRINT_PAGE_CONTENT_HEIGHT_PX = Math.floor((11 - 2 * 0.22) * 96); // 1013
// Shell chrome heights (see CpmPrintSheet + print CSS; verified end-to-end by
// the headless-Chromium print smoke). Deliberately conservative — slack per
// page beats stranding rows on an overflow sheet.
// Titlebar 0.75in + 0.05in padding + 0.05in margin, pinned with an explicit
// height in the print CSS. The old report strip is gone — it duplicated the
// titlebar meta and the footer legend line for a quarter inch of page.
export const PRINT_FULL_HEADER_HEIGHT_PX = 82;
// Compact continuation strip: 0.24in + 0.05in margin (pinned in CSS).
export const PRINT_COMPACT_HEADER_HEIGHT_PX = 29;
// Footer: 0.24in + 0.04in padding + 0.05in margin (pinned in CSS).
export const PRINT_FOOTER_HEIGHT_PX = 32;
// Column header row (30px) + matrix borders + rounding, measured via the
// print smoke; the legend and scale strips are hidden in print.
export const PRINT_MATRIX_CHROME_HEIGHT_PX = 38;
export const PRINT_MIN_TASK_ROWS_PER_PAGE = 4;
// Row heights and chrome heights are exact by construction (inline styles and
// CSS-pinned heights), so this only has to absorb sub-pixel print rounding.
export const PRINT_PAGE_SAFETY_MARGIN_PX = 12;

export type SchedulePrintTask = {
  key: string;
  height: number;
};

export type SchedulePrintGroup = {
  division: string;
  // Ancestor WBS paths whose rollup rows render before this group's heading
  // the first time each appears on a page.
  parentPaths: string[];
  headingHeight: number;
  tasks: SchedulePrintTask[];
};

export type SchedulePrintChunk = {
  groups: Array<{ division: string; taskKeys: string[] }>;
  taskCount: number;
  contentHeight: number;
};

export type SchedulePrintPaginationInput = {
  groups: SchedulePrintGroup[];
  firstPageBudget: number;
  continuationPageBudget: number;
  footerHeight: number;
  chunkOverheadHeight: number;
  minTaskRowsPerPage: number;
};

type FlatTask = {
  group: SchedulePrintGroup;
  key: string;
  height: number;
};

// Rendered height of the page chunk holding flat tasks [start, end):
// chunk overhead + each division heading once (plus not-yet-emitted parent
// rollup rows, first appearance per page) + the task rows themselves.
function rangeHeight(
  flatTasks: FlatTask[],
  start: number,
  end: number,
  chunkOverheadHeight: number,
) {
  let height = chunkOverheadHeight;
  const emittedParents = new Set<string>();
  let currentDivision: string | null = null;
  for (let index = start; index < end; index += 1) {
    const item = flatTasks[index];
    if (item.group.division !== currentDivision) {
      currentDivision = item.group.division;
      for (const parentPath of item.group.parentPaths) {
        if (emittedParents.has(parentPath)) continue;
        emittedParents.add(parentPath);
        height += item.group.headingHeight;
      }
      height += item.group.headingHeight;
    }
    height += item.height;
  }
  return height;
}

function rangeToChunk(
  flatTasks: FlatTask[],
  start: number,
  end: number,
  chunkOverheadHeight: number,
): SchedulePrintChunk {
  const groups: Array<{ division: string; taskKeys: string[] }> = [];
  for (let index = start; index < end; index += 1) {
    const item = flatTasks[index];
    const last = groups[groups.length - 1];
    if (last && last.division === item.group.division) {
      last.taskKeys.push(item.key);
    } else {
      groups.push({ division: item.group.division, taskKeys: [item.key] });
    }
  }
  return {
    groups,
    taskCount: end - start,
    contentHeight: rangeHeight(flatTasks, start, end, chunkOverheadHeight),
  };
}

// Greedy fill with exact height accounting, then two fix-up passes: the
// footer must fit under the last content (never on a page of its own), and
// no page may carry fewer task rows than the orphan minimum — the break
// moves earlier instead.
export function paginateSchedulePrint(input: SchedulePrintPaginationInput): SchedulePrintChunk[] {
  const {
    groups,
    firstPageBudget,
    continuationPageBudget,
    footerHeight,
    chunkOverheadHeight,
    minTaskRowsPerPage,
  } = input;

  const flatTasks: FlatTask[] = groups.flatMap((group) =>
    group.tasks.map((task) => ({ group, key: task.key, height: task.height })),
  );
  if (flatTasks.length === 0) {
    return [{ groups: [], taskCount: 0, contentHeight: chunkOverheadHeight }];
  }

  const budgetFor = (pageIndex: number) =>
    pageIndex === 0 ? firstPageBudget : continuationPageBudget;

  // Page boundaries: page i spans [boundaries[i], boundaries[i + 1]).
  const boundaries: number[] = [0];
  let cursor = 0;
  while (cursor < flatTasks.length) {
    const pageIndex = boundaries.length - 1;
    let end = cursor + 1; // a page always advances by at least one row
    while (
      end < flatTasks.length &&
      rangeHeight(flatTasks, cursor, end + 1, chunkOverheadHeight) <= budgetFor(pageIndex)
    ) {
      end += 1;
    }
    boundaries.push(end);
    cursor = end;
  }

  // Footer fix-up: move trailing rows to a fresh page while the footer does
  // not fit under the last content.
  {
    const lastStart = boundaries[boundaries.length - 2];
    let lastEnd = boundaries[boundaries.length - 1];
    const lastPageIndex = boundaries.length - 2;
    if (
      rangeHeight(flatTasks, lastStart, lastEnd, chunkOverheadHeight) + footerHeight >
      budgetFor(lastPageIndex)
    ) {
      let spillStart = lastEnd;
      while (
        spillStart > lastStart + 1 &&
        rangeHeight(flatTasks, lastStart, spillStart, chunkOverheadHeight) + footerHeight >
          budgetFor(lastPageIndex)
      ) {
        spillStart -= 1;
      }
      if (spillStart < lastEnd) {
        boundaries.splice(boundaries.length - 1, 0, spillStart);
      }
    }
  }

  // Orphan fix-up: the final page carries at least minTaskRowsPerPage rows,
  // pulled from the previous page while it can spare them.
  while (boundaries.length > 2) {
    const lastStart = boundaries[boundaries.length - 2];
    const lastEnd = boundaries[boundaries.length - 1];
    const previousStart = boundaries[boundaries.length - 3];
    const lastCount = lastEnd - lastStart;
    const previousCount = lastStart - previousStart;
    if (lastCount >= minTaskRowsPerPage) break;
    if (previousCount <= minTaskRowsPerPage) break;
    boundaries[boundaries.length - 2] = lastStart - 1;
  }

  const chunks: SchedulePrintChunk[] = [];
  for (let page = 0; page + 1 < boundaries.length; page += 1) {
    chunks.push(
      rangeToChunk(flatTasks, boundaries[page], boundaries[page + 1], chunkOverheadHeight),
    );
  }
  return chunks;
}
