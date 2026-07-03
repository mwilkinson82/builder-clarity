import type { ProjectRow } from "@/lib/projects.functions";
import type { ScheduleDelayFragmentRow } from "@/lib/schedule.functions";
import type { ConstructLineCpmModel } from "@/lib/constructline-cpm";
import {
  PRINT_COMPACT_HEADER_HEIGHT_PX,
  PRINT_FOOTER_HEIGHT_PX,
  PRINT_FULL_HEADER_HEIGHT_PX,
  PRINT_MATRIX_CHROME_HEIGHT_PX,
  PRINT_MIN_TASK_ROWS_PER_PAGE,
  PRINT_PAGE_CONTENT_HEIGHT_PX,
  PRINT_PAGE_SAFETY_MARGIN_PX,
  paginateSchedulePrint,
  type SchedulePrintGroup,
} from "@/lib/schedule-print-pagination";
import { splitWbsPath, joinWbsPath } from "@/lib/constructline-wbs";
import { CONSTRUCTLINE_FIT_DAY_PX, type DelayFragmentSummary, shortDate } from "./scheduleShared";
import { groupDelayFragmentsByActivity } from "./scheduleUpdateDraft";
import { getActivityMatrixTaskRowHeight } from "./scheduleGridModel";
import { ActivityScheduleMatrix } from "./ScheduleGridMatrix";

const PRINT_ACTIVITY_COLUMN_WIDTH = 130; // matches ActivityScheduleMatrix print mode
const PRINT_GROUP_HEADING_HEIGHT = 12; // matches matrix print groupHeight

// The one place page chunks are computed — the component renders these, and
// the print smoke asserts PDF page counts against the same function.
export function computeCpmPrintChunks(
  model: ConstructLineCpmModel,
  delayFragments: ScheduleDelayFragmentRow[],
) {
  const delayFragmentsByActivity = groupDelayFragmentsByActivity(delayFragments);
  const printGroups: SchedulePrintGroup[] = model.groups.map((group) => {
    const parts = splitWbsPath(group.division);
    return {
      division: group.division,
      parentPaths: parts.slice(0, -1).map((_, index) => joinWbsPath(parts.slice(0, index + 1))),
      headingHeight: PRINT_GROUP_HEADING_HEIGHT,
      tasks: group.tasks.map((task) => ({
        key: task.activityKey,
        height: getActivityMatrixTaskRowHeight(
          task,
          true,
          delayFragmentsByActivity,
          PRINT_ACTIVITY_COLUMN_WIDTH,
        ),
      })),
    };
  });
  return paginateSchedulePrint({
    groups: printGroups,
    firstPageBudget:
      PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_FULL_HEADER_HEIGHT_PX - PRINT_PAGE_SAFETY_MARGIN_PX,
    continuationPageBudget:
      PRINT_PAGE_CONTENT_HEIGHT_PX - PRINT_COMPACT_HEADER_HEIGHT_PX - PRINT_PAGE_SAFETY_MARGIN_PX,
    footerHeight: PRINT_FOOTER_HEIGHT_PX,
    chunkOverheadHeight: PRINT_MATRIX_CHROME_HEIGHT_PX,
    minTaskRowsPerPage: PRINT_MIN_TASK_ROWS_PER_PAGE,
  });
}

