import Config from "../types/config.type";
import { stringToTimespan } from "./date.util";

/**
 * Reads a typed value from the public config array. Kept free of axios so the
 * Edge middleware can use it without pulling Node-only polyfills into its
 * bundle.
 */
export const getConfig = (
  key: string,
  configVariables: Config[],
  returnDefault: boolean = false,
): any => {
  if (!configVariables) return null;

  const configVariable = configVariables.find(
    (variable) => variable.key === key,
  );
  if (!configVariable) throw new Error(`Config variable ${key} not found`);

  const value = returnDefault
    ? configVariable.defaultValue
    : (configVariable.value ?? configVariable.defaultValue);

  if (configVariable.type === "number" || configVariable.type === "filesize")
    return parseInt(value);
  if (configVariable.type === "boolean") return value === "true";
  if (configVariable.type === "string" || configVariable.type === "text")
    return value;
  if (configVariable.type === "timespan") return stringToTimespan(value);
};
