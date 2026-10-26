import { Tooltip } from "@mantine/core";
import type { ReactNode } from "react";

type HoverTipProps = {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
};

export const HoverTip = ({ label, children, disabled }: HoverTipProps) => {
  return (
    <Tooltip
      position="bottom"
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
