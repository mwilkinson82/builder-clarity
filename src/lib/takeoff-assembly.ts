export const TAKEOFF_ASSEMBLY_FORMULA_VERSION = "assembly-engine-v1";

export type TakeoffAssemblyTemplateId =
  "interior_wall" | "continuous_footing" | "mep_linear_run" | "surface_finish";

export type TakeoffAssemblyGeometryUnit = "LF" | "SF";
export type TakeoffAssemblyStatus = "draft" | "confirmed" | "stale";

export interface TakeoffAssemblyInputDefinition {
  key: string;
  label: string;
  unit: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  whole?: boolean;
}

export interface TakeoffAssemblyTemplate {
  id: TakeoffAssemblyTemplateId;
  label: string;
  description: string;
  geometryUnit: TakeoffAssemblyGeometryUnit;
  formulaVersion: string;
  inputs: TakeoffAssemblyInputDefinition[];
}

export interface TakeoffAssemblyOutput {
  key: string;
  label: string;
  unit: "LF" | "SF" | "CY" | "EA" | "HR";
  quantity: number;
  rounding: "nearest_0.01" | "whole_up";
  formula: string;
}

export interface TakeoffAssemblyCalculation {
  templateId: TakeoffAssemblyTemplateId;
  formulaVersion: string;
  geometryQuantity: number;
  geometryUnit: TakeoffAssemblyGeometryUnit;
  inputs: Record<string, number>;
  outputs: TakeoffAssemblyOutput[];
}

export interface TakeoffAssemblyCitation {
  source_line: string;
  source_excerpt: string;
  plan_sheet_id?: string;
  sheet_number?: string;
}

export interface TakeoffAssemblyInputProposal {
  input_key: string;
  value: number;
  source_line: string;
  source_excerpt: string;
  reason: string;
}

