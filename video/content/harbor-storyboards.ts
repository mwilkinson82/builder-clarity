export interface HarborStoryboardBeat {
  durationSeconds: number;
  eyebrow: string;
  headline: string;
  body: string;
  narration: string;
  flow?: readonly string[];
}

export interface HarborVideoStoryboard {
  compositionId: string;
  lessonNumber: number;
  slug: string;
  title: string;
  role: string;
  beats: readonly HarborStoryboardBeat[];
}

export const getStoryboardDurationSeconds = (storyboard: HarborVideoStoryboard) =>
  storyboard.beats.reduce((total, beat) => total + beat.durationSeconds, 0);

export const getStoryboardNarration = (storyboard: HarborVideoStoryboard) =>
  storyboard.beats.map((beat) => beat.narration).join(" ");

export const HARBOR_VIDEO_STORYBOARDS: readonly HarborVideoStoryboard[] = [
  {
    compositionId: "Harbor-01-Operating-Loop",
    lessonNumber: 1,
    slug: "lesson-01-overwatch-operating-loop",
    title: "The OverWatch operating loop",
    role: "Everyone",
    beats: [
      {
        durationSeconds: 9,
        eyebrow: "The contractor problem",
        headline: "Most job problems are visible before they become losses.",
        body: "The information exists. It is usually scattered across people, texts, reports, and spreadsheets.",
        narration:
          "Most construction losses do not appear out of nowhere. The warning signs were already on the project, but the information was scattered or reached the decision-maker too late.",
      },
      {
        durationSeconds: 12,
        eyebrow: "01 · Superintendent",
        headline: "Start with field truth.",
        body: "Crews, hours, installed quantities, delays, photos, and evidence—not guesses.",
        narration:
          "OverWatch starts with field truth. The superintendent records the crew, hours, installed quantities, delays, and evidence once in the Daily Project Log.",
        flow: ["Crews", "Hours", "Quantities", "Evidence"],
      },
      {
        durationSeconds: 13,
        eyebrow: "02 · Project manager",
        headline: "Turn facts into management control.",
        body: "Daily WIP compares the plan with what the field actually produced.",
        narration:
          "The project manager reviews those facts in Daily WIP. That is where field activity becomes production pace, cost, earned value, progress, and a defensible management position.",
        flow: ["Daily report", "Daily WIP", "PM review"],
      },
      {
        durationSeconds: 13,
        eyebrow: "03 · PM + accounting",
        headline: "Carry one reviewed position through the job.",
        body: "Schedule, risk, forecast, billing, and recovery stay connected without double-counting.",
        narration:
          "The reviewed position can then support schedule progress, commercial risk, forecast, and billing. The PM controls the job position while accounting controls the final billing instrument.",
        flow: ["CPM", "Risk", "Forecast", "Billing"],
      },
      {
        durationSeconds: 13,
        eyebrow: "04 · Leadership",
        headline: "See the outcome while there is still time to act.",
        body: "That is IOR: field truth connected to financial recovery before the loss is final.",
        narration:
          "Leadership sees the financial outcome early enough to act. That is the OverWatch operating loop: field truth, management control, commercial decision, and financial outcome in one record.",
        flow: ["Field truth", "PM control", "Commercial decision", "Financial outcome"],
      },
    ],
  },
  {
    compositionId: "Harbor-02-Budget-SOV",
    lessonNumber: 2,
    slug: "lesson-02-budget-sov",
    title: "Cost budget versus owner billing value",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 10,
        eyebrow: "Two different numbers",
        headline: "Cost is not contract value.",
        body: "The budget says what the work should cost. The SOV says what the owner pays.",
        narration:
          "A contractor has to control two different money maps. The cost budget is what the work should cost you. The schedule of values is what the owner pays you.",
      },
      {
        durationSeconds: 12,
        eyebrow: "The margin lives between them",
        headline: "Keep markup visible by cost code.",
        body: "A one-hundred-twenty-thousand-dollar cost with thirty-percent markup bills at one-hundred-fifty-six thousand.",
        narration:
          "If a scope costs one hundred twenty thousand dollars and carries thirty percent markup, the owner-facing value is one hundred fifty-six thousand. The thirty-six thousand between them is planned gross profit.",
        flow: ["$120k cost", "+ 30% markup", "$156k SOV"],
      },
      {
        durationSeconds: 13,
        eyebrow: "Harbor Residence",
        headline: "Give every dollar a cost-code home.",
        body: "Commitments, actuals, open cost, forecast, and billing all inherit the same financial spine.",
        narration:
          "In Harbor Residence, each buyout and owner billing line connects to a cost code. That shared code is what lets OverWatch compare commitments, actuals, remaining forecast, and earned billing without mixing them together.",
      },
      {
        durationSeconds: 13,
        eyebrow: "The control",
        headline: "Read Actual, Open, and Forecast separately.",
        body: "Actual is recognized cost. Open is expected cost not yet recognized. Forecast is the complete expected position.",
        narration:
          "Actual cost is what has been recognized. Open is the cost still expected but not yet recognized. Forecast combines the job position so the PM can see where the code is expected to finish.",
        flow: ["Actual", "Open", "Forecast"],
      },
      {
        durationSeconds: 12,
        eyebrow: "The takeaway",
        headline: "Do not hide margin inside one number.",
        body: "Cost budget and SOV work together, but they answer different questions.",
        narration:
          "Keep cost and contract value connected but separate. When the money map is clean, every downstream decision—from buyout to billing—has a reliable starting point.",
      },
    ],
  },
  {
    compositionId: "Harbor-03-Subcontract-Buyout",
    lessonNumber: 3,
    slug: "lesson-03-subcontract-buyout",
    title: "A buyout is more than a contract total",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "The buyout",
        headline: "A subcontract creates committed cost.",
        body: "The signed amount belongs on the cost code before the first invoice arrives.",
        narration:
          "When you buy out a subcontractor, you have created committed cost. OverWatch carries that commitment to the job budget before cash is paid, so the PM can see the real obligation.",
      },
      {
        durationSeconds: 14,
        eyebrow: "Plan the output",
        headline: "Attach quantity and unit to the buyout.",
        body: "Planned linear feet, square feet, units, or another measurable scope turns price into production intelligence.",
        narration:
          "The buyout becomes more useful when it also carries a planned quantity and unit. Linear feet, square feet, fixtures, or another measurable scope lets the team calculate the subcontract cost per unit.",
        flow: ["Buyout", "Planned quantity", "Cost per unit"],
      },
      {
        durationSeconds: 15,
        eyebrow: "Set the benchmark",
        headline: "Back into the pace the number requires.",
        body: "Use the GC labor-equivalent benchmark even when the subcontractor's internal blended rate is unknown.",
        narration:
          "You may not know the subcontractor's actual blended hourly rate. You can still use your own labor-equivalent benchmark to translate the buyout into required labor-hours and the production pace needed to earn the number.",
      },
      {
        durationSeconds: 14,
        eyebrow: "Control the lifecycle",
        headline: "Track change, payment, retainage, and exposure.",
        body: "The base contract stays intact while approved changes and paid applications move through the job.",
        narration:
          "OverWatch then keeps the base contract, change orders, pay applications, retainage, and risk attribution connected without rewriting the original buyout.",
        flow: ["Contract", "Change", "Pay app", "Retainage"],
      },
      {
        durationSeconds: 11,
        eyebrow: "The takeaway",
        headline: "Buy out the work and the production plan together.",
        body: "The next project gets a proven unit history instead of another guess.",
        narration:
          "A good buyout controls today's commitment and teaches tomorrow's estimate. That is how the company builds a real production database from completed work.",
      },
    ],
  },
  {
    compositionId: "Harbor-04-Daily-Reports",
    lessonNumber: 4,
    slug: "lesson-04-daily-reports",
    title: "Capture field truth once",
    role: "Superintendent",
    beats: [
      {
        durationSeconds: 10,
        eyebrow: "The source record",
        headline: "The Daily Project Log starts the chain.",
        body: "If the field record is weak, every report above it becomes an opinion.",
        narration:
          "Production control begins in the Daily Project Log. If the field record is weak, every report and forecast above it becomes an opinion.",
      },
      {
        durationSeconds: 13,
        eyebrow: "Record the crew",
        headline: "Crew count needs crew size.",
        body: "One crew can mean two people today and four tomorrow. Record both so labor-hours stay real.",
        narration:
          "The superintendent records crew count, people per crew, and hours per person. One crew is only useful when the system also knows how many people were actually in it that day.",
        flow: ["Crews", "People per crew", "Hours", "Labor-hours"],
      },
      {
        durationSeconds: 13,
        eyebrow: "Record installed work",
        headline: "Use a measurable production unit.",
        body: "Square feet, linear feet, fixtures, boxes, or another unit that matches the scope.",
        narration:
          "Then record the installed quantity using the unit that matches the work. That could be square feet, linear feet, fixtures, junction boxes, or another measurable production unit.",
      },
      {
        durationSeconds: 12,
        eyebrow: "Record the story",
        headline: "Delays and evidence explain the number.",
        body: "Narrative, photos, weather, and constraints preserve what happened while it is still fresh.",
        narration:
          "Narrative, photos, weather, delays, and constraints explain why the number moved. The record is strongest when it is captured by the field while the facts are still fresh.",
      },
      {
        durationSeconds: 12,
        eyebrow: "The handoff",
        headline: "The same work line flows into Daily WIP.",
        body: "Enter the truth once. Review and reuse it everywhere else.",
        narration:
          "That same work line flows into Daily WIP for PM review. The superintendent records the truth once, and OverWatch reuses it without duplicate entry.",
        flow: ["Daily log", "Daily WIP", "Management controls"],
      },
    ],
  },
  {
    compositionId: "Harbor-05-Daily-WIP",
    lessonNumber: 5,
    slug: "lesson-05-daily-wip",
    title: "Turn the daily record into management control",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "The PM review",
        headline: "Daily WIP is not another field report.",
        body: "It is where the PM decides what the field facts mean to cost, progress, and profit.",
        narration:
          "Daily WIP is not another field report. It is the project manager's control point for deciding what the field facts mean financially and operationally.",
      },
      {
        durationSeconds: 15,
        eyebrow: "Price the work",
        headline: "Convert labor, material, and equipment into work in place.",
        body: "Crew count times crew size times hours times blended rate establishes labor cost.",
        narration:
          "OverWatch derives labor cost from crews, people per crew, hours, and the management blended rate. Materials and equipment complete the cost of the work installed that day.",
        flow: ["Labor", "Materials", "Equipment", "WIP cost"],
      },
      {
        durationSeconds: 15,
        eyebrow: "Measure production",
        headline: "Installed quantity divided by labor-hours equals actual rate.",
        body: "Compare the actual production rate with the target selected for that scope.",
        narration:
          "Installed quantity divided by total labor-hours produces the actual production rate. The PM selects the meaningful production measure and compares actual pace with the target.",
        flow: ["Installed units", "÷ labor-hours", "Actual rate", "vs target"],
      },
      {
        durationSeconds: 15,
        eyebrow: "Review progress",
        headline: "Use evidence before progress moves upstream.",
        body: "The PM confirms the supported position before it reaches CPM or billing.",
        narration:
          "The PM also reviews cumulative percent complete and supporting evidence. Only the reviewed position should become a recommendation for schedule progress or billing.",
      },
      {
        durationSeconds: 9,
        eyebrow: "The takeaway",
        headline: "Field facts become a defensible PM position.",
        body: "One review connects cost, production, schedule, billing, and forecast.",
        narration:
          "Daily WIP turns the daily record into a defensible management position that the rest of the project can trust.",
      },
    ],
  },
  {
    compositionId: "Harbor-06-CPM-Progress",
    lessonNumber: 6,
    slug: "lesson-06-cpm-progress",
    title: "Use field evidence without surrendering PM judgment",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "The recommendation",
        headline: "Daily WIP can inform CPM progress.",
        body: "Reviewed work in place creates evidence. It does not automatically rewrite the schedule.",
        narration:
          "Reviewed Daily WIP can recommend progress for a related CPM activity. It provides evidence, but it does not automatically rewrite the schedule.",
      },
      {
        durationSeconds: 14,
        eyebrow: "PM control",
        headline: "Apply the recommendation when it fits.",
        body: "The supported WIP position can update the CPM activity with one deliberate action.",
        narration:
          "When the field evidence and schedule activity match, the project manager can apply the recommended percent complete directly to CPM.",
      },
      {
        durationSeconds: 14,
        eyebrow: "Keep CPM",
        headline: "Leave the schedule unchanged when that is correct.",
        body: "Declining the recommendation should be quick and should not require a written explanation.",
        narration:
          "If the recommendation should not affect CPM, the PM can keep the schedule unchanged. That choice is deliberate, but it does not require unnecessary explanation or administrative friction.",
      },
      {
        durationSeconds: 14,
        eyebrow: "Supported override",
        headline: "Use another value when the project record supports it.",
        body: "PM judgment remains available because production evidence and CPM logic are related, not identical.",
        narration:
          "The PM can also enter another supported value. Production evidence and schedule logic are related, but they are not always identical, so professional judgment remains in control.",
        flow: ["Apply WIP", "Keep CPM", "Use another value"],
      },
      {
        durationSeconds: 12,
        eyebrow: "The takeaway",
        headline: "Connected does not mean automatic.",
        body: "OverWatch brings the evidence to the decision without taking the decision away from the PM.",
        narration:
          "OverWatch connects field evidence to the schedule while preserving the PM's authority. Connected does not mean automatic.",
      },
    ],
  },
  {
    compositionId: "Harbor-07-Production-Control",
    lessonNumber: 7,
    slug: "lesson-07-production-control",
    title: "Know whether the crew is earning the plan",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "The question",
        headline: "How much output did each labor-hour buy?",
        body: "Production rate is installed units divided by total labor-hours.",
        narration:
          "Production control answers a simple question: how much installed output did each labor-hour buy? The actual rate is installed units divided by total labor-hours.",
        flow: ["Installed units", "÷ labor-hours", "Actual production rate"],
      },
      {
        durationSeconds: 14,
        eyebrow: "The target",
        headline: "Compare actual pace with the benchmark.",
        body: "Targets can be square feet, linear feet, fixtures, or any production unit per labor-hour.",
        narration:
          "The target uses the production measure selected for the scope. It may be square feet per labor-hour, linear feet per labor-hour, fixtures per labor-hour, or another meaningful unit.",
      },
      {
        durationSeconds: 14,
        eyebrow: "The trend",
        headline: "One day is a fact. A trend is a control.",
        body: "Day, week, and month views show whether the crew is improving, drifting, or recovering.",
        narration:
          "One day can be noisy. Day, week, and month trends show whether the subcontractor or self-perform crew is improving, drifting, or recovering against the plan.",
        flow: ["Day", "Week", "Month", "Trend"],
      },
      {
        durationSeconds: 15,
        eyebrow: "The commercial insight",
        headline: "Test whether the buyout can earn itself.",
        body: "Cost per unit, required pace, actual pace, and variance reveal a weak number before closeout.",
        narration:
          "When production is connected to the buyout, OverWatch can compare buyout cost per unit, required pace, actual pace, and variance. A weak number becomes visible before the job is over.",
      },
      {
        durationSeconds: 11,
        eyebrow: "The payoff",
        headline: "Carry proven units into the next estimate.",
        body: "Every project makes the next buyout and labor plan tighter.",
        narration:
          "The company keeps the actual production history. Every completed scope makes the next estimate, buyout, and labor plan more accurate.",
      },
    ],
  },
  {
    compositionId: "Harbor-08-Billing-Handoff",
    lessonNumber: 8,
    slug: "lesson-08-billing-handoff",
    title: "Bridge PM judgment and accounting control",
    role: "PM + accounting",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "Two jobs in one workspace",
        headline: "The PM knows the job. Accounting knows the instrument.",
        body: "Billing works when both roles can contribute without blurring responsibility.",
        narration:
          "The project manager knows what work is earned and ready to bill. Accounting knows the required invoice, AIA format, compliance, and submission process. Billing needs both roles.",
      },
      {
        durationSeconds: 14,
        eyebrow: "PM recommendation",
        headline: "Start with certified project truth.",
        body: "Reviewed Daily WIP can recommend the owner-facing percent complete by SOV line.",
        narration:
          "The PM can certify a Daily WIP position and send a recommendation into the draft billing workspace. That gives accounting a reviewed project starting point instead of a disconnected email.",
        flow: ["Daily WIP", "PM certified", "Draft billing"],
      },
      {
        durationSeconds: 14,
        eyebrow: "Accounting control",
        headline: "Review before applying the recommendation.",
        body: "Accounting can accept the supported value or keep the current billing position.",
        narration:
          "Accounting reviews the recommendation against the SOV and billing requirements. It can apply the supported value or keep the current billing position without losing control of the document.",
      },
      {
        durationSeconds: 15,
        eyebrow: "Clean separation",
        headline: "Recommendation is not submission.",
        body: "The handoff never auto-submits an invoice or removes normal accounting review.",
        narration:
          "A PM recommendation does not submit an invoice. OverWatch preserves draft, review, approval, and submission states so the accounting workflow remains familiar and controlled.",
        flow: ["Recommend", "Review", "Package", "Submit"],
      },
      {
        durationSeconds: 11,
        eyebrow: "The takeaway",
        headline: "One operating record. Two clear responsibilities.",
        body: "The PM supplies project truth and accounting produces clean billing.",
        narration:
          "The result is a clean bridge: the PM supplies project truth, accounting produces the billing instrument, and both work from the same operating record.",
      },
    ],
  },
  {
    compositionId: "Harbor-09-IOR-Risk",
    lessonNumber: 9,
    slug: "lesson-09-ior-risk",
    title: "Run the IOR before the loss is final",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "The IOR principle",
        headline: "A problem is not controlled until it has a position.",
        body: "Define the dollars, responsibility, next action, and recovery path.",
        narration:
          "A project problem is not controlled just because the team knows about it. It needs a financial position, an owner, a next action, and a recovery path.",
      },
      {
        durationSeconds: 14,
        eyebrow: "Separate the exposure",
        headline: "Do not mix actual incurred and committed cost.",
        body: "Cash already at stake, subcontract commitment, and remaining forecast answer different questions.",
        narration:
          "OverWatch separates actual cost already incurred, subcontract commitments linked to the issue, and the remaining exposure still expected. Each number answers a different management question.",
        flow: ["Actual incurred", "Sub committed", "Remaining exposure"],
      },
      {
        durationSeconds: 14,
        eyebrow: "Choose the path",
        headline: "Recover, mitigate, transfer, or accept.",
        body: "The project team states what it intends to do instead of carrying an undefined risk.",
        narration:
          "The PM chooses a recovery position. The plan may be to recover from the owner, mitigate the cost, transfer responsibility, use contingency, or accept a supported outcome.",
      },
      {
        durationSeconds: 15,
        eyebrow: "Make it actionable",
        headline: "Every live item needs an owner and next move.",
        body: "Due dates, evidence, release conditions, and decision history keep the issue moving.",
        narration:
          "Every live exposure needs an owner, a due date, supporting evidence, and the next decision required. That converts risk from a conversation into a managed recovery action.",
        flow: ["Owner", "Due date", "Evidence", "Next action"],
      },
      {
        durationSeconds: 11,
        eyebrow: "The outcome",
        headline: "Leadership sees forecast GP after risk.",
        body: "The company can act before the loss is buried in final cost.",
        narration:
          "Leadership sees forecast gross profit after the current risk position, while there is still time to protect the job instead of explaining the loss later.",
      },
    ],
  },
  {
    compositionId: "Harbor-10-Inspections",
    lessonNumber: 10,
    slug: "lesson-10-inspections",
    title: "Close the quality loop",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "Quality is a project control",
        headline: "A failed inspection affects more than a checklist.",
        body: "Correction can change cost, schedule, responsibility, and owner confidence.",
        narration:
          "A failed inspection is more than a checklist item. Correction can affect cost, schedule, subcontractor responsibility, and the owner's confidence in the work.",
      },
      {
        durationSeconds: 13,
        eyebrow: "Document the finding",
        headline: "Record what failed and where.",
        body: "The inspection record preserves the requirement, location, evidence, and responsible party.",
        narration:
          "The inspection record identifies what failed, where it occurred, the requirement involved, the supporting evidence, and the party responsible for correction.",
      },
      {
        durationSeconds: 13,
        eyebrow: "Plan the correction",
        headline: "Assign the work and reinspection date.",
        body: "The item remains open until the correction is complete and verified.",
        narration:
          "The PM assigns the correction and the reinspection date. The item stays visible until the work is complete and the result is verified.",
        flow: ["Finding", "Correction", "Reinspection", "Close"],
      },
      {
        durationSeconds: 12,
        eyebrow: "Connect the exposure",
        headline: "Create or link risk when money or time is exposed.",
        body: "Quality and financial controls stay connected instead of living in separate logs.",
        narration:
          "When the failure exposes cost or schedule, connect it to the Risk Tally. That keeps the quality issue and its financial consequence in the same operating record.",
      },
      {
        durationSeconds: 11,
        eyebrow: "The takeaway",
        headline: "Close the work and the exposure.",
        body: "Nothing disappears because an email was sent or a punch item was mentioned.",
        narration:
          "The quality loop is complete only when the work is corrected, reinspected, and any related exposure is resolved.",
      },
    ],
  },
  {
    compositionId: "Harbor-11-Claims",
    lessonNumber: 11,
    slug: "lesson-11-claims",
    title: "Build the claim while the work continues",
    role: "Project manager",
    beats: [
      {
        durationSeconds: 11,
        eyebrow: "The claim problem",
        headline: "A valid claim can fail because the record is weak.",
        body: "Notice, cause, cost, schedule effect, and evidence often live in different places.",
        narration:
          "A claim may be valid and still fail because the supporting record is scattered. Notice, cause, cost, schedule effect, and evidence have to tell one coherent story.",
      },
      {
        durationSeconds: 13,
        eyebrow: "Start the timeline",
        headline: "Record the event when it happens.",
        body: "Preserve notice dates, direction, responsibility, and contemporaneous evidence.",
        narration:
          "OverWatch builds the claim timeline as events occur. The team preserves notice dates, direction received, responsibility, and contemporaneous evidence instead of reconstructing them months later.",
      },
      {
        durationSeconds: 13,
        eyebrow: "Quantify the effect",
        headline: "Connect cost and schedule impact.",
        body: "Actual incurred cost, commitments, forecast exposure, and CPM effect support the position.",
        narration:
          "The claim connects actual cost, commitments, remaining exposure, and schedule effect. The commercial position stays grounded in the same records used to manage the job.",
        flow: ["Cost", "Commitment", "Exposure", "Schedule"],
      },
      {
        durationSeconds: 12,
        eyebrow: "Trace the position",
        headline: "Link risk, change order, and claim.",
        body: "The team can see how a project issue developed into a formal recovery record.",
        narration:
          "Risk Tally, change-order position, and claim history remain linked. That shows how the issue developed and prevents competing versions of the same event.",
      },
      {
        durationSeconds: 11,
        eyebrow: "The takeaway",
        headline: "Build the record before you need to defend it.",
        body: "Recovery is stronger when the story was preserved during the work.",
        narration:
          "The strongest claim is built while the work continues. OverWatch preserves the story before the team has to defend it.",
      },
    ],
  },
];
