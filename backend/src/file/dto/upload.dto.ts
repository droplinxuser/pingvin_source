import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

// Folder uploads keep their relative path, so slashes are allowed. Reject
// absolute paths, parent segments, backslashes and control characters.
export const SAFE_FILE_NAME =
  // eslint-disable-next-line no-control-regex
  /^(?!\/)(?!.*\/$)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f\u007f]+$/;

export class UploadInitDTO {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(1024)
  @Matches(SAFE_FILE_NAME)
  name: string;

  // The service also caps this against the configured file/chunk sizes.
  @IsInt()
  @Min(1)
  @Max(10_000)
  totalChunks: number;
}

export class UploadPartDTO {
  @IsString()
  @MaxLength(256)
  ETag: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  PartNumber: number;
}

export class UploadCompleteDTO {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(1024)
  @Matches(SAFE_FILE_NAME)
  name: string;

  @IsString()
  @MaxLength(2048)
  uploadId: string;

  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => UploadPartDTO)
  parts: UploadPartDTO[];
}

export class UploadFromUrlDTO {
  @IsString()
  @MaxLength(2048)
  url: string;

  // The name is sanitized again in the service, so folder-like paths from the
  // browser are accepted here and reduced to a safe single file name.
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  name?: string;
}

export class UploadAbortDTO {
  @IsString()
  @MaxLength(1024)
  @Matches(SAFE_FILE_NAME)
  name: string;

  @IsString()
  @MaxLength(2048)
  uploadId: string;
}
