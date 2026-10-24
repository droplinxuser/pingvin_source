import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Center,
  Code,
  Group,
  Loader,
  MediaQuery,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import moment from "moment";
import { useCallback, useEffect, useState } from "react";
import {
  TbAlertTriangle,
  TbRefresh,
  TbShieldCheck,
  TbVirus,
} from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import useTranslate from "../../hooks/useTranslate.hook";
import virustotalService from "../../services/virustotal.service";
import {
  VirusTotalDashboard,
  VirusTotalEvent,
  VirusTotalEventType,
  VirusTotalUploader,
} from "../../types/virustotal.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import toast from "../../utils/toast.util";

const REFRESH_MS = 15_000;

const EVENT_COLORS: Record<VirusTotalEventType, string> = {
  queued: "gray",
  uploaded: "blue",
  clean: "green",
  suspicious: "yellow",
  malicious: "red",
  error: "red",
  rate_limited: "orange",
  auth_error: "red",
  skipped: "gray",
  dropped: "red",
};

const StatCard = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) => (
  <Paper withBorder p="md" radius="md">
    <Text size="xs" color="dimmed" transform="uppercase" weight={600}>
      {label}
    </Text>
    <Text size={28} weight={700} lh={1.2}>
      {value}
    </Text>
    {detail && (
      <Text size="xs" color="dimmed" mt={2}>
        {detail}
      </Text>
    )}
  </Paper>
);

