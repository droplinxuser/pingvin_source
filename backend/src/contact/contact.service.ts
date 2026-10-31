import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "src/config/config.service";
import { EmailService } from "src/email/email.service";
import { SendContactMessageDTO } from "./dto/sendContactMessage.dto";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileResponse = {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  private get siteKey(): string {
    return process.env.CFT_KEY?.trim() || "";
  }

  private get secret(): string {
    return process.env.CFT_SECRET?.trim() || "";
  }

  private get adminEmail(): string {
    return (
      process.env.REPORT_EMAIL?.trim() ||
      ((this.config.get("smtp.email") as string | undefined)?.trim() ?? "")
    );
  }

  publicConfig() {
    // Do not show a form that `send()` would reject because SMTP or the
    // destination address is not configured.
    return {
      enabled:
        !!this.siteKey &&
        !!this.secret &&
        this.config.get("smtp.enabled") === true &&
        !!this.adminEmail,
      siteKey: this.siteKey,
    };
  }

  async send(message: SendContactMessageDTO, remoteIp?: string): Promise<void> {
    if (!this.siteKey || !this.secret) {
      throw new ServiceUnavailableException(
        "The contact form is not configured yet.",
      );
    }

    if (!this.config.get("smtp.enabled") || !this.adminEmail) {
      throw new ServiceUnavailableException(
        "Contact email is not configured yet.",
      );
    }

    const name = sanitizeLine(message.name);
    const subject = sanitizeLine(message.subject);
    const body = message.message.trim();
    if (!name || !subject || !body) {
      throw new BadRequestException("Please fill in every field.");
    }

    await this.verifyTurnstile(message.turnstileToken, remoteIp);

    // The SMTP round trip is not part of the visitor's request. A temporary
    // mail-provider failure is logged for the administrator instead of showing
    // a misleading error after the captcha has already succeeded.
    void this.emailService
      .sendContactEmail(name, message.email.trim(), subject, body)
      .catch((error) =>
        this.logger.error(`Could not send contact email: ${error}`),
      );
  }

  private async verifyTurnstile(token: string, remoteIp?: string) {
    const body = new URLSearchParams({
      secret: this.secret,
      response: token,
    });
    if (remoteIp) body.set("remoteip", remoteIp);

    let result: TurnstileResponse;
    try {
      const response = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`Turnstile returned HTTP ${response.status}`);
      }
      result = (await response.json()) as TurnstileResponse;
    } catch (error) {
      this.logger.warn(`Turnstile verification failed: ${error}`);
      throw new ServiceUnavailableException(
        "The captcha service is temporarily unavailable.",
      );
    }

    if (!result.success) {
      this.logger.debug(
        `Turnstile rejected a contact request: ${(
          result["error-codes"] ?? []
        ).join(", ")}`,
      );
      throw new BadRequestException("Captcha verification failed.");
    }
    // A token is scoped to one action; reject a token minted for another form.
    if (result.action && result.action !== "contact") {
      throw new BadRequestException("Captcha verification failed.");
    }
  }
}

/** Email headers must never receive a line break from user input. */
function sanitizeLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}
