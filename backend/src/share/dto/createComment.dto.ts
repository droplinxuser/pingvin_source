import { IsString, MaxLength, MinLength } from "class-validator";
import { MAX_COMMENT_LENGTH } from "../comment.service";

export class CreateCommentDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COMMENT_LENGTH)
  content: string;
}
