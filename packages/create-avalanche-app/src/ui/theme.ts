import { defaultTheme, extendTheme, type Theme } from "@inkjs/ui";

/** Ember Crimson brand palette — matches the AvaKit website's accent. */
export const C = {
  crimson: "#e11d48", // rose-600
  crimsonBright: "#f43f5e", // rose-500
  crimsonDeep: "#be123c", // rose-700
  white: "#ffffff",
  dim: "#8b8f98",
  green: "#4ade80",
  yellow: "#fbbf24",
} as const;

/** A crimson shade interpolated peak → base (t in [0,1]) for the wordmark. */
export function crimsonAt(t: number): string {
  const a = [251, 113, 133];
  const b = [159, 18, 57];
  const ch = (i: number) =>
    Math.round((a[i] as number) + ((b[i] as number) - (a[i] as number)) * t);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(ch(0))}${hex(ch(1))}${hex(ch(2))}`;
}

/** Brand the @inkjs/ui components: crimson focus / selection. */
export const uiTheme: Theme = extendTheme(defaultTheme, {
  components: {
    Select: {
      styles: {
        focusIndicator: () => ({ color: C.crimson }),
        selectedIndicator: () => ({ color: C.crimson }),
        label: ({ isFocused, isSelected }: { isFocused?: boolean; isSelected?: boolean }) => ({
          color: isFocused ? C.crimsonBright : isSelected ? C.white : C.dim,
          bold: Boolean(isFocused),
        }),
      },
    },
  },
});
