import moment from "moment";
import { Timespan } from "../types/timespan.type";

// Hard cap for every share expiration, even when share.maxExpiration is 0
// ("unlimited"). Permanent shares are not allowed.
export const MAX_SHARE_EXPIRATION_YEARS = 5;

// The latest allowed expiration date: the configured share.maxExpiration
// (0 = the hard cap applies) capped at MAX_SHARE_EXPIRATION_YEARS.
export const getMaxExpirationDate = (maxExpiration?: Timespan) => {
  const fiveYears = moment().add(MAX_SHARE_EXPIRATION_YEARS, "years");
  const configMax =
    maxExpiration && maxExpiration.value != 0
      ? moment().add(maxExpiration.value, maxExpiration.unit)
      : fiveYears;
  return configMax.isBefore(fiveYears) ? configMax : fiveYears;
};

export const getExpirationPreview = (
  messages: {
    expiresOn: string;
  },
  form: {
    values: {
      expiration_num: number;
      expiration_unit: string;
    };
  },
) => {
  const value = form.values.expiration_num + form.values.expiration_unit;

  const expirationDate = moment()
    .add(
      value.split("-")[0],
      value.split("-")[1] as moment.unitOfTime.DurationConstructor,
    )
    .toDate();

  return messages.expiresOn.replace(
    "{expiration}",
    moment(expirationDate).format("LLL"),
  );
};

export const timespanToString = (timespan: Timespan) => {
  return `${timespan.value} ${timespan.unit}`;
};

export const stringToTimespan = (value: string): Timespan => {
  return {
    value: parseInt(value.split(" ")[0]),
    unit: value.split(" ")[1],
  } as Timespan;
};
