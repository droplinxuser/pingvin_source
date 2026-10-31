import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  MantineTheme,
  Pagination,
  Paper,
  Skeleton,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  TbLogin,
  TbMessageCircle,
  TbPencil,
  TbSend,
  TbTrash,
} from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import useUser from "../../hooks/user.hook";
import commentService, {
  COMMENTS_PAGE_SIZE,
} from "../../services/comment.service";
import { ShareComment } from "../../types/share.type";
import toast from "../../utils/toast.util";
import { HoverTip } from "../core/HoverTip";
import UserAvatar from "../core/UserAvatar";
import RelativeTime from "../core/RelativeTime";

const commentName = (comment: ShareComment) =>
  comment.displayName?.trim() || comment.username;

const commentRowStyle = (theme: MantineTheme) => ({
  paddingTop: theme.spacing.xs,
  paddingBottom: theme.spacing.xs,
  borderTop: `1px solid ${
    theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]
  }`,
  "&:first-of-type": {
    borderTop: "none",
  },
});

const guestStyle = (theme: MantineTheme) => ({
  flexDirection: "column" as const,
  alignItems: "stretch",
  padding: theme.spacing.xs,
  borderRadius: theme.radius.sm,
  backgroundColor:
    theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
  [`@media (min-width: ${theme.breakpoints.sm})`]: {
    flexDirection: "row" as const,
    alignItems: "center",
  },
});

const responsiveButtonStyle = (theme: MantineTheme) => ({
  width: "100%",
  [`@media (min-width: ${theme.breakpoints.sm})`]: {
    width: "auto",
  },
});

