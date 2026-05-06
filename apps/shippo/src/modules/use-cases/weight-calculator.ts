export type WeightedLine = {
  quantity: number;
  unitWeightValue: number | null | undefined;
  unitWeightUnit: string | null | undefined;
};

/**
 * Sum cart/order line weights and convert to ounces, which is what the
 * Shippo rating uses total weight in ounces. Supported input units: kg, g, lb, oz, tonne.
 */
export const computeTotalWeightOunces = (
  lines: ReadonlyArray<WeightedLine>,
  fallbackOunces: number,
): number => {
  const perUnitOz = (weightValue: number | null | undefined, unit: string | null | undefined) => {
    if (!weightValue || !unit) return fallbackOunces;
    const normalized = unit.toLowerCase();

    switch (normalized) {
      case "oz":
      case "ounce":
        return weightValue;
      case "lb":
      case "pound":
        return weightValue * 16;
      case "g":
      case "gram":
        return weightValue * 0.0352739619;
      case "kg":
      case "kilogram":
        return weightValue * 35.2739619;
      case "tonne":
        return weightValue * 35_273.9619;
      default:
        return fallbackOunces;
    }
  };

  const total = lines.reduce((sum, line) => {
    const per = perUnitOz(line.unitWeightValue, line.unitWeightUnit);

    return sum + per * Math.max(line.quantity, 0);
  }, 0);

  return total > 0 ? total : fallbackOunces;
};
