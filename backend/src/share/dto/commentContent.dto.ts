import { IsString, MaxLength, MinLength } from "class-validator";
import { MAX_COMMENT_LENGTH } from "../comment.service";

export class CommentContentDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COMMENT_LENGTH)
  content: string;
}
