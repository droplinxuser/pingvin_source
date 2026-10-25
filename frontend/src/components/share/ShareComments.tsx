import {
  Avatar,
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
import moment from "moment";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { TbLogin, TbMessageCircle, TbSend } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";
import useUser from "../../hooks/user.hook";
import commentService, {
  COMMENTS_PAGE_SIZE,
} from "../../services/comment.service";
import { ShareComment } from "../../types/share.type";
import toast from "../../utils/toast.util";

const avatarLabel = (name: string) =>
  name.trim().charAt(0).toUpperCase() || "?";

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

const ShareComments = ({ shareId }: { shareId: string }) => {
  const t = useTranslate();
  const { user } = useUser();

  const [comments, setComments] = useState<ShareComment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    let cancelled = false;

    setIsLoading(true);
    commentService
      .list(shareId, 1, 0)
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
  }, [shareId]);

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

      <Box mt="sm" aria-busy={isLoading}>
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
        ) : comments.length === 0 ? (
          <Text size="sm" color="dimmed" align="center" py="md">
            {t("share.custom.comments.empty")}
          </Text>
        ) : (
          <Box
            sx={{
              opacity: isLoading ? 0.55 : 1,
              transition: "opacity 120ms ease",
            }}
          >
            {comments.map((comment) => (
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
                  <Avatar
                    size={28}
                    radius="xl"
                    color="blue"
                    variant="light"
                    aria-hidden
                  >
                    {avatarLabel(comment.username)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Group spacing={6} align="baseline" noWrap>
                      <Text size="sm" weight={600} truncate lh={1.3}>
                        <span
                          itemProp="author"
                          itemScope
                          itemType="https://schema.org/Person"
                        >
                          <span itemProp="name">{comment.username}</span>
                        </span>
                      </Text>
                      <Text
                        component="time"
                        dateTime={comment.createdAt}
                        itemProp="dateCreated"
                        size="xs"
                        color="dimmed"
                        lh={1.3}
                      >
                        {moment(comment.createdAt).fromNow()}
                      </Text>
                    </Group>
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
                  </Box>
                </Group>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {total > COMMENTS_PAGE_SIZE && (
        <Group position="center" mt="sm">
          <Pagination
            size="sm"
            value={page}
            total={totalPages}
            onChange={(nextPage) => void loadPage(nextPage)}
          />
        </Group>
      )}
    </Paper>
  );
};

export default ShareComments;
