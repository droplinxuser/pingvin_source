import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import {
  TbAlertTriangle,
  TbBolt,
  TbBrandNodejs,
  TbDatabase,
  TbMovie,
  TbPackage,
  TbPhoto,
  TbRefresh,
  TbServerCog,
  TbShieldCheck,
  TbVideo,
} from "react-icons/tb";
import { IconType } from "react-icons";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, {
  DependencyCheck,
} from "../../services/system.service";

const ICONS: Record<string, IconType> = {
  node: TbBrandNodejs,
  sharp: TbPhoto,
  ffmpeg: TbMovie,
  database: TbDatabase,
  valkey: TbBolt,
  ytdlp: TbVideo,
  clamav: TbShieldCheck,
};

const ServerDependenciesCard = () => {
  const t = useTranslate();
  const [dependencies, setDependencies] = useState<DependencyCheck[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setDependencies(await systemService.getDependencies());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const status = (dependency: DependencyCheck) => {
    if (dependency.available)
      return {
        color: "green",
        label: t("admin.dependencies.custom.status.available"),
      };
    // An optional feature that is switched off is not a problem.
    if (dependency.enabled === false)
      return {
        color: "gray",
        label: t("admin.dependencies.custom.status.disabled"),
      };
    if (dependency.type === "required")
      return {
        color: "red",
        label: t("admin.dependencies.custom.status.missing"),
      };
    return {
      color: "orange",
      label: t("admin.dependencies.custom.status.unavailable"),
    };
  };

  const missingRequired =
    dependencies?.filter((item) => item.type === "required" && !item.available)
      .length ?? 0;

  return (
    <Paper withBorder p="md" radius="md" data-testid="server-dependencies-card">
      <Group position="apart" align="flex-start" mb="md">
        <Group spacing="xs" align="flex-start">
          <TbServerCog size={22} />
          <Box>
            <Text weight={600}>
              <FormattedMessage id="admin.dependencies.custom.title" />
            </Text>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.dependencies.custom.subtitle" />
            </Text>
          </Box>
        </Group>
        <Group spacing="xs">
          {dependencies && (
            <Badge color={missingRequired === 0 ? "green" : "red"}>
              {missingRequired === 0
                ? t("admin.dependencies.custom.summary.ok")
                : t("admin.dependencies.custom.summary.missing", {
                    count: missingRequired,
                  })}
            </Badge>
          )}
          <ActionIcon
            variant="light"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t("admin.dependencies.custom.refresh")}
          >
            <TbRefresh />
          </ActionIcon>
        </Group>
      </Group>

      {loading && !dependencies ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : error && !dependencies ? (
        <Group spacing="xs">
          <TbAlertTriangle size={18} />
          <Text size="sm" color="dimmed">
            {t("admin.dependencies.custom.load-error")}
          </Text>
        </Group>
      ) : dependencies ? (
        <Stack spacing="xs">
          {dependencies.map((dependency, index) => {
            const Icon = ICONS[dependency.key] ?? TbPackage;
            const state = status(dependency);
            return (
              <Box key={dependency.key}>
                {index > 0 && <Divider mb="xs" />}
                <Group position="apart" align="center" spacing="sm" noWrap>
                  <Group spacing="xs" noWrap>
                    <Icon size={20} />
                    <Box>
                      <Text size="sm" weight={500}>
                        {t(`admin.dependencies.custom.item.${dependency.key}`)}
                      </Text>
                      <Text size="xs" color="dimmed">
                        {t(
                          `admin.dependencies.custom.item.${dependency.key}.description`,
                        )}
                      </Text>
                    </Box>
                  </Group>
                  <Group spacing="xs" noWrap>
                    <Badge color="gray" variant="outline" size="sm">
                      {t(
                        `admin.dependencies.custom.type.${dependency.type}`,
                      )}
                    </Badge>
                    {dependency.version && (
                      <Badge
                        color="gray"
                        variant="light"
                        size="sm"
                        sx={{ textTransform: "none" }}
                      >
                        {dependency.version}
                      </Badge>
                    )}
                    <Badge color={state.color} size="sm">
                      {state.label}
                    </Badge>
                  </Group>
                </Group>
                {dependency.detail && (
                  <Text
                    size="xs"
                    color="dimmed"
                    mt={4}
                    ml={28}
                    sx={{ wordBreak: "break-all" }}
                  >
                    {dependency.detail}
                  </Text>
                )}
              </Box>
            );
          })}

          {error && (
            <Text size="xs" color="red">
              {t("admin.dependencies.custom.load-error")}
            </Text>
          )}
        </Stack>
      ) : null}
    </Paper>
  );
};

export default ServerDependenciesCard;
