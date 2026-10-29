import { ActionIcon, createStyles, TextInput } from "@mantine/core";
import { useRouter } from "next/router";
import { FormEvent, useState } from "react";
import { TbSearch } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";

const useStyles = createStyles((theme) => ({
  form: {
    [theme.fn.smallerThan("sm")]: {
      display: "none",
    },
  },

  input: {
    width: 210,
    [theme.fn.smallerThan("md")]: {
      width: 150,
    },
  },

  mobile: {
    [theme.fn.largerThan("sm")]: {
      display: "none",
    },
  },
}));

/**
 * Public-content search entry point. Desktop visitors get an inline form beside
 * the logo; mobile visitors get a single icon that opens the dedicated /search
 * page (which owns its own input). `part` lets the header place the two
 * variants independently.
 */
const NavbarSearch = ({
  part = "all",
}: {
  part?: "all" | "desktop" | "mobile";
}) => {
  const showForm = part !== "mobile";
  const showIcon = part !== "desktop";
  const { classes } = useStyles();
  const t = useTranslate();
  const router = useRouter();
  const [term, setTerm] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;
    setTerm("");
    void router.push({ pathname: "/search", query: { q: value } });
  };

  return (
    <>
      {showForm && (
        <form className={classes.form} onSubmit={submit} role="search">
          <TextInput
            size="xs"
            radius="xl"
            value={term}
            onChange={(event) => setTerm(event.currentTarget.value)}
            placeholder={t("search.custom.placeholder")}
            icon={<TbSearch size={15} aria-hidden />}
            aria-label={t("search.custom.placeholder")}
            classNames={{ input: classes.input }}
          />
        </form>
      )}
      {showIcon && (
        <ActionIcon
          className={classes.mobile}
          variant="subtle"
          aria-label={t("search.custom.open")}
          title={t("search.custom.open")}
          onClick={() =>
            void router.push({
              pathname: "/search",
              query: term.trim() ? { q: term.trim() } : undefined,
            })
          }
        >
          <TbSearch size={20} />
        </ActionIcon>
      )}
    </>
  );
};

export default NavbarSearch;
