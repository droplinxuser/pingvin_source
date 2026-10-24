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
import moment from "moment";
import { useCallback, useEffect, useState } from "react";
import { TbAlertTriangle, TbDatabase, TbRefresh } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, { ValkeyMetrics } from "../../services/system.service";
import { byteToHumanSizeString } from "../../utils/fileSize.util";

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

const ValkeyMetricsCard = () => {
  const t = useTranslate();
  const [metrics, setMetrics] = useState<ValkeyMetrics>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setMetrics(await systemService.getValkeyMetrics());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const number = (value?: number | null) =>
    value == null ? "—" : value.toLocaleString();

  const status = !metrics
    ? null
    : !metrics.configured
      ? { color: "gray", label: t("admin.valkey.custom.status.disabled") }
      : metrics.connected
        ? { color: "green", label: t("admin.valkey.custom.status.connected") }
        : {
            color: "orange",
            label: t("admin.valkey.custom.status.unreachable"),
          };

  return (
    <Paper withBorder p="md" radius="md" data-testid="valkey-metrics-card">
      <Group position="apart" align="flex-start" mb="md">
        <Group spacing="xs" align="flex-start">
          <TbDatabase size={22} />
          <Box>
            <Text weight={600}>
              <FormattedMessage id="admin.valkey.custom.title" />
            </Text>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.valkey.custom.subtitle" />
            </Text>
          </Box>
        </Group>
        <Group spacing="xs">
          {metrics?.version && (
            <Badge color="gray" variant="outline">
              {t("admin.valkey.custom.version", { version: metrics.version })}
            </Badge>
          )}
          {status && <Badge color={status.color}>{status.label}</Badge>}
          <ActionIcon
            variant="light"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t("admin.valkey.custom.refresh")}
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
            {t("admin.valkey.custom.load-error")}
          </Text>
        </Group>
      ) : metrics ? (
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
              label={t("admin.valkey.custom.memory")}
              value={
                metrics.memoryUsedBytes == null
                  ? "—"
                  : byteToHumanSizeString(metrics.memoryUsedBytes)
              }
              detail={
                metrics.memoryPeakBytes == null
                  ? undefined
                  : t("admin.valkey.custom.memory-detail", {
                      peak: byteToHumanSizeString(metrics.memoryPeakBytes),
                    })
              }
            />
            <Metric
              label={t("admin.valkey.custom.keys")}
              value={number(metrics.totalKeys)}
            />
            <Metric
              label={t("admin.valkey.custom.hit-ratio")}
              value={
                metrics.hitRatio == null
                  ? "—"
                  : `${(metrics.hitRatio * 100).toFixed(1)}%`
              }
              detail={
                metrics.hits == null || metrics.misses == null
                  ? undefined
                  : t("admin.valkey.custom.hit-ratio-detail", {
                      hits: metrics.hits.toLocaleString(),
                      misses: metrics.misses.toLocaleString(),
                    })
              }
            />
            <Metric
              label={t("admin.valkey.custom.clients")}
              value={number(metrics.connectedClients)}
            />
            <Metric
              label={t("admin.valkey.custom.uptime")}
              value={
                metrics.uptimeSeconds == null
                  ? "—"
                  : moment.duration(metrics.uptimeSeconds, "seconds").humanize()
              }
            />
          </SimpleGrid>

          {error && (
            <Text size="xs" color="red">
              {t("admin.valkey.custom.load-error")}
            </Text>
          )}
          {metrics.configured && !metrics.connected && (
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.valkey.custom.unreachable-description" />
            </Text>
          )}
          {!metrics.configured && (
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.valkey.custom.disabled-description" />
            </Text>
          )}
        </Stack>
      ) : null}
    </Paper>
  );
};

export default ValkeyMetricsCard;
