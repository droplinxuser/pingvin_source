import useTranslate from "../../../hooks/useTranslate.hook";
import Meta from "../../../components/Meta";
import TotpForm from "../../../components/auth/TotpForm";
import { useRouter } from "next/router";
import { getQueryString } from "../../../utils/router.util";

const Totp = () => {
  const t = useTranslate();
  const router = useRouter();

  return (
    <>
      <Meta title={t("totp.title")} />
      <TotpForm
        redirectPath={getQueryString(router.query.redirect) || "/upload"}
      />
    </>
  );
};

export default Totp;
