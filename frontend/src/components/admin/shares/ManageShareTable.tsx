import { ActionIcon, Box, Group, Skeleton, Table, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import moment from "moment";
import { Dispatch, SetStateAction } from "react";
import { TbInfoCircle, TbLink, TbTrash } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useConfig from "../../../hooks/config.hook";
import useTranslate from "../../../hooks/useTranslate.hook";
import { MyShare } from "../../../types/share.type";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";
import toast from "../../../utils/toast.util";
import RelativeTime from "../../core/RelativeTime";
import { SortableTh, TableSort } from "../../core/SortIcon";
import showShareInformationsModal from "../../share/showShareInformationsModal";
import showShareLinkModal from "../../account/showShareLinkModal";
import { HoverTip } from "../../core/HoverTip";
import UserAvatar from "../../core/UserAvatar";

const SORTABLE_COLUMNS: [id: string, property: string][] = [
  ["account.shares.table.id", "id"],
  ["account.shares.table.name", "name"],
  ["admin.shares.table.username", "username"],
  ["admin.shares.custom.table.uploadDate", "createdAt"],
  ["account.shares.table.visitors", "views"],
  ["account.shares.table.size", "size"],
  ["account.shares.table.expiresAt", "expiration"],
];

const ManageShareTable = ({
  shares,
  updateShare,
  deleteShare,
  isLoading,
  sort,
  setSort,
}: {
  shares: MyShare[];
  updateShare: (share: MyShare) => void;
  deleteShare: (share: MyShare) => void;
  isLoading: boolean;
  sort: TableSort;
  setSort: Dispatch<SetStateAction<TableSort>>;
}) => {
  const modals = useModals();
  const clipboard = useClipboard();
  const config = useConfig();
  const t = useTranslate();

  // Check if file retention is enabled
  const fileRetentionPeriod = config.get("share.fileRetentionPeriod");
  const fileRetentionEnabled = fileRetentionPeriod.value !== 0 ? true : false;

  return (
    <Box sx={{ display: "block", overflowX: "auto" }}>
      <Table verticalSpacing="sm">
        <thead>
          <tr>
            {SORTABLE_COLUMNS.map(([id, property]) => (
              <SortableTh
                key={property}
                id={id}
                property={property}
                sort={sort}
                setSort={setSort}
              />
            ))}
            {fileRetentionEnabled && (
              <th>
                <FormattedMessage id="admin.shares.table.deletes" />
              </th>
            )}
            <th>
              <span className="visually-hidden">
                {t("common.custom.actions")}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? skeletonRows(fileRetentionEnabled)
            : shares.map((share) => (
                <tr key={share.id}>
                  <td>{share.id}</td>
                  <td>{share.name}</td>
                  <td>
                    {share.creator ? (
                      <Group spacing={6} noWrap>
                        <UserAvatar
                          user={share.creator}
                          size={22}
                          aria-hidden
                        />
                        <Text size="sm">{share.creator.username}</Text>
                      </Group>
                    ) : (
                      <Text color="dimmed">Anonymous</Text>
                    )}
                  </td>
                  <td>
                    <RelativeTime date={share.createdAt} />
                  </td>
                  <td>{share.views}</td>
                  <td>{byteToHumanSizeString(share.size)}</td>
                  <td>
                    {moment(share.expiration).unix() === 0 ? (
                      t("account.shares.table.expiry-never")
                    ) : (
                      <RelativeTime date={share.expiration} />
                    )}
                  </td>
                  {fileRetentionEnabled ? (
                    <td>
                      {moment(share.expiration).unix() === 0 ||
                      fileRetentionPeriod.value === -1 ? (
                        t("account.shares.table.expiry-never")
                      ) : (
                        <RelativeTime
                          date={moment(share.expiration)
                            .add(
                              fileRetentionPeriod.value,
                              fileRetentionPeriod.unit,
                            )
                            .toDate()}
                        />
                      )}
                    </td>
                  ) : (
                    <></>
                  )}
                  <td>
                    <Group position="right" noWrap>
                      <HoverTip label={t("common.button.info")}>
                        <ActionIcon
                          color="blue"
                          variant="light"
                          size={25}
                          aria-label={t("common.button.info")}
                          onClick={() => {
                            showShareInformationsModal(
                              modals,
                              share,
                              parseInt(config.get("share.maxSize")),
                              config.get("general.appUrl"),
                              config.get("general.appUrl", true),
                              updateShare,
                            );
                          }}
                        >
                          <TbInfoCircle />
                        </ActionIcon>
                      </HoverTip>
                      <HoverTip label={t("common.button.copy-link")}>
                        <ActionIcon
                          color="victoria"
                          variant="light"
                          size={25}
                          aria-label={t("common.button.copy-link")}
                          onClick={() => {
                            if (window.isSecureContext) {
                              clipboard.copy(
                                `${config.get("general.appUrl") !== config.get("general.appUrl", true) ? config.get("general.appUrl") : window.location.origin}/s/${share.id}`,
                              );
                              toast.success(t("common.notify.copied-link"));
                            } else {
                              showShareLinkModal(
                                modals,
                                share.id,
                                config.get("general.appUrl"),
                                config.get("general.appUrl", true),
                              );
                            }
                          }}
                        >
                          <TbLink />
                        </ActionIcon>
                      </HoverTip>
                      <HoverTip label={t("common.button.delete")}>
                        <ActionIcon
                          variant="light"
                          color="red.9"
                          size={25}
                          aria-label={t("common.button.delete")}
                          onClick={() => deleteShare(share)}
                        >
                          <TbTrash />
                        </ActionIcon>
                      </HoverTip>
                    </Group>
                  </td>
                </tr>
              ))}
        </tbody>
      </Table>
    </Box>
  );
};

const skeletonRows = (fileRetentionEnabled: boolean) =>
  [...Array(10)].map((v, i) => (
    <tr key={i}>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      {fileRetentionEnabled && (
        <td>
          <Skeleton key={`${i}-retention`} height={20} />
        </td>
      )}
      <td>
        <Skeleton key={`${i}-actions`} height={20} />
      </td>
    </tr>
  ));

export default ManageShareTable;
