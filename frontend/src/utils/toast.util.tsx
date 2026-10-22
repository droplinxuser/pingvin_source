import { NotificationProps, showNotification } from "@mantine/notifications";
import { TbCheck, TbX } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import { getApiErrorMessage } from "./error.util";
import { ReactNode } from "react";

const error = (
  message: ReactNode,
  config?: Omit<NotificationProps, "message">,
) =>
  showNotification({
    icon: <TbX />,
    color: "red",
    radius: "md",
    title: <FormattedMessage id="common.error" />,
    message: message,

    autoClose: true,

    ...config,
  });

const axiosError = (axiosError: any) => {
  const isRateLimited = axiosError?.response?.status === 429;

  return error(
    isRateLimited ? (
      <FormattedMessage id="common.custom.rate-limit.description" />
    ) : (
      getApiErrorMessage(axiosError) ?? (
        <FormattedMessage id="common.error.unknown" />
      )
    ),
    isRateLimited
      ? { title: <FormattedMessage id="common.custom.rate-limit.title" /> }
      : undefined,
  );
};

const success = (
  message: ReactNode,
  config?: Omit<NotificationProps, "message">,
) =>
  showNotification({
    icon: <TbCheck />,
    color: "green",
    radius: "md",
    title: <FormattedMessage id="common.success" />,
    message: message,
    autoClose: true,
    ...config,
  });

const toast = {
  error,
  success,
  axiosError,
};
export default toast;
