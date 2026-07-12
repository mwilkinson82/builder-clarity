import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  projectName?: string;
  clientName?: string;
  jobNumber?: string;
  reviewedAt?: string;
  reviewer?: string;
  indicatedGp?: string;
  indicatedGpPct?: string;
  gpAtRisk?: string;
  forecastBefore?: string;
  forecastAfter?: string;
  narrative?: string;
  portalUrl?: string;
  note?: string;
  /** Signed download URL for the full IOR report PDF (Option A delivery). */
  pdfUrl?: string;
  /** File name shown next to the PDF download button. */
  pdfFilename?: string;
}

const IorReportNotificationEmail = ({
  projectName = "Project",
  clientName,
  jobNumber,
  reviewedAt = "Current review",
  reviewer = "PM",
  indicatedGp = "$0",
  indicatedGpPct = "0.0%",
  gpAtRisk = "$0",
  forecastBefore,
  forecastAfter,
  narrative,
  portalUrl,
  note,
  pdfUrl,
  pdfFilename,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`IOR report ready - ${projectName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>OVERWATCH IOR REPORT</Text>
        <Heading style={h1}>Saved IOR report ready</Heading>
        <Text style={intro}>
          A saved Indicated Outcome Review report has been shared from Overwatch.
        </Text>

        <Section style={card}>
          <Row label="Project" value={projectName} />
          {clientName ? <Row label="Client" value={clientName} /> : null}
          {jobNumber ? <Row label="Job number" value={jobNumber} /> : null}
          <Row label="Review date" value={reviewedAt} />
          <Row label="Reviewer" value={reviewer} />
          <Row label="Indicated GP" value={indicatedGp} strong />
          <Row label="Indicated GP %" value={indicatedGpPct} />
          <Row label="GP at risk" value={gpAtRisk} strong danger />
          {forecastBefore || forecastAfter ? (
            <Row
              label="Forecast completion"
              value={`${forecastBefore || "Not recorded"} -> ${forecastAfter || "Not recorded"}`}
            />
          ) : null}
        </Section>

        {note ? <Text style={noteBox}>{note}</Text> : null}

        {narrative ? (
          <Section style={narrativeBox}>
            <Text style={rowLabel}>Executive narrative</Text>
            <Text style={narrativeText}>{narrative}</Text>
          </Section>
        ) : null}

        {pdfUrl ? (
          <Section style={downloadRow}>
            <Text style={downloadLead}>The full IOR report PDF is included below.</Text>
            <Button href={pdfUrl} style={downloadButton}>
              Download the IOR report (PDF)
            </Button>
            {pdfFilename ? <Text style={downloadCaption}>{pdfFilename}</Text> : null}
          </Section>
        ) : null}

        {portalUrl ? (
          <Button href={portalUrl} style={button}>
            Open project in Overwatch
          </Button>
        ) : null}

        <Text style={footer}>
          This message was sent through Overwatch.{" "}
          {pdfUrl ? "The full IOR report PDF is included above as a secure download link. " : ""}
          Keep the report cycle and follow-up work inside the project record.
        </Text>
      </Container>
    </Body>
  </Html>
);

const Row = ({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) => (
  <Section style={row}>
    <Text style={rowLabel}>{label}</Text>
    <Text style={strong ? (danger ? rowValueDanger : rowValueStrong) : rowValue}>{value}</Text>
  </Section>
);

export const template = {
  component: IorReportNotificationEmail,
  subject: (data: Record<string, any>) => `IOR Report - ${data?.projectName ?? "Overwatch"}`.trim(),
  displayName: "IOR report notification",
  previewData: {
    projectName: "Harbor Residence",
    clientName: "Private Luxury Residence",
    jobNumber: "2601",
    reviewedAt: "Jun 25, 2026, 8:40 PM",
    reviewer: "PM",
    indicatedGp: "$218,250",
    indicatedGpPct: "6.2%",
    gpAtRisk: "$261,750",
    forecastBefore: "Jun 30, 2026",
    forecastAfter: "Aug 6, 2026",
    narrative:
      "Project remains on budget despite a schedule slip. Owner decision required this week to protect remaining margin.",
    portalUrl: "https://overwatch.alpcontractorcircle.com/projects/example",
    note: "Please review before the project meeting.",
    pdfUrl: "https://overwatch.alpcontractorcircle.com/download/ior-report-example.pdf",
    pdfFilename: "IOR_Harbor_Residence_2026-06-25.pdf",
  },
} satisfies TemplateEntry;

const main = {
  backgroundColor: "#f8f5ee",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Arial, sans-serif",
  color: "#1e1713",
};
const container = { padding: "34px 28px", maxWidth: "620px" };
const eyebrow = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  color: "#7d7168",
  margin: "0 0 12px 0",
  fontWeight: 700,
};
const h1 = {
  fontSize: "28px",
  lineHeight: "1.15",
  margin: "0 0 14px 0",
  color: "#1e1713",
};
const intro = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#5e554e",
  margin: "0 0 18px 0",
};
const card = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5ddd3",
  borderRadius: "8px",
  padding: "8px 18px",
  margin: "18px 0",
};
const row = {
  borderBottom: "1px solid #eee7df",
  padding: "11px 0",
};
const rowLabel = {
  fontSize: "10px",
  letterSpacing: "0.14em",
  color: "#7d7168",
  margin: "0 0 4px 0",
  textTransform: "uppercase" as const,
  fontWeight: 700,
};
const rowValue = { fontSize: "14px", color: "#1e1713", margin: 0 };
const rowValueStrong = {
  ...rowValue,
  fontSize: "18px",
  fontWeight: 700,
};
const rowValueDanger = {
  ...rowValueStrong,
  color: "#d94b37",
};
const noteBox = {
  fontSize: "13px",
  lineHeight: "1.6",
  color: "#5e554e",
  backgroundColor: "#fff8ef",
  border: "1px solid #f1ddc5",
  borderRadius: "8px",
  padding: "12px 14px",
};
const narrativeBox = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5ddd3",
  borderRadius: "8px",
  padding: "14px 16px",
  margin: "18px 0",
};
const narrativeText = {
  fontSize: "13px",
  lineHeight: "1.65",
  color: "#342c26",
  margin: 0,
  whiteSpace: "pre-wrap" as const,
};
const button = {
  backgroundColor: "#1e1713",
  color: "#ffffff",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 700,
  padding: "12px 18px",
  marginTop: "12px",
};
const downloadRow = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5ddd3",
  borderRadius: "8px",
  padding: "16px 18px",
  margin: "18px 0",
};
const downloadLead = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "#342c26",
  margin: "0 0 12px 0",
  fontWeight: 700,
};
const downloadButton = {
  backgroundColor: "#d97757",
  color: "#231a15",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 700,
  padding: "13px 20px",
};
const downloadCaption = {
  fontSize: "11px",
  color: "#7d7168",
  margin: "10px 0 0 0",
};
const footer = {
  fontSize: "12px",
  color: "#7d7168",
  marginTop: "22px",
};
