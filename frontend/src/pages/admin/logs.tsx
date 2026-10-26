import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Pagination,
  Paper,
  ScrollArea,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import moment from "moment";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TbAlertTriangle,
  TbCheck,
  TbCopy,
  TbFileText,
  TbRefresh,
} from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import RelativeTime from "../../components/core/RelativeTime";
import useTranslate from "../../hooks/useTranslate.hook";
import logService, {
  ErrorLogEntry,
  ErrorLogPage,
  ErrorLogSource,
} from "../../services/log.service";

const PAGE_SIZE = 20;
const FETCH_SIZE = 100;

const formatEntry = (entry: ErrorLogEntry): string => {
  const header = `[${moment(entry.at).format("YYYY-MM-DD HH:mm:ss.SSS")}] ${entry.level.toUpperCase()} ${entry.source}${entry.context ? ` (${entry.context})` : ""}`;
  return [
    header,
    entry.url ? `URL: ${entry.url}` : null,
    entry.userAgent ? `UA: ${entry.userAgent}` : null,
    entry.message,
    entry.stack ?? null,
  ]
    .filter((line): line is string => !!line)
    .join("\n");
};

const Logs = () => {
  const t = useTranslate();
  const clipboard = useClipboard({ timeout: 2_000 });
  const [source, setSource] = useState<ErrorLogSource>("backend");
  const [data, setData] = useState<ErrorLogPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [loadedAt, setLoadedAt] = useState<moment.Moment>();
  const requestId = useRef(0);

  const load = useCallback((targetSource: ErrorLogSource) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(false);
    logService
      .list(targetSource, 1, FETCH_SIZE)
      .then((result) => {
        if (id !== requestId.current) return;
        setData(result);
        setLoadedAt(moment());
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setError(true);
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setPage(1);
    load(source);
  }, [source, load]);

  const pageData = data?.source === source ? data : undefined;
  const entries = pageData?.entries ?? [];
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const visibleEntries = entries.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const output = entries.map(formatEntry).join("\n\n");
  const storage = pageData?.storage;

  return (
    <>
      <Meta title={t("admin.logs.custom.title")} />
      <Group position="apart" align="flex-start" mb="md">
        <Box>
          <Group spacing="xs">
            <TbFileText size={24} />
            <Title order={1} size="h3">
              <FormattedMessage id="admin.logs.custom.title" />
            </Title>
          </Group>
          <Text size="sm" color="dimmed">
            <FormattedMessage id="admin.logs.custom.subtitle" />
          </Text>
        </Box>
        <Group spacing="xs">
          <Button
            variant="light"
            leftIcon={clipboard.copied ? <TbCheck /> : <TbCopy />}
            onClick={() => output && clipboard.copy(output)}
            disabled={!output}
            data-testid="error-logs-copy"
          >
            {clipboard.copied
              ? t("admin.logs.custom.copied")
              : t("admin.logs.custom.copy")}
          </Button>
          <ActionIcon
            variant="light"
            onClick={() => load(source)}
            disabled={loading}
            aria-label={t("admin.logs.custom.refresh")}
          >
            <TbRefresh />
          </ActionIcon>
        </Group>
      </Group>

      <Tabs
        value={source}
        onTabChange={(value) => value && setSource(value as ErrorLogSource)}
        mb="md"
      >
        <Tabs.List>
          <Tabs.Tab value="backend">
            {t("admin.logs.custom.source.backend")}
          </Tabs.Tab>
          <Tabs.Tab value="frontend">
            {t("admin.logs.custom.source.frontend")}
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <Group position="apart" mb="xs">
        <Group spacing="xs">
          {storage && (
            <Badge color={storage === "valkey" ? "blue" : "yellow"}>
              {t(`admin.logs.custom.storage.${storage}`)}
            </Badge>
          )}
          <Text size="xs" color="dimmed">
            {t("admin.logs.custom.count", { count: entries.length })}
          </Text>
          {pageData && loadedAt && (
            <Text size="xs" color="dimmed">
              <FormattedMessage
                id="admin.logs.custom.updated"
                values={{ time: <RelativeTime date={loadedAt.toDate()} /> }}
              />
            </Text>
          )}
        </Group>
        {loading && <Loader size="xs" />}
      </Group>

      <Text size="xs" color="dimmed" mb="xs">
        {source === "backend"
          ? t("admin.logs.custom.hint.backend")
          : t("admin.logs.custom.hint.frontend")}
      </Text>

      {error && (
        <Alert
          color="red"
          icon={<TbAlertTriangle />}
          title={t("admin.logs.custom.load-error")}
          mb="md"
        >
          <Group position="apart">
            <Text size="sm">{t("admin.logs.custom.load-error-detail")}</Text>
            <Button variant="light" onClick={() => load(source)}>
              {t("admin.logs.custom.refresh")}
            </Button>
          </Group>
        </Alert>
      )}

      <ScrollArea
        type="auto"
        offsetScrollbars
        sx={{ height: "clamp(300px, calc(100vh - 430px), 640px)" }}
        data-testid="error-logs-scroll"
      >
        {loading && !pageData ? (
          <Center style={{ height: "100%" }}>
            <Loader />
          </Center>
        ) : error && !pageData ? (
          <Center style={{ height: "100%" }}>
            <Text size="sm" color="dimmed">
              {t("admin.logs.custom.load-error")}
            </Text>
          </Center>
        ) : visibleEntries.length === 0 ? (
          <Center style={{ height: "100%" }}>
            <Text size="sm" color="dimmed">
              {t("admin.logs.custom.empty", {
                source:
                  source === "backend"
                    ? t("admin.logs.custom.source.backend")
                    : t("admin.logs.custom.source.frontend"),
              })}
            </Text>
          </Center>
        ) : (
          <Paper
            withBorder
            p="md"
            component="pre"
            m={0}
            data-testid="error-log-output"
            sx={{
              fontFamily: "monospace",
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {visibleEntries.map(formatEntry).join("\n\n")}
          </Paper>
        )}
      </ScrollArea>

      {totalPages > 1 && (
        <Center mt="md">
          <Pagination value={page} onChange={setPage} total={totalPages} />
        </Center>
      )}

      <Text size="xs" color="dimmed" mt="sm">
        <FormattedMessage id="admin.logs.custom.hint.env" />
      </Text>
    </>
  );
};

export default Logs;
