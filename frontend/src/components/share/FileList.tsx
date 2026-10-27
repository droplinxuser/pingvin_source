import {
  ActionIcon,
  Box,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  MantineTheme,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import {
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TbClipboard,
  TbDownload,
  TbEye,
  TbFile,
  TbFileText,
  TbFileTypePdf,
  TbFileZip,
  TbMusic,
  TbPhoto,
  TbVideo,
} from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import api from "../../services/api.service";
import shareService from "../../services/share.service";
import { FileMetaData } from "../../types/File.type";
import { Share } from "../../types/share.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import { getBaseName } from "../../utils/file.util";
import { openFilePreview } from "../../utils/filePreview.util";
import {
  doesFileSupportPreview,
  getFileMimeType,
  getGalleryMediaKind,
  isShareTextFile,
} from "../../utils/mime.util";
import toast from "../../utils/toast.util";
import TableSortIcon, { TableSort } from "../core/SortIcon";
import { HoverTip } from "../core/HoverTip";
import FileName from "../core/FileName";

const ARCHIVE_EXTENSION = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i;
const FILE_BATCH_SIZE = 50;

const getFileVisual = (name: string) => {
  const kind = getGalleryMediaKind(name);
  if (kind === "image") return { icon: <TbPhoto size={18} />, color: "green" };
  if (kind === "video") return { icon: <TbVideo size={18} />, color: "violet" };

  const mimeType = getFileMimeType(name);
  if (mimeType === "application/pdf")
    return { icon: <TbFileTypePdf size={18} />, color: "red" };
  if (mimeType.startsWith("audio/"))
    return { icon: <TbMusic size={18} />, color: "orange" };
  if (mimeType.startsWith("text/"))
    return { icon: <TbFileText size={18} />, color: "blue" };
  if (ARCHIVE_EXTENSION.test(getBaseName(name)))
    return { icon: <TbFileZip size={18} />, color: "yellow" };
  return { icon: <TbFile size={18} />, color: "gray" };
};

const gridStyle = (theme: MantineTheme) => ({
  display: "grid",
  gridTemplateColumns: "34px minmax(0, 1fr) 70px auto",
  alignItems: "center",
  columnGap: theme.spacing.sm,
  [theme.fn.smallerThan("sm")]: {
    gridTemplateColumns: "34px minmax(0, 1fr) auto",
  },
});

const rowStyle = (theme: MantineTheme) => ({
  ...gridStyle(theme),
  transition: "background-color 120ms ease",
  "&:hover": {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.colors.dark[6]
        : theme.colors.gray[0],
  },
});

const FileListHeader = ({
  sort,
  setSort,
}: {
  sort?: TableSort;
  setSort?: Dispatch<SetStateAction<TableSort>>;
}) => {
  return (
    <Box
      px="md"
      py="xs"
      sx={(theme) => ({
        backgroundColor:
          theme.colorScheme === "dark"
            ? theme.colors.dark[7]
            : theme.colors.gray[0],
        borderBottom: `1px solid ${
          theme.colorScheme === "dark"
            ? theme.colors.dark[5]
            : theme.colors.gray[2]
        }`,
      })}
    >
      <Box sx={gridStyle}>
        <Box component="span" aria-hidden />
        <Group spacing={4} noWrap>
          <Text size="xs" weight={700} tt="uppercase" color="dimmed">
            <FormattedMessage id="share.table.name" />
          </Text>
          {sort && setSort && (
            <TableSortIcon sort={sort} setSort={setSort} property="name" />
          )}
        </Group>
        <Group
          spacing={4}
          noWrap
          sx={(theme) => ({
            [theme.fn.smallerThan("sm")]: { display: "none" },
          })}
        >
          <Text size="xs" weight={700} tt="uppercase" color="dimmed">
            <FormattedMessage id="share.table.size" />
          </Text>
          {sort && setSort && (
            <TableSortIcon sort={sort} setSort={setSort} property="size" />
          )}
        </Group>
        <Box
          component="span"
          aria-hidden
          sx={(theme) => ({
            [theme.fn.smallerThan("sm")]: { display: "none" },
          })}
        />
      </Box>
    </Box>
  );
};

const FileList = ({
  files,
  share,
  isLoading,
  recipientId,
  skeletonCount = 5,
}: {
  files?: FileMetaData[];
  share: Share;
  isLoading: boolean;
  recipientId?: string;
  skeletonCount?: number;
}) => {
  const clipboard = useClipboard();
  const modals = useModals();
  const t = useTranslate();
  const [sort, setSort] = useState<TableSort>({
    property: "name",
    direction: "asc",
  });
  // Large folder shares can contain thousands of rows. Render one batch at a
  // time; an observer below the list reveals the next batch on scroll.
  const [visibleCount, setVisibleCount] = useState(FILE_BATCH_SIZE);
  const moreRef = useRef<HTMLDivElement>(null);

  const sortedFiles = useMemo(() => {
    if (!files) return [];
    const property = sort.property === "size" ? "size" : "name";
    return [...files].sort((a, b) => {
      const result =
        property === "size"
          ? (parseInt(a.size) || 0) - (parseInt(b.size) || 0)
          : getBaseName(a.name).localeCompare(getBaseName(b.name), undefined, {
              numeric: true,
            });
      return sort.direction === "asc" ? result : -result;
    });
  }, [files, sort]);

  // The preview arrows follow the current table order, so opening a file from
  // the list navigates the same way the rows are presented.
  const mediaFiles = useMemo(
    () => sortedFiles.filter((file) => !!getGalleryMediaKind(file.name)),
    [sortedFiles],
  );

  useEffect(() => {
    setVisibleCount(FILE_BATCH_SIZE);
  }, [sortedFiles]);

  useEffect(() => {
    if (visibleCount >= sortedFiles.length) return;
    const element = moreRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(sortedFiles.length);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleCount((count) =>
          Math.min(count + FILE_BATCH_SIZE, sortedFiles.length),
        );
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [sortedFiles.length, visibleCount]);

  const visibleFiles = sortedFiles.slice(0, visibleCount);

  return (
    <Paper
      data-testid="share-file-list"
      withBorder
      radius="md"
      sx={{ overflow: "hidden" }}
    >
      <FileListHeader sort={sort} setSort={setSort} />

      <Stack spacing={0}>
        {isLoading
          ? skeletonRows(skeletonCount)
          : visibleFiles.map((file, index) => {
              const size = byteToHumanSizeString(parseInt(file.size));
              const visual = getFileVisual(file.name);

              return (
                <Box
                  key={file.id}
                  data-testid="share-file-row"
                  px="md"
                  py="sm"
                  sx={(theme) => ({
                    ...rowStyle(theme),
                    borderTop:
                      index === 0
                        ? undefined
                        : `1px solid ${
                            theme.colorScheme === "dark"
                              ? theme.colors.dark[5]
                              : theme.colors.gray[2]
                          }`,
                  })}
                >
                  <ThemeIcon
                    variant="light"
                    color={visual.color}
                    size={34}
                    radius="sm"
                  >
                    {visual.icon}
                  </ThemeIcon>
                  <Box sx={{ minWidth: 0 }}>
                    <FileName name={file.name} />
                    <Text
                      size="xs"
                      color="dimmed"
                      sx={(theme) => ({
                        display: "none",
                        [theme.fn.smallerThan("sm")]: { display: "block" },
                      })}
                    >
                      {size}
                    </Text>
                  </Box>
                  <Text
                    size="xs"
                    color="dimmed"
                    align="right"
                    sx={(theme) => ({
                      [theme.fn.smallerThan("sm")]: { display: "none" },
                    })}
                  >
                    {size}
                  </Text>
                  <Group spacing={4} noWrap sx={{ justifySelf: "end" }}>
                    {isShareTextFile(file.name) && (
                      <HoverTip label={t("share.copy-text-contents")}>
                        <ActionIcon
                          color="blue"
                          variant="light"
                          size={28}
                          aria-label={t("share.copy-text-contents")}
                          onClick={() => {
                            if (!window.isSecureContext) {
                              toast.error(
                                t("share.notify.copy-not-supported-error"),
                              );
                              return;
                            }
                            api
                              .get(
                                `/shares/${share.id}/files/${file.id}?download=false`,
                              )
                              .then((res) => {
                                clipboard.copy(res.data);
                                toast.success(
                                  t("share.notify.copied-contents"),
                                );
                              })
                              .catch(toast.axiosError);
                          }}
                        >
                          <TbClipboard size={16} />
                        </ActionIcon>
                      </HoverTip>
                    )}
                    {doesFileSupportPreview(file.name) && (
                      <HoverTip label={t("common.button.preview")}>
                        <ActionIcon
                          color="green"
                          variant="light"
                          size={28}
                          aria-label={t("common.button.preview")}
                          onClick={() =>
                            openFilePreview(share.id, file, modals, mediaFiles)
                          }
                        >
                          <TbEye size={16} />
                        </ActionIcon>
                      </HoverTip>
                    )}
                    <HoverTip label={t("common.button.download")}>
                      <ActionIcon
                        color="cyan"
                        variant="light"
                        size={28}
                        aria-label={t("common.button.download")}
                        onClick={async () => {
                          await shareService.downloadFile(
                            share.id,
                            file.id,
                            recipientId,
                            file.name,
                          );
                        }}
                      >
                        <TbDownload size={16} />
                      </ActionIcon>
                    </HoverTip>
                  </Group>
                </Box>
              );
            })}
        {!isLoading && visibleCount < sortedFiles.length && (
          <Box
            ref={moreRef}
            px="md"
            py="sm"
            aria-hidden
            data-testid="share-file-list-more"
          >
            <Skeleton height={10} width="30%" />
          </Box>
        )}
      </Stack>
    </Paper>
  );
};

const skeletonRows = (count: number) =>
  [...Array(Math.min(Math.max(count, 1), 50))].map((_, index) => (
    <Box
      key={index}
      px="md"
      py="sm"
      sx={(theme) => ({
        ...rowStyle(theme),
        borderTop:
          index === 0
            ? undefined
            : `1px solid ${
                theme.colorScheme === "dark"
                  ? theme.colors.dark[5]
                  : theme.colors.gray[2]
              }`,
      })}
    >
      <Skeleton height={34} width={34} radius="sm" />
      <Box sx={{ minWidth: 0 }}>
        <Skeleton height={12} width="45%" mb={6} />
        <Skeleton height={10} width="20%" />
      </Box>
      <Skeleton
        height={10}
        width={40}
        radius="sm"
        sx={(theme) => ({
          [theme.fn.smallerThan("sm")]: { display: "none" },
        })}
      />
      <Group spacing={4} noWrap sx={{ justifySelf: "end" }}>
        <Skeleton height={28} width={28} radius="sm" />
        <Skeleton height={28} width={28} radius="sm" />
      </Group>
    </Box>
  ));

export const FileListSkeleton = ({ count = 5 }: { count?: number }) => (
  <Paper withBorder radius="md" sx={{ overflow: "hidden" }}>
    <FileListHeader />
    <Stack spacing={0}>{skeletonRows(count)}</Stack>
  </Paper>
);

export default FileList;
