/* eslint-disable react-refresh/only-export-components */
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
  selectionNumber?: string;
  selectionTitle?: string;
  decisionDueDate?: string | null;
  needOnSiteDate?: string | null;
  portalUrl?: string;
}

const SelectionNotificationEmail = ({
  projectName = "Project",
  clientName,
  jobNumber,
  selectionNumber = "Selection",
  selectionTitle = "Project selection",
  decisionDueDate,
  needOnSiteDate,
  portalUrl,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${selectionTitle} needs your decision for ${projectName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>OVERWATCH SELECTIONS</Text>
        <Heading style={h1}>A project selection needs your approval</Heading>
        <Text style={intro}>
          {clientName ? `${clientName}, ` : ""}
          the project team shared options for you to review in the secure client portal.
        </Text>
        <Section style={card}>
          <Row label="Project" value={projectName} />
          {jobNumber ? <Row label="Job number" value={jobNumber} /> : null}
          <Row label="Selection" value={`${selectionNumber} · ${selectionTitle}`} strong />
          {decisionDueDate ? (
            <Row label="Decision needed by" value={decisionDueDate} strong />
          ) : null}
          {needOnSiteDate ? <Row label="Needed on site" value={needOnSiteDate} /> : null}
        </Section>
        {portalUrl ? (
          <Button href={portalUrl} style={button}>
            Review and approve
          </Button>
        ) : null}
        <Text style={footer}>
          The deadline is calculated from the project schedule and procurement lead time. Reply to
          the project team if you need clarification before deciding.
        </Text>
      </Container>
    </Body>
  </Html>
);

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <Section style={row}>
    <Text style={rowLabel}>{label}</Text>
    <Text style={strong ? rowValueStrong : rowValue}>{value}</Text>
  </Section>
);

export const template = {
  component: SelectionNotificationEmail,
  subject: (data: Record<string, string | null | undefined>) =>
    `Selection approval needed: ${data.selectionTitle ?? data.projectName ?? "Overwatch"}`,
  displayName: "Selection approval notification",
  previewData: {
    projectName: "Harbor Residence",
    clientName: "Marshall",
    jobNumber: "2601",
    selectionNumber: "SEL-004",
    selectionTitle: "Kitchen appliance package",
    decisionDueDate: "2026-08-03",
    needOnSiteDate: "2026-10-12",
    portalUrl: "https://overwatch.alpcontractorcircle.com/client/projects/example",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#f8f5ee", fontFamily: "Arial, sans-serif", color: "#1e1713" };
const container = { padding: "34px 28px", maxWidth: "600px" };
const eyebrow = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  color: "#7d7168",
  margin: "0 0 12px",
  fontWeight: 700,
};
const h1 = { fontSize: "28px", lineHeight: "1.15", margin: "0 0 14px", color: "#1e1713" };
const intro = { fontSize: "14px", lineHeight: "1.6", color: "#5e554e", margin: "0 0 18px" };
const card = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5ddd3",
  borderRadius: "8px",
  padding: "8px 18px",
  margin: "18px 0",
};
const row = { borderBottom: "1px solid #eee7df", padding: "11px 0" };
const rowLabel = {
  fontSize: "10px",
  letterSpacing: "0.14em",
  color: "#7d7168",
  margin: "0 0 4px",
  textTransform: "uppercase" as const,
  fontWeight: 700,
};
const rowValue = { fontSize: "14px", color: "#1e1713", margin: 0 };
const rowValueStrong = { ...rowValue, fontSize: "17px", fontWeight: 700 };
const button = {
  backgroundColor: "#1e1713",
  borderRadius: "7px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 700,
  padding: "12px 18px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", lineHeight: "1.6", color: "#7d7168", marginTop: "24px" };
