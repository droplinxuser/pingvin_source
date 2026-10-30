import { useState } from "react";
import { Timespan } from "../../types/timespan.type";
import { NativeSelect, NumberInput } from "@mantine/core";
import useTranslate from "../../hooks/useTranslate.hook";

const unitMinutes: Record<Timespan["unit"], number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
  months: 60 * 24 * 30,
  years: 60 * 24 * 365,
};

const TimespanInput = ({
  label,
  value,
  onChange,
  ...restProps
}: {
  label?: string;
  value: Timespan;
  onChange: (timespan: Timespan) => void;
  [key: string]: any;
}) => {
  const [unit, setUnit] = useState(value.unit);
  const [inputValue, setInputValue] = useState(value.value);
  const t = useTranslate();

  const version = inputValue == 1 ? "singular" : "plural";
  const unitSelect = (
    <NativeSelect
      aria-label={t("common.custom.unit")}
      data={[
        {
          value: "minutes",
          label: t(`upload.modal.expires.minute-${version}`),
        },
        {
          value: "hours",
          label: t(`upload.modal.expires.hour-${version}`),
        },
        {
          value: "days",
          label: t(`upload.modal.expires.day-${version}`),
        },
        {
          value: "weeks",
          label: t(`upload.modal.expires.week-${version}`),
        },
        {
          value: "months",
          label: t(`upload.modal.expires.month-${version}`),
        },
        {
          value: "years",
          label: t(`upload.modal.expires.year-${version}`),
        },
      ]}
      value={unit}
      rightSectionWidth={28}
      styles={{
        input: {
          fontWeight: 500,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          width: 120,
          marginRight: -2,
        },
      }}
      onChange={(event) => {
        const nextUnit = event.currentTarget.value as Timespan["unit"];
        // Convert the displayed number when the unit changes so "3 months"
        // does not silently become "3 days".
        const minutes = inputValue * unitMinutes[unit];
        const nextValue = Math.max(
          0,
          Math.round(minutes / unitMinutes[nextUnit]),
        );
        setUnit(nextUnit);
        setInputValue(nextValue);
        onChange({ value: nextValue, unit: nextUnit });
      }}
    />
  );

  return (
    <NumberInput
      label={label}
      value={inputValue}
      min={0}
      max={999999}
      precision={0}
      rightSection={unitSelect}
      rightSectionWidth={120}
      onChange={(value) => {
        const inputVal = value || 0;
        setInputValue(inputVal);
        onChange({ value: inputVal, unit });
      }}
      {...restProps}
    />
  );
};

export default TimespanInput;
