import { Button, PasswordInput, Stack, Text } from "@mantine/core";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import useTranslate, {
  translateOutsideContext,
} from "../../hooks/useTranslate.hook";

const showEnterPasswordModal = (
  modals: ModalsContextProps,
  submitCallback: (password: string) => Promise<void>,
) => {
  const t = translateOutsideContext();
  return modals.openModal({
    // The gate is not a trap: visitors who do not know the password can close
    // it and use the normal site navigation.
    closeOnClickOutside: true,
    withCloseButton: true,
    closeOnEscape: true,
    title: t("share.modal.password.title"),
    children: <Body submitCallback={submitCallback} />,
  });
};

const Body = ({
  submitCallback,
}: {
  submitCallback: (password: string) => Promise<void>;
}) => {
  const [password, setPassword] = useState("");
  const [passwordWrong, setPasswordWrong] = useState(false);
  const t = useTranslate();
  return (
    <Stack align="stretch">
      <Text size="sm">
        <FormattedMessage id="share.modal.password.description" />
      </Text>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!password) {
            setPasswordWrong(true);
            return;
          }
          // Rejections are shown inline instead of opening a second modal.
          setPasswordWrong(false);
          submitCallback(password).catch(() => setPasswordWrong(true));
        }}
      >
        <Stack>
          <PasswordInput
            variant="filled"
            placeholder={t("share.modal.password")}
            aria-label={t("share.modal.password")}
            autoFocus
            error={passwordWrong && t("share.modal.error.invalid-password")}
            onFocus={() => setPasswordWrong(false)}
            onChange={(e) => setPassword(e.target.value)}
            value={password}
            required
          />
          <Button type="submit">
            <FormattedMessage id="common.button.submit" />
          </Button>
        </Stack>
      </form>
    </Stack>
  );
};

export default showEnterPasswordModal;
