import { useSyncExternalStore } from "react";
import russian from "./translations/ru-ui.json";
import { getI18nSnapshot, subscribeI18n } from "./runtime";

const locale = () => getI18nSnapshot().locale;
const dictionary: Readonly<Record<string, string>> = russian;
export function useUiLocale(): string {
  return useSyncExternalStore(subscribeI18n, locale, locale);
}
export function uiText(source: string): string {
  return locale().startsWith("ru") ? (dictionary[source] ?? source) : source;
}
export function uiFormat(source: string, values: readonly unknown[]): string {
  return uiText(source).replace(/\{(\d+)\}/g, (_match, index: string) =>
    String(values[Number(index)]),
  );
}
export function uiValue<T>(value: T): T {
  return (typeof value === "string" ? uiText(value) : value) as T;
}
