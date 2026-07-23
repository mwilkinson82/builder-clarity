import { describe, expect, it } from "vitest";
import {
  ALLOWED_ORIGINS,
  PRODUCTION_ORIGIN,
  isAllowedOrigin,
  resolveMagicLinkRedirect,
} from "../src/lib/auth/magic-link-origins";

// P0 containment for magic-link redirect trust. Every case here maps to an
// attack an adversary could otherwise land through the /api/auth/magic-link
// route. A regression that re-widens trust (suffix match on .lovable.app,
// caller-Origin echo, silent rewrite on rejection) must fail this suite.

const PROD = { isProd: true } as const;
const DEV = { isProd: false } as const;

describe("magic-link redirect containment", () => {
  describe("isAllowedOrigin — exact match only", () => {
    it("accepts the exact production origin", () => {
      expect(isAllowedOrigin(PRODUCTION_ORIGIN, PROD)).toBe(true);
    });

    it("accepts each exact known origin in the allowlist", () => {
      for (const o of ALLOWED_ORIGINS) {
        expect(isAllowedOrigin(o, PROD), o).toBe(true);
      }
    });

    it("rejects evil.lovable.app and any arbitrary *.lovable.app suffix", () => {
      expect(isAllowedOrigin("https://evil.lovable.app", PROD)).toBe(false);
      expect(isAllowedOrigin("https://attacker-preview.lovable.app", PROD)).toBe(false);
      expect(isAllowedOrigin("https://builder-clarity.evil.lovable.app", PROD)).toBe(false);
    });

    it("rejects suffix tricks that append onto a trusted host", () => {
      expect(isAllowedOrigin("https://overwatch.alpcontractorcircle.com.evil.com", PROD)).toBe(false);
      expect(isAllowedOrigin("https://builder-clarity.lovable.app.evil.com", PROD)).toBe(false);
      // Same host, different port is NOT the same origin.
      expect(isAllowedOrigin("https://overwatch.alpcontractorcircle.com:8443", PROD)).toBe(false);
    });

    it("rejects protocol downgrade to http for production origins", () => {
      expect(isAllowedOrigin("http://overwatch.alpcontractorcircle.com", PROD)).toBe(false);
      expect(isAllowedOrigin("http://builder-clarity.lovable.app", PROD)).toBe(false);
    });

    it("rejects arbitrary https domains", () => {
      expect(isAllowedOrigin("https://google.com", PROD)).toBe(false);
      expect(isAllowedOrigin("https://attacker.example", PROD)).toBe(false);
    });

    it("rejects localhost in production", () => {
      expect(isAllowedOrigin("http://localhost:5173", PROD)).toBe(false);
      expect(isAllowedOrigin("http://127.0.0.1:5173", PROD)).toBe(false);
    });

    it("accepts localhost/127.0.0.1 only when runtime is explicitly non-production", () => {
      expect(isAllowedOrigin("http://localhost:5173", DEV)).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:8080", DEV)).toBe(true);
      // Still no arbitrary origins in dev
      expect(isAllowedOrigin("https://evil.lovable.app", DEV)).toBe(false);
    });

    it("rejects malformed origins", () => {
      expect(isAllowedOrigin("not-a-url", PROD)).toBe(false);
      expect(isAllowedOrigin("", PROD)).toBe(false);
    });
  });

  describe("resolveMagicLinkRedirect — caller-supplied redirectTo", () => {
    it("rejects evil.lovable.app redirectTo with 400 semantics and does not silently rewrite", () => {
      const r = resolveMagicLinkRedirect({
        requestUrl: "https://overwatch.alpcontractorcircle.com/api/auth/magic-link",
        redirectTo: "https://evil.lovable.app/auth/callback?next=/",
        isProd: true,
      });
      expect(r.ok).toBe(false);
    });

    it("rejects suffix trick redirectTo", () => {
      const r = resolveMagicLinkRedirect({
        requestUrl: "https://overwatch.alpcontractorcircle.com/api/auth/magic-link",
        redirectTo: "https://overwatch.alpcontractorcircle.com.evil.com/auth/callback",
        isProd: true,
      });
      expect(r.ok).toBe(false);
    });

    it("rejects http:// downgrade redirectTo", () => {
      const r = resolveMagicLinkRedirect({
        requestUrl: "https://overwatch.alpcontractorcircle.com/api/auth/magic-link",
        redirectTo: "http://overwatch.alpcontractorcircle.com/auth/callback",
        isProd: true,
      });
      expect(r.ok).toBe(false);
    });

    it("rejects arbitrary https redirectTo", () => {
      const r = resolveMagicLinkRedirect({
        requestUrl: "https://overwatch.alpcontractorcircle.com/api/auth/magic-link",
        redirectTo: "https://google.com/auth/callback",
        isProd: true,
      });
      expect(r.ok).toBe(false);
    });

    it("accepts an exact production redirectTo unchanged", () => {
      const url = "https://overwatch.alpcontractorcircle.com/auth/callback?next=%2F";
      const r = resolveMagicLinkRedirect({
        requestUrl: "https://overwatch.alpcontractorcircle.com/api/auth/magic-link",
        redirectTo: url,
        isProd: true,
      });
      expect(r).toEqual({ ok: true, redirectTo: url });
    });

    it("accepts each exact known origin as redirectTo", () => {
      for (const origin of ALLOWED_ORIGINS) {
        const url = `${origin}/auth/callback?next=%2F`;
        const r = resolveMagicLinkRedirect({
          requestUrl: "https://overwatch.alpcontractorcircle.com/api/auth/magic-link",
          redirectTo: url,
          isProd: true,
        });
        expect(r.ok, origin).toBe(true);
      }
    });
  });

  describe("resolveMagicLinkRedirect — derived origin when redirectTo absent", () => {
    it("uses the request origin when it is exact-allowlisted", () => {
      const r = resolveMagicLinkRedirect({
        requestUrl: "https://builder-clarity.lovable.app/api/auth/magic-link",
        next: "/dashboard",
        isProd: true,
      });
      expect(r).toEqual({
        ok: true,
        redirectTo: "https://builder-clarity.lovable.app/auth/callback?next=%2Fdashboard",
      });
    });

    it("falls back to the production origin when the request origin is NOT allowlisted (defeats caller Origin spoofing)", () => {
      const r = resolveMagicLinkRedirect({
        // Simulates the request URL being an attacker-controlled Lovable app.
        requestUrl: "https://evil.lovable.app/api/auth/magic-link",
        next: "/dashboard",
        isProd: true,
      });
      expect(r).toEqual({
        ok: true,
        redirectTo: `${PRODUCTION_ORIGIN}/auth/callback?next=%2Fdashboard`,
      });
    });

    it("normalizes internal next paths (protocol-relative and external nexts collapse to '/')", () => {
      const cases: Array<[string | undefined, string]> = [
        [undefined, "%2F"],
        ["", "%2F"],
        ["//evil.com", "%2F"],
        ["https://evil.com/x", "%2F"],
        ["/estimates/abc", "%2Festimates%2Fabc"],
      ];
      for (const [next, encoded] of cases) {
        const r = resolveMagicLinkRedirect({
          requestUrl: `${PRODUCTION_ORIGIN}/api/auth/magic-link`,
          next,
          isProd: true,
        });
        expect(r.ok && r.redirectTo).toBe(`${PRODUCTION_ORIGIN}/auth/callback?next=${encoded}`);
      }
    });
  });
});
