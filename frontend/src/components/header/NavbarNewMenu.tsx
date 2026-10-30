import { Group, Menu, Text, UnstyledButton } from "@mantine/core";
import Link from "next/link";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbChevronDown, TbFiles, TbPhoto } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";

const NavbarNewMenu = ({ active = false }: { active?: boolean }) => {
  const t = useTranslate();
  const [opened, setOpened] = useState(false);

  return (
    <Menu
      position="bottom-start"
      withinPortal
      onChange={setOpened}
      trigger="click"
    >
      <Menu.Target>
        <UnstyledButton
          aria-label={`${t("navbar.new")}: ${t("navbar.newMedia")} / ${t(
            "navbar.newFiles",
          )}`}
          aria-haspopup="menu"
          aria-expanded={opened}
          sx={(theme) => ({
            display: "flex",
            alignItems: "center",
            gap: 3,
            lineHeight: 1,
            padding: "8px 12px",
            borderRadius: theme.radius.sm,
            fontSize: theme.fontSizes.sm,
            fontWeight: 500,
            color:
              theme.colorScheme === "dark"
                ? theme.colors.dark[0]
                : theme.colors.gray[7],
            backgroundColor: active
              ? theme.colorScheme === "dark"
                ? theme.fn.rgba(theme.colors[theme.primaryColor][9], 0.25)
                : theme.colors[theme.primaryColor][0]
              : undefined,
            "&:hover": {
              backgroundColor:
                theme.colorScheme === "dark"
                  ? theme.colors.dark[6]
                  : theme.colors.gray[0],
            },
          })}
        >
          <Text size="sm" weight={500} color="inherit">
            {t("navbar.new")}
          </Text>
          <TbChevronDown size={14} aria-hidden />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={Link} href="/new-media" icon={<TbPhoto />}>
          <FormattedMessage id="navbar.newMedia" />
        </Menu.Item>
        <Menu.Item component={Link} href="/new-files" icon={<TbFiles />}>
          <FormattedMessage id="navbar.newFiles" />
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};

export default NavbarNewMenu;
