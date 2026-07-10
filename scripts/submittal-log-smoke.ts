// Submittal/RFI pipeline + transmittal-bundle smoke (field requests, DB3T
// 2026-07-10). Proves: (1) the pure pipeline math — days outstanding, overdue,
// dashboard counts; (2) the Letter of Transmittal really CARRIES its attached
// documents — PDF pages merged, images embedded, junk skipped without sinking
// the build. Run: node --experimental-strip-types scripts/submittal-log-smoke.ts
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  daysOutstanding,
  isOverdue,
  isReturned,
  pipelineCounts,
} from "../src/lib/submittal-domain.ts";
import { buildTransmittalPdf } from "../src/lib/transmittal-pdf.ts";
import type { SubmittalLogEntryRow } from "../src/lib/submittal-log.functions.ts";

const TODAY = "2026-07-10";
const track = (over: Partial<Parameters<typeof daysOutstanding>[0]>) => ({
  status: "",
  date_submitted: null,
  date_returned: null,
  due_date: null,
  ...over,
});

// ── Days outstanding: only ticks while the ball is with the reviewer ────────
assert.equal(daysOutstanding(track({ status: "pending" }), TODAY), null, "pending → not out");
assert.equal(
  daysOutstanding(track({ date_submitted: "2026-07-01", status: "ur" }), TODAY),
  9,
  "submitted 7/1, today 7/10 → 9 days out",
);
assert.equal(
  daysOutstanding(track({ date_submitted: "2026-07-01", date_returned: "2026-07-08" }), TODAY),
  null,
  "returned → no longer outstanding",
);
assert.equal(
  daysOutstanding(track({ date_submitted: "2026-07-01", status: "a" }), TODAY),
  null,
  "approved (even without a returned date) → reviewer acted",
);

// ── Overdue: due date blown and nothing back — pending items included ───────
assert.equal(
  isOverdue(track({ status: "pending", due_date: "2026-07-05" }), TODAY),
  true,
  "a planned item never sent can still blow its deadline",
);
assert.equal(
  isOverdue(track({ date_submitted: "2026-07-01", due_date: "2026-07-15" }), TODAY),
  false,
  "due in the future → not overdue",
);
assert.equal(
  isOverdue(track({ due_date: "2026-07-05", status: "aan" }), TODAY),
  false,
  "returned → overdue clears",
);
assert.equal(isReturned(track({ status: "rar" })), true, "RAR counts as reviewer-acted");

// ── Dashboard tiles ──────────────────────────────────────────────────────────
{
  const counts = pipelineCounts(
    [
      track({ status: "pending" }),
      track({ status: "pending", due_date: "2026-07-01" }), // planned AND overdue
      track({ date_submitted: "2026-06-30", status: "ur" }), // 10 days out
      track({ date_submitted: "2026-07-08", status: "ur", due_date: "2026-07-09" }), // out + overdue
      track({ date_submitted: "2026-06-01", date_returned: "2026-06-20", status: "a" }),
    ],
    TODAY,
  );
  assert.equal(counts.pending, 2, "two planned items");
  assert.equal(counts.outForReview, 2, "two out with the reviewer");
  assert.equal(counts.overdue, 2, "one pending + one out are past due");
  assert.equal(counts.returned, 1, "one back");
  assert.equal(counts.maxDaysOut, 10, "longest current wait");
}

// ── Transmittal bundles its attachments ─────────────────────────────────────
const entry = (over: Partial<SubmittalLogEntryRow>): SubmittalLogEntryRow => ({
  id: "e1",
  project_id: "p1",
  kind: "submittal",
  number: "4000-R",
  spec_section: "4000",
  sub_rev: "1",
  item: "Concrete Mix Design",
  description: "Concrete Mix Design",
  mfgr_supplier: "Titan America",
  date_submitted: "2026-07-08",
  date_returned: null,
  due_date: null,
  status: "ur",
  comments: "",
  storage_path: "",
  file_name: "",
  sort_order: 0,
  ...over,
});
const letterhead = {
  company_name: "QA Constructors",
  legal_name: "",
  logo_url: "",
  address_line1: "1 Main St",
  address_line2: "",
  city: "Islip",
  state: "NY",
  postal_code: "11751",
  office_phone: "",
  license_number: "",
};

// A real 2-page PDF attachment built in memory.
const attachmentDoc = await PDFDocument.create();
attachmentDoc.addPage([612, 792]);
attachmentDoc.addPage([612, 792]);
const attachmentBytes = await attachmentDoc.save();
// A real 1x1 PNG.
const pngBytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const base = {
  letterhead,
  projectName: "Harbor Residence",
  jobNumber: "2601",
  kind: "submittal" as const,
  entries: [entry({})],
  to: "Nassau County DPW",
  attn: "Reviewer",
  re: "Concrete",
  transmittalNumber: "001",
  senderName: "QA",
  generatedAt: new Date("2026-07-10T12:00:00Z"),
};

// Cover only.
{
  const result = await buildTransmittalPdf({ ...base });
  assert.equal(result.pageCount, 1, "no attachments → cover page only");
  assert.deepEqual(result.bundled, [], "nothing bundled");
}

// PDF merged page-for-page, image becomes a page, junk skipped — not fatal.
{
  const result = await buildTransmittalPdf({
    ...base,
    attachments: [
      {
        label: "4000-R · Concrete Mix Design",
        fileName: "mix-design.pdf",
        bytes: new Uint8Array(attachmentBytes),
        contentType: "application/pdf",
      },
      { label: "", fileName: "site-photo.png", bytes: pngBytes, contentType: "image/png" },
      { label: "", fileName: "corrupt.pdf", bytes: new Uint8Array([1, 2, 3, 4]), contentType: "" },
    ],
  });
  assert.equal(result.pageCount, 4, "cover + 2 merged PDF pages + 1 image page");
  assert.deepEqual(
    result.bundled,
    ["4000-R · Concrete Mix Design", "site-photo.png"],
    "both real docs ride (labelled by item where set)",
  );
  assert.deepEqual(result.skipped, ["corrupt.pdf"], "junk reported, build survives");
  // The output is a valid PDF.
  const parsed = await PDFDocument.load(result.bytes);
  assert.equal(parsed.getPageCount(), 4, "output parses back with all pages");
  assert.match(result.fileName, /^Transmittal-Harbor-Residence-001\.pdf$/, "filename shape");
}

console.log("submittal log smoke: all assertions passed");
