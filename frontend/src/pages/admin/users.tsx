import { Button, Group, Pagination, Space, Text, Title } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useEffect, useState } from "react";
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

const Users = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [customPasswordPolicy, setCustomPasswordPolicy] =
    useState<CustomPasswordPolicy>({
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumber: false,
      requireSpecialCharacter: false,
    });
  const [isLoading, setIsLoading] = useState(true);

  const config = useConfig();
  const modals = useModals();
  const t = useTranslate();

  const getUsers = (targetPage = page) => {
    setIsLoading(true);
    userService
      .list(targetPage, pageSize)
      .then(({ users, total }) => {
        setUsers(users);
        setTotal(total);
        setPage(targetPage);
        setIsLoading(false);
      })
      .catch((e) => {
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
    getUsers();

    let customPasswordPolicy: CustomPasswordPolicy;
    if (config.get("security.customPasswordPolicy")) {
      customPasswordPolicy = {
        minLength: config.get("security.minLength"),
        requireUppercase: config.get("security.requireUppercase"),
        requireLowercase: config.get("security.requireLowercase"),
        requireNumber: config.get("security.requireNumber"),
        requireSpecialCharacter: config.get("security.requireSpecialCharacter"),
      };
      setCustomPasswordPolicy(customPasswordPolicy);
    }
  }, []);

  return (
    <>
      <Meta title={t("admin.users.title")} />
      <Group position="apart" align="baseline" mb={20}>
        <Title mb={30} order={3}>
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
