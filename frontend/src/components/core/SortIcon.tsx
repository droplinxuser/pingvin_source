import { ActionIcon, Group } from "@mantine/core";
import { Dispatch, SetStateAction } from "react";
import { FormattedMessage } from "react-intl";
import { TbChevronDown, TbChevronUp, TbSelector } from "react-icons/tb";
import useTranslate from "../../hooks/useTranslate.hook";

export type TableSort = {
  property?: string;
  direction: "asc" | "desc";
};

const TableSortIcon = ({
  sort,
  setSort,
  property,
}: {
  sort: TableSort;
  setSort: Dispatch<SetStateAction<TableSort>>;
  property: string;
}) => {
  const t = useTranslate();
  if (sort.property === property) {
    return (
      <ActionIcon
        aria-label={`${t("common.custom.sort")}: ${property}`}
        onClick={() =>
          setSort({
            property,
            direction: sort.direction === "asc" ? "desc" : "asc",
          })
        }
      >
        {sort.direction === "asc" ? <TbChevronDown /> : <TbChevronUp />}
      </ActionIcon>
    );
  } else {
    return (
      <ActionIcon
        aria-label={`${t("common.custom.sort")}: ${property}`}
        onClick={() => setSort({ property, direction: "asc" })}
      >
        <TbSelector />
      </ActionIcon>
    );
  }
};

export const SortableTh = ({
  id,
  property,
  sort,
  setSort,
}: {
  id: string;
  property: string;
  sort: TableSort;
  setSort: Dispatch<SetStateAction<TableSort>>;
}) => (
  <th>
    <Group spacing="xs" noWrap>
      <FormattedMessage id={id} />
      <TableSortIcon sort={sort} setSort={setSort} property={property} />
    </Group>
  </th>
);

export default TableSortIcon;
