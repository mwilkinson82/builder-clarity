// SYMBOLDISCOVERY Rung 2 — server-side sheet render that seeds the discovery
// render cache, browser-independent.
//
// The identification-library flow's one slow step is rasterizing a vector-dense
// PDF sheet. In the browser (pdfjs + canvas) a dense architectural sheet takes
// 30s to minutes and wedges weak tabs; the SAME sheet rendered here with MuPDF
// (a compiled-C engine in WASM) takes ~150-250ms. This function renders one
// sheet to a PNG at the discovery resolution and writes it to the EXACT storage
// path Rung 1's client cache reads — so a discovery on any browser, even a weak
// one, loads the sheet in ~1-2s instead of rasterizing it locally.
//
// Runs AS THE CALLING USER: it builds a Supabase client from the caller's JWT,
// so every storage read/write is gated by the same RLS as the client. Its only
// elevated power is the fast rasterizer — no service-role key, no DB query.
// A caller can therefore only render files they can already download and only
// write cache objects under estimates they already own; anything else is
// refused by storage RLS and the client falls back to its in-browser render.

import * as mupdf from "npm:mupdf@1.28.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const PLAN_ROOM_BUCKET = "plan-room";
const DEFAULT_LONG_EDGE_PX = 2400;
const MIN_LONG_EDGE_PX = 600;
const MAX_LONG_EDGE_PX = 4000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The one cache key, byte-identical to the client's discoveryRasterCachePath. */
function cacheObjectPath(
  estimateId: string,
  planSetId: string,
  sheetId: string,
  longEdgePx: number,
): string {
  return `${estimateId}/${planSetId}/discovery-cache/${sheetId}.e${Math.round(longEdgePx)}.png`;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return json({ error: "Function is misconfigured" }, 500);

    // Every DB/storage call below runs with the caller's identity → RLS applies.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => null);
    const estimateId = String(body?.estimateId ?? "");
    const planSetId = String(body?.planSetId ?? "");
    const sheetId = String(body?.sheetId ?? "");
    const filePath = String(body?.filePath ?? "");
    const pageNumber = Number(body?.pageNumber);
    let longEdgePx = Number(body?.longEdgePx) || DEFAULT_LONG_EDGE_PX;
    longEdgePx = Math.max(MIN_LONG_EDGE_PX, Math.min(MAX_LONG_EDGE_PX, Math.round(longEdgePx)));

    if (!estimateId || !planSetId || !sheetId || !filePath || !Number.isFinite(pageNumber)) {
      return json(
        { error: "estimateId, planSetId, sheetId, filePath, pageNumber are required" },
        400,
      );
    }

    // If some other run already seeded this exact object, do nothing (cheap on
    // races/retries). A miss on the client is what triggers this, so this is
    // only hit under concurrency.
    const targetPath = cacheObjectPath(estimateId, planSetId, sheetId, longEdgePx);
    const existing = await supabase.storage.from(PLAN_ROOM_BUCKET).download(targetPath);
    if (existing.data) {
      return json({ ok: true, path: targetPath, cached: true });
    }

    // Download the source PDF (RLS-gated: the caller must be allowed to read it).
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(PLAN_ROOM_BUCKET)
      .download(filePath);
    if (dlErr || !pdfBlob) {
      return json({ error: `Could not read the drawing file: ${dlErr?.message ?? "no data"}` }, 403);
    }
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    // Rasterize the page with MuPDF WASM.
    const renderStart = performance.now();
    const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
    const pageCount = doc.countPages();
    if (pageCount <= 0) return json({ error: "The drawing has no pages" }, 422);
    // page_number is 1-indexed (client/pdfjs); MuPDF loadPage is 0-indexed.
    const pageIndex = Math.max(0, Math.min(pageCount - 1, Math.round(pageNumber) - 1));
    const page = doc.loadPage(pageIndex);
    const bounds = page.getBounds(); // [x0, y0, x1, y1] in points
    const longPt = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    if (!(longPt > 0)) return json({ error: "The sheet has no measurable size" }, 422);
    const scale = longEdgePx / longPt;
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    // Copy into a fresh ArrayBuffer-backed array (MuPDF's buffer is typed as
    // possibly SharedArrayBuffer, which Blob's strict types reject).
    const png = new Uint8Array(pixmap.asPNG());
    const renderMs = Math.round(performance.now() - renderStart);

    // Write to the same cache path Rung 1's client reads (RLS-gated upload).
    const { error: upErr } = await supabase.storage
      .from(PLAN_ROOM_BUCKET)
      .upload(targetPath, new Blob([png], { type: "image/png" }), {
        upsert: true,
        contentType: "image/png",
      });
    if (upErr) {
      return json({ error: `Could not cache the rendered sheet: ${upErr.message}` }, 403);
    }

    return json({
      ok: true,
      path: targetPath,
      widthPx: pixmap.getWidth(),
      heightPx: pixmap.getHeight(),
      pageIndex,
      renderMs,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
