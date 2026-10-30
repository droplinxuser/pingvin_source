import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class SendContactMessageDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  turnstileToken: string;
}
