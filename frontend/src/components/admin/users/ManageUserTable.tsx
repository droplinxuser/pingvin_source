import { ActionIcon, Badge, Box, Group, Skeleton, Table } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { Dispatch, SetStateAction } from "react";
import { TbCheck, TbEdit, TbTrash } from "react-icons/tb";
import User from "../../../types/user.type";
import showUpdateUserModal from "./showUpdateUserModal";
import useTranslate from "../../../hooks/useTranslate.hook";
import { HoverTip } from "../../core/HoverTip";
import { SortableTh, TableSort } from "../../core/SortIcon";
import { byteToHumanSizeString } from "../../../utils/fileSize.util";
import { CustomPasswordPolicy } from "../../../types/config.type";

const ManageUserTable = ({
  users,
  getUsers,
  deleteUser,
  isLoading,
  customPasswordPolicy,
  sort,
  setSort,
}: {
  users: User[];
  getUsers: () => void;
  deleteUser: (user: User) => void;
  isLoading: boolean;
  customPasswordPolicy: CustomPasswordPolicy;
  sort: TableSort;
  setSort: Dispatch<SetStateAction<TableSort>>;
}) => {
  const modals = useModals();
  const t = useTranslate();

  const showDisplayName = users.some((user) => !!user.displayName);
  const showStorageQuota = users.some((user) => !!user.storageQuotaLimit);
  const showMaxShareSize = users.some((user) => !!user.shareSizeLimit);
  const columns: [id: string, property: string][] = [
    ...(showDisplayName
      ? [["admin.users.table.displayName", "displayName"] as [string, string]]
      : []),
    ["admin.users.table.username", "username"],
    ["admin.users.table.email", "email"],
    ["admin.users.table.admin", "isAdmin"],
    ...(showStorageQuota
      ? [
          ["admin.users.table.storageQuota", "storageQuotaLimit"] as [
            string,
            string,
          ],
        ]
      : []),
    ...(showMaxShareSize
      ? [
          ["admin.users.table.maxShareSize", "shareSizeLimit"] as [
            string,
            string,
          ],
        ]
      : []),
  ];

  return (
    <Box sx={{ display: "block", overflowX: "auto" }}>
      <Table verticalSpacing="sm">
        <thead>
          <tr>
            {columns.map(([id, property]) => (
              <SortableTh
                key={property}
                id={id}
                property={property}
                sort={sort}
                setSort={setSort}
              />
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? getSkeletonRows(
                showDisplayName,
                showStorageQuota,
                showMaxShareSize,
              )
            : users.map((user) => (
                <tr key={user.id}>
                  {showDisplayName && <td>{user.displayName || "-"}</td>}
                  <td>
                    {user.username}{" "}
                    {user.isLdap ? (
                      <Badge style={{ marginLeft: "1em" }}>LDAP</Badge>
                    ) : null}
                  </td>
                  <td>{user.email}</td>
                  <td>{user.isAdmin && <TbCheck />}</td>
                  {showStorageQuota && (
                    <td>
                      {user.storageQuotaLimit
                        ? byteToHumanSizeString(
                            parseInt(user.storageQuotaLimit),
                          )
                        : "-"}
                    </td>
                  )}
                  {showMaxShareSize && (
                    <td>
                      {user.shareSizeLimit
                        ? byteToHumanSizeString(parseInt(user.shareSizeLimit))
                        : "-"}
                    </td>
                  )}
                  <td>
                    <Group position="right">
                      {user.isLdap ? null : (
                        <HoverTip label={t("common.button.edit")}>
                          <ActionIcon
                            variant="light"
                            color="blue"
                            size={25}
                            onClick={() =>
                              showUpdateUserModal(
                                modals,
                                user,
                                getUsers,
                                customPasswordPolicy,
                              )
                            }
                          >
                            <TbEdit />
                          </ActionIcon>
                        </HoverTip>
                      )}
                      <HoverTip label={t("common.button.delete")}>
                        <ActionIcon
                          variant="light"
                          color="red"
                          size={25}
                          onClick={() => deleteUser(user)}
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

const getSkeletonRows = (
  showDisplayName: boolean,
  showStorageQuota: boolean,
  showMaxShareSize: boolean,
) =>
  [...Array(10)].map((v, i) => (
    <tr key={i}>
      {showDisplayName && (
        <td>
          <Skeleton key={i} height={20} />
        </td>
      )}
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      <td>
        <Skeleton key={i} height={20} />
      </td>
      {showStorageQuota && (
        <td>
          <Skeleton key={i} height={20} />
        </td>
      )}
      {showMaxShareSize && (
        <td>
          <Skeleton key={i} height={20} />
        </td>
      )}
      <td>
        <Skeleton key={i} height={20} />
      </td>
    </tr>
  ));

export default ManageUserTable;
