import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Pagination,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { TbAlertCircle, TbRefresh, TbWorld } from "react-icons/tb";
import Meta from "../../components/Meta";
import useTranslate from "../../hooks/useTranslate.hook";
import systemService, { ReferrerPage } from "../../services/system.service";

const PAGE_SIZE = 50;

const Referrers = () => {
  const t = useTranslate();
  const intl = useIntl();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReferrerPage>();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback((targetPage: number) => {
    const id = ++requestId.current;
    setIsLoading(true);
    setHasError(false);
    systemService
      .getReferrers(targetPage, PAGE_SIZE)
      .then((result) => {
        if (id !== requestId.current) return;
        setData(result);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setHasError(true);
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const rows = data?.referrers ?? [];

  return (
    <>
      <Meta title={t("admin.referrer.custom.title")} />
      <Group position="apart" align="flex-start" mb="md">
        <div>
          <Group spacing="xs">
            <TbWorld size={24} />
            <Title order={1} size="h3">
              <FormattedMessage id="admin.referrer.custom.title" />
            </Title>
          </Group>
          <Text size="sm" color="dimmed">
            <FormattedMessage id="admin.referrer.custom.subtitle" />
          </Text>
        </div>
        <Group spacing="xs">
          <Text size="sm" color="dimmed">
            <FormattedMessage
              id="admin.referrer.custom.total"
              values={{ count: data?.total ?? 0 }}
            />
          </Text>
          <ActionIcon
            variant="light"
            onClick={() => load(page)}
            disabled={isLoading}
            aria-label={t("admin.referrer.custom.refresh")}
          >
            <TbRefresh />
          </ActionIcon>
        </Group>
      </Group>

      {hasError ? (
        <Alert
          color="red"
          icon={<TbAlertCircle />}
          title={t("admin.referrer.custom.load-error")}
        >
          <Button variant="light" color="red" onClick={() => load(page)}>
            {t("admin.referrer.custom.retry")}
          </Button>
        </Alert>
      ) : (
        <Paper withBorder>
          <Table
            data-testid="referrer-table"
            striped
            highlightOnHover
            verticalSpacing="sm"
            horizontalSpacing="md"
          >
            <thead>
              <tr>
                <th>
                  <FormattedMessage id="admin.referrer.custom.domain" />
                </th>
                <th style={{ textAlign: "right", width: 120 }}>
                  <FormattedMessage id="admin.referrer.custom.views" />
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <Center py="lg">
                      <Loader size="sm" />
                    </Center>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <Center py="lg">
                      <Text size="sm" color="dimmed">
                        <FormattedMessage id="admin.referrer.custom.empty" />
                      </Text>
                    </Center>
                  </td>
                </tr>
              ) : (
                rows.map((referrer) => (
                  <tr key={referrer.domain}>
                    <td>
                      <Text size="sm" sx={{ overflowWrap: "anywhere" }}>
                        {referrer.domain}
                      </Text>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Text size="sm">
                        {referrer.views.toLocaleString(intl.locale)}
                      </Text>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          {totalPages > 1 && (
            <Stack align="center" py="md">
              <Pagination
                total={totalPages}
                value={page}
                onChange={setPage}
                getControlProps={(control) => ({
                  "aria-label": t(
                    control === "previous"
                      ? "common.custom.pagination.previous"
                      : "common.custom.pagination.next",
                  ),
                })}
              />
            </Stack>
          )}
        </Paper>
      )}
    </>
  );
};

export default Referrers;
