import { Button, Group, Pagination, Space, Text, Title } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useEffect, useRef, useState } from "react";
import { TbPlus } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import ManageUserTable from "../../components/admin/users/ManageUserTable";
import showCreateUserModal from "../../components/admin/users/showCreateUserModal";
import useConfig from "../../hooks/config.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import userService from "../../services/user.service";
import User from "../../types/user.type";
import { CustomPasswordPolicy } from "../../types/config.type";
import toast from "../../utils/toast.util";
import { TableSort } from "../../components/core/SortIcon";

const Users = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<TableSort>({ direction: "desc" });
  const requestIdRef = useRef(0);

  const config = useConfig();
  const modals = useModals();
  const t = useTranslate();

  let minLength = 8;
  let requireLowercase = false;
  let requireUppercase = false;
  let requireNumber = false;
  let requireSpecialCharacter = false;

  if (config.get("security.customPasswordPolicy")) {
    minLength = config.get("security.minLength");
    requireLowercase = config.get("security.requireLowercase");
    requireUppercase = config.get("security.requireUppercase");
    requireNumber = config.get("security.requireNumber");
    requireSpecialCharacter = config.get("security.requireSpecialCharacter");
  }

  const customPasswordPolicy: CustomPasswordPolicy = {
    minLength,
    requireUppercase,
    requireLowercase,
    requireNumber,
    requireSpecialCharacter,
  };

  const getUsers = (targetPage = page) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    userService
      .list(targetPage, pageSize, sort.property, sort.direction)
      .then(({ users, total }) => {
        if (requestId !== requestIdRef.current) return;
        setUsers(users);
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

  const deleteUser = (user: User) => {
    modals.openConfirmModal({
      title: t("admin.users.edit.delete.title", {
        username: user.username,
      }),
      children: (
        <Text size="sm">
          <FormattedMessage id="admin.users.edit.delete.description" />
        </Text>
      ),
      labels: {
        confirm: t("common.button.delete"),
        cancel: t("common.button.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        const nextPage = users.length === 1 && page > 1 ? page - 1 : page;
        userService
          .remove(user.id)
          .then(() => getUsers(nextPage))
          .catch(toast.axiosError);
      },
    });
  };

  useEffect(() => {
    getUsers(1);
  }, [sort]);

  return (
    <>
      <Meta title={t("admin.users.title")} />
      <Group position="apart" align="baseline" mb={20}>
        <Title mb={30} order={1} size="h3">
          <FormattedMessage id="admin.users.title" />
        </Title>
        <Button
          onClick={() =>
            showCreateUserModal(
              modals,
              config.get("smtp.enabled"),
              getUsers,
              customPasswordPolicy,
            )
          }
          leftIcon={<TbPlus size={20} />}
        >
          <FormattedMessage id="common.button.create" />
        </Button>
      </Group>

      <ManageUserTable
        users={users}
        getUsers={getUsers}
        deleteUser={deleteUser}
        isLoading={isLoading}
        customPasswordPolicy={customPasswordPolicy}
        sort={sort}
        setSort={setSort}
      />
      {total > pageSize && (
        <Group position="center" mt="lg">
          <Pagination
            value={page}
            onChange={(nextPage) => getUsers(nextPage)}
            total={Math.ceil(total / pageSize)}
          />
        </Group>
      )}
      <Space h="xl" />
    </>
  );
};

export default Users;
