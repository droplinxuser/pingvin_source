import { ActionIcon, Box, Group, Skeleton, Table, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { TbDownload, TbEye, TbClipboard } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import shareService from "../../services/share.service";
import { FileMetaData } from "../../types/File.type";
import { Share } from "../../types/share.type";
import {
  byteToHumanSizeString,
  MAX_INLINE_FILE_SIZE,
} from "../../utils/fileSize.util";
import { getBaseName } from "../../utils/file.util";
import {
  doesFileSupportPreview,
  isShareTextFile,
} from "../../utils/mime.util";
import toast from "../../utils/toast.util";
import TableSortIcon, { TableSort } from "../core/SortIcon";
import showFilePreviewModal from "./modals/showFilePreviewModal";
import { HoverTip } from "../core/HoverTip";
import api from "../../services/api.service";

const renderFileName = (name: string) => {
  const fileName = getBaseName(name);
  return (
    <Text size="sm" truncate title={fileName}>
      {fileName}
    </Text>
  );
};

const FileList = ({
  files,
  setShare,
  share,
  isLoading,
  recipientId,
}: {
  files?: FileMetaData[];
  setShare: Dispatch<SetStateAction<Share | undefined>>;
  share: Share;
  isLoading: boolean;
  recipientId?: string;
}) => {
  const clipboard = useClipboard();
  const modals = useModals();
  const t = useTranslate();

  const [sort, setSort] = useState<TableSort>({
    property: "name",
    direction: "desc",
  });

  const sortFiles = () => {
    if (files && sort.property) {
      const sortedFiles = files.sort((a: any, b: any) => {
        if (sort.direction === "asc") {
          return b[sort.property!].localeCompare(a[sort.property!], undefined, {
            numeric: true,
          });
        } else {
          return a[sort.property!].localeCompare(b[sort.property!], undefined, {
            numeric: true,
          });
        }
      });

      setShare({
        ...share,
        files: sortedFiles,
      });
    }
  };

  useEffect(sortFiles, [sort]);

  return (
    <Box sx={{ display: "block", overflowX: "auto" }}>
      <Table>
        <thead>
          <tr>
            <th style={{ width: "100%" }}>
              <Group spacing="xs" noWrap>
                <FormattedMessage id="share.table.name" />
                <TableSortIcon sort={sort} setSort={setSort} property="name" />
              </Group>
            </th>
            <th>
              <Group spacing="xs" noWrap>
                <FormattedMessage id="share.table.size" />
                <TableSortIcon sort={sort} setSort={setSort} property="size" />
              </Group>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? skeletonRows
            : files!.map((file) => (
                <tr key={file.name}>
                  <td style={{ maxWidth: 0 }}>{renderFileName(file.name)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {byteToHumanSizeString(parseInt(file.size))}
                  </td>
                  <td>
                    <Group position="right" noWrap>
                      {isShareTextFile(file.name) && (
                        <HoverTip label={t("share.copy-text-contents")}>
                          <ActionIcon
                            color="blue"
                            variant="light"
                            size={25}
                            onClick={() => {
                              api
                                .get(
                                  `/shares/${share.id}/files/${file.id}?download=false`,
                                )
                                .then((res) => {
                                  if (window.isSecureContext) {
                                    clipboard.copy(res.data);
                                    toast.success(
                                      t("share.notify.copied-contents"),
                                    );
                                  } else {
                                    toast.error(
                                      t("share.notify.copy-not-supported"),
                                    );
                                  }
                                });
                            }}
                          >
                            <TbClipboard />
                          </ActionIcon>
                        </HoverTip>
                      )}
                      {doesFileSupportPreview(file.name) &&
                        parseInt(file.size) <= MAX_INLINE_FILE_SIZE && (
                          <HoverTip label={t("common.button.preview")}>
                            <ActionIcon
                              color="green"
                              variant="light"
                              size={25}
                              onClick={() =>
                                showFilePreviewModal(share.id, file, modals)
                              }
                            >
                              <TbEye />
                            </ActionIcon>
                          </HoverTip>
                        )}
                      <HoverTip label={t("common.button.download")}>
                        <ActionIcon
                          color="cyan"
                          variant="light"
                          size={25}
                          onClick={async () => {
                            await shareService.downloadFile(
                              share.id,
                              file.id,
                              recipientId,
                            );
                          }}
                        >
                          <TbDownload />
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

const skeletonRows = [...Array(5)].map((c, i) => (
  <tr key={i}>
    <td>
      <Skeleton height={30} width={30} />
    </td>
    <td>
      <Skeleton height={14} />
    </td>
    <td>
      <Skeleton height={14} />
    </td>
    <td>
      <Skeleton height={25} width={25} />
    </td>
  </tr>
));

export default FileList;
