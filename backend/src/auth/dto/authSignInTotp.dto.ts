import { IsString, Length, MaxLength } from "class-validator";

export class AuthSignInTotpDTO {
  @IsString()
  @Length(6, 10)
  totp: string;

  @IsString()
  @MaxLength(100)
  loginToken: string;
}
