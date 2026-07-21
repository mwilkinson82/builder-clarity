// Public-readiness Batch 3 — the in-app support form must never silently drop a
// report. These tests pin the two load-bearing, network-free pieces of the
// intake: the input contract (empty messages are rejected, context is bounded)
// and the email composition (reporter identity + auto-captured context always
// travel with the message so a founder can act without a back-and-forth).

import { describe, expect, it } from "vitest";
import {
  composeSupportEmail,
  supportRequestSchema,
  type SupportRequestInput,
} from "@/lib/support-request";

describe("supportRequestSchema", () => {
  it("rejects an empty message", () => {
    const result = supportRequestSchema.safeParse({ message: "   " });
    expect(result.success).toBe(false);
  });

  it("trims the message and defaults the category + context fields", () => {
    const result = supportRequestSchema.parse({ message: "  billing looks wrong  " });
    expect(result.message).toBe("billing looks wrong");
    expect(result.category).toBe("issue");
    expect(result.routePath).toBe("");
    expect(result.organizationName).toBe("");
  });

  it("caps an over-long message", () => {
    const result = supportRequestSchema.safeParse({ message: "x".repeat(5001) });
    expect(result.success).toBe(false);
  });
});

describe("composeSupportEmail", () => {
  const base: SupportRequestInput = {
    category: "issue",
    message: "The gross profit number on my dashboard looks off.",
    routePath: "/projects/abc?tab=budget",
    organizationId: "org-123",
    organizationName: "Harbor Builders",
    appVersion: "deadbeef",
    userAgent: "Mozilla/5.0",
  };

  it("puts the category label and company in the subject", () => {
    const { subject } = composeSupportEmail(base, { name: "Dana", email: "dana@x.com" });
    expect(subject).toContain("Something's broken");
    expect(subject).toContain("Harbor Builders");
  });

  it("carries the reporter, page, and message in the plain-text body", () => {
    const { text } = composeSupportEmail(base, { name: "Dana", email: "dana@x.com" });
    expect(text).toContain("Dana <dana@x.com>");
    expect(text).toContain("/projects/abc?tab=budget");
    expect(text).toContain("org-123");
    expect(text).toContain("The gross profit number on my dashboard looks off.");
  });

  it("escapes HTML in the reporter message so a report can't inject markup", () => {
    const { html } = composeSupportEmail(
      { ...base, message: "<script>alert(1)</script>" },
      { name: "Dana", email: "dana@x.com" },
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("degrades gracefully when there is no company or reporter email", () => {
    const { subject, text } = composeSupportEmail(
      { ...base, organizationName: "", organizationId: "" },
      { name: "", email: "" },
    );
    expect(subject).toBe("OverWatch support · Something's broken");
    expect(text).toContain("Unknown user");
  });
});
