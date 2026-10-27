import { IsOptional, IsString, MaxLength } from "class-validator";

export class SharePasswordDto {
  @IsString()
  @IsOptional()
  @MaxLength(128)
  password: string;
}
