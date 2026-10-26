import { Tooltip } from "@mantine/core";
import type { TooltipProps } from "@mantine/core";
import type { ReactNode } from "react";

type HoverTipProps = {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  position?: TooltipProps["position"];
  offset?: number;
};

export const HoverTip = ({
  label,
  children,
  disabled,
  position = "bottom",
  offset = 8,
}: HoverTipProps) => {
  return (
    <Tooltip
      position={position}
      offset={offset}
      events={{ hover: true, focus: false, touch: true }}
      label={label}
      disabled={disabled}
      withinPortal
      // Adjacent icon tooltips must not cross-fade over each other while the
      // pointer moves from one target to the next.
      transitionProps={{ duration: 0 }}
    >
      {children}
    </Tooltip>
  );
};
