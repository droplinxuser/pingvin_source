import * as moment from "moment";

// Every share is assigned a rolling expiration of 100 days. It is set when the
// share is created and reset to 100 days from now whenever the share is visited.
export const SHARE_EXPIRATION_DAYS = 100;

export function getDefaultShareExpiration() {
  return moment().add(SHARE_EXPIRATION_DAYS, "days").toDate();
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
