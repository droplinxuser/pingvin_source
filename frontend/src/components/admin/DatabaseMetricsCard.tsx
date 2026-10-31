import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { TbAlertTriangle, TbDatabase, TbRefresh } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, {
  DatabaseMetrics,
} from "../../services/system.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

// Above this share of free pages, a VACUUM is worth recommending.
const FRAGMENTATION_HINT = 0.15;

const Metric = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) => (
  <Box>
    <Text size="xs" color="dimmed" transform="uppercase" weight={600}>
      {label}
    </Text>
    <Text size="xl" weight={700} lh={1.2}>
      {value}
    </Text>
    {detail && (
      <Text size="xs" color="dimmed" mt={2}>
        {detail}
      </Text>
    )}
  </Box>
);

const DatabaseMetricsCard = () => {
  const t = useTranslate();
  const [metrics, setMetrics] = useState<DatabaseMetrics>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setMetrics(await systemService.getDatabaseMetrics());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const size = (value?: number | null) =>
    value == null ? "—" : byteToHumanSizeString(value);
  const number = (value?: number | null) =>
    value == null ? "—" : value.toLocaleString();
  const percent = (value?: number | null) =>
    value == null ? undefined : `${(value * 100).toFixed(2)}%`;

  const fragmentation = metrics?.fragmentation ?? null;

  return (
    <Paper withBorder p="md" radius="md" data-testid="database-metrics-card">
      <Group position="apart" align="flex-start" mb="md">
        <Group spacing="xs" align="flex-start">
          <TbDatabase size={22} />
          <Box>
            <Text weight={600}>
              <FormattedMessage id="admin.database.custom.title" />
            </Text>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.database.custom.subtitle" />
            </Text>
          </Box>
        </Group>
        <Group spacing="xs">
          {metrics?.version && (
            <Badge color="gray" variant="outline" sx={{ textTransform: "none" }}>
              {t("admin.database.custom.version", { version: metrics.version })}
            </Badge>
          )}
          <ActionIcon
            variant="light"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t("admin.database.custom.refresh")}
          >
            <TbRefresh />
          </ActionIcon>
        </Group>
      </Group>

      {loading && !metrics ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : error && !metrics ? (
        <Group spacing="xs">
          <TbAlertTriangle size={18} />
          <Text size="sm" color="dimmed">
            {t("admin.database.custom.load-error")}
          </Text>
        </Group>
      ) : metrics?.configured ? (
        <Stack spacing="sm">
          <SimpleGrid
            cols={2}
            spacing="md"
            breakpoints={[
              { minWidth: "sm", cols: 3 },
              { minWidth: "md", cols: 5 },
            ]}
          >
            <Metric
              label={t("admin.database.custom.size")}
              value={size(metrics.sizeBytes)}
              detail={
                metrics.walSizeBytes
                  ? t("admin.database.custom.wal-detail", {
                      size: size(metrics.walSizeBytes),
                    })
                  : undefined
              }
            />
            <Metric
              label={t("admin.database.custom.pages")}
              value={number(metrics.pageCount)}
              detail={
                metrics.pageSize == null
                  ? undefined
                  : t("admin.database.custom.page-detail", {
                      pageSize: metrics.pageSize.toLocaleString(),
                    })
              }
            />
            <Metric
              label={t("admin.database.custom.free-pages")}
              value={number(metrics.freePages)}
              detail={
                fragmentation == null
                  ? undefined
                  : t("admin.database.custom.reclaimable", {
                      percent: percent(fragmentation),
                    })
              }
            />
            <Metric
              label={t("admin.database.custom.journal")}
              value={metrics.journalMode ?? "—"}
            />
            <Metric
              label={t("admin.database.custom.version-label")}
              value={metrics.version ?? "—"}
            />
          </SimpleGrid>

          {fragmentation != null && fragmentation >= FRAGMENTATION_HINT && (
            <Text size="xs" color="dimmed">
              {t("admin.database.custom.fragmentation-hint", {
                percent: percent(fragmentation),
              })}
            </Text>
          )}
          {error && (
            <Text size="xs" color="red">
              {t("admin.database.custom.load-error")}
            </Text>
          )}
        </Stack>
      ) : (
        <Group spacing="xs">
          <TbAlertTriangle size={18} />
          <Text size="sm" color="dimmed">
            {t("admin.database.custom.not-configured")}
          </Text>
        </Group>
      )}
    </Paper>
  );
};

export default DatabaseMetricsCard;
