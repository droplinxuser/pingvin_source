import * as moment from "moment";

// Every share is assigned a rolling expiration of 100 days. It is set when the
// share is created and reset to 100 days from now whenever the share is visited.
export const SHARE_EXPIRATION_DAYS = 100;

export function getDefaultShareExpiration() {
  return moment().add(SHARE_EXPIRATION_DAYS, "days").toDate();
}

// Hard cap for every share expiration, even when share.maxExpiration is set
// to 0 ("unlimited"). Permanent shares (unix epoch 0) are rejected.
export const MAX_SHARE_EXPIRATION_YEARS = 5;

export function isExpirationAllowed(expiration: Date, maxExpiration: Timespan) {
  if (moment(expiration).isSame(0)) return false;
  if (
    moment(expiration).isAfter(
      moment().add(MAX_SHARE_EXPIRATION_YEARS, "years"),
    )
  )
    return false;

  return (
    maxExpiration.value === 0 ||
    moment(expiration).isSameOrBefore(
      moment().add(maxExpiration.value, maxExpiration.unit),
    )
  );
}

export function parseRelativeDateToAbsolute(relativeDate: string) {
  if (relativeDate == "never") return moment(0).toDate();

  return moment()
    .add(
      relativeDate.split("-")[0],
      relativeDate.split("-")[1] as moment.unitOfTime.DurationConstructor,
    )
    .toDate();
}

type Timespan = {
  value: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
};

export function stringToTimespan(value: string): Timespan {
  const [time, unit] = value.split(" ");
  return {
    value: parseInt(time),
    unit: unit as Timespan["unit"],
  };
}

export function timespanToString(timespan: Timespan) {
  return `${timespan.value} ${timespan.unit}`;
}
