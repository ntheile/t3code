export const UI_SCALE_OPTIONS = ["small", "medium", "large", "xl", "xxl"] as const;

export type UiScale = (typeof UI_SCALE_OPTIONS)[number];

const DEFAULT_UI_SCALE: UiScale = "medium";

const ROOT_FONT_SIZE_PX_BY_UI_SCALE: Record<UiScale, number> = {
  small: 14,
  medium: 16,
  large: 18,
  xl: 20,
  xxl: 22,
};

const TERMINAL_FONT_SIZE_PX_BY_UI_SCALE: Record<UiScale, number> = {
  small: 11,
  medium: 12,
  large: 14,
  xl: 16,
  xxl: 18,
};

export function resolveUiScale(value: string | null | undefined): UiScale {
  return UI_SCALE_OPTIONS.includes(value as UiScale) ? (value as UiScale) : DEFAULT_UI_SCALE;
}

export function rootFontSizePxForUiScale(scale: UiScale): number {
  return ROOT_FONT_SIZE_PX_BY_UI_SCALE[scale];
}

export function terminalFontSizePxForUiScale(scale: UiScale): number {
  return TERMINAL_FONT_SIZE_PX_BY_UI_SCALE[scale];
}

export function readUiScaleFromDocument(): UiScale {
  return resolveUiScale(document.documentElement.dataset.uiScale);
}
