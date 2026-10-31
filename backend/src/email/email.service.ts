import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { User } from "@prisma/client";
import * as moment from "moment";
import * as nodemailer from "nodemailer";
import { I18nService } from "nestjs-i18n";
import { ConfigService } from "src/config/config.service";

@Injectable()
export class EmailService {
  constructor(
    private config: ConfigService,
    private readonly i18n: I18nService,
  ) {}
  private readonly logger = new Logger(EmailService.name);

  getTransporter() {
    if (!this.config.get("smtp.enabled"))
      throw new InternalServerErrorException(this.i18n.t("email.smtpDisabled"));

    const username = this.config.get("smtp.username");
    const password = this.config.get("smtp.password");

    return nodemailer.createTransport({
      host: this.config.get("smtp.host"),
      port: this.config.get("smtp.port"),
      secure: this.config.get("smtp.port") == 465,
      auth:
        username || password ? { user: username, pass: password } : undefined,
      tls: {
        rejectUnauthorized: !this.config.get(
          "smtp.allowUnauthorizedCertificates",
        ),
      },
    });
  }

  private getFromAddress(): string | { name: string; address: string } {
    const appName = this.config
      .get("general.appName")
      ?.replace(/[\r\n]+/g, " ")
      .trim();
    const address = this.config.get("smtp.email");
    return appName ? { name: appName, address } : address;
  }

