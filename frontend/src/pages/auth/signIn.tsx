import { LoadingOverlay } from "@mantine/core";
import { GetServerSidePropsContext } from "next";
import { useEffect, useState } from "react";
import SignInForm from "../../components/auth/SignInForm";
import Meta from "../../components/Meta";
import useUser from "../../hooks/user.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import { getQueryString, safeRedirectPath } from "../../utils/router.util";

export function getServerSideProps(context: GetServerSidePropsContext) {
  const requested = getQueryString(context.query.redirect);
  const redirectPath = requested ? safeRedirectPath(requested) : null;

  // Strip an unsafe target from the URL as well as from the sign-in form.
  // Otherwise the rejected external URL is still reflected in __NEXT_DATA__.
  if (requested && redirectPath === "/" && requested !== "/") {
    return {
      redirect: { destination: "/auth/signIn", permanent: false },
    };
  }

  return { props: { redirectPath } };
}

const SignIn = ({ redirectPath }: { redirectPath?: string }) => {
  const { refreshUser } = useUser();
  const t = useTranslate();

  const [isLoading, setIsLoading] = useState(redirectPath ? true : false);

  // If the access token is expired, the middleware redirects to this page.
  // If the refresh token is still valid, the user will be redirected to the last page.
  useEffect(() => {
    refreshUser().then((user) => {
      if (user) {
        window.location.replace(redirectPath ?? "/upload");
      } else {
        setIsLoading(false);
      }
    });
  }, []);

  if (isLoading) return <LoadingOverlay overlayOpacity={1} visible />;

  return (
    <>
      <Meta title={t("signin.title")} />
      <SignInForm redirectPath={redirectPath ?? "/upload"} />
    </>
  );
};
export default SignIn;
