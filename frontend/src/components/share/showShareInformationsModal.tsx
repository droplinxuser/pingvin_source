import {
  Button,
  Checkbox,
  Collapse,
  Divider,
  Flex,
  Group,
  NumberInput,
  PasswordInput,
  Progress,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm, yupResolver } from "@mantine/form";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import Link from "next/link";
import { FormattedMessage } from "react-intl";
import * as yup from "yup";
import { translateOutsideContext } from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { MyShare, UpdateShare } from "../../types/share.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import toast from "../../utils/toast.util";
import CopyTextField from "../upload/CopyTextField";
import RelativeTime from "../core/RelativeTime";
import QRCode from "./QRCode";
import { useState } from "react";

const showShareInformationsModal = (
  modals: ModalsContextProps,
  share: MyShare,
  maxShareSize: number,
  appUrl: string,
  defaultAppUrl: string,
  onShareUpdated?: (share: MyShare) => void,
  initiallyEditing = false,
) => {
  const t = translateOutsideContext();

  return modals.openModal({
    title: t("account.shares.modal.share-informations"),
    children: (
      <Body
        share={share}
        maxShareSize={maxShareSize}
        appUrl={appUrl}
        defaultAppUrl={defaultAppUrl}
        onShareUpdated={onShareUpdated}
        initiallyEditing={initiallyEditing}
      />
    ),
  });
};

const Body = ({
  share,
  maxShareSize,
  appUrl,
  defaultAppUrl,
  onShareUpdated,
  initiallyEditing,
}: {
  share: MyShare;
  maxShareSize: number;
  appUrl: string;
  defaultAppUrl: string;
  onShareUpdated?: (share: MyShare) => void;
  initiallyEditing: boolean;
}) => {
  const t = translateOutsideContext();
  const [currentShare, setCurrentShare] = useState(share);
  const [showQR, setShowQR] = useState(false);
  const [isEditing, setIsEditing] = useState(initiallyEditing);

  const handleToggleQR = () => {
    setShowQR(!showQR);
  };

  const link = `${appUrl !== defaultAppUrl ? appUrl : window.location.origin}/s/${currentShare.id}`;

  const resolvedMaxShareSize = currentShare.creator?.shareSizeLimit
    ? parseInt(currentShare.creator.shareSizeLimit)
    : maxShareSize;

  const shareSizeRatio =
    resolvedMaxShareSize > 0 ? currentShare.size / resolvedMaxShareSize : 0;

  const formattedShareSize = byteToHumanSizeString(currentShare.size);
  const formattedMaxShareSize = byteToHumanSizeString(resolvedMaxShareSize);
  const shareSizeProgress = shareSizeRatio * 100;

  if (isEditing) {
    return (
      <EditShareBody
        share={currentShare}
        onCancel={() => setIsEditing(false)}
        onShareUpdated={(updatedShare) => {
          setCurrentShare(updatedShare);
          onShareUpdated?.(updatedShare);
          setIsEditing(false);
        }}
      />
    );
  }

  return (
    <Stack align="stretch" spacing="md">
      <Text size="sm">
        <b>
          <FormattedMessage id="account.shares.table.id" />:{" "}
        </b>
        {currentShare.id}
      </Text>
      <Text size="sm">
        <b>
          <FormattedMessage id="account.shares.table.name" />:{" "}
        </b>
        {currentShare.name || "-"}
      </Text>

      <Text size="sm">
        <b>
          <FormattedMessage id="account.shares.table.description" />:{" "}
        </b>
        {currentShare.description || "-"}
      </Text>

      {currentShare.recipients && currentShare.recipients.length > 0 && (
        <Text size="sm">
          <b>
            <FormattedMessage id="upload.modal.accordion.email.title" />:{" "}
          </b>
          {currentShare.recipients.join(", ")}
        </Text>
      )}

      <Text size="sm">
        <b>
          <FormattedMessage id="account.shares.table.createdAt" />:{" "}
        </b>
        <RelativeTime date={currentShare.createdAt} />
      </Text>

      <Text size="sm">
        <b>
          <FormattedMessage id="account.shares.table.expiresAt" />:{" "}
        </b>
        {new Date(currentShare.expiration).getTime() === 0 ? (
          <FormattedMessage id="account.shares.table.expiry-never" />
        ) : (
          <RelativeTime date={currentShare.expiration} />
        )}
      </Text>
      {!!currentShare.security?.maxDownloads && (
        <Text size="sm" data-testid="share-download-limit">
          <b>
            <FormattedMessage id="upload.modal.accordion.security.max-downloads.label" />
            :{" "}
          </b>
          {currentShare.security.downloadCount ?? 0} /{" "}
          {currentShare.security.maxDownloads}
        </Text>
      )}
      <Divider />
      <CopyTextField link={link} toggleQR={handleToggleQR} />
      <Collapse in={showQR}>{showQR && <QRCode link={link} />}</Collapse>
      <Divider />
      <Text size="sm">
        <b>
          <FormattedMessage id="account.shares.table.size" />:{" "}
        </b>
        {formattedShareSize} / {formattedMaxShareSize} (
        {shareSizeProgress.toFixed(1)}%)
      </Text>

      <Flex align="center" justify="center">
        {shareSizeRatio < 0.1 && (
          <Text size="xs" style={{ marginRight: "4px" }}>
            {formattedShareSize}
          </Text>
        )}
        <Progress
          value={shareSizeProgress}
          label={shareSizeRatio >= 0.1 ? formattedShareSize : ""}
          style={{
            width: shareSizeRatio < 0.1 ? "70%" : "80%",
          }}
          size="xl"
          radius="xl"
        />
        <Text size="xs" style={{ marginLeft: "4px" }}>
          {formattedMaxShareSize}
        </Text>
      </Flex>
      <Button
        component={Link}
        href={`/share/${currentShare.id}/edit`}
        variant="light"
      >
        <FormattedMessage id="share.custom.manage-files" />
      </Button>
      <Button variant="light" onClick={() => setIsEditing(true)}>
        {t("common.button.edit")}
      </Button>
    </Stack>
  );
};

