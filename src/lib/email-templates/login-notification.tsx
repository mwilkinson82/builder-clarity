import {
  Body,
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
  userEmail?: string;
  loginAt?: string;
  method?: string;
  userAgent?: string;
}

const LoginNotificationEmail = ({
  userEmail,
  loginAt,
  method,
  userAgent,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {userEmail ? `${userEmail} just logged into Overwatch` : "New Overwatch login"}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>OVERWATCH · LOGIN ACTIVITY</Text>
        <Heading style={h1}>Someone just logged in</Heading>
        <Section style={card}>
          <Row label="User" value={userEmail ?? "unknown"} />
          <Row label="Time" value={loginAt ?? new Date().toISOString()} />
          <Row label="Method" value={method ?? "magic link"} />
          {userAgent ? <Row label="Device" value={userAgent} /> : null}
        </Section>
        <Text style={footer}>
          Sent automatically by Overwatch each time a user signs in.
        </Text>
      </Container>
    </Body>
  </Html>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <Section style={row}>
    <Text style={rowLabel}>{label}</Text>
    <Text style={rowValue}>{value}</Text>
  </Section>
);

export const template = {
  component: LoginNotificationEmail,
  subject: (data: Record<string, any>) =>
    `Overwatch login: ${data?.userEmail ?? "unknown user"}`,
  displayName: "Login notification",
  to: "wilkinson.marshall@gmail.com",
  previewData: {
    userEmail: "user@example.com",
    loginAt: new Date().toISOString(),
    method: "magic link",
    userAgent: "Chrome on macOS",
  },
} satisfies TemplateEntry;

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Arial, sans-serif",
  color: "#0b0b0b",
};
const container = { padding: "32px 28px", maxWidth: "560px" };
const eyebrow = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  color: "#6b6b6b",
  margin: "0 0 12px 0",
  fontWeight: 600,
};
const h1 = {
  fontSize: "24px",
  lineHeight: "1.2",
  margin: "0 0 20px 0",
  color: "#0b0b0b",
};
const card = {
  border: "1px solid #e6e6e6",
  borderRadius: "10px",
  padding: "8px 16px",
  margin: "16px 0",
};
const row = {
  borderBottom: "1px solid #f0f0f0",
  padding: "10px 0",
};
const rowLabel = {
  fontSize: "11px",
  letterSpacing: "0.12em",
  color: "#6b6b6b",
  margin: "0 0 2px 0",
  textTransform: "uppercase" as const,
  fontWeight: 600,
};
const rowValue = { fontSize: "14px", color: "#0b0b0b", margin: 0 };
const footer = {
  fontSize: "12px",
  color: "#6b6b6b",
  marginTop: "20px",
};
