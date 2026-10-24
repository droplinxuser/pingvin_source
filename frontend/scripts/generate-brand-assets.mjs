import { stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const IMAGES_PATH = join(dirname(fileURLToPath(import.meta.url)), "../public/img");
const PWA_ICON_SIZES = [48, 72, 96, 128, 144, 152, 192, 384, 512];
const WEBP = { quality: 86, effort: 5 };
const PNG = { compressionLevel: 9, palette: true, quality: 90 };

const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );

for (const name of ["logo", "logo-dark"]) {
  const png = join(IMAGES_PATH, `${name}.png`);
  if (!(await exists(png))) continue;

  const compressedPng = await sharp(png).resize(400).png(PNG).toBuffer();
  await writeFile(png, compressedPng);
  await sharp(compressedPng).webp(WEBP).toFile(
    join(IMAGES_PATH, `${name}.webp`),
  );
  if (name === "logo") {
    const logo = await sharp(png)
      .resize(430, 430, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 4,
        background: "#46509e",
      },
    })
      .composite([{ input: logo, gravity: "center" }])
      .png(PNG)
      .toFile(join(IMAGES_PATH, "og-image.png"));
  }
}

for (const size of PWA_ICON_SIZES) {
  const png = join(IMAGES_PATH, "icons", `icon-${size}x${size}.png`);
  if (!(await exists(png))) continue;

  const icon = await sharp(png)
    .resize(size, size, { fit: "cover" })
    .png(PNG)
    .toBuffer();
  await writeFile(png, icon);
  await sharp(icon)
    .webp(WEBP)
    .toFile(join(IMAGES_PATH, "icons", `icon-${size}x${size}.webp`));
}

console.log("Generated WebP branding assets and og-image.png");
