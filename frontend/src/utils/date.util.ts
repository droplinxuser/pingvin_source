import { Timespan } from "../types/timespan.type";

export const timespanToString = (timespan: Timespan) => {
  return `${timespan.value} ${timespan.unit}`;
};

export const stringToTimespan = (value: string): Timespan => {
  return {
    value: parseInt(value.split(" ")[0]),
    unit: value.split(" ")[1],
  } as Timespan;
};
