// Generated from overwatch-seed-data.zip. Keep this file data-only.

export type EstimateSeedLibraryItem = {
  external_id: string;
  csi_division: string;
  csi_code: string;
  category: string;
  description: string;
  unit: string;
  material_cost_cents: number;
  labor_cost_cents: number;
  crew_size: number | null;
  productivity_per_hour: number | null;
  synonyms: string[];
  keywords: string[];
};

export type EstimateRegion = {
  code: string;
  name: string;
  description: string;
  multiplier_basis_points: number;
  multiplier_decimal: number;
};

export const ESTIMATE_SEED_LIBRARY_ITEMS: EstimateSeedLibraryItem[] = [
  {
    "external_id": "slab-4in",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "4\" Concrete Slab-on-Grade (material: concrete + base + vapor barrier)",
    "unit": "SF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "slab",
      "4\\\"",
      "4 inch",
      "4-inch",
      "4 in",
      "concrete"
    ],
    "keywords": [
      "slab",
      "4\\\"",
      "4 inch",
      "4-inch",
      "4 in",
      "concrete",
      "grade",
      "material",
      "base",
      "vapor",
      "barrier"
    ]
  },
  {
    "external_id": "slab-6in",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "6\" Concrete Slab-on-Grade (material: concrete + base + vapor barrier)",
    "unit": "SF",
    "material_cost_cents": 425,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "slab",
      "6\\\"",
      "6 inch",
      "6-inch",
      "6 in",
      "concrete"
    ],
    "keywords": [
      "slab",
      "6\\\"",
      "6 inch",
      "6-inch",
      "6 in",
      "concrete",
      "grade",
      "material",
      "base",
      "vapor",
      "barrier"
    ]
  },
  {
    "external_id": "slab-8in",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "8\" Concrete Slab-on-Grade (material: concrete + base + vapor barrier)",
    "unit": "SF",
    "material_cost_cents": 550,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "slab",
      "8\\\"",
      "8 inch",
      "8-inch",
      "8 in",
      "concrete"
    ],
    "keywords": [
      "slab",
      "8\\\"",
      "8 inch",
      "8-inch",
      "8 in",
      "concrete",
      "grade",
      "material",
      "base",
      "vapor",
      "barrier"
    ]
  },
  {
    "external_id": "slab-generic",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Slab-on-Grade (generic thickness)",
    "unit": "SF",
    "material_cost_cents": 375,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "slab",
      "on grade",
      "on-grade",
      "sog",
      "concrete"
    ],
    "keywords": [
      "slab",
      "on grade",
      "on-grade",
      "sog",
      "concrete",
      "grade",
      "generic",
      "thickness"
    ]
  },
  {
    "external_id": "footing-12x6",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Continuous Footing 12\"W  6\"D (concrete material)",
    "unit": "LF",
    "material_cost_cents": 650,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "footing",
      "12\\\"",
      "6\\\"",
      "concrete"
    ],
    "keywords": [
      "footing",
      "12\\\"",
      "6\\\"",
      "continuous",
      "concrete",
      "material"
    ]
  },
  {
    "external_id": "footing-16x8",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Continuous Footing 16\"W  8\"D (concrete material)",
    "unit": "LF",
    "material_cost_cents": 950,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "footing",
      "16\\\"",
      "8\\\"",
      "concrete"
    ],
    "keywords": [
      "footing",
      "16\\\"",
      "8\\\"",
      "continuous",
      "concrete",
      "material"
    ]
  },
  {
    "external_id": "footing-24x12",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Continuous Footing 24\"W  12\"D / WF-1 (concrete material)",
    "unit": "LF",
    "material_cost_cents": 1300,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "footing",
      "continuous",
      "wf-",
      "2'-0",
      "2'",
      "24",
      "concrete"
    ],
    "keywords": [
      "footing",
      "continuous",
      "wf-",
      "2'-0",
      "2'",
      "24",
      "concrete",
      "material"
    ]
  },
  {
    "external_id": "footing-generic",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Continuous Footing (generic, concrete material)",
    "unit": "LF",
    "material_cost_cents": 1000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "footing",
      "continuous",
      "concrete"
    ],
    "keywords": [
      "footing",
      "continuous",
      "generic",
      "concrete",
      "material"
    ]
  },
  {
    "external_id": "spread-footing",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Spread/Pad Footing (concrete material each)",
    "unit": "EA",
    "material_cost_cents": 17500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "spread footing",
      "pad footing",
      "isolated footing",
      "f-1",
      "f-2",
      "concrete"
    ],
    "keywords": [
      "spread footing",
      "pad footing",
      "isolated footing",
      "f-1",
      "f-2",
      "spread",
      "pad",
      "footing",
      "concrete",
      "material",
      "each"
    ]
  },
  {
    "external_id": "stem-wall",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Cast-in-Place Foundation Stem Wall (concrete material)",
    "unit": "LF",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "stem wall",
      "stemwall",
      "foundation wall",
      "concrete"
    ],
    "keywords": [
      "stem wall",
      "stemwall",
      "foundation wall",
      "cast",
      "place",
      "foundation",
      "stem",
      "wall",
      "concrete",
      "material"
    ]
  },
  {
    "external_id": "stem-wall-cmu",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "CMU Foundation Stem Wall (block + mortar + grout material)",
    "unit": "LF",
    "material_cost_cents": 3200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "stem wall",
      "cmu",
      "block",
      "masonry",
      "concrete"
    ],
    "keywords": [
      "stem wall",
      "cmu",
      "block",
      "masonry",
      "foundation",
      "stem",
      "wall",
      "mortar",
      "grout",
      "material",
      "concrete"
    ]
  },
  {
    "external_id": "grade-beam",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Grade Beam (concrete material)",
    "unit": "LF",
    "material_cost_cents": 1500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "grade beam",
      "concrete"
    ],
    "keywords": [
      "grade beam",
      "concrete",
      "grade",
      "beam",
      "material"
    ]
  },
  {
    "external_id": "pier-small",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Pier 12\"-16\" diameter (concrete + tube material)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pier",
      "column",
      "12\\\"",
      "14\\\"",
      "16\\\"",
      "concrete"
    ],
    "keywords": [
      "pier",
      "column",
      "12\\\"",
      "14\\\"",
      "16\\\"",
      "concrete",
      "diameter",
      "tube",
      "material"
    ]
  },
  {
    "external_id": "pier-large",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Pier 18\"-24\" diameter (concrete + tube material)",
    "unit": "EA",
    "material_cost_cents": 16500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pier",
      "column",
      "18\\\"",
      "20\\\"",
      "24\\\"",
      "concrete"
    ],
    "keywords": [
      "pier",
      "column",
      "18\\\"",
      "20\\\"",
      "24\\\"",
      "concrete",
      "diameter",
      "tube",
      "material"
    ]
  },
  {
    "external_id": "trench-pit-lf",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Trench Pit (concrete material per LF)",
    "unit": "LF",
    "material_cost_cents": 3500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "trench pit",
      "trench",
      "pit",
      "concrete"
    ],
    "keywords": [
      "trench pit",
      "trench",
      "pit",
      "concrete",
      "material",
      "per"
    ]
  },
  {
    "external_id": "trench-pit-cy",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete for Trench/Pit (ready-mix per CY)",
    "unit": "CY",
    "material_cost_cents": 17500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "trench pit",
      "trench",
      "pit",
      "concrete"
    ],
    "keywords": [
      "trench pit",
      "trench",
      "pit",
      "concrete",
      "for",
      "ready",
      "mix",
      "per"
    ]
  },
  {
    "external_id": "trench-drain-foundation",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Trench Drain Foundation (concrete material)",
    "unit": "LF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "trench drain",
      "drain foundation",
      "concrete"
    ],
    "keywords": [
      "trench drain",
      "drain foundation",
      "concrete",
      "trench",
      "drain",
      "foundation",
      "material"
    ]
  },
  {
    "external_id": "trench-drain-prefab",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Pre-fabricated Trench Drain (channel + grate material)",
    "unit": "LF",
    "material_cost_cents": 5500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "trench drain",
      "pre-fabricated",
      "prefab",
      "pre-fab",
      "concrete"
    ],
    "keywords": [
      "trench drain",
      "pre-fabricated",
      "prefab",
      "pre-fab",
      "pre",
      "fabricated",
      "trench",
      "drain",
      "channel",
      "grate",
      "material",
      "concrete"
    ]
  },
  {
    "external_id": "concrete-pit-cy",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete for Pit/Basin (ready-mix per CY)",
    "unit": "CY",
    "material_cost_cents": 17500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "correlator",
      "drainage pit",
      "catch basin",
      "sump",
      "tire seal",
      "concrete"
    ],
    "keywords": [
      "correlator",
      "drainage pit",
      "catch basin",
      "sump",
      "tire seal",
      "concrete",
      "for",
      "pit",
      "basin",
      "ready",
      "mix",
      "per"
    ]
  },
  {
    "external_id": "concrete-pit-ea",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Pit (material each)",
    "unit": "EA",
    "material_cost_cents": 85000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "correlator",
      "drainage pit",
      "catch basin",
      "sump",
      "tire seal",
      "concrete"
    ],
    "keywords": [
      "correlator",
      "drainage pit",
      "catch basin",
      "sump",
      "tire seal",
      "concrete",
      "pit",
      "material",
      "each"
    ]
  },
  {
    "external_id": "bollard-footing",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Bollard/Post Footing (concrete material each)",
    "unit": "EA",
    "material_cost_cents": 7500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "bollard",
      "post footing",
      "gate post",
      "pole foundation",
      "equipment pole",
      "concrete"
    ],
    "keywords": [
      "bollard",
      "post footing",
      "gate post",
      "pole foundation",
      "equipment pole",
      "post",
      "footing",
      "concrete",
      "material",
      "each"
    ]
  },
  {
    "external_id": "concrete-cy",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete ready-mix (per CY delivered)",
    "unit": "CY",
    "material_cost_cents": 17500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "concrete"
    ],
    "keywords": [
      "concrete",
      "ready",
      "mix",
      "per",
      "delivered"
    ]
  },
  {
    "external_id": "concrete-curb",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Curb (concrete material per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "curb",
      "concrete"
    ],
    "keywords": [
      "curb",
      "concrete",
      "material",
      "per"
    ]
  },
  {
    "external_id": "construction-joint",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "accessories",
    "description": "Construction Joint with Dowels (material)",
    "unit": "LF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "construction joint",
      "dowel",
      "sleeve",
      "accessories"
    ],
    "keywords": [
      "construction joint",
      "dowel",
      "sleeve",
      "construction",
      "joint",
      "with",
      "dowels",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "expansion-joint",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "accessories",
    "description": "Expansion Joint (filler + sealant material)",
    "unit": "LF",
    "material_cost_cents": 300,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "expansion joint",
      "compressible filler",
      "accessories"
    ],
    "keywords": [
      "expansion joint",
      "compressible filler",
      "expansion",
      "joint",
      "filler",
      "sealant",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "control-joint",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "accessories",
    "description": "Control Joint / Saw Cut (material)",
    "unit": "LF",
    "material_cost_cents": 150,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "control joint",
      "saw cut",
      "sawcut",
      "accessories"
    ],
    "keywords": [
      "control joint",
      "saw cut",
      "sawcut",
      "control",
      "joint",
      "saw",
      "cut",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "footing-step",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Footing Step (additional concrete material)",
    "unit": "EA",
    "material_cost_cents": 3500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "footing step",
      "step",
      "concrete"
    ],
    "keywords": [
      "footing step",
      "step",
      "footing",
      "additional",
      "concrete",
      "material"
    ]
  },
  {
    "external_id": "anchor-rod",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "accessories",
    "description": "Anchor Rod / Embed (hardware material)",
    "unit": "EA",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "anchor",
      "anchor rod",
      "anchor bolt",
      "embed",
      "column anchor",
      "accessories"
    ],
    "keywords": [
      "anchor",
      "anchor rod",
      "anchor bolt",
      "embed",
      "column anchor",
      "rod",
      "hardware",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "pipe-sleeve",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "accessories",
    "description": "Pipe Sleeve Through Foundation (PVC + insulation material)",
    "unit": "EA",
    "material_cost_cents": 1800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pipe sleeve",
      "sleeve",
      "penetration",
      "pvc pipe",
      "insulation",
      "accessories"
    ],
    "keywords": [
      "pipe sleeve",
      "sleeve",
      "penetration",
      "pvc pipe",
      "insulation",
      "pipe",
      "through",
      "foundation",
      "pvc",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "pipe-sleeve-lf",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "accessories",
    "description": "PVC Pipe Sleeve (material per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pipe sleeve",
      "pvc pipe",
      "pipe under",
      "accessories"
    ],
    "keywords": [
      "pipe sleeve",
      "pvc pipe",
      "pipe under",
      "pvc",
      "pipe",
      "sleeve",
      "material",
      "per",
      "accessories"
    ]
  },
  {
    "external_id": "tire-switch-indentation",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Tire Switch Indentation (form + concrete material)",
    "unit": "EA",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "tire switch",
      "tire indentation",
      "tire seal",
      "indentation",
      "concrete"
    ],
    "keywords": [
      "tire switch",
      "tire indentation",
      "tire seal",
      "indentation",
      "concrete",
      "tire",
      "switch",
      "form",
      "material"
    ]
  },
  {
    "external_id": "concrete-bollard-fill",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Fill for Bollard (ready-mix per CY)",
    "unit": "CY",
    "material_cost_cents": 17500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "bollard",
      "pipe fill",
      "concrete fill",
      "concrete"
    ],
    "keywords": [
      "bollard",
      "pipe fill",
      "concrete fill",
      "concrete",
      "fill",
      "for",
      "ready",
      "mix",
      "per"
    ]
  },
  {
    "external_id": "non-shrink-grout",
    "csi_division": "03",
    "csi_code": "03 60 00",
    "category": "accessories",
    "description": "Non-Shrink Grout at Column Anchor (material per location)",
    "unit": "EA",
    "material_cost_cents": 3500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "non-shrink grout",
      "grout",
      "column grout",
      "anchor grout",
      "accessories"
    ],
    "keywords": [
      "non-shrink grout",
      "grout",
      "column grout",
      "anchor grout",
      "non",
      "shrink",
      "column",
      "anchor",
      "material",
      "per",
      "location",
      "accessories"
    ]
  },
  {
    "external_id": "enclosure-foundation-cy",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Enclosure Foundation (concrete material per CY)",
    "unit": "CY",
    "material_cost_cents": 17500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "enclosure",
      "vacuum",
      "dumpster",
      "foundation",
      "concrete"
    ],
    "keywords": [
      "enclosure",
      "vacuum",
      "dumpster",
      "foundation",
      "concrete",
      "material",
      "per"
    ]
  },
  {
    "external_id": "formwork-footing",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork for Footings (lumber/plywood material)",
    "unit": "SFCA",
    "material_cost_cents": 350,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form",
      "footing"
    ],
    "keywords": [
      "formwork",
      "form",
      "footing",
      "for",
      "footings",
      "lumber",
      "plywood",
      "material"
    ]
  },
  {
    "external_id": "formwork-wall",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork for Walls (lumber/plywood material)",
    "unit": "SFCA",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form",
      "wall",
      "stem"
    ],
    "keywords": [
      "formwork",
      "form",
      "wall",
      "stem",
      "for",
      "walls",
      "lumber",
      "plywood",
      "material"
    ]
  },
  {
    "external_id": "formwork-slab-edge",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork for Slab Edge (lumber material)",
    "unit": "LF",
    "material_cost_cents": 275,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form",
      "slab",
      "edge"
    ],
    "keywords": [
      "formwork",
      "form",
      "slab",
      "edge",
      "for",
      "lumber",
      "material"
    ]
  },
  {
    "external_id": "formwork-pit",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork for Pits/Trenches (lumber/plywood material)",
    "unit": "SFCA",
    "material_cost_cents": 500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form",
      "pit",
      "trench"
    ],
    "keywords": [
      "formwork",
      "form",
      "pit",
      "trench",
      "for",
      "pits",
      "trenches",
      "lumber",
      "plywood",
      "material"
    ]
  },
  {
    "external_id": "formwork-pier",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork for Piers/Columns (tube/form material)",
    "unit": "SFCA",
    "material_cost_cents": 400,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form",
      "pier",
      "column",
      "sonotube"
    ],
    "keywords": [
      "formwork",
      "form",
      "pier",
      "column",
      "sonotube",
      "for",
      "piers",
      "columns",
      "tube",
      "material"
    ]
  },
  {
    "external_id": "formwork-generic",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork (generic, lumber/plywood material)",
    "unit": "SFCA",
    "material_cost_cents": 375,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form"
    ],
    "keywords": [
      "formwork",
      "form",
      "generic",
      "lumber",
      "plywood",
      "material"
    ]
  },
  {
    "external_id": "formwork-lf",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork per LF (material)",
    "unit": "LF",
    "material_cost_cents": 550,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form"
    ],
    "keywords": [
      "formwork",
      "form",
      "per",
      "material"
    ]
  },
  {
    "external_id": "formwork-ea",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "formwork",
    "description": "Formwork per EA (bollard/post form material)",
    "unit": "EA",
    "material_cost_cents": 2500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "formwork",
      "form"
    ],
    "keywords": [
      "formwork",
      "form",
      "per",
      "bollard",
      "post",
      "material"
    ]
  },
  {
    "external_id": "rebar-3",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "#3 Rebar (fabricated, delivered)",
    "unit": "LF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "#3",
      "rebar",
      "reinforc"
    ],
    "keywords": [
      "#3",
      "rebar",
      "reinforc",
      "fabricated",
      "delivered"
    ]
  },
  {
    "external_id": "rebar-4",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "#4 Rebar (fabricated, delivered)",
    "unit": "LF",
    "material_cost_cents": 115,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "#4",
      "rebar",
      "reinforc"
    ],
    "keywords": [
      "#4",
      "rebar",
      "reinforc",
      "fabricated",
      "delivered"
    ]
  },
  {
    "external_id": "rebar-5",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "#5 Rebar (fabricated, delivered)",
    "unit": "LF",
    "material_cost_cents": 150,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "#5",
      "rebar",
      "reinforc"
    ],
    "keywords": [
      "#5",
      "rebar",
      "reinforc",
      "fabricated",
      "delivered"
    ]
  },
  {
    "external_id": "rebar-6",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "#6 Rebar (fabricated, delivered)",
    "unit": "LF",
    "material_cost_cents": 200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "#6",
      "rebar",
      "reinforc"
    ],
    "keywords": [
      "#6",
      "rebar",
      "reinforc",
      "fabricated",
      "delivered"
    ]
  },
  {
    "external_id": "rebar-generic",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Rebar (generic size, fabricated delivered)",
    "unit": "LF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rebar",
      "reinforc",
      "steel"
    ],
    "keywords": [
      "rebar",
      "reinforc",
      "steel",
      "generic",
      "size",
      "fabricated",
      "delivered"
    ]
  },
  {
    "external_id": "rebar-lb",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Rebar per LB (fabricated, delivered)",
    "unit": "LB",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rebar",
      "reinforc",
      "steel"
    ],
    "keywords": [
      "rebar",
      "reinforc",
      "steel",
      "per",
      "fabricated",
      "delivered"
    ]
  },
  {
    "external_id": "rebar-ea",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Rebar cage per EA (bollard/post)",
    "unit": "EA",
    "material_cost_cents": 3500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rebar",
      "reinforc",
      "steel"
    ],
    "keywords": [
      "rebar",
      "reinforc",
      "steel",
      "cage",
      "per",
      "bollard",
      "post"
    ]
  },
  {
    "external_id": "wwf-mesh",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Welded Wire Fabric / Mesh (material)",
    "unit": "SF",
    "material_cost_cents": 35,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "mesh",
      "wwf",
      "welded wire",
      "wire fabric",
      "rebar"
    ],
    "keywords": [
      "mesh",
      "wwf",
      "welded wire",
      "wire fabric",
      "welded",
      "wire",
      "fabric",
      "material",
      "rebar"
    ]
  },
  {
    "external_id": "fiber-reinforcing",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Fiber Reinforcing (macro/micro synthetic, per SF of slab)",
    "unit": "SF",
    "material_cost_cents": 45,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fiber",
      "macro-synthetic",
      "micro-synthetic",
      "polypropylene",
      "rebar"
    ],
    "keywords": [
      "fiber",
      "macro-synthetic",
      "micro-synthetic",
      "polypropylene",
      "reinforcing",
      "macro",
      "micro",
      "synthetic",
      "per",
      "slab",
      "rebar"
    ]
  },
  {
    "external_id": "fiber-reinforcing-lb",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Fiber Reinforcing (per LB)",
    "unit": "LB",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fiber",
      "macro-synthetic",
      "micro-synthetic",
      "polypropylene",
      "rebar"
    ],
    "keywords": [
      "fiber",
      "macro-synthetic",
      "micro-synthetic",
      "polypropylene",
      "reinforcing",
      "per",
      "rebar"
    ]
  },
  {
    "external_id": "rebar-ties",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Rebar Ties/Stirrups (material)",
    "unit": "LF",
    "material_cost_cents": 75,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "ties",
      "stirrup",
      "rebar"
    ],
    "keywords": [
      "ties",
      "stirrup",
      "rebar",
      "stirrups",
      "material"
    ]
  },
  {
    "external_id": "dowels",
    "csi_division": "03",
    "csi_code": "03 20 00",
    "category": "rebar",
    "description": "Rebar Dowels (material)",
    "unit": "LF",
    "material_cost_cents": 110,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dowel",
      "rebar"
    ],
    "keywords": [
      "dowel",
      "rebar",
      "dowels",
      "material"
    ]
  },
  {
    "external_id": "vapor-barrier",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "accessories",
    "description": "Vapor Barrier (6-15 mil poly sheeting)",
    "unit": "SF",
    "material_cost_cents": 12,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vapor barrier",
      "vapor",
      "moisture barrier",
      "poly",
      "6 mil",
      "10 mil",
      "15 mil",
      "accessories"
    ],
    "keywords": [
      "vapor barrier",
      "vapor",
      "moisture barrier",
      "poly",
      "6 mil",
      "10 mil",
      "15 mil",
      "barrier",
      "mil",
      "sheeting",
      "accessories"
    ]
  },
  {
    "external_id": "base-course-sf",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "accessories",
    "description": "Compacted Base Course 4\"-6\" (aggregate material per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "base course",
      "compacted base",
      "crushed stone",
      "aggregate base",
      "abc",
      "accessories"
    ],
    "keywords": [
      "base course",
      "compacted base",
      "crushed stone",
      "aggregate base",
      "abc",
      "compacted",
      "base",
      "course",
      "aggregate",
      "material",
      "per",
      "accessories"
    ]
  },
  {
    "external_id": "base-course-ea",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "accessories",
    "description": "Compacted Base Course (lump material for small area)",
    "unit": "EA",
    "material_cost_cents": 12500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "base course",
      "compacted base",
      "accessories"
    ],
    "keywords": [
      "base course",
      "compacted base",
      "compacted",
      "base",
      "course",
      "lump",
      "material",
      "for",
      "small",
      "area",
      "accessories"
    ]
  },
  {
    "external_id": "base-course-ls",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "accessories",
    "description": "Compacted Base Course (lump sum)",
    "unit": "LS",
    "material_cost_cents": 50000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "base course",
      "compacted base",
      "accessories"
    ],
    "keywords": [
      "base course",
      "compacted base",
      "compacted",
      "base",
      "course",
      "lump",
      "sum",
      "accessories"
    ]
  },
  {
    "external_id": "curing-compound",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "accessories",
    "description": "Curing Compound (material)",
    "unit": "SF",
    "material_cost_cents": 12,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "curing",
      "cure",
      "compound",
      "accessories"
    ],
    "keywords": [
      "curing",
      "cure",
      "compound",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "concrete-sealer",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "accessories",
    "description": "Concrete Sealer (material)",
    "unit": "SF",
    "material_cost_cents": 25,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sealer",
      "seal",
      "accessories"
    ],
    "keywords": [
      "sealer",
      "seal",
      "concrete",
      "material",
      "accessories"
    ]
  },
  {
    "external_id": "excavation-footing",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Excavation for Foundations (equipment cost per CY)",
    "unit": "CY",
    "material_cost_cents": 1200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "excavation",
      "excavat",
      "dig",
      "trench",
      "earthwork"
    ],
    "keywords": [
      "excavation",
      "excavat",
      "dig",
      "trench",
      "for",
      "foundations",
      "equipment",
      "cost",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "excavation-pit",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Excavation for Pits (equipment cost per CY)",
    "unit": "CY",
    "material_cost_cents": 1500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "excavation",
      "excavat",
      "pit",
      "earthwork"
    ],
    "keywords": [
      "excavation",
      "excavat",
      "pit",
      "for",
      "pits",
      "equipment",
      "cost",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "excavation-ea",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Excavation per EA (small footing)",
    "unit": "EA",
    "material_cost_cents": 12500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "excavation",
      "excavat",
      "earthwork"
    ],
    "keywords": [
      "excavation",
      "excavat",
      "per",
      "small",
      "footing",
      "earthwork"
    ]
  },
  {
    "external_id": "backfill-cy",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Backfill (material + equipment per CY)",
    "unit": "CY",
    "material_cost_cents": 1000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "backfill",
      "fill",
      "earthwork"
    ],
    "keywords": [
      "backfill",
      "fill",
      "material",
      "equipment",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "backfill-ea",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Backfill per EA (small footing)",
    "unit": "EA",
    "material_cost_cents": 3500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "backfill",
      "earthwork"
    ],
    "keywords": [
      "backfill",
      "per",
      "small",
      "footing",
      "earthwork"
    ]
  },
  {
    "external_id": "compaction",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Compaction (equipment cost per CY)",
    "unit": "CY",
    "material_cost_cents": 400,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "compact",
      "compaction",
      "earthwork"
    ],
    "keywords": [
      "compact",
      "compaction",
      "equipment",
      "cost",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "grading",
    "csi_division": "31",
    "csi_code": "31 22 00",
    "category": "earthwork",
    "description": "Grading (equipment cost per SF)",
    "unit": "SF",
    "material_cost_cents": 40,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "grading",
      "grade",
      "fine grade",
      "rough grade",
      "earthwork"
    ],
    "keywords": [
      "grading",
      "grade",
      "fine grade",
      "rough grade",
      "equipment",
      "cost",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "subgrade-prep",
    "csi_division": "31",
    "csi_code": "31 20 00",
    "category": "earthwork",
    "description": "Subgrade Preparation (equipment cost per SF)",
    "unit": "SF",
    "material_cost_cents": 40,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "subgrade",
      "sub-grade",
      "preparation",
      "earthwork"
    ],
    "keywords": [
      "subgrade",
      "sub-grade",
      "preparation",
      "equipment",
      "cost",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "base-course-31",
    "csi_division": "31",
    "csi_code": "31 20 00",
    "category": "earthwork",
    "description": "Compacted Base Course (aggregate material per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "base course",
      "compacted base",
      "crushed stone",
      "aggregate base",
      "earthwork"
    ],
    "keywords": [
      "base course",
      "compacted base",
      "crushed stone",
      "aggregate base",
      "compacted",
      "base",
      "course",
      "aggregate",
      "material",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "vapor-barrier-31",
    "csi_division": "31",
    "csi_code": "31 20 00",
    "category": "earthwork",
    "description": "Vapor Barrier (poly sheeting material)",
    "unit": "SF",
    "material_cost_cents": 12,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vapor barrier",
      "vapor",
      "moisture barrier",
      "poly",
      "earthwork"
    ],
    "keywords": [
      "vapor barrier",
      "vapor",
      "moisture barrier",
      "poly",
      "barrier",
      "sheeting",
      "material",
      "earthwork"
    ]
  },
  {
    "external_id": "dewatering",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Dewatering (equipment rental lump sum)",
    "unit": "LS",
    "material_cost_cents": 150000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dewater",
      "pump",
      "earthwork"
    ],
    "keywords": [
      "dewater",
      "pump",
      "dewatering",
      "equipment",
      "rental",
      "lump",
      "sum",
      "earthwork"
    ]
  },
  {
    "external_id": "hauling-disposal",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Hauling & Disposal (trucking + dump fees per CY)",
    "unit": "CY",
    "material_cost_cents": 1800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "haul",
      "disposal",
      "spoil",
      "waste",
      "earthwork"
    ],
    "keywords": [
      "haul",
      "disposal",
      "spoil",
      "waste",
      "hauling",
      "trucking",
      "dump",
      "fees",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "geotextile-fabric",
    "csi_division": "31",
    "csi_code": "31 05 19",
    "category": "earthwork",
    "description": "Geotextile Fabric (separation/filter fabric material per SF)",
    "unit": "SF",
    "material_cost_cents": 60,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "geotextile",
      "filter fabric",
      "woven fabric",
      "non-woven",
      "separation fabric",
      "earthwork"
    ],
    "keywords": [
      "geotextile",
      "filter fabric",
      "woven fabric",
      "non-woven",
      "separation fabric",
      "fabric",
      "separation",
      "filter",
      "material",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "erosion-control",
    "csi_division": "31",
    "csi_code": "31 25 00",
    "category": "earthwork",
    "description": "Erosion Control (silt fence material per LF)",
    "unit": "LF",
    "material_cost_cents": 250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "erosion control",
      "silt fence",
      "hay bale",
      "straw wattle",
      "earthwork"
    ],
    "keywords": [
      "erosion control",
      "silt fence",
      "hay bale",
      "straw wattle",
      "erosion",
      "control",
      "silt",
      "fence",
      "material",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "demolition-concrete",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "demolition",
    "description": "Concrete Demolition (equipment cost per SF)",
    "unit": "SF",
    "material_cost_cents": 250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "demolition",
      "demo",
      "remove",
      "concrete"
    ],
    "keywords": [
      "demolition",
      "demo",
      "remove",
      "concrete",
      "equipment",
      "cost",
      "per"
    ]
  },
  {
    "external_id": "demolition-cy",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "demolition",
    "description": "Demolition per CY (equipment cost)",
    "unit": "CY",
    "material_cost_cents": 4000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "demolition",
      "demo",
      "remove"
    ],
    "keywords": [
      "demolition",
      "demo",
      "remove",
      "per",
      "equipment",
      "cost"
    ]
  },
  {
    "external_id": "clearing",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "demolition",
    "description": "Site Clearing (equipment cost per SF)",
    "unit": "SF",
    "material_cost_cents": 20,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "clearing",
      "grubbing",
      "clear",
      "demolition"
    ],
    "keywords": [
      "clearing",
      "grubbing",
      "clear",
      "site",
      "equipment",
      "cost",
      "per",
      "demolition"
    ]
  },
  {
    "external_id": "asphalt-paving",
    "csi_division": "32",
    "csi_code": "32 12 00",
    "category": "exterior",
    "description": "Asphalt Paving (material per SF)",
    "unit": "SF",
    "material_cost_cents": 250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "asphalt",
      "paving",
      "blacktop",
      "exterior"
    ],
    "keywords": [
      "asphalt",
      "paving",
      "blacktop",
      "material",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "concrete-sidewalk",
    "csi_division": "32",
    "csi_code": "32 13 00",
    "category": "exterior",
    "description": "Concrete Sidewalk (material per SF)",
    "unit": "SF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sidewalk",
      "walkway",
      "exterior"
    ],
    "keywords": [
      "sidewalk",
      "walkway",
      "concrete",
      "material",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "curb-exterior",
    "csi_division": "32",
    "csi_code": "32 16 00",
    "category": "exterior",
    "description": "Concrete Curb (material per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "curb",
      "curbing",
      "exterior"
    ],
    "keywords": [
      "curb",
      "curbing",
      "concrete",
      "material",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "expansion-joint-ext",
    "csi_division": "32",
    "csi_code": "32 13 00",
    "category": "exterior",
    "description": "Expansion Joint (filler material per LF)",
    "unit": "LF",
    "material_cost_cents": 250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "expansion joint",
      "compressible filler",
      "joint",
      "exterior"
    ],
    "keywords": [
      "expansion joint",
      "compressible filler",
      "joint",
      "expansion",
      "filler",
      "material",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "temp-fence",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Temporary Chain Link Fence (material per LF)",
    "unit": "LF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "temporary fence",
      "temp fence",
      "chain link fence temp",
      "general"
    ],
    "keywords": [
      "temporary fence",
      "temp fence",
      "chain link fence temp",
      "temporary",
      "chain",
      "link",
      "fence",
      "material",
      "per",
      "general"
    ]
  },
  {
    "external_id": "temp-toilet",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Portable Toilet Rental (per month)",
    "unit": "MO",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "portable toilet",
      "porta potty",
      "temporary toilet",
      "sanitary facility",
      "general"
    ],
    "keywords": [
      "portable toilet",
      "porta potty",
      "temporary toilet",
      "sanitary facility",
      "portable",
      "toilet",
      "rental",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "temp-power",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Temporary Power Service (per month)",
    "unit": "MO",
    "material_cost_cents": 35000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "temporary power",
      "temp power",
      "construction power",
      "general"
    ],
    "keywords": [
      "temporary power",
      "temp power",
      "construction power",
      "temporary",
      "power",
      "service",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "temp-water",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Temporary Water Service (per month)",
    "unit": "MO",
    "material_cost_cents": 12000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "temporary water",
      "temp water",
      "construction water",
      "general"
    ],
    "keywords": [
      "temporary water",
      "temp water",
      "construction water",
      "temporary",
      "water",
      "service",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "dumpster",
    "csi_division": "01",
    "csi_code": "01 74 00",
    "category": "general",
    "description": "Dumpster Rental/Haul (per pull)",
    "unit": "EA",
    "material_cost_cents": 45000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dumpster",
      "debris box",
      "waste container",
      "trash haul",
      "general"
    ],
    "keywords": [
      "dumpster",
      "debris box",
      "waste container",
      "trash haul",
      "rental",
      "haul",
      "per",
      "pull",
      "general"
    ]
  },
  {
    "external_id": "construction-sign",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Construction Sign (material per EA)",
    "unit": "EA",
    "material_cost_cents": 27500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "construction sign",
      "project sign",
      "job sign",
      "general"
    ],
    "keywords": [
      "construction sign",
      "project sign",
      "job sign",
      "construction",
      "sign",
      "material",
      "per",
      "general"
    ]
  },
  {
    "external_id": "safety-netting",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Safety/Debris Netting (material per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "safety net",
      "debris net",
      "fall protection net",
      "general"
    ],
    "keywords": [
      "safety net",
      "debris net",
      "fall protection net",
      "safety",
      "debris",
      "netting",
      "material",
      "per",
      "general"
    ]
  },
  {
    "external_id": "barricade",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Concrete Barricade/K-Rail (material per LF)",
    "unit": "LF",
    "material_cost_cents": 1800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "barricade",
      "jersey barrier",
      "concrete barrier",
      "k-rail",
      "general"
    ],
    "keywords": [
      "barricade",
      "jersey barrier",
      "concrete barrier",
      "k-rail",
      "concrete",
      "rail",
      "material",
      "per",
      "general"
    ]
  },
  {
    "external_id": "cmu-8in",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "8\" CMU Block Wall (material per SF)",
    "unit": "SF",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "cmu",
      "concrete masonry",
      "block wall",
      "8\\\" block",
      "8 inch block",
      "concrete block",
      "masonry"
    ],
    "keywords": [
      "cmu",
      "concrete masonry",
      "block wall",
      "8\\\" block",
      "8 inch block",
      "concrete block",
      "block",
      "wall",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "cmu-12in",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "12\" CMU Block Wall (material per SF)",
    "unit": "SF",
    "material_cost_cents": 525,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "12\\\" cmu",
      "12 inch block",
      "12\\\" block",
      "masonry"
    ],
    "keywords": [
      "12\\\" cmu",
      "12 inch block",
      "12\\\" block",
      "cmu",
      "block",
      "wall",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "cmu-6in",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "6\" CMU Block Wall (material per SF)",
    "unit": "SF",
    "material_cost_cents": 310,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "6\\\" cmu",
      "6 inch block",
      "6\\\" block",
      "masonry"
    ],
    "keywords": [
      "6\\\" cmu",
      "6 inch block",
      "6\\\" block",
      "cmu",
      "block",
      "wall",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "brick-veneer",
    "csi_division": "04",
    "csi_code": "04 21 00",
    "category": "masonry",
    "description": "Brick Veneer (material per SF)",
    "unit": "SF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "brick veneer",
      "face brick",
      "brick wall",
      "brick facade",
      "masonry"
    ],
    "keywords": [
      "brick veneer",
      "face brick",
      "brick wall",
      "brick facade",
      "brick",
      "veneer",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "mortar",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Mortar/Grout (material per CF)",
    "unit": "CF",
    "material_cost_cents": 1200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "mortar",
      "grout",
      "masonry grout",
      "masonry"
    ],
    "keywords": [
      "mortar",
      "grout",
      "masonry grout",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "masonry-reinforcing",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Masonry Joint Reinforcing (material per LF)",
    "unit": "LF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "masonry reinforc",
      "horizontal rebar",
      "joint reinforc",
      "ladder wire",
      "masonry"
    ],
    "keywords": [
      "masonry reinforc",
      "horizontal rebar",
      "joint reinforc",
      "ladder wire",
      "masonry",
      "joint",
      "reinforcing",
      "material",
      "per"
    ]
  },
  {
    "external_id": "cmu-fill-grout",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "CMU Cell Grout Fill (material per CF)",
    "unit": "CF",
    "material_cost_cents": 1450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "cmu fill",
      "grout fill",
      "solid grout",
      "fill cells",
      "masonry"
    ],
    "keywords": [
      "cmu fill",
      "grout fill",
      "solid grout",
      "fill cells",
      "cmu",
      "cell",
      "grout",
      "fill",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "stone-veneer",
    "csi_division": "04",
    "csi_code": "04 43 00",
    "category": "masonry",
    "description": "Stone Veneer (material per SF)",
    "unit": "SF",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "stone veneer",
      "natural stone",
      "cultured stone",
      "stone cladding",
      "masonry"
    ],
    "keywords": [
      "stone veneer",
      "natural stone",
      "cultured stone",
      "stone cladding",
      "stone",
      "veneer",
      "material",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "lintel",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Steel Lintel for Masonry (material per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lintel",
      "masonry lintel",
      "steel lintel",
      "masonry"
    ],
    "keywords": [
      "lintel",
      "masonry lintel",
      "steel lintel",
      "steel",
      "for",
      "masonry",
      "material",
      "per"
    ]
  },
  {
    "external_id": "structural-steel",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Structural Steel (material per LB)",
    "unit": "LB",
    "material_cost_cents": 145,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "structural steel",
      "wide flange",
      "w-beam",
      "steel beam",
      "steel column",
      "hss",
      "metals"
    ],
    "keywords": [
      "structural steel",
      "wide flange",
      "w-beam",
      "steel beam",
      "steel column",
      "hss",
      "structural",
      "steel",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "steel-joist",
    "csi_division": "05",
    "csi_code": "05 21 00",
    "category": "metals",
    "description": "Steel Joist (material per LB)",
    "unit": "LB",
    "material_cost_cents": 165,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "steel joist",
      "open web joist",
      "bar joist",
      "lh joist",
      "dlh joist",
      "metals"
    ],
    "keywords": [
      "steel joist",
      "open web joist",
      "bar joist",
      "lh joist",
      "dlh joist",
      "steel",
      "joist",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "metal-deck",
    "csi_division": "05",
    "csi_code": "05 31 00",
    "category": "metals",
    "description": "Metal Deck (material per SF)",
    "unit": "SF",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal deck",
      "steel deck",
      "roof deck",
      "floor deck",
      "composite deck",
      "metals"
    ],
    "keywords": [
      "metal deck",
      "steel deck",
      "roof deck",
      "floor deck",
      "composite deck",
      "metal",
      "deck",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "steel-stud-framing",
    "csi_division": "05",
    "csi_code": "05 41 00",
    "category": "metals",
    "description": "Light Gauge Steel Stud Framing (material per SF)",
    "unit": "SF",
    "material_cost_cents": 225,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "steel stud",
      "metal stud",
      "light gauge",
      "cold formed",
      "metals"
    ],
    "keywords": [
      "steel stud",
      "metal stud",
      "light gauge",
      "cold formed",
      "light",
      "gauge",
      "steel",
      "stud",
      "framing",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "anchor-bolt",
    "csi_division": "05",
    "csi_code": "05 05 00",
    "category": "metals",
    "description": "Anchor Bolt (material per EA)",
    "unit": "EA",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "anchor bolt",
      "anchor rod",
      "embed",
      "cast-in anchor",
      "metals"
    ],
    "keywords": [
      "anchor bolt",
      "anchor rod",
      "embed",
      "cast-in anchor",
      "anchor",
      "bolt",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "steel-angle",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Steel Angle (material per LB)",
    "unit": "LB",
    "material_cost_cents": 135,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "steel angle",
      "angle iron",
      "angle support",
      "metals"
    ],
    "keywords": [
      "steel angle",
      "angle iron",
      "angle support",
      "steel",
      "angle",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "steel-plate",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Steel Plate (material per LB)",
    "unit": "LB",
    "material_cost_cents": 155,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "steel plate",
      "base plate",
      "bearing plate",
      "gusset plate",
      "metals"
    ],
    "keywords": [
      "steel plate",
      "base plate",
      "bearing plate",
      "gusset plate",
      "steel",
      "plate",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "metal-railing",
    "csi_division": "05",
    "csi_code": "05 52 00",
    "category": "metals",
    "description": "Metal Pipe Railing (material per LF)",
    "unit": "LF",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal railing",
      "steel railing",
      "pipe railing",
      "handrail",
      "guardrail",
      "metals"
    ],
    "keywords": [
      "metal railing",
      "steel railing",
      "pipe railing",
      "handrail",
      "guardrail",
      "metal",
      "pipe",
      "railing",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "metal-stair",
    "csi_division": "05",
    "csi_code": "05 51 00",
    "category": "metals",
    "description": "Metal Stair (material per riser)",
    "unit": "RISER",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal stair",
      "steel stair",
      "prefab stair",
      "metals"
    ],
    "keywords": [
      "metal stair",
      "steel stair",
      "prefab stair",
      "metal",
      "stair",
      "material",
      "per",
      "riser",
      "metals"
    ]
  },
  {
    "external_id": "grating",
    "csi_division": "05",
    "csi_code": "05 53 00",
    "category": "metals",
    "description": "Steel Bar Grating (material per SF)",
    "unit": "SF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "grating",
      "bar grating",
      "steel grating",
      "floor grating",
      "metals"
    ],
    "keywords": [
      "grating",
      "bar grating",
      "steel grating",
      "floor grating",
      "steel",
      "bar",
      "material",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "lumber-framing",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Framing Lumber (material per BF)",
    "unit": "BF",
    "material_cost_cents": 115,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lumber",
      "wood framing",
      "stud framing",
      "2x4",
      "2x6",
      "2x8",
      "dimensional lumber",
      "wood"
    ],
    "keywords": [
      "lumber",
      "wood framing",
      "stud framing",
      "2x4",
      "2x6",
      "2x8",
      "dimensional lumber",
      "framing",
      "material",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "plywood-sheathing",
    "csi_division": "06",
    "csi_code": "06 16 00",
    "category": "wood",
    "description": "Plywood/OSB Sheathing (material per SF)",
    "unit": "SF",
    "material_cost_cents": 145,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "plywood",
      "sheathing",
      "osb",
      "oriented strand board",
      "wood"
    ],
    "keywords": [
      "plywood",
      "sheathing",
      "osb",
      "oriented strand board",
      "material",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "engineered-lumber",
    "csi_division": "06",
    "csi_code": "06 17 00",
    "category": "wood",
    "description": "Engineered Lumber/LVL (material per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lvl",
      "lsl",
      "psl",
      "engineered lumber",
      "laminated veneer",
      "glulam",
      "glued laminated",
      "wood"
    ],
    "keywords": [
      "lvl",
      "lsl",
      "psl",
      "engineered lumber",
      "laminated veneer",
      "glulam",
      "glued laminated",
      "engineered",
      "lumber",
      "material",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "wood-blocking",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Wood Blocking/Nailer (material per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "blocking",
      "wood blocking",
      "nailer",
      "wood nailer",
      "wood"
    ],
    "keywords": [
      "blocking",
      "wood blocking",
      "nailer",
      "wood nailer",
      "wood",
      "material",
      "per"
    ]
  },
  {
    "external_id": "wood-trusses",
    "csi_division": "06",
    "csi_code": "06 17 53",
    "category": "wood",
    "description": "Wood Roof/Floor Truss (material per SF)",
    "unit": "SF",
    "material_cost_cents": 425,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood truss",
      "roof truss",
      "floor truss",
      "pre-engineered truss",
      "wood"
    ],
    "keywords": [
      "wood truss",
      "roof truss",
      "floor truss",
      "pre-engineered truss",
      "wood",
      "roof",
      "floor",
      "truss",
      "material",
      "per"
    ]
  },
  {
    "external_id": "wood-decking",
    "csi_division": "06",
    "csi_code": "06 15 00",
    "category": "wood",
    "description": "Wood Decking (material per SF)",
    "unit": "SF",
    "material_cost_cents": 650,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood decking",
      "timber decking",
      "heavy timber deck",
      "wood"
    ],
    "keywords": [
      "wood decking",
      "timber decking",
      "heavy timber deck",
      "wood",
      "decking",
      "material",
      "per"
    ]
  },
  {
    "external_id": "finish-carpentry",
    "csi_division": "06",
    "csi_code": "06 22 00",
    "category": "wood",
    "description": "Finish Carpentry/Trim (material per LF)",
    "unit": "LF",
    "material_cost_cents": 350,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "finish carpentry",
      "trim",
      "millwork",
      "casing",
      "base molding",
      "wood"
    ],
    "keywords": [
      "finish carpentry",
      "trim",
      "millwork",
      "casing",
      "base molding",
      "finish",
      "carpentry",
      "material",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "wood-door-frame",
    "csi_division": "06",
    "csi_code": "06 22 00",
    "category": "wood",
    "description": "Wood Door Frame (material per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "door frame",
      "door buck",
      "wood door frame",
      "wood"
    ],
    "keywords": [
      "door frame",
      "door buck",
      "wood door frame",
      "wood",
      "door",
      "frame",
      "material",
      "per"
    ]
  },
  {
    "external_id": "batt-insulation",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Batt Insulation (material per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "batt insulation",
      "fiberglass batt",
      "r-13",
      "r-19",
      "r-21",
      "r-30",
      "r-38",
      "wall insulation",
      "thermal"
    ],
    "keywords": [
      "batt insulation",
      "fiberglass batt",
      "r-13",
      "r-19",
      "r-21",
      "r-30",
      "r-38",
      "wall insulation",
      "batt",
      "insulation",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "rigid-insulation",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Rigid Foam Insulation (material per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rigid insulation",
      "foam board",
      "xps",
      "eps",
      "polyiso",
      "rigid foam",
      "thermal"
    ],
    "keywords": [
      "rigid insulation",
      "foam board",
      "xps",
      "eps",
      "polyiso",
      "rigid foam",
      "rigid",
      "foam",
      "insulation",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "spray-foam",
    "csi_division": "07",
    "csi_code": "07 21 29",
    "category": "thermal",
    "description": "Spray Foam Insulation (material per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "spray foam",
      "spray polyurethane",
      "spf",
      "closed cell",
      "open cell foam",
      "thermal"
    ],
    "keywords": [
      "spray foam",
      "spray polyurethane",
      "spf",
      "closed cell",
      "open cell foam",
      "spray",
      "foam",
      "insulation",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "waterproofing-membrane",
    "csi_division": "07",
    "csi_code": "07 13 00",
    "category": "thermal",
    "description": "Waterproofing Membrane (material per SF)",
    "unit": "SF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "waterproofing",
      "waterproof membrane",
      "below grade waterproof",
      "foundation waterproof",
      "thermal"
    ],
    "keywords": [
      "waterproofing",
      "waterproof membrane",
      "below grade waterproof",
      "foundation waterproof",
      "membrane",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "roofing-tpo",
    "csi_division": "07",
    "csi_code": "07 54 00",
    "category": "thermal",
    "description": "TPO Roofing Membrane (material per SF)",
    "unit": "SF",
    "material_cost_cents": 225,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "tpo",
      "tpo roofing",
      "thermoplastic roofing",
      "single ply roof",
      "thermal"
    ],
    "keywords": [
      "tpo",
      "tpo roofing",
      "thermoplastic roofing",
      "single ply roof",
      "roofing",
      "membrane",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "roofing-epdm",
    "csi_division": "07",
    "csi_code": "07 53 00",
    "category": "thermal",
    "description": "EPDM Roofing Membrane (material per SF)",
    "unit": "SF",
    "material_cost_cents": 195,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "epdm",
      "epdm roofing",
      "rubber roofing",
      "thermal"
    ],
    "keywords": [
      "epdm",
      "epdm roofing",
      "rubber roofing",
      "roofing",
      "membrane",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "roofing-asphalt-shingle",
    "csi_division": "07",
    "csi_code": "07 31 13",
    "category": "thermal",
    "description": "Asphalt Shingles (material per SQ = 100 SF)",
    "unit": "SQ",
    "material_cost_cents": 14500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "asphalt shingle",
      "composition shingle",
      "shingle roofing",
      "architectural shingle",
      "thermal"
    ],
    "keywords": [
      "asphalt shingle",
      "composition shingle",
      "shingle roofing",
      "architectural shingle",
      "asphalt",
      "shingles",
      "material",
      "per",
      "100",
      "thermal"
    ]
  },
  {
    "external_id": "roofing-metal",
    "csi_division": "07",
    "csi_code": "07 41 00",
    "category": "thermal",
    "description": "Metal Roofing (material per SF)",
    "unit": "SF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal roofing",
      "standing seam",
      "metal roof panel",
      "corrugated metal roof",
      "thermal"
    ],
    "keywords": [
      "metal roofing",
      "standing seam",
      "metal roof panel",
      "corrugated metal roof",
      "metal",
      "roofing",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "flashing",
    "csi_division": "07",
    "csi_code": "07 62 00",
    "category": "thermal",
    "description": "Sheet Metal Flashing (material per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "flashing",
      "sheet metal flashing",
      "counterflashing",
      "base flashing",
      "thermal"
    ],
    "keywords": [
      "flashing",
      "sheet metal flashing",
      "counterflashing",
      "base flashing",
      "sheet",
      "metal",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "vapor-retarder",
    "csi_division": "07",
    "csi_code": "07 26 00",
    "category": "thermal",
    "description": "Vapor Retarder/Poly Sheeting (material per SF)",
    "unit": "SF",
    "material_cost_cents": 18,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vapor barrier",
      "vapor retarder",
      "poly sheeting",
      "6 mil poly",
      "thermal"
    ],
    "keywords": [
      "vapor barrier",
      "vapor retarder",
      "poly sheeting",
      "6 mil poly",
      "vapor",
      "retarder",
      "poly",
      "sheeting",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "building-wrap",
    "csi_division": "07",
    "csi_code": "07 25 00",
    "category": "thermal",
    "description": "Building Wrap/House Wrap (material per SF)",
    "unit": "SF",
    "material_cost_cents": 22,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "building wrap",
      "house wrap",
      "weather barrier",
      "tyvek",
      "thermal"
    ],
    "keywords": [
      "building wrap",
      "house wrap",
      "weather barrier",
      "tyvek",
      "building",
      "wrap",
      "house",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "sealant-caulk",
    "csi_division": "07",
    "csi_code": "07 92 00",
    "category": "thermal",
    "description": "Joint Sealant/Caulk (material per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sealant",
      "caulk",
      "joint sealant",
      "silicone sealant",
      "urethane sealant",
      "thermal"
    ],
    "keywords": [
      "sealant",
      "caulk",
      "joint sealant",
      "silicone sealant",
      "urethane sealant",
      "joint",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "roof-drain",
    "csi_division": "07",
    "csi_code": "07 72 00",
    "category": "thermal",
    "description": "Roof Drain (material per EA)",
    "unit": "EA",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "roof drain",
      "overflow drain",
      "area drain",
      "thermal"
    ],
    "keywords": [
      "roof drain",
      "overflow drain",
      "area drain",
      "roof",
      "drain",
      "material",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "hollow-metal-door",
    "csi_division": "08",
    "csi_code": "08 11 13",
    "category": "openings",
    "description": "Hollow Metal Door (material per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hollow metal door",
      "hm door",
      "steel door",
      "metal door",
      "openings"
    ],
    "keywords": [
      "hollow metal door",
      "hm door",
      "steel door",
      "metal door",
      "hollow",
      "metal",
      "door",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "wood-door",
    "csi_division": "08",
    "csi_code": "08 14 00",
    "category": "openings",
    "description": "Wood Flush Door (material per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood door",
      "solid core door",
      "flush door",
      "interior door",
      "openings"
    ],
    "keywords": [
      "wood door",
      "solid core door",
      "flush door",
      "interior door",
      "wood",
      "flush",
      "door",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "storefront",
    "csi_division": "08",
    "csi_code": "08 44 00",
    "category": "openings",
    "description": "Aluminum Storefront System (material per SF)",
    "unit": "SF",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "storefront",
      "curtain wall",
      "aluminum storefront",
      "glass storefront",
      "openings"
    ],
    "keywords": [
      "storefront",
      "curtain wall",
      "aluminum storefront",
      "glass storefront",
      "aluminum",
      "system",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "aluminum-window",
    "csi_division": "08",
    "csi_code": "08 51 13",
    "category": "openings",
    "description": "Aluminum Window (material per SF)",
    "unit": "SF",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "aluminum window",
      "window",
      "casement window",
      "double hung",
      "fixed window",
      "openings"
    ],
    "keywords": [
      "aluminum window",
      "window",
      "casement window",
      "double hung",
      "fixed window",
      "aluminum",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "overhead-door",
    "csi_division": "08",
    "csi_code": "08 36 13",
    "category": "openings",
    "description": "Overhead Sectional Door (material per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "overhead door",
      "garage door",
      "roll-up door",
      "sectional door",
      "openings"
    ],
    "keywords": [
      "overhead door",
      "garage door",
      "roll-up door",
      "sectional door",
      "overhead",
      "sectional",
      "door",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "door-hardware",
    "csi_division": "08",
    "csi_code": "08 71 00",
    "category": "openings",
    "description": "Door Hardware Set (material per EA)",
    "unit": "EA",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "door hardware",
      "lockset",
      "door knob",
      "lever handle",
      "panic bar",
      "exit device",
      "openings"
    ],
    "keywords": [
      "door hardware",
      "lockset",
      "door knob",
      "lever handle",
      "panic bar",
      "exit device",
      "door",
      "hardware",
      "set",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "door-frame-hm",
    "csi_division": "08",
    "csi_code": "08 11 13",
    "category": "openings",
    "description": "Hollow Metal Door Frame (material per EA)",
    "unit": "EA",
    "material_cost_cents": 22500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hollow metal frame",
      "hm frame",
      "steel door frame",
      "metal door frame",
      "openings"
    ],
    "keywords": [
      "hollow metal frame",
      "hm frame",
      "steel door frame",
      "metal door frame",
      "hollow",
      "metal",
      "door",
      "frame",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "glass-glazing",
    "csi_division": "08",
    "csi_code": "08 81 00",
    "category": "openings",
    "description": "Insulated Glass Unit (material per SF)",
    "unit": "SF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "glass",
      "glazing",
      "insulated glass",
      "igi",
      "tempered glass",
      "laminated glass",
      "openings"
    ],
    "keywords": [
      "glass",
      "glazing",
      "insulated glass",
      "igi",
      "tempered glass",
      "laminated glass",
      "insulated",
      "unit",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "skylight",
    "csi_division": "08",
    "csi_code": "08 62 00",
    "category": "openings",
    "description": "Skylight Unit (material per EA)",
    "unit": "EA",
    "material_cost_cents": 85000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "skylight",
      "roof window",
      "roof light",
      "openings"
    ],
    "keywords": [
      "skylight",
      "roof window",
      "roof light",
      "unit",
      "material",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "drywall-5-8",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "5/8\" Gypsum Wallboard (material per SF)",
    "unit": "SF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "drywall",
      "gypsum board",
      "gypsum wallboard",
      "gwb",
      "sheetrock",
      "5/8",
      "finishes"
    ],
    "keywords": [
      "drywall",
      "gypsum board",
      "gypsum wallboard",
      "gwb",
      "sheetrock",
      "5/8",
      "gypsum",
      "wallboard",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "drywall-1-2",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "1/2\" Gypsum Wallboard (material per SF)",
    "unit": "SF",
    "material_cost_cents": 52,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "1/2\\\" drywall",
      "1/2 inch drywall",
      "half inch drywall",
      "finishes"
    ],
    "keywords": [
      "1/2\\\" drywall",
      "1/2 inch drywall",
      "half inch drywall",
      "gypsum",
      "wallboard",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "ceramic-tile",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Ceramic Tile (material per SF)",
    "unit": "SF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "ceramic tile",
      "floor tile",
      "wall tile",
      "tile",
      "finishes"
    ],
    "keywords": [
      "ceramic tile",
      "floor tile",
      "wall tile",
      "tile",
      "ceramic",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "porcelain-tile",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Porcelain Tile (material per SF)",
    "unit": "SF",
    "material_cost_cents": 750,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "porcelain tile",
      "porcelain floor",
      "large format tile",
      "finishes"
    ],
    "keywords": [
      "porcelain tile",
      "porcelain floor",
      "large format tile",
      "porcelain",
      "tile",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "carpet",
    "csi_division": "09",
    "csi_code": "09 68 00",
    "category": "finishes",
    "description": "Carpet (material per SY)",
    "unit": "SY",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "carpet",
      "broadloom",
      "carpet tile",
      "carpet flooring",
      "finishes"
    ],
    "keywords": [
      "carpet",
      "broadloom",
      "carpet tile",
      "carpet flooring",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "vct",
    "csi_division": "09",
    "csi_code": "09 65 13",
    "category": "finishes",
    "description": "VCT Flooring (material per SF)",
    "unit": "SF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vct",
      "vinyl composition tile",
      "vinyl tile",
      "finishes"
    ],
    "keywords": [
      "vct",
      "vinyl composition tile",
      "vinyl tile",
      "flooring",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "lvp-flooring",
    "csi_division": "09",
    "csi_code": "09 65 00",
    "category": "finishes",
    "description": "Luxury Vinyl Plank (material per SF)",
    "unit": "SF",
    "material_cost_cents": 350,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lvp",
      "luxury vinyl plank",
      "vinyl plank",
      "lvt",
      "luxury vinyl tile",
      "finishes"
    ],
    "keywords": [
      "lvp",
      "luxury vinyl plank",
      "vinyl plank",
      "lvt",
      "luxury vinyl tile",
      "luxury",
      "vinyl",
      "plank",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "epoxy-floor",
    "csi_division": "09",
    "csi_code": "09 67 23",
    "category": "finishes",
    "description": "Epoxy Floor Coating (material per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "epoxy floor",
      "epoxy coating",
      "floor coating",
      "epoxy topping",
      "finishes"
    ],
    "keywords": [
      "epoxy floor",
      "epoxy coating",
      "floor coating",
      "epoxy topping",
      "epoxy",
      "floor",
      "coating",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "paint",
    "csi_division": "09",
    "csi_code": "09 91 00",
    "category": "finishes",
    "description": "Paint (material per SF)",
    "unit": "SF",
    "material_cost_cents": 35,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "paint",
      "painting",
      "interior paint",
      "exterior paint",
      "primer",
      "finishes"
    ],
    "keywords": [
      "paint",
      "painting",
      "interior paint",
      "exterior paint",
      "primer",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "acoustical-ceiling",
    "csi_division": "09",
    "csi_code": "09 51 00",
    "category": "finishes",
    "description": "Acoustical Ceiling Tile (material per SF)",
    "unit": "SF",
    "material_cost_cents": 225,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "acoustical ceiling",
      "acoustic tile",
      "ceiling tile",
      "suspended ceiling",
      "drop ceiling",
      "act",
      "finishes"
    ],
    "keywords": [
      "acoustical ceiling",
      "acoustic tile",
      "ceiling tile",
      "suspended ceiling",
      "drop ceiling",
      "act",
      "acoustical",
      "ceiling",
      "tile",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "gypsum-plaster",
    "csi_division": "09",
    "csi_code": "09 22 00",
    "category": "finishes",
    "description": "Gypsum Plaster/Stucco (material per SF)",
    "unit": "SF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "plaster",
      "gypsum plaster",
      "stucco",
      "exterior stucco",
      "finishes"
    ],
    "keywords": [
      "plaster",
      "gypsum plaster",
      "stucco",
      "exterior stucco",
      "gypsum",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "tile-setting",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Tile Setting Materials/Thinset (material per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "tile setting",
      "tile adhesive",
      "thinset",
      "mortar bed",
      "grout",
      "finishes"
    ],
    "keywords": [
      "tile setting",
      "tile adhesive",
      "thinset",
      "mortar bed",
      "grout",
      "tile",
      "setting",
      "materials",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "toilet-partition",
    "csi_division": "10",
    "csi_code": "10 21 13",
    "category": "specialties",
    "description": "Toilet Partition (material per stall)",
    "unit": "EA",
    "material_cost_cents": 65000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "toilet partition",
      "bathroom partition",
      "restroom partition",
      "toilet stall",
      "specialties"
    ],
    "keywords": [
      "toilet partition",
      "bathroom partition",
      "restroom partition",
      "toilet stall",
      "toilet",
      "partition",
      "material",
      "per",
      "stall",
      "specialties"
    ]
  },
  {
    "external_id": "fire-extinguisher",
    "csi_division": "10",
    "csi_code": "10 44 13",
    "category": "specialties",
    "description": "Fire Extinguisher & Cabinet (material per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fire extinguisher",
      "extinguisher cabinet",
      "fire cabinet",
      "specialties"
    ],
    "keywords": [
      "fire extinguisher",
      "extinguisher cabinet",
      "fire cabinet",
      "fire",
      "extinguisher",
      "cabinet",
      "material",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "signage",
    "csi_division": "10",
    "csi_code": "10 14 00",
    "category": "specialties",
    "description": "Signage (material per EA)",
    "unit": "EA",
    "material_cost_cents": 12500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "signage",
      "sign",
      "building sign",
      "room sign",
      "exit sign",
      "specialties"
    ],
    "keywords": [
      "signage",
      "sign",
      "building sign",
      "room sign",
      "exit sign",
      "material",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "flagpole",
    "csi_division": "10",
    "csi_code": "10 75 00",
    "category": "specialties",
    "description": "Flagpole (material per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "flagpole",
      "flag pole",
      "specialties"
    ],
    "keywords": [
      "flagpole",
      "flag pole",
      "material",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "louver",
    "csi_division": "10",
    "csi_code": "10 71 00",
    "category": "specialties",
    "description": "Aluminum Louver (material per SF)",
    "unit": "SF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "louver",
      "wall louver",
      "ventilation louver",
      "aluminum louver",
      "specialties"
    ],
    "keywords": [
      "louver",
      "wall louver",
      "ventilation louver",
      "aluminum louver",
      "aluminum",
      "material",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "window-blind",
    "csi_division": "12",
    "csi_code": "12 21 13",
    "category": "furnishings",
    "description": "Window Blind/Shade (material per SF)",
    "unit": "SF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "blind",
      "window blind",
      "roller shade",
      "window shade",
      "furnishings"
    ],
    "keywords": [
      "blind",
      "window blind",
      "roller shade",
      "window shade",
      "window",
      "shade",
      "material",
      "per",
      "furnishings"
    ]
  },
  {
    "external_id": "casework",
    "csi_division": "12",
    "csi_code": "12 32 00",
    "category": "furnishings",
    "description": "Casework/Cabinets (material per LF)",
    "unit": "LF",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "casework",
      "cabinet",
      "millwork cabinet",
      "base cabinet",
      "upper cabinet",
      "furnishings"
    ],
    "keywords": [
      "casework",
      "cabinet",
      "millwork cabinet",
      "base cabinet",
      "upper cabinet",
      "cabinets",
      "material",
      "per",
      "furnishings"
    ]
  },
  {
    "external_id": "countertop",
    "csi_division": "12",
    "csi_code": "12 36 00",
    "category": "furnishings",
    "description": "Countertop (material per SF)",
    "unit": "SF",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "countertop",
      "counter top",
      "laminate counter",
      "granite counter",
      "quartz counter",
      "furnishings"
    ],
    "keywords": [
      "countertop",
      "counter top",
      "laminate counter",
      "granite counter",
      "quartz counter",
      "material",
      "per",
      "furnishings"
    ]
  },
  {
    "external_id": "sprinkler-head",
    "csi_division": "21",
    "csi_code": "21 13 13",
    "category": "fire",
    "description": "Sprinkler Head (material per EA)",
    "unit": "EA",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sprinkler head",
      "fire sprinkler",
      "sprinkler",
      "fire"
    ],
    "keywords": [
      "sprinkler head",
      "fire sprinkler",
      "sprinkler",
      "head",
      "material",
      "per",
      "fire"
    ]
  },
  {
    "external_id": "sprinkler-pipe",
    "csi_division": "21",
    "csi_code": "21 13 13",
    "category": "fire",
    "description": "Sprinkler Pipe (material per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sprinkler pipe",
      "fire pipe",
      "schedule 40 pipe fire",
      "fire"
    ],
    "keywords": [
      "sprinkler pipe",
      "fire pipe",
      "schedule 40 pipe fire",
      "sprinkler",
      "pipe",
      "material",
      "per",
      "fire"
    ]
  },
  {
    "external_id": "fire-riser",
    "csi_division": "21",
    "csi_code": "21 13 00",
    "category": "fire",
    "description": "Fire Sprinkler Riser Assembly (material per EA)",
    "unit": "EA",
    "material_cost_cents": 285000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fire riser",
      "sprinkler riser",
      "fire main",
      "fire"
    ],
    "keywords": [
      "fire riser",
      "sprinkler riser",
      "fire main",
      "fire",
      "sprinkler",
      "riser",
      "assembly",
      "material",
      "per"
    ]
  },
  {
    "external_id": "pvc-pipe-4in",
    "csi_division": "22",
    "csi_code": "22 11 16",
    "category": "plumbing",
    "description": "4\" PVC Drain Pipe (material per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pvc pipe",
      "4\\\" pvc",
      "4 inch pvc",
      "drain pipe",
      "sanitary pipe",
      "plumbing"
    ],
    "keywords": [
      "pvc pipe",
      "4\\\" pvc",
      "4 inch pvc",
      "drain pipe",
      "sanitary pipe",
      "pvc",
      "drain",
      "pipe",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "copper-pipe",
    "csi_division": "22",
    "csi_code": "22 11 16",
    "category": "plumbing",
    "description": "Copper Pipe (material per LF)",
    "unit": "LF",
    "material_cost_cents": 1250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "copper pipe",
      "copper tubing",
      "type l copper",
      "type k copper",
      "plumbing"
    ],
    "keywords": [
      "copper pipe",
      "copper tubing",
      "type l copper",
      "type k copper",
      "copper",
      "pipe",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "water-closet",
    "csi_division": "22",
    "csi_code": "22 42 13",
    "category": "plumbing",
    "description": "Water Closet/Toilet (material per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "water closet",
      "toilet",
      "wc",
      "flush valve toilet",
      "plumbing"
    ],
    "keywords": [
      "water closet",
      "toilet",
      "wc",
      "flush valve toilet",
      "water",
      "closet",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "lavatory",
    "csi_division": "22",
    "csi_code": "22 42 16",
    "category": "plumbing",
    "description": "Lavatory/Sink (material per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lavatory",
      "sink",
      "hand sink",
      "wash basin",
      "plumbing"
    ],
    "keywords": [
      "lavatory",
      "sink",
      "hand sink",
      "wash basin",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "floor-drain",
    "csi_division": "22",
    "csi_code": "22 42 00",
    "category": "plumbing",
    "description": "Floor Drain (material per EA)",
    "unit": "EA",
    "material_cost_cents": 12500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "floor drain",
      "area drain",
      "trench drain",
      "plumbing"
    ],
    "keywords": [
      "floor drain",
      "area drain",
      "trench drain",
      "floor",
      "drain",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "water-heater",
    "csi_division": "22",
    "csi_code": "22 33 00",
    "category": "plumbing",
    "description": "Water Heater (material per EA)",
    "unit": "EA",
    "material_cost_cents": 85000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "water heater",
      "hot water heater",
      "tankless water heater",
      "plumbing"
    ],
    "keywords": [
      "water heater",
      "hot water heater",
      "tankless water heater",
      "water",
      "heater",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "backflow-preventer",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "plumbing",
    "description": "Backflow Preventer (material per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "backflow preventer",
      "backflow",
      "rpz",
      "double check valve",
      "plumbing"
    ],
    "keywords": [
      "backflow preventer",
      "backflow",
      "rpz",
      "double check valve",
      "preventer",
      "material",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "ductwork",
    "csi_division": "23",
    "csi_code": "23 31 00",
    "category": "hvac",
    "description": "Sheet Metal Ductwork (material per LB)",
    "unit": "LB",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "ductwork",
      "duct",
      "sheet metal duct",
      "hvac duct",
      "supply duct",
      "return duct",
      "hvac"
    ],
    "keywords": [
      "ductwork",
      "duct",
      "sheet metal duct",
      "hvac duct",
      "supply duct",
      "return duct",
      "sheet",
      "metal",
      "material",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "rooftop-unit",
    "csi_division": "23",
    "csi_code": "23 74 00",
    "category": "hvac",
    "description": "Rooftop HVAC Unit (material per TON)",
    "unit": "TON",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rooftop unit",
      "rtu",
      "packaged unit",
      "hvac unit",
      "hvac"
    ],
    "keywords": [
      "rooftop unit",
      "rtu",
      "packaged unit",
      "hvac unit",
      "rooftop",
      "hvac",
      "unit",
      "material",
      "per",
      "ton"
    ]
  },
  {
    "external_id": "split-system",
    "csi_division": "23",
    "csi_code": "23 81 26",
    "category": "hvac",
    "description": "Split System/Mini-Split (material per TON)",
    "unit": "TON",
    "material_cost_cents": 145000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "split system",
      "mini split",
      "ductless",
      "heat pump",
      "hvac"
    ],
    "keywords": [
      "split system",
      "mini split",
      "ductless",
      "heat pump",
      "split",
      "system",
      "mini",
      "material",
      "per",
      "ton",
      "hvac"
    ]
  },
  {
    "external_id": "diffuser",
    "csi_division": "23",
    "csi_code": "23 37 00",
    "category": "hvac",
    "description": "Supply Diffuser/Register (material per EA)",
    "unit": "EA",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "diffuser",
      "supply diffuser",
      "air diffuser",
      "ceiling diffuser",
      "grille",
      "register",
      "hvac"
    ],
    "keywords": [
      "diffuser",
      "supply diffuser",
      "air diffuser",
      "ceiling diffuser",
      "grille",
      "register",
      "supply",
      "material",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "exhaust-fan",
    "csi_division": "23",
    "csi_code": "23 34 00",
    "category": "hvac",
    "description": "Exhaust Fan (material per EA)",
    "unit": "EA",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "exhaust fan",
      "bathroom fan",
      "kitchen exhaust",
      "ventilation fan",
      "hvac"
    ],
    "keywords": [
      "exhaust fan",
      "bathroom fan",
      "kitchen exhaust",
      "ventilation fan",
      "exhaust",
      "fan",
      "material",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "insulated-duct",
    "csi_division": "23",
    "csi_code": "23 07 00",
    "category": "hvac",
    "description": "Duct Insulation (material per SF)",
    "unit": "SF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "insulated duct",
      "duct insulation",
      "duct wrap",
      "duct liner",
      "hvac"
    ],
    "keywords": [
      "insulated duct",
      "duct insulation",
      "duct wrap",
      "duct liner",
      "duct",
      "insulation",
      "material",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "conduit-emt",
    "csi_division": "26",
    "csi_code": "26 05 33",
    "category": "electrical",
    "description": "EMT Conduit (material per LF)",
    "unit": "LF",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "emt",
      "conduit",
      "electrical conduit",
      "emt conduit",
      "rigid conduit",
      "electrical"
    ],
    "keywords": [
      "emt",
      "conduit",
      "electrical conduit",
      "emt conduit",
      "rigid conduit",
      "material",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "wire-12awg",
    "csi_division": "26",
    "csi_code": "26 05 19",
    "category": "electrical",
    "description": "12 AWG THHN Wire (material per LF)",
    "unit": "LF",
    "material_cost_cents": 55,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "12 awg",
      "12 gauge wire",
      "thhn wire",
      "electrical wire",
      "branch circuit wire",
      "electrical"
    ],
    "keywords": [
      "12 awg",
      "12 gauge wire",
      "thhn wire",
      "electrical wire",
      "branch circuit wire",
      "awg",
      "thhn",
      "wire",
      "material",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "panel-board",
    "csi_division": "26",
    "csi_code": "26 24 16",
    "category": "electrical",
    "description": "Electrical Panel Board (material per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "panel board",
      "electrical panel",
      "distribution panel",
      "load center",
      "breaker panel",
      "electrical"
    ],
    "keywords": [
      "panel board",
      "electrical panel",
      "distribution panel",
      "load center",
      "breaker panel",
      "electrical",
      "panel",
      "board",
      "material",
      "per"
    ]
  },
  {
    "external_id": "light-fixture",
    "csi_division": "26",
    "csi_code": "26 51 00",
    "category": "electrical",
    "description": "Light Fixture (material per EA)",
    "unit": "EA",
    "material_cost_cents": 12500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "light fixture",
      "lighting",
      "led fixture",
      "troffer",
      "downlight",
      "recessed light",
      "electrical"
    ],
    "keywords": [
      "light fixture",
      "lighting",
      "led fixture",
      "troffer",
      "downlight",
      "recessed light",
      "light",
      "fixture",
      "material",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "receptacle",
    "csi_division": "26",
    "csi_code": "26 27 26",
    "category": "electrical",
    "description": "Electrical Receptacle/Outlet (material per EA)",
    "unit": "EA",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "receptacle",
      "outlet",
      "duplex outlet",
      "gfci outlet",
      "electrical outlet",
      "electrical"
    ],
    "keywords": [
      "receptacle",
      "outlet",
      "duplex outlet",
      "gfci outlet",
      "electrical outlet",
      "electrical",
      "material",
      "per"
    ]
  },
  {
    "external_id": "switch",
    "csi_division": "26",
    "csi_code": "26 27 26",
    "category": "electrical",
    "description": "Electrical Switch (material per EA)",
    "unit": "EA",
    "material_cost_cents": 1250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "switch",
      "light switch",
      "toggle switch",
      "dimmer switch",
      "electrical"
    ],
    "keywords": [
      "switch",
      "light switch",
      "toggle switch",
      "dimmer switch",
      "electrical",
      "material",
      "per"
    ]
  },
  {
    "external_id": "transformer",
    "csi_division": "26",
    "csi_code": "26 22 00",
    "category": "electrical",
    "description": "Dry-Type Transformer (material per KVA)",
    "unit": "KVA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "transformer",
      "dry type transformer",
      "step down transformer",
      "electrical"
    ],
    "keywords": [
      "transformer",
      "dry type transformer",
      "step down transformer",
      "dry",
      "type",
      "material",
      "per",
      "kva",
      "electrical"
    ]
  },
  {
    "external_id": "generator",
    "csi_division": "26",
    "csi_code": "26 32 00",
    "category": "electrical",
    "description": "Standby Generator (material per KW)",
    "unit": "KW",
    "material_cost_cents": 85000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "generator",
      "standby generator",
      "emergency generator",
      "diesel generator",
      "electrical"
    ],
    "keywords": [
      "generator",
      "standby generator",
      "emergency generator",
      "diesel generator",
      "standby",
      "material",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "data-cable",
    "csi_division": "27",
    "csi_code": "27 15 00",
    "category": "communications",
    "description": "Cat6 Data Cable (material per LF)",
    "unit": "LF",
    "material_cost_cents": 45,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "data cable",
      "cat6",
      "cat 6",
      "network cable",
      "ethernet cable",
      "low voltage",
      "communications"
    ],
    "keywords": [
      "data cable",
      "cat6",
      "cat 6",
      "network cable",
      "ethernet cable",
      "low voltage",
      "data",
      "cable",
      "material",
      "per",
      "communications"
    ]
  },
  {
    "external_id": "data-outlet",
    "csi_division": "27",
    "csi_code": "27 15 00",
    "category": "communications",
    "description": "Data Outlet (material per EA)",
    "unit": "EA",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "data outlet",
      "network outlet",
      "data port",
      "rj45 outlet",
      "communications"
    ],
    "keywords": [
      "data outlet",
      "network outlet",
      "data port",
      "rj45 outlet",
      "data",
      "outlet",
      "material",
      "per",
      "communications"
    ]
  },
  {
    "external_id": "telecom-conduit",
    "csi_division": "27",
    "csi_code": "27 05 28",
    "category": "communications",
    "description": "Telecom/Low Voltage Conduit (material per LF)",
    "unit": "LF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "telecom conduit",
      "low voltage conduit",
      "communications conduit",
      "communications"
    ],
    "keywords": [
      "telecom conduit",
      "low voltage conduit",
      "communications conduit",
      "telecom",
      "low",
      "voltage",
      "conduit",
      "material",
      "per",
      "communications"
    ]
  },
  {
    "external_id": "fire-alarm-device",
    "csi_division": "28",
    "csi_code": "28 31 00",
    "category": "security",
    "description": "Fire Alarm Device (material per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fire alarm",
      "smoke detector",
      "heat detector",
      "pull station",
      "horn strobe",
      "security"
    ],
    "keywords": [
      "fire alarm",
      "smoke detector",
      "heat detector",
      "pull station",
      "horn strobe",
      "fire",
      "alarm",
      "device",
      "material",
      "per",
      "security"
    ]
  },
  {
    "external_id": "security-camera",
    "csi_division": "28",
    "csi_code": "28 23 00",
    "category": "security",
    "description": "Security Camera (material per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "security camera",
      "cctv",
      "surveillance camera",
      "ip camera",
      "security"
    ],
    "keywords": [
      "security camera",
      "cctv",
      "surveillance camera",
      "ip camera",
      "security",
      "camera",
      "material",
      "per"
    ]
  },
  {
    "external_id": "access-control",
    "csi_division": "28",
    "csi_code": "28 13 00",
    "category": "security",
    "description": "Access Control Device (material per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "access control",
      "card reader",
      "keypad entry",
      "door access",
      "security"
    ],
    "keywords": [
      "access control",
      "card reader",
      "keypad entry",
      "door access",
      "access",
      "control",
      "device",
      "material",
      "per",
      "security"
    ]
  },
  {
    "external_id": "storm-drain-pipe",
    "csi_division": "33",
    "csi_code": "33 41 00",
    "category": "utilities",
    "description": "Storm Drain Pipe (material per LF)",
    "unit": "LF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "storm drain",
      "storm pipe",
      "rcp",
      "reinforced concrete pipe",
      "hdpe storm",
      "corrugated metal pipe",
      "utilities"
    ],
    "keywords": [
      "storm drain",
      "storm pipe",
      "rcp",
      "reinforced concrete pipe",
      "hdpe storm",
      "corrugated metal pipe",
      "storm",
      "drain",
      "pipe",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "sanitary-sewer-pipe",
    "csi_division": "33",
    "csi_code": "33 31 00",
    "category": "utilities",
    "description": "Sanitary Sewer Pipe (material per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sanitary sewer",
      "sewer pipe",
      "pvc sewer",
      "8\\\" sewer",
      "gravity sewer",
      "utilities"
    ],
    "keywords": [
      "sanitary sewer",
      "sewer pipe",
      "pvc sewer",
      "8\\\" sewer",
      "gravity sewer",
      "sanitary",
      "sewer",
      "pipe",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "water-main",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "utilities",
    "description": "Water Main Pipe (material per LF)",
    "unit": "LF",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "water main",
      "water line",
      "water pipe",
      "ductile iron pipe",
      "pvc water main",
      "utilities"
    ],
    "keywords": [
      "water main",
      "water line",
      "water pipe",
      "ductile iron pipe",
      "pvc water main",
      "water",
      "main",
      "pipe",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "manhole",
    "csi_division": "33",
    "csi_code": "33 44 00",
    "category": "utilities",
    "description": "Manhole/Catch Basin (material per EA)",
    "unit": "EA",
    "material_cost_cents": 285000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "manhole",
      "catch basin",
      "storm manhole",
      "sewer manhole",
      "utilities"
    ],
    "keywords": [
      "manhole",
      "catch basin",
      "storm manhole",
      "sewer manhole",
      "catch",
      "basin",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "fire-hydrant",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "utilities",
    "description": "Fire Hydrant (material per EA)",
    "unit": "EA",
    "material_cost_cents": 225000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fire hydrant",
      "hydrant",
      "utilities"
    ],
    "keywords": [
      "fire hydrant",
      "hydrant",
      "fire",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "underground-conduit",
    "csi_division": "33",
    "csi_code": "33 71 00",
    "category": "utilities",
    "description": "Underground Electrical Conduit (material per LF)",
    "unit": "LF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "underground conduit",
      "duct bank",
      "underground electric",
      "buried conduit",
      "utilities"
    ],
    "keywords": [
      "underground conduit",
      "duct bank",
      "underground electric",
      "buried conduit",
      "underground",
      "electrical",
      "conduit",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "cleanout",
    "csi_division": "33",
    "csi_code": "33 31 00",
    "category": "utilities",
    "description": "Sewer Cleanout (material per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "cleanout",
      "sewer cleanout",
      "co",
      "clean out",
      "utilities"
    ],
    "keywords": [
      "cleanout",
      "sewer cleanout",
      "co",
      "clean out",
      "sewer",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "gate-valve",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "utilities",
    "description": "Gate Valve (material per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "gate valve",
      "valve box",
      "water valve",
      "curb stop",
      "utilities"
    ],
    "keywords": [
      "gate valve",
      "valve box",
      "water valve",
      "curb stop",
      "gate",
      "valve",
      "material",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "temp-fence",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Temporary Chain Link Fence (per LF)",
    "unit": "LF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "temporary fence",
      "temp fence",
      "chain link fence",
      "construction fence",
      "site fence",
      "general"
    ],
    "keywords": [
      "temporary fence",
      "temp fence",
      "chain link fence",
      "construction fence",
      "site fence",
      "temporary",
      "chain",
      "link",
      "fence",
      "per",
      "general"
    ]
  },
  {
    "external_id": "temp-toilet",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Portable Toilet Rental (per month)",
    "unit": "MO",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "portable toilet",
      "porta potty",
      "temporary toilet",
      "sanitation",
      "general"
    ],
    "keywords": [
      "portable toilet",
      "porta potty",
      "temporary toilet",
      "sanitation",
      "portable",
      "toilet",
      "rental",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "temp-power",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Temporary Power Service (per month)",
    "unit": "MO",
    "material_cost_cents": 65000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "temporary power",
      "temp power",
      "construction power",
      "generator",
      "general"
    ],
    "keywords": [
      "temporary power",
      "temp power",
      "construction power",
      "generator",
      "temporary",
      "power",
      "service",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "temp-water",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Temporary Water Service (per month)",
    "unit": "MO",
    "material_cost_cents": 12500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "temporary water",
      "temp water",
      "construction water",
      "general"
    ],
    "keywords": [
      "temporary water",
      "temp water",
      "construction water",
      "temporary",
      "water",
      "service",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "dumpster",
    "csi_division": "01",
    "csi_code": "01 74 00",
    "category": "general",
    "description": "Dumpster/Roll-Off Container (per pull)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dumpster",
      "debris box",
      "waste container",
      "roll-off",
      "trash haul",
      "general"
    ],
    "keywords": [
      "dumpster",
      "debris box",
      "waste container",
      "roll-off",
      "trash haul",
      "roll",
      "off",
      "container",
      "per",
      "pull",
      "general"
    ]
  },
  {
    "external_id": "site-signage",
    "csi_division": "01",
    "csi_code": "01 58 00",
    "category": "general",
    "description": "Project Identification Sign (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "site sign",
      "project sign",
      "construction sign",
      "identification sign",
      "general"
    ],
    "keywords": [
      "site sign",
      "project sign",
      "construction sign",
      "identification sign",
      "project",
      "identification",
      "sign",
      "per",
      "general"
    ]
  },
  {
    "external_id": "safety-netting",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Safety/Debris Netting (per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "safety net",
      "debris net",
      "fall protection net",
      "construction netting",
      "general"
    ],
    "keywords": [
      "safety net",
      "debris net",
      "fall protection net",
      "construction netting",
      "safety",
      "debris",
      "netting",
      "per",
      "general"
    ]
  },
  {
    "external_id": "scaffolding",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Scaffolding (per SFCA per month)",
    "unit": "SFCA",
    "material_cost_cents": 225,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "scaffolding",
      "scaffold",
      "staging",
      "exterior scaffold",
      "general"
    ],
    "keywords": [
      "scaffolding",
      "scaffold",
      "staging",
      "exterior scaffold",
      "per",
      "sfca",
      "month",
      "general"
    ]
  },
  {
    "external_id": "hoisting",
    "csi_division": "01",
    "csi_code": "01 50 00",
    "category": "general",
    "description": "Material Hoist/Crane Rental (per month)",
    "unit": "MO",
    "material_cost_cents": 450000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hoisting",
      "crane",
      "material hoist",
      "personnel hoist",
      "general"
    ],
    "keywords": [
      "hoisting",
      "crane",
      "material hoist",
      "personnel hoist",
      "material",
      "hoist",
      "rental",
      "per",
      "month",
      "general"
    ]
  },
  {
    "external_id": "project-closeout",
    "csi_division": "01",
    "csi_code": "01 77 00",
    "category": "general",
    "description": "Project Closeout/Commissioning (LS)",
    "unit": "LS",
    "material_cost_cents": 250000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "closeout",
      "punch list",
      "commissioning",
      "project closeout",
      "general"
    ],
    "keywords": [
      "closeout",
      "punch list",
      "commissioning",
      "project closeout",
      "project",
      "general"
    ]
  },
  {
    "external_id": "asbestos-abatement",
    "csi_division": "02",
    "csi_code": "02 82 00",
    "category": "existing",
    "description": "Asbestos Abatement (per SF)",
    "unit": "SF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "asbestos abatement",
      "asbestos removal",
      "hazmat removal",
      "abatement",
      "existing"
    ],
    "keywords": [
      "asbestos abatement",
      "asbestos removal",
      "hazmat removal",
      "abatement",
      "asbestos",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "lead-paint-abatement",
    "csi_division": "02",
    "csi_code": "02 83 00",
    "category": "existing",
    "description": "Lead Paint Abatement (per SF)",
    "unit": "SF",
    "material_cost_cents": 425,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lead paint",
      "lead abatement",
      "lead removal",
      "existing"
    ],
    "keywords": [
      "lead paint",
      "lead abatement",
      "lead removal",
      "lead",
      "paint",
      "abatement",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "selective-demo-wall",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "existing",
    "description": "Selective Wall Demolition (per SF)",
    "unit": "SF",
    "material_cost_cents": 350,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "selective demolition",
      "wall demo",
      "partition demo",
      "remove wall",
      "existing"
    ],
    "keywords": [
      "selective demolition",
      "wall demo",
      "partition demo",
      "remove wall",
      "selective",
      "wall",
      "demolition",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "selective-demo-slab",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "existing",
    "description": "Concrete Slab Demolition (per SF)",
    "unit": "SF",
    "material_cost_cents": 475,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "slab demolition",
      "concrete demo",
      "remove slab",
      "saw cut slab",
      "existing"
    ],
    "keywords": [
      "slab demolition",
      "concrete demo",
      "remove slab",
      "saw cut slab",
      "concrete",
      "slab",
      "demolition",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "saw-cutting",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "existing",
    "description": "Concrete/Asphalt Saw Cutting (per LF)",
    "unit": "LF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "saw cut",
      "saw cutting",
      "concrete cutting",
      "asphalt cutting",
      "existing"
    ],
    "keywords": [
      "saw cut",
      "saw cutting",
      "concrete cutting",
      "asphalt cutting",
      "concrete",
      "asphalt",
      "saw",
      "cutting",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "underground-tank-removal",
    "csi_division": "02",
    "csi_code": "02 84 00",
    "category": "existing",
    "description": "Underground Storage Tank Removal (per EA)",
    "unit": "EA",
    "material_cost_cents": 450000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "underground tank",
      "ust removal",
      "tank removal",
      "fuel tank",
      "existing"
    ],
    "keywords": [
      "underground tank",
      "ust removal",
      "tank removal",
      "fuel tank",
      "underground",
      "storage",
      "tank",
      "removal",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "soil-remediation",
    "csi_division": "02",
    "csi_code": "02 91 00",
    "category": "existing",
    "description": "Contaminated Soil Remediation (per CY)",
    "unit": "CY",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "soil remediation",
      "contaminated soil",
      "soil cleanup",
      "environmental remediation",
      "existing"
    ],
    "keywords": [
      "soil remediation",
      "contaminated soil",
      "soil cleanup",
      "environmental remediation",
      "contaminated",
      "soil",
      "remediation",
      "per",
      "existing"
    ]
  },
  {
    "external_id": "form-release-agent",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "concrete",
    "description": "Form Release Agent/Oil (per GAL)",
    "unit": "GAL",
    "material_cost_cents": 1800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "form release agent",
      "form oil",
      "release agent",
      "form coating",
      "bond breaker",
      "concrete"
    ],
    "keywords": [
      "form release agent",
      "form oil",
      "release agent",
      "form coating",
      "bond breaker",
      "form",
      "release",
      "agent",
      "oil",
      "per",
      "gal",
      "concrete"
    ]
  },
  {
    "external_id": "snap-ties",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "concrete",
    "description": "Snap Ties/Form Ties (per EA)",
    "unit": "EA",
    "material_cost_cents": 45,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "snap tie",
      "snap ties",
      "wall tie",
      "form tie",
      "she bolt",
      "concrete"
    ],
    "keywords": [
      "snap tie",
      "snap ties",
      "wall tie",
      "form tie",
      "she bolt",
      "snap",
      "ties",
      "form",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "pipe-trench-formwork",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "concrete",
    "description": "Pipe Trench Formwork (per SFCA)",
    "unit": "SFCA",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pipe trench formwork",
      "trench form",
      "pipe trench form",
      "utility trench form",
      "concrete"
    ],
    "keywords": [
      "pipe trench formwork",
      "trench form",
      "pipe trench form",
      "utility trench form",
      "pipe",
      "trench",
      "formwork",
      "per",
      "sfca",
      "concrete"
    ]
  },
  {
    "external_id": "keyway-form",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "concrete",
    "description": "Keyway Form (per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "keyway",
      "key form",
      "construction joint keyway",
      "waterstop keyway",
      "concrete"
    ],
    "keywords": [
      "keyway",
      "key form",
      "construction joint keyway",
      "waterstop keyway",
      "form",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "chamfer-strip",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "concrete",
    "description": "Chamfer Strip (per LF)",
    "unit": "LF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "chamfer",
      "chamfer strip",
      "corner bead form",
      "beveled edge",
      "concrete"
    ],
    "keywords": [
      "chamfer",
      "chamfer strip",
      "corner bead form",
      "beveled edge",
      "strip",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "concrete-curing-compound",
    "csi_division": "03",
    "csi_code": "03 39 00",
    "category": "concrete",
    "description": "Concrete Curing Compound (per GAL)",
    "unit": "GAL",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "curing compound",
      "concrete cure",
      "curing membrane",
      "cure and seal",
      "concrete"
    ],
    "keywords": [
      "curing compound",
      "concrete cure",
      "curing membrane",
      "cure and seal",
      "concrete",
      "curing",
      "compound",
      "per",
      "gal"
    ]
  },
  {
    "external_id": "concrete-sealer",
    "csi_division": "03",
    "csi_code": "03 39 00",
    "category": "concrete",
    "description": "Concrete Sealer (per GAL)",
    "unit": "GAL",
    "material_cost_cents": 3500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "concrete sealer",
      "slab sealer",
      "penetrating sealer",
      "concrete coating",
      "concrete"
    ],
    "keywords": [
      "concrete sealer",
      "slab sealer",
      "penetrating sealer",
      "concrete coating",
      "concrete",
      "sealer",
      "per",
      "gal"
    ]
  },
  {
    "external_id": "expansion-joint-filler",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "concrete",
    "description": "Expansion Joint Filler (per LF)",
    "unit": "LF",
    "material_cost_cents": 225,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "expansion joint",
      "joint filler",
      "expansion filler",
      "premolded joint",
      "concrete"
    ],
    "keywords": [
      "expansion joint",
      "joint filler",
      "expansion filler",
      "premolded joint",
      "expansion",
      "joint",
      "filler",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "control-joint-sealant",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "concrete",
    "description": "Control Joint Sealant (per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "control joint sealant",
      "joint sealant",
      "polyurethane sealant",
      "concrete joint seal",
      "concrete"
    ],
    "keywords": [
      "control joint sealant",
      "joint sealant",
      "polyurethane sealant",
      "concrete joint seal",
      "control",
      "joint",
      "sealant",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "concrete-admixture",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "concrete",
    "description": "Concrete Admixture (per GAL)",
    "unit": "GAL",
    "material_cost_cents": 1200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "admixture",
      "concrete admixture",
      "water reducer",
      "accelerator",
      "retarder",
      "plasticizer",
      "concrete"
    ],
    "keywords": [
      "admixture",
      "concrete admixture",
      "water reducer",
      "accelerator",
      "retarder",
      "plasticizer",
      "concrete",
      "per",
      "gal"
    ]
  },
  {
    "external_id": "fiber-reinforcement",
    "csi_division": "03",
    "csi_code": "03 05 00",
    "category": "concrete",
    "description": "Concrete Fiber Reinforcement (per LB)",
    "unit": "LB",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fiber reinforcement",
      "polypropylene fiber",
      "steel fiber",
      "concrete fiber",
      "concrete"
    ],
    "keywords": [
      "fiber reinforcement",
      "polypropylene fiber",
      "steel fiber",
      "concrete fiber",
      "concrete",
      "fiber",
      "reinforcement",
      "per"
    ]
  },
  {
    "external_id": "wire-mesh",
    "csi_division": "03",
    "csi_code": "03 22 00",
    "category": "concrete",
    "description": "Welded Wire Mesh (per SF)",
    "unit": "SF",
    "material_cost_cents": 45,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wire mesh",
      "welded wire",
      "wwf",
      "wwm",
      "wire fabric",
      "6x6 mesh",
      "concrete"
    ],
    "keywords": [
      "wire mesh",
      "welded wire",
      "wwf",
      "wwm",
      "wire fabric",
      "6x6 mesh",
      "welded",
      "wire",
      "mesh",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "vapor-barrier",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Vapor Barrier/Retarder (per SF)",
    "unit": "SF",
    "material_cost_cents": 18,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vapor barrier",
      "vapor retarder",
      "poly film",
      "polyethylene film",
      "under slab vapor",
      "concrete"
    ],
    "keywords": [
      "vapor barrier",
      "vapor retarder",
      "poly film",
      "polyethylene film",
      "under slab vapor",
      "vapor",
      "barrier",
      "retarder",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "concrete-pump",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Pump Truck (per HR)",
    "unit": "HR",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "concrete pump",
      "pump truck",
      "concrete pumping",
      "boom pump",
      "concrete"
    ],
    "keywords": [
      "concrete pump",
      "pump truck",
      "concrete pumping",
      "boom pump",
      "concrete",
      "pump",
      "truck",
      "per"
    ]
  },
  {
    "external_id": "concrete-testing",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Test Cylinder (per EA)",
    "unit": "EA",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "concrete testing",
      "cylinder test",
      "slump test",
      "break test",
      "compressive strength",
      "concrete"
    ],
    "keywords": [
      "concrete testing",
      "cylinder test",
      "slump test",
      "break test",
      "compressive strength",
      "concrete",
      "test",
      "cylinder",
      "per"
    ]
  },
  {
    "external_id": "dowel-bar",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "concrete",
    "description": "Dowel Bar (per EA)",
    "unit": "EA",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dowel bar",
      "smooth dowel",
      "load transfer",
      "slab dowel",
      "concrete"
    ],
    "keywords": [
      "dowel bar",
      "smooth dowel",
      "load transfer",
      "slab dowel",
      "dowel",
      "bar",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "anchor-bolt",
    "csi_division": "03",
    "csi_code": "03 15 00",
    "category": "concrete",
    "description": "Anchor Bolt Cast-in-Place (per EA)",
    "unit": "EA",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "anchor bolt",
      "j-bolt",
      "l-bolt",
      "cast-in anchor",
      "embed anchor",
      "concrete"
    ],
    "keywords": [
      "anchor bolt",
      "j-bolt",
      "l-bolt",
      "cast-in anchor",
      "embed anchor",
      "anchor",
      "bolt",
      "cast",
      "place",
      "per",
      "concrete"
    ]
  },
  {
    "external_id": "brick-veneer",
    "csi_division": "04",
    "csi_code": "04 21 00",
    "category": "masonry",
    "description": "Brick Veneer (per SF)",
    "unit": "SF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "brick veneer",
      "face brick",
      "brick facing",
      "brick cladding",
      "masonry"
    ],
    "keywords": [
      "brick veneer",
      "face brick",
      "brick facing",
      "brick cladding",
      "brick",
      "veneer",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "cmu-8in-filled",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "8\" CMU Fully Grouted (per SF)",
    "unit": "SF",
    "material_cost_cents": 1450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "8 inch cmu filled",
      "8\\\" cmu grouted",
      "filled block",
      "grouted cmu",
      "reinforced cmu",
      "masonry"
    ],
    "keywords": [
      "8 inch cmu filled",
      "8\\\" cmu grouted",
      "filled block",
      "grouted cmu",
      "reinforced cmu",
      "cmu",
      "fully",
      "grouted",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "cmu-12in",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "12\" CMU Block Wall (per SF)",
    "unit": "SF",
    "material_cost_cents": 1650,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "12 inch cmu",
      "12\\\" cmu",
      "12 in block",
      "heavy block wall",
      "masonry"
    ],
    "keywords": [
      "12 inch cmu",
      "12\\\" cmu",
      "12 in block",
      "heavy block wall",
      "cmu",
      "block",
      "wall",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "masonry-grout",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Masonry Grout (per CY)",
    "unit": "CY",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "masonry grout",
      "cmu grout",
      "block fill",
      "coarse grout",
      "fine grout",
      "masonry"
    ],
    "keywords": [
      "masonry grout",
      "cmu grout",
      "block fill",
      "coarse grout",
      "fine grout",
      "masonry",
      "grout",
      "per"
    ]
  },
  {
    "external_id": "masonry-mortar",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Masonry Mortar (per 80lb bag)",
    "unit": "BAG",
    "material_cost_cents": 1250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "masonry mortar",
      "type s mortar",
      "type n mortar",
      "mortar mix",
      "masonry"
    ],
    "keywords": [
      "masonry mortar",
      "type s mortar",
      "type n mortar",
      "mortar mix",
      "masonry",
      "mortar",
      "per",
      "80lb",
      "bag"
    ]
  },
  {
    "external_id": "masonry-rebar",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Masonry Reinforcing Bar (per LF)",
    "unit": "LF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "masonry rebar",
      "vertical rebar",
      "horizontal rebar",
      "wall reinforcement",
      "masonry"
    ],
    "keywords": [
      "masonry rebar",
      "vertical rebar",
      "horizontal rebar",
      "wall reinforcement",
      "masonry",
      "reinforcing",
      "bar",
      "per"
    ]
  },
  {
    "external_id": "masonry-lintel",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Steel Lintel for Masonry (per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "masonry lintel",
      "steel lintel",
      "angle lintel",
      "opening lintel",
      "masonry"
    ],
    "keywords": [
      "masonry lintel",
      "steel lintel",
      "angle lintel",
      "opening lintel",
      "steel",
      "lintel",
      "for",
      "masonry",
      "per"
    ]
  },
  {
    "external_id": "masonry-control-joint",
    "csi_division": "04",
    "csi_code": "04 05 00",
    "category": "masonry",
    "description": "Masonry Control Joint (per LF)",
    "unit": "LF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "masonry control joint",
      "control joint",
      "expansion joint masonry",
      "building sealant",
      "masonry"
    ],
    "keywords": [
      "masonry control joint",
      "control joint",
      "expansion joint masonry",
      "building sealant",
      "masonry",
      "control",
      "joint",
      "per"
    ]
  },
  {
    "external_id": "stone-veneer",
    "csi_division": "04",
    "csi_code": "04 43 00",
    "category": "masonry",
    "description": "Stone Veneer (per SF)",
    "unit": "SF",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "stone veneer",
      "natural stone",
      "cultured stone",
      "stone cladding",
      "limestone veneer",
      "masonry"
    ],
    "keywords": [
      "stone veneer",
      "natural stone",
      "cultured stone",
      "stone cladding",
      "limestone veneer",
      "stone",
      "veneer",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "retaining-wall-block",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "Segmental Retaining Wall Block (per SF)",
    "unit": "SF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "retaining wall block",
      "segmental retaining wall",
      "srw",
      "allan block",
      "versa-lok",
      "masonry"
    ],
    "keywords": [
      "retaining wall block",
      "segmental retaining wall",
      "srw",
      "allan block",
      "versa-lok",
      "segmental",
      "retaining",
      "wall",
      "block",
      "per",
      "masonry"
    ]
  },
  {
    "external_id": "structural-steel-wide-flange",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Structural Steel Wide Flange (per LB)",
    "unit": "LB",
    "material_cost_cents": 145,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wide flange",
      "w-beam",
      "wide flange beam",
      "steel beam",
      "i-beam",
      "metals"
    ],
    "keywords": [
      "wide flange",
      "w-beam",
      "wide flange beam",
      "steel beam",
      "i-beam",
      "structural",
      "steel",
      "wide",
      "flange",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "hss-tube",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "HSS Structural Tube (per LB)",
    "unit": "LB",
    "material_cost_cents": 165,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hss tube",
      "hollow structural section",
      "square tube",
      "rectangular tube",
      "steel tube",
      "metals"
    ],
    "keywords": [
      "hss tube",
      "hollow structural section",
      "square tube",
      "rectangular tube",
      "steel tube",
      "hss",
      "structural",
      "tube",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "steel-column",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Steel Pipe Column (per LF)",
    "unit": "LF",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "steel column",
      "pipe column",
      "round column",
      "pipe post",
      "metals"
    ],
    "keywords": [
      "steel column",
      "pipe column",
      "round column",
      "pipe post",
      "steel",
      "pipe",
      "column",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "steel-plate",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Steel Plate (per LB)",
    "unit": "LB",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "steel plate",
      "base plate",
      "connection plate",
      "gusset plate",
      "metals"
    ],
    "keywords": [
      "steel plate",
      "base plate",
      "connection plate",
      "gusset plate",
      "steel",
      "plate",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "metal-decking",
    "csi_division": "05",
    "csi_code": "05 31 00",
    "category": "metals",
    "description": "Metal Decking (per SF)",
    "unit": "SF",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal deck",
      "steel deck",
      "composite deck",
      "floor deck",
      "roof deck",
      "metals"
    ],
    "keywords": [
      "metal deck",
      "steel deck",
      "composite deck",
      "floor deck",
      "roof deck",
      "metal",
      "decking",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "metal-stair",
    "csi_division": "05",
    "csi_code": "05 51 00",
    "category": "metals",
    "description": "Metal Stair (per riser)",
    "unit": "RISER",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal stair",
      "steel stair",
      "pan stair",
      "stair stringer",
      "metals"
    ],
    "keywords": [
      "metal stair",
      "steel stair",
      "pan stair",
      "stair stringer",
      "metal",
      "stair",
      "per",
      "riser",
      "metals"
    ]
  },
  {
    "external_id": "metal-handrail",
    "csi_division": "05",
    "csi_code": "05 52 00",
    "category": "metals",
    "description": "Metal Handrail/Guardrail (per LF)",
    "unit": "LF",
    "material_cost_cents": 4800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal handrail",
      "steel handrail",
      "pipe rail",
      "guard rail",
      "railing",
      "metals"
    ],
    "keywords": [
      "metal handrail",
      "steel handrail",
      "pipe rail",
      "guard rail",
      "railing",
      "metal",
      "handrail",
      "guardrail",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "anchor-channel",
    "csi_division": "05",
    "csi_code": "05 05 00",
    "category": "metals",
    "description": "Anchor Channel/Embed Plate (per LF)",
    "unit": "LF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "anchor channel",
      "embed plate",
      "weld plate",
      "cast-in channel",
      "metals"
    ],
    "keywords": [
      "anchor channel",
      "embed plate",
      "weld plate",
      "cast-in channel",
      "anchor",
      "channel",
      "embed",
      "plate",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "expansion-bolt",
    "csi_division": "05",
    "csi_code": "05 05 00",
    "category": "metals",
    "description": "Expansion/Wedge Anchor Bolt (per EA)",
    "unit": "EA",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "expansion bolt",
      "wedge anchor",
      "hilti anchor",
      "concrete anchor",
      "post-installed anchor",
      "metals"
    ],
    "keywords": [
      "expansion bolt",
      "wedge anchor",
      "hilti anchor",
      "concrete anchor",
      "post-installed anchor",
      "expansion",
      "wedge",
      "anchor",
      "bolt",
      "per",
      "metals"
    ]
  },
  {
    "external_id": "light-gauge-framing",
    "csi_division": "05",
    "csi_code": "05 41 00",
    "category": "metals",
    "description": "Light Gauge Metal Framing (per SF of wall)",
    "unit": "SF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "light gauge",
      "metal stud",
      "light gauge framing",
      "cold formed steel",
      "metal framing",
      "metals"
    ],
    "keywords": [
      "light gauge",
      "metal stud",
      "light gauge framing",
      "cold formed steel",
      "metal framing",
      "light",
      "gauge",
      "metal",
      "framing",
      "per",
      "wall",
      "metals"
    ]
  },
  {
    "external_id": "lumber-2x4",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "2x4 Framing Lumber (per LF)",
    "unit": "LF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "2x4 lumber",
      "2 by 4",
      "stud",
      "wall stud",
      "framing lumber 2x4",
      "wood"
    ],
    "keywords": [
      "2x4 lumber",
      "2 by 4",
      "stud",
      "wall stud",
      "framing lumber 2x4",
      "2x4",
      "framing",
      "lumber",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "lumber-2x6",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "2x6 Framing Lumber (per LF)",
    "unit": "LF",
    "material_cost_cents": 95,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "2x6 lumber",
      "2 by 6",
      "2x6 stud",
      "2x6 framing",
      "wood"
    ],
    "keywords": [
      "2x6 lumber",
      "2 by 6",
      "2x6 stud",
      "2x6 framing",
      "2x6",
      "framing",
      "lumber",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "lumber-2x8",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "2x8 Framing Lumber (per LF)",
    "unit": "LF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "2x8 lumber",
      "2 by 8",
      "2x8 joist",
      "2x8 framing",
      "wood"
    ],
    "keywords": [
      "2x8 lumber",
      "2 by 8",
      "2x8 joist",
      "2x8 framing",
      "2x8",
      "framing",
      "lumber",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "lumber-2x10",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "2x10 Framing Lumber (per LF)",
    "unit": "LF",
    "material_cost_cents": 165,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "2x10 lumber",
      "2 by 10",
      "2x10 joist",
      "floor joist",
      "wood"
    ],
    "keywords": [
      "2x10 lumber",
      "2 by 10",
      "2x10 joist",
      "floor joist",
      "2x10",
      "framing",
      "lumber",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "lumber-2x12",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "2x12 Framing Lumber (per LF)",
    "unit": "LF",
    "material_cost_cents": 225,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "2x12 lumber",
      "2 by 12",
      "2x12 joist",
      "ridge board",
      "wood"
    ],
    "keywords": [
      "2x12 lumber",
      "2 by 12",
      "2x12 joist",
      "ridge board",
      "2x12",
      "framing",
      "lumber",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "lvl-beam",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "LVL Engineered Beam (per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lvl beam",
      "laminated veneer lumber",
      "engineered lumber",
      "microlam",
      "parallam",
      "wood"
    ],
    "keywords": [
      "lvl beam",
      "laminated veneer lumber",
      "engineered lumber",
      "microlam",
      "parallam",
      "lvl",
      "engineered",
      "beam",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "glulam-beam",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Glulam Timber Beam (per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "glulam",
      "glue laminated",
      "glulam beam",
      "timber beam",
      "wood"
    ],
    "keywords": [
      "glulam",
      "glue laminated",
      "glulam beam",
      "timber beam",
      "timber",
      "beam",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "wood-trusses",
    "csi_division": "06",
    "csi_code": "06 17 00",
    "category": "wood",
    "description": "Wood Roof Trusses (per SF of roof)",
    "unit": "SF",
    "material_cost_cents": 485,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "roof truss",
      "wood truss",
      "floor truss",
      "truss system",
      "wood"
    ],
    "keywords": [
      "roof truss",
      "wood truss",
      "floor truss",
      "truss system",
      "wood",
      "roof",
      "trusses",
      "per"
    ]
  },
  {
    "external_id": "osb-sheathing",
    "csi_division": "06",
    "csi_code": "06 16 00",
    "category": "wood",
    "description": "OSB Sheathing (per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "osb sheathing",
      "osb",
      "oriented strand board",
      "wall sheathing",
      "roof sheathing",
      "wood"
    ],
    "keywords": [
      "osb sheathing",
      "osb",
      "oriented strand board",
      "wall sheathing",
      "roof sheathing",
      "sheathing",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "plywood-sheathing",
    "csi_division": "06",
    "csi_code": "06 16 00",
    "category": "wood",
    "description": "Plywood Sheathing (per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "plywood sheathing",
      "plywood",
      "cdx plywood",
      "structural plywood",
      "wood"
    ],
    "keywords": [
      "plywood sheathing",
      "plywood",
      "cdx plywood",
      "structural plywood",
      "sheathing",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "wood-blocking",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Wood Blocking/Nailer (per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "blocking",
      "wood blocking",
      "nailer",
      "wood nailer",
      "backing",
      "wood"
    ],
    "keywords": [
      "blocking",
      "wood blocking",
      "nailer",
      "wood nailer",
      "backing",
      "wood",
      "per"
    ]
  },
  {
    "external_id": "pressure-treated-lumber",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Pressure Treated Lumber (per LF)",
    "unit": "LF",
    "material_cost_cents": 145,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pressure treated",
      "pt lumber",
      "treated lumber",
      "ground contact lumber",
      "wood"
    ],
    "keywords": [
      "pressure treated",
      "pt lumber",
      "treated lumber",
      "ground contact lumber",
      "pressure",
      "treated",
      "lumber",
      "per",
      "wood"
    ]
  },
  {
    "external_id": "wood-siding",
    "csi_division": "06",
    "csi_code": "06 20 00",
    "category": "wood",
    "description": "Wood Siding (per SF)",
    "unit": "SF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood siding",
      "cedar siding",
      "lap siding",
      "board and batten",
      "wood cladding",
      "wood"
    ],
    "keywords": [
      "wood siding",
      "cedar siding",
      "lap siding",
      "board and batten",
      "wood cladding",
      "wood",
      "siding",
      "per"
    ]
  },
  {
    "external_id": "wood-decking",
    "csi_division": "06",
    "csi_code": "06 15 00",
    "category": "wood",
    "description": "Wood/Composite Decking (per SF)",
    "unit": "SF",
    "material_cost_cents": 550,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood decking",
      "deck boards",
      "decking boards",
      "composite deck",
      "trex decking",
      "wood"
    ],
    "keywords": [
      "wood decking",
      "deck boards",
      "decking boards",
      "composite deck",
      "trex decking",
      "wood",
      "composite",
      "decking",
      "per"
    ]
  },
  {
    "external_id": "spray-foam-insulation",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Spray Foam Insulation (per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "spray foam",
      "spray polyurethane foam",
      "spf",
      "closed cell foam",
      "open cell foam",
      "thermal"
    ],
    "keywords": [
      "spray foam",
      "spray polyurethane foam",
      "spf",
      "closed cell foam",
      "open cell foam",
      "spray",
      "foam",
      "insulation",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "rigid-insulation",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Rigid Foam Board Insulation (per SF)",
    "unit": "SF",
    "material_cost_cents": 145,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rigid insulation",
      "foam board",
      "xps insulation",
      "eps insulation",
      "polyiso",
      "thermal"
    ],
    "keywords": [
      "rigid insulation",
      "foam board",
      "xps insulation",
      "eps insulation",
      "polyiso",
      "rigid",
      "foam",
      "board",
      "insulation",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "batt-insulation-r19",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "R-19 Batt Insulation (per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "r-19 insulation",
      "r19 batt",
      "2x6 insulation",
      "wall insulation r19",
      "thermal"
    ],
    "keywords": [
      "r-19 insulation",
      "r19 batt",
      "2x6 insulation",
      "wall insulation r19",
      "batt",
      "insulation",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "batt-insulation-r38",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "R-38 Batt Insulation (per SF)",
    "unit": "SF",
    "material_cost_cents": 165,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "r-38 insulation",
      "r38 batt",
      "attic insulation",
      "ceiling insulation r38",
      "thermal"
    ],
    "keywords": [
      "r-38 insulation",
      "r38 batt",
      "attic insulation",
      "ceiling insulation r38",
      "batt",
      "insulation",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "blown-in-insulation",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Blown-In Insulation (per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "blown insulation",
      "blown-in",
      "cellulose insulation",
      "loose fill insulation",
      "thermal"
    ],
    "keywords": [
      "blown insulation",
      "blown-in",
      "cellulose insulation",
      "loose fill insulation",
      "blown",
      "insulation",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "waterproofing-membrane",
    "csi_division": "07",
    "csi_code": "07 10 00",
    "category": "thermal",
    "description": "Waterproofing Membrane (per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "waterproofing membrane",
      "foundation waterproofing",
      "below grade waterproofing",
      "elastomeric waterproofing",
      "thermal"
    ],
    "keywords": [
      "waterproofing membrane",
      "foundation waterproofing",
      "below grade waterproofing",
      "elastomeric waterproofing",
      "waterproofing",
      "membrane",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "drainage-board",
    "csi_division": "07",
    "csi_code": "07 10 00",
    "category": "thermal",
    "description": "Drainage Board/Dimple Mat (per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "drainage board",
      "dimple mat",
      "drainage mat",
      "foundation drainage",
      "thermal"
    ],
    "keywords": [
      "drainage board",
      "dimple mat",
      "drainage mat",
      "foundation drainage",
      "drainage",
      "board",
      "dimple",
      "mat",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "tpo-roofing",
    "csi_division": "07",
    "csi_code": "07 54 00",
    "category": "thermal",
    "description": "TPO Roofing Membrane (per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "tpo roofing",
      "tpo membrane",
      "thermoplastic roofing",
      "single ply roofing",
      "thermal"
    ],
    "keywords": [
      "tpo roofing",
      "tpo membrane",
      "thermoplastic roofing",
      "single ply roofing",
      "tpo",
      "roofing",
      "membrane",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "epdm-roofing",
    "csi_division": "07",
    "csi_code": "07 53 00",
    "category": "thermal",
    "description": "EPDM Roofing Membrane (per SF)",
    "unit": "SF",
    "material_cost_cents": 245,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "epdm roofing",
      "rubber roofing",
      "epdm membrane",
      "single ply epdm",
      "thermal"
    ],
    "keywords": [
      "epdm roofing",
      "rubber roofing",
      "epdm membrane",
      "single ply epdm",
      "epdm",
      "roofing",
      "membrane",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "modified-bitumen",
    "csi_division": "07",
    "csi_code": "07 52 00",
    "category": "thermal",
    "description": "Modified Bitumen Roofing (per SF)",
    "unit": "SF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "modified bitumen",
      "mod bit",
      "torch down",
      "built-up roofing",
      "bur",
      "thermal"
    ],
    "keywords": [
      "modified bitumen",
      "mod bit",
      "torch down",
      "built-up roofing",
      "bur",
      "modified",
      "bitumen",
      "roofing",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "asphalt-shingles",
    "csi_division": "07",
    "csi_code": "07 31 00",
    "category": "thermal",
    "description": "Asphalt Roof Shingles (per SQ = 100 SF)",
    "unit": "SQ",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "asphalt shingles",
      "architectural shingles",
      "fiberglass shingles",
      "roof shingles",
      "thermal"
    ],
    "keywords": [
      "asphalt shingles",
      "architectural shingles",
      "fiberglass shingles",
      "roof shingles",
      "asphalt",
      "roof",
      "shingles",
      "per",
      "100",
      "thermal"
    ]
  },
  {
    "external_id": "metal-roofing",
    "csi_division": "07",
    "csi_code": "07 41 00",
    "category": "thermal",
    "description": "Metal Roofing (per SF)",
    "unit": "SF",
    "material_cost_cents": 485,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal roofing",
      "standing seam",
      "metal roof panel",
      "corrugated metal roof",
      "thermal"
    ],
    "keywords": [
      "metal roofing",
      "standing seam",
      "metal roof panel",
      "corrugated metal roof",
      "metal",
      "roofing",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "roof-insulation",
    "csi_division": "07",
    "csi_code": "07 22 00",
    "category": "thermal",
    "description": "Roof Insulation Board (per SF)",
    "unit": "SF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "roof insulation",
      "tapered insulation",
      "polyiso roof",
      "roof board insulation",
      "thermal"
    ],
    "keywords": [
      "roof insulation",
      "tapered insulation",
      "polyiso roof",
      "roof board insulation",
      "roof",
      "insulation",
      "board",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "flashing",
    "csi_division": "07",
    "csi_code": "07 60 00",
    "category": "thermal",
    "description": "Metal Flashing (per LF)",
    "unit": "LF",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "flashing",
      "metal flashing",
      "base flashing",
      "counter flashing",
      "step flashing",
      "thermal"
    ],
    "keywords": [
      "flashing",
      "metal flashing",
      "base flashing",
      "counter flashing",
      "step flashing",
      "metal",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "caulking-sealant",
    "csi_division": "07",
    "csi_code": "07 90 00",
    "category": "thermal",
    "description": "Caulking/Sealant (per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "caulking",
      "sealant",
      "silicone sealant",
      "polyurethane sealant",
      "joint sealant",
      "thermal"
    ],
    "keywords": [
      "caulking",
      "sealant",
      "silicone sealant",
      "polyurethane sealant",
      "joint sealant",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "building-wrap",
    "csi_division": "07",
    "csi_code": "07 25 00",
    "category": "thermal",
    "description": "Building Wrap/Weather Barrier (per SF)",
    "unit": "SF",
    "material_cost_cents": 25,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "building wrap",
      "house wrap",
      "tyvek",
      "weather barrier",
      "air barrier",
      "thermal"
    ],
    "keywords": [
      "building wrap",
      "house wrap",
      "tyvek",
      "weather barrier",
      "air barrier",
      "building",
      "wrap",
      "weather",
      "barrier",
      "per",
      "thermal"
    ]
  },
  {
    "external_id": "hollow-metal-door",
    "csi_division": "08",
    "csi_code": "08 11 00",
    "category": "openings",
    "description": "Hollow Metal Door (per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hollow metal door",
      "hm door",
      "steel door",
      "metal door",
      "commercial door",
      "openings"
    ],
    "keywords": [
      "hollow metal door",
      "hm door",
      "steel door",
      "metal door",
      "commercial door",
      "hollow",
      "metal",
      "door",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "hollow-metal-frame",
    "csi_division": "08",
    "csi_code": "08 11 00",
    "category": "openings",
    "description": "Hollow Metal Door Frame (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hollow metal frame",
      "hm frame",
      "steel frame",
      "door frame",
      "metal frame",
      "openings"
    ],
    "keywords": [
      "hollow metal frame",
      "hm frame",
      "steel frame",
      "door frame",
      "metal frame",
      "hollow",
      "metal",
      "door",
      "frame",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "wood-door",
    "csi_division": "08",
    "csi_code": "08 14 00",
    "category": "openings",
    "description": "Wood Door (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood door",
      "solid core door",
      "hollow core door",
      "interior door",
      "flush door",
      "openings"
    ],
    "keywords": [
      "wood door",
      "solid core door",
      "hollow core door",
      "interior door",
      "flush door",
      "wood",
      "door",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "overhead-door",
    "csi_division": "08",
    "csi_code": "08 36 00",
    "category": "openings",
    "description": "Overhead/Sectional Door (per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "overhead door",
      "garage door",
      "roll-up door",
      "sectional door",
      "coiling door",
      "openings"
    ],
    "keywords": [
      "overhead door",
      "garage door",
      "roll-up door",
      "sectional door",
      "coiling door",
      "overhead",
      "sectional",
      "door",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "storefront-door",
    "csi_division": "08",
    "csi_code": "08 41 00",
    "category": "openings",
    "description": "Aluminum Storefront Door (per EA)",
    "unit": "EA",
    "material_cost_cents": 285000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "storefront door",
      "aluminum door",
      "commercial entrance",
      "glass door",
      "entry door",
      "openings"
    ],
    "keywords": [
      "storefront door",
      "aluminum door",
      "commercial entrance",
      "glass door",
      "entry door",
      "aluminum",
      "storefront",
      "door",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "storefront-glazing",
    "csi_division": "08",
    "csi_code": "08 41 00",
    "category": "openings",
    "description": "Aluminum Storefront Glazing System (per SF)",
    "unit": "SF",
    "material_cost_cents": 4800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "storefront glazing",
      "storefront system",
      "aluminum storefront",
      "curtain wall",
      "glass wall",
      "openings"
    ],
    "keywords": [
      "storefront glazing",
      "storefront system",
      "aluminum storefront",
      "curtain wall",
      "glass wall",
      "aluminum",
      "storefront",
      "glazing",
      "system",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "window-vinyl",
    "csi_division": "08",
    "csi_code": "08 52 00",
    "category": "openings",
    "description": "Vinyl Window (per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vinyl window",
      "pvc window",
      "double hung window",
      "casement window",
      "slider window",
      "openings"
    ],
    "keywords": [
      "vinyl window",
      "pvc window",
      "double hung window",
      "casement window",
      "slider window",
      "vinyl",
      "window",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "window-aluminum",
    "csi_division": "08",
    "csi_code": "08 51 00",
    "category": "openings",
    "description": "Aluminum Window (per SF)",
    "unit": "SF",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "aluminum window",
      "commercial window",
      "fixed window",
      "projected window",
      "openings"
    ],
    "keywords": [
      "aluminum window",
      "commercial window",
      "fixed window",
      "projected window",
      "aluminum",
      "window",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "door-hardware",
    "csi_division": "08",
    "csi_code": "08 71 00",
    "category": "openings",
    "description": "Door Hardware Set (per door)",
    "unit": "SET",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "door hardware",
      "lockset",
      "door knob",
      "lever handle",
      "door closer",
      "panic bar",
      "openings"
    ],
    "keywords": [
      "door hardware",
      "lockset",
      "door knob",
      "lever handle",
      "door closer",
      "panic bar",
      "door",
      "hardware",
      "set",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "automatic-door",
    "csi_division": "08",
    "csi_code": "08 42 00",
    "category": "openings",
    "description": "Automatic Door Operator (per EA)",
    "unit": "EA",
    "material_cost_cents": 385000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "automatic door",
      "auto door",
      "sliding automatic",
      "handicap door",
      "ada door opener",
      "openings"
    ],
    "keywords": [
      "automatic door",
      "auto door",
      "sliding automatic",
      "handicap door",
      "ada door opener",
      "automatic",
      "door",
      "operator",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "skylight",
    "csi_division": "08",
    "csi_code": "08 62 00",
    "category": "openings",
    "description": "Skylight (per EA)",
    "unit": "EA",
    "material_cost_cents": 125000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "skylight",
      "roof window",
      "tubular skylight",
      "domed skylight",
      "openings"
    ],
    "keywords": [
      "skylight",
      "roof window",
      "tubular skylight",
      "domed skylight",
      "per",
      "openings"
    ]
  },
  {
    "external_id": "metal-stud-framing",
    "csi_division": "09",
    "csi_code": "09 22 00",
    "category": "finishes",
    "description": "Metal Stud Interior Framing (per SF of wall)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "metal stud",
      "light gauge stud",
      "interior framing",
      "partition framing",
      "steel stud",
      "finishes"
    ],
    "keywords": [
      "metal stud",
      "light gauge stud",
      "interior framing",
      "partition framing",
      "steel stud",
      "metal",
      "stud",
      "interior",
      "framing",
      "per",
      "wall",
      "finishes"
    ]
  },
  {
    "external_id": "drywall-5-8",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "5/8\" Drywall/GWB (per SF)",
    "unit": "SF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "5/8 drywall",
      "5/8 gypsum",
      "type x drywall",
      "fire rated drywall",
      "5/8 gwb",
      "finishes"
    ],
    "keywords": [
      "5/8 drywall",
      "5/8 gypsum",
      "type x drywall",
      "fire rated drywall",
      "5/8 gwb",
      "drywall",
      "gwb",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "drywall-1-2",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "1/2\" Drywall/GWB (per SF)",
    "unit": "SF",
    "material_cost_cents": 55,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "1/2 drywall",
      "1/2 gypsum",
      "standard drywall",
      "interior drywall",
      "1/2 gwb",
      "finishes"
    ],
    "keywords": [
      "1/2 drywall",
      "1/2 gypsum",
      "standard drywall",
      "interior drywall",
      "1/2 gwb",
      "drywall",
      "gwb",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "cement-board",
    "csi_division": "09",
    "csi_code": "09 28 00",
    "category": "finishes",
    "description": "Cement Board/Tile Backer (per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "cement board",
      "hardiebacker",
      "durock",
      "cement backer",
      "tile backer",
      "finishes"
    ],
    "keywords": [
      "cement board",
      "hardiebacker",
      "durock",
      "cement backer",
      "tile backer",
      "cement",
      "board",
      "tile",
      "backer",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "ceramic-tile-floor",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Ceramic/Porcelain Floor Tile (per SF)",
    "unit": "SF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "ceramic tile floor",
      "floor tile",
      "porcelain floor tile",
      "tile flooring",
      "finishes"
    ],
    "keywords": [
      "ceramic tile floor",
      "floor tile",
      "porcelain floor tile",
      "tile flooring",
      "ceramic",
      "porcelain",
      "floor",
      "tile",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "ceramic-tile-wall",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Ceramic/Porcelain Wall Tile (per SF)",
    "unit": "SF",
    "material_cost_cents": 550,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "ceramic tile wall",
      "wall tile",
      "bathroom tile",
      "shower tile",
      "backsplash tile",
      "finishes"
    ],
    "keywords": [
      "ceramic tile wall",
      "wall tile",
      "bathroom tile",
      "shower tile",
      "backsplash tile",
      "ceramic",
      "porcelain",
      "wall",
      "tile",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "lvp-flooring",
    "csi_division": "09",
    "csi_code": "09 65 00",
    "category": "finishes",
    "description": "Luxury Vinyl Plank (LVP) Flooring (per SF)",
    "unit": "SF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lvp flooring",
      "luxury vinyl plank",
      "vinyl plank",
      "lvt",
      "vinyl tile flooring",
      "finishes"
    ],
    "keywords": [
      "lvp flooring",
      "luxury vinyl plank",
      "vinyl plank",
      "lvt",
      "vinyl tile flooring",
      "luxury",
      "vinyl",
      "plank",
      "lvp",
      "flooring",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "hardwood-flooring",
    "csi_division": "09",
    "csi_code": "09 64 00",
    "category": "finishes",
    "description": "Hardwood Flooring (per SF)",
    "unit": "SF",
    "material_cost_cents": 650,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "hardwood floor",
      "wood floor",
      "oak floor",
      "engineered hardwood",
      "solid hardwood",
      "finishes"
    ],
    "keywords": [
      "hardwood floor",
      "wood floor",
      "oak floor",
      "engineered hardwood",
      "solid hardwood",
      "hardwood",
      "flooring",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "carpet",
    "csi_division": "09",
    "csi_code": "09 68 00",
    "category": "finishes",
    "description": "Carpet (per SY)",
    "unit": "SY",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "carpet",
      "broadloom carpet",
      "carpet tile",
      "commercial carpet",
      "residential carpet",
      "finishes"
    ],
    "keywords": [
      "carpet",
      "broadloom carpet",
      "carpet tile",
      "commercial carpet",
      "residential carpet",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "epoxy-floor-coating",
    "csi_division": "09",
    "csi_code": "09 67 00",
    "category": "finishes",
    "description": "Epoxy Floor Coating (per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "epoxy floor",
      "epoxy coating",
      "floor coating",
      "industrial floor coating",
      "garage floor epoxy",
      "finishes"
    ],
    "keywords": [
      "epoxy floor",
      "epoxy coating",
      "floor coating",
      "industrial floor coating",
      "garage floor epoxy",
      "epoxy",
      "floor",
      "coating",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "exterior-paint",
    "csi_division": "09",
    "csi_code": "09 91 00",
    "category": "finishes",
    "description": "Exterior Paint/Coating (per SF)",
    "unit": "SF",
    "material_cost_cents": 45,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "exterior paint",
      "exterior coating",
      "exterior finish",
      "masonry paint",
      "stucco paint",
      "finishes"
    ],
    "keywords": [
      "exterior paint",
      "exterior coating",
      "exterior finish",
      "masonry paint",
      "stucco paint",
      "exterior",
      "paint",
      "coating",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "interior-paint",
    "csi_division": "09",
    "csi_code": "09 91 00",
    "category": "finishes",
    "description": "Interior Paint (per SF)",
    "unit": "SF",
    "material_cost_cents": 35,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "interior paint",
      "wall paint",
      "ceiling paint",
      "latex paint",
      "interior coating",
      "finishes"
    ],
    "keywords": [
      "interior paint",
      "wall paint",
      "ceiling paint",
      "latex paint",
      "interior coating",
      "interior",
      "paint",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "stucco",
    "csi_division": "09",
    "csi_code": "09 24 00",
    "category": "finishes",
    "description": "Stucco/Plaster Finish (per SF)",
    "unit": "SF",
    "material_cost_cents": 485,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "stucco",
      "plaster",
      "exterior plaster",
      "three coat stucco",
      "eifs",
      "finishes"
    ],
    "keywords": [
      "stucco",
      "plaster",
      "exterior plaster",
      "three coat stucco",
      "eifs",
      "finish",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "acoustical-ceiling",
    "csi_division": "09",
    "csi_code": "09 51 00",
    "category": "finishes",
    "description": "Acoustical Ceiling Tile & Grid (per SF)",
    "unit": "SF",
    "material_cost_cents": 325,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "acoustical ceiling",
      "drop ceiling",
      "suspended ceiling",
      "ceiling tile",
      "2x4 ceiling",
      "2x2 ceiling",
      "finishes"
    ],
    "keywords": [
      "acoustical ceiling",
      "drop ceiling",
      "suspended ceiling",
      "ceiling tile",
      "2x4 ceiling",
      "2x2 ceiling",
      "acoustical",
      "ceiling",
      "tile",
      "grid",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "gypsum-ceiling",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "Gypsum Board Ceiling (per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "gypsum ceiling",
      "drywall ceiling",
      "gyp board ceiling",
      "plaster ceiling",
      "finishes"
    ],
    "keywords": [
      "gypsum ceiling",
      "drywall ceiling",
      "gyp board ceiling",
      "plaster ceiling",
      "gypsum",
      "board",
      "ceiling",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "tile-setting-material",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Tile Setting Material/Thinset (per SF)",
    "unit": "SF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "tile mortar",
      "thinset",
      "tile adhesive",
      "tile setting",
      "mastic",
      "finishes"
    ],
    "keywords": [
      "tile mortar",
      "thinset",
      "tile adhesive",
      "tile setting",
      "mastic",
      "tile",
      "setting",
      "material",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "tile-grout",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Tile Grout (per SF)",
    "unit": "SF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "tile grout",
      "grout",
      "sanded grout",
      "unsanded grout",
      "epoxy grout",
      "finishes"
    ],
    "keywords": [
      "tile grout",
      "grout",
      "sanded grout",
      "unsanded grout",
      "epoxy grout",
      "tile",
      "per",
      "finishes"
    ]
  },
  {
    "external_id": "toilet-partitions",
    "csi_division": "10",
    "csi_code": "10 21 00",
    "category": "specialties",
    "description": "Toilet Partition (per stall)",
    "unit": "EA",
    "material_cost_cents": 68500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "toilet partition",
      "bathroom partition",
      "restroom partition",
      "toilet stall",
      "specialties"
    ],
    "keywords": [
      "toilet partition",
      "bathroom partition",
      "restroom partition",
      "toilet stall",
      "toilet",
      "partition",
      "per",
      "stall",
      "specialties"
    ]
  },
  {
    "external_id": "lockers",
    "csi_division": "10",
    "csi_code": "10 51 00",
    "category": "specialties",
    "description": "Metal Locker (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "locker",
      "metal locker",
      "school locker",
      "gym locker",
      "storage locker",
      "specialties"
    ],
    "keywords": [
      "locker",
      "metal locker",
      "school locker",
      "gym locker",
      "storage locker",
      "metal",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "fire-extinguisher-cabinet",
    "csi_division": "10",
    "csi_code": "10 44 00",
    "category": "specialties",
    "description": "Fire Extinguisher & Cabinet (per EA)",
    "unit": "EA",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "fire extinguisher",
      "fire extinguisher cabinet",
      "fec",
      "extinguisher bracket",
      "specialties"
    ],
    "keywords": [
      "fire extinguisher",
      "fire extinguisher cabinet",
      "fec",
      "extinguisher bracket",
      "fire",
      "extinguisher",
      "cabinet",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "signage-interior",
    "csi_division": "10",
    "csi_code": "10 14 00",
    "category": "specialties",
    "description": "Interior Signage (per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "interior sign",
      "room sign",
      "door sign",
      "ada sign",
      "wayfinding sign",
      "specialties"
    ],
    "keywords": [
      "interior sign",
      "room sign",
      "door sign",
      "ada sign",
      "wayfinding sign",
      "interior",
      "signage",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "bulletin-board",
    "csi_division": "10",
    "csi_code": "10 11 00",
    "category": "specialties",
    "description": "Bulletin/Marker Board (per SF)",
    "unit": "SF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "bulletin board",
      "tack board",
      "marker board",
      "whiteboard",
      "chalkboard",
      "specialties"
    ],
    "keywords": [
      "bulletin board",
      "tack board",
      "marker board",
      "whiteboard",
      "chalkboard",
      "bulletin",
      "marker",
      "board",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "grab-bar",
    "csi_division": "10",
    "csi_code": "10 28 00",
    "category": "specialties",
    "description": "Grab Bar (per EA)",
    "unit": "EA",
    "material_cost_cents": 6500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "grab bar",
      "ada grab bar",
      "safety bar",
      "handrail bar",
      "specialties"
    ],
    "keywords": [
      "grab bar",
      "ada grab bar",
      "safety bar",
      "handrail bar",
      "grab",
      "bar",
      "per",
      "specialties"
    ]
  },
  {
    "external_id": "toilet-accessories",
    "csi_division": "10",
    "csi_code": "10 28 00",
    "category": "specialties",
    "description": "Toilet Accessories Set (per restroom)",
    "unit": "SET",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "toilet accessories",
      "paper holder",
      "towel bar",
      "soap dispenser",
      "mirror",
      "specialties"
    ],
    "keywords": [
      "toilet accessories",
      "paper holder",
      "towel bar",
      "soap dispenser",
      "mirror",
      "toilet",
      "accessories",
      "set",
      "per",
      "restroom",
      "specialties"
    ]
  },
  {
    "external_id": "loading-dock-leveler",
    "csi_division": "11",
    "csi_code": "11 13 00",
    "category": "equipment",
    "description": "Loading Dock Leveler (per EA)",
    "unit": "EA",
    "material_cost_cents": 485000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dock leveler",
      "loading dock",
      "dock equipment",
      "dock plate",
      "equipment"
    ],
    "keywords": [
      "dock leveler",
      "loading dock",
      "dock equipment",
      "dock plate",
      "loading",
      "dock",
      "leveler",
      "per",
      "equipment"
    ]
  },
  {
    "external_id": "dock-bumper",
    "csi_division": "11",
    "csi_code": "11 13 00",
    "category": "equipment",
    "description": "Dock Bumper (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dock bumper",
      "dock seal",
      "dock shelter",
      "loading dock bumper",
      "equipment"
    ],
    "keywords": [
      "dock bumper",
      "dock seal",
      "dock shelter",
      "loading dock bumper",
      "dock",
      "bumper",
      "per",
      "equipment"
    ]
  },
  {
    "external_id": "overhead-crane",
    "csi_division": "11",
    "csi_code": "11 30 00",
    "category": "equipment",
    "description": "Overhead Bridge Crane (per EA)",
    "unit": "EA",
    "material_cost_cents": 1850000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "overhead crane",
      "bridge crane",
      "hoist",
      "monorail hoist",
      "jib crane",
      "equipment"
    ],
    "keywords": [
      "overhead crane",
      "bridge crane",
      "hoist",
      "monorail hoist",
      "jib crane",
      "overhead",
      "bridge",
      "crane",
      "per",
      "equipment"
    ]
  },
  {
    "external_id": "commercial-kitchen-hood",
    "csi_division": "11",
    "csi_code": "11 40 00",
    "category": "equipment",
    "description": "Commercial Kitchen Hood (per LF)",
    "unit": "LF",
    "material_cost_cents": 85000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "kitchen hood",
      "exhaust hood",
      "commercial hood",
      "grease hood",
      "type 1 hood",
      "equipment"
    ],
    "keywords": [
      "kitchen hood",
      "exhaust hood",
      "commercial hood",
      "grease hood",
      "type 1 hood",
      "commercial",
      "kitchen",
      "hood",
      "per",
      "equipment"
    ]
  },
  {
    "external_id": "elevator",
    "csi_division": "14",
    "csi_code": "14 20 00",
    "category": "equipment",
    "description": "Elevator (per stop)",
    "unit": "STOP",
    "material_cost_cents": 2850000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "elevator",
      "hydraulic elevator",
      "traction elevator",
      "passenger elevator",
      "freight elevator",
      "equipment"
    ],
    "keywords": [
      "elevator",
      "hydraulic elevator",
      "traction elevator",
      "passenger elevator",
      "freight elevator",
      "per",
      "stop",
      "equipment"
    ]
  },
  {
    "external_id": "copper-pipe-3-4",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "plumbing",
    "description": "3/4\" Copper Water Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 485,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "3/4 copper pipe",
      "3/4 inch copper",
      "copper water line",
      "domestic water copper",
      "plumbing"
    ],
    "keywords": [
      "3/4 copper pipe",
      "3/4 inch copper",
      "copper water line",
      "domestic water copper",
      "copper",
      "water",
      "pipe",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "copper-pipe-1in",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "plumbing",
    "description": "1\" Copper Water Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 650,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "1 inch copper pipe",
      "1\\\" copper",
      "copper supply line",
      "plumbing"
    ],
    "keywords": [
      "1 inch copper pipe",
      "1\\\" copper",
      "copper supply line",
      "copper",
      "water",
      "pipe",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "pvc-drain-3in",
    "csi_division": "22",
    "csi_code": "22 13 00",
    "category": "plumbing",
    "description": "3\" PVC Drain Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 425,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "3 inch pvc drain",
      "3\\\" pvc",
      "drain pipe 3 inch",
      "pvc waste pipe",
      "plumbing"
    ],
    "keywords": [
      "3 inch pvc drain",
      "3\\\" pvc",
      "drain pipe 3 inch",
      "pvc waste pipe",
      "pvc",
      "drain",
      "pipe",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "pvc-drain-4in",
    "csi_division": "22",
    "csi_code": "22 13 00",
    "category": "plumbing",
    "description": "4\" PVC Drain Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 585,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "4 inch pvc drain",
      "4\\\" pvc",
      "4 in drain",
      "pvc sewer pipe building",
      "plumbing"
    ],
    "keywords": [
      "4 inch pvc drain",
      "4\\\" pvc",
      "4 in drain",
      "pvc sewer pipe building",
      "pvc",
      "drain",
      "pipe",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "water-heater-commercial",
    "csi_division": "22",
    "csi_code": "22 33 00",
    "category": "plumbing",
    "description": "Commercial Water Heater (per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "commercial water heater",
      "gas water heater",
      "electric water heater",
      "water heater tank",
      "plumbing"
    ],
    "keywords": [
      "commercial water heater",
      "gas water heater",
      "electric water heater",
      "water heater tank",
      "commercial",
      "water",
      "heater",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "backflow-preventer",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "plumbing",
    "description": "Backflow Preventer (per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "backflow preventer",
      "rpz valve",
      "double check valve",
      "backflow device",
      "plumbing"
    ],
    "keywords": [
      "backflow preventer",
      "rpz valve",
      "double check valve",
      "backflow device",
      "backflow",
      "preventer",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "floor-drain",
    "csi_division": "22",
    "csi_code": "22 13 00",
    "category": "plumbing",
    "description": "Floor Drain (per EA)",
    "unit": "EA",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "floor drain",
      "area drain",
      "trench drain",
      "floor sink",
      "plumbing"
    ],
    "keywords": [
      "floor drain",
      "area drain",
      "trench drain",
      "floor sink",
      "floor",
      "drain",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "toilet",
    "csi_division": "22",
    "csi_code": "22 42 00",
    "category": "plumbing",
    "description": "Toilet/Water Closet (per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "toilet",
      "water closet",
      "wc",
      "flush valve toilet",
      "tank toilet",
      "plumbing"
    ],
    "keywords": [
      "toilet",
      "water closet",
      "wc",
      "flush valve toilet",
      "tank toilet",
      "water",
      "closet",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "urinal",
    "csi_division": "22",
    "csi_code": "22 42 00",
    "category": "plumbing",
    "description": "Urinal (per EA)",
    "unit": "EA",
    "material_cost_cents": 48500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "urinal",
      "wall hung urinal",
      "flush valve urinal",
      "plumbing"
    ],
    "keywords": [
      "urinal",
      "wall hung urinal",
      "flush valve urinal",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "lavatory",
    "csi_division": "22",
    "csi_code": "22 42 00",
    "category": "plumbing",
    "description": "Lavatory/Sink (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "lavatory",
      "sink",
      "hand sink",
      "bathroom sink",
      "wall hung sink",
      "plumbing"
    ],
    "keywords": [
      "lavatory",
      "sink",
      "hand sink",
      "bathroom sink",
      "wall hung sink",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "mop-sink",
    "csi_division": "22",
    "csi_code": "22 42 00",
    "category": "plumbing",
    "description": "Mop/Service Sink (per EA)",
    "unit": "EA",
    "material_cost_cents": 38500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "mop sink",
      "service sink",
      "janitorial sink",
      "floor mounted sink",
      "plumbing"
    ],
    "keywords": [
      "mop sink",
      "service sink",
      "janitorial sink",
      "floor mounted sink",
      "mop",
      "service",
      "sink",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "drinking-fountain",
    "csi_division": "22",
    "csi_code": "22 47 00",
    "category": "plumbing",
    "description": "Drinking Fountain (per EA)",
    "unit": "EA",
    "material_cost_cents": 68500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "drinking fountain",
      "water fountain",
      "bubbler",
      "ada drinking fountain",
      "plumbing"
    ],
    "keywords": [
      "drinking fountain",
      "water fountain",
      "bubbler",
      "ada drinking fountain",
      "drinking",
      "fountain",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "grease-trap",
    "csi_division": "22",
    "csi_code": "22 13 00",
    "category": "plumbing",
    "description": "Grease Trap/Interceptor (per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "grease trap",
      "grease interceptor",
      "grease separator",
      "plumbing"
    ],
    "keywords": [
      "grease trap",
      "grease interceptor",
      "grease separator",
      "grease",
      "trap",
      "interceptor",
      "per",
      "plumbing"
    ]
  },
  {
    "external_id": "split-system-ac",
    "csi_division": "23",
    "csi_code": "23 81 00",
    "category": "hvac",
    "description": "Split System AC/Heat Pump (per TON)",
    "unit": "TON",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "split system",
      "mini split",
      "ductless ac",
      "split ac unit",
      "heat pump split",
      "hvac"
    ],
    "keywords": [
      "split system",
      "mini split",
      "ductless ac",
      "split ac unit",
      "heat pump split",
      "split",
      "system",
      "heat",
      "pump",
      "per",
      "ton",
      "hvac"
    ]
  },
  {
    "external_id": "rooftop-unit",
    "csi_division": "23",
    "csi_code": "23 74 00",
    "category": "hvac",
    "description": "Rooftop Packaged Unit (per TON)",
    "unit": "TON",
    "material_cost_cents": 285000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rooftop unit",
      "rtu",
      "packaged unit",
      "rooftop hvac",
      "packaged hvac",
      "hvac"
    ],
    "keywords": [
      "rooftop unit",
      "rtu",
      "packaged unit",
      "rooftop hvac",
      "packaged hvac",
      "rooftop",
      "packaged",
      "unit",
      "per",
      "ton",
      "hvac"
    ]
  },
  {
    "external_id": "ductwork-supply",
    "csi_division": "23",
    "csi_code": "23 31 00",
    "category": "hvac",
    "description": "Supply Ductwork (per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "supply duct",
      "ductwork supply",
      "sheet metal duct",
      "rectangular duct",
      "spiral duct",
      "hvac"
    ],
    "keywords": [
      "supply duct",
      "ductwork supply",
      "sheet metal duct",
      "rectangular duct",
      "spiral duct",
      "supply",
      "ductwork",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "ductwork-return",
    "csi_division": "23",
    "csi_code": "23 31 00",
    "category": "hvac",
    "description": "Return Air Ductwork (per LF)",
    "unit": "LF",
    "material_cost_cents": 1450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "return duct",
      "return air duct",
      "return ductwork",
      "return air plenum",
      "hvac"
    ],
    "keywords": [
      "return duct",
      "return air duct",
      "return ductwork",
      "return air plenum",
      "return",
      "air",
      "ductwork",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "diffuser-supply",
    "csi_division": "23",
    "csi_code": "23 37 00",
    "category": "hvac",
    "description": "Supply Air Diffuser (per EA)",
    "unit": "EA",
    "material_cost_cents": 6500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "supply diffuser",
      "air diffuser",
      "ceiling diffuser",
      "supply grille",
      "supply register",
      "hvac"
    ],
    "keywords": [
      "supply diffuser",
      "air diffuser",
      "ceiling diffuser",
      "supply grille",
      "supply register",
      "supply",
      "air",
      "diffuser",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "return-grille",
    "csi_division": "23",
    "csi_code": "23 37 00",
    "category": "hvac",
    "description": "Return Air Grille (per EA)",
    "unit": "EA",
    "material_cost_cents": 4800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "return grille",
      "return air grille",
      "return register",
      "air return",
      "hvac"
    ],
    "keywords": [
      "return grille",
      "return air grille",
      "return register",
      "air return",
      "return",
      "air",
      "grille",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "exhaust-fan",
    "csi_division": "23",
    "csi_code": "23 34 00",
    "category": "hvac",
    "description": "Exhaust Fan (per EA)",
    "unit": "EA",
    "material_cost_cents": 18500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "exhaust fan",
      "bathroom fan",
      "restroom exhaust",
      "ceiling exhaust fan",
      "hvac"
    ],
    "keywords": [
      "exhaust fan",
      "bathroom fan",
      "restroom exhaust",
      "ceiling exhaust fan",
      "exhaust",
      "fan",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "air-handler",
    "csi_division": "23",
    "csi_code": "23 73 00",
    "category": "hvac",
    "description": "Air Handling Unit (per TON)",
    "unit": "TON",
    "material_cost_cents": 125000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "air handler",
      "ahu",
      "air handling unit",
      "fan coil unit",
      "hvac"
    ],
    "keywords": [
      "air handler",
      "ahu",
      "air handling unit",
      "fan coil unit",
      "air",
      "handling",
      "unit",
      "per",
      "ton",
      "hvac"
    ]
  },
  {
    "external_id": "vav-box",
    "csi_division": "23",
    "csi_code": "23 36 00",
    "category": "hvac",
    "description": "VAV Terminal Box (per EA)",
    "unit": "EA",
    "material_cost_cents": 68500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "vav box",
      "variable air volume",
      "vav terminal",
      "vav unit",
      "hvac"
    ],
    "keywords": [
      "vav box",
      "variable air volume",
      "vav terminal",
      "vav unit",
      "vav",
      "terminal",
      "box",
      "per",
      "hvac"
    ]
  },
  {
    "external_id": "boiler",
    "csi_division": "23",
    "csi_code": "23 52 00",
    "category": "hvac",
    "description": "Boiler (per MBH output)",
    "unit": "MBH",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "boiler",
      "hot water boiler",
      "steam boiler",
      "heating boiler",
      "hvac"
    ],
    "keywords": [
      "boiler",
      "hot water boiler",
      "steam boiler",
      "heating boiler",
      "per",
      "mbh",
      "output",
      "hvac"
    ]
  },
  {
    "external_id": "chiller",
    "csi_division": "23",
    "csi_code": "23 64 00",
    "category": "hvac",
    "description": "Chiller (per TON)",
    "unit": "TON",
    "material_cost_cents": 85000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "chiller",
      "water chiller",
      "centrifugal chiller",
      "screw chiller",
      "hvac"
    ],
    "keywords": [
      "chiller",
      "water chiller",
      "centrifugal chiller",
      "screw chiller",
      "per",
      "ton",
      "hvac"
    ]
  },
  {
    "external_id": "cooling-tower",
    "csi_division": "23",
    "csi_code": "23 65 00",
    "category": "hvac",
    "description": "Cooling Tower (per TON)",
    "unit": "TON",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "cooling tower",
      "evaporative cooler",
      "fluid cooler",
      "hvac"
    ],
    "keywords": [
      "cooling tower",
      "evaporative cooler",
      "fluid cooler",
      "cooling",
      "tower",
      "per",
      "ton",
      "hvac"
    ]
  },
  {
    "external_id": "conduit-emt-3-4",
    "csi_division": "26",
    "csi_code": "26 05 33",
    "category": "electrical",
    "description": "3/4\" EMT Conduit (per LF)",
    "unit": "LF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "3/4 emt",
      "3/4 conduit",
      "emt conduit 3/4",
      "thin wall conduit",
      "electrical"
    ],
    "keywords": [
      "3/4 emt",
      "3/4 conduit",
      "emt conduit 3/4",
      "thin wall conduit",
      "emt",
      "conduit",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "conduit-emt-1in",
    "csi_division": "26",
    "csi_code": "26 05 33",
    "category": "electrical",
    "description": "1\" EMT Conduit (per LF)",
    "unit": "LF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "1 inch emt",
      "1\\\" emt",
      "1 in conduit",
      "emt 1 inch",
      "electrical"
    ],
    "keywords": [
      "1 inch emt",
      "1\\\" emt",
      "1 in conduit",
      "emt 1 inch",
      "emt",
      "conduit",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "conduit-rigid-1in",
    "csi_division": "26",
    "csi_code": "26 05 33",
    "category": "electrical",
    "description": "1\" Rigid Metal Conduit (per LF)",
    "unit": "LF",
    "material_cost_cents": 585,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rigid conduit",
      "imc conduit",
      "rmc conduit",
      "galvanized conduit",
      "rigid metal conduit",
      "electrical"
    ],
    "keywords": [
      "rigid conduit",
      "imc conduit",
      "rmc conduit",
      "galvanized conduit",
      "rigid metal conduit",
      "rigid",
      "metal",
      "conduit",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "wire-12awg",
    "csi_division": "26",
    "csi_code": "26 05 19",
    "category": "electrical",
    "description": "#12 AWG THHN Wire (per LF)",
    "unit": "LF",
    "material_cost_cents": 28,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "12 awg wire",
      "#12 wire",
      "12 gauge wire",
      "12 awg thhn",
      "electrical"
    ],
    "keywords": [
      "12 awg wire",
      "#12 wire",
      "12 gauge wire",
      "12 awg thhn",
      "awg",
      "thhn",
      "wire",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "wire-10awg",
    "csi_division": "26",
    "csi_code": "26 05 19",
    "category": "electrical",
    "description": "#10 AWG THHN Wire (per LF)",
    "unit": "LF",
    "material_cost_cents": 48,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "10 awg wire",
      "#10 wire",
      "10 gauge wire",
      "10 awg thhn",
      "electrical"
    ],
    "keywords": [
      "10 awg wire",
      "#10 wire",
      "10 gauge wire",
      "10 awg thhn",
      "awg",
      "thhn",
      "wire",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "wire-8awg",
    "csi_division": "26",
    "csi_code": "26 05 19",
    "category": "electrical",
    "description": "#8 AWG THHN Wire (per LF)",
    "unit": "LF",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "8 awg wire",
      "#8 wire",
      "8 gauge wire",
      "8 awg thhn",
      "electrical"
    ],
    "keywords": [
      "8 awg wire",
      "#8 wire",
      "8 gauge wire",
      "8 awg thhn",
      "awg",
      "thhn",
      "wire",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "outlet-duplex",
    "csi_division": "26",
    "csi_code": "26 27 26",
    "category": "electrical",
    "description": "Duplex Receptacle/Outlet (per EA)",
    "unit": "EA",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "duplex outlet",
      "receptacle",
      "electrical outlet",
      "20 amp outlet",
      "gfci outlet",
      "electrical"
    ],
    "keywords": [
      "duplex outlet",
      "receptacle",
      "electrical outlet",
      "20 amp outlet",
      "gfci outlet",
      "duplex",
      "outlet",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "light-switch",
    "csi_division": "26",
    "csi_code": "26 27 26",
    "category": "electrical",
    "description": "Light Switch (per EA)",
    "unit": "EA",
    "material_cost_cents": 1250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "light switch",
      "single pole switch",
      "3-way switch",
      "dimmer switch",
      "electrical"
    ],
    "keywords": [
      "light switch",
      "single pole switch",
      "3-way switch",
      "dimmer switch",
      "light",
      "switch",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "circuit-breaker",
    "csi_division": "26",
    "csi_code": "26 24 00",
    "category": "electrical",
    "description": "Circuit Breaker (per EA)",
    "unit": "EA",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "circuit breaker",
      "breaker",
      "20 amp breaker",
      "panel breaker",
      "branch circuit",
      "electrical"
    ],
    "keywords": [
      "circuit breaker",
      "breaker",
      "20 amp breaker",
      "panel breaker",
      "branch circuit",
      "circuit",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "panel-board-200a",
    "csi_division": "26",
    "csi_code": "26 24 00",
    "category": "electrical",
    "description": "200A Electrical Panel (per EA)",
    "unit": "EA",
    "material_cost_cents": 185000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "200 amp panel",
      "200a panel",
      "electrical panel",
      "distribution panel",
      "load center",
      "electrical"
    ],
    "keywords": [
      "200 amp panel",
      "200a panel",
      "electrical panel",
      "distribution panel",
      "load center",
      "200a",
      "electrical",
      "panel",
      "per"
    ]
  },
  {
    "external_id": "panel-board-400a",
    "csi_division": "26",
    "csi_code": "26 24 00",
    "category": "electrical",
    "description": "400A Electrical Panel (per EA)",
    "unit": "EA",
    "material_cost_cents": 385000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "400 amp panel",
      "400a panel",
      "main panel",
      "service panel 400",
      "electrical"
    ],
    "keywords": [
      "400 amp panel",
      "400a panel",
      "main panel",
      "service panel 400",
      "400a",
      "electrical",
      "panel",
      "per"
    ]
  },
  {
    "external_id": "transformer",
    "csi_division": "26",
    "csi_code": "26 22 00",
    "category": "electrical",
    "description": "Dry Type Transformer (per KVA)",
    "unit": "KVA",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "transformer",
      "dry type transformer",
      "step down transformer",
      "distribution transformer",
      "electrical"
    ],
    "keywords": [
      "transformer",
      "dry type transformer",
      "step down transformer",
      "distribution transformer",
      "dry",
      "type",
      "per",
      "kva",
      "electrical"
    ]
  },
  {
    "external_id": "led-fixture-office",
    "csi_division": "26",
    "csi_code": "26 51 00",
    "category": "electrical",
    "description": "LED Troffer/Office Fixture (per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "led fixture",
      "office light",
      "troffer light",
      "2x4 led",
      "2x2 led",
      "recessed light",
      "electrical"
    ],
    "keywords": [
      "led fixture",
      "office light",
      "troffer light",
      "2x4 led",
      "2x2 led",
      "recessed light",
      "led",
      "troffer",
      "office",
      "fixture",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "led-fixture-exterior",
    "csi_division": "26",
    "csi_code": "26 56 00",
    "category": "electrical",
    "description": "Exterior LED Fixture (per EA)",
    "unit": "EA",
    "material_cost_cents": 28500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "exterior led",
      "wall pack",
      "parking lot light",
      "pole light",
      "area light",
      "electrical"
    ],
    "keywords": [
      "exterior led",
      "wall pack",
      "parking lot light",
      "pole light",
      "area light",
      "exterior",
      "led",
      "fixture",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "emergency-exit-light",
    "csi_division": "26",
    "csi_code": "26 53 00",
    "category": "electrical",
    "description": "Emergency Exit/Egress Light (per EA)",
    "unit": "EA",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "exit sign",
      "emergency light",
      "exit light",
      "emergency exit",
      "egress lighting",
      "electrical"
    ],
    "keywords": [
      "exit sign",
      "emergency light",
      "exit light",
      "emergency exit",
      "egress lighting",
      "emergency",
      "exit",
      "egress",
      "light",
      "per",
      "electrical"
    ]
  },
  {
    "external_id": "topsoil-removal",
    "csi_division": "31",
    "csi_code": "31 10 00",
    "category": "earthwork",
    "description": "Topsoil Stripping/Removal (per CY)",
    "unit": "CY",
    "material_cost_cents": 850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "topsoil removal",
      "strip topsoil",
      "topsoil stripping",
      "organic removal",
      "earthwork"
    ],
    "keywords": [
      "topsoil removal",
      "strip topsoil",
      "topsoil stripping",
      "organic removal",
      "topsoil",
      "stripping",
      "removal",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "rock-excavation",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Rock Excavation (per CY)",
    "unit": "CY",
    "material_cost_cents": 8500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "rock excavation",
      "rock blasting",
      "hard rock",
      "ledge rock",
      "rock removal",
      "earthwork"
    ],
    "keywords": [
      "rock excavation",
      "rock blasting",
      "hard rock",
      "ledge rock",
      "rock removal",
      "rock",
      "excavation",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "dewatering",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Dewatering System (per month)",
    "unit": "MO",
    "material_cost_cents": 285000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "dewatering",
      "well point",
      "sump pump",
      "groundwater control",
      "excavation dewatering",
      "earthwork"
    ],
    "keywords": [
      "dewatering",
      "well point",
      "sump pump",
      "groundwater control",
      "excavation dewatering",
      "system",
      "per",
      "month",
      "earthwork"
    ]
  },
  {
    "external_id": "shoring",
    "csi_division": "31",
    "csi_code": "31 41 00",
    "category": "earthwork",
    "description": "Excavation Shoring (per SF)",
    "unit": "SF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "shoring",
      "sheet piling",
      "soldier pile",
      "lagging",
      "excavation shoring",
      "earthwork"
    ],
    "keywords": [
      "shoring",
      "sheet piling",
      "soldier pile",
      "lagging",
      "excavation shoring",
      "excavation",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "erosion-control-silt-fence",
    "csi_division": "31",
    "csi_code": "31 25 00",
    "category": "earthwork",
    "description": "Silt Fence/Erosion Control (per LF)",
    "unit": "LF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "silt fence",
      "erosion control",
      "sediment fence",
      "filter fence",
      "earthwork"
    ],
    "keywords": [
      "silt fence",
      "erosion control",
      "sediment fence",
      "filter fence",
      "silt",
      "fence",
      "erosion",
      "control",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "straw-wattle",
    "csi_division": "31",
    "csi_code": "31 25 00",
    "category": "earthwork",
    "description": "Straw Wattle/Fiber Roll (per LF)",
    "unit": "LF",
    "material_cost_cents": 450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "straw wattle",
      "fiber roll",
      "erosion wattle",
      "sediment control",
      "earthwork"
    ],
    "keywords": [
      "straw wattle",
      "fiber roll",
      "erosion wattle",
      "sediment control",
      "straw",
      "wattle",
      "fiber",
      "roll",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "geotextile-fabric",
    "csi_division": "31",
    "csi_code": "31 05 00",
    "category": "earthwork",
    "description": "Geotextile Fabric (per SY)",
    "unit": "SY",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "geotextile",
      "filter fabric",
      "separation fabric",
      "geofabric",
      "woven fabric",
      "earthwork"
    ],
    "keywords": [
      "geotextile",
      "filter fabric",
      "separation fabric",
      "geofabric",
      "woven fabric",
      "fabric",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "crushed-stone-base",
    "csi_division": "31",
    "csi_code": "31 05 00",
    "category": "earthwork",
    "description": "Crushed Stone/Aggregate Base (per CY)",
    "unit": "CY",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "crushed stone",
      "stone base",
      "aggregate base",
      "gravel base",
      "road base",
      "abc stone",
      "earthwork"
    ],
    "keywords": [
      "crushed stone",
      "stone base",
      "aggregate base",
      "gravel base",
      "road base",
      "abc stone",
      "crushed",
      "stone",
      "aggregate",
      "base",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "sand-fill",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Sand Fill/Backfill (per CY)",
    "unit": "CY",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sand fill",
      "clean sand",
      "washed sand",
      "sand backfill",
      "earthwork"
    ],
    "keywords": [
      "sand fill",
      "clean sand",
      "washed sand",
      "sand backfill",
      "sand",
      "fill",
      "backfill",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "flowable-fill",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "earthwork",
    "description": "Flowable Fill/CLSM (per CY)",
    "unit": "CY",
    "material_cost_cents": 9500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "flowable fill",
      "clsm",
      "controlled low strength material",
      "lean concrete fill",
      "earthwork"
    ],
    "keywords": [
      "flowable fill",
      "clsm",
      "controlled low strength material",
      "lean concrete fill",
      "flowable",
      "fill",
      "per",
      "earthwork"
    ]
  },
  {
    "external_id": "asphalt-paving-2in",
    "csi_division": "32",
    "csi_code": "32 12 00",
    "category": "exterior",
    "description": "2\" Asphalt Paving (per SF)",
    "unit": "SF",
    "material_cost_cents": 185,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "2 inch asphalt",
      "2\\\" asphalt",
      "asphalt overlay",
      "asphalt wearing course",
      "exterior"
    ],
    "keywords": [
      "2 inch asphalt",
      "2\\\" asphalt",
      "asphalt overlay",
      "asphalt wearing course",
      "asphalt",
      "paving",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "asphalt-paving-3in",
    "csi_division": "32",
    "csi_code": "32 12 00",
    "category": "exterior",
    "description": "3\" Asphalt Paving (per SF)",
    "unit": "SF",
    "material_cost_cents": 285,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "3 inch asphalt",
      "3\\\" asphalt",
      "full depth asphalt",
      "asphalt parking lot",
      "exterior"
    ],
    "keywords": [
      "3 inch asphalt",
      "3\\\" asphalt",
      "full depth asphalt",
      "asphalt parking lot",
      "asphalt",
      "paving",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "concrete-sidewalk-4in",
    "csi_division": "32",
    "csi_code": "32 13 00",
    "category": "exterior",
    "description": "4\" Concrete Sidewalk (per SF)",
    "unit": "SF",
    "material_cost_cents": 550,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "4 inch sidewalk",
      "4\\\" concrete walk",
      "concrete sidewalk",
      "pedestrian walk",
      "exterior"
    ],
    "keywords": [
      "4 inch sidewalk",
      "4\\\" concrete walk",
      "concrete sidewalk",
      "pedestrian walk",
      "concrete",
      "sidewalk",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "concrete-curb-gutter",
    "csi_division": "32",
    "csi_code": "32 16 00",
    "category": "exterior",
    "description": "Concrete Curb & Gutter (per LF)",
    "unit": "LF",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "curb and gutter",
      "concrete curb",
      "type b curb",
      "curb gutter",
      "roll curb",
      "exterior"
    ],
    "keywords": [
      "curb and gutter",
      "concrete curb",
      "type b curb",
      "curb gutter",
      "roll curb",
      "concrete",
      "curb",
      "gutter",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "concrete-curb-only",
    "csi_division": "32",
    "csi_code": "32 16 00",
    "category": "exterior",
    "description": "Concrete Curb Only (per LF)",
    "unit": "LF",
    "material_cost_cents": 1450,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "concrete curb",
      "vertical curb",
      "barrier curb",
      "curb only",
      "exterior"
    ],
    "keywords": [
      "concrete curb",
      "vertical curb",
      "barrier curb",
      "curb only",
      "concrete",
      "curb",
      "only",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "pavement-markings",
    "csi_division": "32",
    "csi_code": "32 17 00",
    "category": "exterior",
    "description": "Pavement Markings/Striping (per LF)",
    "unit": "LF",
    "material_cost_cents": 65,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "pavement markings",
      "striping",
      "parking lot striping",
      "traffic markings",
      "painted lines",
      "exterior"
    ],
    "keywords": [
      "pavement markings",
      "striping",
      "parking lot striping",
      "traffic markings",
      "painted lines",
      "pavement",
      "markings",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "parking-bumper",
    "csi_division": "32",
    "csi_code": "32 17 00",
    "category": "exterior",
    "description": "Concrete Parking Bumper/Wheel Stop (per EA)",
    "unit": "EA",
    "material_cost_cents": 4800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "parking bumper",
      "wheel stop",
      "car stop",
      "concrete bumper",
      "exterior"
    ],
    "keywords": [
      "parking bumper",
      "wheel stop",
      "car stop",
      "concrete bumper",
      "concrete",
      "parking",
      "bumper",
      "wheel",
      "stop",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "chain-link-fence-6ft",
    "csi_division": "32",
    "csi_code": "32 31 00",
    "category": "exterior",
    "description": "6' Chain Link Fence (per LF)",
    "unit": "LF",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "6 foot chain link",
      "6 ft chain link fence",
      "chain link 6 ft",
      "security fence",
      "exterior"
    ],
    "keywords": [
      "6 foot chain link",
      "6 ft chain link fence",
      "chain link 6 ft",
      "security fence",
      "chain",
      "link",
      "fence",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "wood-fence",
    "csi_division": "32",
    "csi_code": "32 32 00",
    "category": "exterior",
    "description": "Wood Privacy Fence (per LF)",
    "unit": "LF",
    "material_cost_cents": 2200,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "wood fence",
      "privacy fence",
      "cedar fence",
      "wood privacy fence",
      "exterior"
    ],
    "keywords": [
      "wood fence",
      "privacy fence",
      "cedar fence",
      "wood privacy fence",
      "wood",
      "privacy",
      "fence",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "ornamental-fence",
    "csi_division": "32",
    "csi_code": "32 31 00",
    "category": "exterior",
    "description": "Ornamental Iron/Aluminum Fence (per LF)",
    "unit": "LF",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "ornamental fence",
      "wrought iron fence",
      "aluminum fence",
      "decorative fence",
      "exterior"
    ],
    "keywords": [
      "ornamental fence",
      "wrought iron fence",
      "aluminum fence",
      "decorative fence",
      "ornamental",
      "iron",
      "aluminum",
      "fence",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "landscape-mulch",
    "csi_division": "32",
    "csi_code": "32 91 00",
    "category": "exterior",
    "description": "Landscape Mulch (per CY)",
    "unit": "CY",
    "material_cost_cents": 4500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "mulch",
      "wood mulch",
      "bark mulch",
      "landscape mulch",
      "ground cover mulch",
      "exterior"
    ],
    "keywords": [
      "mulch",
      "wood mulch",
      "bark mulch",
      "landscape mulch",
      "ground cover mulch",
      "landscape",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "sod",
    "csi_division": "32",
    "csi_code": "32 92 00",
    "category": "exterior",
    "description": "Sod/Turf (per SY)",
    "unit": "SY",
    "material_cost_cents": 385,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "sod",
      "turf",
      "lawn sod",
      "grass sod",
      "bermuda sod",
      "fescue sod",
      "exterior"
    ],
    "keywords": [
      "sod",
      "turf",
      "lawn sod",
      "grass sod",
      "bermuda sod",
      "fescue sod",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "seed-and-straw",
    "csi_division": "32",
    "csi_code": "32 92 00",
    "category": "exterior",
    "description": "Seeding & Straw (per SY)",
    "unit": "SY",
    "material_cost_cents": 85,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "seeding",
      "grass seed",
      "hydroseed",
      "seed and straw",
      "lawn seeding",
      "exterior"
    ],
    "keywords": [
      "seeding",
      "grass seed",
      "hydroseed",
      "seed and straw",
      "lawn seeding",
      "straw",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "irrigation-system",
    "csi_division": "32",
    "csi_code": "32 84 00",
    "category": "exterior",
    "description": "Irrigation System (per SF)",
    "unit": "SF",
    "material_cost_cents": 125,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "irrigation",
      "sprinkler system",
      "drip irrigation",
      "landscape irrigation",
      "exterior"
    ],
    "keywords": [
      "irrigation",
      "sprinkler system",
      "drip irrigation",
      "landscape irrigation",
      "system",
      "per",
      "exterior"
    ]
  },
  {
    "external_id": "storm-drain-18in",
    "csi_division": "33",
    "csi_code": "33 41 00",
    "category": "utilities",
    "description": "18\" Storm Drain Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "18 inch storm drain",
      "18 in storm pipe",
      "storm sewer 18",
      "rcp 18",
      "utilities"
    ],
    "keywords": [
      "18 inch storm drain",
      "18 in storm pipe",
      "storm sewer 18",
      "rcp 18",
      "storm",
      "drain",
      "pipe",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "storm-drain-24in",
    "csi_division": "33",
    "csi_code": "33 41 00",
    "category": "utilities",
    "description": "24\" Storm Drain Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 5800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "24 inch storm drain",
      "24 in storm pipe",
      "storm sewer 24",
      "rcp 24",
      "utilities"
    ],
    "keywords": [
      "24 inch storm drain",
      "24 in storm pipe",
      "storm sewer 24",
      "rcp 24",
      "storm",
      "drain",
      "pipe",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "storm-drain-36in",
    "csi_division": "33",
    "csi_code": "33 41 00",
    "category": "utilities",
    "description": "36\" Storm Drain Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 9500,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "36 inch storm drain",
      "36 in storm pipe",
      "storm sewer 36",
      "rcp 36",
      "utilities"
    ],
    "keywords": [
      "36 inch storm drain",
      "36 in storm pipe",
      "storm sewer 36",
      "rcp 36",
      "storm",
      "drain",
      "pipe",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "sanitary-sewer-8in",
    "csi_division": "33",
    "csi_code": "33 31 00",
    "category": "utilities",
    "description": "8\" Sanitary Sewer Pipe (per LF)",
    "unit": "LF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "8 inch sewer",
      "8 in sanitary sewer",
      "gravity sewer 8",
      "sewer pipe 8",
      "utilities"
    ],
    "keywords": [
      "8 inch sewer",
      "8 in sanitary sewer",
      "gravity sewer 8",
      "sewer pipe 8",
      "sanitary",
      "sewer",
      "pipe",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "water-main-6in",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "utilities",
    "description": "6\" Water Main (per LF)",
    "unit": "LF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "6 inch water main",
      "6 in water pipe",
      "water main 6",
      "water line 6",
      "utilities"
    ],
    "keywords": [
      "6 inch water main",
      "6 in water pipe",
      "water main 6",
      "water line 6",
      "water",
      "main",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "water-main-8in",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "utilities",
    "description": "8\" Water Main (per LF)",
    "unit": "LF",
    "material_cost_cents": 3800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "8 inch water main",
      "8 in water pipe",
      "water main 8",
      "water line 8",
      "utilities"
    ],
    "keywords": [
      "8 inch water main",
      "8 in water pipe",
      "water main 8",
      "water line 8",
      "water",
      "main",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "water-service-1in",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "utilities",
    "description": "1\" Water Service Line (per LF)",
    "unit": "LF",
    "material_cost_cents": 1250,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "1 inch water service",
      "water service line",
      "domestic water service",
      "water tap",
      "utilities"
    ],
    "keywords": [
      "1 inch water service",
      "water service line",
      "domestic water service",
      "water tap",
      "water",
      "service",
      "line",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "electric-duct-bank",
    "csi_division": "33",
    "csi_code": "33 71 00",
    "category": "utilities",
    "description": "Electrical Duct Bank (per LF)",
    "unit": "LF",
    "material_cost_cents": 2800,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "duct bank",
      "electric duct bank",
      "underground power",
      "conduit bank",
      "utilities"
    ],
    "keywords": [
      "duct bank",
      "electric duct bank",
      "underground power",
      "conduit bank",
      "electrical",
      "duct",
      "bank",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "vault-precast",
    "csi_division": "33",
    "csi_code": "33 71 00",
    "category": "utilities",
    "description": "Precast Utility Vault (per EA)",
    "unit": "EA",
    "material_cost_cents": 485000,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "precast vault",
      "electric vault",
      "utility vault",
      "transformer vault",
      "utilities"
    ],
    "keywords": [
      "precast vault",
      "electric vault",
      "utility vault",
      "transformer vault",
      "precast",
      "utility",
      "vault",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "detention-basin",
    "csi_division": "33",
    "csi_code": "33 41 00",
    "category": "utilities",
    "description": "Detention/Retention Basin Excavation (per CY)",
    "unit": "CY",
    "material_cost_cents": 1850,
    "labor_cost_cents": 0,
    "crew_size": null,
    "productivity_per_hour": null,
    "synonyms": [
      "detention basin",
      "retention pond",
      "stormwater basin",
      "bioretention",
      "utilities"
    ],
    "keywords": [
      "detention basin",
      "retention pond",
      "stormwater basin",
      "bioretention",
      "detention",
      "retention",
      "basin",
      "excavation",
      "per",
      "utilities"
    ]
  },
  {
    "external_id": "labor-temp-fence",
    "csi_division": "01",
    "csi_code": "01 56 00",
    "category": "general",
    "description": "Temporary Chain Link Fence Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 350,
    "crew_size": 2,
    "productivity_per_hour": 80,
    "synonyms": [
      "general",
      "temporary",
      "chain",
      "link",
      "fence",
      "installation"
    ],
    "keywords": [
      "temporary",
      "chain",
      "link",
      "fence",
      "installation",
      "general"
    ]
  },
  {
    "external_id": "labor-temp-toilet",
    "csi_division": "01",
    "csi_code": "01 52 00",
    "category": "general",
    "description": "Portable Toilet Service/Maintenance",
    "unit": "MO",
    "material_cost_cents": 0,
    "labor_cost_cents": 4500,
    "crew_size": 1,
    "productivity_per_hour": 4,
    "synonyms": [
      "general",
      "portable",
      "toilet",
      "service",
      "maintenance"
    ],
    "keywords": [
      "portable",
      "toilet",
      "service",
      "maintenance",
      "general"
    ]
  },
  {
    "external_id": "labor-dumpster",
    "csi_division": "01",
    "csi_code": "01 74 00",
    "category": "general",
    "description": "Dumpster Rental/Haul Coordination",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 8500,
    "crew_size": 1,
    "productivity_per_hour": 2,
    "synonyms": [
      "general",
      "dumpster",
      "rental",
      "haul",
      "coordination"
    ],
    "keywords": [
      "dumpster",
      "rental",
      "haul",
      "coordination",
      "general"
    ]
  },
  {
    "external_id": "labor-cleanup",
    "csi_division": "01",
    "csi_code": "01 74 00",
    "category": "general",
    "description": "Final Construction Cleanup",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 15,
    "crew_size": 3,
    "productivity_per_hour": 2000,
    "synonyms": [
      "general",
      "final",
      "construction",
      "cleanup"
    ],
    "keywords": [
      "final",
      "construction",
      "cleanup",
      "general"
    ]
  },
  {
    "external_id": "labor-layout",
    "csi_division": "01",
    "csi_code": "01 71 00",
    "category": "general",
    "description": "Building Layout & Staking",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 8,
    "crew_size": 2,
    "productivity_per_hour": 5000,
    "synonyms": [
      "general",
      "building",
      "layout",
      "staking"
    ],
    "keywords": [
      "building",
      "layout",
      "staking",
      "general"
    ]
  },
  {
    "external_id": "labor-demo-interior",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "demo",
    "description": "Interior Selective Demolition",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 250,
    "crew_size": 3,
    "productivity_per_hour": 200,
    "synonyms": [
      "demo",
      "interior",
      "selective",
      "demolition"
    ],
    "keywords": [
      "interior",
      "selective",
      "demolition",
      "demo"
    ]
  },
  {
    "external_id": "labor-demo-concrete",
    "csi_division": "02",
    "csi_code": "02 41 00",
    "category": "demo",
    "description": "Concrete Demolition & Removal",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 450,
    "crew_size": 3,
    "productivity_per_hour": 100,
    "synonyms": [
      "demo",
      "concrete",
      "demolition",
      "removal"
    ],
    "keywords": [
      "concrete",
      "demolition",
      "removal",
      "demo"
    ]
  },
  {
    "external_id": "labor-abatement",
    "csi_division": "02",
    "csi_code": "02 82 00",
    "category": "demo",
    "description": "Asbestos Abatement",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 600,
    "crew_size": 4,
    "productivity_per_hour": 150,
    "synonyms": [
      "demo",
      "asbestos",
      "abatement"
    ],
    "keywords": [
      "asbestos",
      "abatement",
      "demo"
    ]
  },
  {
    "external_id": "labor-slab-4in",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "4\" Concrete Slab - Place & Finish",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 385,
    "crew_size": 6,
    "productivity_per_hour": 250,
    "synonyms": [
      "concrete",
      "slab",
      "place",
      "finish"
    ],
    "keywords": [
      "concrete",
      "slab",
      "place",
      "finish"
    ]
  },
  {
    "external_id": "labor-slab-6in",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "6\" Concrete Slab - Place & Finish",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 425,
    "crew_size": 6,
    "productivity_per_hour": 220,
    "synonyms": [
      "concrete",
      "slab",
      "place",
      "finish"
    ],
    "keywords": [
      "concrete",
      "slab",
      "place",
      "finish"
    ]
  },
  {
    "external_id": "labor-footing",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Continuous Footing - Form, Pour, Strip",
    "unit": "CY",
    "material_cost_cents": 0,
    "labor_cost_cents": 6500,
    "crew_size": 4,
    "productivity_per_hour": 8,
    "synonyms": [
      "concrete",
      "continuous",
      "footing",
      "form",
      "pour",
      "strip"
    ],
    "keywords": [
      "continuous",
      "footing",
      "form",
      "pour",
      "strip",
      "concrete"
    ]
  },
  {
    "external_id": "labor-wall-concrete",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Wall - Form, Pour, Strip",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1250,
    "crew_size": 5,
    "productivity_per_hour": 80,
    "synonyms": [
      "concrete",
      "wall",
      "form",
      "pour",
      "strip"
    ],
    "keywords": [
      "concrete",
      "wall",
      "form",
      "pour",
      "strip"
    ]
  },
  {
    "external_id": "labor-rebar",
    "csi_division": "03",
    "csi_code": "03 21 00",
    "category": "concrete",
    "description": "Rebar - Place & Tie",
    "unit": "LB",
    "material_cost_cents": 0,
    "labor_cost_cents": 45,
    "crew_size": 3,
    "productivity_per_hour": 400,
    "synonyms": [
      "concrete",
      "rebar",
      "place",
      "tie"
    ],
    "keywords": [
      "rebar",
      "place",
      "tie",
      "concrete"
    ]
  },
  {
    "external_id": "labor-formwork",
    "csi_division": "03",
    "csi_code": "03 11 00",
    "category": "concrete",
    "description": "Formwork - Build, Set, Strip",
    "unit": "SFCA",
    "material_cost_cents": 0,
    "labor_cost_cents": 550,
    "crew_size": 4,
    "productivity_per_hour": 120,
    "synonyms": [
      "concrete",
      "formwork",
      "build",
      "set",
      "strip"
    ],
    "keywords": [
      "formwork",
      "build",
      "set",
      "strip",
      "concrete"
    ]
  },
  {
    "external_id": "labor-wire-mesh",
    "csi_division": "03",
    "csi_code": "03 22 00",
    "category": "concrete",
    "description": "Welded Wire Mesh - Place",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 25,
    "crew_size": 2,
    "productivity_per_hour": 800,
    "synonyms": [
      "concrete",
      "welded",
      "wire",
      "mesh",
      "place"
    ],
    "keywords": [
      "welded",
      "wire",
      "mesh",
      "place",
      "concrete"
    ]
  },
  {
    "external_id": "labor-concrete-pump",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Concrete Pumping",
    "unit": "CY",
    "material_cost_cents": 0,
    "labor_cost_cents": 1800,
    "crew_size": 2,
    "productivity_per_hour": 25,
    "synonyms": [
      "concrete",
      "pumping"
    ],
    "keywords": [
      "concrete",
      "pumping"
    ]
  },
  {
    "external_id": "labor-curb-gutter",
    "csi_division": "03",
    "csi_code": "03 30 00",
    "category": "concrete",
    "description": "Curb & Gutter - Form, Pour, Finish",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 850,
    "crew_size": 4,
    "productivity_per_hour": 100,
    "synonyms": [
      "concrete",
      "curb",
      "gutter",
      "form",
      "pour",
      "finish"
    ],
    "keywords": [
      "curb",
      "gutter",
      "form",
      "pour",
      "finish",
      "concrete"
    ]
  },
  {
    "external_id": "labor-cmu-8in",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "8\" CMU Block Wall - Lay & Grout",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 850,
    "crew_size": 3,
    "productivity_per_hour": 80,
    "synonyms": [
      "masonry",
      "cmu",
      "block",
      "wall",
      "lay",
      "grout"
    ],
    "keywords": [
      "cmu",
      "block",
      "wall",
      "lay",
      "grout",
      "masonry"
    ]
  },
  {
    "external_id": "labor-cmu-12in",
    "csi_division": "04",
    "csi_code": "04 22 00",
    "category": "masonry",
    "description": "12\" CMU Block Wall - Lay & Grout",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1050,
    "crew_size": 3,
    "productivity_per_hour": 65,
    "synonyms": [
      "masonry",
      "cmu",
      "block",
      "wall",
      "lay",
      "grout"
    ],
    "keywords": [
      "cmu",
      "block",
      "wall",
      "lay",
      "grout",
      "masonry"
    ]
  },
  {
    "external_id": "labor-brick-veneer",
    "csi_division": "04",
    "csi_code": "04 21 00",
    "category": "masonry",
    "description": "Brick Veneer - Lay",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1200,
    "crew_size": 3,
    "productivity_per_hour": 50,
    "synonyms": [
      "masonry",
      "brick",
      "veneer",
      "lay"
    ],
    "keywords": [
      "brick",
      "veneer",
      "lay",
      "masonry"
    ]
  },
  {
    "external_id": "labor-stone-veneer",
    "csi_division": "04",
    "csi_code": "04 42 00",
    "category": "masonry",
    "description": "Stone Veneer - Install",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1800,
    "crew_size": 2,
    "productivity_per_hour": 30,
    "synonyms": [
      "masonry",
      "stone",
      "veneer",
      "install"
    ],
    "keywords": [
      "stone",
      "veneer",
      "install",
      "masonry"
    ]
  },
  {
    "external_id": "labor-struct-steel",
    "csi_division": "05",
    "csi_code": "05 12 00",
    "category": "metals",
    "description": "Structural Steel Erection",
    "unit": "TON",
    "material_cost_cents": 0,
    "labor_cost_cents": 85000,
    "crew_size": 4,
    "productivity_per_hour": 1.5,
    "synonyms": [
      "metals",
      "structural",
      "steel",
      "erection"
    ],
    "keywords": [
      "structural",
      "steel",
      "erection",
      "metals"
    ]
  },
  {
    "external_id": "labor-steel-joist",
    "csi_division": "05",
    "csi_code": "05 21 00",
    "category": "metals",
    "description": "Steel Joist Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 650,
    "crew_size": 4,
    "productivity_per_hour": 120,
    "synonyms": [
      "metals",
      "steel",
      "joist",
      "installation"
    ],
    "keywords": [
      "steel",
      "joist",
      "installation",
      "metals"
    ]
  },
  {
    "external_id": "labor-metal-deck",
    "csi_division": "05",
    "csi_code": "05 31 00",
    "category": "metals",
    "description": "Metal Deck Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 225,
    "crew_size": 4,
    "productivity_per_hour": 400,
    "synonyms": [
      "metals",
      "metal",
      "deck",
      "installation"
    ],
    "keywords": [
      "metal",
      "deck",
      "installation",
      "metals"
    ]
  },
  {
    "external_id": "labor-misc-metals",
    "csi_division": "05",
    "csi_code": "05 50 00",
    "category": "metals",
    "description": "Miscellaneous Metals - Fabricate & Install",
    "unit": "LB",
    "material_cost_cents": 0,
    "labor_cost_cents": 150,
    "crew_size": 2,
    "productivity_per_hour": 100,
    "synonyms": [
      "metals",
      "miscellaneous",
      "fabricate",
      "install"
    ],
    "keywords": [
      "miscellaneous",
      "metals",
      "fabricate",
      "install"
    ]
  },
  {
    "external_id": "labor-handrail",
    "csi_division": "05",
    "csi_code": "05 52 00",
    "category": "metals",
    "description": "Metal Handrail Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 2200,
    "crew_size": 2,
    "productivity_per_hour": 30,
    "synonyms": [
      "metals",
      "metal",
      "handrail",
      "installation"
    ],
    "keywords": [
      "metal",
      "handrail",
      "installation",
      "metals"
    ]
  },
  {
    "external_id": "labor-framing-wall",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Wood Wall Framing",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 350,
    "crew_size": 3,
    "productivity_per_hour": 200,
    "synonyms": [
      "wood",
      "wall",
      "framing"
    ],
    "keywords": [
      "wood",
      "wall",
      "framing"
    ]
  },
  {
    "external_id": "labor-framing-floor",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Wood Floor Framing",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 325,
    "crew_size": 3,
    "productivity_per_hour": 220,
    "synonyms": [
      "wood",
      "floor",
      "framing"
    ],
    "keywords": [
      "wood",
      "floor",
      "framing"
    ]
  },
  {
    "external_id": "labor-framing-roof",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Wood Roof Framing",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 400,
    "crew_size": 3,
    "productivity_per_hour": 180,
    "synonyms": [
      "wood",
      "roof",
      "framing"
    ],
    "keywords": [
      "wood",
      "roof",
      "framing"
    ]
  },
  {
    "external_id": "labor-trusses",
    "csi_division": "06",
    "csi_code": "06 17 53",
    "category": "wood",
    "description": "Truss Installation (pre-engineered)",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 250,
    "crew_size": 4,
    "productivity_per_hour": 300,
    "synonyms": [
      "wood",
      "truss",
      "installation",
      "pre",
      "engineered"
    ],
    "keywords": [
      "truss",
      "installation",
      "pre",
      "engineered",
      "wood"
    ]
  },
  {
    "external_id": "labor-sheathing",
    "csi_division": "06",
    "csi_code": "06 16 00",
    "category": "wood",
    "description": "Plywood/OSB Sheathing",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 125,
    "crew_size": 2,
    "productivity_per_hour": 500,
    "synonyms": [
      "wood",
      "plywood",
      "osb",
      "sheathing"
    ],
    "keywords": [
      "plywood",
      "osb",
      "sheathing",
      "wood"
    ]
  },
  {
    "external_id": "labor-blocking",
    "csi_division": "06",
    "csi_code": "06 11 00",
    "category": "wood",
    "description": "Wood Blocking/Nailer",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 200,
    "crew_size": 1,
    "productivity_per_hour": 100,
    "synonyms": [
      "wood",
      "blocking",
      "nailer"
    ],
    "keywords": [
      "wood",
      "blocking",
      "nailer"
    ]
  },
  {
    "external_id": "labor-trim-finish",
    "csi_division": "06",
    "csi_code": "06 22 00",
    "category": "wood",
    "description": "Finish Carpentry / Trim",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 350,
    "crew_size": 1,
    "productivity_per_hour": 60,
    "synonyms": [
      "wood",
      "finish",
      "carpentry",
      "trim"
    ],
    "keywords": [
      "finish",
      "carpentry",
      "trim",
      "wood"
    ]
  },
  {
    "external_id": "labor-cabinets",
    "csi_division": "06",
    "csi_code": "06 41 00",
    "category": "wood",
    "description": "Cabinet Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 4500,
    "crew_size": 2,
    "productivity_per_hour": 8,
    "synonyms": [
      "wood",
      "cabinet",
      "installation"
    ],
    "keywords": [
      "cabinet",
      "installation",
      "wood"
    ]
  },
  {
    "external_id": "labor-countertop",
    "csi_division": "06",
    "csi_code": "06 65 00",
    "category": "wood",
    "description": "Countertop Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 3500,
    "crew_size": 2,
    "productivity_per_hour": 10,
    "synonyms": [
      "wood",
      "countertop",
      "installation"
    ],
    "keywords": [
      "countertop",
      "installation",
      "wood"
    ]
  },
  {
    "external_id": "labor-insulation-batt",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Batt Insulation Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 65,
    "crew_size": 2,
    "productivity_per_hour": 600,
    "synonyms": [
      "thermal",
      "batt",
      "insulation",
      "installation"
    ],
    "keywords": [
      "batt",
      "insulation",
      "installation",
      "thermal"
    ]
  },
  {
    "external_id": "labor-insulation-rigid",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Rigid Insulation Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 125,
    "crew_size": 2,
    "productivity_per_hour": 400,
    "synonyms": [
      "thermal",
      "rigid",
      "insulation",
      "installation"
    ],
    "keywords": [
      "rigid",
      "insulation",
      "installation",
      "thermal"
    ]
  },
  {
    "external_id": "labor-insulation-spray",
    "csi_division": "07",
    "csi_code": "07 21 00",
    "category": "thermal",
    "description": "Spray Foam Insulation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 185,
    "crew_size": 2,
    "productivity_per_hour": 300,
    "synonyms": [
      "thermal",
      "spray",
      "foam",
      "insulation"
    ],
    "keywords": [
      "spray",
      "foam",
      "insulation",
      "thermal"
    ]
  },
  {
    "external_id": "labor-roofing-shingle",
    "csi_division": "07",
    "csi_code": "07 31 00",
    "category": "thermal",
    "description": "Asphalt Shingle Roofing",
    "unit": "SQ",
    "material_cost_cents": 0,
    "labor_cost_cents": 8500,
    "crew_size": 4,
    "productivity_per_hour": 5,
    "synonyms": [
      "thermal",
      "asphalt",
      "shingle",
      "roofing"
    ],
    "keywords": [
      "asphalt",
      "shingle",
      "roofing",
      "thermal"
    ]
  },
  {
    "external_id": "labor-roofing-tpo",
    "csi_division": "07",
    "csi_code": "07 54 00",
    "category": "thermal",
    "description": "TPO/Single-Ply Roofing",
    "unit": "SQ",
    "material_cost_cents": 0,
    "labor_cost_cents": 12000,
    "crew_size": 3,
    "productivity_per_hour": 4,
    "synonyms": [
      "thermal",
      "tpo",
      "single",
      "ply",
      "roofing"
    ],
    "keywords": [
      "tpo",
      "single",
      "ply",
      "roofing",
      "thermal"
    ]
  },
  {
    "external_id": "labor-roofing-metal",
    "csi_division": "07",
    "csi_code": "07 61 00",
    "category": "thermal",
    "description": "Standing Seam Metal Roofing",
    "unit": "SQ",
    "material_cost_cents": 0,
    "labor_cost_cents": 15000,
    "crew_size": 3,
    "productivity_per_hour": 3,
    "synonyms": [
      "thermal",
      "standing",
      "seam",
      "metal",
      "roofing"
    ],
    "keywords": [
      "standing",
      "seam",
      "metal",
      "roofing",
      "thermal"
    ]
  },
  {
    "external_id": "labor-flashing",
    "csi_division": "07",
    "csi_code": "07 62 00",
    "category": "thermal",
    "description": "Sheet Metal Flashing",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 650,
    "crew_size": 2,
    "productivity_per_hour": 60,
    "synonyms": [
      "thermal",
      "sheet",
      "metal",
      "flashing"
    ],
    "keywords": [
      "sheet",
      "metal",
      "flashing",
      "thermal"
    ]
  },
  {
    "external_id": "labor-waterproofing",
    "csi_division": "07",
    "csi_code": "07 13 00",
    "category": "thermal",
    "description": "Waterproofing Membrane Application",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 250,
    "crew_size": 2,
    "productivity_per_hour": 300,
    "synonyms": [
      "thermal",
      "waterproofing",
      "membrane",
      "application"
    ],
    "keywords": [
      "waterproofing",
      "membrane",
      "application",
      "thermal"
    ]
  },
  {
    "external_id": "labor-siding-vinyl",
    "csi_division": "07",
    "csi_code": "07 46 00",
    "category": "thermal",
    "description": "Vinyl Siding Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 225,
    "crew_size": 2,
    "productivity_per_hour": 250,
    "synonyms": [
      "thermal",
      "vinyl",
      "siding",
      "installation"
    ],
    "keywords": [
      "vinyl",
      "siding",
      "installation",
      "thermal"
    ]
  },
  {
    "external_id": "labor-siding-fiber",
    "csi_division": "07",
    "csi_code": "07 46 00",
    "category": "thermal",
    "description": "Fiber Cement Siding (HardiPlank)",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 350,
    "crew_size": 2,
    "productivity_per_hour": 180,
    "synonyms": [
      "thermal",
      "fiber",
      "cement",
      "siding",
      "hardiplank"
    ],
    "keywords": [
      "fiber",
      "cement",
      "siding",
      "hardiplank",
      "thermal"
    ]
  },
  {
    "external_id": "labor-gutter",
    "csi_division": "07",
    "csi_code": "07 71 00",
    "category": "thermal",
    "description": "Gutter & Downspout Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 450,
    "crew_size": 2,
    "productivity_per_hour": 100,
    "synonyms": [
      "thermal",
      "gutter",
      "downspout",
      "installation"
    ],
    "keywords": [
      "gutter",
      "downspout",
      "installation",
      "thermal"
    ]
  },
  {
    "external_id": "labor-door-wood",
    "csi_division": "08",
    "csi_code": "08 14 00",
    "category": "openings",
    "description": "Wood Door & Frame Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 18500,
    "crew_size": 2,
    "productivity_per_hour": 4,
    "synonyms": [
      "openings",
      "wood",
      "door",
      "frame",
      "installation"
    ],
    "keywords": [
      "wood",
      "door",
      "frame",
      "installation",
      "openings"
    ]
  },
  {
    "external_id": "labor-door-hm",
    "csi_division": "08",
    "csi_code": "08 11 00",
    "category": "openings",
    "description": "Hollow Metal Door & Frame",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 25000,
    "crew_size": 2,
    "productivity_per_hour": 3,
    "synonyms": [
      "openings",
      "hollow",
      "metal",
      "door",
      "frame"
    ],
    "keywords": [
      "hollow",
      "metal",
      "door",
      "frame",
      "openings"
    ]
  },
  {
    "external_id": "labor-door-glass",
    "csi_division": "08",
    "csi_code": "08 41 00",
    "category": "openings",
    "description": "Glass Storefront Door",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 65000,
    "crew_size": 2,
    "productivity_per_hour": 1.5,
    "synonyms": [
      "openings",
      "glass",
      "storefront",
      "door"
    ],
    "keywords": [
      "glass",
      "storefront",
      "door",
      "openings"
    ]
  },
  {
    "external_id": "labor-window-vinyl",
    "csi_division": "08",
    "csi_code": "08 52 00",
    "category": "openings",
    "description": "Vinyl Window Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 12500,
    "crew_size": 2,
    "productivity_per_hour": 6,
    "synonyms": [
      "openings",
      "vinyl",
      "window",
      "installation"
    ],
    "keywords": [
      "vinyl",
      "window",
      "installation",
      "openings"
    ]
  },
  {
    "external_id": "labor-window-aluminum",
    "csi_division": "08",
    "csi_code": "08 51 00",
    "category": "openings",
    "description": "Aluminum Window Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1500,
    "crew_size": 2,
    "productivity_per_hour": 40,
    "synonyms": [
      "openings",
      "aluminum",
      "window",
      "installation"
    ],
    "keywords": [
      "aluminum",
      "window",
      "installation",
      "openings"
    ]
  },
  {
    "external_id": "labor-curtainwall",
    "csi_division": "08",
    "csi_code": "08 44 00",
    "category": "openings",
    "description": "Curtain Wall Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 2500,
    "crew_size": 3,
    "productivity_per_hour": 30,
    "synonyms": [
      "openings",
      "curtain",
      "wall",
      "installation"
    ],
    "keywords": [
      "curtain",
      "wall",
      "installation",
      "openings"
    ]
  },
  {
    "external_id": "labor-hardware",
    "csi_division": "08",
    "csi_code": "08 71 00",
    "category": "openings",
    "description": "Door Hardware Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 8500,
    "crew_size": 1,
    "productivity_per_hour": 6,
    "synonyms": [
      "openings",
      "door",
      "hardware",
      "installation"
    ],
    "keywords": [
      "door",
      "hardware",
      "installation",
      "openings"
    ]
  },
  {
    "external_id": "labor-overhead-door",
    "csi_division": "08",
    "csi_code": "08 36 00",
    "category": "openings",
    "description": "Overhead/Sectional Door",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 45000,
    "crew_size": 2,
    "productivity_per_hour": 1.5,
    "synonyms": [
      "openings",
      "overhead",
      "sectional",
      "door"
    ],
    "keywords": [
      "overhead",
      "sectional",
      "door",
      "openings"
    ]
  },
  {
    "external_id": "labor-drywall-hang",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "Drywall - Hang",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 125,
    "crew_size": 2,
    "productivity_per_hour": 400,
    "synonyms": [
      "finishes",
      "drywall",
      "hang"
    ],
    "keywords": [
      "drywall",
      "hang",
      "finishes"
    ]
  },
  {
    "external_id": "labor-drywall-tape",
    "csi_division": "09",
    "csi_code": "09 29 00",
    "category": "finishes",
    "description": "Drywall - Tape & Finish (Level 4)",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 85,
    "crew_size": 1,
    "productivity_per_hour": 500,
    "synonyms": [
      "finishes",
      "drywall",
      "tape",
      "finish",
      "level"
    ],
    "keywords": [
      "drywall",
      "tape",
      "finish",
      "level",
      "finishes"
    ]
  },
  {
    "external_id": "labor-paint-interior",
    "csi_division": "09",
    "csi_code": "09 91 00",
    "category": "finishes",
    "description": "Interior Painting (2 coats)",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 75,
    "crew_size": 2,
    "productivity_per_hour": 600,
    "synonyms": [
      "finishes",
      "interior",
      "painting",
      "coats"
    ],
    "keywords": [
      "interior",
      "painting",
      "coats",
      "finishes"
    ]
  },
  {
    "external_id": "labor-paint-exterior",
    "csi_division": "09",
    "csi_code": "09 91 00",
    "category": "finishes",
    "description": "Exterior Painting (2 coats)",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 110,
    "crew_size": 2,
    "productivity_per_hour": 400,
    "synonyms": [
      "finishes",
      "exterior",
      "painting",
      "coats"
    ],
    "keywords": [
      "exterior",
      "painting",
      "coats",
      "finishes"
    ]
  },
  {
    "external_id": "labor-tile-floor",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Ceramic/Porcelain Floor Tile",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 650,
    "crew_size": 2,
    "productivity_per_hour": 80,
    "synonyms": [
      "finishes",
      "ceramic",
      "porcelain",
      "floor",
      "tile"
    ],
    "keywords": [
      "ceramic",
      "porcelain",
      "floor",
      "tile",
      "finishes"
    ]
  },
  {
    "external_id": "labor-tile-wall",
    "csi_division": "09",
    "csi_code": "09 30 00",
    "category": "finishes",
    "description": "Ceramic/Porcelain Wall Tile",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 800,
    "crew_size": 2,
    "productivity_per_hour": 60,
    "synonyms": [
      "finishes",
      "ceramic",
      "porcelain",
      "wall",
      "tile"
    ],
    "keywords": [
      "ceramic",
      "porcelain",
      "wall",
      "tile",
      "finishes"
    ]
  },
  {
    "external_id": "labor-carpet",
    "csi_division": "09",
    "csi_code": "09 68 00",
    "category": "finishes",
    "description": "Carpet Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 85,
    "crew_size": 2,
    "productivity_per_hour": 500,
    "synonyms": [
      "finishes",
      "carpet",
      "installation"
    ],
    "keywords": [
      "carpet",
      "installation",
      "finishes"
    ]
  },
  {
    "external_id": "labor-lvp",
    "csi_division": "09",
    "csi_code": "09 65 00",
    "category": "finishes",
    "description": "LVP/LVT Flooring Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 150,
    "crew_size": 2,
    "productivity_per_hour": 350,
    "synonyms": [
      "finishes",
      "lvp",
      "lvt",
      "flooring",
      "installation"
    ],
    "keywords": [
      "lvp",
      "lvt",
      "flooring",
      "installation",
      "finishes"
    ]
  },
  {
    "external_id": "labor-hardwood",
    "csi_division": "09",
    "csi_code": "09 64 00",
    "category": "finishes",
    "description": "Hardwood Flooring Installation",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 350,
    "crew_size": 2,
    "productivity_per_hour": 150,
    "synonyms": [
      "finishes",
      "hardwood",
      "flooring",
      "installation"
    ],
    "keywords": [
      "hardwood",
      "flooring",
      "installation",
      "finishes"
    ]
  },
  {
    "external_id": "labor-act-ceiling",
    "csi_division": "09",
    "csi_code": "09 51 00",
    "category": "finishes",
    "description": "Acoustical Ceiling Tile (ACT)",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 175,
    "crew_size": 2,
    "productivity_per_hour": 300,
    "synonyms": [
      "finishes",
      "acoustical",
      "ceiling",
      "tile",
      "act"
    ],
    "keywords": [
      "acoustical",
      "ceiling",
      "tile",
      "act",
      "finishes"
    ]
  },
  {
    "external_id": "labor-stucco",
    "csi_division": "09",
    "csi_code": "09 24 00",
    "category": "finishes",
    "description": "Stucco / Plaster Application",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 550,
    "crew_size": 3,
    "productivity_per_hour": 120,
    "synonyms": [
      "finishes",
      "stucco",
      "plaster",
      "application"
    ],
    "keywords": [
      "stucco",
      "plaster",
      "application",
      "finishes"
    ]
  },
  {
    "external_id": "labor-toilet-partition",
    "csi_division": "10",
    "csi_code": "10 21 00",
    "category": "specialties",
    "description": "Toilet Partition Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 25000,
    "crew_size": 2,
    "productivity_per_hour": 3,
    "synonyms": [
      "specialties",
      "toilet",
      "partition",
      "installation"
    ],
    "keywords": [
      "toilet",
      "partition",
      "installation",
      "specialties"
    ]
  },
  {
    "external_id": "labor-signage",
    "csi_division": "10",
    "csi_code": "10 14 00",
    "category": "specialties",
    "description": "Interior Signage Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 12500,
    "crew_size": 1,
    "productivity_per_hour": 6,
    "synonyms": [
      "specialties",
      "interior",
      "signage",
      "installation"
    ],
    "keywords": [
      "interior",
      "signage",
      "installation",
      "specialties"
    ]
  },
  {
    "external_id": "labor-lockers",
    "csi_division": "10",
    "csi_code": "10 51 00",
    "category": "specialties",
    "description": "Locker Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 6500,
    "crew_size": 2,
    "productivity_per_hour": 8,
    "synonyms": [
      "specialties",
      "locker",
      "installation"
    ],
    "keywords": [
      "locker",
      "installation",
      "specialties"
    ]
  },
  {
    "external_id": "labor-elevator",
    "csi_division": "14",
    "csi_code": "14 21 00",
    "category": "specialties",
    "description": "Elevator Installation (per stop)",
    "unit": "STOP",
    "material_cost_cents": 0,
    "labor_cost_cents": 850000,
    "crew_size": 4,
    "productivity_per_hour": 0.1,
    "synonyms": [
      "specialties",
      "elevator",
      "installation",
      "per",
      "stop"
    ],
    "keywords": [
      "elevator",
      "installation",
      "per",
      "stop",
      "specialties"
    ]
  },
  {
    "external_id": "labor-sprinkler-head",
    "csi_division": "21",
    "csi_code": "21 13 00",
    "category": "mechanical",
    "description": "Fire Sprinkler Head Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 4500,
    "crew_size": 2,
    "productivity_per_hour": 12,
    "synonyms": [
      "mechanical",
      "fire",
      "sprinkler",
      "head",
      "installation"
    ],
    "keywords": [
      "fire",
      "sprinkler",
      "head",
      "installation",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-sprinkler-pipe",
    "csi_division": "21",
    "csi_code": "21 13 00",
    "category": "mechanical",
    "description": "Fire Sprinkler Piping",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 850,
    "crew_size": 2,
    "productivity_per_hour": 60,
    "synonyms": [
      "mechanical",
      "fire",
      "sprinkler",
      "piping"
    ],
    "keywords": [
      "fire",
      "sprinkler",
      "piping",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-fire-alarm",
    "csi_division": "21",
    "csi_code": "21 30 00",
    "category": "mechanical",
    "description": "Fire Alarm Device Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 12500,
    "crew_size": 1,
    "productivity_per_hour": 4,
    "synonyms": [
      "mechanical",
      "fire",
      "alarm",
      "device",
      "installation"
    ],
    "keywords": [
      "fire",
      "alarm",
      "device",
      "installation",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-plumbing-rough",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "mechanical",
    "description": "Plumbing Rough-In (per fixture)",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 45000,
    "crew_size": 2,
    "productivity_per_hour": 2,
    "synonyms": [
      "mechanical",
      "plumbing",
      "rough",
      "per",
      "fixture"
    ],
    "keywords": [
      "plumbing",
      "rough",
      "per",
      "fixture",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-plumbing-fixture",
    "csi_division": "22",
    "csi_code": "22 40 00",
    "category": "mechanical",
    "description": "Plumbing Fixture Set (toilet/sink/faucet)",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 18500,
    "crew_size": 1,
    "productivity_per_hour": 3,
    "synonyms": [
      "mechanical",
      "plumbing",
      "fixture",
      "set",
      "toilet",
      "sink",
      "faucet"
    ],
    "keywords": [
      "plumbing",
      "fixture",
      "set",
      "toilet",
      "sink",
      "faucet",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-water-heater",
    "csi_division": "22",
    "csi_code": "22 33 00",
    "category": "mechanical",
    "description": "Water Heater Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 35000,
    "crew_size": 2,
    "productivity_per_hour": 1.5,
    "synonyms": [
      "mechanical",
      "water",
      "heater",
      "installation"
    ],
    "keywords": [
      "water",
      "heater",
      "installation",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-pipe-copper",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "mechanical",
    "description": "Copper Pipe - Cut, Solder, Install",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1200,
    "crew_size": 1,
    "productivity_per_hour": 30,
    "synonyms": [
      "mechanical",
      "copper",
      "pipe",
      "cut",
      "solder",
      "install"
    ],
    "keywords": [
      "copper",
      "pipe",
      "cut",
      "solder",
      "install",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-pipe-pvc",
    "csi_division": "22",
    "csi_code": "22 11 00",
    "category": "mechanical",
    "description": "PVC Pipe - Cut, Glue, Install",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 650,
    "crew_size": 1,
    "productivity_per_hour": 50,
    "synonyms": [
      "mechanical",
      "pvc",
      "pipe",
      "cut",
      "glue",
      "install"
    ],
    "keywords": [
      "pvc",
      "pipe",
      "cut",
      "glue",
      "install",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-ductwork",
    "csi_division": "23",
    "csi_code": "23 31 00",
    "category": "mechanical",
    "description": "Sheet Metal Ductwork - Fabricate & Install",
    "unit": "LB",
    "material_cost_cents": 0,
    "labor_cost_cents": 350,
    "crew_size": 2,
    "productivity_per_hour": 80,
    "synonyms": [
      "mechanical",
      "sheet",
      "metal",
      "ductwork",
      "fabricate",
      "install"
    ],
    "keywords": [
      "sheet",
      "metal",
      "ductwork",
      "fabricate",
      "install",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-ahu",
    "csi_division": "23",
    "csi_code": "23 73 00",
    "category": "mechanical",
    "description": "Air Handling Unit Installation",
    "unit": "TON",
    "material_cost_cents": 0,
    "labor_cost_cents": 35000,
    "crew_size": 3,
    "productivity_per_hour": 1,
    "synonyms": [
      "mechanical",
      "air",
      "handling",
      "unit",
      "installation"
    ],
    "keywords": [
      "air",
      "handling",
      "unit",
      "installation",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-rtu",
    "csi_division": "23",
    "csi_code": "23 74 00",
    "category": "mechanical",
    "description": "Rooftop Unit Installation",
    "unit": "TON",
    "material_cost_cents": 0,
    "labor_cost_cents": 25000,
    "crew_size": 3,
    "productivity_per_hour": 1.5,
    "synonyms": [
      "mechanical",
      "rooftop",
      "unit",
      "installation"
    ],
    "keywords": [
      "rooftop",
      "unit",
      "installation",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-diffuser",
    "csi_division": "23",
    "csi_code": "23 37 00",
    "category": "mechanical",
    "description": "Air Diffuser/Register Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 6500,
    "crew_size": 1,
    "productivity_per_hour": 8,
    "synonyms": [
      "mechanical",
      "air",
      "diffuser",
      "register",
      "installation"
    ],
    "keywords": [
      "air",
      "diffuser",
      "register",
      "installation",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-residential-hvac",
    "csi_division": "23",
    "csi_code": "23 81 00",
    "category": "mechanical",
    "description": "Residential HVAC System (furnace + AC)",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 250000,
    "crew_size": 2,
    "productivity_per_hour": 0.3,
    "synonyms": [
      "mechanical",
      "residential",
      "hvac",
      "system",
      "furnace"
    ],
    "keywords": [
      "residential",
      "hvac",
      "system",
      "furnace",
      "mechanical"
    ]
  },
  {
    "external_id": "labor-conduit",
    "csi_division": "26",
    "csi_code": "26 05 33",
    "category": "electrical",
    "description": "EMT Conduit - Cut, Bend, Install",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 650,
    "crew_size": 2,
    "productivity_per_hour": 60,
    "synonyms": [
      "electrical",
      "emt",
      "conduit",
      "cut",
      "bend",
      "install"
    ],
    "keywords": [
      "emt",
      "conduit",
      "cut",
      "bend",
      "install",
      "electrical"
    ]
  },
  {
    "external_id": "labor-wire-pull",
    "csi_division": "26",
    "csi_code": "26 05 19",
    "category": "electrical",
    "description": "Wire Pulling (per conductor LF)",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 125,
    "crew_size": 2,
    "productivity_per_hour": 200,
    "synonyms": [
      "electrical",
      "wire",
      "pulling",
      "per",
      "conductor"
    ],
    "keywords": [
      "wire",
      "pulling",
      "per",
      "conductor",
      "electrical"
    ]
  },
  {
    "external_id": "labor-receptacle",
    "csi_division": "26",
    "csi_code": "26 27 26",
    "category": "electrical",
    "description": "Receptacle/Outlet Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 6500,
    "crew_size": 1,
    "productivity_per_hour": 8,
    "synonyms": [
      "electrical",
      "receptacle",
      "outlet",
      "installation"
    ],
    "keywords": [
      "receptacle",
      "outlet",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-switch",
    "csi_division": "26",
    "csi_code": "26 27 26",
    "category": "electrical",
    "description": "Light Switch Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 5500,
    "crew_size": 1,
    "productivity_per_hour": 10,
    "synonyms": [
      "electrical",
      "light",
      "switch",
      "installation"
    ],
    "keywords": [
      "light",
      "switch",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-light-fixture",
    "csi_division": "26",
    "csi_code": "26 51 00",
    "category": "electrical",
    "description": "Light Fixture Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 8500,
    "crew_size": 1,
    "productivity_per_hour": 6,
    "synonyms": [
      "electrical",
      "light",
      "fixture",
      "installation"
    ],
    "keywords": [
      "light",
      "fixture",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-panel",
    "csi_division": "26",
    "csi_code": "26 24 00",
    "category": "electrical",
    "description": "Electrical Panel Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 65000,
    "crew_size": 2,
    "productivity_per_hour": 1,
    "synonyms": [
      "electrical",
      "panel",
      "installation"
    ],
    "keywords": [
      "electrical",
      "panel",
      "installation"
    ]
  },
  {
    "external_id": "labor-transformer",
    "csi_division": "26",
    "csi_code": "26 22 00",
    "category": "electrical",
    "description": "Transformer Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 120000,
    "crew_size": 2,
    "productivity_per_hour": 0.5,
    "synonyms": [
      "electrical",
      "transformer",
      "installation"
    ],
    "keywords": [
      "transformer",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-fire-alarm-device",
    "csi_division": "26",
    "csi_code": "26 31 00",
    "category": "electrical",
    "description": "Fire Alarm Device Wiring",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 9500,
    "crew_size": 1,
    "productivity_per_hour": 5,
    "synonyms": [
      "electrical",
      "fire",
      "alarm",
      "device",
      "wiring"
    ],
    "keywords": [
      "fire",
      "alarm",
      "device",
      "wiring",
      "electrical"
    ]
  },
  {
    "external_id": "labor-data-drop",
    "csi_division": "27",
    "csi_code": "27 15 00",
    "category": "electrical",
    "description": "Data/Network Drop Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 12500,
    "crew_size": 1,
    "productivity_per_hour": 4,
    "synonyms": [
      "electrical",
      "data",
      "network",
      "drop",
      "installation"
    ],
    "keywords": [
      "data",
      "network",
      "drop",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-security-camera",
    "csi_division": "28",
    "csi_code": "28 23 00",
    "category": "electrical",
    "description": "Security Camera Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 18500,
    "crew_size": 1,
    "productivity_per_hour": 3,
    "synonyms": [
      "electrical",
      "security",
      "camera",
      "installation"
    ],
    "keywords": [
      "security",
      "camera",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-access-control",
    "csi_division": "28",
    "csi_code": "28 13 00",
    "category": "electrical",
    "description": "Access Control Device Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 25000,
    "crew_size": 1,
    "productivity_per_hour": 2,
    "synonyms": [
      "electrical",
      "access",
      "control",
      "device",
      "installation"
    ],
    "keywords": [
      "access",
      "control",
      "device",
      "installation",
      "electrical"
    ]
  },
  {
    "external_id": "labor-excavation",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "sitework",
    "description": "Bulk Excavation (equipment + operator)",
    "unit": "CY",
    "material_cost_cents": 0,
    "labor_cost_cents": 450,
    "crew_size": 2,
    "productivity_per_hour": 80,
    "synonyms": [
      "sitework",
      "bulk",
      "excavation",
      "equipment",
      "operator"
    ],
    "keywords": [
      "bulk",
      "excavation",
      "equipment",
      "operator",
      "sitework"
    ]
  },
  {
    "external_id": "labor-backfill",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "sitework",
    "description": "Backfill & Compaction",
    "unit": "CY",
    "material_cost_cents": 0,
    "labor_cost_cents": 550,
    "crew_size": 2,
    "productivity_per_hour": 60,
    "synonyms": [
      "sitework",
      "backfill",
      "compaction"
    ],
    "keywords": [
      "backfill",
      "compaction",
      "sitework"
    ]
  },
  {
    "external_id": "labor-grading",
    "csi_division": "31",
    "csi_code": "31 22 00",
    "category": "sitework",
    "description": "Fine Grading",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 35,
    "crew_size": 2,
    "productivity_per_hour": 3000,
    "synonyms": [
      "sitework",
      "fine",
      "grading"
    ],
    "keywords": [
      "fine",
      "grading",
      "sitework"
    ]
  },
  {
    "external_id": "labor-trench",
    "csi_division": "31",
    "csi_code": "31 23 00",
    "category": "sitework",
    "description": "Trench Excavation (utility)",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 850,
    "crew_size": 2,
    "productivity_per_hour": 80,
    "synonyms": [
      "sitework",
      "trench",
      "excavation",
      "utility"
    ],
    "keywords": [
      "trench",
      "excavation",
      "utility",
      "sitework"
    ]
  },
  {
    "external_id": "labor-asphalt-paving",
    "csi_division": "32",
    "csi_code": "32 12 00",
    "category": "sitework",
    "description": "Asphalt Paving",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 150,
    "crew_size": 6,
    "productivity_per_hour": 1000,
    "synonyms": [
      "sitework",
      "asphalt",
      "paving"
    ],
    "keywords": [
      "asphalt",
      "paving",
      "sitework"
    ]
  },
  {
    "external_id": "labor-concrete-sidewalk",
    "csi_division": "32",
    "csi_code": "32 16 00",
    "category": "sitework",
    "description": "Concrete Sidewalk - Form, Pour, Finish",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 450,
    "crew_size": 4,
    "productivity_per_hour": 200,
    "synonyms": [
      "sitework",
      "concrete",
      "sidewalk",
      "form",
      "pour",
      "finish"
    ],
    "keywords": [
      "concrete",
      "sidewalk",
      "form",
      "pour",
      "finish",
      "sitework"
    ]
  },
  {
    "external_id": "labor-landscaping",
    "csi_division": "32",
    "csi_code": "32 90 00",
    "category": "sitework",
    "description": "Landscaping - Planting & Grading",
    "unit": "SF",
    "material_cost_cents": 0,
    "labor_cost_cents": 125,
    "crew_size": 3,
    "productivity_per_hour": 500,
    "synonyms": [
      "sitework",
      "landscaping",
      "planting",
      "grading"
    ],
    "keywords": [
      "landscaping",
      "planting",
      "grading",
      "sitework"
    ]
  },
  {
    "external_id": "labor-fence-chain",
    "csi_division": "32",
    "csi_code": "32 31 00",
    "category": "sitework",
    "description": "Chain Link Fence Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 800,
    "crew_size": 2,
    "productivity_per_hour": 80,
    "synonyms": [
      "sitework",
      "chain",
      "link",
      "fence",
      "installation"
    ],
    "keywords": [
      "chain",
      "link",
      "fence",
      "installation",
      "sitework"
    ]
  },
  {
    "external_id": "labor-fence-wood",
    "csi_division": "32",
    "csi_code": "32 32 00",
    "category": "sitework",
    "description": "Wood Privacy Fence Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1200,
    "crew_size": 2,
    "productivity_per_hour": 50,
    "synonyms": [
      "sitework",
      "wood",
      "privacy",
      "fence",
      "installation"
    ],
    "keywords": [
      "wood",
      "privacy",
      "fence",
      "installation",
      "sitework"
    ]
  },
  {
    "external_id": "labor-storm-pipe",
    "csi_division": "33",
    "csi_code": "33 40 00",
    "category": "sitework",
    "description": "Storm Drain Pipe Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 1800,
    "crew_size": 3,
    "productivity_per_hour": 40,
    "synonyms": [
      "sitework",
      "storm",
      "drain",
      "pipe",
      "installation"
    ],
    "keywords": [
      "storm",
      "drain",
      "pipe",
      "installation",
      "sitework"
    ]
  },
  {
    "external_id": "labor-sanitary-pipe",
    "csi_division": "33",
    "csi_code": "33 30 00",
    "category": "sitework",
    "description": "Sanitary Sewer Pipe Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 2200,
    "crew_size": 3,
    "productivity_per_hour": 35,
    "synonyms": [
      "sitework",
      "sanitary",
      "sewer",
      "pipe",
      "installation"
    ],
    "keywords": [
      "sanitary",
      "sewer",
      "pipe",
      "installation",
      "sitework"
    ]
  },
  {
    "external_id": "labor-water-main",
    "csi_division": "33",
    "csi_code": "33 11 00",
    "category": "sitework",
    "description": "Water Main Installation",
    "unit": "LF",
    "material_cost_cents": 0,
    "labor_cost_cents": 2500,
    "crew_size": 3,
    "productivity_per_hour": 30,
    "synonyms": [
      "sitework",
      "water",
      "main",
      "installation"
    ],
    "keywords": [
      "water",
      "main",
      "installation",
      "sitework"
    ]
  },
  {
    "external_id": "labor-manhole",
    "csi_division": "33",
    "csi_code": "33 40 00",
    "category": "sitework",
    "description": "Manhole/Catch Basin Installation",
    "unit": "EA",
    "material_cost_cents": 0,
    "labor_cost_cents": 150000,
    "crew_size": 3,
    "productivity_per_hour": 0.5,
    "synonyms": [
      "sitework",
      "manhole",
      "catch",
      "basin",
      "installation"
    ],
    "keywords": [
      "manhole",
      "catch",
      "basin",
      "installation",
      "sitework"
    ]
  }
];

export const ESTIMATE_REGIONS: EstimateRegion[] = [
  {
    "code": "national",
    "name": "National Average",
    "description": "US national average - no adjustment",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  },
  {
    "code": "ne-nyc",
    "name": "New York City",
    "description": "NYC metro area (Manhattan, Brooklyn, Queens)",
    "multiplier_basis_points": 13400,
    "multiplier_decimal": 1.34
  },
  {
    "code": "ne-boston",
    "name": "Boston",
    "description": "Boston metro area",
    "multiplier_basis_points": 12200,
    "multiplier_decimal": 1.22
  },
  {
    "code": "ne-philly",
    "name": "Philadelphia",
    "description": "Philadelphia metro area",
    "multiplier_basis_points": 11500,
    "multiplier_decimal": 1.15
  },
  {
    "code": "ne-hartford",
    "name": "Hartford",
    "description": "Hartford / Connecticut",
    "multiplier_basis_points": 11200,
    "multiplier_decimal": 1.12
  },
  {
    "code": "ne-newark",
    "name": "Newark / N. New Jersey",
    "description": "Northern New Jersey",
    "multiplier_basis_points": 12000,
    "multiplier_decimal": 1.2
  },
  {
    "code": "ne-pittsburgh",
    "name": "Pittsburgh",
    "description": "Pittsburgh metro area",
    "multiplier_basis_points": 10300,
    "multiplier_decimal": 1.03
  },
  {
    "code": "ne-dc",
    "name": "Washington D.C.",
    "description": "DC metro area (includes NoVA, MD suburbs)",
    "multiplier_basis_points": 10800,
    "multiplier_decimal": 1.08
  },
  {
    "code": "ne-baltimore",
    "name": "Baltimore",
    "description": "Baltimore metro area",
    "multiplier_basis_points": 10200,
    "multiplier_decimal": 1.02
  },
  {
    "code": "se-atlanta",
    "name": "Atlanta",
    "description": "Atlanta metro area",
    "multiplier_basis_points": 9400,
    "multiplier_decimal": 0.94
  },
  {
    "code": "se-miami",
    "name": "Miami",
    "description": "South Florida (Miami-Dade, Broward)",
    "multiplier_basis_points": 9700,
    "multiplier_decimal": 0.97
  },
  {
    "code": "se-tampa",
    "name": "Tampa",
    "description": "Tampa Bay area",
    "multiplier_basis_points": 9200,
    "multiplier_decimal": 0.92
  },
  {
    "code": "se-orlando",
    "name": "Orlando",
    "description": "Central Florida",
    "multiplier_basis_points": 9100,
    "multiplier_decimal": 0.91
  },
  {
    "code": "se-charlotte",
    "name": "Charlotte",
    "description": "Charlotte metro area",
    "multiplier_basis_points": 9000,
    "multiplier_decimal": 0.9
  },
  {
    "code": "se-raleigh",
    "name": "Raleigh-Durham",
    "description": "Research Triangle, NC",
    "multiplier_basis_points": 9000,
    "multiplier_decimal": 0.9
  },
  {
    "code": "se-nashville",
    "name": "Nashville",
    "description": "Nashville metro area",
    "multiplier_basis_points": 9300,
    "multiplier_decimal": 0.93
  },
  {
    "code": "se-charleston",
    "name": "Charleston",
    "description": "Charleston, SC",
    "multiplier_basis_points": 8800,
    "multiplier_decimal": 0.88
  },
  {
    "code": "se-jacksonville",
    "name": "Jacksonville",
    "description": "Jacksonville, FL",
    "multiplier_basis_points": 8900,
    "multiplier_decimal": 0.89
  },
  {
    "code": "mw-chicago",
    "name": "Chicago",
    "description": "Chicago metro area",
    "multiplier_basis_points": 11200,
    "multiplier_decimal": 1.12
  },
  {
    "code": "mw-detroit",
    "name": "Detroit",
    "description": "Detroit metro area",
    "multiplier_basis_points": 10500,
    "multiplier_decimal": 1.05
  },
  {
    "code": "mw-minneapolis",
    "name": "Minneapolis",
    "description": "Twin Cities metro area",
    "multiplier_basis_points": 10800,
    "multiplier_decimal": 1.08
  },
  {
    "code": "mw-stlouis",
    "name": "St. Louis",
    "description": "St. Louis metro area",
    "multiplier_basis_points": 10200,
    "multiplier_decimal": 1.02
  },
  {
    "code": "mw-columbus",
    "name": "Columbus",
    "description": "Columbus, OH",
    "multiplier_basis_points": 9700,
    "multiplier_decimal": 0.97
  },
  {
    "code": "mw-indianapolis",
    "name": "Indianapolis",
    "description": "Indianapolis metro area",
    "multiplier_basis_points": 9600,
    "multiplier_decimal": 0.96
  },
  {
    "code": "mw-kansascity",
    "name": "Kansas City",
    "description": "KC metro area (MO/KS)",
    "multiplier_basis_points": 9800,
    "multiplier_decimal": 0.98
  },
  {
    "code": "mw-milwaukee",
    "name": "Milwaukee",
    "description": "Milwaukee metro area",
    "multiplier_basis_points": 10300,
    "multiplier_decimal": 1.03
  },
  {
    "code": "mw-cincinnati",
    "name": "Cincinnati",
    "description": "Cincinnati metro area",
    "multiplier_basis_points": 9500,
    "multiplier_decimal": 0.95
  },
  {
    "code": "sw-dallas",
    "name": "Dallas-Fort Worth",
    "description": "DFW metro area",
    "multiplier_basis_points": 9200,
    "multiplier_decimal": 0.92
  },
  {
    "code": "sw-houston",
    "name": "Houston",
    "description": "Houston metro area",
    "multiplier_basis_points": 9300,
    "multiplier_decimal": 0.93
  },
  {
    "code": "sw-sanantonio",
    "name": "San Antonio",
    "description": "San Antonio metro area",
    "multiplier_basis_points": 8800,
    "multiplier_decimal": 0.88
  },
  {
    "code": "sw-austin",
    "name": "Austin",
    "description": "Austin metro area",
    "multiplier_basis_points": 9100,
    "multiplier_decimal": 0.91
  },
  {
    "code": "sw-phoenix",
    "name": "Phoenix",
    "description": "Phoenix metro area",
    "multiplier_basis_points": 9200,
    "multiplier_decimal": 0.92
  },
  {
    "code": "sw-denver",
    "name": "Denver",
    "description": "Denver metro area",
    "multiplier_basis_points": 9800,
    "multiplier_decimal": 0.98
  },
  {
    "code": "sw-lasvegas",
    "name": "Las Vegas",
    "description": "Las Vegas metro area",
    "multiplier_basis_points": 10100,
    "multiplier_decimal": 1.01
  },
  {
    "code": "sw-albuquerque",
    "name": "Albuquerque",
    "description": "Albuquerque, NM",
    "multiplier_basis_points": 9000,
    "multiplier_decimal": 0.9
  },
  {
    "code": "wc-la",
    "name": "Los Angeles",
    "description": "LA metro area",
    "multiplier_basis_points": 11500,
    "multiplier_decimal": 1.15
  },
  {
    "code": "wc-sf",
    "name": "San Francisco",
    "description": "SF Bay Area",
    "multiplier_basis_points": 13200,
    "multiplier_decimal": 1.32
  },
  {
    "code": "wc-sanjose",
    "name": "San Jose / Silicon Valley",
    "description": "South Bay / Silicon Valley",
    "multiplier_basis_points": 12800,
    "multiplier_decimal": 1.28
  },
  {
    "code": "wc-sandiego",
    "name": "San Diego",
    "description": "San Diego metro area",
    "multiplier_basis_points": 10800,
    "multiplier_decimal": 1.08
  },
  {
    "code": "wc-sacramento",
    "name": "Sacramento",
    "description": "Sacramento metro area",
    "multiplier_basis_points": 10600,
    "multiplier_decimal": 1.06
  },
  {
    "code": "wc-honolulu",
    "name": "Honolulu",
    "description": "Hawaii (Oahu)",
    "multiplier_basis_points": 12500,
    "multiplier_decimal": 1.25
  },
  {
    "code": "pnw-seattle",
    "name": "Seattle",
    "description": "Seattle metro area",
    "multiplier_basis_points": 11000,
    "multiplier_decimal": 1.1
  },
  {
    "code": "pnw-portland",
    "name": "Portland",
    "description": "Portland, OR metro area",
    "multiplier_basis_points": 10500,
    "multiplier_decimal": 1.05
  },
  {
    "code": "pnw-anchorage",
    "name": "Anchorage",
    "description": "Anchorage, AK",
    "multiplier_basis_points": 12000,
    "multiplier_decimal": 1.2
  },
  {
    "code": "uk-national",
    "name": "UK National Average",
    "description": "UK national average - no adjustment",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  },
  {
    "code": "uk-inner-london",
    "name": "Inner London",
    "description": "Central London (Zone 1-2), City of London, Westminster",
    "multiplier_basis_points": 13300,
    "multiplier_decimal": 1.33
  },
  {
    "code": "uk-outer-london",
    "name": "Outer London",
    "description": "Greater London boroughs outside Zone 2",
    "multiplier_basis_points": 11800,
    "multiplier_decimal": 1.18
  },
  {
    "code": "uk-southeast",
    "name": "South East",
    "description": "Surrey, Kent, Sussex, Hampshire, Berkshire",
    "multiplier_basis_points": 11750,
    "multiplier_decimal": 1.175
  },
  {
    "code": "uk-southwest",
    "name": "South West",
    "description": "Bristol, Bath, Devon, Cornwall, Dorset",
    "multiplier_basis_points": 11000,
    "multiplier_decimal": 1.1
  },
  {
    "code": "uk-east",
    "name": "East of England",
    "description": "Cambridge, Essex, Norfolk, Suffolk, Hertfordshire",
    "multiplier_basis_points": 10700,
    "multiplier_decimal": 1.07
  },
  {
    "code": "uk-west-midlands",
    "name": "West Midlands",
    "description": "Birmingham, Coventry, Wolverhampton",
    "multiplier_basis_points": 10500,
    "multiplier_decimal": 1.05
  },
  {
    "code": "uk-east-midlands",
    "name": "East Midlands",
    "description": "Nottingham, Leicester, Derby",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  },
  {
    "code": "uk-northwest",
    "name": "North West",
    "description": "Manchester, Liverpool, Lancashire, Cheshire",
    "multiplier_basis_points": 9800,
    "multiplier_decimal": 0.98
  },
  {
    "code": "uk-yorkshire",
    "name": "Yorkshire & Humber",
    "description": "Leeds, Sheffield, York, Hull",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  },
  {
    "code": "uk-northeast",
    "name": "North East",
    "description": "Newcastle, Sunderland, Durham",
    "multiplier_basis_points": 9500,
    "multiplier_decimal": 0.95
  },
  {
    "code": "uk-scotland-central",
    "name": "Central Scotland",
    "description": "Edinburgh, Glasgow, Stirling",
    "multiplier_basis_points": 10800,
    "multiplier_decimal": 1.08
  },
  {
    "code": "uk-scotland-north",
    "name": "Northern Scotland",
    "description": "Aberdeen, Highlands, Islands",
    "multiplier_basis_points": 11200,
    "multiplier_decimal": 1.12
  },
  {
    "code": "uk-wales",
    "name": "Wales",
    "description": "Cardiff, Swansea, Newport, rural Wales",
    "multiplier_basis_points": 9500,
    "multiplier_decimal": 0.95
  },
  {
    "code": "uk-channel",
    "name": "Channel Islands",
    "description": "Jersey, Guernsey",
    "multiplier_basis_points": 12000,
    "multiplier_decimal": 1.2
  },
  {
    "code": "uk-northern-ireland",
    "name": "Northern Ireland",
    "description": "Belfast, Derry, Antrim",
    "multiplier_basis_points": 9200,
    "multiplier_decimal": 0.92
  },
  {
    "code": "au-national",
    "name": "AU National Average",
    "description": "Australian national average - no adjustment",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  },
  {
    "code": "au-sydney",
    "name": "Sydney",
    "description": "Sydney metro area, Greater Western Sydney",
    "multiplier_basis_points": 13500,
    "multiplier_decimal": 1.35
  },
  {
    "code": "au-regional-nsw",
    "name": "Regional NSW",
    "description": "Newcastle, Wollongong, Central Coast, rural NSW",
    "multiplier_basis_points": 9700,
    "multiplier_decimal": 0.97
  },
  {
    "code": "au-melbourne",
    "name": "Melbourne",
    "description": "Melbourne metro area",
    "multiplier_basis_points": 11800,
    "multiplier_decimal": 1.18
  },
  {
    "code": "au-regional-vic",
    "name": "Regional Victoria",
    "description": "Geelong, Ballarat, Bendigo, rural VIC",
    "multiplier_basis_points": 9700,
    "multiplier_decimal": 0.97
  },
  {
    "code": "au-brisbane",
    "name": "Brisbane",
    "description": "Brisbane metro area, Gold Coast",
    "multiplier_basis_points": 10700,
    "multiplier_decimal": 1.07
  },
  {
    "code": "au-regional-qld",
    "name": "Regional Queensland",
    "description": "Cairns, Townsville, Sunshine Coast, rural QLD",
    "multiplier_basis_points": 9200,
    "multiplier_decimal": 0.92
  },
  {
    "code": "au-perth",
    "name": "Perth",
    "description": "Perth metro area",
    "multiplier_basis_points": 11500,
    "multiplier_decimal": 1.15
  },
  {
    "code": "au-adelaide",
    "name": "Adelaide",
    "description": "Adelaide metro area",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  },
  {
    "code": "au-canberra",
    "name": "Canberra",
    "description": "ACT / Canberra metro area",
    "multiplier_basis_points": 11500,
    "multiplier_decimal": 1.15
  },
  {
    "code": "au-darwin",
    "name": "Darwin",
    "description": "Darwin, Northern Territory",
    "multiplier_basis_points": 11500,
    "multiplier_decimal": 1.15
  },
  {
    "code": "au-hobart",
    "name": "Hobart",
    "description": "Hobart, Tasmania",
    "multiplier_basis_points": 10000,
    "multiplier_decimal": 1
  }
];
