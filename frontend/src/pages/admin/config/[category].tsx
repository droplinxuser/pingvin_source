import {
  Alert,
  Anchor,
  AppShell,
  Box,
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { TbInfoCircle } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../../components/Meta";
import AdminConfigInput from "../../../components/admin/configuration/AdminConfigInput";
import ConfigurationHeader from "../../../components/admin/configuration/ConfigurationHeader";
import ConfigurationNavBar from "../../../components/admin/configuration/ConfigurationNavBar";
import LogoConfigInput from "../../../components/admin/configuration/LogoConfigInput";
import TestEmailButton from "../../../components/admin/configuration/TestEmailButton";
import TestRedisButton from "../../../components/admin/configuration/TestRedisButton";
import CenterLoader from "../../../components/core/CenterLoader";
import useConfig from "../../../hooks/config.hook";
import useTranslate from "../../../hooks/useTranslate.hook";
import configService from "../../../services/config.service";
import { AdminConfig, UpdateConfig } from "../../../types/config.type";
import { camelToKebab } from "../../../utils/string.util";
import toast from "../../../utils/toast.util";

// Routes use the lowercase category ids understood by the config API. Any
// other value falls back to General instead of rendering a missing heading.
const configCategories = [
  "general",
  "appearance",
  "security",
  "email",
  "share",
  "smtp",
  "oauth",
  "ldap",
  "s3",
  "legal",
  "cache",
];

export default function AppShellDemo() {
  const theme = useMantineTheme();
  const router = useRouter();
  const t = useTranslate();

  const [isMobileNavBarOpened, setIsMobileNavBarOpened] = useState(false);
  const isMobile = useMediaQuery("(max-width: 560px)");
  const config = useConfig();

  const requestedCategory =
    typeof router.query.category === "string" ? router.query.category : "";
  const categoryId = configCategories.includes(requestedCategory)
    ? requestedCategory
    : "general";

  const [configVariables, setConfigVariables] = useState<AdminConfig[]>();
  const [updatedConfigVariables, setUpdatedConfigVariables] = useState<
    UpdateConfig[]
  >([]);
  const [optionalConfigVariables, setOptionalConfigVariables] =
    useState<AdminConfig[]>();
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [logo, setLogo] = useState<File | null>(null);
  const [darkLogo, setDarkLogo] = useState<File | null>(null);

  const isEditingAllowed = (): boolean => {
    return !configVariables || configVariables[0].allowEdit;
  };

  const saveConfigVariables = async () => {
    if (logo) {
      await configService
        .changeLogo(logo)
        .then(() => {
          setLogo(null);
          toast.success(t("admin.config.notify.logo-success"));
        })
        .catch(toast.axiosError);
    }

    if (darkLogo) {
      await configService
        .changeDarkLogo(darkLogo)
        .then(() => {
          setDarkLogo(null);
          toast.success(t("admin.config.notify.logo-success"));
        })
        .catch(toast.axiosError);
    }

    if (updatedConfigVariables.length > 0) {
      await configService
        .updateMany(updatedConfigVariables)
        .then(() => {
          setConfigVariables((prev) =>
            prev?.map((cv) => {
              const updated = updatedConfigVariables.find(
                (u) => u.key === cv.key,
              );
              return updated ? { ...cv, value: String(updated.value) } : cv;
            }),
          );
          setUpdatedConfigVariables([]);
          toast.success(t("admin.config.notify.success"));
        })
        .catch(toast.axiosError);
      void config.refresh().catch(() => {
        // The saved values are already in local state; a failed refresh only
        // delays the public-config update until the next page load.
      });
    } else {
      toast.success(t("admin.config.notify.no-changes"));
    }
  };

  const updateConfigVariable = (configVariable: UpdateConfig) => {
    if (configVariable.key === "general.appUrl") {
      configVariable.value = sanitizeUrl(configVariable.value);
    }

    const index = updatedConfigVariables.findIndex(
      (item) => item.key === configVariable.key,
    );

    if (index > -1) {
      updatedConfigVariables[index] = {
        ...updatedConfigVariables[index],
        ...configVariable,
      };
    } else {
      setUpdatedConfigVariables([...updatedConfigVariables, configVariable]);
    }
  };

  const sanitizeUrl = (url: string): string => {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  };

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    // Edits belong to the category they were made in. Keeping them while the
    // admin switches categories could silently save another section's values.
    setUpdatedConfigVariables([]);
    setOptionalConfigVariables(undefined);
    setLogo(null);
    setDarkLogo(null);

    configService
      .getByCategory(categoryId)
      .then((configVariables) => {
        if (!cancelled) setConfigVariables(configVariables);
      })
      .catch(() => {
        if (cancelled) return;
        setConfigVariables(undefined);
        setLoadError(true);
      });

    if (
      categoryId === "email" ||
      categoryId === "security" ||
      categoryId === "share"
    ) {
      configService
        .getByCategory("smtp")
        .then((smtpConfigVariables) => {
          if (cancelled) return;
          setOptionalConfigVariables(
            smtpConfigVariables.filter(
              (configVariable) => configVariable.key === "smtp.enabled",
            ),
          );
        })
        .catch(() => {
          // The SMTP toggle is optional; the category still renders.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [categoryId, reloadKey]);

  return (
    <>
      <Meta title={t("admin.config.title")} />
      <AppShell
        styles={{
          main: {
            background:
              theme.colorScheme === "dark"
                ? theme.colors.dark[8]
                : theme.colors.gray[0],
          },
        }}
        navbar={
          <ConfigurationNavBar
            categoryId={categoryId}
            isMobileNavBarOpened={isMobileNavBarOpened}
            setIsMobileNavBarOpened={setIsMobileNavBarOpened}
          />
        }
        header={
          <ConfigurationHeader
            isMobileNavBarOpened={isMobileNavBarOpened}
            setIsMobileNavBarOpened={setIsMobileNavBarOpened}
          />
        }
      >
        <Container size="lg">
          {loadError ? (
            <Alert
              color="red"
              variant="light"
              title={t("common.error")}
              icon={<TbInfoCircle />}
            >
              <Group>
                <Button
                  variant="light"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  <FormattedMessage id="common.custom.retry" />
                </Button>
              </Group>
            </Alert>
          ) : !configVariables ? (
            <CenterLoader />
          ) : (
            <>
              {/*
               * Keep custom CSS at the bottom in Appearance settings for better UX.
               */}
              {(() => {
                const customCssConfigVariable = configVariables.find(
                  (configVariable) =>
                    configVariable.key === "appearance.customCss",
                );
                const getEffectiveConfigValue = (key: string): string => {
                  const updatedValue = updatedConfigVariables.find(
                    (item) => item.key === key,
                  );
                  if (updatedValue) return updatedValue.value;

                  const configVariable = configVariables.find(
                    (item) => item.key === key,
                  );
                  return (
                    configVariable?.value ?? configVariable?.defaultValue ?? ""
                  );
                };

                const shouldShowPrimaryColorOverride =
                  getEffectiveConfigValue("appearance.themePrimaryColor") ===
                  "custom";
                const shouldShowCustomPasswordPolicies =
                  getEffectiveConfigValue("security.customPasswordPolicy") ===
                  "true";
                const visibleConfigVariables = configVariables.filter(
                  (configVariable) =>
                    configVariable.key !== "appearance.customCss",
                );

                return (
                  <>
                    <Stack>
                      {!isEditingAllowed() && (
                        <Alert
                          mb={"lg"}
                          variant="light"
                          color="yellow"
                          title={t("admin.config.config-file-warning.title")}
                          icon={<TbInfoCircle />}
                        >
                          <FormattedMessage id="admin.config.config-file-warning.description" />
                        </Alert>
                      )}
                      <Title
                        mb={categoryId.toLowerCase() === "s3" ? "xs" : "md"}
                        order={1}
                        size="h3"
                      >
                        {t("admin.config.category." + categoryId)}
                      </Title>
                      {categoryId.toLowerCase() === "s3" && (
                        <Text color="dimmed" size="sm" mb="md">
                          <FormattedMessage
                            id="admin.config.s3.docs-link"
                            values={{
                              wikiLink: (
                                <Anchor
                                  href="https://smp46.github.io/pingvin-share-x/v2/setup/s3#cors-configuration"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  wiki
                                </Anchor>
                              ),
                            }}
                          />
                        </Text>
                      )}
                      {visibleConfigVariables.map((configVariable) => {
                        if (
                          (configVariable.key ===
                            "appearance.themePrimaryColorOverride" &&
                            !shouldShowPrimaryColorOverride) ||
                          (configVariable.key === "security.minLength" &&
                            !shouldShowCustomPasswordPolicies) ||
                          (configVariable.key === "security.requireLowercase" &&
                            !shouldShowCustomPasswordPolicies) ||
                          (configVariable.key === "security.requireUppercase" &&
                            !shouldShowCustomPasswordPolicies) ||
                          (configVariable.key === "security.requireNumber" &&
                            !shouldShowCustomPasswordPolicies) ||
                          (configVariable.key ===
                            "security.requireSpecialCharacter" &&
                            !shouldShowCustomPasswordPolicies)
                        ) {
                          return null;
                        }

                        return (
                          <Group key={configVariable.key} position="apart">
                            <Stack
                              style={{ maxWidth: isMobile ? "100%" : "40%" }}
                              spacing={0}
                            >
                              <Title order={2} size="h6">
                                <FormattedMessage
                                  id={`admin.config.${camelToKebab(
                                    configVariable.key,
                                  )}`}
                                />
                              </Title>

                              <Text
                                sx={{
                                  whiteSpace: "pre-line",
                                }}
                                color="dimmed"
                                size="sm"
                                mb="xs"
                              >
                                <FormattedMessage
                                  id={`admin.config.${camelToKebab(
                                    configVariable.key,
                                  )}.description`}
                                  values={{ br: <br /> }}
                                />
                              </Text>
                            </Stack>
                            <Stack></Stack>
                            <Box style={{ width: isMobile ? "100%" : "50%" }}>
                              <AdminConfigInput
                                key={configVariable.key}
                                configVariable={configVariable}
                                updateConfigVariable={updateConfigVariable}
                                allConfigVariables={configVariables}
                                updatedConfigVariables={updatedConfigVariables}
                                optionalConfigVariables={
                                  optionalConfigVariables
                                }
                              />
                            </Box>
                          </Group>
                        );
                      })}
                      {categoryId == "appearance" && (
                        <LogoConfigInput
                          logo={logo}
                          setLogo={setLogo}
                          darkLogo={darkLogo}
                          setDarkLogo={setDarkLogo}
                        />
                      )}
                      {categoryId == "appearance" &&
                        customCssConfigVariable && (
                          <Group
                            key={customCssConfigVariable.key}
                            position="apart"
                          >
                            <Stack
                              style={{ maxWidth: isMobile ? "100%" : "40%" }}
                              spacing={0}
                            >
                              <Title order={2} size="h6">
                                <FormattedMessage
                                  id={`admin.config.${camelToKebab(
                                    customCssConfigVariable.key,
                                  )}`}
                                />
                              </Title>

                              <Text
                                sx={{
                                  whiteSpace: "pre-line",
                                }}
                                color="dimmed"
                                size="sm"
                                mb="xs"
                              >
                                <FormattedMessage
                                  id={`admin.config.${camelToKebab(
                                    customCssConfigVariable.key,
                                  )}.description`}
                                  values={{ br: <br /> }}
                                />
                              </Text>
                            </Stack>
                            <Stack></Stack>
                            <Box style={{ width: isMobile ? "100%" : "50%" }}>
                              <AdminConfigInput
                                key={customCssConfigVariable.key}
                                configVariable={customCssConfigVariable}
                                updateConfigVariable={updateConfigVariable}
                                allConfigVariables={configVariables}
                                updatedConfigVariables={updatedConfigVariables}
                                optionalConfigVariables={
                                  optionalConfigVariables
                                }
                              />
                            </Box>
                          </Group>
                        )}
                      {/* {categoryId === "security" && shouldShowCustomPasswordPolicies && ( */}
                      {/**/}
                      {/* )} */}
                    </Stack>
                  </>
                );
              })()}
              <Group mt="lg" position="right">
                {categoryId == "smtp" && (
                  <TestEmailButton
                    configVariablesChanged={updatedConfigVariables.length != 0}
                    saveConfigVariables={saveConfigVariables}
                  />
                )}
                {categoryId == "cache" && (
                  <TestRedisButton
                    configVariablesChanged={updatedConfigVariables.length != 0}
                    saveConfigVariables={saveConfigVariables}
                  />
                )}
                <Button onClick={saveConfigVariables}>
                  <FormattedMessage id="common.button.save" />
                </Button>
              </Group>
            </>
          )}
        </Container>
      </AppShell>
    </>
  );
}