const EditShareBody = ({
  share,
  onCancel,
  onShareUpdated,
}: {
  share: MyShare;
  onCancel: () => void;
  onShareUpdated: (share: MyShare) => void;
}) => {
  const t = translateOutsideContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const security = share.security ?? {
    passwordProtected: false,
    maxViews: undefined,
    maxDownloads: undefined,
  };

  const validationSchema = yup.object().shape({
    name: yup
      .string()
      .transform((value) => value || undefined)
      .min(3, t("common.error.too-short", { length: 3 }))
      .max(30, t("common.error.too-long", { length: 30 })),
    description: yup
      .string()
      .transform((value) => value || undefined)
      .max(512, t("common.error.too-long", { length: 512 })),
    password: yup
      .string()
      .transform((value) => value || undefined)
      .min(3, t("common.error.too-short", { length: 3 }))
      .max(30, t("common.error.too-long", { length: 30 })),
    maxViews: yup
      .number()
      .nullable()
      .transform((value) => value || undefined)
      .min(1, t("common.error.number-too-small", { min: 1 })),
    maxDownloads: yup
      .number()
      .nullable()
      .transform((value) => value || undefined)
      .min(1, t("common.error.number-too-small", { min: 1 })),
  });

  const form = useForm({
    initialValues: {
      name: share.name || "",
      description: share.description || "",
      password: "",
      removePassword: false,
      maxViews: security.maxViews || undefined,
      maxDownloads: security.maxDownloads || undefined,
    },
    validate: yupResolver(validationSchema),
  });

  const onSubmit = form.onSubmit(async (values) => {
    const updateShare: UpdateShare = {
      name: values.name || null,
      description: values.description || null,
      security: {
        password: values.password || undefined,
        removePassword: values.removePassword,
        maxViews: values.maxViews || null,
        maxDownloads: values.maxDownloads || null,
      },
    };

    setIsSubmitting(true);
    try {
      const updatedShare = await shareService.update(share.id, updateShare);
      toast.success(t("share.edit.notify.save-success"));
      onShareUpdated(updatedShare);
    } catch (e) {
      toast.axiosError(e);
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit}>
      <Stack align="stretch">
        <TextInput
          variant="filled"
          label={t("account.shares.table.name")}
          placeholder={t(
            "upload.modal.accordion.name-and-description.name.placeholder",
          )}
          {...form.getInputProps("name")}
        />
        <Textarea
          variant="filled"
          label={t("account.shares.table.description")}
          placeholder={t(
            "upload.modal.accordion.name-and-description.description.placeholder",
          )}
          {...form.getInputProps("description")}
        />
        <Divider />
        <PasswordInput
          variant="filled"
          label={t("upload.modal.accordion.security.password.label")}
          placeholder={
            security.passwordProtected
              ? t("account.shares.modal.edit.password.keep")
              : t("upload.modal.accordion.security.password.placeholder")
          }
          autoComplete="new-password"
          disabled={form.values.removePassword}
          {...form.getInputProps("password")}
        />
        {security.passwordProtected && (
          <Checkbox
            label={t("account.shares.modal.edit.password.remove")}
            {...form.getInputProps("removePassword", { type: "checkbox" })}
          />
        )}
        <NumberInput
          min={1}
          type="number"
          variant="filled"
          placeholder={t(
            "upload.modal.accordion.security.max-views.placeholder",
          )}
          label={t("upload.modal.accordion.security.max-views.label")}
          {...form.getInputProps("maxViews")}
        />
        <NumberInput
          min={1}
          type="number"
          variant="filled"
          placeholder={t(
            "upload.modal.accordion.security.max-downloads.placeholder",
          )}
          label={t("upload.modal.accordion.security.max-downloads.label")}
          description={t(
            "upload.modal.accordion.security.max-downloads.description",
          )}
          {...form.getInputProps("maxDownloads")}
        />
        <Group position="right">
          <Button variant="default" onClick={onCancel}>
            {t("common.button.cancel")}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t("common.button.save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

export default showShareInformationsModal;
