// Pins the open-redirect guard used by NotificationBell (and any future
// sink that navigates from stored, free-form URLs). The rule: only a
// single-leading-slash relative path passes; everything else collapses to "/".
import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/safe-internal-path";

describe("safeInternalPath", () => {
  it("passes ordinary internal paths through unchanged", () => {
    expect(safeInternalPath("/")).toBe("/");
    expect(safeInternalPath("/projects")).toBe("/projects");
    expect(safeInternalPath("/projects/123?tab=billing&invoice=abc")).toBe(
      "/projects/123?tab=billing&invoice=abc",
    );
    expect(safeInternalPath("/team?section=plan")).toBe("/team?section=plan");
    expect(safeInternalPath("/ok?x=1#y")).toBe("/ok?x=1#y");
    expect(safeInternalPath("/deep/nested/path#fragment")).toBe("/deep/nested/path#fragment");
  });

  it("rejects empty and non-string values", () => {
    expect(safeInternalPath("")).toBe("/");
    expect(safeInternalPath("   ")).toBe("/");
    expect(safeInternalPath(undefined as unknown as string)).toBe("/");
    expect(safeInternalPath(null as unknown as string)).toBe("/");
    expect(safeInternalPath(42 as unknown as string)).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeInternalPath("//evil.example")).toBe("/");
    expect(safeInternalPath("//evil.example/phish")).toBe("/");
    expect(safeInternalPath("///evil.example")).toBe("/");
  });

  it("rejects absolute URLs and any scheme prefix", () => {
    expect(safeInternalPath("https://evil.example/phish")).toBe("/");
    expect(safeInternalPath("http://evil.example")).toBe("/");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/");
    expect(safeInternalPath("JaVaScRiPt:alert(1)")).toBe("/");
    expect(safeInternalPath("data:text/html,<script>alert(1)</script>")).toBe("/");
    expect(safeInternalPath("mailto:someone@evil.example")).toBe("/");
    expect(safeInternalPath("vbscript:msgbox(1)")).toBe("/");
    expect(safeInternalPath("custom-scheme.x:whatever")).toBe("/");
  });

  it("rejects backslash tricks", () => {
    expect(safeInternalPath("/\\evil.example")).toBe("/");
    expect(safeInternalPath("\\\\evil.example")).toBe("/");
    expect(safeInternalPath("/path\\..\\evil")).toBe("/");
  });

  it("rejects control-character smuggling", () => {
    expect(safeInternalPath("/\t/evil.example")).toBe("/");
    expect(safeInternalPath("/\n/evil.example")).toBe("/");
    expect(safeInternalPath("java\tscript:alert(1)")).toBe("/");
    expect(safeInternalPath("/ok path")).toBe("/ok path");
  });

  it("rejects relative paths without a leading slash", () => {
    expect(safeInternalPath("projects/123")).toBe("/");
    expect(safeInternalPath("./projects")).toBe("/");
    expect(safeInternalPath("../projects")).toBe("/");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(safeInternalPath("  /projects/123  ")).toBe("/projects/123");
    expect(safeInternalPath("  //evil.example  ")).toBe("/");
  });
});
