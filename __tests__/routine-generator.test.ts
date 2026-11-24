import { describe, expect, it } from "@jest/globals";
import { buildRuleBasedRoutine, generateRoutine } from "@/utils/routine-generator";

type Step = { step: number; product_type: string; instruction: string; reason: string };
type Routine = {
  summary: string;
  morning_routine: Step[];
  afternoon_routine: Step[];
  evening_routine: Step[];
  recommended_products: { product_type: string; recommended_ingredients: string[] }[];
};

const parse = (s: string) => JSON.parse(s) as Routine;

describe("buildRuleBasedRoutine", () => {
  it("is deterministic for the same input", () => {
    expect(buildRuleBasedRoutine("oily", "acne", 64)).toBe(
      buildRuleBasedRoutine("oily", "acne", 64),
    );
  });

  it.each(["acne", "dry", "eczema", "oily", "normal"])(
    "produces a complete routine for %s",
    (concern) => {
      const r = parse(buildRuleBasedRoutine("combination", concern, 70));
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.morning_routine.length).toBeGreaterThan(0);
      expect(r.evening_routine.length).toBeGreaterThan(0);
      expect(r.recommended_products.length).toBeGreaterThan(0);
      for (const s of [...r.morning_routine, ...r.evening_routine]) {
        expect(s.product_type).toBeTruthy();
        expect(s.reason).not.toMatch(/undefined|NaN/);
      }
    },
  );

  it("never returns an empty routine for an unknown concern", () => {
    const r = parse(buildRuleBasedRoutine("normal", "not-a-condition", 80));
    expect(r.recommended_products.length).toBeGreaterThan(0);
  });

  it("survives a non-finite score", () => {
    const r = parse(buildRuleBasedRoutine("dry", "dry", Number.NaN));
    expect(r.summary).toContain("0/100");
  });

  it("drops an avoided ingredient when alternatives exist", () => {
    const base = parse(buildRuleBasedRoutine("oily", "acne", 60));
    const first = base.recommended_products[0]?.recommended_ingredients[0];
    expect(first).toBeTruthy();
    const avoided = parse(
      buildRuleBasedRoutine("oily", "acne", 60, undefined, { avoid_ingredients: [first] }),
    );
    const all = avoided.recommended_products.flatMap((p) => p.recommended_ingredients);
    expect(all).not.toContain(first);
  });
});

describe("generateRoutine", () => {
  it("matches the rule-based builder", async () => {
    const input = {
      skin_type: "oily",
      main_concern: "acne",
      sleep_quality: "",
      stress_level: "",
      water_intake: "",
      health_score: 55,
    };
    const viaAsync = await generateRoutine(input);
    expect(parse(viaAsync).recommended_products).toEqual(
      parse(
        buildRuleBasedRoutine(
          "oily",
          "acne",
          55,
          { sleep_quality: "", stress_level: "", water_intake: "" },
          {},
        ),
      ).recommended_products,
    );
  });
});

describe("dermatologist rules for recommended products", () => {
  const ingredients = (r: Routine) =>
    r.recommended_products.flatMap((p) => p.recommended_ingredients);

  it.each(["oily", "dry", "combination", "sensitive", "normal"])(
    "always recommends retinol for acne (%s skin)",
    (skin) => {
      expect(ingredients(parse(buildRuleBasedRoutine(skin, "acne", 70)))).toContain("Retinol");
    },
  );

  it.each(["dry", "eczema"])("does not force retinol onto %s results", (c) => {
    expect(ingredients(parse(buildRuleBasedRoutine("dry", c, 70)))).not.toContain("Retinol");
  });

  it("never stacks retinol with another retinoid", () => {
    for (const c of ["acne"]) {
      expect(ingredients(parse(buildRuleBasedRoutine("oily", c, 40)))).not.toContain("Adapalene");
    }
  });

  it("drops retinol when pregnancy or a logged sensitivity excludes it", async () => {
    const pregnant = parse(
      await generateRoutine({
        skin_type: "oily",
        main_concern: "acne",
        sleep_quality: "",
        stress_level: "",
        water_intake: "",
        health_score: 60,
        pregnancy_status: "yes",
      }),
    );
    expect(ingredients(pregnant)).not.toContain("Retinol");
    const sensitive = parse(
      buildRuleBasedRoutine("oily", "acne", 60, undefined, { avoid_ingredients: ["Retinol"] }),
    );
    expect(ingredients(sensitive)).not.toContain("Retinol");
  });

  it("always recommends sunscreen for a normal result", () => {
    const r = parse(buildRuleBasedRoutine("normal", "normal", 90));
    expect(r.recommended_products.some((p) => /sunscreen|spf/i.test(p.product_type))).toBe(true);
  });
});

describe("recommended products are limited to the 2 most important (dermatologist guidance)", () => {
  const types = (r: Routine) => r.recommended_products.map((p) => p.product_type);
  const CASES: [string, string][] = [
    ["oily", "acne"],
    ["combination", "acne"],
    ["dry", "dry"],
    ["dry", "eczema"],
    ["oily", "oily"],
    ["sensitive", "redness"],
    ["normal", "normal"],
    ["normal", "none"],
  ];

  it.each(CASES)("%s skin / %s gets exactly 2 distinct products", (skin, concern) => {
    const t = types(parse(buildRuleBasedRoutine(skin, concern, 60)));
    expect(t).toHaveLength(2);
    expect(new Set(t).size).toBe(2);
  });

  it("acne keeps retinol in the 2", () => {
    const r = parse(buildRuleBasedRoutine("oily", "acne", 60));
    expect(r.recommended_products[0].recommended_ingredients).toContain("Retinol");
  });

  it("a normal result keeps sunscreen in the 2", () => {
    expect(types(parse(buildRuleBasedRoutine("normal", "normal", 90)))[0]).toMatch(
      /sunscreen|spf/i,
    );
  });

  it("still gives 2 products when retinol is excluded (pregnancy)", async () => {
    const r = parse(
      await generateRoutine({
        skin_type: "oily",
        main_concern: "acne",
        sleep_quality: "",
        stress_level: "",
        water_intake: "",
        health_score: 60,
        pregnancy_status: "yes",
      }),
    );
    expect(r.recommended_products).toHaveLength(2);
  });
});
