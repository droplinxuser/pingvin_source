import { useRouter } from "next/router";
import { useEffect, useRef } from "react";

const useConfirmLeave = ({
  message,
  enabled,
}: {
  message: string;
  enabled: boolean;
}) => {
  const router = useRouter();
  // Lets an explicit save leave the page without asking even though the
  // component is still marked dirty for the current render. A short window
  // covers both a client transition and a full history navigation.
  const bypassUntilRef = useRef(0);
  const bypassed = () => Date.now() < bypassUntilRef.current;

  useEffect(() => {
    if (!enabled) return;

    // Show confirmation dialog when route changes
    const handleRouteChange = () => {
      if (bypassed()) return;
      const confirmLeave = window.confirm(message);
      if (!confirmLeave) {
        router.events.emit("routeChangeError");
        throw "Route change aborted.";
      }
    };

    // Show confirmation when the user tries to leave or reload the page
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassed()) return;
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    router.events.on("routeChangeStart", handleRouteChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      router.events.off("routeChangeStart", handleRouteChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [router, message, enabled]);

  return () => {
    bypassUntilRef.current = Date.now() + 2000;
  };
};

export default useConfirmLeave;
