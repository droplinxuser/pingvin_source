import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import { i18nValidationMessage } from "nestjs-i18n";

export class CreateReverseShareDTO {
  @IsBoolean()
  sendEmailNotification: boolean;

  @IsString()
  @Matches(/^[0-9]{1,15}$/, {
    message: "maxShareSize must be a positive integer with at most 15 digits",
  })
  maxShareSize: string;

  @Min(1)
  @Max(1000)
  maxUseCount: number;

  @IsBoolean()
  simplified: boolean;

  @IsBoolean()
  publicAccess: boolean;

  @IsString()
  @IsOptional()
  @Matches("^[a-zA-Z0-9_-]+$", undefined, {
    message: i18nValidationMessage("validation.idPattern"),
  })
  @Length(3, 50)
  token?: string;
}
