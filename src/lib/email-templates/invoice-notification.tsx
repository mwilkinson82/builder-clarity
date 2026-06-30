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
  invoiceNumber?: string;
  invoiceTitle?: string;
  invoiceStatus?: string;
  totalDue?: string;
  paidAmount?: string;
  openBalance?: string;
  dueDate?: string | null;
  portalUrl?: string;
  paymentUrl?: string;
  notes?: string;
}

const InvoiceNotificationEmail = ({
  projectName = "Project",
  clientName,
  jobNumber,
  invoiceNumber = "Invoice",
  invoiceTitle,
  invoiceStatus = "Sent",
  totalDue = "$0",
  paidAmount = "$0",
  openBalance = "$0",
  dueDate,
  portalUrl,
  paymentUrl,
  notes,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${invoiceNumber} is ready for ${projectName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>OVERWATCH BILLING</Text>
        <Heading style={h1}>Invoice ready for review</Heading>
        <Text style={intro}>
          {clientName ? `${clientName}, ` : ""}
          an invoice has been shared through the Overwatch client portal.
        </Text>

        <Section style={card}>
          <Row label="Project" value={projectName} />
          {jobNumber ? <Row label="Job number" value={jobNumber} /> : null}
          <Row label="Invoice" value={invoiceNumber} />
          {invoiceTitle ? <Row label="Description" value={invoiceTitle} /> : null}
          <Row label="Status" value={invoiceStatus} />
          <Row label="Total due" value={totalDue} strong />
          <Row label="Paid to date" value={paidAmount} />
          <Row label="Open balance" value={openBalance} strong />
          {dueDate ? <Row label="Due date" value={dueDate} /> : null}
        </Section>

        {notes ? <Text style={note}>{notes}</Text> : null}

        {paymentUrl ? (
          <Button href={paymentUrl} style={button}>
            Pay invoice online
          </Button>
        ) : null}

        {portalUrl ? (
          <Button href={portalUrl} style={button}>
            {paymentUrl ? "Open client portal" : "Open invoice in client portal"}
          </Button>
        ) : null}

        <Text style={footer}>
          This message was sent from Overwatch. Reply to the project team if anything looks off.
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
  component: InvoiceNotificationEmail,
  subject: (data: Record<string, string | null | undefined>) =>
    `Invoice ${data?.invoiceNumber ?? ""} - ${data?.projectName ?? "Overwatch"}`.trim(),
  displayName: "Invoice notification",
  previewData: {
    projectName: "Harbor Residence",
    clientName: "Private Luxury Residence",
    jobNumber: "2601",
    invoiceNumber: "2601-1",
    invoiceTitle: "Pay App 1",
    invoiceStatus: "Sent",
    totalDue: "$2,120,250",
    paidAmount: "$1,200,000",
    openBalance: "$708,225",
    dueDate: "2026-07-21",
    portalUrl: "https://overwatch.alpcontractorcircle.com/client/projects/example",
    paymentUrl: "https://checkout.stripe.com/c/pay/example",
    notes: "Current billing cycle invoice.",
  },
} satisfies TemplateEntry;

const main = {
  backgroundColor: "#f8f5ee",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Arial, sans-serif",
  color: "#1e1713",
};
const container = { padding: "34px 28px", maxWidth: "600px" };
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
const note = {
  fontSize: "13px",
  lineHeight: "1.6",
  color: "#5e554e",
  backgroundColor: "#fff8ef",
  border: "1px solid #f1ddc5",
  borderRadius: "8px",
  padding: "12px 14px",
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
const footer = {
  fontSize: "12px",
  color: "#7d7168",
  marginTop: "22px",
};