  private formatTemplate(
    template: string,
    vars: Record<string, string | undefined>,
    escapeForHtml = false,
  ): string {
    // {appName} is available to every email template
    const templateVars = {
      appName: this.config.get("general.appName"),
      ...vars,
    };
    // Share names, file names and report messages are user-controlled. When
    // the message is sent as HTML they must not be able to inject markup.
    const values = escapeForHtml
      ? this.escapeHtmlVars(templateVars)
      : templateVars;

    return template
      .replaceAll("\\n", "\n")
      .replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key) => values[key] ?? match);
  }

  private escapeHtmlVars(vars: Record<string, string | undefined>) {
    if (!this.config.get("email.sendHtmlEmails")) return vars;

    const escape = (value?: string) =>
      value
        ?.replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    return Object.fromEntries(
      Object.entries(vars).map(([key, value]) => [key, escape(value)]),
    ) as Record<string, string | undefined>;
  }

  private async sendMail(
    email: string,
    subject: string,
    text: string,
    replyTo?: string | { name: string; address: string },
    recipientName?: string,
  ) {
    const isHtml = this.config.get("email.sendHtmlEmails");
    // OAuth-provided names are not covered by the local display-name pattern;
    // strip CRLF before they reach a header-adjacent display name.
    const recipient = recipientName?.replace(/[\r\n]+/g, " ").trim();
    // Share names and file names are user-controlled and can reach a subject
    // template. Strip line breaks so they cannot inject extra mail headers.
    const safeSubject = subject.replace(/[\r\n]+/g, " ").trim();

    await this.getTransporter()
      .sendMail({
        from: this.getFromAddress(),
        to: recipient ? { name: recipient, address: email } : email,
        subject: safeSubject,
        [isHtml ? "html" : "text"]: text,
        ...(replyTo && { replyTo }),
      })
      .catch((e) => {
        this.logger.error(e);
        throw new InternalServerErrorException(this.i18n.t("email.sendFailed"));
      });
  }

  async sendMailToShareRecipients(
    recipientEmail: string,
    recipientId: string,
    shareId: string,
    creator?: Pick<User, "email" | "displayName" | "username">,
    description?: string,
    expiration?: Date,
    recipientName?: string,
  ) {
    if (!this.config.get("share.enableShareEmailRecipients"))
      throw new InternalServerErrorException(
        this.i18n.t("email.emailServiceDisabled"),
      );

    const shareUrl = `${this.config.get(
      "general.appUrl",
    )}/s/${shareId}?recipient=${encodeURIComponent(recipientId)}`;
    const lang = this.config.get("general.defaultLanguage");
    const locale = this.i18n.translate("email.locale", { lang });

    let replyTo: string | { name: string; address: string } | undefined =
      undefined;
    if (
      this.config.get("email.shareRecipientsReplyToCreator") &&
      creator?.email
    ) {
      const creatorName = (creator.displayName || creator.username)?.replace(
        /[\r\n]+/g,
        " ",
      );
      replyTo = creatorName
        ? { name: creatorName, address: creator.email }
        : creator.email;
    }

    const vars = {
      creator:
        creator?.displayName ||
        creator?.username ||
        this.i18n.t("email.shareRecipientsCreatorFallback"),
      creatorEmail: creator?.email ?? "",
      shareUrl,
      desc: description ?? this.i18n.t("email.shareRecipientsDescFallback"),
      expires:
        moment(expiration).unix() != 0
          ? moment(expiration).locale(locale).fromNow()
          : this.i18n.t("email.shareRecipientsExpiresNeverFallback"),
      name: recipientName ?? "",
      recipient: recipientName ?? "",
      recipientEmail,
      email: recipientEmail,
    };

    await this.sendMail(
      recipientEmail,
      this.formatTemplate(
        this.config.get("email.shareRecipientsSubject"),
        vars,
      ),
      this.formatTemplate(
        this.config.get("email.shareRecipientsMessage"),
        vars,
        true,
      ),
      replyTo,
      recipientName,
    );
  }

  async sendShareDownloadNotification(
    creatorEmail: string,
    shareId: string,
    fileName: string,
    recipientEmail: string,
    creatorName?: string,
    recipientName?: string,
  ) {
    const shareUrl = `${this.config.get("general.appUrl")}/s/${shareId}`;
    const downloader = recipientName
      ? `${recipientName} (${recipientEmail})`
      : recipientEmail;

    const vars = {
      recipient: downloader,
      recipientEmail,
      fileName,
      shareUrl,
      creator: creatorName ?? "",
      name: creatorName ?? "",
    };

    await this.sendMail(
      creatorEmail,
      this.formatTemplate(
        this.config.get("email.shareDownloadNotificationSubject"),
        vars,
      ),
      this.formatTemplate(
        this.config.get("email.shareDownloadNotificationMessage"),
        vars,
        true,
      ),
      undefined,
      creatorName,
    );
  }

  async sendMalwareRemovalEmail(
    recipientEmail: string,
    shareId: string,
    fileName: string,
    remainingFiles: number,
    recipientName?: string,
  ) {
    if (!this.config.get("smtp.enabled")) return;

    const shareUrl = `${this.config.get("general.appUrl")}/s/${shareId}`;
    const vars = {
      appName: this.config.get("general.appName"),
      name: recipientName ?? "",
      fileName,
      shareId,
      shareUrl,
      status:
        remainingFiles === 0
          ? this.i18n.t("email.malwareRemovedShareRemoved")
          : this.i18n.t("email.malwareRemovedShareKept", {
              args: { count: remainingFiles },
            }),
    };

    await this.sendMail(
      recipientEmail,
      this.i18n.t("email.malwareRemovedSubject", { args: vars }),
      this.i18n.t("email.malwareRemovedText", {
        args: this.escapeHtmlVars(vars),
      }),
      undefined,
      recipientName,
    );
  }

  async sendMailToReverseShareCreator(
    recipientEmail: string,
    shareId: string,
    recipientName?: string,
  ) {
    const shareUrl = `${this.config.get("general.appUrl")}/s/${shareId}`;
    const vars = {
      shareUrl,
      name: recipientName ?? "",
      creator: recipientName ?? "",
      recipient: recipientName ?? "",
      email: recipientEmail,
    };

    await this.sendMail(
      recipientEmail,
      this.formatTemplate(this.config.get("email.reverseShareSubject"), vars),
      this.formatTemplate(
        this.config.get("email.reverseShareMessage"),
        vars,
        true,
      ),
      undefined,
      recipientName,
    );
  }

  async sendResetPasswordEmail(
    recipientEmail: string,
    token: string,
    recipientName?: string,
  ) {
    const resetPasswordUrl = `${this.config.get(
      "general.appUrl",
    )}/auth/resetPassword/${token}`;
    const vars = {
      url: resetPasswordUrl,
      name: recipientName ?? "",
      username: recipientName ?? "",
      displayName: recipientName ?? "",
      email: recipientEmail,
    };

    await this.sendMail(
      recipientEmail,
      this.formatTemplate(this.config.get("email.resetPasswordSubject"), vars),
      this.formatTemplate(
        this.config.get("email.resetPasswordMessage"),
        vars,
        true,
      ),
      undefined,
      recipientName,
    );
  }

  async sendInviteEmail(
    recipientEmail: string,
    password: string,
    recipientName?: string,
  ) {
    const loginUrl = `${this.config.get("general.appUrl")}/auth/signIn`;
    const vars = {
      url: loginUrl,
      password,
      email: recipientEmail,
      name: recipientName ?? "",
      username: recipientName ?? "",
      displayName: recipientName ?? "",
    };

    await this.sendMail(
      recipientEmail,
      this.formatTemplate(this.config.get("email.inviteSubject"), vars),
      this.formatTemplate(this.config.get("email.inviteMessage"), vars, true),
      undefined,
      recipientName,
    );
  }

  async sendVerificationEmail(
    recipientEmail: string,
    token: string,
    recipientName?: string,
  ) {
    const verificationUrl = `${this.config.get(
      "general.appUrl",
    )}/auth/verify/${token}`;
    const vars = {
      url: verificationUrl,
      name: recipientName ?? "",
      username: recipientName ?? "",
      displayName: recipientName ?? "",
      email: recipientEmail,
    };

    await this.sendMail(
      recipientEmail,
      this.formatTemplate(this.config.get("email.verificationSubject"), vars),
      this.formatTemplate(
        this.config.get("email.verificationMessage"),
        vars,
        true,
      ),
      undefined,
      recipientName,
    );
  }

  async sendContactEmail(
    name: string,
    email: string,
    subject: string,
    message: string,
  ) {
    const adminEmail =
      process.env.REPORT_EMAIL?.trim() ||
      (this.config.get("smtp.email") as string);
    if (!adminEmail) {
      throw new InternalServerErrorException(
        this.i18n.t("email.reportEmailNotConfigured"),
      );
    }

    const vars = { name, email, subject, message };
    await this.sendMail(
      adminEmail,
      `[Contact] ${subject}`,
      this.formatTemplate(
        "New contact message\\n\\nFrom: {name} <{email}>\\nSubject: {subject}\\n\\n{message}",
        vars,
        true,
      ),
      { name, address: email },
    );
  }

  async sendShareReportEmail(
    shareId: string,
    shareName: string | null,
    fileNames: string[],
    reason: string,
    message?: string,
  ) {
    // Report notifications are sent to REPORT_EMAIL when it is set in the
    // backend environment, otherwise to the SMTP sender address (smtp.email)
    // configured in the admin UI.
    const adminEmail =
      process.env.REPORT_EMAIL?.trim() ||
      (this.config.get("smtp.email") as string);
    if (!adminEmail) {
      throw new InternalServerErrorException(
        this.i18n.t("email.reportEmailNotConfigured"),
      );
    }

    const shareUrl = `${this.config.get("general.appUrl")}/s/${shareId}`;
    const vars = {
      appName: this.config.get("general.appName"),
      shareId,
      shareName: shareName?.trim() || shareId,
      shareUrl,
      fileList: fileNames.map((name) => `- ${name}`).join("\n"),
      reason,
      message: message?.trim() || this.i18n.t("email.reportMessageFallback"),
    };

    await this.sendMail(
      adminEmail,
      this.i18n.t("email.reportSubject", { args: vars }),
      this.i18n.t("email.reportText", { args: this.escapeHtmlVars(vars) }),
    );
  }

  async sendTestMail(recipientEmail: string) {
    const subject = this.i18n.t("email.testSubject");
    const text = this.i18n.t("email.testText");
    await this.getTransporter()
      .sendMail({
        from: this.getFromAddress(),
        to: recipientEmail,
        subject,
        text,
      })
      .catch((e) => {
        this.logger.error(e);
        throw new InternalServerErrorException(e.message);
      });
  }
}
