// The engine is pure; TSX is used only because this repo's focused Vitest include targets .test.tsx.
import { describe, expect, it } from "vitest";
import {
  calculateTakeoffAssembly,
  defaultTakeoffAssemblyInputs,
  parseTakeoffAssemblyInputProposals,
} from "@/lib/takeoff-assembly";

describe("takeoff assembly engine", () => {
  it("derives a wall assembly deterministically from trusted LF and explicit inputs", () => {
    const result = calculateTakeoffAssembly({
      templateId: "interior_wall",
      geometryQuantity: 100,
      geometryUnit: "LF",
      inputs: defaultTakeoffAssemblyInputs("interior_wall"),
    });

    expect(result.formulaVersion).toBe("assembly-engine-v1");
    expect(result.outputs.map(({ key, quantity, unit }) => ({ key, quantity, unit }))).toEqual([
      { key: "wall_face_area_sf", quantity: 1600, unit: "SF" },
      { key: "board_area_sf", quantity: 1760, unit: "SF" },
      { key: "board_sheets_ea", quantity: 55, unit: "EA" },
      { key: "studs_ea", quantity: 76, unit: "EA" },
      { key: "plate_track_lf", quantity: 220, unit: "LF" },
      { key: "insulation_area_sf", quantity: 880, unit: "SF" },
      { key: "labor_hours", quantity: 50, unit: "HR" },
    ]);
  });

  it("keeps footing, MEP, and surface formulas explicit and repeatable", () => {
    const footing = calculateTakeoffAssembly({
      templateId: "continuous_footing",
      geometryQuantity: 100,
      geometryUnit: "LF",
      inputs: defaultTakeoffAssemblyInputs("continuous_footing"),
    });
    const mep = calculateTakeoffAssembly({
      templateId: "mep_linear_run",
      geometryQuantity: 100,
      geometryUnit: "LF",
      inputs: defaultTakeoffAssemblyInputs("mep_linear_run"),
    });
    const finish = calculateTakeoffAssembly({
      templateId: "surface_finish",
      geometryQuantity: 1000,
      geometryUnit: "SF",
      inputs: defaultTakeoffAssemblyInputs("surface_finish"),
    });

    expect(footing.outputs.map((output) => output.quantity)).toEqual([7.41, 7.78, 200, 220, 7.78]);
    expect(mep.outputs.map((output) => output.quantity)).toEqual([100, 110, 14, 5.5]);
    expect(finish.outputs.map((output) => output.quantity)).toEqual([1000, 1100, 11, 10]);
    expect(finish.outputs.every((output) => output.formula.length > 0)).toBe(true);
  });

  it("rejects mismatched geometry units and unsafe input ranges", () => {
    expect(() =>
      calculateTakeoffAssembly({
        templateId: "surface_finish",
        geometryQuantity: 100,
        geometryUnit: "LF",
        inputs: defaultTakeoffAssemblyInputs("surface_finish"),
      }),
    ).toThrow("requires a SF takeoff");

    expect(() =>
      calculateTakeoffAssembly({
        templateId: "mep_linear_run",
        geometryQuantity: 100,
        geometryUnit: "LF",
        inputs: {
          ...defaultTakeoffAssemblyInputs("mep_linear_run"),
          support_spacing_ft: 0,
        },
      }),
    ).toThrow("Support spacing must be between 0.25 and 100 FT OC");

    expect(() =>
      calculateTakeoffAssembly({
        templateId: "interior_wall",
        geometryQuantity: 100,
        geometryUnit: "LF",
        inputs: {
          ...defaultTakeoffAssemblyInputs("interior_wall"),
          sides: 1.5,
        },
      }),
    ).toThrow("Finished sides must be a whole number");
  });

  it("keeps only in-range AI inputs backed by an exact accepted citation", () => {
    const proposals = parseTakeoffAssemblyInputProposals({
      templateId: "interior_wall",
      citations: [
        {
          source_line: "L103",
          source_excerpt: "TYPE A PARTITION: 9 FT HIGH, STUDS AT 16 IN OC",
        },
      ],
      raw: JSON.stringify({
        proposals: [
          {
            input_key: "height_ft",
            value: 9,
            source_line: "L103",
            source_excerpt: "9 FT HIGH",
            reason: "The partition note states a nine-foot height.",
          },
          {
            input_key: "stud_spacing_in",
            value: 16,
            source_line: "L103",
            source_excerpt: "STUDS AT 16 IN OC",
            reason: "The partition note states the stud spacing.",
          },
          {
            input_key: "waste_pct",
            value: 10,
            source_line: "L103",
            source_excerpt: "10 PERCENT WASTE",
            reason: "This is not actually in the accepted citation.",
          },
          {
            input_key: "productivity_sf_per_hour",
            value: 999,
            source_line: "L103",
            source_excerpt: "9 FT HIGH",
            reason: "Out of range and unsupported.",
          },
          {
            input_key: "height_ft",
            value: 12,
            source_line: "L999",
            source_excerpt: "12 FT HIGH",
            reason: "Uncited line.",
          },
          {
            input_key: "plate_runs",
            value: 3,
            source_line: "L103",
            source_excerpt: "9 FT HIGH",
            reason: "The proposed value is not stated in the cited words.",
          },
        ],
      }),
    });

    expect(proposals).toEqual([
      expect.objectContaining({ input_key: "height_ft", value: 9, source_line: "L103" }),
      expect.objectContaining({ input_key: "stud_spacing_in", value: 16, source_line: "L103" }),
    ]);
  });
});
