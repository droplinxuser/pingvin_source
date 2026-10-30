import Config from "../types/config.type";
import { stringToTimespan } from "./date.util";

// Components read several keys per render. Index each config array once; a
// refresh replaces the array, so the WeakMap entry is collected with it.
const configIndexes = new WeakMap<Config[], Map<string, Config>>();

const findConfig = (key: string, configVariables: Config[]) => {
  let index = configIndexes.get(configVariables);
  if (!index) {
    index = new Map(
      configVariables.map((variable) => [variable.key, variable]),
    );
    configIndexes.set(configVariables, index);
  }
  return index.get(key);
};

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

  const configVariable = findConfig(key, configVariables);
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