// The printable CPM report: one sheet when the schedule fits, explicit page
// blocks when it does not. Every page repeats the table column-header row
// (each page renders its own matrix); continuation pages carry a compact
// header strip; the footer sits directly under the last content.
export function CpmPrintSheet({
  project,
  model,
  delayFragments,
  delaySummary,
  effectiveDataDate,
  activityOrder,
  scheduleViewSummary,
  printReportLabel,
  criticalBasisLabel,
  isCriticalPathReport,
  isRecoveryReport,
  contractorName,
  printedLogicTieCount,
}: {
  project: ProjectRow;
  model: ConstructLineCpmModel;
  delayFragments: ScheduleDelayFragmentRow[];
  delaySummary: DelayFragmentSummary;
  effectiveDataDate: string | null;
  activityOrder: "start" | "wbs";
  scheduleViewSummary: string;
  printReportLabel: string;
  criticalBasisLabel: string;
  isCriticalPathReport: boolean;
  isRecoveryReport: boolean;
  contractorName: string;
  printedLogicTieCount: number;
}) {
  const chunks = computeCpmPrintChunks(model, delayFragments);
  const taskByKey = new Map(model.tasks.map((task) => [task.activityKey, task]));
  const pageModels: ConstructLineCpmModel[] = chunks.map((chunk) => {
    const groups = chunk.groups.map((group) => ({
      division: group.division,
      tasks: group.taskKeys
        .map((key) => taskByKey.get(key))
        .filter((task): task is NonNullable<typeof task> => Boolean(task)),
    }));
    return { ...model, tasks: groups.flatMap((group) => group.tasks), groups };
  });

  return (
    <section className="constructline-cpm-print-shell" aria-label="Printable CPM schedule">
      {pageModels.map((pageModel, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageModels.length - 1;
        return (
          <div
            key={pageIndex}
            className={
              isLastPage
                ? "constructline-cpm-print-page"
                : "constructline-cpm-print-page constructline-cpm-print-page-break"
            }
          >
            {isFirstPage ? (
              <>
                <div className="constructline-cpm-print-titlebar">
                  <div>
                    {(project.organization_logo_url || project.organization_name) && (
                      <div className="constructline-print-brand">
                        {project.organization_logo_url && (
                          <img
                            src={project.organization_logo_url}
                            alt={`${project.organization_name} logo`}
                          />
                        )}
                        {project.organization_name && <span>{project.organization_name}</span>}
                      </div>
                    )}
                    <div className="constructline-cpm-print-kicker">
                      {contractorName} · ConstructLine CPM
                    </div>
                    <h1>
                      {project.name} · {printReportLabel}
                    </h1>
                    <div className="constructline-cpm-print-meta">
                      {project.job_number && <span>Job # {project.job_number}</span>}
                      {project.client && <span>{project.client}</span>}
                      {project.project_manager && <span>PM {project.project_manager}</span>}
                      <span>
                        Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}
                      </span>
                      <span>
                        {shortDate(model.timelineStartDate)} to{" "}
                        {shortDate(model.timelineFinishDate)}
                      </span>
                      <span>
                        {model.tasks.length} activities · {printedLogicTieCount} logic ties in view
                      </span>
                      {delaySummary.openCount > 0 && (
                        <span>
                          {delaySummary.openCount} open delay impact
                          {delaySummary.openCount === 1 ? "" : "s"} · {delaySummary.openDays} days
                        </span>
                      )}
                      <span>Optimized for 11 x 17 landscape</span>
                      <span>{activityOrder === "start" ? "Start-date order" : "WBS order"}</span>
                      <span>{scheduleViewSummary}</span>
                    </div>
                  </div>
                  <div
                    className={[
                      "constructline-cpm-print-status",
                      isCriticalPathReport ? "constructline-cpm-print-status-critical" : "",
                      isRecoveryReport ? "constructline-cpm-print-status-recovery" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span>
                      {isCriticalPathReport
                        ? "Critical path report"
                        : isRecoveryReport
                          ? "Recovery report"
                          : "Report type"}
                    </span>
                    <strong>{printReportLabel}</strong>
                    <em>
                      {criticalBasisLabel} · Finish {shortDate(model.cpmFinishDate)}
                    </em>
                  </div>
                </div>
              </>
            ) : (
              <div className="constructline-cpm-print-strip-compact">
                <span className="constructline-cpm-print-strip-compact-title">
                  {project.name} · {printReportLabel}
                </span>
                <span>
                  Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}
                </span>
                <span>
                  Continued · page {pageIndex + 1} of {pageModels.length}
                </span>
              </div>
            )}
            {/* The printed report always carries logic lines and baseline bars,
                regardless of the on-screen toggles — that context is the point. */}
            <ActivityScheduleMatrix
              model={pageModel}
              dayPx={CONSTRUCTLINE_FIT_DAY_PX}
              delayFragments={delayFragments}
              dataDate={effectiveDataDate}
              viewSummary={scheduleViewSummary}
              emptyTitle="No activities match this schedule view."
              emptyDescription="Switch back to All activities or choose a broader view."
              showLogicLines
              showBaselineBars
              isPrintMode
              onOpenActivity={() => undefined}
              onDeleteActivity={() => undefined}
            />
            {isLastPage && (
              <footer className="constructline-cpm-print-footer">
                <span className="constructline-cpm-print-footer-primary">
                  Company: {contractorName}
                </span>
                <span className="constructline-cpm-print-footer-report">
                  {printReportLabel} · {criticalBasisLabel} · Finish{" "}
                  {shortDate(model.cpmFinishDate)}
                </span>
                <span>Critical path finish {shortDate(model.cpmFinishDate)}</span>
                <span>Project finish {shortDate(model.cpmFinishDate)}</span>
                <span>
                  Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}
                </span>
                <span>
                  Legend: critical red · near critical gold · complete green · milestone diamond ·
                  hatched delay period
                </span>
              </footer>
            )}
          </div>
        );
      })}
    </section>
  );
}
