import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Checkbox,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  MantineTheme,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { useModals } from "@mantine/modals";
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TbChecklist,
  TbClipboard,
  TbDownload,
  TbEye,
  TbFile,
  TbFileText,
  TbFileTypePdf,
  TbFileZip,
  TbLink,
  TbMusic,
  TbPhoto,
  TbSearch,
  TbVideo,
  TbX,
} from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import useTranslate from "../../hooks/useTranslate.hook";
import api from "../../services/api.service";
import shareService from "../../services/share.service";
import { FileMetaData } from "../../types/File.type";
import { Share } from "../../types/share.type";
import { byteToHumanSizeString } from "../../utils/fileSize.util";
import { getBaseName, getShareFileLink } from "../../utils/file.util";
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
import DownloadAllButton from "./DownloadAllButton";
import VirusTotalBadge from "./VirusTotalBadge";

const ARCHIVE_EXTENSION = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i;
const FILE_BATCH_SIZE = 50;
// A search field only earns its space once the list is long enough to scan.
const SEARCH_MIN_FILES = 12;

// Accents and case should not decide whether a file is found, so compare a
// normalized form while keeping the original name for display.
const normalizeSearchText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

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

// The optional selection checkbox adds a narrow leading column. The grid is
// shared by the header and every row so the columns never drift apart.
const gridStyle = (theme: MantineTheme, selectMode: boolean) => ({
  display: "grid",
  gridTemplateColumns: selectMode
    ? "22px 34px minmax(0, 1fr) 70px auto"
    : "34px minmax(0, 1fr) 70px auto",
  alignItems: "center",
  columnGap: theme.spacing.sm,
  [theme.fn.smallerThan("sm")]: {
    gridTemplateColumns: selectMode
      ? "22px 34px minmax(0, 1fr) auto"
      : "34px minmax(0, 1fr) auto",
  },
});

const rowStyle = (theme: MantineTheme, selectMode: boolean) => ({
  ...gridStyle(theme, selectMode),
  transition: "background-color 120ms ease",
  "&:hover": {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.colors.dark[6]
        : theme.colors.gray[0],
  },
});

const toolbarStyle = (theme: MantineTheme) => ({
  borderBottom: `1px solid ${
    theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2]
  }`,
});

