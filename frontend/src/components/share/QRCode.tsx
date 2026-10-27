import { useEffect, useState } from "react";
import CenterLoader from "../core/CenterLoader";

const QRCode = ({ link }: { link: string }) => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setQrCodeUrl(undefined);

    // The encoder is only needed while the QR panel is open. Loading it on
    // demand keeps it out of the account/admin/upload page bundles.
    import("qrcode")
      .then(({ default: QRCodeGenerator }) =>
        QRCodeGenerator.toDataURL(link, { margin: 2, width: 400 }),
      )
      .then((url) => {
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch((_) => {
        // Ignore errors
      });

    return () => {
      cancelled = true;
    };
  }, [link]);

  if (!qrCodeUrl) {
    return (
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          aspectRatio: "1 / 1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CenterLoader />
      </div>
    );
  }

  return (
    <img
      alt="QR code for the share link"
      src={qrCodeUrl}
      width={400}
      height={400}
      loading="lazy"
      decoding="async"
      style={{ width: "100%", maxWidth: 400, height: "auto" }}
    />
  );
};

export default QRCode;
