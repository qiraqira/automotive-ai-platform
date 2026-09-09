// KnowledgeDelta (extension §8): "what's actually new compared to what we
// already know" — the input decideComposition() needs before deciding
// CREATE/UPDATE/REJECT. Kept separate from decideComposition on purpose:
// computing the delta needs to look at real Fact values, while the
// composition decision only needs the resulting number — different
// inputs, different tests, no reason to fuse them into one function.

export interface KnownFact {
  attribute: string;
  value: string;
  unit?: string | null;
}

export interface FactDelta {
  attribute: string;
  changed: boolean;
  /** Numeric change (new − old) when both values parse as numbers;
   * null when the attribute is brand new or the values aren't numeric
   * (e.g. a status string change) — those still count as "changed", just
   * without a meaningful magnitude. */
  numericDelta: number | null;
  previousValue: string | null;
  newValue: string;
  description: string;
}

function tryParseNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function computeFactDeltas(existingFacts: KnownFact[], newFacts: KnownFact[]): FactDelta[] {
  const existingByAttribute = new Map(existingFacts.map((f) => [f.attribute, f]));

  return newFacts.map((newFact): FactDelta => {
    const existing = existingByAttribute.get(newFact.attribute);

    if (!existing) {
      return {
        attribute: newFact.attribute,
        changed: true,
        numericDelta: null,
        previousValue: null,
        newValue: newFact.value,
        description: `New fact: ${newFact.attribute} = ${newFact.value}${newFact.unit ? ` ${newFact.unit}` : ""}`,
      };
    }

    if (existing.value === newFact.value) {
      return {
        attribute: newFact.attribute,
        changed: false,
        numericDelta: 0,
        previousValue: existing.value,
        newValue: newFact.value,
        description: `No change: ${newFact.attribute} is still ${newFact.value}${newFact.unit ? ` ${newFact.unit}` : ""}`,
      };
    }

    const oldNum = tryParseNumber(existing.value);
    const newNum = tryParseNumber(newFact.value);
    const numericDelta = oldNum !== null && newNum !== null ? newNum - oldNum : null;
    const unitSuffix = newFact.unit ? ` ${newFact.unit}` : "";

    return {
      attribute: newFact.attribute,
      changed: true,
      numericDelta,
      previousValue: existing.value,
      newValue: newFact.value,
      description:
        numericDelta !== null
          ? `${newFact.attribute}: ${existing.value} → ${newFact.value}${unitSuffix} (${numericDelta > 0 ? "+" : ""}${numericDelta}${unitSuffix})`
          : `${newFact.attribute}: ${existing.value} → ${newFact.value}${unitSuffix}`,
    };
  });
}

/** Rolls a set of FactDeltas up into the single number decideComposition()
 * takes — every changed fact contributes at least 1, so a purely
 * non-numeric change (e.g. a status flip) still counts as real delta, not
 * zero just because it has no magnitude. */
export function summarizeKnowledgeDelta(deltas: FactDelta[]): number {
  return deltas.reduce((total, d) => {
    if (!d.changed) return total;
    return total + (d.numericDelta !== null ? Math.abs(d.numericDelta) || 1 : 1);
  }, 0);
}
