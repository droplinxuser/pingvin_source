import {
  ActionIcon,
  Button,
  Group,
  Pagination,
  Space,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import { useEffect, useRef, useState } from "react";
import { TbSearch, TbX } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import ManageShareTable from "../../components/admin/shares/ManageShareTable";
import DiskUsage from "../../components/admin/shares/DiskUsage";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { MyShare } from "../../types/share.type";
import toast from "../../utils/toast.util";
import { TableSort } from "../../components/core/SortIcon";

const Shares = () => {
  const [shares, setShares] = useState<MyShare[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const requestIdRef = useRef(0);
  const [sort, setSort] = useState<TableSort>({
    property: "expiration",
    direction: "desc",
  });

  const modals = useModals();
  const t = useTranslate();

  const getShares = (targetPage = page, searchTerm = debouncedSearch) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    shareService
      .list(targetPage, pageSize, searchTerm, sort.property, sort.direction)
      .then(({ shares, total }) => {
        if (requestId !== requestIdRef.current) return;
        setShares(shares);
        setTotal(total);
        setPage(targetPage);
        setIsLoading(false);
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return;
        setIsLoading(false);
        toast.axiosError(e);
      });
  };

  const deleteShare = (share: MyShare) => {
    modals.openConfirmModal({
      title: t("admin.shares.edit.delete.title", {
        id: share.id,
      }),
      children: (
        <Text size="sm">
          <FormattedMessage id="admin.shares.edit.delete.description" />
        </Text>
      ),
      labels: {
        confirm: t("common.button.delete"),
        cancel: t("common.button.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        const nextPage = shares.length === 1 && page > 1 ? page - 1 : page;
        shareService
          .remove(share.id)
          .then(() => getShares(nextPage))
          .catch(toast.axiosError);
      },
    });
  };

  useEffect(() => {
    getShares(1, debouncedSearch);
  }, [debouncedSearch, sort]);

  return (
    <>
      <Meta title={t("admin.shares.title")} />
      <Group position="apart" align="center" mb={20}>
        <Title mb={0} order={3}>
          <FormattedMessage id="admin.shares.title" />
        </Title>
        <DiskUsage />
      </Group>

      <TextInput
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        placeholder={t("admin.shares.custom.search.placeholder")}
        icon={<TbSearch size={16} />}
        rightSection={
          search ? (
            <ActionIcon
              onClick={() => setSearch("")}
              aria-label={t("admin.shares.custom.search.clear")}
            >
              <TbX size={16} />
            </ActionIcon>
          ) : undefined
        }
        mb={20}
        sx={{ width: "100%", maxWidth: 300 }}
      />

      {!isLoading && shares.length === 0 ? (
        <Group position="center" mt="lg" mb="lg">
          <Stack align="center" spacing="sm">
            <Text color="dimmed">
              {search ? (
                <FormattedMessage id="admin.shares.custom.search.empty" />
              ) : (
                <FormattedMessage id="admin.shares.custom.empty" />
              )}
            </Text>
            {search && (
              <Button variant="light" onClick={() => setSearch("")}>
                <FormattedMessage id="admin.shares.custom.search.clear" />
              </Button>
            )}
          </Stack>
        </Group>
      ) : (
        <ManageShareTable
          shares={shares}
          updateShare={(updatedShare) =>
            setShares(
              shares.map((share) =>
                share.id === updatedShare.id ? updatedShare : share,
              ),
            )
          }
          deleteShare={deleteShare}
          isLoading={isLoading}
          sort={sort}
          setSort={setSort}
        />
      )}
      {total > pageSize && (
        <Group position="center" mt="lg">
          <Pagination
            value={page}
            onChange={(nextPage) => getShares(nextPage)}
            total={Math.ceil(total / pageSize)}
          />
        </Group>
      )}
      <Space h="xl" />
    </>
  );
};

export default Shares;
