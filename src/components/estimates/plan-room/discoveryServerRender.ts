// SYMBOLDISCOVERY Rung 2 — client side of the server render.
//
// On a discovery render-cache MISS, ask the `render-discovery-sheet` edge
// function to rasterize the sheet server-side (MuPDF, ~150-250ms) and write the
// PNG to the SAME cache path Rung 1 reads. The caller then loads the sheet from
// that cache — a ~1-2s round trip instead of rasterizing a dense sheet in the
// browser (which can take minutes / wedge a weak tab).
//
// Purely a seeder: any failure (function not deployed, timeout, RLS refusal,
// network) resolves to `false`, and the caller falls back to its in-browser
// render. So this can never break discovery — worst case it's exactly today's
// behavior.

import { supabase } from "@/integrations/supabase/client";

const SERVER_RENDER_FUNCTION = "render-discovery-sheet";
// The render itself is sub-second; this bounds a hung network/cold-start so a
// stuck request degrades to the local render instead of stalling the flow.
const SERVER_RENDER_TIMEOUT_MS = 30_000;

export interface ServerSheetRenderParams {
  estimateId: string;
  planSetId: string;
  sheetId: string;
  filePath: string;
  pageNumber: number;
  longEdgePx: number;
}

/**
 * Ask the server to render + cache this sheet. Returns true when the cache was
 * seeded (the caller should then re-read the cache), false on any failure (the
 * caller should fall back to the in-browser render). Never throws.
 */
export async function requestServerSheetRender(params: ServerSheetRenderParams): Promise<boolean> {
  try {
    const invocation = supabase.functions.invoke<{ ok?: boolean }>(SERVER_RENDER_FUNCTION, {
      body: params,
    });
    const timeout = new Promise<{ data: null; error: Error }>((resolve) => {
      setTimeout(
        () => resolve({ data: null, error: new Error("server render timed out") }),
        SERVER_RENDER_TIMEOUT_MS,
      );
    });
    const { data, error } = await Promise.race([invocation, timeout]);
    if (error) return false;
    return data?.ok === true;
  } catch {
    return false;
  }
}
