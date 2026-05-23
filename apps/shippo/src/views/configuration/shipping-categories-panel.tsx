import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { useMemo, useState } from "react";

import type { MethodRule } from "@/modules/app-config/domain/shipping-category-rule";
import { trpcClient } from "@/modules/trpc/trpc-client";

type Mode = "fixed" | "live";

/**
 * Local form-state shape. Mirrors `ShippingCategoryRule` fields but with
 * stringified numeric inputs and one row per method to make editing easier.
 */
type RuleFormState = {
  categorySlug: string;
  displayName: string;
  freeShipping: boolean;
  weightOzPerUnit: string;
  parcel: { lengthIn: string; widthIn: string; heightIn: string };
  domesticMethods: MethodRowState[];
  internationalMethods: MethodRowState[];
};

type MethodRowState = {
  serviceToken: string;
  displayName: string;
  mode: Mode;
  fixedAmount: string;
  minTransitDays: string;
  maxTransitDays: string;
};

const emptyMethodRow = (): MethodRowState => ({
  serviceToken: "",
  displayName: "",
  mode: "live",
  fixedAmount: "",
  minTransitDays: "1",
  maxTransitDays: "3",
});

const emptyRuleForm = (slug = "", name = ""): RuleFormState => ({
  categorySlug: slug,
  displayName: name,
  freeShipping: false,
  weightOzPerUnit: "4",
  parcel: { lengthIn: "7", widthIn: "10", heightIn: "1" },
  domesticMethods: [],
  internationalMethods: [],
});

const SERVICE_TOKEN_SUGGESTIONS = [
  "usps_first_class",
  "usps_priority",
  "usps_priority_express",
  "usps_priority_mail_international",
  "usps_first_class_package_international_service",
  "usps_priority_mail_express_international",
];

type CategoryRulePanelProps = {
  /** Existing rules to display + edit. */
  rules: ReadonlyArray<{
    categorySlug: string;
    displayName: string;
    freeShipping: boolean;
    weightOzPerUnit: number;
    parcel?: { lengthIn: number; widthIn: number; heightIn: number };
    domesticMethods: ReadonlyArray<MethodRule>;
    internationalMethods: ReadonlyArray<MethodRule>;
  }>;
  /** Saleor categories the merchant can pick from. */
  saleorCategories: ReadonlyArray<{ id: string; name: string; slug: string }>;
};

