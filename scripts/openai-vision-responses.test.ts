import { afterEach, describe, expect, it, vi } from "vitest";
import { callOpenAiVision } from "@/lib/ai-takeoff/openai.server";

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe("OpenAI Responses vision transport", () => {
  it("sends original-detail images and a strict structured-output schema", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(request).toMatchObject({
        model: "gpt-5.6-sol",
        max_output_tokens: 5000,
        reasoning: { effort: "medium" },
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "measurement_plan",
            strict: true,
          },
        },
      });
      const input = request.input as Array<{
        content: Array<Record<string, unknown>>;
      }>;
      expect(input[0].content).toEqual([
        { type: "input_text", text: "Inspect this sheet" },
        {
          type: "input_image",
          image_url: "data:image/png;base64,aGVsbG8=",
          detail: "original",
        },
      ]);
      return new Response(
        JSON.stringify({
          model: "gpt-5.6-sol-2026-07-01",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"suggestions":[]}' }],
            },
          ],
          usage: { input_tokens: 1250, output_tokens: 80 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOpenAiVision({
      model: "gpt-5.6-sol",
      instruction: "Inspect this sheet",
      images: [{ mediaType: "image/png", base64: "aGVsbG8=" }],
      maxTokens: 5000,
      api: "responses",
      imageDetail: "original",
      reasoningEffort: "medium",
      responseJsonSchema: {
        name: "measurement_plan",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { suggestions: { type: "array", items: {} } },
          required: ["suggestions"],
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      text: '{"suggestions":[]}',
      inputTokens: 1250,
      outputTokens: 80,
      model: "gpt-5.6-sol-2026-07-01",
    });
  });

  it("surfaces a model refusal instead of returning an empty plan", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              output: [
                {
                  type: "message",
                  content: [{ type: "refusal", refusal: "Cannot inspect this image." }],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      callOpenAiVision({
        model: "gpt-5.6-sol",
        instruction: "Inspect this sheet",
        images: [{ mediaType: "image/png", base64: "aGVsbG8=" }],
        api: "responses",
      }),
    ).rejects.toThrow("The OpenAI model refused the drawing review");
  });
});
