import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class AuthSignInDTO {
  @IsEmail()
  @IsOptional()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  username: string;

  // Empty passwords must never reach an LDAP bind: RFC 4513 treats a bind
  // with a DN and no password as an unauthenticated bind on many servers.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