const ShareComments = ({
  shareId,
  initialVersion = 0,
}: {
  shareId: string;
  initialVersion?: number;
}) => {
  const t = useTranslate();
  const { user } = useUser();
  const modals = useModals();

  const [comments, setComments] = useState<ShareComment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(initialVersion);
  // A zero version means the share has no comment file yet. Skip the listing
  // request instead of asking the API for an empty list on every share page.
  const [isLoading, setIsLoading] = useState(initialVersion > 0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editContent, setEditContent] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const fetchPage = useCallback(
    async (nextPage: number, expectedVersion: number) => {
      const data = await commentService.list(
        shareId,
        nextPage,
        expectedVersion,
      );
      setComments(data.comments);
      setTotal(data.total);
      setPage(data.page);
      setVersion(data.version);
    },
    [shareId],
  );

  useEffect(() => {
    if (initialVersion <= 0) return;

    let cancelled = false;

    setIsLoading(true);
    commentService
      .list(shareId, 1, initialVersion)
      .then((data) => {
        if (cancelled) return;
        setComments(data.comments);
        setTotal(data.total);
        setPage(data.page);
        setVersion(data.version);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shareId, initialVersion]);

  const loadPage = async (nextPage: number) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await fetchPage(nextPage, version);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = content.trim();
    if (!value || isSubmitting) return;

    setIsSubmitting(true);
    setNotice(undefined);
    try {
      const created = await commentService.create(shareId, value);
      setContent("");
      setNotice(t("share.custom.comments.posted"));

      try {
        await fetchPage(1, created.version);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      }
    } catch (error) {
      toast.axiosError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (comment: ShareComment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
    setNotice(undefined);
  };

  const cancelEdit = () => {
    setEditingId(undefined);
    setEditContent("");
  };

  const saveEdit = async (comment: ShareComment) => {
    const value = editContent.trim();
    if (!value || isSavingEdit) return;

    setIsSavingEdit(true);
    try {
      const updated = await commentService.update(shareId, comment.id, value);
      setEditingId(undefined);
      setEditContent("");
      setNotice(t("share.custom.comments.updated"));

      try {
        await fetchPage(page, updated.version);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      }
    } catch (error) {
      toast.axiosError(error);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteComment = async (comment: ShareComment) => {
    if (isDeletingId) return;

    setIsDeletingId(comment.id);
    try {
      const result = await commentService.remove(shareId, comment.id);
      if (editingId === comment.id) cancelEdit();
      setNotice(t("share.custom.comments.deleted"));

      try {
        await fetchPage(page, result.version);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      }
    } catch (error) {
      toast.axiosError(error);
    } finally {
      setIsDeletingId(undefined);
    }
  };

  const confirmDelete = (comment: ShareComment) => {
    modals.openConfirmModal({
      title: t("share.custom.comments.delete-title"),
      children: (
        <Text size="sm">{t("share.custom.comments.delete-description")}</Text>
      ),
      labels: {
        confirm: t("common.button.delete"),
        cancel: t("common.button.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: () => void deleteComment(comment),
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / COMMENTS_PAGE_SIZE));

  return (
    <Paper
      component="section"
      aria-labelledby="share-comments-title"
      radius="md"
      p={{ base: "xs", sm: "sm" }}
      mt="lg"
      withBorder
      data-testid="share-comments"
    >
      <Group position="apart" align="center" spacing="md">
        <Group spacing="xs" align="center" noWrap>
          <ThemeIcon size={32} radius="sm" variant="light" color="blue">
            <TbMessageCircle size={17} />
          </ThemeIcon>
          <Text
            component="h2"
            id="share-comments-title"
            size="md"
            weight={700}
            lh={1.2}
            m={0}
          >
            {t("share.custom.comments.title")}
          </Text>
          {total > 0 && (
            <Badge size="sm" radius="sm" variant="light" color="blue">
              {total}
            </Badge>
          )}
        </Group>
      </Group>

      <Divider my="sm" />

      {user ? (
        <form onSubmit={submit}>
          <Textarea
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={t("share.custom.comments.placeholder")}
            aria-label={t("share.custom.comments.placeholder")}
            maxLength={1000}
            minRows={2}
            maxRows={5}
            autosize
          />
          <Group
            position="apart"
            align="center"
            mt="xs"
            spacing="xs"
            sx={{ rowGap: 8 }}
          >
            <Text size="xs" color="dimmed">
              {t("share.custom.comments.plaintext")}
            </Text>
            <Button
              type="submit"
              size="sm"
              radius="sm"
              leftIcon={<TbSend size={14} />}
              loading={isSubmitting}
              disabled={!content.trim()}
              sx={responsiveButtonStyle}
            >
              {t("share.custom.comments.submit")}
            </Button>
          </Group>
          {notice && (
            <Text size="xs" color="teal" mt={4} aria-live="polite">
              {notice}
            </Text>
          )}
        </form>
      ) : (
        <Group position="apart" sx={guestStyle} spacing="sm">
          <Group spacing="xs" noWrap sx={{ minWidth: 0 }}>
            <ThemeIcon size={30} radius="sm" variant="light" color="gray">
              <TbLogin size={16} />
            </ThemeIcon>
            <Box sx={{ minWidth: 0 }}>
              <Text size="sm" weight={600} lh={1.3}>
                {t("share.custom.comments.signin")}
              </Text>
              <Text size="xs" color="dimmed" lh={1.3}>
                {t("share.custom.comments.signin-hint")}
              </Text>
            </Box>
          </Group>
          <Button
            component={Link}
            href={`/auth/signIn?redirect=${encodeURIComponent(
              `/share/${shareId}`,
            )}`}
            size="sm"
            radius="sm"
            variant="light"
            sx={responsiveButtonStyle}
          >
            {t("navbar.signin")}
          </Button>
        </Group>
      )}

      <Box
        mt={isLoading || loadFailed || comments.length > 0 ? "sm" : 0}
        aria-busy={isLoading}
      >
        {isLoading && comments.length === 0 ? (
          <Stack spacing="xs">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} height={44} radius="sm" />
            ))}
          </Stack>
        ) : loadFailed && comments.length === 0 ? (
          <Group position="center" spacing="xs" py="md">
            <Text size="sm" color="dimmed">
              {t("share.custom.comments.error")}
            </Text>
            <Button
              size="xs"
              radius="sm"
              variant="light"
              onClick={() => void loadPage(page)}
            >
              {t("share.custom.comments.retry")}
            </Button>
          </Group>
        ) : comments.length > 0 ? (
          <Box
            sx={{
              opacity: isLoading ? 0.55 : 1,
              transition: "opacity 120ms ease",
            }}
          >
            {comments.map((comment) => {
              const name = commentName(comment);
              const canManage =
                !!user && (comment.userId === user.id || user.isAdmin === true);
              const isEditing = editingId === comment.id;

              return (
                <Box
                  key={comment.id}
                  id={`comment-${comment.id}`}
                  component="article"
                  itemScope
                  itemType="https://schema.org/Comment"
                  sx={commentRowStyle}
                  data-testid="share-comment"
                >
                  <Group align="flex-start" spacing="sm" noWrap>
                    <UserAvatar
                      user={{
                        id: comment.userId,
                        username: comment.username,
                        displayName: comment.displayName,
                        avatarUpdatedAt: comment.avatarUpdatedAt,
                      }}
                      size={28}
                      aria-hidden
                    />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Group
                        position="apart"
                        align="center"
                        noWrap
                        spacing="xs"
                      >
                        <Group
                          spacing={6}
                          align="baseline"
                          sx={{ minWidth: 0, flex: 1 }}
                        >
                          <Text size="sm" weight={600} truncate lh={1.3}>
                            <span
                              itemProp="author"
                              itemScope
                              itemType="https://schema.org/Person"
                            >
                              <span itemProp="name">{name}</span>
                            </span>
                          </Text>
                          <Text size="xs" color="dimmed" lh={1.3}>
                            <RelativeTime
                              date={comment.createdAt}
                              itemProp="dateCreated"
                            />
                          </Text>
                        </Group>
                        {canManage && !isEditing && (
                          <Group spacing={2} noWrap>
                            <HoverTip label={t("share.custom.comments.edit")}>
                              <ActionIcon
                                size="sm"
                                radius="sm"
                                variant="subtle"
                                aria-label={t("share.custom.comments.edit")}
                                onClick={() => startEdit(comment)}
                                disabled={!!isDeletingId || isSavingEdit}
                              >
                                <TbPencil size={14} />
                              </ActionIcon>
                            </HoverTip>
                            <HoverTip label={t("share.custom.comments.delete")}>
                              <ActionIcon
                                size="sm"
                                radius="sm"
                                variant="subtle"
                                color="red"
                                aria-label={t("share.custom.comments.delete")}
                                onClick={() => confirmDelete(comment)}
                                disabled={!!isDeletingId || isSavingEdit}
                                loading={isDeletingId === comment.id}
                              >
                                <TbTrash size={14} />
                              </ActionIcon>
                            </HoverTip>
                          </Group>
                        )}
                      </Group>

                      {isEditing ? (
                        <Box mt={6}>
                          <Textarea
                            value={editContent}
                            onChange={(event) =>
                              setEditContent(event.currentTarget.value)
                            }
                            aria-label={t("share.custom.comments.edit")}
                            maxLength={1000}
                            minRows={2}
                            maxRows={4}
                            autosize
                          />
                          <Group position="right" spacing="xs" mt={6}>
                            <Button
                              size="xs"
                              radius="sm"
                              variant="default"
                              onClick={cancelEdit}
                              disabled={isSavingEdit}
                            >
                              {t("common.button.cancel")}
                            </Button>
                            <Button
                              size="xs"
                              radius="sm"
                              onClick={() => void saveEdit(comment)}
                              loading={isSavingEdit}
                              disabled={!editContent.trim()}
                            >
                              {t("common.button.save")}
                            </Button>
                          </Group>
                        </Box>
                      ) : (
                        <Text
                          itemProp="text"
                          size="sm"
                          lh={1.4}
                          sx={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {comment.content}
                        </Text>
                      )}
                    </Box>
                  </Group>
                </Box>
              );
            })}
          </Box>
        ) : null}
      </Box>

      {total > COMMENTS_PAGE_SIZE && (
        <Group position="center" mt="sm">
          <Pagination
            size="sm"
            value={page}
            total={totalPages}
            onChange={(nextPage) => void loadPage(nextPage)}
            getControlProps={(control) => ({
              "aria-label": t(
                control === "previous"
                  ? "common.custom.pagination.previous"
                  : "common.custom.pagination.next",
              ),
            })}
          />
        </Group>
      )}
    </Paper>
  );
};

export const ShareCommentsSkeleton = () => (
  <Paper
    radius="md"
    p={{ base: "xs", sm: "sm" }}
    mt="lg"
    withBorder
    aria-hidden
  >
    <Group spacing="xs" align="center" noWrap>
      <Skeleton height={32} width={32} radius="sm" />
      <Skeleton height={14} width={140} radius="sm" />
    </Group>
    <Divider my="sm" />
    {/* Match the compact guest/empty state. The old three-row comment
        skeleton was ~200px taller than the sign-in prompt, so replacing it
        with the real content pulled the file list and stats up and counted as
        a large layout shift on short text shares. */}
    <Skeleton height={58} radius="sm" />
  </Paper>
);

export default ShareComments;
