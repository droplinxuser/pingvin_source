import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const shareReportReasons = [
  "DMCA",
  "CSAM",
  "Gore",
  "Malware",
  "Spam",
  "Personal information",
  "Other",
] as const;

export type ShareReportReason = (typeof shareReportReasons)[number];

export class ReportShareDTO {
  @IsString()
  @IsIn(shareReportReasons)
  reason: ShareReportReason;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  message?: string;
}