export interface TakeoffAssemblyRow {
  id: string;
  estimate_id: string;
  takeoff_measurement_id: string;
  template_id: TakeoffAssemblyTemplateId;
  formula_version: string;
  geometry_quantity: number;
  geometry_unit: TakeoffAssemblyGeometryUnit;
  geometry_calculation_scale_revision: number | null;
  confirmed_inputs: Record<string, number>;
  source_citations: TakeoffAssemblyCitation[];
  ai_operation_id: string | null;
  ai_proposals: TakeoffAssemblyInputProposal[];
  derived_outputs: TakeoffAssemblyOutput[];
  status: TakeoffAssemblyStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const input = (definition: TakeoffAssemblyInputDefinition): TakeoffAssemblyInputDefinition =>
  definition;

export const TAKEOFF_ASSEMBLY_TEMPLATES: TakeoffAssemblyTemplate[] = [
  {
    id: "interior_wall",
    label: "Interior wall",
    description: "Board, framing, insulation, and labor from a measured wall run.",
    geometryUnit: "LF",
    formulaVersion: TAKEOFF_ASSEMBLY_FORMULA_VERSION,
    inputs: [
      input({
        key: "height_ft",
        label: "Wall height",
        unit: "FT",
        description: "Confirmed floor-to-top height for this wall type.",
        min: 1,
        max: 50,
        step: 0.25,
        defaultValue: 8,
      }),
      input({
        key: "sides",
        label: "Finished sides",
        unit: "SIDE",
        description: "Number of wall faces receiving board or finish.",
        min: 1,
        max: 2,
        step: 1,
        defaultValue: 2,
        whole: true,
      }),
      input({
        key: "board_layers_per_side",
        label: "Board layers per side",
        unit: "LAYER",
        description: "Confirmed board layers installed on each finished side.",
        min: 1,
        max: 6,
        step: 1,
        defaultValue: 1,
        whole: true,
      }),
      input({
        key: "board_sheet_area_sf",
        label: "Board sheet coverage",
        unit: "SF/EA",
        description: "Nominal coverage of the selected board sheet.",
        min: 8,
        max: 80,
        step: 1,
        defaultValue: 32,
      }),
      input({
        key: "stud_spacing_in",
        label: "Stud spacing",
        unit: "IN OC",
        description: "Confirmed on-center stud spacing.",
        min: 4,
        max: 48,
        step: 1,
        defaultValue: 16,
      }),
      input({
        key: "plate_runs",
        label: "Plate / track runs",
        unit: "RUN",
        description: "Total continuous plate or track runs along the measured length.",
        min: 1,
        max: 8,
        step: 1,
        defaultValue: 2,
        whole: true,
      }),
      input({
        key: "insulation_layers",
        label: "Insulation layers",
        unit: "LAYER",
        description: "Layers of cavity insulation; use zero when none is required.",
        min: 0,
        max: 4,
        step: 1,
        defaultValue: 1,
        whole: true,
      }),
      input({
        key: "waste_pct",
        label: "Material waste",
        unit: "%",
        description: "Estimator-confirmed material waste factor.",
        min: 0,
        max: 50,
        step: 0.5,
        defaultValue: 10,
      }),
      input({
        key: "productivity_sf_per_hour",
        label: "Board productivity",
        unit: "SF/HR",
        description: "Installed board area per labor hour.",
        min: 1,
        max: 500,
        step: 1,
        defaultValue: 32,
      }),
    ],
  },
  {
    id: "continuous_footing",
    label: "Continuous footing",
    description: "Concrete, forms, reinforcing, and labor from a measured footing run.",
    geometryUnit: "LF",
    formulaVersion: TAKEOFF_ASSEMBLY_FORMULA_VERSION,
    inputs: [
      input({
        key: "width_in",
        label: "Footing width",
        unit: "IN",
        description: "Confirmed footing width.",
        min: 1,
        max: 120,
        step: 1,
        defaultValue: 24,
      }),
      input({
        key: "depth_in",
        label: "Footing depth",
        unit: "IN",
        description: "Confirmed footing depth.",
        min: 1,
        max: 120,
        step: 1,
        defaultValue: 12,
      }),
      input({
        key: "formed_sides",
        label: "Formed sides",
        unit: "SIDE",
        description: "Vertical footing faces requiring formwork.",
        min: 0,
        max: 2,
        step: 1,
        defaultValue: 2,
        whole: true,
      }),
      input({
        key: "rebar_runs",
        label: "Continuous rebar runs",
        unit: "RUN",
        description: "Confirmed longitudinal reinforcing runs.",
        min: 0,
        max: 20,
        step: 1,
        defaultValue: 2,
        whole: true,
      }),
      input({
        key: "rebar_lap_pct",
        label: "Rebar laps",
        unit: "%",
        description: "Estimator-confirmed reinforcing lap factor.",
        min: 0,
        max: 50,
        step: 0.5,
        defaultValue: 10,
      }),
      input({
        key: "waste_pct",
        label: "Concrete waste",
        unit: "%",
        description: "Estimator-confirmed concrete waste factor.",
        min: 0,
        max: 50,
        step: 0.5,
        defaultValue: 5,
      }),
      input({
        key: "productivity_cy_per_hour",
        label: "Placement productivity",
        unit: "CY/HR",
        description: "Placed concrete volume per labor hour.",
        min: 0.01,
        max: 100,
        step: 0.05,
        defaultValue: 1,
      }),
    ],
  },
  {
    id: "mep_linear_run",
    label: "MEP linear run",
    description: "Run material, supports, laps, waste, and labor from a measured route.",
    geometryUnit: "LF",
    formulaVersion: TAKEOFF_ASSEMBLY_FORMULA_VERSION,
    inputs: [
      input({
        key: "parallel_runs",
        label: "Parallel runs",
        unit: "RUN",
        description: "Number of pipes, conduits, ducts, or services following the route.",
        min: 1,
        max: 50,
        step: 1,
        defaultValue: 1,
        whole: true,
      }),
      input({
        key: "support_spacing_ft",
        label: "Support spacing",
        unit: "FT OC",
        description: "Confirmed maximum on-center support spacing.",
        min: 0.25,
        max: 100,
        step: 0.25,
        defaultValue: 8,
      }),
      input({
        key: "lap_pct",
        label: "Joint / lap factor",
        unit: "%",
        description: "Added run length for laps, joints, and couplings.",
        min: 0,
        max: 50,
        step: 0.5,
        defaultValue: 5,
      }),
      input({
        key: "waste_pct",
        label: "Material waste",
        unit: "%",
        description: "Estimator-confirmed material waste factor.",
        min: 0,
        max: 50,
        step: 0.5,
        defaultValue: 5,
      }),
      input({
        key: "productivity_lf_per_hour",
        label: "Installation productivity",
        unit: "LF/HR",
        description: "Installed run length per labor hour.",
        min: 0.1,
        max: 1000,
        step: 0.5,
        defaultValue: 20,
      }),
    ],
  },
  {
    id: "surface_finish",
    label: "Surface finish",
    description: "Finish coverage, layers, waste, units, and labor from a measured area.",
    geometryUnit: "SF",
    formulaVersion: TAKEOFF_ASSEMBLY_FORMULA_VERSION,
    inputs: [
      input({
        key: "finish_layers",
        label: "Finish layers / coats",
        unit: "LAYER",
        description: "Confirmed installed layers or coats.",
        min: 1,
        max: 10,
        step: 1,
        defaultValue: 1,
        whole: true,
      }),
      input({
        key: "coverage_sf_per_unit",
        label: "Material coverage",
        unit: "SF/EA",
        description: "Coverage delivered by one purchasable material unit.",
        min: 0.1,
        max: 10000,
        step: 0.5,
        defaultValue: 100,
      }),
      input({
        key: "waste_pct",
        label: "Material waste",
        unit: "%",
        description: "Estimator-confirmed material waste factor.",
        min: 0,
        max: 50,
        step: 0.5,
        defaultValue: 10,
      }),
      input({
        key: "productivity_sf_per_hour",
        label: "Installation productivity",
        unit: "SF/HR",
        description: "Installed finish area per labor hour.",
        min: 1,
        max: 5000,
        step: 1,
        defaultValue: 100,
      }),
    ],
  },
];

export function takeoffAssemblyTemplate(templateId: string) {
  return TAKEOFF_ASSEMBLY_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

export function takeoffAssemblyTemplatesForUnit(unit: string) {
  const normalized = unit.trim().toUpperCase();
  return TAKEOFF_ASSEMBLY_TEMPLATES.filter((template) => template.geometryUnit === normalized);
}

export function defaultTakeoffAssemblyInputs(templateId: TakeoffAssemblyTemplateId) {
  const template = takeoffAssemblyTemplate(templateId);
  if (!template) throw new Error("Assembly template is not supported.");
  return Object.fromEntries(
    template.inputs.map((definition) => [definition.key, definition.defaultValue]),
  );
}

const roundHundredth = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function quantityOutput(
  key: string,
  label: string,
  unit: TakeoffAssemblyOutput["unit"],
  quantity: number,
  formula: string,
  whole = false,
): TakeoffAssemblyOutput {
  // Remove binary floating-point dust before whole-unit ceiling so a value
  // such as 55.00000000000001 does not become 56. Postgres numeric math is
  // exact; this keeps the browser preview on the same deterministic result.
  const stableWholeQuantity = Math.round(quantity * 100_000_000) / 100_000_000;
  return {
    key,
    label,
    unit,
    quantity: whole ? Math.ceil(stableWholeQuantity) : roundHundredth(quantity),
    rounding: whole ? "whole_up" : "nearest_0.01",
    formula,
  };
}

function validatedInputs(template: TakeoffAssemblyTemplate, rawInputs: Record<string, number>) {
  const result: Record<string, number> = {};
  for (const definition of template.inputs) {
    const value = Number(rawInputs[definition.key]);
    if (!Number.isFinite(value)) {
      throw new Error(`${definition.label} is required.`);
    }
    if (value < definition.min || value > definition.max) {
      throw new Error(
        `${definition.label} must be between ${definition.min} and ${definition.max} ${definition.unit}.`,
      );
    }
    if (definition.whole && !Number.isInteger(value)) {
      throw new Error(`${definition.label} must be a whole number.`);
    }
    result[definition.key] = value;
  }
  return result;
}

export function calculateTakeoffAssembly({
  templateId,
  geometryQuantity,
  geometryUnit,
  inputs,
}: {
  templateId: TakeoffAssemblyTemplateId;
  geometryQuantity: number;
  geometryUnit: string;
  inputs: Record<string, number>;
}): TakeoffAssemblyCalculation {
  const template = takeoffAssemblyTemplate(templateId);
  if (!template) throw new Error("Assembly template is not supported.");
  const normalizedUnit = geometryUnit.trim().toUpperCase();
  if (normalizedUnit !== template.geometryUnit) {
    throw new Error(`${template.label} requires a ${template.geometryUnit} takeoff.`);
  }
  if (!Number.isFinite(geometryQuantity) || geometryQuantity <= 0) {
    throw new Error("A positive trusted takeoff quantity is required.");
  }
  const confirmed = validatedInputs(template, inputs);
  const outputs: TakeoffAssemblyOutput[] = [];

  if (templateId === "interior_wall") {
    const wallFaceArea = geometryQuantity * confirmed.height_ft * confirmed.sides;
    const boardArea =
      wallFaceArea * confirmed.board_layers_per_side * (1 + confirmed.waste_pct / 100);
    outputs.push(
      quantityOutput(
        "wall_face_area_sf",
        "Wall face area",
        "SF",
        wallFaceArea,
        "measured LF × wall height × finished sides",
      ),
      quantityOutput(
        "board_area_sf",
        "Board including waste",
        "SF",
        boardArea,
        "wall face area × board layers per side × (1 + waste %)",
      ),
      quantityOutput(
        "board_sheets_ea",
        "Board sheets",
        "EA",
        boardArea / confirmed.board_sheet_area_sf,
        "board including waste ÷ sheet coverage, rounded up",
        true,
      ),
      quantityOutput(
        "studs_ea",
        "Studs",
        "EA",
        (geometryQuantity * 12) / confirmed.stud_spacing_in + 1,
        "measured inches ÷ stud spacing + one end stud, rounded up",
        true,
      ),
      quantityOutput(
        "plate_track_lf",
        "Plate / track including waste",
        "LF",
        geometryQuantity * confirmed.plate_runs * (1 + confirmed.waste_pct / 100),
        "measured LF × plate / track runs × (1 + waste %)",
      ),
      quantityOutput(
        "insulation_area_sf",
        "Insulation including waste",
        "SF",
        geometryQuantity *
          confirmed.height_ft *
          confirmed.insulation_layers *
          (1 + confirmed.waste_pct / 100),
        "measured LF × wall height × insulation layers × (1 + waste %)",
      ),
      quantityOutput(
        "labor_hours",
        "Board labor",
        "HR",
        (wallFaceArea * confirmed.board_layers_per_side) / confirmed.productivity_sf_per_hour,
        "wall face area × board layers per side ÷ board productivity",
      ),
    );
  } else if (templateId === "continuous_footing") {
    const netConcrete =
      (geometryQuantity * (confirmed.width_in / 12) * (confirmed.depth_in / 12)) / 27;
    const concreteWithWaste = netConcrete * (1 + confirmed.waste_pct / 100);
    outputs.push(
      quantityOutput(
        "net_concrete_cy",
        "Net concrete",
        "CY",
        netConcrete,
        "measured LF × footing width FT × footing depth FT ÷ 27",
      ),
      quantityOutput(
        "concrete_with_waste_cy",
        "Concrete including waste",
        "CY",
        concreteWithWaste,
        "net concrete CY × (1 + waste %)",
      ),
      quantityOutput(
        "formwork_sf",
        "Vertical formwork",
        "SF",
        geometryQuantity * (confirmed.depth_in / 12) * confirmed.formed_sides,
        "measured LF × footing depth FT × formed sides",
      ),
      quantityOutput(
        "rebar_lf",
        "Continuous rebar including laps",
        "LF",
        geometryQuantity * confirmed.rebar_runs * (1 + confirmed.rebar_lap_pct / 100),
        "measured LF × rebar runs × (1 + lap %)",
      ),
      quantityOutput(
        "labor_hours",
        "Concrete placement labor",
        "HR",
        concreteWithWaste / confirmed.productivity_cy_per_hour,
        "concrete including waste ÷ placement productivity",
      ),
    );
  } else if (templateId === "mep_linear_run") {
    const baseRun = geometryQuantity * confirmed.parallel_runs;
    const material = baseRun * (1 + confirmed.lap_pct / 100 + confirmed.waste_pct / 100);
    outputs.push(
      quantityOutput(
        "base_run_lf",
        "Base run length",
        "LF",
        baseRun,
        "measured LF × parallel runs",
      ),
      quantityOutput(
        "material_lf",
        "Run material including laps and waste",
        "LF",
        material,
        "base run LF × (1 + lap % + waste %)",
      ),
      quantityOutput(
        "supports_ea",
        "Supports",
        "EA",
        geometryQuantity / confirmed.support_spacing_ft + 1,
        "measured LF ÷ support spacing + one end support, rounded up",
        true,
      ),
      quantityOutput(
        "labor_hours",
        "Installation labor",
        "HR",
        material / confirmed.productivity_lf_per_hour,
        "run material including laps and waste ÷ installation productivity",
      ),
    );
  } else {
    const installedFinish =
      geometryQuantity * confirmed.finish_layers * (1 + confirmed.waste_pct / 100);
    outputs.push(
      quantityOutput(
        "base_area_sf",
        "Measured surface area",
        "SF",
        geometryQuantity,
        "trusted measured SF",
      ),
      quantityOutput(
        "installed_finish_sf",
        "Finish including layers and waste",
        "SF",
        installedFinish,
        "measured SF × finish layers × (1 + waste %)",
      ),
      quantityOutput(
        "material_units_ea",
        "Material units",
        "EA",
        installedFinish / confirmed.coverage_sf_per_unit,
        "finish including layers and waste ÷ material coverage, rounded up",
        true,
      ),
      quantityOutput(
        "labor_hours",
        "Installation labor",
        "HR",
        (geometryQuantity * confirmed.finish_layers) / confirmed.productivity_sf_per_hour,
        "measured SF × finish layers ÷ installation productivity",
      ),
    );
  }

  return {
    templateId,
    formulaVersion: template.formulaVersion,
    geometryQuantity: roundHundredth(geometryQuantity),
    geometryUnit: template.geometryUnit,
    inputs: confirmed,
    outputs,
  };
}

const cleanText = (value: unknown, max = 300) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalizedEvidence = (value: string) =>
  cleanText(value, 500)
    .toLowerCase()
    .replace(/[^a-z0-9.%/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function parsedJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned no structured assembly proposal.");
  const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI returned an invalid assembly proposal.");
  }
  return value as Record<string, unknown>;
}

export function parseTakeoffAssemblyInputProposals({
  raw,
  templateId,
  citations,
}: {
  raw: string;
  templateId: TakeoffAssemblyTemplateId;
  citations: TakeoffAssemblyCitation[];
}) {
  const template = takeoffAssemblyTemplate(templateId);
  if (!template) throw new Error("Assembly template is not supported.");
  const root = parsedJsonObject(raw);
  const rawProposals = Array.isArray(root.proposals) ? root.proposals : [];
  const definitions = new Map(template.inputs.map((definition) => [definition.key, definition]));
  const citedLines = new Map(
    citations.map((citation) => [citation.source_line.toUpperCase(), citation]),
  );
  const seen = new Set<string>();
  const proposals: TakeoffAssemblyInputProposal[] = [];

  for (const candidate of rawProposals.slice(0, template.inputs.length * 2)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const inputKey = cleanText(row.input_key, 80);
    const definition = definitions.get(inputKey);
    if (!definition || seen.has(inputKey)) continue;
    const value = Number(row.value);
    if (!Number.isFinite(value) || value < definition.min || value > definition.max) continue;
    const sourceLine = cleanText(row.source_line, 12).toUpperCase();
    const citation = citedLines.get(sourceLine);
    if (!citation) continue;
    const sourceExcerpt = cleanText(row.source_excerpt, 260);
    const normalizedSource = normalizedEvidence(sourceExcerpt);
    const normalizedCitation = normalizedEvidence(citation.source_excerpt);
    const statedNumbers = sourceExcerpt.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (
      normalizedSource.length < 3 ||
      !statedNumbers.some((stated) => Math.abs(stated - value) < 0.000001) ||
      (!normalizedCitation.includes(normalizedSource) &&
        !normalizedSource.includes(normalizedCitation))
    ) {
      continue;
    }
    seen.add(inputKey);
    proposals.push({
      input_key: inputKey,
      value,
      source_line: sourceLine,
      source_excerpt: sourceExcerpt,
      reason:
        cleanText(row.reason, 240) || `The cited note names ${definition.label.toLowerCase()}.`,
    });
  }

  return proposals;
}
