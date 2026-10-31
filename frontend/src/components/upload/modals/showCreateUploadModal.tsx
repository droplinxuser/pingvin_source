import {
  Accordion,
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Stack,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { useForm, yupResolver } from "@mantine/form";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import React, { useState } from "react";
import { TbAlertCircle, TbCopy, TbWand } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import * as yup from "yup";
import useTranslate, {
  translateOutsideContext,
} from "../../../hooks/useTranslate.hook";
import shareService from "../../../services/share.service";
import { FileUpload } from "../../../types/File.type";
import { CreateShare } from "../../../types/share.type";
import toast from "../../../utils/toast.util";
import { generatePassword } from "../../../utils/password.util";
import { generateShareId } from "../../../utils/share.util";
import CustomUrlInput from "../../share/CustomUrlInput";

const showCreateUploadModal = (
  modals: ModalsContextProps,
  options: {
    isUserSignedIn: boolean;
    appUrl: string;
    defaultAppUrl: string;
    allowUnauthenticatedShares: boolean;
    enableEmailRecepients: boolean;
    enableUserRecipients: boolean;
    shareIdLength: number;
    simplified: boolean;
  },
  files: FileUpload[],
  uploadCallback: (createShare: CreateShare, files: FileUpload[]) => void,
) => {
  const t = translateOutsideContext();

  if (options.simplified) {
    return modals.openModal({
      title: t("upload.modal.title"),
      children: (
        <SimplifiedCreateUploadModalModal
          options={options}
          files={files}
          uploadCallback={uploadCallback}
        />
      ),
    });
  }

  return modals.openModal({
    title: t("upload.modal.title"),
    children: (
      <CreateUploadModalBody
        options={options}
        files={files}
        uploadCallback={uploadCallback}
      />
    ),
  });
};

const generateAvailableLink = async (
  shareIdLength: number,
  times: number = 10,
): Promise<string> => {
  if (times <= 0) {
    throw new Error("Could not generate available link");
  }
  const _link = generateShareId(shareIdLength);
  if (!(await shareService.isShareIdAvailable(_link))) {
    return await generateAvailableLink(shareIdLength, times - 1);
  } else {
    return _link;
  }
};

const CreateUploadModalBody = ({
  uploadCallback,
  files,
  options,
}: {
  files: FileUpload[];
  uploadCallback: (createShare: CreateShare, files: FileUpload[]) => void;
  options: {
    isUserSignedIn: boolean;
    appUrl: string;
    defaultAppUrl: string;
    allowUnauthenticatedShares: boolean;
    enableEmailRecepients: boolean;
    enableUserRecipients: boolean;
    shareIdLength: number;
  };
}) => {
  const modals = useModals();
  const t = useTranslate();
  const clipboard = useClipboard({ timeout: 800 });

  const generatedLink = generateShareId(options.shareIdLength);

  const [showNotSignedInAlert, setShowNotSignedInAlert] = useState(true);
  const [emailSearch, setEmailSearch] = useState("");

  const validationSchema = yup.object().shape({
    link: yup
      .string()
      .required(t("common.error.field-required"))
      .min(3, t("common.error.too-short", { length: 3 }))
      .max(50, t("common.error.too-long", { length: 50 }))
      .matches(new RegExp("^[a-zA-Z0-9_-]*$"), {
        message: t("upload.modal.link.error.invalid"),
      }),
    name: yup
      .string()
      .transform((value) => value || undefined)
      .min(3, t("common.error.too-short", { length: 3 }))
      .max(30, t("common.error.too-long", { length: 30 })),
    password: yup
      .string()
      .transform((value) => value || undefined)
      .min(3, t("common.error.too-short", { length: 3 }))
      .max(30, t("common.error.too-long", { length: 30 })),
    maxViews: yup
      .number()
      .transform((value) => value || undefined)
      .min(1),
    maxDownloads: yup
      .number()
      .transform((value) => value || undefined)
      .min(1),
    description: yup
      .string()
      .optional()
      .max(512, t("common.error.too-long", { length: 512 })),
  });

  const form = useForm({
    initialValues: {
      name: undefined,
      link: generatedLink,
      recipients: [] as string[],
      password: "",
      maxViews: undefined,
      maxDownloads: undefined,
      description: undefined,
      restrictToRecipients: false,
    },
    validate: yupResolver(validationSchema),
  });

  const handleRestrictToggle = (checked: boolean) => {
    form.setFieldValue("restrictToRecipients", checked);
    if (checked) {
      // A share can't be both password-protected and restricted to recipients.
      form.setFieldValue("password", "");
    }
  };

  const onSubmit = form.onSubmit(async (values) => {
    if (!(await shareService.isShareIdAvailable(values.link))) {
      form.setFieldError("link", t("upload.modal.link.error.taken"));
    } else {
      uploadCallback(
        {
          id: values.link,
          name: values.name,
          recipients: values.recipients,
          description: values.description,
          security: {
            password: values.restrictToRecipients
              ? undefined
              : values.password || undefined,
            maxViews: values.maxViews || undefined,
            maxDownloads: values.maxDownloads || undefined,
            restrictToRecipients: values.restrictToRecipients || undefined,
          },
        },
        files,
      );
      modals.closeAll();
    }
  });

  return (
    <>
      {showNotSignedInAlert && !options.isUserSignedIn && (
        <Alert
          withCloseButton
          onClose={() => setShowNotSignedInAlert(false)}
          icon={<TbAlertCircle size={16} />}
          title={t("upload.modal.not-signed-in")}
          color="yellow"
        >
          <FormattedMessage id="upload.modal.not-signed-in-description" />
        </Alert>
      )}
      <form onSubmit={onSubmit}>
        <Stack align="stretch">
          <CustomUrlInput
            form={form}
            fieldName="link"
            shareIdLength={options.shareIdLength}
            appUrl={options.appUrl}
            defaultAppUrl={options.defaultAppUrl}
            pathPrefix="/s/"
          />
          <Accordion>
            <Accordion.Item value="description" sx={{ borderBottom: "none" }}>
              <Accordion.Control>
                <FormattedMessage id="upload.modal.accordion.name-and-description.title" />
              </Accordion.Control>
              <Accordion.Panel>
                <Stack align="stretch">
                  <TextInput
                    variant="filled"
                    placeholder={t(
                      "upload.modal.accordion.name-and-description.name.placeholder",
                    )}
                    {...form.getInputProps("name")}
                  />
                  <Textarea
                    variant="filled"
                    placeholder={t(
                      "upload.modal.accordion.name-and-description.description.placeholder",
                    )}
                    {...form.getInputProps("description")}
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
            {/* Email recipients and security are member-only; a guest upload
                only gets the link and a name/description. */}
            {options.isUserSignedIn && options.enableEmailRecepients && (
              <Accordion.Item value="recipients" sx={{ borderBottom: "none" }}>
                <Accordion.Control>
                  <FormattedMessage id="upload.modal.accordion.email.title" />
                </Accordion.Control>
                <Accordion.Panel>
                  <MultiSelect
                    data={form.values.recipients}
                    placeholder={t("upload.modal.accordion.email.placeholder")}
                    searchable
                    creatable
                    id="recipient-emails"
                    inputMode="email"
                    searchValue={emailSearch}
                    onSearchChange={setEmailSearch}
                    getCreateLabel={(query) => `+ ${query}`}
                    onCreate={(query) => {
                      if (!query.match(/^\S+@\S+\.\S+$/)) {
                        form.setFieldError(
                          "recipients",
                          t("upload.modal.accordion.email.invalid-email"),
                        );
                        return undefined;
                      }
                      form.setFieldError("recipients", null);
                      const newRecipients = form.values.recipients.includes(
                        query,
                      )
                        ? form.values.recipients
                        : [...form.values.recipients, query];
                      form.setFieldValue("recipients", newRecipients);
                      return query;
                    }}
                    {...form.getInputProps("recipients")}
                    onChange={(value: string[]) => {
                      form.setFieldValue("recipients", value);
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter" || e.key === "," || e.key === ";") {
                        e.preventDefault();
                        const inputValue = emailSearch.trim();
                        if (
                          inputValue.match(/^\S+@\S+\.\S+$/) &&
                          !form.values.recipients.includes(inputValue)
                        ) {
                          const newRecipients = [
                            ...form.values.recipients,
                            inputValue,
                          ];
                          form.setFieldValue("recipients", newRecipients);
                        }
                        setEmailSearch("");
                      } else if (e.key === " ") {
                        e.preventDefault();
                        setEmailSearch("");
                      }
                    }}
                  />
                  {options.enableUserRecipients && (
                    <Checkbox
                      mt="sm"
                      label={t(
                        "upload.modal.accordion.email.restrict-to-recipients",
                      )}
                      checked={form.values.restrictToRecipients}
                      onChange={(e) =>
                        handleRestrictToggle(e.currentTarget.checked)
                      }
                    />
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            )}

            {options.isUserSignedIn && (
              <Accordion.Item value="security" sx={{ borderBottom: "none" }}>
                <Accordion.Control>
                  <FormattedMessage id="upload.modal.accordion.security.title" />
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack align="stretch">
                    {!form.values.restrictToRecipients && (
                      <Stack spacing="xs">
                        <PasswordInput
                          variant="filled"
                          placeholder={t(
                            "upload.modal.accordion.security.password.placeholder",
                          )}
                          label={t(
                            "upload.modal.accordion.security.password.label",
                          )}
                          autoComplete="new-password"
                          {...form.getInputProps("password")}
                        />
                        <Group spacing="xs">
                          <Button
                            type="button"
                            size="xs"
                            variant="light"
                            leftIcon={<TbWand size={14} />}
                            onClick={() => {
                              form.setFieldValue(
                                "password",
                                generatePassword(),
                              );
                              toast.success(
                                t(
                                  "upload.modal.accordion.security.password.generated",
                                ),
                              );
                            }}
                          >
                            {t(
                              "upload.modal.accordion.security.password.generate",
                            )}
                          </Button>
                          <Tooltip
                            label={t(
                              "upload.modal.accordion.security.password.copy",
                            )}
                            openDelay={200}
                          >
                            <ActionIcon
                              type="button"
                              variant="subtle"
                              disabled={!form.values.password}
                              aria-label={t(
                                "upload.modal.accordion.security.password.copy",
                              )}
                              onClick={() => {
                                clipboard.copy(form.values.password || "");
                                toast.success(
                                  t(
                                    "upload.modal.accordion.security.password.copied",
                                  ),
                                );
                              }}
                            >
                              <TbCopy size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Stack>
                    )}
                    <NumberInput
                      min={1}
                      precision={0}
                      type="number"
                      variant="filled"
                      placeholder={t(
                        "upload.modal.accordion.security.max-views.placeholder",
                      )}
                      label={t(
                        "upload.modal.accordion.security.max-views.label",
                      )}
                      {...form.getInputProps("maxViews")}
                    />
                    <NumberInput
                      min={1}
                      precision={0}
                      type="number"
                      variant="filled"
                      placeholder={t(
                        "upload.modal.accordion.security.max-downloads.placeholder",
                      )}
                      label={t(
                        "upload.modal.accordion.security.max-downloads.label",
                      )}
                      description={t(
                        "upload.modal.accordion.security.max-downloads.description",
                      )}
                      {...form.getInputProps("maxDownloads")}
                    />
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            )}
          </Accordion>
          <Button type="submit" data-autofocus>
            <FormattedMessage id="common.button.share" />
          </Button>
        </Stack>
      </form>
    </>
  );
};

const SimplifiedCreateUploadModalModal = ({
  uploadCallback,
  files,
  options,
}: {
  files: FileUpload[];
  uploadCallback: (createShare: CreateShare, files: FileUpload[]) => void;
  options: {
    isUserSignedIn: boolean;
    allowUnauthenticatedShares: boolean;
    enableEmailRecepients: boolean;
    shareIdLength: number;
  };
}) => {
  const modals = useModals();
  const t = useTranslate();

  const [showNotSignedInAlert, setShowNotSignedInAlert] = useState(true);

  const validationSchema = yup.object().shape({
    name: yup
      .string()
      .transform((value) => value || undefined)
      .min(3, t("common.error.too-short", { length: 3 }))
      .max(30, t("common.error.too-long", { length: 30 })),
    description: yup
      .string()
      .optional()
      .max(512, t("common.error.too-long", { length: 512 })),
  });

  const form = useForm({
    initialValues: {
      name: undefined,
      description: undefined,
    },
    validate: yupResolver(validationSchema),
  });

  const onSubmit = form.onSubmit(async (values) => {
    const link = await generateAvailableLink(options.shareIdLength).catch(
      () => {
        toast.error(t("upload.modal.link.error.taken"));
        return undefined;
      },
    );

    if (!link) {
      return;
    }

    uploadCallback(
      {
        id: link,
        name: values.name,
        recipients: [],
        description: values.description,
        security: {
          password: undefined,
          maxViews: undefined,
        },
      },
      files,
    );
    modals.closeAll();
  });

  return (
    <Stack>
      {showNotSignedInAlert && !options.isUserSignedIn && (
        <Alert
          withCloseButton
          onClose={() => setShowNotSignedInAlert(false)}
          icon={<TbAlertCircle size={16} />}
          title={t("upload.modal.not-signed-in")}
          color="yellow"
        >
          <FormattedMessage id="upload.modal.not-signed-in-description" />
        </Alert>
      )}
      <form onSubmit={onSubmit}>
        <Stack align="stretch">
          <Stack align="stretch">
            <TextInput
              variant="filled"
              placeholder={t(
                "upload.modal.accordion.name-and-description.name.placeholder",
              )}
              {...form.getInputProps("name")}
            />
            <Textarea
              variant="filled"
              placeholder={t(
                "upload.modal.accordion.name-and-description.description.placeholder",
              )}
              {...form.getInputProps("description")}
            />
          </Stack>
          <Button type="submit" data-autofocus>
            <FormattedMessage id="common.button.share" />
          </Button>
        </Stack>
      </form>
    </Stack>
  );
};

export default showCreateUploadModal;
