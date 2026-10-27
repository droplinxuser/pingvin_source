import { Button, Group, NumberInput, Stack, Switch } from "@mantine/core";
import { useForm, yupResolver } from "@mantine/form";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { getCookie, setCookie } from "cookies-next/client";
import { FormattedMessage } from "react-intl";
import * as yup from "yup";
import useTranslate, {
  translateOutsideContext,
} from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";
import { generateShareId } from "../../../utils/share.util";
import toast from "../../../utils/toast.util";
import FileSizeInput from "../../core/FileSizeInput";
import CustomUrlInput from "../CustomUrlInput";
import showCompletedReverseShareModal from "./showCompletedReverseShareModal";

const showCreateReverseShareModal = (
  modals: ModalsContextProps,
  showSendEmailNotificationOption: boolean,
  reverseShareSimpleOnly: boolean,
  appUrl: string,
  defaultAppUrl: string,
  maxShareSize: number,
  getReverseShares: () => void,
  shareIdLength: number = 16,
) => {
  const t = translateOutsideContext();

  return modals.openModal({
    title: t("account.reverseShares.modal.title"),
    children: (
      <Body
        showSendEmailNotificationOption={showSendEmailNotificationOption}
        getReverseShares={getReverseShares}
        reverseShareSimpleOnly={reverseShareSimpleOnly}
        appUrl={appUrl}
        defaultAppUrl={defaultAppUrl}
        maxShareSize={maxShareSize}
        shareIdLength={shareIdLength}
      />
    ),
  });
};

const Body = ({
  getReverseShares,
  showSendEmailNotificationOption,
  reverseShareSimpleOnly,
  appUrl,
  defaultAppUrl,
  maxShareSize,
  shareIdLength = 16,
}: {
  getReverseShares: () => void;
  showSendEmailNotificationOption: boolean;
  reverseShareSimpleOnly: boolean;
  appUrl: string;
  defaultAppUrl: string;
  maxShareSize: number;
  shareIdLength?: number;
}) => {
  const modals = useModals();
  const t = useTranslate();

  const userMaxShareSize = maxShareSize;
  const generatedToken = generateShareId(shareIdLength);

  const form = useForm({
    initialValues: {
      token: generatedToken,
      maxShareSize: userMaxShareSize,
      maxUseCount: 1,
      sendEmailNotification: false,
      // Cookies are strings: "false" used to be truthy and always restored
      // both switches as enabled.
      simplified: reverseShareSimpleOnly
        ? true
        : getCookie("reverse-share.simplified") === "true",
      publicAccess: getCookie("reverse-share.public-access") !== "false",
    },
    validate: yupResolver(
      yup.object().shape({
        token: yup
          .string()
          .required(t("common.error.field-required"))
          .min(3, t("common.error.too-short", { length: 3 }))
          .max(50, t("common.error.too-long", { length: 50 }))
          .matches(new RegExp("^[a-zA-Z0-9_-]*$"), {
            message: t("upload.modal.link.error.invalid"),
          }),
        maxUseCount: yup
          .number()
          .typeError(t("common.error.invalid-number"))
          .min(1, t("common.error.number-too-small", { min: 1 }))
          .max(1000, t("common.error.number-too-large", { max: 1000 }))
          .required(t("common.error.field-required")),
        maxShareSize: yup
          .number()
          .typeError(t("common.error.invalid-number"))
          .max(
            userMaxShareSize,
            t("upload.dropzone.notify.file-too-big", {
              maxSize: byteToHumanSizeString(userMaxShareSize),
            }),
          )
          .required(t("common.error.field-required")),
      }),
    ),
  });

  const onSubmit = form.onSubmit(async (values) => {
    if (!(await shareService.isReverseShareTokenAvailable(values.token))) {
      form.setFieldError("token", t("upload.modal.link.error.taken"));
      return;
    }

    // remember simplified and publicAccess in cookies
    setCookie("reverse-share.simplified", values.simplified);
    setCookie("reverse-share.public-access", values.publicAccess);

    shareService
      .createReverseShare(
        values.maxShareSize,
        values.maxUseCount,
        values.sendEmailNotification,
        values.simplified,
        values.publicAccess,
        values.token,
      )
      .then(({ token }) => {
        modals.closeAll();
        const link = `${appUrl !== defaultAppUrl ? appUrl : window.location.origin}/upload/${token}`;
        showCompletedReverseShareModal(modals, link, getReverseShares);
      })
      .catch(toast.axiosError);
  });

  return (
    <Group>
      <form onSubmit={onSubmit}>
        <Stack align="stretch">
          <CustomUrlInput
            form={form}
            fieldName="token"
            shareIdLength={shareIdLength}
            appUrl={appUrl}
            defaultAppUrl={defaultAppUrl}
            pathPrefix="/upload/"
          />
          <FileSizeInput
            label={t("account.reverseShares.modal.max-size.label")}
            {...form.getInputProps("maxShareSize")}
          />
          <NumberInput
            min={1}
            max={1000}
            precision={0}
            variant="filled"
            label={t("account.reverseShares.modal.max-use.label")}
            description={t("account.reverseShares.modal.max-use.description")}
            {...form.getInputProps("maxUseCount")}
          />
          {showSendEmailNotificationOption && (
            <Switch
              mt="xs"
              labelPosition="left"
              label={t("account.reverseShares.modal.send-email")}
              description={t(
                "account.reverseShares.modal.send-email.description",
              )}
              {...form.getInputProps("sendEmailNotification", {
                type: "checkbox",
              })}
            />
          )}
          {!reverseShareSimpleOnly && (
            <Switch
              mt="xs"
              labelPosition="left"
              label={t("account.reverseShares.modal.simplified")}
              description={t(
                "account.reverseShares.modal.simplified.description",
              )}
              {...form.getInputProps("simplified", {
                type: "checkbox",
              })}
            />
          )}
          <Switch
            mt="xs"
            labelPosition="left"
            label={t("account.reverseShares.modal.public-access")}
            description={t(
              "account.reverseShares.modal.public-access.description",
            )}
            {...form.getInputProps("publicAccess", {
              type: "checkbox",
            })}
          />
          <Button mt="md" type="submit">
            <FormattedMessage id="common.button.create" />
          </Button>
        </Stack>
      </form>
    </Group>
  );
};

export default showCreateReverseShareModal;
