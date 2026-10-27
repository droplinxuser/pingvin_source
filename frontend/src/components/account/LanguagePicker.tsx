import { Select } from "@mantine/core";
import { getCookie, setCookie } from "cookies-next/client";
import { useEffect, useState } from "react";
import useTranslate from "../../hooks/useTranslate.hook";
import { LOCALES } from "../../i18n/locales";

const LanguagePicker = () => {
  const t = useTranslate();
  // The cookie is not available during SSR; read it after hydration so the
  // server and first client render agree.
  const [selectedLanguage, setSelectedLanguage] = useState<string>();

  useEffect(() => {
    setSelectedLanguage(getCookie("language")?.toString());
  }, []);

  const languages = Object.values(LOCALES).map((locale) => ({
    value: locale.code,
    label: locale.name,
  }));
  return (
    <Select
      value={selectedLanguage}
      description={t("account.card.language.description")}
      onChange={(value) => {
        setSelectedLanguage(value ?? "en");
        setCookie("language", value, {
          sameSite: "lax",
          expires: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1),
          ),
        });
        location.reload();
      }}
      data={languages}
    />
  );
};

export default LanguagePicker;
