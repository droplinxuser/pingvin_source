import QRCodeGenerator from "qrcode";
import { useEffect, useState } from "react";
import CenterLoader from "../core/CenterLoader";

const QRCode = ({ link }: { link: string }) => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>();

  useEffect(() => {
    setQrCodeUrl(undefined);

    QRCodeGenerator.toDataURL(link, { margin: 2, width: 400 })
      .then(setQrCodeUrl)
      .catch((_) => {
        // Ignore errors
      });
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
