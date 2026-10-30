import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from "class-validator";

export class ShareSecurityDTO {
  @IsString()
  @IsOptional()
  @Length(3, 30)
  password: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxViews: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxDownloads: number;

  @IsBoolean()
  @IsOptional()
  restrictToRecipients: boolean;
}