const VirusTotal = () => {
  const t = useTranslate();
  const [data, setData] = useState<VirusTotalDashboard>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detectionsOnly, setDetectionsOnly] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await virustotalService.getDashboard(100));
      setError(false);
    } catch (error) {
      setError(true);
      if (!silent) toast.axiosError(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <>
        <Meta title={t("admin.virustotal.custom.title")} />
        {loading ? (
          <Center style={{ height: "50vh" }}>
            <Loader />
          </Center>
        ) : (
          <Alert
            color="red"
            icon={<TbAlertTriangle />}
            title={
              error
                ? t("common.error")
                : t("admin.virustotal.custom.events.empty")
            }
          >
            <Group position="apart">
              <Text size="sm">
                {error
                  ? t("admin.virustotal.custom.events.load-error")
                  : t("admin.virustotal.custom.events.empty")}
              </Text>
              <ActionIcon
                variant="light"
                onClick={() => void load()}
                aria-label={t("admin.virustotal.custom.refresh")}
              >
                <TbRefresh />
              </ActionIcon>
            </Group>
          </Alert>
        )}
      </>
    );
  }

  const { status, stats, events, generatedAt } = data;
  const visibleEvents = detectionsOnly
    ? events.filter(
        (event) => event.type === "malicious" || event.type === "suspicious",
      )
    : events;
  const scanErrors =
    stats.scans.errors + stats.scans.rateLimited + stats.scans.authErrors;

  const eventLabel = (type: VirusTotalEventType) =>
    t(`admin.virustotal.custom.event.${type}`);

  const uploaderName = (uploader: VirusTotalUploader) =>
    uploader.creator?.displayName || uploader.creator?.username;

  const renderUploader = (uploader?: VirusTotalUploader) => {
    if (!uploader)
      return (
        <Text size="xs" color="dimmed">
          —
        </Text>
      );

    const meta = [uploader.country, uploader.browser, uploader.os].filter(
      Boolean,
    );
    return (
      <Stack spacing={2}>
        <Text size="sm" weight={600}>
          {uploader.creator
            ? uploaderName(uploader)
            : t("admin.virustotal.custom.events.anonymous")}
        </Text>
        {uploader.creator?.email && (
          <Text size="xs" color="dimmed" sx={{ overflowWrap: "anywhere" }}>
            {uploader.creator.email}
          </Text>
        )}
        {uploader.reverseShareCreator && (
          <Text size="xs" color="dimmed">
            {t("admin.virustotal.custom.events.via-reverse", {
              name:
                uploader.reverseShareCreator.displayName ||
                uploader.reverseShareCreator.username,
            })}
          </Text>
        )}
        {meta.length > 0 && (
          <Text size="xs" color="dimmed" sx={{ overflowWrap: "anywhere" }}>
            {meta.join(" · ")}
          </Text>
        )}
      </Stack>
    );
  };

  const renderDetails = (event: VirusTotalEvent) => (
    <Stack spacing={4}>
      <Group spacing={4}>
        {event.cached && (
          <Badge color="gray" variant="outline">
            {t("admin.virustotal.custom.events.cached")}
          </Badge>
        )}
        {event.type === "malicious" && (
          <Badge color={event.removed ? "red" : "orange"} variant="filled">
            {event.removed
              ? t("admin.virustotal.custom.events.removed")
              : t("admin.virustotal.custom.events.not-removed")}
          </Badge>
        )}
        {event.status && (
          <Badge color="gray" variant="outline">
            HTTP {event.status}
          </Badge>
        )}
        {event.stage && (
          <Text size="xs" color="dimmed">
            {event.stage}
          </Text>
        )}
      </Group>
      {event.stats && (
        <Text size="xs">
          {t("admin.virustotal.custom.events.detection-stats", {
            malicious: event.stats.malicious,
            suspicious: event.stats.suspicious,
            undetected: event.stats.undetected,
          })}
        </Text>
      )}
      {event.detail && (
        <Text size="xs" color="dimmed" sx={{ overflowWrap: "anywhere" }}>
          {event.detail}
        </Text>
      )}
      {event.hash && (
        <Text size="xs" color="dimmed" title={event.hash}>
          {t("admin.virustotal.custom.events.hash", {
            hash: `${event.hash.slice(0, 16)}…`,
          })}
        </Text>
      )}
    </Stack>
  );

  const renderEventCard = (event: VirusTotalEvent) => (
    <Paper key={event.id} withBorder p="sm" radius="md">
      <Group position="apart" align="flex-start" spacing="xs">
        <Badge color={EVENT_COLORS[event.type]} variant="light">
          {eventLabel(event.type)}
        </Badge>
        <Text size="xs" color="dimmed" title={moment(event.at).format("LLLL")}>
          {moment(event.at).format("L LTS")}
        </Text>
      </Group>
      <Text size="sm" weight={600} mt={6} sx={{ overflowWrap: "anywhere" }}>
        {event.fileName || "—"}
      </Text>
      <Group spacing="xs" mt={2}>
        {typeof event.size === "number" && (
          <Text size="xs" color="dimmed">
            {byteToHumanSizeString(event.size)}
          </Text>
        )}
        <Code>{event.shareId}</Code>
      </Group>
      <Box mt="xs">{renderDetails(event)}</Box>
      {event.uploader && (
        <Box mt="xs">
          <Text size="xs" color="dimmed">
            <FormattedMessage id="admin.virustotal.custom.events.user" />
          </Text>
          {renderUploader(event.uploader)}
        </Box>
      )}
    </Paper>
  );

  return (
    <>
      <Meta title={t("admin.virustotal.custom.title")} />
      <Group position="apart" align="flex-start" mb="md">
        <Box>
          <Group spacing="xs">
            <TbVirus size={24} />
            <Title order={1} size="h3">
              <FormattedMessage id="admin.virustotal.custom.title" />
            </Title>
          </Group>
          <Text size="sm" color="dimmed">
            <FormattedMessage id="admin.virustotal.custom.subtitle" />
          </Text>
        </Box>
        <Group spacing="xs">
          <Text size="xs" color="dimmed">
            {t("admin.virustotal.custom.updated-at", {
              time: moment(generatedAt).format("LTS"),
            })}
          </Text>
          <ActionIcon
            variant="light"
            onClick={() => void load()}
            aria-label={t("admin.virustotal.custom.refresh")}
            disabled={loading}
          >
            <TbRefresh />
          </ActionIcon>
        </Group>
      </Group>

      {!status.apiKeyConfigured && (
        <Alert
          color="yellow"
          icon={<TbAlertTriangle />}
          title={t("admin.virustotal.custom.status.disabled")}
          mb="md"
        >
          {t("admin.virustotal.custom.status.api-key-missing")}
        </Alert>
      )}
      {status.authFailed && (
        <Alert
          color="red"
          icon={<TbAlertTriangle />}
          title={t("admin.virustotal.custom.status.auth-failed")}
          mb="md"
        >
          {t("admin.virustotal.custom.status.auth-failed-message")}
        </Alert>
      )}

      <SimpleGrid
        cols={1}
        spacing="md"
        breakpoints={[
          { minWidth: "sm", cols: 2 },
          { minWidth: "md", cols: 4 },
        ]}
        mb="md"
      >
        <StatCard
          label={t("admin.virustotal.custom.stats.calls-last-hour")}
          value={stats.calls.lastHour}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.calls-today")}
          value={stats.calls.today}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.calls-last-24h")}
          value={stats.calls.last24Hours}
          detail={t("admin.virustotal.custom.stats.breakdown", {
            lookup: stats.calls.byKindLast24Hours.lookup,
            upload: stats.calls.byKindLast24Hours.upload,
            analysis: stats.calls.byKindLast24Hours.analysis,
          })}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.detections-today")}
          value={stats.scans.malicious + stats.scans.suspicious}
          detail={t("admin.virustotal.custom.stats.detections-value", {
            malicious: stats.scans.malicious,
            suspicious: stats.scans.suspicious,
          })}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.removed-today")}
          value={stats.scans.removed}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.clean-today")}
          value={stats.scans.clean}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.errors-today")}
          value={scanErrors}
          detail={t("admin.virustotal.custom.stats.errors-value", {
            errors: stats.scans.errors,
            rateLimited: stats.scans.rateLimited,
            authErrors: stats.scans.authErrors,
          })}
        />
        <StatCard
          label={t("admin.virustotal.custom.stats.queued-today")}
          value={stats.scans.queued}
        />
      </SimpleGrid>

      <Paper withBorder p="md" radius="md" mb="md">
        <Group position="apart" mb="sm">
          <Group spacing="xs">
            <TbShieldCheck size={20} />
            <Text weight={600}>
              <FormattedMessage id="admin.virustotal.custom.status.title" />
            </Text>
          </Group>
          <Group spacing={4}>
            <Badge color={status.enabled ? "green" : "gray"}>
              {status.enabled
                ? t("admin.virustotal.custom.status.enabled")
                : t("admin.virustotal.custom.status.disabled")}
            </Badge>
            <Badge color={status.running ? "green" : "orange"}>
              {status.running
                ? t("admin.virustotal.custom.status.running")
                : t("admin.virustotal.custom.status.stopped")}
            </Badge>
            <Badge color={status.authFailed ? "red" : "green"}>
              {status.authFailed
                ? t("admin.virustotal.custom.status.auth-failed")
                : t("admin.virustotal.custom.status.auth-ok")}
            </Badge>
            <Badge color={status.queueBackend === "valkey" ? "blue" : "yellow"}>
              {status.queueBackend === "valkey"
                ? t("admin.virustotal.custom.status.valkey")
                : t("admin.virustotal.custom.status.memory")}
            </Badge>
          </Group>
        </Group>

        <SimpleGrid
          cols={1}
          spacing="sm"
          breakpoints={[
            { minWidth: "sm", cols: 2 },
            { minWidth: "md", cols: 3 },
          ]}
        >
          <Box>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.virustotal.custom.status.queue" />
            </Text>
            <Text size="sm">
              {t("admin.virustotal.custom.status.queue-value", {
                depth: status.pendingJobs,
              })}
            </Text>
            <Text size="xs" color="dimmed">
              {t("admin.virustotal.custom.status.queue-backend")}:{" "}
              {status.queueBackend === "valkey"
                ? t("admin.virustotal.custom.status.valkey")
                : t("admin.virustotal.custom.status.memory")}
            </Text>
          </Box>
          <Box>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.virustotal.custom.status.processing" />
            </Text>
            {status.processing ? (
              <>
                <Text size="sm">
                  {status.processing.fileName} · {status.processing.stage}
                </Text>
                <Text size="xs" color="dimmed">
                  {status.processing.shareId} · attempt{" "}
                  {status.processing.attempts + 1}
                </Text>
              </>
            ) : (
              <Text size="sm" color="dimmed">
                <FormattedMessage id="admin.virustotal.custom.status.idle" />
              </Text>
            )}
          </Box>
          <Box>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.virustotal.custom.status.rate-limit" />
            </Text>
            <Text size="sm">
              {t("admin.virustotal.custom.status.rate-limit-value", {
                seconds: status.rateLimitSeconds,
              })}
            </Text>
            <Text size="xs" color="dimmed">
              {t("admin.virustotal.custom.status.cooldown")}:{" "}
              {t("admin.virustotal.custom.status.cooldown-value", {
                seconds: status.cooldownSeconds,
              })}
            </Text>
          </Box>
          <Box>
            <Text size="xs" color="dimmed">
              <FormattedMessage id="admin.virustotal.custom.status.last-request" />
            </Text>
            <Text size="sm">
              {status.lastRequestAt
                ? t("admin.virustotal.custom.status.last-request-value", {
                    kind: status.lastRequestKind ?? "—",
                    time: moment(status.lastRequestAt).format("LTS"),
                  })
                : t("admin.virustotal.custom.status.never")}
            </Text>
          </Box>
          <Box>
            <Text size="xs" color="dimmed">
              <FormattedMessage
                id="admin.virustotal.custom.storage"
                values={{ file: data.storage }}
              />
            </Text>
            <Text size="xs" color="dimmed">
              {data.timezone}
            </Text>
          </Box>
        </SimpleGrid>
      </Paper>

      <Group position="apart" mb="xs">
        <Text weight={600}>
          <FormattedMessage id="admin.virustotal.custom.events.title" />
        </Text>
        <SegmentedControl
          size="xs"
          value={detectionsOnly ? "detections" : "all"}
          onChange={(value) => setDetectionsOnly(value === "detections")}
          data={[
            {
              label: t("admin.virustotal.custom.events.all"),
              value: "all",
            },
            {
              label: t("admin.virustotal.custom.events.detections"),
              value: "detections",
            },
          ]}
        />
      </Group>

      {visibleEvents.length === 0 ? (
        <Text size="sm" color="dimmed" align="center" py="md">
          {detectionsOnly
            ? t("admin.virustotal.custom.events.empty-detections")
            : t("admin.virustotal.custom.events.empty")}
        </Text>
      ) : (
        <>
          <MediaQuery smallerThan="lg" styles={{ display: "none" }}>
            <Table
              data-testid="virustotal-events-table"
              striped
              highlightOnHover
              verticalSpacing="sm"
              sx={{ tableLayout: "fixed", width: "100%" }}
            >
              <colgroup>
                <col style={{ width: "11%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "23%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t("admin.virustotal.custom.events.time")}</th>
                  <th>{t("admin.virustotal.custom.events.event")}</th>
                  <th>{t("admin.virustotal.custom.events.file")}</th>
                  <th>{t("admin.virustotal.custom.events.share")}</th>
                  <th>{t("admin.virustotal.custom.events.details")}</th>
                  <th>{t("admin.virustotal.custom.events.user")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Text size="xs" title={moment(event.at).format("LLLL")}>
                        {moment(event.at).format("L LTS")}
                      </Text>
                    </td>
                    <td>
                      <Badge color={EVENT_COLORS[event.type]} variant="light">
                        {eventLabel(event.type)}
                      </Badge>
                    </td>
                    <td>
                      {event.fileName ? (
                        <>
                          <Text size="sm" sx={{ overflowWrap: "anywhere" }}>
                            {event.fileName}
                          </Text>
                          {typeof event.size === "number" && (
                            <Text size="xs" color="dimmed">
                              {byteToHumanSizeString(event.size)}
                            </Text>
                          )}
                        </>
                      ) : (
                        <Text size="xs" color="dimmed">
                          —
                        </Text>
                      )}
                    </td>
                    <td>
                      <Code>{event.shareId}</Code>
                    </td>
                    <td>{renderDetails(event)}</td>
                    <td>{renderUploader(event.uploader)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </MediaQuery>
          <MediaQuery largerThan="lg" styles={{ display: "none" }}>
            <SimpleGrid
              data-testid="virustotal-events-cards"
              cols={1}
              spacing="xs"
              breakpoints={[{ minWidth: "md", cols: 2 }]}
            >
              {visibleEvents.map(renderEventCard)}
            </SimpleGrid>
          </MediaQuery>
        </>
      )}
    </>
  );
};

export default VirusTotal;