const FileListHeader = ({
  sort,
  setSort,
  selectMode = false,
  allSelected = false,
  isIndeterminate = false,
  onToggleAll,
}: {
  sort?: TableSort;
  setSort?: Dispatch<SetStateAction<TableSort>>;
  selectMode?: boolean;
  allSelected?: boolean;
  isIndeterminate?: boolean;
  onToggleAll?: () => void;
}) => {
  const t = useTranslate();

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
      <Box sx={(theme) => gridStyle(theme, selectMode)}>
        {selectMode && (
          <Checkbox
            size="xs"
            aria-label={t("share.custom.files.select-all")}
            checked={allSelected}
            indeterminate={isIndeterminate}
            onChange={onToggleAll}
          />
        )}
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
  downloadCounts,
}: {
  files?: FileMetaData[];
  share: Share;
  isLoading: boolean;
  recipientId?: string;
  skeletonCount?: number;
  // Owner-only per-file download counts (rolling 30 days). Undefined for
  // visitors so the public table never shows analytics.
  downloadCounts?: Record<string, number>;
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
  const [search, setSearch] = useState("");
  // Bulk selection stays off until the visitor opts in, so the default table
  // keeps its uncluttered layout.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const moreRef = useRef<HTMLDivElement>(null);
  const maxDownloads = share?.maxDownloads;
  const downloadLimitReached =
    !!maxDownloads && (share?.downloadCount ?? 0) >= maxDownloads;
  // Typing stays responsive even while a very long list is filtered; the
  // deferred value lags one paint behind the controlled input.
  const deferredSearch = useDeferredValue(search);

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

  const searchTerm = normalizeSearchText(deferredSearch.trim());
  const filteredFiles = useMemo(
    () =>
      searchTerm
        ? sortedFiles.filter((file) =>
            normalizeSearchText(file.name).includes(searchTerm),
          )
        : sortedFiles,
    [sortedFiles, searchTerm],
  );

  // The preview arrows follow the current table order, so opening a file from
  // the list navigates the same way the rows are presented.
  const mediaFiles = useMemo(
    () => filteredFiles.filter((file) => !!getGalleryMediaKind(file.name)),
    [filteredFiles],
  );

  useEffect(() => {
    setVisibleCount(FILE_BATCH_SIZE);
  }, [filteredFiles]);

  // A new file set (share changed or a file removed) invalidates any previous
  // selection.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [files]);

  useEffect(() => {
    if (visibleCount >= filteredFiles.length) return;
    const element = moreRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(filteredFiles.length);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleCount((count) =>
          Math.min(count + FILE_BATCH_SIZE, filteredFiles.length),
        );
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [filteredFiles.length, visibleCount]);

  const toggleFile = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFilteredSelected =
    filteredFiles.length > 0 &&
    filteredFiles.every((file) => selectedIds.has(file.id));
  const someFilteredSelected = filteredFiles.some((file) =>
    selectedIds.has(file.id),
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (filteredFiles.every((file) => next.has(file.id))) {
        filteredFiles.forEach((file) => next.delete(file.id));
      } else {
        filteredFiles.forEach((file) => next.add(file.id));
      }
      return next;
    });
  }, [filteredFiles]);

  const selectedFiles = useMemo(
    () => (files ?? []).filter((file) => selectedIds.has(file.id)),
    [files, selectedIds],
  );

  const visibleFiles = filteredFiles.slice(0, visibleCount);
  const showSearch = (files?.length ?? 0) >= SEARCH_MIN_FILES || !!search;
  const showToolbar = (files?.length ?? 0) > 1;

  return (
    <Paper
      data-testid="share-file-list"
      withBorder
      radius="md"
      sx={{ overflow: "hidden" }}
    >
      {showToolbar && (
        <Box px="md" py="xs" sx={toolbarStyle}>
          <Group position="apart" spacing="xs">
            <Group spacing="xs" noWrap>
              <Button
                size="xs"
                variant={selectMode ? "light" : "subtle"}
                color={selectMode ? "cyan.9" : "gray"}
                leftIcon={<TbChecklist size={14} />}
                aria-pressed={selectMode}
                onClick={() =>
                  setSelectMode((mode) => {
                    if (mode) setSelectedIds(new Set());
                    return !mode;
                  })
                }
              >
                {t(
                  selectMode
                    ? "share.custom.files.select-done"
                    : "share.custom.files.select",
                )}
              </Button>
              {selectMode && (
                <>
                  <Text
                    size="xs"
                    color="dimmed"
                    aria-live="polite"
                    data-testid="share-file-selection-count"
                  >
                    {t("share.custom.files.selected-count", {
                      count: selectedIds.size,
                    })}
                  </Text>
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={toggleSelectAll}
                  >
                    {allFilteredSelected
                      ? t("share.custom.files.clear-selection")
                      : t("share.custom.files.select-all")}
                  </Anchor>
                </>
              )}
            </Group>
            {selectMode && (
              <DownloadAllButton
                shareId={share.id}
                recipientId={recipientId}
                files={selectedFiles}
                labelId="share.custom.files.download-selected"
                size="xs"
                disabled={downloadLimitReached}
                cacheBust={!!maxDownloads}
              />
            )}
          </Group>
          {showSearch && (
            <TextInput
              data-testid="share-file-search"
              icon={<TbSearch size={16} />}
              size="xs"
              mt="xs"
              value={search}
              aria-label={t("share.custom.files.search")}
              placeholder={t("share.custom.files.search-placeholder", {
                count: files?.length ?? 0,
              })}
              onChange={(event) => setSearch(event.currentTarget.value)}
              rightSection={
                search ? (
                  <ActionIcon
                    size={18}
                    radius="xl"
                    variant="subtle"
                    color="gray"
                    aria-label={t("share.custom.files.clear-search")}
                    onClick={() => setSearch("")}
                  >
                    <TbX size={12} />
                  </ActionIcon>
                ) : undefined
              }
            />
          )}
          {showSearch && searchTerm && (
            <Text
              size="xs"
              color="dimmed"
              mt={4}
              aria-live="polite"
              data-testid="share-file-search-count"
            >
              {t("share.custom.files.search-results", {
                shown: filteredFiles.length,
                total: sortedFiles.length,
              })}
            </Text>
          )}
        </Box>
      )}

      <FileListHeader
        sort={sort}
        setSort={setSort}
        selectMode={selectMode}
        allSelected={allFilteredSelected}
        isIndeterminate={someFilteredSelected && !allFilteredSelected}
        onToggleAll={toggleSelectAll}
      />

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
                    ...rowStyle(theme, selectMode),
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
                  {selectMode && (
                    <Checkbox
                      size="xs"
                      aria-label={t("share.custom.files.select-file", {
                        name: getBaseName(file.name),
                      })}
                      checked={selectedIds.has(file.id)}
                      onChange={() => toggleFile(file.id)}
                    />
                  )}
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
                    {downloadCounts && (downloadCounts[file.id] ?? 0) > 0 && (
                      <Text
                        size="xs"
                        color="dimmed"
                        data-testid="share-file-download-count"
                      >
                        {t("share.custom.files.download-count", {
                          count: downloadCounts[file.id],
                        })}
                      </Text>
                    )}
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
                    {file.virustotal && (
                      <VirusTotalBadge report={file.virustotal} />
                    )}
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
                            shareService
                              .getFileText(share.id, file.id)
                              .then((text) => {
                                clipboard.copy(text);
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
                            openFilePreview(
                              share.id,
                              file,
                              modals,
                              mediaFiles,
                              !!maxDownloads,
                            )
                          }
                        >
                          <TbEye size={16} />
                        </ActionIcon>
                      </HoverTip>
                    )}
                    <HoverTip label={t("share.custom.files.copy-link")}>
                      <ActionIcon
                        color="grape"
                        variant="light"
                        size={28}
                        aria-label={t("share.custom.files.copy-link")}
                        onClick={() => {
                          if (!window.isSecureContext) {
                            toast.error(
                              t("share.notify.copy-not-supported-error"),
                            );
                            return;
                          }
                          clipboard.copy(
                            `${window.location.origin}${getShareFileLink(
                              share.id,
                              file.id,
                            )}`,
                          );
                          toast.success(t("share.notify.copied-link"));
                        }}
                      >
                        <TbLink size={16} />
                      </ActionIcon>
                    </HoverTip>
                    <HoverTip label={t("common.button.download")}>
                      <ActionIcon
                        color="cyan"
                        variant="light"
                        size={28}
                        aria-label={t("common.button.download")}
                        disabled={downloadLimitReached}
                        onClick={async () => {
                          await shareService.downloadFile(
                            share.id,
                            file.id,
                            recipientId,
                            file.name,
                            !!maxDownloads,
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
        {!isLoading && searchTerm && filteredFiles.length === 0 && (
          <Box px="md" py="xl" data-testid="share-file-search-empty">
            <Text size="sm" color="dimmed" align="center">
              {t("share.custom.files.search-empty", { query: search.trim() })}
            </Text>
          </Box>
        )}
        {!isLoading && visibleCount < filteredFiles.length && (
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
        ...rowStyle(theme, false),
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
    {count > 1 && (
      <Box px="md" py="xs" sx={toolbarStyle}>
        <Skeleton height={30} radius="sm" />
      </Box>
    )}
    <FileListHeader />
    <Stack spacing={0}>{skeletonRows(count)}</Stack>
  </Paper>
);

export default FileList;
