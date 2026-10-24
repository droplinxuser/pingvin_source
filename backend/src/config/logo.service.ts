import { Injectable } from "@nestjs/common";
import * as fs from "fs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");

const PUBLIC_PATH = "../frontend/public";
const IMAGES_PATH = `${PUBLIC_PATH}/img`;
const PWA_ICON_SIZES = [48, 72, 96, 128, 144, 152, 192, 384, 512];
const WEBP_OPTIONS = { quality: 86, effort: 5 };

@Injectable()
export class LogoService {
  async create(file: Buffer) {
    await Promise.all([
      this.writeLogo(file, "logo"),
      this.createFavicon(file),
      this.createPWAIcons(file),
      this.createOgImage(file),
    ]);
  }

  async createDark(file: Buffer) {
    await this.writeLogo(file, "logo-dark");
  }

  private async writeLogo(file: Buffer, name: string) {
    const [png, webp] = await Promise.all([
      sharp(file)
        .resize(400)
        .png({ compressionLevel: 9, palette: true, quality: 90 })
        .toBuffer(),
      sharp(file).resize(400).webp(WEBP_OPTIONS).toBuffer(),
    ]);
    await Promise.all([
      fs.promises.writeFile(`${IMAGES_PATH}/${name}.png`, png),
      fs.promises.writeFile(`${IMAGES_PATH}/${name}.webp`, webp),
    ]);
  }

  async createFavicon(file: Buffer) {
    const resized = await sharp(file).resize(16).toBuffer();
    await fs.promises.writeFile(`${PUBLIC_PATH}/favicon.ico`, resized);
  }

  async createPWAIcons(file: Buffer) {
    await Promise.all(
      PWA_ICON_SIZES.flatMap((size) => [
        sharp(file)
          .resize(size, size, { fit: "cover" })
          .png({ compressionLevel: 9, palette: true, quality: 90 })
          .toBuffer()
          .then((icon) =>
            fs.promises.writeFile(
              `${IMAGES_PATH}/icons/icon-${size}x${size}.png`,
              icon,
            ),
          ),
        sharp(file)
          .resize(size, size, { fit: "cover" })
          .webp(WEBP_OPTIONS)
          .toBuffer()
          .then((icon) =>
            fs.promises.writeFile(
              `${IMAGES_PATH}/icons/icon-${size}x${size}.webp`,
              icon,
            ),
          ),
      ]),
    );
  }

  private async createOgImage(file: Buffer) {
    const logo = await sharp(file)
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
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(`${IMAGES_PATH}/og-image.png`);
  }
}
