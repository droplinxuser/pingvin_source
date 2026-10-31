import Config from "../types/config.type";

export function getDefaultConfig(): Config[] {
  return [
    {
      key: "general.appName",
      value: "File Share",
      defaultValue: "File Share",
      type: "string",
    },
    {
      key: "general.appUrl",
      value: "",
      defaultValue: "",
      type: "string",
    },
    {
      key: "general.showHomePage",
      value: "true",
      defaultValue: "true",
      type: "boolean",
    },
    {
      key: "general.showAuthButtons",
      value: "true",
      defaultValue: "true",
      type: "boolean",
    },
    {
      key: "general.defaultLanguage",
      value: "en-US",
      defaultValue: "en-US",
      type: "string",
    },
    {
      key: "share.enableUserRecipients",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "share.enableShareEmailRecipients",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "share.enableShareDownloadNotifications",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "share.maxSize",
      value: "5000000000",
      defaultValue: "5000000000",
      type: "filesize",
    },
    {
      key: "share.maxFileSize",
      value: "512000000",
      defaultValue: "512000000",
      type: "filesize",
    },
    {
      key: "share.maxZipSize",
      value: "512000000",
      defaultValue: "512000000",
      type: "filesize",
    },
    {
      key: "share.chunkSize",
      value: "10000000",
      defaultValue: "10000000",
      type: "filesize",
    },
    {
      key: "share.shareIdLength",
      value: "8",
      defaultValue: "8",
      type: "number",
    },
    {
      key: "share.autoOpenShareModal",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "share.reverseShareSimpleOnly",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "share.fileRetentionPeriod",
      value: "0 days",
      defaultValue: "0 days",
      type: "timespan",
    },
    {
      key: "appearance.uploadProgressStyle",
      value: "circle",
      defaultValue: "circle",
      type: "string",
    },
    {
      key: "security.customPasswordPolicy",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "security.minLength",
      value: "8",
      defaultValue: "8",
      type: "number",
    },
    {
      key: "security.requireUppercase",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "security.requireLowercase",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "security.requireNumber",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "security.requireSpecialCharacter",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "oauth.disablePassword",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "security.allowRegistration",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "security.allowUnauthenticatedShares",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
    {
      key: "smtp.enabled",
      value: "false",
      defaultValue: "false",
      type: "boolean",
    },
  ];
}