export const ShippingCategoriesPanel = ({
  rules,
  saleorCategories,
}: CategoryRulePanelProps) => {
  const utils = trpcClient.useUtils();
  const upsertMutation = trpcClient.config.upsertCategoryRule.useMutation({
    onSuccess: () => utils.config.getAll.invalidate(),
  });
  const removeMutation = trpcClient.config.removeCategoryRule.useMutation({
    onSuccess: () => utils.config.getAll.invalidate(),
  });

  const [editing, setEditing] = useState<RuleFormState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ruledSlugs = useMemo(
    () => new Set(rules.map((r) => r.categorySlug)),
    [rules],
  );
  const pickableCategories = useMemo(
    () =>
      saleorCategories.filter(
        (c) =>
          !ruledSlugs.has(c.slug) || (editing && editing.categorySlug === c.slug),
      ),
    [saleorCategories, ruledSlugs, editing],
  );

  const startAdd = () => {
    setNotice(null);
    setEditing(emptyRuleForm());
  };

  const startEdit = (slug: string) => {
    const rule = rules.find((r) => r.categorySlug === slug);

    if (!rule) return;

    setNotice(null);
    setEditing({
      categorySlug: rule.categorySlug,
      displayName: rule.displayName,
      freeShipping: rule.freeShipping,
      weightOzPerUnit: String(rule.weightOzPerUnit),
      parcel: {
        lengthIn: rule.parcel ? String(rule.parcel.lengthIn) : "7",
        widthIn: rule.parcel ? String(rule.parcel.widthIn) : "10",
        heightIn: rule.parcel ? String(rule.parcel.heightIn) : "1",
      },
      domesticMethods: rule.domesticMethods.map(methodRuleToRow),
      internationalMethods: rule.internationalMethods.map(methodRuleToRow),
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setNotice(null);

    if (!editing.categorySlug) {
      setNotice("Pick a Saleor category.");

      return;
    }

    try {
      await upsertMutation.mutateAsync({
        categorySlug: editing.categorySlug,
        displayName: editing.displayName || editing.categorySlug,
        freeShipping: editing.freeShipping,
        weightOzPerUnit: editing.freeShipping
          ? 0
          : Number(editing.weightOzPerUnit) || 0,
        parcel: editing.freeShipping
          ? undefined
          : {
              lengthIn: Number(editing.parcel.lengthIn) || 0,
              widthIn: Number(editing.parcel.widthIn) || 0,
              heightIn: Number(editing.parcel.heightIn) || 0,
            },
        domesticMethods: editing.freeShipping
          ? []
          : editing.domesticMethods.map(rowToMethodRule).filter(Boolean) as MethodRule[],
        internationalMethods: editing.freeShipping
          ? []
          : editing.internationalMethods
              .map(rowToMethodRule)
              .filter(Boolean) as MethodRule[],
      });
      setNotice("Saved.");
      setEditing(null);
    } catch (e) {
      setNotice(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" flexDirection="column" gap={2}>
        <Text size={6}>Shipping by category</Text>
        <Text color="default2">
          Per Saleor product category, set the parcel and per-zone methods. A
          method can be a fixed price or a live Shippo quote. Mixed carts ship
          via the most expensive applicable method that ALL non-free categories
          support; free categories never restrict the cart.
        </Text>
      </Box>

      <Box display="flex" flexDirection="column" gap={3}>
        {rules.length === 0 && (
          <Text color="default2">
            No category rules yet. Add one to override the default whole-cart
            parcel.
          </Text>
        )}
        {rules.map((r) => (
          <Box
            key={r.categorySlug}
            display="flex"
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            padding={3}
            borderWidth={1}
            borderStyle="solid"
            borderRadius={3}
          >
            <Box>
              <Text>
                <strong>{r.displayName}</strong> ({r.categorySlug})
              </Text>
              <Text size={2} color="default2">
                {r.freeShipping
                  ? "Free shipping"
                  : `${r.weightOzPerUnit} oz/unit • ` +
                    `${describeMethods(r.domesticMethods, "dom")}` +
                    ` • ${describeMethods(r.internationalMethods, "intl")}`}
              </Text>
            </Box>
            <Box display="flex" flexDirection="row" gap={2}>
              <Button variant="secondary" onClick={() => startEdit(r.categorySlug)}>
                Edit
              </Button>
              <Button
                variant="tertiary"
                onClick={() => removeMutation.mutate({ categorySlug: r.categorySlug })}
                disabled={removeMutation.isLoading}
              >
                Remove
              </Button>
            </Box>
          </Box>
        ))}
        <Box>
          <Button onClick={startAdd}>Add category rule</Button>
        </Box>
      </Box>

      {editing && (
        <Box
          display="flex"
          flexDirection="column"
          gap={4}
          padding={6}
          borderWidth={1}
          borderStyle="solid"
          borderRadius={3}
        >
          <Box display="flex" flexDirection="row" justifyContent="space-between">
            <Text size={6}>
              {ruledSlugs.has(editing.categorySlug) ? "Edit" : "Add"} category rule
            </Text>
            <Button variant="tertiary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </Box>

          {/* Category picker — disabled when editing an existing rule so the slug stays stable */}
          <Box>
            <Text size={2} color="default2">
              Saleor category
            </Text>
            <Select
              value={editing.categorySlug}
              onChange={(value) => {
                const cat = saleorCategories.find((c) => c.slug === value);

                setEditing((e) =>
                  e
                    ? {
                        ...e,
                        categorySlug: String(value),
                        displayName: e.displayName || cat?.name || String(value),
                      }
                    : e,
                );
              }}
              options={pickableCategories.map((c) => ({
                value: c.slug,
                label: `${c.name} (${c.slug})`,
              }))}
            />
          </Box>

          <Input
            label="Display name"
            value={editing.displayName}
            onChange={(e) =>
              setEditing((s) => (s ? { ...s, displayName: e.target.value } : s))
            }
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={editing.freeShipping}
              onChange={(e) =>
                setEditing((s) => (s ? { ...s, freeShipping: e.target.checked } : s))
              }
            />
            Free shipping (overrides all other fields)
          </label>

          {!editing.freeShipping && (
            <>
              <Input
                label="Weight per unit (oz)"
                type="number"
                value={editing.weightOzPerUnit}
                onChange={(e) =>
                  setEditing((s) => (s ? { ...s, weightOzPerUnit: e.target.value } : s))
                }
              />

              <Box display="grid" __gridTemplateColumns="1fr 1fr 1fr" gap={3}>
                <Input
                  label="Parcel length (in)"
                  type="number"
                  value={editing.parcel.lengthIn}
                  onChange={(e) =>
                    setEditing((s) =>
                      s ? { ...s, parcel: { ...s.parcel, lengthIn: e.target.value } } : s,
                    )
                  }
                />
                <Input
                  label="Width (in)"
                  type="number"
                  value={editing.parcel.widthIn}
                  onChange={(e) =>
                    setEditing((s) =>
                      s ? { ...s, parcel: { ...s.parcel, widthIn: e.target.value } } : s,
                    )
                  }
                />
                <Input
                  label="Height (in)"
                  type="number"
                  value={editing.parcel.heightIn}
                  onChange={(e) =>
                    setEditing((s) =>
                      s ? { ...s, parcel: { ...s.parcel, heightIn: e.target.value } } : s,
                    )
                  }
                />
              </Box>

              <MethodEditor
                title="Domestic methods"
                methods={editing.domesticMethods}
                onChange={(rows) =>
                  setEditing((s) => (s ? { ...s, domesticMethods: rows } : s))
                }
              />

              <MethodEditor
                title="International methods"
                methods={editing.internationalMethods}
                onChange={(rows) =>
                  setEditing((s) => (s ? { ...s, internationalMethods: rows } : s))
                }
              />
            </>
          )}

          <Box>
            <Button onClick={handleSave} disabled={upsertMutation.isLoading}>
              {upsertMutation.isLoading ? "Saving..." : "Save category rule"}
            </Button>
          </Box>
          {notice && <Text>{notice}</Text>}
        </Box>
      )}
    </Box>
  );
};

function MethodEditor({
  title,
  methods,
  onChange,
}: {
  title: string;
  methods: MethodRowState[];
  onChange: (rows: MethodRowState[]) => void;
}) {
  const update = (idx: number, patch: Partial<MethodRowState>) =>
    onChange(methods.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  const remove = (idx: number) => onChange(methods.filter((_, i) => i !== idx));
  const add = () => onChange([...methods, emptyMethodRow()]);

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Text size={4}>{title}</Text>
      {methods.length === 0 && (
        <Text size={2} color="default2">
          No methods configured for this zone.
        </Text>
      )}
      {methods.map((m, idx) => (
        <Box
          key={idx}
          display="grid"
          __gridTemplateColumns="1.5fr 2fr 1fr 1fr 1fr 1fr auto"
          gap={2}
          alignItems="end"
        >
          <Input
            label="Service token"
            value={m.serviceToken}
            list={`shippo-service-tokens-${title.replace(/\s/g, "")}`}
            onChange={(e) => update(idx, { serviceToken: e.target.value })}
          />
          <Input
            label="Display name (optional)"
            value={m.displayName}
            placeholder="Auto from service token"
            onChange={(e) => update(idx, { displayName: e.target.value })}
          />
          <Select
            label="Mode"
            value={m.mode}
            onChange={(v) => update(idx, { mode: v === "fixed" ? "fixed" : "live" })}
            options={[
              { value: "live", label: "Live (Shippo)" },
              { value: "fixed", label: "Fixed price" },
            ]}
          />
          <Input
            label="Fixed amount (USD)"
            type="number"
            value={m.fixedAmount}
            onChange={(e) => update(idx, { fixedAmount: e.target.value })}
            disabled={m.mode !== "fixed"}
          />
          <Input
            label="Min transit days"
            type="number"
            value={m.minTransitDays}
            onChange={(e) => update(idx, { minTransitDays: e.target.value })}
          />
          <Input
            label="Max transit days"
            type="number"
            value={m.maxTransitDays}
            onChange={(e) => update(idx, { maxTransitDays: e.target.value })}
          />
          <Button variant="tertiary" onClick={() => remove(idx)}>
            ✕
          </Button>
        </Box>
      ))}
      <datalist id={`shippo-service-tokens-${title.replace(/\s/g, "")}`}>
        {SERVICE_TOKEN_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <Box>
        <Button variant="secondary" onClick={add}>
          Add method
        </Button>
      </Box>
    </Box>
  );
}

function methodRuleToRow(m: MethodRule): MethodRowState {
  return {
    serviceToken: m.serviceToken,
    displayName: m.displayName ?? "",
    mode: m.mode,
    fixedAmount: m.fixedAmount === undefined ? "" : String(m.fixedAmount),
    minTransitDays: String(m.minTransitDays),
    maxTransitDays: String(m.maxTransitDays),
  };
}

function rowToMethodRule(row: MethodRowState): MethodRule | null {
  const token = row.serviceToken.trim();

  if (!token) return null;
  const minTransitDays = Math.max(0, parseInt(row.minTransitDays, 10) || 0);
  const maxTransitDays = Math.max(
    minTransitDays,
    parseInt(row.maxTransitDays, 10) || 0,
  );
  const displayName = row.displayName.trim() || undefined;

  if (row.mode === "fixed") {
    const fixedAmount = Number(row.fixedAmount);

    if (!Number.isFinite(fixedAmount) || fixedAmount < 0) return null;

    return {
      serviceToken: token,
      displayName,
      mode: "fixed",
      fixedAmount,
      minTransitDays,
      maxTransitDays,
    };
  }

  return {
    serviceToken: token,
    displayName,
    mode: "live",
    minTransitDays,
    maxTransitDays,
  };
}

function describeMethods(
  methods: ReadonlyArray<MethodRule>,
  label: string,
): string {
  if (methods.length === 0) return `${label}: —`;
  const parts = methods.map((m) =>
    m.mode === "fixed"
      ? `${m.serviceToken} $${m.fixedAmount?.toFixed(2)}`
      : `${m.serviceToken} (live)`,
  );

  return `${label}: ${parts.join(", ")}`;
}
