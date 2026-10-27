import { Avatar, AvatarProps } from "@mantine/core";
import {
  AvatarUser,
  getUserAvatarUrl,
  getUserInitials,
} from "../../utils/avatar.util";

type UserAvatarProps = Omit<AvatarProps, "src" | "alt" | "children"> & {
  user?: AvatarUser | null;
  loading?: "lazy" | "eager";
};

/**
 * One avatar treatment for the header, comments, share uploader, account and
 * admin tables. Mantine keeps the initials fallback when there is no picture
 * or the image fails to load.
 */
const UserAvatar = ({
  user,
  size = 28,
  radius = "xl",
  color = "blue",
  variant = "light",
  loading = "lazy",
  imageProps,
  ...props
}: UserAvatarProps) => {
  const name = user?.displayName?.trim() || user?.username || "";

  return (
    <Avatar
      {...props}
      src={getUserAvatarUrl(user)}
      alt={name}
      size={size}
      radius={radius}
      color={color}
      variant={variant}
      imageProps={{ alt: name, loading, decoding: "async", ...imageProps }}
    >
      {getUserInitials(user)}
    </Avatar>
  );
};

export default UserAvatar;
