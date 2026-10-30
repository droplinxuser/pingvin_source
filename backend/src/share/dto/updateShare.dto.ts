import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class UpdateShareSecurityDTO {
  @IsString()
  @IsOptional()
  @Length(3, 30)
  password?: string;

  @IsBoolean()
  @IsOptional()
  removePassword?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxViews?: number | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxDownloads?: number | null;
}

export class UpdateShareDTO {
  @Length(3, 30)
  @IsOptional()
  name?: string | null;

  @MaxLength(512)
  @IsOptional()
  description?: string | null;

  @ValidateNested()
  @Type(() => UpdateShareSecurityDTO)
  @IsOptional()
  security?: UpdateShareSecurityDTO;
}
