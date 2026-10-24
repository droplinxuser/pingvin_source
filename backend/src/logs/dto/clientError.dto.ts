import { IsOptional, IsString, MaxLength } from "class-validator";

export class ClientErrorDTO {
  @IsString()
  @MaxLength(4_000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(12_000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  context?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  url?: string;
}
